// Notion's note-taking habits for the rendered view: [] at the start of a line makes a to-do, > a toggle and
// " a quote. The same marks typed at the start of a line that is already a bullet, a to-do, a numbered item or a
// toggle turn it into the other kind (- or * for a plain bullet). A toggle is kept in the file as <details><summary>title</summary> ... </details>, which other
// Markdown readers fold the same way.
//
// A toggle's title can also be a heading: "> " typed in front of a heading's #s or straight after them, or where
// the words of a heading made earlier begin (or #s typed in a toggle's title), makes a toggle heading, which holds
// the heading's section. Its arrow stands in front of the #s, which show as any heading's do: only while it is
// being made (richHashes.ts). In the file its title is <summary><h2>title</h2></summary>.
import { InputRule, inputRules } from '@milkdown/kit/prose/inputrules';
import { Plugin, Selection, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorState, Transaction } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { Fragment } from '@milkdown/kit/prose/model';
import type { Node as PMNode, ResolvedPos } from '@milkdown/kit/prose/model';
import { splitListItem } from '@milkdown/kit/prose/schema-list';
import { canJoin, findWrapping } from '@milkdown/kit/prose/transform';
import { $node, $prose, $remark, $view } from '@milkdown/kit/utils';
import type { Cmd } from './richEditing';
import { hashesShown, showHashes } from './richHashes';

// ---------------------------------------------------------------------------------------------------------
// Toggles in the file.

interface Md { type: string; value?: string; open?: boolean; level?: number; children?: Md[]; position?: unknown }

// Only the plain form is read as a toggle: a title without tags of its own, then the blocks, each set off by a
// blank line. Anything else stays the HTML it is.
const DETAILS_OPEN = /^<details(\s+open(?:=(?:""|''|"open"|'open'))?)?\s*>\s*<summary>(?:([^<]*)|\s*<h([1-6])>([^<]*)<\/h\3>\s*)<\/summary>$/i;
const DETAILS_CLOSE = /^<\/details>$/i;
const encode = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const decode = (text: string) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** For each block in a row, by its HTML (null for other blocks): 1 where a toggle opens, -1 where one closes.
 *  Null when there are none, or when they do not pair up. */
export function toggleMarks(html: (string | null | undefined)[]): number[] | null {
  let depth = 0;
  let any = false;
  let paired = true;
  const marks = html.map((value) => {
    const text = value?.trim();
    if (text && DETAILS_OPEN.test(text)) { depth += 1; any = true; return 1; }
    if (text && DETAILS_CLOSE.test(text)) { depth -= 1; if (depth < 0) paired = false; return -1; }
    return 0;
  });
  return any && paired && depth === 0 ? marks : null;
}

/** A block's HTML, whether it stands alone or has already been put in a paragraph of its own. */
const htmlOf = (node: Md) => (node.type === 'html' ? node.value ?? null
  : node.type === 'paragraph' && node.children?.length === 1 && node.children[0].type === 'html' ? node.children[0].value ?? null : null);

function foldToggles(node: Md) {
  if (!node.children) return;
  node.children.forEach(foldToggles);
  const html = node.children.map(htmlOf);
  const marks = toggleMarks(html);
  if (!marks) return;
  const out: Md[] = [];
  const stack: Md[] = [];
  node.children.forEach((child, i) => {
    const into = stack.length ? stack[stack.length - 1].children! : out;
    if (marks[i] === 1) {
      const m = DETAILS_OPEN.exec(html[i]!.trim())!;
      stack.push({ type: 'toggle', open: !!m[1], children: [{ type: 'toggleSummary', value: decode((m[2] ?? m[4]).trim()), level: m[3] ? Number(m[3]) : 0 }], position: child.position });
    } else if (marks[i] === -1) {
      const done = stack.pop()!;
      (stack.length ? stack[stack.length - 1].children! : out).push(done);
    } else into.push(child);
  });
  node.children = out;
}
const remarkToggle = $remark('remarkToggle', () => () => (tree: unknown) => { foldToggles(tree as Md); });

const toggleNode = $node('toggle', () => ({
  content: 'toggle_summary block*',
  group: 'block',
  defining: true,
  attrs: { open: { default: true, validate: 'boolean' } },
  parseDOM: [{ tag: 'div[data-type="toggle"]', getAttrs: (dom) => ({ open: (dom as HTMLElement).dataset.open !== 'false' }) }],
  toDOM: (node) => ['div', { class: 'toggle', 'data-type': 'toggle', 'data-open': String(node.attrs.open) }, 0],
  parseMarkdown: {
    match: (node) => node.type === 'toggle',
    runner: (state, node, type) => { state.openNode(type, { open: !!node.open }); state.next(node.children); state.closeNode(); },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'toggle',
    runner: (state, node) => {
      const summary = node.firstChild?.type.name === 'toggle_summary' ? node.firstChild : null;
      const title = encode(summary ? titleText(summary) : '');
      const level = summary ? levelOf(node) : 0;
      state.addNode('html', undefined, `<details${node.attrs.open ? ' open' : ''}>\n<summary>${level ? `<h${level}>${title}</h${level}>` : title}</summary>`);
      node.forEach((child) => { if (child.type.name !== 'toggle_summary') state.next(child); });
      state.addNode('html', undefined, '</details>');
    },
  },
}));
// A toggle's box is drawn once and kept: opening or shutting it only changes its mark, so the arrow turns instead
// of jumping (a box drawn afresh has nothing to turn from), and what it holds eases into view.
const toggleView = $view(toggleNode, () => (node) => {
  const dom = document.createElement('div');
  dom.className = 'toggle';
  dom.dataset.type = 'toggle';
  dom.dataset.open = String(node.attrs.open);
  let open = node.attrs.open as boolean;
  let timer = 0;
  return {
    dom,
    contentDOM: dom,
    update(next) {
      if (next.type !== node.type) return false;
      if (next.attrs.open !== open) {
        open = next.attrs.open as boolean;
        dom.dataset.open = String(open);
        window.clearTimeout(timer);
        dom.classList.toggle('is-opening', open);
        if (open) timer = window.setTimeout(() => dom.classList.remove('is-opening'), 240);
      }
      return true;
    },
    // The mark and the class are set here, not typed: the editor is not to read them back as an edit.
    ignoreMutation: (mutation) => mutation.type === 'attributes' && mutation.target === dom,
    destroy() { window.clearTimeout(timer); },
  };
});
const toggleSummaryNode = $node('toggle_summary', () => ({
  content: 'text*',
  marks: 'hash', // plain words, but for the #s a toggle heading shows while the caret is in it (richHashes.ts)
  defining: true,
  attrs: { level: { default: 0, validate: 'number' } }, // 1 to 6 for a toggle heading, 0 for a plain toggle
  parseDOM: [{ tag: 'div[data-type="toggle-summary"]', getAttrs: (dom) => ({ level: Number((dom as HTMLElement).dataset.level) || 0 }) }],
  toDOM: (node) => ['div', { class: 'toggle-summary', 'data-type': 'toggle-summary', ...(node.attrs.level ? { 'data-level': String(node.attrs.level) } : null) }, 0],
  parseMarkdown: {
    match: (node) => node.type === 'toggleSummary',
    runner: (state, node, type) => { state.openNode(type, { level: (node.level as number) || 0 }); if (node.value) state.addText(node.value as string); state.closeNode(); },
  },
  toMarkdown: { match: (node) => node.type.name === 'toggle_summary', runner: () => { /* written by its toggle */ } },
}));

/** A title's words, without the #s it shows while the caret is in it. */
function titleText(summary: PMNode) {
  let text = '';
  summary.forEach((child) => { if (child.isText && !child.marks.some((mark) => mark.type.name === 'hash')) text += child.text; });
  return text;
}
/** The level a block opens a section at: a heading's, or a toggle heading's. 0 for anything else. */
function levelOf(block: PMNode): number {
  if (block.type.name === 'heading') return block.attrs.level as number;
  if (block.type.name === 'toggle' && block.firstChild?.type.name === 'toggle_summary') return (block.firstChild.attrs.level as number) || 0;
  return 0;
}

// ---------------------------------------------------------------------------------------------------------
// Typing.

/** The toggle whose title the caret is in. */
function titleOf(state: EditorState) {
  const { $from } = state.selection;
  if ($from.parent.type.name !== 'toggle_summary' || $from.depth < 2) return null;
  const depth = $from.depth - 1;
  return { toggle: $from.node(depth), at: $from.before(depth) };
}

/** Enter in a toggle's title: into the toggle when it is open, on to a new toggle below when it is closed.
 *  A toggle with nothing in it goes back to an ordinary line. */
export const toggleEnter: Cmd = (state, dispatch) => {
  const here = titleOf(state);
  const { paragraph, toggle, toggle_summary: summary } = state.schema.nodes;
  if (!here || !state.selection.empty || !paragraph || !toggle || !summary) return false;
  if (!dispatch) return true;
  const { $from } = state.selection;
  const tr = state.tr;
  const rest = $from.parent.textContent.slice($from.parentOffset);
  const text = rest ? state.schema.text(rest) : null;
  if (!$from.parent.content.size && here.toggle.childCount === 1) {
    tr.replaceWith(here.at, here.at + here.toggle.nodeSize, paragraph.create());
    tr.setSelection(TextSelection.create(tr.doc, here.at + 1));
  } else if (here.toggle.attrs.open) {
    // What a toggle holds is notes: bullets, unless the toggle is itself a sub-note of a numbered list, whose
    // numbering it carries on one step further round (1. a. i. ■, in the CSS).
    tr.delete($from.pos, $from.end());
    const { bullet_list: bullets, ordered_list: numbers, list_item: item } = state.schema.nodes;
    let ordered = false;
    for (let d = $from.depth - 2; d > 0; d--) {
      const name = $from.node(d).type.name;
      if (name === 'ordered_list' || name === 'bullet_list') { ordered = name === 'ordered_list'; break; }
    }
    const note = item.create({ listType: ordered ? 'ordered' : 'bullet', label: ordered ? '1.' : '•', spread: false }, paragraph.create(null, text));
    const into = $from.pos + 1; // straight after the title
    const next = tr.doc.nodeAt(into);
    if (next && next.type === (ordered ? numbers : bullets)) {
      tr.insert(into + 1, note);
      tr.setSelection(TextSelection.create(tr.doc, into + 3));
    } else {
      tr.insert(into, ordered ? numbers.create({ order: 1 }, note) : bullets.create(null, note));
      tr.setSelection(TextSelection.create(tr.doc, into + 3));
    }
  } else {
    tr.delete($from.pos, $from.end());
    const below = here.at + here.toggle.nodeSize - rest.length;
    tr.insert(below, toggle.create({ open: true }, summary.create(null, text)));
    tr.setSelection(TextSelection.create(tr.doc, below + 2));
  }
  dispatch(tr.scrollIntoView());
  return true;
};

/** Backspace at the start of a toggle's title takes the toggle away: its title and what it held become ordinary lines.
 *  A toggle heading's title (the start is in front of its #s) is left as the heading it was. */
export const toggleBackspace: Cmd = (state, dispatch) => {
  const here = titleOf(state);
  const { paragraph, heading } = state.schema.nodes;
  if (!here || !state.selection.empty || state.selection.$from.parentOffset > 0 || !paragraph) return false;
  if (!dispatch) return true;
  const nodes: PMNode[] = [];
  const $at = state.doc.resolve(here.at);
  here.toggle.forEach((child, _offset, i) => {
    if (i) { nodes.push(child); return; }
    const title = titleText(child);
    const words = title ? state.schema.text(title) : null;
    const headed = child.attrs.level && heading && $at.parent.canReplaceWith($at.index(), $at.index() + 1, heading);
    nodes.push(headed ? heading.create({ level: child.attrs.level }, words) : paragraph.create(null, words));
  });
  const tr = state.tr.replaceWith(here.at, here.at + here.toggle.nodeSize, nodes);
  dispatch(tr.setSelection(TextSelection.create(tr.doc, here.at + 1)).scrollIntoView());
  return true;
};

/** ⌘Enter in a toggle's title opens or closes it. */
export const toggleOpen: Cmd = (state, dispatch) => {
  const here = titleOf(state);
  if (!here) return false;
  if (dispatch) dispatch(state.tr.setNodeMarkup(here.at, undefined, { ...here.toggle.attrs, open: !here.toggle.attrs.open }));
  return true;
};

/** A press on a toggle's arrow (the space left of its title) opens or closes it. True when it was on one. */
export function toggleClick(view: EditorView, event: MouseEvent) {
  const el = event.target as HTMLElement;
  if (!view.editable || !el.classList?.contains('toggle')) return false; // the toggle's own box: its text is in elements inside it
  const title = el.firstElementChild?.getBoundingClientRect();
  if (!title || event.clientX > title.left || event.clientY < title.top || event.clientY > title.bottom) return false;
  const $in = view.state.doc.resolve(view.posAtDOM(el, 0));
  for (let d = $in.depth; d > 0; d--) {
    const node = $in.node(d);
    if (node.type.name !== 'toggle') continue;
    view.dispatch(view.state.tr.setNodeMarkup($in.before(d), undefined, { ...node.attrs, open: !node.attrs.open }));
    return true;
  }
  return false;
}

/** Enter in a ticked to-do: the to-do it makes starts unticked. (At the very start of the line the empty to-do
 *  goes above, so that is the unticked one and the text keeps its tick.) */
export const taskEnter: Cmd = (state, dispatch) => {
  const { $from, $to } = state.selection;
  const item = $from.depth > 1 ? $from.node(-1) : null;
  if (!item || item.type.name !== 'list_item' || item.attrs.checked !== true || !$from.sameParent($to) || !$from.parent.content.size) return false;
  const above = state.selection.empty && $from.parentOffset === 0;
  return splitListItem(item.type, { ...item.attrs, checked: false })(state, dispatch && ((tr) => {
    if (above) {
      tr.setNodeMarkup($from.before(-1), undefined, { ...item.attrs, checked: false });
      tr.setNodeMarkup(tr.selection.$from.before(-1), undefined, item.attrs);
    }
    dispatch(tr);
  }));
};

/** The list item whose first line starts at `$start`, with the list it is in. */
function itemAt($start: ResolvedPos) {
  const d = $start.depth - 1;
  if (d < 2 || $start.parent.type.name !== 'paragraph' || $start.node(d).type.name !== 'list_item' || $start.index(d) !== 0) return null;
  return { item: $start.node(d), list: $start.node(d - 1), listAt: $start.before(d - 1), index: $start.index(d - 1), holder: $start.node(d - 2), holderIndex: $start.index(d - 2) };
}
/** A list just put at `at` joins a list of its own kind straight after or before it. */
function joinLists(tr: Transaction, at: number) {
  const list = tr.doc.nodeAt(at);
  if (!list) return;
  const end = at + list.nodeSize;
  if (tr.doc.resolve(end).nodeAfter?.type === list.type && canJoin(tr.doc, end)) tr.join(end);
  if (tr.doc.resolve(at).nodeBefore?.type === list.type && canJoin(tr.doc, at)) tr.join(at);
}

// Notes: a bullet, a to-do and a numbered item are three kinds of the same thing, and any of them becomes another
// when that kind's mark and a space are typed where its words begin: "- " (or "* "), "[] " and "1. ". One rule
// says how far the change reaches:
//
//   the note itself, everything nested under it, and every note after it on its own layer with what is nested
//   under those, as far as the next thing that is not one of these notes (a toggle, a paragraph, a heading).
//
// A toggle is not one of them. "> " makes the one note it is typed on a toggle, and a mark typed in a toggle's
// title makes that toggle alone a note; what either holds stays as it was. (What a toggle holds is bullets by
// default: `toggleEnter`.)
//
// What comes before it on the layer stays as it was. A note's own mark typed again is just the characters.
// To-dos keep their ticks when they stay to-dos, and start unticked when they become to-dos; a number list
// counts from the number typed, or carries on from a numbered list straight above it.
type Kind = 'bullet' | 'todo' | 'number' | 'toggle';
/** A note taken apart: its first line, what else it holds, and its tick if it is a to-do. */
interface Entry { head: Fragment; rest: PMNode[]; checked: boolean | null; attrs: Record<string, unknown> }
const isList = (node: PMNode) => node.type.name === 'bullet_list' || node.type.name === 'ordered_list';
const isToggle = (node: PMNode) => node.type.name === 'toggle';
function entryOf(note: PMNode): Entry {
  const rest: PMNode[] = [];
  note.forEach((child, _offset, i) => { if (i) rest.push(child); });
  return { head: note.firstChild!.content, rest, checked: isToggle(note) ? null : (note.attrs.checked as boolean | null) ?? null, attrs: isToggle(note) ? {} : note.attrs };
}
/** The notes written as `kind`: one list holding them all, or a toggle for each. */
function build(schema: EditorState['schema'], kind: Kind, entries: Entry[], order = 1): PMNode[] {
  const { bullet_list: bullets, ordered_list: numbers, list_item: item, paragraph, toggle, toggle_summary: summary } = schema.nodes;
  if (kind === 'toggle') {
    // A toggle's title is plain words.
    return entries.map((e) => { const title = e.head.textBetween(0, e.head.size, '', ''); return toggle.create({ open: true }, [summary.create(null, title ? schema.text(title) : null), ...e.rest]); });
  }
  const items = entries.map((e, i) => item.create({
    ...e.attrs, checked: kind === 'todo' ? e.checked ?? false : null,
    listType: kind === 'number' ? 'ordered' : 'bullet', label: kind === 'number' ? `${order + i}.` : '•',
  }, [paragraph.create(null, e.head), ...e.rest]));
  return [kind === 'number' ? numbers.create({ order }, items) : bullets.create(null, items)];
}
/** `blocks` with every note among them, and under those, written as `kind`. Anything else is left as it is. */
function under(schema: EditorState['schema'], kind: Kind, blocks: PMNode[]): PMNode[] {
  const out: PMNode[] = [];
  let run: Entry[] = [];
  const flush = () => { if (run.length) { out.push(...build(schema, kind, run)); run = []; } };
  const deep = (note: PMNode) => { const e = entryOf(note); run.push({ ...e, rest: under(schema, kind, e.rest) }); };
  for (const block of blocks) {
    if (isList(block)) block.forEach(deep);
    else { flush(); out.push(block); } // a toggle (or anything else) stays as it is
  }
  flush();
  return out;
}
/** The note whose words begin at `start` becomes `kind`, with what the rule above takes along. The mark just
 *  typed, from `start` to `end`, is taken out. Null when the caret is not at the start of a note, or the note is
 *  that kind already. */
function retype(state: EditorState, start: number, end: number, kind: Kind, opts: { order?: number; checked?: boolean } = {}) {
  const tr = state.tr.delete(start, end);
  const $start = tr.doc.resolve(start);
  const here = itemAt($start);
  const notes: PMNode[] = [];
  let holder: PMNode;
  let first: number; // which of the holder's blocks the note is in
  let from: number;  // where that block starts
  let kept: PMNode | null = null; // the items before the note, which stay a list of the kind they were
  let after: PMNode | null = null; // for a toggle, the items after it, which do too
  // A toggle stands apart from the other kinds: a note becomes one, or one becomes a note, by itself, and what it
  // holds stays as it was.
  const alone = kind === 'toggle' || $start.parent.type.name === 'toggle_summary';
  if (here) {
    const was: Kind = here.list.type.name === 'ordered_list' ? 'number' : here.item.attrs.checked != null ? 'todo' : 'bullet';
    if (was === kind) return null;
    const before: PMNode[] = [];
    const behind: PMNode[] = [];
    here.list.forEach((child, _offset, i) => { if (i < here.index) before.push(child); else if (i === here.index || !alone) notes.push(child); else behind.push(child); });
    if (before.length) kept = here.list.copy(Fragment.from(before));
    if (behind.length) {
      const order = here.list.attrs.order as number | undefined;
      after = here.list.type.create(typeof order === 'number' ? { ...here.list.attrs, order: order + here.index + 1 } : here.list.attrs, behind);
    }
    holder = here.holder; first = here.holderIndex; from = here.listAt;
  } else if ($start.parent.type.name === 'toggle_summary' && $start.depth >= 2) {
    if (kind === 'toggle') return null;
    const depth = $start.depth - 1;
    notes.push($start.node(depth));
    holder = $start.node(depth - 1); first = $start.index(depth - 1); from = $start.before(depth);
  } else return null;
  // The notes after it on the layer (but not toggles), up to the first thing that is not a note.
  let to = from + holder.child(first).nodeSize;
  let last = first + 1;
  for (; !alone && last < holder.childCount; last++) {
    const block = holder.child(last);
    if (isList(block)) block.forEach((child) => { notes.push(child); });
    else break;
    to += block.nodeSize;
  }
  const entries = notes.map((note) => { const e = entryOf(note); return alone ? e : { ...e, rest: under(state.schema, kind, e.rest) }; });
  if (kind === 'todo') entries[0].checked = opts.checked ?? false;
  const made = build(state.schema, kind, entries, opts.order ?? 1);
  const blocks = [...(kept ? [kept] : []), ...made, ...(after ? [after] : [])];
  if (!holder.canReplace(first, last, Fragment.from(blocks))) return null;
  tr.replaceWith(from, to, blocks);
  const at = from + (kept?.nodeSize ?? 0);
  tr.setSelection(TextSelection.create(tr.doc, at + (kind === 'toggle' ? 2 : 3)));
  if (kind !== 'toggle') joinLists(tr, at);
  return tr;
}

/** Where one list ends and another of its own kind begins straight after it, anywhere in `doc`. */
function seams(doc: PMNode) {
  const out: number[] = [];
  const walk = (node: PMNode, start: number) => {
    let pos = start;
    let before: PMNode | null = null;
    node.forEach((child) => {
      if (before && isList(child) && before.type === child.type) out.push(pos);
      if (!child.isTextblock && !child.isLeaf) walk(child, pos + 1);
      before = child;
      pos += child.nodeSize;
    });
  };
  walk(doc, 0);
  return out;
}
// Two lists of one kind never sit one straight after the other: an edit that would leave them so (a bullet started
// just above a list, the line between two lists deleted) makes them one list. Otherwise they would look like one
// list with a gap in it, and be written to the file as two, the second with a different mark. Lists that were
// already apart when the file was read are left alone, as is anything an undo brings back.
export const joinNotes = $prose(() => new Plugin({
  appendTransaction(trs, old, state) {
    if (!trs.some((tr) => tr.docChanged) || trs.some((tr) => tr.getMeta('history$') || tr.getMeta('addToHistory') === false)) return null;
    const now = seams(state.doc);
    if (!now.length) return null;
    const were = new Set(seams(old.doc).map((pos) => trs.reduce((p, tr) => tr.mapping.map(p), pos)));
    const fresh = now.filter((pos) => !were.has(pos));
    if (!fresh.length) return null;
    const tr = state.tr;
    for (const pos of fresh.reverse()) if (canJoin(tr.doc, pos)) tr.join(pos);
    return tr.steps.length ? tr : null;
  },
}));

/** Puts a toggle heading in place of the block that starts at `at`: a title of `level` saying `title`, holding
 *  `own` and then its section, which is everything after it on its layer as far as the next heading (or toggle
 *  heading) of its level or above. The caret goes to the start of the title, and with `live` its #s go on show,
 *  as for a heading being typed. Null where a toggle cannot go. */
function toggleHeading(state: EditorState, at: number, level: number, title: string, live: boolean, own: PMNode[] = [], open = true) {
  const { toggle, toggle_summary: summary } = state.schema.nodes;
  if (!toggle || !summary) return null;
  const $at = state.doc.resolve(at);
  const holder = $at.parent;
  const index = $at.index();
  let last = index + 1;
  let to = at + holder.child(index).nodeSize;
  const section: PMNode[] = [];
  for (; last < holder.childCount; last++) {
    const block = holder.child(last);
    const l = levelOf(block);
    if (l && l <= level) break;
    section.push(block);
    to += block.nodeSize;
  }
  if (!holder.canReplaceWith(index, last, toggle)) return null;
  const tr = state.tr.replaceWith(at, to, toggle.create({ open }, [summary.create({ level }, title ? state.schema.text(title) : null), ...own, ...section]));
  tr.setSelection(TextSelection.create(tr.doc, at + 2));
  return live ? showHashes(tr) : tr;
}
/** What a toggle holds under its title. */
const heldBy = (toggle: PMNode) => { const out: PMNode[] = []; toggle.forEach((child, _offset, i) => { if (i) out.push(child); }); return out; };
const HEADED = /^(#{1,6}) (.*)$/s;

/** The typing rules. They go after the bracket pairs, which first take away the ] they put in. */
export const notionRules = $prose(() => inputRules({ rules: [
  // [] (or [ ] or [x]) and a space opening a line: a to-do. On a note of another kind, see `retype`; any other
  // line becomes a list of one.
  new InputRule(/^\[([ xX]?)\]\s$/, (state, match, start, end) => {
    const checked = match[1].toLowerCase() === 'x';
    const changed = retype(state, start, end, 'todo', { checked });
    if (changed) return changed;
    const $start = state.doc.resolve(start);
    const { bullet_list: list, list_item: item } = state.schema.nodes;
    if ($start.parent.type.name !== 'paragraph' || !list || !item || itemAt($start)) return null;
    const tr = state.tr.delete(start, end);
    const range = tr.doc.resolve(start).blockRange();
    const wrapping = range && findWrapping(range, list);
    if (!range || !wrapping) return null;
    tr.wrap(range, wrapping);
    const at = $start.before();
    const made = tr.doc.nodeAt(at + 1);
    if (made?.type !== item) return null;
    tr.setNodeMarkup(at + 1, undefined, { ...made.attrs, checked });
    // Straight under a list of bullets or to-dos, it joins that list.
    if (tr.doc.resolve(at).nodeBefore?.type === list && canJoin(tr.doc, at)) tr.join(at);
    return tr;
  }),
  // - (or * or +) and a space: a bullet. (On an ordinary line the bullet list is Milkdown's own rule.)
  new InputRule(/^[-+*]\s$/, (state, _match, start, end) => retype(state, start, end, 'bullet')),
  // A number, a full stop and a space: a numbered item, counting from that number. (On an ordinary line, Milkdown's own rule.)
  new InputRule(/^(\d{1,9})\.\s$/, (state, match, start, end) => retype(state, start, end, 'number', { order: Number(match[1]) })),
  // > and a space: a toggle, with the rest of the line as its title. In front of a heading's #s (the line then
  // reads "> ## words"), a toggle heading.
  new InputRule(/^>\s$/, (state, _match, start, end) => {
    const changed = retype(state, start, end, 'toggle');
    if (changed) return changed;
    const $start = state.doc.resolve(start);
    const { toggle, toggle_summary: summary } = state.schema.nodes;
    const rest = $start.parent.textContent.slice(end - $start.start());
    const headed = HEADED.exec(rest);
    // Typed in a toggle heading's own title, in front of its #s or of its words, it changes nothing.
    if ($start.parent.type.name === 'toggle_summary' && headed && $start.depth >= 2) {
      const held = $start.node($start.depth - 1);
      return toggleHeading(state, $start.before($start.depth - 1), headed[1].length, headed[2], true, heldBy(held), held.attrs.open);
    }
    if ($start.parent.type.name === 'toggle_summary' && $start.parent.attrs.level) return state.tr.delete(start, end);
    // Where the words of a heading made earlier begin (its #s are not on show): a toggle heading of its level.
    if ($start.parent.type.name === 'heading') return toggleHeading(state, $start.before(), $start.parent.attrs.level, HEADED.exec(rest)?.[2] ?? rest, false);
    if ($start.parent.type.name !== 'paragraph' || !toggle || !summary || itemAt($start)) return null;
    if (headed) return toggleHeading(state, $start.before(), headed[1].length, headed[2], true);
    const index = $start.index($start.depth - 1);
    if (!$start.node($start.depth - 1).canReplaceWith(index, index + 1, toggle)) return null;
    const at = $start.before();
    const tr = state.tr.replaceWith(at, $start.after(), toggle.create({ open: true }, summary.create(null, rest ? state.schema.text(rest) : null)));
    return tr.setSelection(TextSelection.create(tr.doc, at + 2));
  }),
  // > and a space straight after a heading's #s ("## > words"): a toggle heading, the same as with the > in front.
  new InputRule(/^(#{1,6}) >\s$/, (state, match, start, end) => {
    const $start = state.doc.resolve(start);
    const parent = $start.parent;
    const rest = parent.textContent.slice(end - $start.start());
    if (parent.type.name === 'heading' && parent.attrs.level === match[1].length) return toggleHeading(state, $start.before(), match[1].length, rest, true);
    // In a toggle heading's own title there is nothing to change: the > is not kept.
    if (parent.type.name === 'toggle_summary' && parent.attrs.level === match[1].length) return state.tr.delete(end - 1, end);
    return null;
  }),
  // #s and a space opening a toggle's title: a toggle heading of that level. In the title of one made earlier
  // they set its level and are not kept (while its #s are on show they are text to edit: richHashes.ts).
  new InputRule(/^(#{1,6})\s$/, (state, match, start, end) => {
    const $start = state.doc.resolve(start);
    const title = $start.parent;
    const level = match[1].length;
    if (title.type.name !== 'toggle_summary' || $start.depth < 2) return null;
    if (title.attrs.level) {
      if (hashesShown(title)) return null;
      const tr = state.tr.delete(start, end);
      return title.attrs.level === level ? tr : tr.setNodeMarkup($start.before(), undefined, { ...title.attrs, level });
    }
    const held = $start.node($start.depth - 1);
    return toggleHeading(state, $start.before($start.depth - 1), level, title.textContent.slice(end - $start.start()), true, heldBy(held), held.attrs.open);
  }),
  // " and a space opening a line: a quote (> is the toggle's, as in Notion).
  new InputRule(/^"\s$/, (state, _match, start, end) => {
    const quote = state.schema.nodes.blockquote;
    if (state.doc.resolve(start).parent.type.name !== 'paragraph' || !quote) return null;
    const tr = state.tr.delete(start, end);
    const range = tr.doc.resolve(start).blockRange();
    const wrapping = range && findWrapping(range, quote);
    return range && wrapping ? tr.wrap(range, wrapping) : null;
  }),
] }));

/** How deep the closed toggle is that hides this place, or -1 when the place can be seen. */
function hiddenIn($pos: ResolvedPos) {
  for (let d = 1; d <= $pos.depth; d++) {
    const node = $pos.node(d);
    if (node.type.name === 'toggle' && !node.attrs.open && $pos.index(d) > 0) return d;
  }
  return -1;
}
// The caret never rests inside a closed toggle: going down it steps past, otherwise it stops at the end of the title.
const skipClosed = $prose(() => new Plugin({
  appendTransaction(trs, oldState, newState) {
    const sel = newState.selection;
    if (!sel.empty || !trs.some((tr) => tr.selectionSet || tr.docChanged)) return null;
    const depth = hiddenIn(sel.$head);
    if (depth < 0) return null;
    let was = oldState.selection.head;
    for (const tr of trs) was = tr.mapping.map(was);
    const title = sel.$head.node(depth).firstChild;
    let next: Selection | null = sel.head > was ? Selection.findFrom(newState.doc.resolve(sel.$head.after(depth)), 1, true) : null;
    if (next && hiddenIn(next.$head) >= 0) next = null;
    if (!next && title) next = TextSelection.create(newState.doc, sel.$head.start(depth) + 1 + title.content.size);
    return next ? newState.tr.setSelection(next) : null;
  },
}));

/** The toggle itself, to add to the editor after its presets. */
export const notion = [toggleSummaryNode, toggleNode, toggleView, remarkToggle, skipClosed].flat();
