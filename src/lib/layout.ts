export type LayoutNode =
  | { type: 'leaf'; pane: string }
  | { type: 'split'; id: string; dir: 'row' | 'col'; ratio: number; a: LayoutNode; b: LayoutNode };

export interface Rect { x: number; y: number; w: number; h: number }
export interface PaneRect { pane: string; rect: Rect }
export interface DividerRect { id: string; dir: 'row' | 'col'; rect: Rect; region: Rect }

// Rects are percentages of the tab area, so panes keep stable DOM positions
// (and their terminals keep running) however the tree is rearranged.
export function computeLayout(node: LayoutNode, rect: Rect = { x: 0, y: 0, w: 100, h: 100 }, panes: PaneRect[] = [], dividers: DividerRect[] = []) {
  if (node.type === 'leaf') { panes.push({ pane: node.pane, rect }); return { panes, dividers }; }
  if (node.dir === 'row') {
    const wa = rect.w * node.ratio;
    computeLayout(node.a, { ...rect, w: wa }, panes, dividers);
    computeLayout(node.b, { ...rect, x: rect.x + wa, w: rect.w - wa }, panes, dividers);
    dividers.push({ id: node.id, dir: 'row', rect: { x: rect.x + wa, y: rect.y, w: 0, h: rect.h }, region: rect });
  } else {
    const ha = rect.h * node.ratio;
    computeLayout(node.a, { ...rect, h: ha }, panes, dividers);
    computeLayout(node.b, { ...rect, y: rect.y + ha, h: rect.h - ha }, panes, dividers);
    dividers.push({ id: node.id, dir: 'col', rect: { x: rect.x, y: rect.y + ha, w: rect.w, h: 0 }, region: rect });
  }
  return { panes, dividers };
}

export function leaves(node: LayoutNode, out: string[] = []): string[] {
  if (node.type === 'leaf') out.push(node.pane); else { leaves(node.a, out); leaves(node.b, out); }
  return out;
}

export function replaceLeaf(node: LayoutNode, pane: string, make: (leaf: LayoutNode) => LayoutNode): LayoutNode {
  if (node.type === 'leaf') return node.pane === pane ? make(node) : node;
  return { ...node, a: replaceLeaf(node.a, pane, make), b: replaceLeaf(node.b, pane, make) };
}

export function removeLeaf(node: LayoutNode, pane: string): LayoutNode | null {
  if (node.type === 'leaf') return node.pane === pane ? null : node;
  const a = removeLeaf(node.a, pane);
  const b = removeLeaf(node.b, pane);
  if (!a) return b;
  if (!b) return a;
  return { ...node, a, b };
}

export function setRatio(node: LayoutNode, id: string, ratio: number): LayoutNode {
  if (node.type === 'leaf') return node;
  if (node.id === id) return { ...node, ratio };
  return { ...node, a: setRatio(node.a, id, ratio), b: setRatio(node.b, id, ratio) };
}

export function findSplit(node: LayoutNode, id: string): Extract<LayoutNode, { type: 'split' }> | null {
  if (node.type === 'leaf') return null;
  if (node.id === id) return node;
  return findSplit(node.a, id) ?? findSplit(node.b, id);
}

/** Each pane under a node, with the share of the node's width and height it takes. */
export function leafShares(node: LayoutNode, fw = 1, fh = 1, out: { pane: string; fw: number; fh: number }[] = []) {
  if (node.type === 'leaf') { out.push({ pane: node.pane, fw, fh }); return out; }
  if (node.dir === 'row') { leafShares(node.a, fw * node.ratio, fh, out); leafShares(node.b, fw * (1 - node.ratio), fh, out); }
  else { leafShares(node.a, fw, fh * node.ratio, out); leafShares(node.b, fw, fh * (1 - node.ratio), out); }
  return out;
}

const holds = (node: LayoutNode, pane: string) => leaves(node).includes(pane);

/** Puts `pane` on one side of the nearest left/right split around it ('toggle' swaps whichever side it is on). */
export function placeSide(node: LayoutNode, pane: string, side: 'left' | 'right' | 'toggle'): { node: LayoutNode; done: boolean } {
  if (node.type === 'leaf') return { node, done: false };
  const a = placeSide(node.a, pane, side);
  if (a.done) return { node: { ...node, a: a.node }, done: true };
  const b = placeSide(node.b, pane, side);
  if (b.done) return { node: { ...node, b: b.node }, done: true };
  if (node.dir !== 'row' || !holds(node, pane)) return { node, done: false };
  const onLeft = holds(node.a, pane);
  const swap = side === 'toggle' || (side === 'left') !== onLeft;
  return { node: swap ? { ...node, a: node.b, b: node.a, ratio: 1 - node.ratio } : node, done: true };
}

/** Which side of the nearest left/right split around it `pane` is on, if any. */
export function sideOf(node: LayoutNode, pane: string): 'left' | 'right' | null {
  if (node.type === 'leaf') return null;
  const inner = sideOf(node.a, pane) ?? sideOf(node.b, pane);
  if (inner || node.dir !== 'row' || !holds(node, pane)) return inner;
  return holds(node.a, pane) ? 'left' : 'right';
}
