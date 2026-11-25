// The editable rendered view for Markdown files. The Monaco text model stays
// the single source of truth: this view reads from it, and writes the whole
// document back to it after each edit made here.
import { defaultValueCtx, Editor, editorViewCtx, editorViewOptionsCtx, parserCtx, remarkCtx, remarkStringifyOptionsCtx, rootCtx, serializerCtx } from '@milkdown/kit/core';
import { commonmark, headingIdGenerator, wrapInBlockquoteInputRule, wrapInHeadingInputRule } from '@milkdown/kit/preset/commonmark';
import { gfm, remarkGFMPlugin, strikethroughInputRule, wrapInTaskListInputRule } from '@milkdown/kit/preset/gfm';
import { toggleMark } from '@milkdown/kit/prose/commands';
import { clipboard } from '@milkdown/kit/plugin/clipboard';
import { history } from '@milkdown/kit/plugin/history';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import { InputRule, inputRules } from '@milkdown/kit/prose/inputrules';
import { keymap } from '@milkdown/kit/prose/keymap';
import { Plugin, PluginKey, Selection, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorState, Transaction } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import type { EditorView } from '@milkdown/kit/prose/view';
import { Fragment, Slice } from '@milkdown/kit/prose/model';
import type { Node as PMNode } from '@milkdown/kit/prose/model';
import { canJoin } from '@milkdown/kit/prose/transform';
import { $prose, getMarkdown, insert } from '@milkdown/kit/utils';
import '@milkdown/kit/prose/view/style/prosemirror.css';
import type * as monacoNs from 'monaco-editor';
import { api, appInfo, dirname } from './api';
import { openLink } from './links';
import { collapseLinks } from './richCollapse';
import { closeLinkBox, promptLink, setLink, showLinkBox } from './richLink';
import { emojiFor } from './monaco';
import { caret, copyLines, deleteLines, lineBelow, moveLines, pairs, selectLines } from './richEditing';
import type { Cmd } from './richEditing';
import { joinNotes, notion, notionRules, taskEnter, toggleBackspace, toggleClick, toggleEnter, toggleMarks, toggleOpen } from './richNotion';
import { hashBackspace, hashEnter, hashes, hashMark, headingId, headingRule, unhashed } from './richHashes';
import { imageDrops, imageView } from './richImages';
import { dropBlank, indentNotes, outdentNotes } from './richIndent';
import { drawnSelection } from './richSelection';
import { findMarks, richFinder } from './richFind';
import type { Finder, Found } from './find';
import { motion, shift } from './richMotion';
import { symbolRules } from './richSymbols';
import { underline, underlineHandler } from './richUnderline';
import { bus } from './panes';
import { keep as keepChange, spans as changeSpans, subscribe as onChanges, undo as undoChange } from './review';
import type { Span } from './review';

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
/** How long a ticked or unticked task is in motion: its words easing to struck-through grey or back (`strike-in` in styles.css; the box itself is quicker). */
const TICK_MS = 260;
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
  'Shift-Mod-k': deleteLines, 'Ctrl-l': selectLines,
  // Strike through. Tildes are left alone as typed, so a path or an "about" (~/notes, ~5) is never taken for one.
  // ⌘U underlines the selected words (in the file, <u>words</u>). With nothing selected ⌘U hides the terminal (commands.ts).
  'Mod-u': (state, dispatch) => { const u = state.schema.marks.underline; return !!u && !state.selection.empty && toggleMark(u)(state, dispatch); },
  'Shift-Mod-x': (state, dispatch) => { const strike = state.schema.marks.strike_through; return !!strike && toggleMark(strike)(state, dispatch); }, // ⌘L copies the file's path (commands.ts)
  Enter: (state, dispatch) => slashFile(state, dispatch) || hashEnter(state, dispatch) || toggleEnter(state, dispatch) || taskEnter(state, dispatch),
  'Mod-Enter': (state, dispatch) => toggleOpen(state, dispatch) || toggleTask(state, dispatch) || lineBelow(state, dispatch),
  Backspace: (state, dispatch) => hashBackspace(state, dispatch) || toggleBackspace(state, dispatch) || dropBlank(state, dispatch),
  // Only the notes the caret is on or the selection touches move; what is nested under them stays where it is (richIndent.ts).
  Tab: indentNotes, 'Shift-Tab': outdentNotes,
  // ⌘K over selected words asks for an address to link them to; ⇧⌘V links them to the address on the clipboard.
  'Mod-k': (state, _dispatch, view) => !state.selection.empty && !!view && promptLink(view),
  'Shift-Mod-v': (state, _dispatch, view) => {
    if (state.selection.empty || !view || !state.schema.marks.link) return false;
    const { from, to } = state.selection;
    void api.clipboard.read().then((text) => {
      const href = text.trim();
      if (view.isDestroyed || !/^(?:[a-z][a-z0-9+.-]*:\/\/|mailto:)\S+$|^www\.\S+\.\S+$/i.test(href)) return;
      setLink(view, from, to, href.startsWith('www.') ? `https://${href}` : href);
    });
    return true;
  },
}));
// [words](address) typed out becomes the words, linked, as its closing bracket goes in (the raw view keeps the
// notation, which is what the file holds). A picture's ![alt](address) is not a link, and neither is anything in code.
const linkRule = $prose(() => inputRules({ rules: [
  new InputRule(/(?<!!)\[([^[\]\n]+)\]\(([^()\s]+)\)$/, (state, match, start, end) => {
    const link = state.schema.marks.link;
    const code = state.schema.marks.inlineCode;
    const $start = state.doc.resolve(start);
    if (!link || $start.parent.type.spec.code || (code && state.doc.rangeHasMark(start, end, code))) return null;
    const before = $start.parent.textBetween(0, $start.parentOffset, undefined, '\ufffc');
    if ((before.split('`').length - 1) % 2) return null; // code still being typed
    // The words keep whatever they already were (bold, say), and what is typed next is not part of the link.
    return state.tr.replaceWith(start, end, state.schema.text(match[1], link.create({ href: match[2] }).addToSet($start.marks()))).removeStoredMark(link);
  }),
] }));
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
    handleDOMEvents: {
      // A toggle's arrow is pressed like a button: it opens or shuts the toggle as the mouse goes down, and
      // the press goes no further, so the caret stays where it was instead of jumping to the front of the title.
      mousedown(view: EditorView, event: MouseEvent) {
        if (event.button !== 0 || !toggleClick(view, event)) return false;
        event.preventDefault();
        return true;
      },
    },
    // Quick repeated clicks on a box arrive as double and triple clicks.
    handleDoubleClick: (view: EditorView, _pos: number, event: MouseEvent) => tickAt(view, event),
    handleTripleClick: (view: EditorView, _pos: number, event: MouseEvent) => tickAt(view, event),
    handleClick(view: EditorView, _pos: number, event: MouseEvent) {
      const target = event.target as HTMLElement;
      if (tickAt(view, event)) return true;
      const a = target.closest('a') as HTMLAnchorElement | null;
      if (a && event.metaKey) {
        // Web links open in the browser; links to files open in the editor, relative to this note.
        const file = (view.dom.closest('[data-file]') as HTMLElement | null)?.dataset.file;
        void openLink(a.getAttribute('href') ?? '', file ? dirname(file) : appInfo.home);
        return true;
      }
      // A plain click shows the link's address in a small box, to follow or to change. The caret still lands in the text.
      if (a && event.button === 0 && !event.shiftKey && !event.altKey && !event.ctrlKey) showLinkBox(view, a, event);
      return false;
    },
  },
}));

// A web address pasted over selected words makes them a link to it, as in the raw view (rawMarkdown.ts). It is
// used before Milkdown's own clipboard plugin, which would put the address in place of the words.
const linkPaste = $prose(() => new Plugin({
  props: {
    handlePaste(view: EditorView, event: ClipboardEvent) {
      const url = (event.clipboardData?.getData('text/plain') ?? '').trim();
      const sel = view.state.selection;
      const link = view.state.schema.marks.link;
      if (!link || sel.empty || !(sel instanceof TextSelection) || !sel.$from.sameParent(sel.$to) || sel.$from.parent.type.spec.code || !/^https?:\/\/\S+$/.test(url)) return false;
      const words = view.state.doc.textBetween(sel.from, sel.to);
      if (/^\S+:\/\/\S+$/.test(words.trim()) || view.state.doc.rangeHasMark(sel.from, sel.to, link)) return false;
      view.dispatch(view.state.tr.addMark(sel.from, sel.to, link.create({ href: url })).scrollIntoView());
      return true;
    },
  },
}));

export interface RichHandle { focus(): void; focusEnd(): void; destroy(): void; insertMarkdown(md: string, at?: { x: number; y: number }): void; finder(report: (f: Found) => void): Finder; readOnly: boolean }

/** The language tag of a block shown as its Markdown source, for text the rendered view has no way to show. */
const SOURCE = 'astrolabe:source';
const SOURCE_BLOCK = /^(`{3,})astrolabe:source[ \t]*\n(?:([\s\S]*?)\n)?\1[ \t]*$/gm;
/** One stretch of the file and the blocks it shows as: the bridge between the raw text and the rendered note. */
interface Seg { src: string; nodes: PMNode[] }
const isBlank = (node: PMNode) => node.type.name === 'paragraph' && node.content.size === 0;
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
  // Changes made to the file from outside that are waiting to be looked at (review.ts), drawn on the note.
  const reviewKey = new PluginKey<DecorationSet>('astrolabe-review');
  const reviewMarks = $prose(() => new Plugin<DecorationSet>({
    key: reviewKey,
    state: { init: () => DecorationSet.empty, apply: (tr, set) => (tr.getMeta(reviewKey) as DecorationSet | undefined) ?? set.map(tr.mapping, tr.doc) },
    props: { decorations: (state) => reviewKey.getState(state) },
  }));

  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, '');
      // Write Markdown the common way: dash bullets, dash rules, one space after the marker.
      ctx.update(remarkStringifyOptionsCtx, (prev) => ({
        ...prev, bullet: '-' as const, rule: '-' as const, listItemIndent: 'one' as const,
        // A list is written tight: no blank line between its items, or between an item's words and the list nested
        // under them. (Items made here would otherwise each come out followed by a blank line the note never showed.)
        // Inside an item anything else is set off by a blank line, which Markdown needs there to read it back.
        join: [...(prev.join ?? []), (left, right, parent) => {
          if (parent.type === 'list') return 0;
          if (parent.type === 'listItem') return left.type === 'paragraph' && right.type === 'list' ? 0 : 1;
          return undefined;
        }],
        handlers: {
          ...prev.handlers,
          // <u>words</u>: Markdown has no underline of its own (richUnderline.ts).
          underline: underlineHandler,
          // A lone tilde means nothing in the file (see singleTilde below), so it is written as typed, not as \~.
          // Two together would strike words through, so those keep their backslashes.
          text: (node, parent, state, info) => String(prev.handlers!.text!(node, parent, state, info)).replace(/(?<![\\~])\\~(?!~|\\~)/g, '~'),
        },
      }));
      ctx.set(headingIdGenerator.key, headingId);
      // In a file, only ~~two tildes~~ strike words through; a single ~ is itself.
      ctx.set(remarkGFMPlugin.options.key, { singleTilde: false });
      ctx.update(editorViewOptionsCtx, (prev) => ({ ...prev, editable: () => !readOnly, attributes: { class: 'rich', spellcheck: 'false' } }));
      ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
        if (applying || readOnly || destroyed) return;
        // A report that is already out of date (the file was reloaded from disk since) must not undo the reload.
        if (markdown !== editor.action(getMarkdown())) return;
        save();
      });
    })
    // > makes a toggle here, so the preset's own rule for it (a quote) is left out; so is its heading rule, for the one in richHashes.ts.
    .use(commonmark.filter((plugin) => plugin !== wrapInBlockquoteInputRule && plugin !== wrapInHeadingInputRule)).use(gfm.filter((plugin) => plugin !== strikethroughInputRule && plugin !== wrapInTaskListInputRule)).use(notion).use(underline).use(collapseLinks).use(hashMark).use(headingRule)
    .use(history).use(linkPaste).use(clipboard).use(listener).use(extras).use(pairs).use(notionRules).use(emojiRule).use(symbolRules).use(linkRule).use(clicks).use(tickMotion).use(cutLine).use(joinNotes).use(hashes).use(imageView).use(imageDrops).use(motion).use(shift).use(drawnSelection).use(caret).use(reviewMarks).use(findMarks)
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
  const writeRun = (nodes: PMNode[]) => unescapeWiki(serialize(schema.topNodeType.create(null, nodes)).replace(SOURCE_BLOCK, (_m, _f, text) => text ?? ''))
    // An empty line inside something else is just left out. (An empty list item keeps its "<br />": a marker with
    // nothing after it can read back as an underline turning the line above into a heading.)
    .replace(/^[ \t]*<br \/>[ \t]*\r?\n/gm, '');
  /** The note's blocks as the file's text. An empty line in the note is an empty line in the file: the blank line
   *  that sets two blocks apart, and one more for each empty line between them (the same is read back in `blocksOf`). */
  const write = (nodes: PMNode[]) => {
    let out = '';
    let any = false;
    let blank = 0;
    let run: PMNode[] = [];
    const flush = () => {
      if (!run.length) return;
      out += (any ? '\n\n' : '') + '\n'.repeat(blank) + writeRun(run).replace(/\s+$/, '');
      any = true; blank = 0; run = [];
    };
    for (const node of nodes) { if (isBlank(node)) { flush(); blank += 1; } else run.push(node); }
    flush();
    if (!any) return '\n'.repeat(blank);
    return `${out}\n${blank ? '\n'.repeat(blank + 1) : ''}`;
  };

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
      // Blank lines past the one that sets blocks apart are empty lines in the note (see `write`).
      const lines = src.split(/\r?\n/);
      let lead = 0;
      while (lead < lines.length && !lines[lead].trim()) lead += 1;
      let tail = 0;
      while (tail < lines.length - lead && !lines[lines.length - 1 - tail].trim()) tail += 1;
      const empty = (n: number) => Array.from({ length: Math.max(0, n) }, () => schema.nodes.paragraph.create());
      nodes = [...empty(lead), ...nodes, ...empty(tail - 2)];
      if (nodes.length === 1) known.set(nodes[0], src);
    }
    read.set(src, nodes);
    return nodes;
  };
  // A heading with the caret in it shows its #s (richHashes.ts) and is otherwise the block it was.
  const same = (a: PMNode, b: PMNode | undefined) => a === b || (!!b && (a.eq(b) || unhashed(a).eq(unhashed(b))));
  const still = (a: PMNode, b: PMNode) => a === b || (unhashed(a) !== a && unhashed(a).eq(b));
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
    // A block that reads the same is left as it is, whether or not it is the very block that was read from the file:
    // one typed here a moment ago is not, and replacing it would take the caret out of it.
    while (a < now.length && a < next.length && (still(now[a], next[a]) || same(now[a], next[a]))) a += 1;
    let b = 0;
    while (b < now.length - a && b < next.length - a && (still(now[now.length - 1 - b], next[next.length - 1 - b]) || same(now[now.length - 1 - b], next[next.length - 1 - b]))) b += 1;
    if (a === now.length && a === next.length) { adopt(); paint(); return; }
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
    paint();
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
      // Empty lines alone are only the extra blank lines they stand for.
      if (piece.nodes.length && piece.nodes.every(isBlank)) { piece.src = '\n'.repeat(piece.nodes.length); return; }
      if (i < filled.length - 1 || after.trim()) piece.src = spaced(piece.src);
      else piece.src = piece.src.replace(/\s*$/, '\n'); // the file ends with one line break
    });
    let lead = '';
    if (before.trim() && !endsBlank(before) && (filled.length || after.trim())) {
      // The blank line is the block before's to end with, not the next one's to start with: a stretch that starts
      // with blank lines would carry them along wherever it is written again, and an empty line put next to it
      // would come out one blank line too many.
      lead = /\n[ \t]*$/.test(before) ? '\n' : '\n\n';
    }
    const eol = model.getEOL();
    if (eol !== '\n') lead = lead.replace(/\n/g, eol);
    if (eol !== '\n') for (const piece of pieces) piece.src = piece.src.replace(/\r?\n/g, eol);
    let middle = lead + pieces.map((piece) => piece.src).join('');
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
      const kept = segs.slice(0, p);
      if (lead) kept[p - 1] = { ...kept[p - 1], src: kept[p - 1].src + lead };
      segs = [...kept, ...pieces, ...segs.slice(s)];
    }
    lastWritten = next;
    // Only the characters that differ are replaced, so marks on the text around them (changes waiting to be looked
    // at) stay where they are while you type beside them.
    const was = value.slice(from, to);
    const max = Math.min(was.length, middle.length);
    let a = 0;
    while (a < max && was.charCodeAt(a) === middle.charCodeAt(a)) a += 1;
    let b = 0;
    while (b < max - a && was.charCodeAt(was.length - 1 - b) === middle.charCodeAt(middle.length - 1 - b)) b += 1;
    // Never between the two halves of a line ending or of a character.
    const halves = (text: string, i: number) => i > 0 && i < text.length && ((text.charCodeAt(i - 1) === 13 && text.charCodeAt(i) === 10) || (text.charCodeAt(i - 1) >= 0xd800 && text.charCodeAt(i - 1) <= 0xdbff));
    while (a > 0 && (halves(was, a) || halves(middle, a))) a -= 1;
    while (b > 0 && (halves(was, was.length - b) || halves(middle, middle.length - b))) b -= 1;
    const start = model.getPositionAt(from + a);
    const end = model.getPositionAt(to - b);
    model.pushEditOperations([], [{ range: { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column }, text: middle.slice(a, middle.length - b) }], () => null);
    // Should the part written not leave the file as intended, the whole text is put right.
    if (model.getValue() !== next) {
      console.warn('bridge: partial write missed, whole text written');
      model.pushEditOperations([], [{ range: model.getFullModelRange(), text: next }], () => null);
    }
  };

  // ---------- changes from outside, drawn on the note ----------
  const newlines = (text: string) => { let n = 0; for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) n += 1; return n; };
  const isList = (node: PMNode) => node.type.name === 'bullet_list' || node.type.name === 'ordered_list';
  type MdNode = { type: string; children?: MdNode[]; position?: { start: { line: number }; end: { line: number } } };
  /** The items of a list that lines `s.start`..`s.end` fall in, as far down its nested lists as they can be told apart. */
  const itemsIn = (md: MdNode, list: PMNode, inner: number, line0: number, s: Span, out: { from: number; to: number }[]): boolean => {
    const kids = md.children ?? [];
    if (kids.length !== list.childCount || kids.some((k) => k.type !== 'listItem' || !k.position)) return false;
    list.forEach((item, offset, i) => {
      const l0 = line0 + kids[i].position!.start.line - 1;
      const l1 = line0 + kids[i].position!.end.line - 1;
      if (l0 > s.end || s.start > l1) return;
      const from = inner + offset;
      const subMd = (kids[i].children ?? []).filter((k) => k.type === 'list' && k.position);
      const subPm: { node: PMNode; at: number }[] = [];
      item.forEach((child, at) => { if (isList(child)) subPm.push({ node: child, at: from + 1 + at }); });
      // Only lines of its nested lists: the items there, not the whole item.
      if (subMd.length && subMd.length === subPm.length && s.start >= line0 + subMd[0].position!.start.line - 1) {
        const before = out.length;
        if (subMd.every((sub, k) => itemsIn(sub, subPm[k].node, subPm[k].at + 1, line0, s, out)) && out.length > before) return;
        out.length = before;
      }
      out.push({ from, to: from + item.nodeSize });
    });
    return true;
  };
  const button = (label: string, cls: string, run: () => void) => {
    const el = document.createElement('button');
    el.className = cls; el.textContent = label; el.type = 'button';
    el.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    el.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); run(); });
    return el;
  };
  const box = (s: Span) => () => {
    const el = document.createElement('div');
    el.className = `rv-box${s.offer ? ' is-offer' : ''}${(s.offer ?? s.old).length ? '' : ' is-bare'}`;
    el.contentEditable = 'false';
    el.dataset.change = s.id;
    const acts = document.createElement('div');
    acts.className = 'rv-actions';
    if (s.offer) acts.append(button('Use this', 'rv-undo', () => undoChange(model, s.id)), button('Keep mine', 'rv-keep', () => keepChange(model, s.id)));
    else acts.append(button('Keep', 'rv-keep', () => keepChange(model, s.id)), button('Undo', 'rv-undo', () => undoChange(model, s.id)));
    el.append(acts);
    const lines = s.offer ?? s.old;
    if (lines.length) {
      const text = document.createElement('div');
      text.className = s.offer ? 'rv-new' : 'rv-old';
      text.textContent = lines.join('\n');
      el.append(text);
    }
    return el;
  };
  let painted = '';
  const paint = () => {
    if (destroyed) return;
    const list = changeSpans(model);
    if (!list.length) {
      if (painted) { painted = ''; view.dispatch(view.state.tr.setMeta(reviewKey, DecorationSet.empty).setMeta('addToHistory', false)); }
      return;
    }
    // The note has to be in step with the file for lines to be found in it; if typing is still on its way, this runs again when it lands.
    const now = topNodes();
    if (now.length !== segs.reduce((n, seg) => n + seg.nodes.length, 0) || model.getValue() !== front + segs.map((seg) => seg.src).join('')) return;
    const blocks: { from: number; to: number; l0: number; l1: number; node: PMNode; seg: Seg }[] = [];
    let line = 1 + newlines(front);
    let pos = 0;
    for (const seg of segs) {
      const l1 = line + newlines(seg.src.replace(/\s+$/, ''));
      for (const node of seg.nodes) { blocks.push({ from: pos, to: pos + node.nodeSize, l0: line, l1, node, seg }); pos += node.nodeSize; }
      line += newlines(seg.src);
    }
    const decos: Decoration[] = [];
    let sig = '';
    for (const s of list) {
      const marked: { from: number; to: number }[] = [];
      if (s.end >= s.start) {
        for (const b of blocks) {
          if (b.l0 > s.end || s.start > b.l1) continue;
          let items: { from: number; to: number }[] | null = null;
          if (b.seg.nodes.length === 1 && isList(b.node)) {
            try {
              const tree = remark.parse(relaxLists(b.seg.src)) as MdNode;
              const lists = (tree.children ?? []).filter((k) => k.type === 'list');
              const found: { from: number; to: number }[] = [];
              if (lists.length === 1 && (tree.children ?? []).length === 1 && itemsIn(lists[0], b.node, b.from + 1, b.l0, s, found) && found.length) items = found;
            } catch { /* the whole list, then */ }
          }
          marked.push(...(items ?? [{ from: b.from, to: b.to }]));
        }
      }
      for (const m of marked) decos.push(Decoration.node(m.from, m.to, { class: s.offer ? 'rv-mine' : 'rv-add' }));
      // What was taken out is shown above the change; what is offered, below your own lines.
      const next = blocks.find((b) => b.l1 >= s.start);
      const at = s.offer ? (marked.length ? marked[marked.length - 1].to : next ? next.from : pos) : (marked.length ? marked[0].from : next ? next.from : pos);
      decos.push(Decoration.widget(at, box(s), { side: s.offer ? 1 : -1, key: `${s.id}:${(s.offer ?? s.old).length}`, ignoreSelection: true, stopEvent: () => true }));
      sig += `${s.id}@${at}:${marked.map((m) => `${m.from}-${m.to}`).join(',')};`;
    }
    if (sig === painted) return;
    painted = sig;
    view.dispatch(view.state.tr.setMeta(reviewKey, DecorationSet.create(view.state.doc, decos)).setMeta('addToHistory', false));
  };
  const offChanges = onChanges(paint);
  // Before a change from outside is merged in, what was typed here in the last moment is written to the file's text.
  const offFlush = bus.on('note.flush', (m: unknown) => { if (m === model && !destroyed && !applying) save(); });

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
    /** At the caret, or at the point `at` in the window (where something was dropped). */
    insertMarkdown(md: string, at?: { x: number; y: number }) {
      if (readOnly) return;
      const hit = at ? view.posAtCoords({ left: at.x, top: at.y }) : null;
      const tr = view.state.tr;
      if (hit) tr.setSelection(Selection.near(tr.doc.resolve(hit.pos)));
      // One line's worth goes in as it parses. (By way of HTML, as Milkdown's own insert does, a picture would be
      // fetched from the wrong place once and come back with its name as a title.)
      let inline: Fragment | null = null;
      try { const doc = parse(md); if (doc.childCount === 1 && doc.firstChild!.isTextblock) inline = doc.firstChild!.content; } catch { /* the long way, then */ }
      if (inline) { view.dispatch(tr.replaceSelection(new Slice(inline, 0, 0)).scrollIntoView()); return; }
      if (hit) view.dispatch(tr);
      editor.action(insert(md, true));
    },
    /** ⌘F's searcher for this note (richFind.ts). */
    finder(report: (f: Found) => void) { return richFinder(view, report); },
    destroy() { destroyed = true; offChanges(); offFlush(); closeLinkBox(); sub.dispose(); editor.destroy(); },
  };
}
