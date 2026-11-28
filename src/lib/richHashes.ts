// A heading's #s in the rendered view. The heading the caret is on shows them in front of its words, greyed back,
// exactly as many as its level: the line reads as it does in the file, "### Title". Every other heading shows only
// its words, and has no #s at all (none kept hidden beside the words). On the caret's line the #s are text: the
// caret runs through them, they can be selected, and adding or deleting one changes the heading's level there and
// then (a line that no longer starts "#s, a space" is an ordinary line, and one edited until it does is a heading
// again). They grow in as the caret arrives and shrink away as it leaves (richMotion.ts).
//
// The #s carry a mark of their own (`hash`) that is never written to the file, since the heading's level already
// says it. One rule keeps the note in order after every change: the caret's heading opens with its own "### " and
// no other text is marked. Putting the #s in and taking them out stays out of the undo history; an edit made to
// them is part of it.
//
// A toggle heading's title (richNotion.ts) is a heading here too. It cannot become a paragraph, so where a
// heading would, it goes back to being a plain toggle's title.
import { InputRule } from '@milkdown/kit/prose/inputrules';
import { Fragment, Slice } from '@milkdown/kit/prose/model';
import type { MarkType, Node as PMNode } from '@milkdown/kit/prose/model';
import { Plugin } from '@milkdown/kit/prose/state';
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
const isTitle = (node: PMNode) => node.type.name === 'toggle_summary';
const isHeading = (node: PMNode) => node.type.name === 'heading' || (isTitle(node) && node.attrs.level > 0);
/** `tr` with the heading at `at` no longer one: an ordinary line, or for a toggle heading a plain toggle's title. */
const unhead = (tr: Transaction, at: number, node: PMNode) => (isTitle(node) ? tr.setNodeMarkup(at, undefined, { ...node.attrs, level: 0 }) : tr.setNodeMarkup(at, node.type.schema.nodes.paragraph));
const prefix = (level: number) => `${'#'.repeat(level)} `;
/** Set on a step that makes a heading by typing: its #s are put on show until the caret leaves it. */
const OPENING = 'astrolabe-hashes-open';
export const showHashes = (tr: Transaction) => tr.setMeta(OPENING, true);
/** Whether a heading (or a toggle heading's title) has its #s on show. */
export const hashesShown = (node: PMNode) => { const mark = node.type.schema.marks.hash; return !!mark && !!node.firstChild && !!mark.isInSet(node.firstChild.marks); };
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
  if (!node.isTextblock) {
    // The heading may be inside the block: a toggle heading's title, or a heading in a toggle or a quote.
    if (node.isLeaf) return node;
    let changed = false;
    const kids: PMNode[] = [];
    node.forEach((child) => { const bare = unhashed(child); if (bare !== child) changed = true; kids.push(bare); });
    return changed ? node.copy(Fragment.fromArray(kids)) : node;
  }
  if (!isHeading(node)) return node;
  const mark = node.type.schema.marks.hash as MarkType | undefined;
  if (!mark || !node.firstChild || !mark.isInSet(node.firstChild.marks)) return node;
  const kept: PMNode[] = [];
  node.forEach((child) => { if (!mark.isInSet(child.marks)) kept.push(child); });
  return node.copy(Fragment.fromArray(kept));
}
/** A heading's id comes from its words, not from the #s shown in front of them. */
export const headingId = (node: PMNode) => unhashed(node).textContent.toLowerCase().trim().replace(/\s+/g, '-');

/** "## " typed at the start of a line makes it a heading. Typed where a heading's words begin (straight after the
 *  #s it shows), it sets that heading's level and is not kept: the same number leaves it as it is. The same goes
 *  for a toggle heading's title. */
export const headingRule = $inputRule(() => new InputRule(/^(?:(#{1,6}) )?(#{1,6})\s$/, (state, match, start, end) => {
  const heading = state.schema.nodes.heading;
  const $start = state.doc.resolve(start);
  const node = $start.parent;
  const level = match[2].length;
  if (isHeading(node)) {
    const n = lead(node, hashOf(state));
    // Only "#s, a space" typed right after the heading's own #s.
    if (!match[1] || n !== match[1].length + 1) return null;
    const tr = state.tr.delete(start + n, end);
    return node.attrs.level === level ? tr : tr.setNodeMarkup($start.before(), undefined, { ...node.attrs, level });
  }
  if (match[1] || node.type.name !== 'paragraph') return null;
  if (!$start.node(-1).canReplaceWith($start.index(-1), $start.indexAfter(-1), heading)) return null;
  return showHashes(state.tr.delete(start, end).setBlockType(start, start, heading, { level }));
}));

/** The caret sits where a heading's words begin (just after its #s, when they are on show), or in among the #s. */
function atHashes(state: EditorState) {
  const { $head, empty } = state.selection;
  if (!empty || !$head.depth || !isHeading($head.parent)) return null;
  const n = lead($head.parent, hashOf(state));
  return $head.parentOffset <= n ? { n, pos: $head.before(), node: $head.parent, offset: $head.parentOffset } : null;
}
/** Backspace where a heading's words begin, its #s on show, deletes the space after them, as in the file: the #s all
 *  stay, and without the space the line is an ordinary one (`edited`, below) until it is typed again. */
export const hashBackspace: Cmd = (state, dispatch) => {
  const here = atHashes(state);
  if (!here || !here.n || here.offset !== here.n) return false; // (among the #s, or with none on show, Backspace does what it does anywhere)
  const at = state.selection.head;
  if (dispatch) dispatch(state.tr.delete(at - 1, at).scrollIntoView());
  return true;
};
/** Enter before a heading's words opens an empty line above it and leaves the heading whole. */
export const hashEnter: Cmd = (state, dispatch) => {
  const here = atHashes(state);
  if (!here || (!here.n && !here.node.content.size)) return false;
  // (Above the whole toggle, for a toggle heading.)
  const above = isTitle(here.node) ? state.selection.$head.before(-1) : here.pos;
  if (dispatch) dispatch(state.tr.insert(above, state.schema.nodes.paragraph.create()).scrollIntoView());
  return true;
};

const HISTORY = 'history$'; // prosemirror-history's key: set on the transactions that undo and redo

export const hashes = $prose(() => {
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
      // The heading the caret is in opens with its own "### " and no other text is marked anywhere: #s left
      // behind when the caret moved on, or brought in by a paste or an undo, go (they are not kept hidden).
      const fix: [number, PMNode][] = [];
      state.doc.descendants((node, pos) => {
        if (!node.isTextblock) return true;
        if (pos === here && isHeading(node) ? !inOrder(node, mark) : marked(node, 0, mark).length) fix.push([pos, node]);
        return false;
      });
      const tr = state.tr;
      const grow: number[] = [];
      const shrink: [number, string][] = [];
      let ours = false; // part of the edit that caused it, so undone with it
      for (const [at, node] of fix.reverse()) { // from the end, so the places of those before stay good
        const start = at + 1;
        if (at !== here) {
          const found = marked(node, start, mark);
          if (isHeading(node) && found.length && found[0][0] === start) shrink.push([start, node.textBetween(0, found[0][1] - start)]);
          for (const [from, to] of found.reverse()) tr.delete(from, to);
          continue;
        }
        if (old && edited(trs, old, here, node.attrs.level)) {
          const m = /^(#{1,6}) /.exec(plain(node));
          ours = true;
          if (m) {
            tr.removeMark(start + m[0].length, start + node.content.size, mark).addMark(start, start + m[0].length, mark.create());
            if (m[1].length !== node.attrs.level) tr.setNodeMarkup(at, undefined, { ...node.attrs, level: m[1].length });
          } else {
            // No longer "#s, then a space": in the file this line is not a heading, so it is not one here either.
            unhead(tr.removeMark(start, start + node.content.size, mark), at, node);
          }
          continue;
        }
        const had = marked(node, start, mark);
        for (const [from, to] of had.reverse()) tr.delete(from, to);
        tr.insert(start, state.schema.text(prefix(node.attrs.level), [mark.create()]));
        if (!had.length) grow.push(start);
      }
      const motion: MotionMeta = {};
      if (shrink.length) motion.shrink = shrink.map(([pos, text]) => [tr.mapping.map(pos, -1), text]);
      if (grow.length) motion.grow = grow.map((pos) => { const from = tr.mapping.map(pos, -1); const node = tr.doc.resolve(from).parent; return [from, from + prefix(node.attrs.level).length]; });
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
