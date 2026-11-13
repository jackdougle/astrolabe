// What the raw (Monaco) view does while editing, for the rendered Markdown view: the line keys, bracket
// pairs and the gliding caret, so the two views edit the same way and differ only in how the text looks.
import { NodeSelection, Plugin, PluginKey, Selection, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorState, Transaction } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { Fragment } from '@milkdown/kit/prose/model';
import type { MarkType, Node as PMNode } from '@milkdown/kit/prose/model';
import { $prose } from '@milkdown/kit/utils';
import { motionKey } from './richMotion';
import type { MotionMeta } from './richMotion';
import { useStore } from './store';

export type Cmd = (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean;

// ---------------------------------------------------------------------------------------------------------
// Lines. A line is a paragraph, a heading, another whole block, a list item with whatever is nested under
// it, or one line of a code block.

const isList = (node: PMNode | null | undefined) => node?.firstChild?.type.name === 'list_item';
const HOLDS_LINES = new Set(['doc', 'blockquote', 'list_item', 'toggle', 'table_cell', 'table_header']);
const inTable = (node: PMNode) => node.type.name.startsWith('table');

/** The lines the selection touches: children [i0, i1) of `node`, whose content starts at `start`. */
interface Run { depth: number; node: PMNode; start: number; i0: number; i1: number }
function lineRun(state: EditorState): Run | null {
  const { $from, $to } = state.selection;
  let depth = $from.sharedDepth($to.pos);
  let i0: number;
  let i1: number;
  if ($from.node(depth).isTextblock) {
    if (!depth) return null;
    depth -= 1;
    i0 = $from.index(depth);
    i1 = i0 + 1;
  } else {
    i0 = $from.index(depth);
    i1 = Math.max(i0 + 1, $to.depth > depth ? $to.index(depth) + 1 : $to.index(depth));
  }
  // The line that opens a list item stands for the item, and a toggle's title for the toggle.
  if (depth && i0 === 0 && ['list_item', 'toggle'].includes($from.node(depth).type.name)) { depth -= 1; i0 = $from.index(depth); i1 = i0 + 1; }
  const node = $from.node(depth);
  if (!isList(node) && !HOLDS_LINES.has(node.type.name)) return null;
  return { depth, node, start: $from.start(depth), i0, i1: Math.min(i1, node.childCount) };
}
function childPos(node: PMNode, start: number, index: number) {
  let pos = start;
  for (let k = 0; k < index; k++) pos += node.child(k).nodeSize;
  return pos;
}
const runFrom = (run: Run) => childPos(run.node, run.start, run.i0);
const runTo = (run: Run) => childPos(run.node, run.start, run.i1);

/** The code-block lines the selection touches, as offsets [a, b) into the block's text. */
function codeLines(state: EditorState) {
  const { $from, $to, empty } = state.selection;
  if (!$from.sameParent($to) || !$from.parent.type.spec.code) return null;
  const code = $from.parent.textContent;
  let end = $to.parentOffset;
  if (!empty && code[end - 1] === '\n') end -= 1; // a selection that stops at the start of a line does not take that line
  const off = $from.parentOffset;
  const a = off ? code.lastIndexOf('\n', off - 1) + 1 : 0;
  let b = code.indexOf('\n', end);
  if (b < 0) b = code.length;
  return { code, a, b, start: $from.start() };
}

function shifted(state: EditorState, tr: Transaction, by: number) {
  const sel = state.selection;
  try {
    tr.setSelection(sel instanceof NodeSelection ? NodeSelection.create(tr.doc, sel.from + by) : TextSelection.create(tr.doc, sel.anchor + by, sel.head + by));
  } catch { /* keep the selection the edit left */ }
  return tr.scrollIntoView();
}

// Moving works on a container's lines laid out flat, as they are in the file: each block is one, and so is
// each item of a list in it. A line swaps places with the one beside it and the lists are then built again,
// so an item can leave its list past a paragraph and a paragraph can pass through a list one item at a time.
interface Atom { node: PMNode; list: PMNode | null; k: number; child: number; pos: number; idx: number; moved: boolean }
function atomsOf(parent: PMNode, start: number) {
  const atoms: Atom[] = [];
  parent.forEach((child, offset, index) => {
    if (isList(child)) child.forEach((item, off, k) => { atoms.push({ node: item, list: child, k, child: index, pos: start + offset + 1 + off, idx: atoms.length, moved: false }); });
    else atoms.push({ node: child, list: null, k: 0, child: index, pos: start + offset, idx: atoms.length, moved: false });
  });
  return atoms;
}
/** Items share a list when they did before, or when the move is what brought them together. */
const joins = (a: Atom, b: Atom) => !!a.list && !!b.list && a.list.type === b.list.type && (a.list === b.list || a.moved || b.moved || a.idx + 1 !== b.idx);
function regroup(seq: Atom[], at: number) {
  const nodes: PMNode[] = [];
  const starts = new Map<Atom, number>();
  let pos = at;
  for (let i = 0; i < seq.length;) {
    const first = seq[i];
    if (!first.list) { starts.set(first, pos); nodes.push(first.node); pos += first.node.nodeSize; i += 1; continue; }
    let j = i + 1;
    while (j < seq.length && joins(seq[j - 1], seq[j])) j += 1;
    const group = seq.slice(i, j);
    const host = group.find((a) => !a.moved) ?? first;
    const attrs = { ...host.list!.attrs };
    // A numbered list keeps its first number. The part of one that is cut off from its top counts on from
    // where it was, as the numbers in the file would.
    const movedCount = group.filter((a) => a.moved).length;
    if (typeof attrs.order === 'number' && (movedCount === 0 || movedCount === group.length)) attrs.order += first.k;
    let inner = pos + 1;
    for (const a of group) { starts.set(a, inner); inner += a.node.nodeSize; }
    const list = host.list!.type.create(attrs, group.map((a) => a.node));
    nodes.push(list);
    pos += list.nodeSize;
    i = j;
  }
  return { nodes, starts };
}
function reselect(state: EditorState, tr: Transaction, moved: Atom[], starts: Map<Atom, number>) {
  const map = (p: number) => {
    for (const a of moved) if (p >= a.pos && p < a.pos + a.node.nodeSize) return starts.get(a)! + p - a.pos;
    return tr.mapping.map(p);
  };
  const sel = state.selection;
  try {
    tr.setSelection(sel instanceof NodeSelection ? NodeSelection.create(tr.doc, map(sel.from)) : TextSelection.create(tr.doc, map(sel.anchor), map(sel.head)));
  } catch { /* keep the selection the edit left */ }
  return tr.scrollIntoView();
}

function moveCode(state: EditorState, dir: -1 | 1, dispatch?: (tr: Transaction) => void) {
  const c = codeLines(state);
  if (!c) return false;
  const { code, a, b, start } = c;
  if (dir < 0 ? a === 0 : b === code.length) return false; // at the block's edge the whole block moves
  let from: number, to: number, text: string, by: number;
  if (dir < 0) {
    const p = a > 1 ? code.lastIndexOf('\n', a - 2) + 1 : 0;
    from = p; to = b; text = `${code.slice(a, b)}\n${code.slice(p, a - 1)}`; by = p - a;
  } else {
    let e = code.indexOf('\n', b + 1);
    if (e < 0) e = code.length;
    from = a; to = e; text = `${code.slice(b + 1, e)}\n${code.slice(a, b)}`; by = e - b;
  }
  if (dispatch) dispatch(shifted(state, state.tr.insertText(text, start + from, start + to), by));
  return true;
}

/** ⌥↑ / ⌥↓: move the selected lines past the line above or below. */
export function moveLines(dir: -1 | 1): Cmd {
  return (state, dispatch) => {
    if (moveCode(state, dir, dispatch)) return true;
    const { $from } = state.selection;
    let run = lineRun(state);
    if (!run) return false;
    for (;;) {
      const inList = isList(run.node);
      const depth = inList ? run.depth - 1 : run.depth;
      const parent = $from.node(depth);
      if (!HOLDS_LINES.has(parent.type.name)) return true;
      const start = $from.start(depth);
      const atoms = atomsOf(parent, start);
      const r = run;
      for (const a of atoms) a.moved = inList ? a.list === r.node && a.k >= r.i0 && a.k < r.i1 : a.child >= r.i0 && a.child < r.i1;
      const moved = atoms.filter((a) => a.moved);
      if (!moved.length) return true;
      const a0 = moved[0].idx;
      const a1 = moved[moved.length - 1].idx + 1;
      const n = dir < 0 ? a0 - 1 : a1;
      const isItem = parent.type.name === 'list_item';
      // An item's own line (and a toggle's title) stays first in it, so nothing nested under it swaps with that.
      if (n >= (isItem || parent.type.name === 'toggle' ? 1 : 0) && n < atoms.length) {
        const lo = Math.max(0, Math.min(n, a0) - 1);
        const hi = Math.min(atoms.length, Math.max(n + 1, a1) + 1);
        const k0 = atoms[lo].child;
        const k1 = atoms[hi - 1].child + 1;
        const out = atoms.filter((a) => a.child >= k0 && a.child < k1 && !a.moved);
        out.splice(out.indexOf(atoms[n]) + (dir < 0 ? 0 : 1), 0, ...moved);
        const from = childPos(parent, start, k0);
        const { nodes, starts } = regroup(out, from);
        if (dispatch) dispatch(reselect(state, state.tr.replaceWith(from, childPos(parent, start, k1), nodes), moved, starts));
        return true;
      }
      if (isItem) {
        // Nested items at the edge of their list step out, to sit before or after the item they were under.
        if (!depth || !moved.every((a) => a.list)) return true;
        const at = $from.before(depth);
        const kept = parent.copy(Fragment.from(regroup(atoms.filter((a) => !a.moved), 0).nodes));
        const out = moved.map((a) => a.node.type.create({ ...a.node.attrs, listType: parent.attrs.listType, label: parent.attrs.label }, a.node.content));
        const starts = new Map<Atom, number>();
        let pos = dir < 0 ? at : at + kept.nodeSize;
        for (const a of moved) { starts.set(a, pos); pos += a.node.nodeSize; }
        if (dispatch) dispatch(reselect(state, state.tr.replaceWith(at, at + parent.nodeSize, dir < 0 ? [...out, kept] : [kept, ...out]), moved, starts));
        return true;
      }
      // At the edge of a quote, the quote itself is the line.
      if (parent.type.name !== 'blockquote' || !depth) return true;
      const i = $from.index(depth - 1);
      const outer = $from.node(depth - 1);
      if (!isList(outer) && !HOLDS_LINES.has(outer.type.name)) return true;
      run = { depth: depth - 1, node: outer, start: $from.start(depth - 1), i0: i, i1: i + 1 };
    }
  };
}

/** ⇧⌥↑ / ⇧⌥↓: a copy of the selected lines above or below them. */
export function copyLines(dir: -1 | 1): Cmd {
  return (state, dispatch) => {
    const tr = state.tr;
    let size: number;
    const c = codeLines(state);
    if (c) {
      const text = `${c.code.slice(c.a, c.b)}\n`;
      tr.insertText(text, c.start + c.a);
      size = text.length;
    } else {
      const run = lineRun(state);
      if (!run || inTable(run.node)) return false;
      const nodes: PMNode[] = [];
      for (let i = run.i0; i < run.i1; i++) nodes.push(run.node.child(i));
      const to = runTo(run);
      tr.insert(to, Fragment.from(nodes));
      size = to - runFrom(run);
    }
    // The caret stays in the copy on the side it was sent to.
    if (dispatch) dispatch(shifted(state, tr, dir > 0 ? size : 0));
    return true;
  };
}

/** ⇧⌘K: delete the selected lines. */
export const deleteLines: Cmd = (state, dispatch) => {
  const tr = state.tr;
  const c = codeLines(state);
  if (c && c.code) {
    // A line goes with its line break: the one after it, or for the last line the one before.
    const last = c.b === c.code.length;
    const at = c.start + (last && c.a > 0 ? c.a - 1 : c.a);
    tr.delete(at, c.start + (last ? c.b : c.b + 1));
    tr.setSelection(TextSelection.create(tr.doc, at));
  } else {
    const run = lineRun(state);
    if (!run) return false;
    const from = runFrom(run);
    const to = runTo(run);
    if (inTable(run.node)) { if (to - from > 2) tr.delete(from + 1, to - 1); } // a table cell is emptied, not removed
    else tr.deleteRange(from, to); // also removes a list or quote this leaves empty
    tr.setSelection(Selection.near(tr.doc.resolve(Math.min(tr.mapping.map(from), tr.doc.content.size)), 1));
  }
  if (dispatch) dispatch(tr.scrollIntoView());
  return true;
};

/** ⌘↩: a new line below this one (a new item below an item). In a code block the key leaves the block instead. */
export const lineBelow: Cmd = (state, dispatch) => {
  const paragraph = state.schema.nodes.paragraph;
  if (state.selection.$from.parent.type.spec.code || !paragraph) return false;
  const run = lineRun(state);
  if (!run || inTable(run.node)) return false;
  const to = runTo(run);
  let node = paragraph.create();
  if (isList(run.node)) {
    const item = run.node.child(run.i1 - 1);
    node = item.type.create({ ...item.attrs, checked: item.attrs.checked == null ? item.attrs.checked : false }, node);
  }
  if (dispatch) {
    const tr = state.tr.insert(to, node);
    dispatch(tr.setSelection(Selection.near(tr.doc.resolve(to + 1), 1)).scrollIntoView());
  }
  return true;
};

/** ⌃L: select the line; again, the line below as well. */
export const selectLines: Cmd = (state, dispatch) => {
  const { doc } = state;
  let sel: Selection | null = null;
  const c = codeLines(state);
  if (c) {
    sel = TextSelection.create(doc, c.start + c.a, c.start + c.b);
    if (state.selection.eq(sel) && c.b < c.code.length) {
      const e = c.code.indexOf('\n', c.b + 1);
      sel = TextSelection.create(doc, c.start + c.a, c.start + (e < 0 ? c.code.length : e));
    }
  } else {
    const run = lineRun(state);
    if (!run) return false;
    const from = runFrom(run);
    const make = (i1: number, into = 0) => {
      const to = childPos(run.node, run.start, i1) + into;
      const a = Selection.findFrom(doc.resolve(from), 1, true);
      const b = Selection.findFrom(doc.resolve(to), -1, true);
      return a && b && a.from >= from && b.to <= to && a.from <= b.to ? TextSelection.create(doc, a.from, b.to) : null;
    };
    sel = make(run.i1);
    if (sel && state.selection.eq(sel) && run.i1 < run.node.childCount) {
      const below = run.node.child(run.i1);
      sel = (isList(below) ? make(run.i1, 1 + below.firstChild!.nodeSize) : make(run.i1 + 1)) ?? sel; // of a list below, its first item
    }
  }
  if (sel && dispatch) dispatch(state.tr.setSelection(sel).scrollIntoView());
  return true;
};

// ---------------------------------------------------------------------------------------------------------
// Brackets and quotes: anything that encloses a phrase, ( [ { < " ' ` * _ and the curly quotes, typed over a
// selection goes around it instead of replacing it, and { [ ( < typed before a space or the end of a line bring their closing half, which is
// typed over, and deleted with Backspace, while the caret is still inside the pair.

const CLOSERS: Record<string, string> = { '{': '}', '[': ']', '(': ')', '<': '>' };
// A tilde is only ever a tilde: striking words through has a key of its own (⇧⌘X, in richMarkdown.ts).
const WRAPS: Record<string, string> = { '(': ')', '[': ']', '{': '}', '<': '>', '"': '"', "'": "'", '“': '”', '‘': '’', '`': '`', '*': '*', '_': '_' };
// Markdown's own marks are not put in as characters, which this view would show (and save) as literal
// asterisks: the words get what those characters mean in the file.
const MARKS: Record<string, string> = { '`': 'inlineCode', '*': 'emphasis', '_': 'emphasis' };
function allMarked(doc: PMNode, from: number, to: number, type: MarkType) {
  let any = false;
  let all = true;
  doc.nodesBetween(from, to, (node) => { if (node.isText) { any = true; if (!type.isInSet(node.marks)) all = false; } });
  return any && all;
}
const CLOSE_BEFORE = ';:.,=}])> \n\t';
interface Pair { open: number; close: number; a: string; b: string }
const pairKey = new PluginKey<Pair[]>('astrolabe-pairs');

function wrap(view: EditorView, text: string) {
  const { state } = view;
  const sel = state.selection;
  const close = WRAPS[text];
  if (!close || sel.empty || !(sel instanceof TextSelection) || !view.editable) return false;
  const tr = state.tr;
  const { from, to } = sel;
  const mark = state.schema.marks[MARKS[text]];
  const strong = state.schema.marks.strong;
  if (mark && !sel.$from.parent.type.spec.code && !sel.$to.parent.type.spec.code) {
    if (MARKS[text] !== 'emphasis' || !strong) tr.addMark(from, to, mark.create());
    else {
      // As the characters stack up in the file: * is italic, ** bold, *** both.
      const em = allMarked(state.doc, from, to, mark);
      const bold = allMarked(state.doc, from, to, strong);
      if (em && !bold) tr.removeMark(from, to, mark).addMark(from, to, strong.create());
      else if (!em) tr.addMark(from, to, mark.create());
    }
  } else {
    tr.insertText(close, sel.to).insertText(text, sel.from);
    tr.setSelection(TextSelection.create(tr.doc, sel.anchor + 1, sel.head + 1)); // still selected, so a second [ makes [[a link]]
    tr.setMeta(motionKey, { grow: [[from, from + 1], [to + 1, to + 2]] } satisfies MotionMeta); // the pair grows in, so the words slide apart
  }
  if (tr.steps.length) view.dispatch(tr.scrollIntoView());
  return true;
}

export const pairs = $prose(() => new Plugin<Pair[]>({
  key: pairKey,
  state: {
    init: () => [],
    apply(tr, value) {
      const added = tr.getMeta(pairKey) as Pair | undefined;
      if (!value.length && !added) return value;
      const { doc, selection } = tr;
      const charAt = (pos: number) => (pos >= 0 && pos < doc.content.size ? doc.textBetween(pos, pos + 1) : '');
      const next = value
        .map((p) => ({ ...p, open: tr.mapping.map(p.open, -1), close: tr.mapping.map(p.close, 1) }))
        .filter((p) => selection.empty && selection.head > p.open && selection.head <= p.close && charAt(p.open) === p.a && charAt(p.close) === p.b);
      if (added) next.push(added);
      return next;
    },
  },
  props: {
    handleTextInput(view, from, to, text) {
      if (text.length !== 1 || view.composing || !view.editable) return false;
      const { state } = view;
      const sel = state.selection;
      if (!sel.empty) return wrap(view, text);
      if (from !== to || !(sel instanceof TextSelection)) return false;
      const over = (pairKey.getState(state) ?? []).find((p) => p.close === sel.head && p.b === text);
      if (over) {
        // Typing the closing half: the one put in for you makes way, and the key then goes in as usual.
        view.dispatch(state.tr.delete(over.close, over.close + 1));
        return false;
      }
      const closer = CLOSERS[text];
      if (!closer) return false;
      const $head = sel.$head;
      const after = $head.parent.textBetween($head.parentOffset, Math.min($head.parentOffset + 1, $head.parent.content.size), undefined, ' ');
      if (after && !CLOSE_BEFORE.includes(after)) return false;
      const tr = state.tr.insertText(text + closer, from);
      tr.setSelection(TextSelection.create(tr.doc, from + 1)).setMeta(pairKey, { open: from, close: from + 1, a: text, b: closer });
      view.dispatch(tr.scrollIntoView());
      return true;
    },
    handleKeyDown(view, event) {
      if (event.key !== 'Backspace' || event.metaKey || event.ctrlKey || event.altKey) return false;
      const { state } = view;
      const sel = state.selection;
      const pair = sel.empty ? (pairKey.getState(state) ?? []).find((p) => p.open === sel.head - 1 && p.close === sel.head) : null;
      if (!pair) return false;
      view.dispatch(state.tr.delete(pair.open, pair.close + 1).scrollIntoView());
      return true;
    },
    handleDOMEvents: {
      // Seen before the browser replaces the selection, so the words to go around are still there.
      beforeinput(view, event) {
        const e = event as InputEvent;
        if (e.inputType !== 'insertText' || e.data?.length !== 1 || e.isComposing || view.composing) return false;
        if (!wrap(view, e.data)) return false;
        e.preventDefault();
        return true;
      },
    },
  },
}));

// ---------------------------------------------------------------------------------------------------------
// The caret. The browser's own cannot glide, so it is hidden and one is drawn at the same place, with
// Monaco's timings: 80ms between places, and a soft blink that starts half a second after it last moved.

const BLINK_AFTER = 500;
export const caret = $prose(() => new Plugin({
  view(view) {
    const el = document.createElement('div');
    el.className = 'rich-caret';
    let host: HTMLElement | null = null;
    let shown = false;
    let last = '';
    let blink = 0;
    let frame = 0;
    const hide = () => {
      shown = false; last = '';
      el.classList.remove('is-on', 'is-blinking');
      host?.classList.remove('has-caret');
      clearTimeout(blink);
    };
    const place = () => {
      const parent = view.dom.parentElement;
      if (!parent) return;
      if (host !== parent) { host = parent; host.appendChild(el); }
      const sel = view.state.selection;
      if (!view.hasFocus() || !view.editable || sel instanceof NodeSelection) { hide(); return; }
      let at: { left: number; top: number; bottom: number };
      try { at = view.coordsAtPos(sel.head); } catch { hide(); return; }
      const box = host.getBoundingClientRect();
      const x = Math.round(at.left - box.left) - 1;
      const y = at.top - box.top;
      const h = at.bottom - at.top;
      if (!(h > 0)) { hide(); return; }
      const next = `${x},${y.toFixed(1)},${h.toFixed(1)}`;
      if (next === last && shown) return;
      last = next;
      el.classList.toggle('is-smooth', shown && useStore.getState().settings.smoothCaret); // it appears in place, then glides
      el.style.transform = `translate(${x}px, ${y}px)`;
      el.style.height = `${h}px`;
      el.classList.remove('is-blinking');
      el.classList.add('is-on');
      host.classList.add('has-caret');
      shown = true;
      clearTimeout(blink);
      blink = window.setTimeout(() => el.classList.add('is-blinking'), BLINK_AFTER);
    };
    // Once now, and once after layout has settled (fonts, images, a pane still sliding in).
    const sync = () => { place(); cancelAnimationFrame(frame); frame = requestAnimationFrame(place); };
    // While text in the note is sliding (richMotion.ts, a heading's #s), the caret keeps up with it frame by frame.
    let followUntil = 0;
    let following = 0;
    const follow = () => { place(); following = performance.now() < followUntil ? requestAnimationFrame(follow) : 0; };
    const moving = () => { followUntil = performance.now() + 260; if (!following) following = requestAnimationFrame(follow); };
    view.dom.addEventListener('animationstart', moving);
    view.dom.addEventListener('transitionrun', moving);
    const sizes = new ResizeObserver(sync);
    sizes.observe(view.dom);
    view.dom.addEventListener('focus', sync);
    view.dom.addEventListener('blur', sync);
    document.fonts.addEventListener('loadingdone', sync);
    sync();
    return {
      update: sync,
      destroy() {
        sizes.disconnect();
        view.dom.removeEventListener('focus', sync);
        view.dom.removeEventListener('blur', sync);
        document.fonts.removeEventListener('loadingdone', sync);
        view.dom.removeEventListener('animationstart', moving);
        view.dom.removeEventListener('transitionrun', moving);
        cancelAnimationFrame(frame);
        cancelAnimationFrame(following);
        clearTimeout(blink);
        host?.classList.remove('has-caret');
        el.remove();
      },
    };
  },
}));
