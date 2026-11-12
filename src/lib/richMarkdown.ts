// The editable rendered view for Markdown files. The Monaco text model stays
// the single source of truth: this view reads from it, and writes the whole
// document back to it after each edit made here.
import { defaultValueCtx, Editor, editorViewCtx, editorViewOptionsCtx, parserCtx, remarkCtx, remarkStringifyOptionsCtx, rootCtx, serializerCtx } from '@milkdown/kit/core';
import { commonmark, wrapInBlockquoteInputRule } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { clipboard } from '@milkdown/kit/plugin/clipboard';
import { history } from '@milkdown/kit/plugin/history';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import { InputRule, inputRules } from '@milkdown/kit/prose/inputrules';
import { keymap } from '@milkdown/kit/prose/keymap';
import { Plugin, PluginKey, Selection, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorState, Transaction } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import type { EditorView } from '@milkdown/kit/prose/view';
import { Fragment } from '@milkdown/kit/prose/model';
import type { Node as PMNode } from '@milkdown/kit/prose/model';
import { canJoin } from '@milkdown/kit/prose/transform';
import { $prose, getMarkdown, insert } from '@milkdown/kit/utils';
import '@milkdown/kit/prose/view/style/prosemirror.css';
import type * as monacoNs from 'monaco-editor';
import { appInfo, dirname } from './api';
import { openLink } from './links';
import { emojiFor } from './monaco';
import { caret, copyLines, deleteLines, lineBelow, moveLines, pairs, selectLines } from './richEditing';
import type { Cmd } from './richEditing';
import { notion, notionRules, toggleBackspace, toggleClick, toggleEnter, toggleMarks, toggleOpen } from './richNotion';
import { symbolRules } from './richSymbols';

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;
function split(text: string) {
  const m = FRONTMATTER.exec(text);
  return m ? { front: m[0], body: text.slice(m[0].length) } : { front: '', body: text };
}
/** Letters and digits only: equal fingerprints mean no words were lost between two versions. Left out is what
 *  the two may fairly differ in: a list's numbers (written 1. 1. 1., read 1. 2. 3.), an address that is also its
 *  own link text (written twice or once), and the stand-ins for an empty line and a space at a line's edge. */
const fingerprint = (md: string) => md.replace(/<br\s*\/?>|&#x?[0-9a-f]+;/gi, '').replace(/(?:https?:\/\/|mailto:)[^\s<>()[\]]+/g, '').replace(/^[ \t>]*(?:[-*+][ \t]+)?\d+\\?[.)](?=\s|$)/gm, '').replace(/[^\p{L}\p{N}]+/gu, '');
// The serializer escapes brackets it thinks could start a link, which breaks [[wiki links]] and ![[embeds]].
const unescapeWiki = (md: string) => md.replace(/\\\[\\\[([^\]\n]*)\]\]/g, '[[$1]]').replace(/\\\[\[([^\]\n]*)\]\]/g, '[[$1]]');

/** Set by the app: called when a line holding only "/file" is entered. */
export const richHooks: { attach: (() => void) | null } = { attach: null };
const slashFile: Cmd = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.isTextblock || $from.parent.textContent.trim() !== '/file') return false;
  if (dispatch) dispatch(state.tr.delete($from.start(), $from.end()));
  richHooks.attach?.();
  return true;
};
/** How long a box takes to fill in or empty out; the same as `task-fill` in styles.css. */
const TICK_MS = 140;
const tickKey = new PluginKey<DecorationSet>('astrolabe-tick');
/** Ticks or unticks the task at `pos`, and marks it so its box fills in or empties out. */
function flipTask(state: EditorState, pos: number, node: PMNode): Transaction {
  const checked = !node.attrs.checked;
  return state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked }).setMeta(tickKey, { pos, checked });
}
// A task that has just changed is drawn afresh, so the motion cannot be a CSS transition: the new item carries a class for a moment instead.
const tickMotion = $prose(() => new Plugin<DecorationSet>({
  key: tickKey,
  state: {
    init: () => DecorationSet.empty,
    apply(tr, set) {
      const meta = tr.getMeta(tickKey) as { pos: number; checked: boolean } | 'done' | undefined;
      if (meta === 'done') return DecorationSet.empty;
      if (!meta) return set === DecorationSet.empty ? set : set.map(tr.mapping, tr.doc);
      const node = tr.doc.nodeAt(meta.pos);
      return node ? DecorationSet.create(tr.doc, [Decoration.node(meta.pos, meta.pos + node.nodeSize, { class: meta.checked ? 'is-ticking' : 'is-unticking' })]) : DecorationSet.empty;
    },
  },
  props: { decorations: (state) => tickKey.getState(state) },
  view: () => {
    let timer = 0;
    return {
      update(view, prev) {
        const now = tickKey.getState(view.state);
        if (!now || now === DecorationSet.empty || now === tickKey.getState(prev)) return;
        window.clearTimeout(timer);
        timer = window.setTimeout(() => { if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(tickKey, 'done')); }, TICK_MS + 60);
      },
      destroy() { window.clearTimeout(timer); },
    };
  },
}));
/** ⌘Enter ticks or unticks the task the caret is in. */
const toggleTask: Cmd = (state, dispatch) => {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name !== 'list_item') continue;
    if (node.attrs.checked == null) return false;
    if (dispatch) dispatch(flipTask(state, $from.before(d), node));
    return true;
  }
  return false;
};
/** Backspace in a heading with no text left makes it an ordinary line at once, rather than stepping down a level per press. */
const clearHeading: Cmd = (state, dispatch) => {
  const { $from, empty } = state.selection;
  const paragraph = state.schema.nodes.paragraph;
  if (!empty || $from.parent.type.name !== 'heading' || $from.parent.content.size > 0 || !paragraph) return false;
  if (dispatch) dispatch(state.tr.setBlockType($from.before(), $from.after(), paragraph));
  return true;
};
const ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+|$)/;
const cols = (ws: string) => { let w = 0; for (const ch of ws) w += ch === '\t' ? 4 - (w % 4) : 1; return w; };
/** Markdown only nests an item that is indented as far as its parent's text, so two spaces under "1. " leave it
 *  flat. This moves such lines in under the item they sit beneath, so they nest as they were meant to. Only
 *  what this view reads changes: the file stays as written until it is edited here. */
export function relaxLists(md: string) {
  if (!/^[ \t]+([-*+]|\d{1,9}[.)])[ \t]/m.test(md)) return md;
  const open: { indent: number; content: number; to: number }[] = []; // items above; `to` is where an item's text starts once moved
  let fence: { mark: string; add: number } | null = null;
  return md.split('\n').map((line) => {
    if (fence) {
      const closes = new RegExp(`^[ \\t]*${fence.mark[0]}{${fence.mark.length},}[ \\t]*$`).test(line);
      const out = fence.add && line.trim() ? ' '.repeat(fence.add) + line : line;
      if (closes) fence = null;
      return out;
    }
    if (!line.trim()) return line;
    const ws = /^[ \t]*/.exec(line)![0];
    const indent = cols(ws);
    const rest = line.slice(ws.length);
    const item = ITEM.exec(line);
    if (!item && !indent) open.length = 0;
    // A line belongs to the nearest item above that it sits inside: by two columns or more for an item, at all for other text.
    while (open.length && open[open.length - 1].indent > indent - (item ? 2 : 1)) open.pop();
    const top = open[open.length - 1];
    const now = top ? top.to + Math.max(0, indent - top.content) : indent;
    if (item) {
      const gap = cols(item[3]);
      const pad = item[2].length + (gap >= 1 && gap <= 4 ? gap : 1);
      open.push({ indent, content: indent + pad, to: now + pad });
    } else {
      const mark = /^(`{3,}|~{3,})/.exec(rest);
      if (mark) fence = { mark: mark[1], add: now - indent };
    }
    return now === indent ? line : ' '.repeat(now) + rest;
  }).join('\n');
}

// The raw view's line keys: move, copy, delete, select, and a new line below.
const extras = $prose(() => keymap({
  'Alt-ArrowUp': moveLines(-1), 'Alt-ArrowDown': moveLines(1), 'Shift-Alt-ArrowUp': copyLines(-1), 'Shift-Alt-ArrowDown': copyLines(1),
  'Shift-Mod-k': deleteLines, 'Mod-l': selectLines,
  Enter: (state, dispatch) => slashFile(state, dispatch) || toggleEnter(state, dispatch),
  'Mod-Enter': (state, dispatch) => toggleOpen(state, dispatch) || toggleTask(state, dispatch) || lineBelow(state, dispatch),
  Backspace: (state, dispatch) => clearHeading(state, dispatch) || toggleBackspace(state, dispatch),
}));
const emojiRule = $prose(() => inputRules({ rules: [
  new InputRule(/(?:^|[\s(>"'])(:([a-z0-9_+-]+):)$/i, (state, match, _start, end) => {
    const emoji = emojiFor(match[2]);
    return emoji ? state.tr.insertText(emoji, end - match[1].length + 1, end) : null;
  }),
] }));

const LINE_ATTR = 'data-astrolabe-line';
const isList = (node: PMNode) => node.firstChild?.type.name === 'list_item';
/** Puts a line cut with ⌘X back as a whole line above the caret's line, as the raw view does: a list item
 *  becomes an item of the list the caret is in, or a list of its own outside one. */
function pasteLine(view: EditorView, block: PMNode) {
  const { $from } = view.state.selection;
  const tr = view.state.tr;
  let depth = $from.depth;
  const inItem = depth > 1 && $from.node(depth - 1).type.name === 'list_item' && $from.index(depth - 1) === 0;
  if (inItem) depth -= 1;
  if (inItem && isList(block)) tr.insert($from.before(depth), block.firstChild!);
  else {
    // The nearest place above the line that can hold the block, without splitting what the line is in.
    let pos = -1;
    for (let d = depth; d > 0; d--) {
      const index = $from.index(d - 1);
      if ($from.node(d - 1).canReplaceWith(index, index, block.type)) { pos = $from.before(d); break; }
      if (index > 0) break;
    }
    if (pos >= 0) {
      tr.insert(pos, block);
      // A list item pasted straight after a list of its own kind goes back into that list.
      if (isList(block) && tr.doc.resolve(pos).nodeBefore?.type === block.type && canJoin(tr.doc, pos)) tr.join(pos);
    } else if (inItem && block.type.name === 'paragraph') {
      const item = $from.node(depth);
      tr.insert($from.before(depth), item.type.create({ ...item.attrs, checked: item.attrs.checked == null ? null : false }, block));
    } else return false;
  }
  view.dispatch(tr.scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste'));
  return true;
}

/** ⌘X with nothing selected cuts the line the caret is on, as in the raw view: a list item (with anything
 *  nested under it), one line of a code block, or else the paragraph or heading. ⌘C copies it the same way. */
const cutLine = $prose((ctx) => {
  const putLine = (view: EditorView, event: ClipboardEvent) => {
        const { $from, empty } = view.state.selection;
        const html = event.clipboardData?.getData('text/html') ?? '';
        if (!empty || !view.editable || !html.includes(LINE_ATTR) || !$from.parent.isTextblock || $from.parent.type.spec.code) return false;
        try {
          const json = new DOMParser().parseFromString(html, 'text/html').querySelector(`[${LINE_ATTR}]`)?.getAttribute(LINE_ATTR);
          const block = json ? view.state.schema.nodeFromJSON(JSON.parse(json)) : null;
          if (!block) return false;
          block.check();
          if (!pasteLine(view, block)) return false;
        } catch { return false; } // not a line this note can hold: paste it the ordinary way
        event.preventDefault();
        return true;
  };
  const takeLine = (view: EditorView, event: ClipboardEvent, remove: boolean) => {
        const { state } = view;
        const { $from, empty } = state.selection;
        const data = event.clipboardData;
        if (!empty || !view.editable || !data || $from.depth < 1 || !$from.parent.isTextblock) return false;
        const tr = state.tr;
        let text: string;
        let html = '';
        if ($from.parent.type.spec.code) {
          const code = $from.parent.textContent;
          const off = $from.parentOffset;
          const a = off ? code.lastIndexOf('\n', off - 1) + 1 : 0;
          const b = code.indexOf('\n', off);
          text = `${code.slice(a, b < 0 ? code.length : b)}\n`;
          // The line goes with its line break: the one after it, or for the last line the one before.
          const from = $from.start() + (b < 0 && a > 0 ? a - 1 : a);
          tr.delete(from, $from.start() + (b < 0 ? code.length : b + 1));
          tr.setSelection(TextSelection.create(tr.doc, from));
        } else {
          let depth = $from.depth;
          if (['list_item', 'toggle'].includes($from.node(depth - 1).type.name) && $from.index(depth - 1) === 0) depth -= 1; // an item's or a toggle's first line stands for all of it
          const node = $from.node(depth);
          const from = $from.before(depth);
          const to = $from.after(depth);
          // As plain text the line is Markdown; a list item keeps its marker by being written inside its list.
          const block = node.type.name === 'list_item' ? $from.node(depth - 1).copy(Fragment.from(node)) : node;
          // ...and a numbered one its own number.
          const order = block.attrs.order;
          const shown = block !== node && typeof order === 'number' ? block.type.create({ ...block.attrs, order: order + $from.index(depth - 1) }, node) : block;
          const doc = state.schema.topNodeType.createAndFill(undefined, shown);
          const blank = node.isTextblock ? node.content.size === 0 : node.childCount === 1 && node.firstChild!.content.size === 0;
          text = blank ? '' : doc ? unescapeWiki(ctx.get(serializerCtx)(doc)) : `${node.textContent}\n`;
          const { dom } = view.serializeForClipboard(state.doc.slice(from, to));
          dom.firstElementChild?.setAttribute(LINE_ATTR, JSON.stringify(block.toJSON())); // lets a paste here put the whole line back
          html = dom.innerHTML;
          tr.deleteRange(from, to); // also removes a list or quote this leaves empty
          tr.setSelection(Selection.near(tr.doc.resolve(Math.min(tr.mapping.map(from), tr.doc.content.size)), 1));
        }
        event.preventDefault();
        // An empty line is just removed, leaving the clipboard as it was.
        if (text) {
          data.clearData();
          if (html) data.setData('text/html', html);
          data.setData('text/plain', text);
        }
        if (remove) view.dispatch(tr.scrollIntoView().setMeta('uiEvent', 'cut'));
        return true;
  };
  return new Plugin({
    props: {
      handleDOMEvents: {
        paste: putLine,
        cut: (view: EditorView, event: ClipboardEvent) => takeLine(view, event, true),
        copy: (view: EditorView, event: ClipboardEvent) => takeLine(view, event, false),
      },
    },
  });
});

/** A click on a task's checkbox itself (not its text) ticks or unticks that task. */
function tickAt(view: EditorView, event: MouseEvent) {
  const li = (event.target as HTMLElement).closest('li[data-item-type="task"]') as HTMLElement | null;
  if (!li || !view.editable) return false;
  const box = getComputedStyle(li, '::before');
  const at = li.getBoundingClientRect();
  const edge = box.boxSizing === 'border-box' ? 0 : parseFloat(box.borderLeftWidth) * 2;
  const x = event.clientX - at.left - parseFloat(box.left);
  const y = event.clientY - at.top - parseFloat(box.top);
  const SLOP = 3;
  if (!(x >= -SLOP && x <= parseFloat(box.width) + edge + SLOP && y >= -SLOP && y <= parseFloat(box.height) + edge + SLOP)) return false;
  // The task is the one whose box was hit: a point left of the text does not reliably resolve to its own item.
  const $in = view.state.doc.resolve(view.posAtDOM(li, 0));
  for (let d = $in.depth; d > 0; d--) {
    const node = $in.node(d);
    if (node.type.name !== 'list_item') continue;
    if (node.attrs.checked == null) return false;
    view.dispatch(flipTask(view.state, $in.before(d), node));
    return true;
  }
  return false;
}

const clicks = $prose(() => new Plugin({
  props: {
    // Quick repeated clicks on a box arrive as double and triple clicks.
    handleDoubleClick: (view: EditorView, _pos: number, event: MouseEvent) => tickAt(view, event) || toggleClick(view, event),
    handleTripleClick: (view: EditorView, _pos: number, event: MouseEvent) => tickAt(view, event) || toggleClick(view, event),
    handleClick(view: EditorView, _pos: number, event: MouseEvent) {
      const target = event.target as HTMLElement;
      if (tickAt(view, event) || toggleClick(view, event)) return true;
      const a = target.closest('a') as HTMLAnchorElement | null;
      if (a && event.metaKey) {
        // Web links open in the browser; links to files open in the editor, relative to this note.
        const file = (view.dom.closest('[data-file]') as HTMLElement | null)?.dataset.file;
        void openLink(a.getAttribute('href') ?? '', file ? dirname(file) : appInfo.home);
        return true;
      }
      return false;
    },
  },
}));

export interface RichHandle { focus(): void; focusEnd(): void; destroy(): void; insertMarkdown(md: string): void; readOnly: boolean }

/** The language tag of a block shown as its Markdown source, for text the rendered view has no way to show. */
const SOURCE = 'astrolabe:source';
const SOURCE_BLOCK = /^(`{3,})astrolabe:source[ \t]*\n(?:([\s\S]*?)\n)?\1[ \t]*$/gm;
/** One stretch of the file and the blocks it shows as: the bridge between the raw text and the rendered note. */
interface Seg { src: string; nodes: PMNode[] }
const endsBlank = (text: string) => /\n[ \t]*\r?\n[ \t]*$/.test(text);
/** With a blank line after it, so the next block cannot run into it. */
const spaced = (text: string) => (!text || endsBlank(text) ? text : `${text.replace(/[ \t]*(\r?\n)?$/, '')}\n\n`);

export async function mountRich(root: HTMLElement, model: monacoNs.editor.ITextModel, onReadOnly: (reason: string | null) => void): Promise<RichHandle> {
  root.dataset.file = model.uri.path; // relative links in the note resolve from its folder
  let front = '';
  let applying = false;      // true while this view is being updated from the model
  let lastWritten: string | null = null;
  const readOnly = false;    // every note can be edited here: what cannot be shown rendered is shown as source
  let destroyed = false;
  let save = () => {};

  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, '');
      // Write Markdown the common way: dash bullets, dash rules, one space after the marker.
      ctx.update(remarkStringifyOptionsCtx, (prev) => ({ ...prev, bullet: '-' as const, rule: '-' as const, listItemIndent: 'one' as const }));
      ctx.update(editorViewOptionsCtx, (prev) => ({ ...prev, editable: () => !readOnly, attributes: { class: 'rich', spellcheck: 'false' } }));
      ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
        if (applying || readOnly || destroyed) return;
        // A report that is already out of date (the file was reloaded from disk since) must not undo the reload.
        if (markdown !== editor.action(getMarkdown())) return;
        save();
      });
    })
    .use(commonmark.filter((plugin) => plugin !== wrapInBlockquoteInputRule)).use(gfm).use(notion) // > makes a toggle here, so the preset's own rule for it (a quote) is left out
    .use(history).use(clipboard).use(listener).use(extras).use(pairs).use(notionRules).use(emojiRule).use(symbolRules).use(clicks).use(tickMotion).use(cutLine).use(caret)
    .create();

  // The file and the note are kept in step block by block. Each top-level block of the note is tied to the
  // stretch of the file it was read from; an edit rewrites only the blocks it touched and every other
  // stretch stays exactly as written. A stretch that would not come back with all its words (Markdown this
  // view has no block for) is shown as its source instead, still editable, so nothing is ever read-only.
  const view = editor.action((ctx) => ctx.get(editorViewCtx));
  const parse = editor.action((ctx) => ctx.get(parserCtx));
  const serialize = editor.action((ctx) => ctx.get(serializerCtx));
  const remark = editor.action((ctx) => ctx.get(remarkCtx));
  const { schema } = view.state;
  let segs: Seg[] = [];
  let shown = false;
  const read = new Map<string, PMNode[]>();    // stretches already read, so a reload only reads what changed
  const known = new WeakMap<PMNode, string>(); // blocks whose text in the file is known word for word
  const write = (nodes: PMNode[]) => unescapeWiki(serialize(schema.topNodeType.create(null, nodes)).replace(SOURCE_BLOCK, (_m, _f, text) => text ?? ''));

  /** The file's text cut into its top-level blocks, each with the blank lines after it. */
  const cut = (text: string) => {
    // Blocks are found in the text as it is read (see relaxLists), which differs from the file's only in how far
    // lines are indented, so a block's first line is the same line in both.
    const lines = new Set<number>();
    try {
      const blocks = (remark.parse(relaxLists(text)) as { children: { type: string; value?: string; position?: { start: { line?: number } } }[] }).children;
      // A toggle (<details> down to its </details>) is one block, whatever it holds.
      const marks = toggleMarks(blocks.map((node) => (node.type === 'html' ? node.value : null)));
      let inside = 0;
      blocks.forEach((node, i) => {
        const line = node.position?.start.line;
        if (line && line > 1 && !inside) lines.add(line);
        inside += marks?.[i] ?? 0;
      });
    } catch { /* one stretch, then */ }
    if (!lines.size) return [text];
    const at = [0];
    let line = 1;
    for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) { line += 1; if (lines.has(line)) at.push(i + 1); }
    return at.map((from, i) => text.slice(from, at[i + 1] ?? text.length));
  };
  const blocksOf = (src: string) => {
    let nodes = read.get(src);
    if (nodes) return nodes;
    nodes = [];
    if (src.trim()) {
      try {
        parse(relaxLists(src)).forEach((node) => { nodes!.push(node); });
        if (!nodes.length || fingerprint(write(nodes)) !== fingerprint(src)) nodes = [];
      } catch { nodes = []; }
      if (!nodes.length) nodes = [schema.nodes.code_block.create({ language: SOURCE }, schema.text(src.replace(/^(?:[ \t]*\r?\n)+/, '').replace(/\s+$/, '')))];
      if (nodes.length === 1) known.set(nodes[0], src);
    }
    read.set(src, nodes);
    return nodes;
  };
  const same = (a: PMNode, b: PMNode | undefined) => a === b || (!!b && a.eq(b));
  const topNodes = () => { const out: PMNode[] = []; view.state.doc.forEach((node) => { out.push(node); }); return out; };

  /** Shows the file's text, changing only the blocks that differ from what is shown (so the caret keeps its place). */
  const load = (text: string) => {
    const parts = split(text);
    front = parts.front;
    segs = cut(parts.body).map((src) => ({ src, nodes: blocksOf(src) }));
    const keep = new Set(segs.map((seg) => seg.src));
    for (const src of read.keys()) if (!keep.has(src)) read.delete(src);
    let next = segs.flatMap((seg) => seg.nodes);
    if (!next.length) next = [schema.nodes.paragraph.create()];
    const now = topNodes();
    let a = 0;
    while (a < now.length && a < next.length && now[a] === next[a]) a += 1;
    let b = 0;
    while (b < now.length - a && b < next.length - a && now[now.length - 1 - b] === next[next.length - 1 - b]) b += 1;
    if (a === now.length && a === next.length) { adopt(); return; }
    let from = 0;
    for (let i = 0; i < a; i++) from += now[i].nodeSize;
    let to = view.state.doc.content.size;
    for (let i = 0; i < b; i++) to -= now[now.length - 1 - i].nodeSize;
    applying = true;
    try {
      // Kept out of this view's history, which also keeps it from being reported as an edit made here: the
      // change listener waits a moment before reporting, and would otherwise write the text straight back
      // in its own formatting, leaving a file an agent just edited looking unsaved.
      const tr = view.state.tr.replaceWith(from, to, next.slice(a, next.length - b)).setMeta('addToHistory', false);
      if (!shown) tr.setSelection(Selection.atStart(tr.doc)); // a note opens with the caret at its top
      shown = true;
      view.dispatch(tr);
    } finally { applying = false; }
    adopt();
  };
  /** The editor's plugins may restamp a block as it goes in (a heading gets its id). The bridge holds the blocks as they now are. */
  const adopt = () => {
    const now = topNodes();
    if (now.length !== segs.reduce((n, seg) => n + seg.nodes.length, 0)) return;
    let i = 0;
    for (const seg of segs) {
      if (!seg.nodes.length) continue;
      const nodes = now.slice(i, i + seg.nodes.length);
      i += nodes.length;
      if (nodes.every((node, k) => node === seg.nodes[k])) continue;
      seg.nodes = nodes;
      if (read.has(seg.src)) read.set(seg.src, nodes);
      if (nodes.length === 1) known.set(nodes[0], seg.src);
    }
  };

  /** Writes an edit made here into the file's text: only the stretch of blocks that changed. */
  save = () => {
    const now = topNodes();
    const value = model.getValue();
    // Blocks before and after the edit are still the file's own text.
    let p = 0;
    let pn = 0;
    while (p < segs.length && pn + segs[p].nodes.length <= now.length && segs[p].nodes.every((node, i) => same(node, now[pn + i]))) { pn += segs[p].nodes.length; p += 1; }
    let s = segs.length;
    let sn = now.length;
    while (s > p && sn - segs[s - 1].nodes.length >= pn && segs[s - 1].nodes.every((node, i) => same(node, now[sn - segs[s - 1].nodes.length + i]))) { sn -= segs[s - 1].nodes.length; s -= 1; }
    // Between them, a block the file's text is known for goes back as that text; the rest is written out.
    const pieces: Seg[] = [];
    let run: PMNode[] = [];
    const flush = () => { if (run.length) { pieces.push({ src: write(run), nodes: run }); run = []; } };
    for (const node of now.slice(pn, sn)) {
      const src = known.get(node);
      if (src == null) run.push(node);
      else { flush(); pieces.push({ src, nodes: [node] }); }
    }
    flush();
    const before = segs.slice(0, p).map((seg) => seg.src).join('');
    const after = segs.slice(s).map((seg) => seg.src).join('');
    const filled = pieces.filter((piece) => piece.src);
    filled.forEach((piece, i) => {
      if (i < filled.length - 1 || after.trim()) piece.src = spaced(piece.src);
      else piece.src = piece.src.replace(/\s*$/, '\n'); // the file ends with one line break
    });
    if (before.trim() && !endsBlank(before) && (filled.length || after.trim())) {
      const gap = /\n[ \t]*$/.test(before) ? '\n' : '\n\n';
      if (filled.length) filled[0].src = gap + filled[0].src; else pieces.unshift({ src: gap, nodes: [] });
    }
    const eol = model.getEOL();
    if (eol !== '\n') for (const piece of pieces) piece.src = piece.src.replace(/\r?\n/g, eol);
    let middle = pieces.map((piece) => piece.src).join('');
    let next = front + before + middle + after;
    // Differences only in trailing blank lines (an empty paragraph to type into) don't count as edits.
    if (next.trimEnd() === value.trimEnd()) return;
    let from = front.length + before.length;
    let to = value.length - after.length;
    // Should the pieces not add up to the note (or the file not be what they were cut from), the whole note is written instead.
    const whole = write(now);
    if (fingerprint(before + middle + after) !== fingerprint(whole) || value !== front + segs.map((seg) => seg.src).join('')) {
      const x = fingerprint(before + middle + after), y = fingerprint(whole);
      let i = 0; while (i < x.length && x[i] === y[i]) i += 1;
      console.warn('bridge: whole note written', value !== front + segs.map((seg) => seg.src).join('') ? 'file drifted' : `words differ at ${i}: ${JSON.stringify(x.slice(i - 20, i + 30))} vs ${JSON.stringify(y.slice(i - 20, i + 30))}`);
      middle = eol === '\n' ? whole : whole.replace(/\r?\n/g, eol);
      next = front + middle;
      from = front.length;
      to = value.length;
      segs = [{ src: middle, nodes: now }];
    } else {
      for (const piece of pieces) if (piece.nodes.length === 1 && piece.src) known.set(piece.nodes[0], piece.src);
      segs = [...segs.slice(0, p), ...pieces, ...segs.slice(s)];
    }
    lastWritten = next;
    const start = model.getPositionAt(from);
    const end = model.getPositionAt(to);
    model.pushEditOperations([], [{ range: { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column }, text: middle }], () => null);
  };

  load(model.getValue());
  onReadOnly(null);
  // For tests: how a text would be cut up and which stretches would show as source, without showing it.
  (root as any).__probe = (text: string) => {
    const { body } = split(text);
    const parts = cut(body);
    const source = parts.filter((src) => { const nodes = blocksOf(src); read.delete(src); return nodes.length === 1 && nodes[0].attrs.language === SOURCE; });
    let whole = true;
    try { const all: PMNode[] = []; parse(relaxLists(body)).forEach((node) => { all.push(node); }); whole = fingerprint(write(all)) === fingerprint(body); } catch { whole = false; }
    const why = (src: string, out: string) => { const x = fingerprint(src), y = fingerprint(out); let i = 0; while (i < x.length && x[i] === y[i]) i += 1; return `${x.slice(Math.max(0, i - 30), i + 30)} | ${y.slice(Math.max(0, i - 30), i + 30)}`; };
    return { parts: parts.length, exact: parts.join('') === body, source, whole, why: (i: number, out: string) => why(source[i], out), back: source.map((src) => { try { const all: PMNode[] = []; parse(relaxLists(src)).forEach((node) => { all.push(node); }); return write(all); } catch (e) { return String(e); } }) };
  };

  const sub = model.onDidChangeContent(() => {
    const value = model.getValue();
    if (value === lastWritten) return; // our own write coming back
    load(value);
  });

  return {
    get readOnly() { return readOnly; },
    focus() { try { editor.action((ctx) => ctx.get(editorViewCtx).focus()); } catch {} },
    /** Caret on an empty paragraph at the end, adding one if the note ends in text. */
    focusEnd() {
      try {
        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          let tr = view.state.tr;
          const last = tr.doc.lastChild;
          if (!readOnly && (!last || last.type.name !== 'paragraph' || last.content.size > 0)) tr = tr.insert(tr.doc.content.size, view.state.schema.nodes.paragraph.create());
          view.dispatch(tr.setSelection(Selection.atEnd(tr.doc)).scrollIntoView());
          view.focus();
        });
      } catch {}
    },
    insertMarkdown(md: string) { if (!readOnly) editor.action(insert(md, true)); },
    destroy() { destroyed = true; sub.dispose(); editor.destroy(); },
  };
}
