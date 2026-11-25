// Tab and Shift+Tab on notes in the rendered view, and Backspace on a line that shows nothing.
//
// Tab moves only the notes the caret is on or the selection touches one step in, and Shift+Tab one step out.
// Everything nested under them stays at the depth it was, as in a word processor: a note moved in leaves its own
// sub-notes beside it, and a note moved out takes the notes after it on its old layer as its sub-notes. A list is
// thought of as its lines, each at a depth and of its own kind (numbered, bullet, to-do); the lines are given
// their new depths and the lists are built again from them. No line may sit more than one step deeper than the
// line above it, so a line that would is brought up to that.
import { Selection, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorState, Transaction } from '@milkdown/kit/prose/state';
import type { Node as PMNode, ResolvedPos, Schema } from '@milkdown/kit/prose/model';
import type { Cmd } from './richEditing';

interface Line {
  depth: number;
  ordered: boolean;
  /** For the first item of a numbered list, the number it counts from. */
  order: number | null;
  attrs: Record<string, unknown>;
  head: PMNode;      // the item's first line
  rest: PMNode[];    // what else it holds, besides lists
  item: number;      // where the item starts
  from: number;      // where its first line starts
}

const isList = (node: PMNode) => node.type.name === 'bullet_list' || node.type.name === 'ordered_list';

/** How deep the outermost list around `$pos` is, reached through lists and their items only (a list inside a toggle
 *  or a quote is a world of its own). -1 when there is none. */
function outerList($pos: ResolvedPos) {
  let found = -1;
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (isList(node)) found = d;
    else if (node.type.name !== 'list_item' && !node.isTextblock) break;
  }
  return found;
}

function flatten(list: PMNode, at: number, depth: number, out: Line[]) {
  const ordered = list.type.name === 'ordered_list';
  let pos = at + 1;
  list.forEach((item, _offset, index) => {
    const line: Line = { depth, ordered, order: ordered && index === 0 ? (list.attrs.order as number) ?? 1 : null, attrs: item.attrs, head: item.firstChild!, rest: [], item: pos, from: pos + 1 };
    out.push(line);
    item.forEach((child, offset, i) => {
      if (!i) return;
      if (isList(child)) flatten(child, pos + 1 + offset, depth + 1, out);
      else line.rest.push(child);
    });
    pos += item.nodeSize;
  });
}

function build(schema: Schema, lines: Line[], start: number, end: number, depth: number): PMNode[] {
  const { bullet_list: bullets, ordered_list: numbers, list_item: item } = schema.nodes;
  const out: PMNode[] = [];
  let group: PMNode[] = [];
  let ordered: boolean | null = null;
  let order = 1;
  const flush = () => {
    if (group.length) out.push(ordered ? numbers.create({ order }, group) : bullets.create(null, group));
    group = [];
  };
  let i = start;
  while (i < end) {
    const line = lines[i];
    let j = i + 1;
    while (j < end && lines[j].depth > depth) j += 1;
    const kids = j > i + 1 ? build(schema, lines, i + 1, j, depth + 1) : [];
    if (ordered !== line.ordered) { flush(); ordered = line.ordered; order = line.order ?? 1; }
    group.push(item.create({
      ...line.attrs, spread: false,
      listType: line.ordered ? 'ordered' : 'bullet', label: line.ordered ? `${order + group.length}.` : '•',
    }, [line.head, ...line.rest, ...kids]));
    i = j;
  }
  flush();
  return out;
}

/** Where the words of each item's first line start in `lists` put at `at`, in the order `flatten` reads them. */
function heads(lists: PMNode[], at: number) {
  const out: number[] = [];
  const walk = (list: PMNode, pos: number) => {
    let p = pos + 1;
    list.forEach((item) => {
      out.push(p + 2); // the item, then its first line, then its words
      item.forEach((child, offset, i) => { if (i && isList(child)) walk(child, p + 1 + offset); });
      p += item.nodeSize;
    });
  };
  let pos = at;
  for (const list of lists) { walk(list, pos); pos += list.nodeSize; }
  return out;
}

/** The line `pos` belongs to: the item it is in, the innermost one. */
function lineOf(lines: Line[], $pos: ResolvedPos) {
  for (let d = $pos.depth; d > 0; d--) {
    if ($pos.node(d).type.name !== 'list_item') continue;
    const at = $pos.before(d);
    return lines.findIndex((line) => line.item === at);
  }
  return -1;
}

function shiftNotes(state: EditorState, step: 1 | -1, dispatch?: (tr: Transaction) => void) {
  const { $from, $to } = state.selection;
  const d = outerList($from);
  if (d < 0 || outerList($to) !== d || (d > 1 && $to.before(d - 1) !== $from.before(d - 1))) return false;
  // Lists of other kinds straight before and after it are the same layer of notes: a bullet under a numbered list
  // can go in under its last number.
  const holder = $from.node(d - 1);
  let a = $from.index(d - 1);
  let b = $to.index(d - 1);
  for (let i = a; i <= b; i++) if (!isList(holder.child(i))) return false;
  while (a > 0 && isList(holder.child(a - 1))) a -= 1;
  while (b + 1 < holder.childCount && isList(holder.child(b + 1))) b += 1;
  let at = $from.start(d - 1);
  for (let i = 0; i < a; i++) at += holder.child(i).nodeSize;
  const lines: Line[] = [];
  let end = at;
  for (let i = a; i <= b; i++) { flatten(holder.child(i), end, 0, lines); end += holder.child(i).nodeSize; }
  const first = lineOf(lines, $from);
  const last = lineOf(lines, $to);
  if (first < 0 || last < 0) return false;
  const chosen = new Set<number>();
  for (let i = first; i <= last; i++) chosen.add(i);
  // Out of the list altogether is what Shift+Tab does on the outermost layer (Milkdown's own).
  if (step < 0 && [...chosen].every((i) => lines[i].depth === 0)) return false;
  if (!dispatch) return true;
  const was = lines.map((line) => line.depth);
  for (const i of chosen) lines[i].depth = Math.max(0, lines[i].depth + step);
  let above = -1;
  for (const line of lines) { line.depth = Math.min(line.depth, above + 1); above = line.depth; }
  if (lines.every((line, i) => line.depth === was[i])) return true; // nothing can move: the key is still taken
  // Where the selection was, as a line and a place in its first line.
  const place = (pos: number, $pos: ResolvedPos) => {
    const i = lineOf(lines, $pos);
    const line = lines[i];
    const inHead = pos >= line.from + 1 && pos <= line.from + 1 + line.head.content.size;
    return { i, off: inHead ? pos - line.from - 1 : line.head.content.size };
  };
  const anchor = place(state.selection.anchor, state.selection.$anchor);
  const head = place(state.selection.head, state.selection.$head);
  const made = build(state.schema, lines, 0, lines.length, 0);
  const tr = state.tr.replaceWith(at, end, made);
  const starts = heads(made, at);
  tr.setSelection(TextSelection.create(tr.doc, starts[anchor.i] + anchor.off, starts[head.i] + head.off));
  dispatch(tr.scrollIntoView());
  return true;
}

export const indentNotes: Cmd = (state, dispatch) => shiftNotes(state, 1, dispatch);
export const outdentNotes: Cmd = (state, dispatch) => shiftNotes(state, -1, dispatch);

/** Backspace on a line with nothing on it (an empty line, or a note with no words and nothing under it) takes the
 *  line away, and the caret goes to the end of the line above. Nothing else changes. */
export const dropBlank: Cmd = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.depth < 1 || $from.parent.type.name !== 'paragraph' || $from.parent.content.size) return false;
  let depth = $from.depth;
  const holder = $from.node(depth - 1);
  if (holder.type.name === 'list_item') {
    if ($from.index(depth - 1) === 0) {
      if (holder.childCount > 1) return false; // a note with notes under it shows its marker: not nothing
      depth -= 1;
    }
  }
  const from = $from.before(depth);
  const above = Selection.findFrom(state.doc.resolve(from), -1, true);
  if (!above) return false;
  if (!dispatch) return true;
  const tr = state.tr.deleteRange(from, $from.after(depth)); // also takes away a list this leaves empty
  tr.setSelection(Selection.near(tr.doc.resolve(tr.mapping.map(above.head, -1)), -1));
  dispatch(tr.scrollIntoView());
  return true;
};
