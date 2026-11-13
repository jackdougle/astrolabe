// A heading's #s in the rendered view. The heading the caret is in reads as its line does in the file,
// "### Title", and the #s are text: the caret runs through them, they can be selected, and adding or
// deleting one changes the heading's level, as it would in the raw view. Every other heading shows only
// its words.
//
// The #s carry a mark of their own (`hash`) that is never written to the file. One rule keeps the note in
// order after every change: marked text may only be the "### " that opens the heading the caret is in.
// Anywhere else it is taken out, which is also what closes a heading when the caret leaves it. Putting the
// #s in and taking them out stays out of the undo history; an edit made to them is part of it.
import { InputRule } from '@milkdown/kit/prose/inputrules';
import { Fragment, Slice } from '@milkdown/kit/prose/model';
import type { MarkType, Node as PMNode } from '@milkdown/kit/prose/model';
import { Plugin, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorState, Transaction } from '@milkdown/kit/prose/state';
import { $inputRule, $mark, $prose } from '@milkdown/kit/utils';
import { motionKey } from './richMotion';
import type { MotionMeta } from './richMotion';
import type { Cmd } from './richEditing';

export const hashMark = $mark('hash', () => ({
  inclusive: false, // text typed after the #s is the heading's own
  excludes: '_',    // the #s are never bold, a link, or anything else
  parseDOM: [{ tag: 'span[data-hash]' }],
  toDOM: () => ['span', { class: 'rich-hash', 'data-hash': '' }, 0] as const,
  parseMarkdown: { match: () => false, runner: () => {} },
  // Returning true keeps the marked text out of the Markdown: the heading's level already says it.
  toMarkdown: { match: (mark) => mark.type.name === 'hash', runner: () => true },
}));

const hashOf = (state: EditorState) => state.schema.marks.hash as MarkType;
const isHeading = (node: PMNode) => node.type.name === 'heading';
const prefix = (level: number) => `${'#'.repeat(level)} `;
/** How much of the start of `node` is marked text. */
function lead(node: PMNode, mark: MarkType) {
  let n = 0;
  node.forEach((child, off) => { if (off === n && child.isText && mark.isInSet(child.marks)) n += child.nodeSize; });
  return n;
}
/** The marked stretches of the textblock whose content starts at `start`. */
function marked(node: PMNode, start: number, mark: MarkType) {
  const out: [number, number][] = [];
  node.forEach((child, off) => { if (mark.isInSet(child.marks)) out.push([start + off, start + off + child.nodeSize]); });
  return out;
}
const plain = (node: PMNode) => node.textBetween(0, node.content.size, undefined, '￼');
/** Shows "### " and nothing else marked. */
function inOrder(node: PMNode, mark: MarkType) {
  const n = lead(node, mark);
  return plain(node).slice(0, n) === prefix(node.attrs.level) && marked(node, 0, mark).every(([, to]) => to <= n);
}

/** `node` as it is without its #s showing. The bridge to the file compares blocks this way, so a heading is not taken for edited because the caret is in it. */
export function unhashed(node: PMNode): PMNode {
  if (!isHeading(node)) return node;
  const mark = node.type.schema.marks.hash as MarkType | undefined;
  if (!mark || !node.firstChild || !mark.isInSet(node.firstChild.marks)) return node;
  const kept: PMNode[] = [];
  node.forEach((child) => { if (!mark.isInSet(child.marks)) kept.push(child); });
  return node.copy(Fragment.fromArray(kept));
}
/** A heading's id comes from its words, not from the #s shown in front of them. */
export const headingId = (node: PMNode) => unhashed(node).textContent.toLowerCase().trim().replace(/\s+/g, '-');

/** "## " typed at the start of a line makes it a heading. (Milkdown's own rule also fires inside a heading, where the #s are now text to edit.) */
export const headingRule = $inputRule(() => new InputRule(/^(#{1,6})\s$/, (state, match, start, end) => {
  const heading = state.schema.nodes.heading;
  const $start = state.doc.resolve(start);
  if ($start.parent.type === heading || !$start.node(-1).canReplaceWith($start.index(-1), $start.indexAfter(-1), heading)) return null;
  return state.tr.delete(start, end).setBlockType(start, start, heading, { level: match[1].length });
}));

/** The caret sits where a heading's words begin, just after its #s, or in among them. */
function atHashes(state: EditorState) {
  const { $head, empty } = state.selection;
  if (!empty || !$head.depth || !isHeading($head.parent)) return null;
  const n = lead($head.parent, hashOf(state));
  return n && $head.parentOffset <= n ? { n, pos: $head.before(), node: $head.parent, offset: $head.parentOffset } : null;
}
/** Backspace where a heading's words begin takes one # away, so the heading goes up a level; the last # leaves an ordinary line. (Among the #s it deletes the one before the caret, which comes to the same.) */
export const hashBackspace: Cmd = (state, dispatch) => {
  const here = atHashes(state);
  if (!here || here.offset !== here.n) return false;
  const level = here.node.attrs.level - 1;
  if (dispatch) dispatch(level ? state.tr.setNodeMarkup(here.pos, undefined, { ...here.node.attrs, level }) : state.tr.setNodeMarkup(here.pos, state.schema.nodes.paragraph));
  return true;
};
/** Enter before a heading's words opens an empty line above it and leaves the heading whole. */
export const hashEnter: Cmd = (state, dispatch) => {
  const here = atHashes(state);
  if (!here) return false;
  if (dispatch) dispatch(state.tr.insert(here.pos, state.schema.nodes.paragraph.create()).scrollIntoView());
  return true;
};

const HISTORY = 'history$'; // prosemirror-history's key: set on the transactions that undo and redo

export const hashes = $prose(() => {
  let stepped = 0; // when → was last pressed at the end of a line
  /** The #s of the heading the caret was already in were edited by hand: what they now say decides the level. */
  const edited = (trs: readonly Transaction[], old: EditorState, at: number, level: number) => {
    if (!trs.some((tr) => tr.docChanged) || trs.some((tr) => tr.getMeta(HISTORY) || tr.getMeta('addToHistory') === false)) return false;
    const $was = old.selection.$head;
    if (!$was.depth || !isHeading($was.parent) || $was.parent.attrs.level !== level || !inOrder($was.parent, hashOf(old))) return false;
    let pos = $was.before();
    for (const tr of trs) pos = tr.mapping.map(pos);
    return pos === at;
  };
  /** The paragraph now at `at` is the one the caret was already in, it has just been edited by hand, and it did not read as a heading before. */
  const typedInto = (trs: readonly Transaction[], old: EditorState, at: number) => {
    if (!trs.some((tr) => tr.docChanged) || trs.some((tr) => tr.getMeta(HISTORY) || tr.getMeta('addToHistory') === false || tr.getMeta('paste'))) return false;
    const $was = old.selection.$head;
    if (!$was.depth || $was.parent.type.name !== 'paragraph' || /^#{1,6} /.test(plain($was.parent))) return false;
    let pos = $was.before();
    for (const tr of trs) pos = tr.mapping.map(pos);
    return pos === at;
  };
  const headingAt = (state: EditorState) => { const { $head } = state.selection; return $head.depth && isHeading($head.parent) ? $head.before() : -1; };
  /** What it takes to put `state` in order after `trs` (none, when it is looked at afresh), or null if it is in order. */
  const settle = (trs: readonly Transaction[], old: EditorState | null, state: EditorState) => {
      const here = headingAt(state);
      const mark = hashOf(state);
      // Marked text anywhere but in the caret's heading goes: #s left behind when the caret moved on, or brought in by a paste or an undo.
      const stray: [number, number][] = [];
      const closing: [number, string][] = [];
      state.doc.descendants((node, pos) => {
        if (!node.isTextblock) return true;
        if (pos === here) return false;
        const found = marked(node, pos + 1, mark);
        if (found.length && isHeading(node) && found[0][0] === pos + 1) closing.push([pos + 1, node.textBetween(0, found[0][1] - pos - 1)]);
        stray.push(...found);
        return false;
      });
      const tr = state.tr;
      for (const [from, to] of stray.reverse()) tr.delete(from, to);
      const motion: MotionMeta = {};
      if (closing.length) motion.shrink = closing.map(([pos, text]) => [tr.mapping.map(pos, -1), text]);
      let ours = false; // part of the edit that caused it, so undone with it
      if (here >= 0) {
        const at = tr.mapping.map(here);
        const node = tr.doc.nodeAt(at)!;
        const start = at + 1;
        if (!inOrder(node, mark)) {
          if (old && edited(trs, old, here, node.attrs.level)) {
            const m = /^(#{1,6}) /.exec(plain(node));
            ours = true;
            if (m) {
              tr.removeMark(start + m[0].length, start + node.content.size, mark).addMark(start, start + m[0].length, mark.create());
              if (m[1].length !== node.attrs.level) tr.setNodeMarkup(at, undefined, { ...node.attrs, level: m[1].length });
            } else {
              // No longer "#s, then a space": in the file this line is not a heading, so it is not one here either.
              tr.removeMark(start, start + node.content.size, mark).setNodeMarkup(at, state.schema.nodes.paragraph);
            }
          } else {
            const had = marked(node, start, mark);
            for (const [from, to] of had.reverse()) tr.delete(from, to);
            const text = prefix(node.attrs.level);
            tr.insert(start, state.schema.text(text, [mark.create()]));
            if (!had.length) {
              motion.grow = [[start, start + text.length]];
              // Stepping in with → from the line above arrives in front of the #s, as it does in the file.
              const { selection } = state;
              if (selection.empty && selection.$head.parentOffset === 0 && performance.now() - stepped < 400) tr.setSelection(TextSelection.create(tr.doc, start));
            }
          }
        }
      }
      // The other way round: a line edited until it reads "#s, a space, words" (a seventh # deleted, say) is a heading again.
      const { $head } = state.selection;
      if (here < 0 && old && $head.depth && $head.parent.type.name === 'paragraph' && typedInto(trs, old, $head.before())) {
        const m = /^(#{1,6}) /.exec(plain($head.parent));
        const heading = state.schema.nodes.heading;
        if (m && $head.node(-1).canReplaceWith($head.index(-1), $head.indexAfter(-1), heading)) {
          const at = tr.mapping.map($head.before());
          tr.setNodeMarkup(at, heading, { level: m[1].length }).addMark(at + 1, at + 1 + m[0].length, mark.create());
          ours = true;
        }
      }
      if (!tr.steps.length) return null;
      if (motion.grow || motion.shrink) tr.setMeta(motionKey, motion);
      return ours ? tr : tr.setMeta('addToHistory', false);
  };
  // An undo or a redo is put in order afterwards, in a step of its own: the history counts anything appended to
  // one as part of it, and would lose its place in the steps still to be undone.
  let late = false;
  return new Plugin({
    view: () => ({
      update(view) {
        if (!late) return;
        late = false;
        const tr = settle([], null, view.state);
        if (tr) view.dispatch(tr);
      },
    }),
    props: {
      handleKeyDown(view, event) {
        const { $head, empty } = view.state.selection;
        stepped = event.key === 'ArrowRight' && !event.shiftKey && !event.metaKey && !event.altKey && !event.ctrlKey && empty && $head.parentOffset === $head.parent.content.size ? performance.now() : 0;
        return false;
      },
      // Copied text leaves here as Markdown and as HTML, and neither should carry the #s twice.
      transformCopied(slice) {
        const mark = slice.content.firstChild?.type.schema.marks.hash as MarkType | undefined;
        if (!mark) return slice;
        const strip = (frag: Fragment): Fragment => {
          const out: PMNode[] = [];
          frag.forEach((node) => { if (node.isText) { if (!mark.isInSet(node.marks)) out.push(node); } else out.push(node.copy(strip(node.content))); });
          return Fragment.fromArray(out);
        };
        return new Slice(strip(slice.content), slice.openStart, slice.openEnd);
      },
    },
    appendTransaction(trs, old, state) {
      if (trs.some((tr) => tr.getMeta(HISTORY))) { late = true; return null; }
      if (!trs.some((tr) => tr.docChanged) && (old.selection.eq(state.selection) || headingAt(old) === headingAt(state))) return null;
      return settle(trs, old, state);
    },
  });
});
