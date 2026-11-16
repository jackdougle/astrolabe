import { basename } from './api';
import { isGraph } from './graph';
import { across, addLeaf, areaRects, computeLayout, Edge, keepLeaves, LayoutNode, moveLeaf, opposite, PaneRect, Rect, sideAt } from './layout';
import { EDITORS, liveEditors, showing, shownTerms, tabGroups, termLabel, useStore } from './store';

// Moving things about the window by hand. A terminal is carried by its tab in the row (or the bar at its top edge),
// a file by its tab, an editor by its bar. Wherever the pointer is, an outline shows the place the thing would take
// if let go there, and with no outline it would stay where it is:
//   over another pane of its kind, the half of that pane on the pointer's side, going by the pane's diagonals;
//   close to one of the four walls of its area, that whole side of the area;
//   over the other area (a terminal over the editors, a file over the terminals), that side of the window: its own
//   area moves there, since the terminals and the editors are each one block of the window.
// A terminal carried up to the row joins the tab it is let go on, or gets a tab of its own beside the tabs.

/** What is being carried: a terminal, one file of an editor, or an editor with all its files. */
export type Carried = { kind: 'term'; pane: string } | { kind: 'file'; pane: string; path: string } | { kind: 'editor'; pane: string };
/** Where it would go. `pane`: into the arrangement `tree`, against `edge` of the pane `target`, or of the whole
 *  arrangement when `target` is null. `side`: its area to that side of the window. `tab`: a terminal into that tab,
 *  or a tab of its own when null. */
export type Dock =
  | { to: 'pane'; tree: string; target: string | null; edge: Edge }
  | { to: 'side'; edge: Edge }
  | { to: 'tab'; tab: string | null };
export interface Box { left: number; top: number; width: number; height: number }
interface Spot { dock: Dock; box: Box | null; /** Something in the row to light up instead of an outline. */ mark: HTMLElement | null }

/** The drag in hand, for what is drawn: the pane that would move, the outline of where to, and the label at the pointer. */
export interface Docking { pane: string | null; box: Box | null; chip: { x: number; y: number; label: string; icon: 'terminal' | 'file' } | null }

let now: Docking | null = null;
const watchers = new Set<() => void>();
const same = (a: Box | null, b: Box | null) => a === b || (!!a && !!b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height);
function show(next: Docking | null) {
  if (now && next && now.pane === next.pane && same(now.box, next.box) && now.chip?.x === next.chip?.x && now.chip?.y === next.chip?.y) return;
  now = next;
  watchers.forEach((fn) => fn());
}
export const docking = {
  get: () => now,
  subscribe(fn: () => void) { watchers.add(fn); return () => { watchers.delete(fn); }; },
};

/** The stand-in for a pane that does not exist yet, while its place is worked out. */
const PREVIEW = 'preview';
const FULL: Rect = { x: 0, y: 0, w: 100, h: 100 };
const inside = (b: DOMRect, x: number, y: number) => b.width > 0 && b.height > 0 && x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
const within = (b: DOMRect, r: Rect): Box => ({ left: b.left + r.x / 100 * b.width, top: b.top + r.y / 100 * b.height, width: r.w / 100 * b.width, height: r.h / 100 * b.height });
const half = (r: Rect, edge: Edge): Rect => (edge === 'left' ? { ...r, w: r.w / 2 } : edge === 'right' ? { ...r, x: r.x + r.w / 2, w: r.w / 2 } : edge === 'top' ? { ...r, h: r.h / 2 } : { ...r, y: r.y + r.h / 2, h: r.h / 2 });

/** How near a wall of its area, in px, a thing must be carried to take that whole side: more in a large area, so the
 *  strip is easy to reach, and never so much that a small pane by the wall cannot be aimed at. */
export const wallReach = (b: { width: number; height: number }) => Math.max(26, Math.min(56, Math.min(b.width, b.height) * 0.09));

/** The place a point picks in an area of panes: a whole side of the area close to its wall, else a side of the pane
 *  under the point. Null over `skip` (the thing's own place). `rects` are in percent of `box`. */
export function spotAt(box: DOMRect, rects: PaneRect[], x: number, y: number, skip?: string | null): { target: string | null; edge: Edge } | null {
  const wall = ([['left', x - box.left], ['right', box.right - x], ['top', y - box.top], ['bottom', box.bottom - y]] as [Edge, number][]).sort((a, b) => a[1] - b[1])[0];
  if (wall[1] < wallReach(box)) return { target: null, edge: wall[0] };
  const px = (x - box.left) / box.width * 100;
  const py = (y - box.top) / box.height * 100;
  const over = rects.find(({ rect: r }) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h);
  if (!over || over.pane === skip) return null;
  return { target: over.pane, edge: sideAt(over.rect, px, py) };
}

/** A place among the panes of one arrangement. `moved`: the pane being carried, when it is one of them already. */
function among(tree: string, root: LayoutNode, shown: string[], zoomed: string | null, box: DOMRect, x: number, y: number, moved: string | null): Spot | null {
  const live = keepLeaves(root, (id) => shown.includes(id));
  // Alone in its arrangement, or with the others out of sight behind one that fills it, there is nowhere else in it to go.
  if (!live || (moved && (shown.length < 2 || zoomed))) return null;
  const rects = zoomed ? [{ pane: zoomed, rect: FULL }] : computeLayout(live).panes;
  const at = spotAt(box, rects, x, y, moved);
  if (!at) return null;
  const dock: Dock = { to: 'pane', tree, target: at.target, edge: at.edge };
  if (zoomed) return { dock, box: within(box, half(FULL, at.edge)), mark: null };
  const next = moved ? moveLeaf(live, moved, at.target, at.edge, PREVIEW) : addLeaf(live, PREVIEW, at.target, at.edge, PREVIEW);
  // It is there already.
  if (next === live) return null;
  const rect = computeLayout(next).panes.find((p) => p.pane === (moved ?? PREVIEW))?.rect;
  return rect ? { dock, box: within(box, rect), mark: null } : null;
}

const areaBox = (kind: 'terminals' | 'editors') => document.querySelector<HTMLElement>(`.area.is-${kind}:not(.is-hidden):not(.is-going)`)?.getBoundingClientRect() ?? null;

/** Over the other area: the carried thing's own area would take the side of the window the pointer is on. */
function toSide(mine: 'term' | 'editor', other: DOMRect, x: number, y: number): Spot | null {
  const s = useStore.getState();
  const stack = document.querySelector<HTMLElement>('.stack')?.getBoundingClientRect();
  if (!stack) return null;
  const edge = sideAt({ x: other.left, y: other.top, w: other.width, h: other.height }, x, y);
  // The setting says where the editors are.
  const side = mine === 'editor' ? edge : opposite(edge);
  if (side === s.settings.editorSide) return null;
  const rects = areaRects(true, turned(s.settings.editorSide, side) ? 0.5 : s.areas.ratio, side);
  return { dock: { to: 'side', edge }, box: within(stack, mine === 'term' ? rects.term : rects.editor), mark: null };
}
/** The areas would go from side by side to one above the other, or back: they then share the window half and half. */
const turned = (from: Edge, to: Edge) => across(from) !== across(to);

/** A terminal over the row: the tab it would join, or the row itself for a tab of its own. */
function inRow(pane: string, x: number, y: number): Spot | null {
  const s = useStore.getState();
  const own = s.tabs.find((t) => shownTerms(s, t).includes(pane));
  if (!own) return null;
  const hit = document.elementsFromPoint(x, y);
  const block = hit.map((n) => n.closest<HTMLElement>('.tab-group[data-tab]:not(.is-leaving)')).find((n) => !!n);
  const lone = shownTerms(s, own).length < 2;
  if (block && block.dataset.tab !== own.id) return { dock: { to: 'tab', tab: block.dataset.tab! }, box: null, mark: block };
  const zone = hit.map((n) => n.closest<HTMLElement>('.zone.is-tabs')).find((n) => !!n);
  return zone && !lone ? { dock: { to: 'tab', tab: null }, box: null, mark: zone } : null;
}

function spot(what: Carried, x: number, y: number, row: boolean): Spot | null {
  const s = useStore.getState();
  const on = showing(s);
  const terms = on !== 'editor' ? areaBox('terminals') : null;
  const editors = on !== 'terminal' ? areaBox('editors') : null;
  if (what.kind === 'term') {
    const bar = row ? document.querySelector('.topbar')?.getBoundingClientRect() : null;
    if (bar && y <= bar.bottom) return inRow(what.pane, x, y);
    const front = tabGroups(s).find((t) => t.id === s.activeTab);
    if (front && terms && inside(terms, x, y)) {
      const shown = shownTerms(s, front);
      return among(front.id, front.root, shown, front.maximized ? front.activePane : null, terms, x, y, shown.includes(what.pane) ? what.pane : null);
    }
    return editors && terms && inside(editors, x, y) ? toSide('term', editors, x, y) : null;
  }
  const from = s.panes[what.pane];
  if (from?.kind !== 'editor' || !s.editors.root) return null;
  if (editors && inside(editors, x, y)) {
    const shown = liveEditors(s).map((e) => e.id);
    // A file that is all its editor holds takes the editor along.
    const whole = what.kind === 'editor' || from.files.length < 2;
    return among(EDITORS, s.editors.root, shown, s.editors.maximized ? s.editors.active : null, editors, x, y, whole ? what.pane : null);
  }
  return terms && editors && inside(terms, x, y) ? toSide('editor', terms, x, y) : null;
}

function place(what: Carried, d: Dock) {
  const st = useStore.getState();
  if (d.to === 'tab') { if (what.kind === 'term') st.moveTerm(what.pane, d.tab); return; }
  if (d.to === 'side') {
    const side = what.kind === 'term' ? opposite(d.edge) : d.edge;
    const was = st.settings.editorSide;
    if (turned(was, side)) st.setAreaRatio(0.5);
    st.setEditorSide(side);
    // What was carried has the keyboard there.
    useStore.getState().focusPane(what.pane);
    return;
  }
  if (what.kind === 'file') { st.placeFile(what.pane, what.path, d.target, d.edge); return; }
  if (what.kind === 'editor' || st.tabs.find((t) => t.id === d.tree && shownTerms(st, t).includes(what.pane))) st.movePane(what.pane, d.target, d.edge);
  else st.moveTerm(what.pane, d.tree, { target: d.target, edge: d.edge });
}

function label(what: Carried): NonNullable<Docking['chip']> | null {
  const p = useStore.getState().panes[what.pane];
  if (what.kind === 'term') { if (p?.kind !== 'terminal') return null; const l = termLabel(p); return { x: 0, y: 0, label: `${l.dir} ${l.app}`.trim(), icon: 'terminal' }; }
  const path = what.kind === 'file' ? what.path : p?.kind === 'editor' ? p.active : null;
  return { x: 0, y: 0, label: path ? (isGraph(path) ? 'Graph' : basename(path)) : 'Editor', icon: 'file' };
}

/** Takes hold of something. Tell it where the pointer is with `over`; `drop` puts the thing where the outline is
 *  (true if it went anywhere), `cancel` leaves it be. `chip`: a label follows the pointer, for a thing whose own tab
 *  does not. `row`: a terminal may be carried up to the row of tabs. */
export function carry(what: Carried, opts: { chip?: boolean; row?: boolean } = {}) {
  const chip = opts.chip ? label(what) : null;
  // The pane that goes dim while it is carried: a file's editor only when the file is all it holds.
  const p = useStore.getState().panes[what.pane];
  const pane = what.kind !== 'file' || (p?.kind === 'editor' && p.files.length < 2) ? what.pane : null;
  let at: Spot | null = null;
  const mark = (el: HTMLElement | null) => { if (at?.mark !== el) { at?.mark?.classList.remove('is-target'); el?.classList.add('is-target'); } };
  const done = () => { mark(null); at = null; show(null); };
  return {
    over(x: number, y: number) {
      const next = spot(what, x, y, !!opts.row);
      mark(next?.mark ?? null);
      at = next;
      show({ pane, box: next?.box ?? null, chip: chip ? { ...chip, x, y } : null });
    },
    drop() {
      const to = at?.dock;
      done();
      if (to) place(what, to);
      return !!to;
    },
    cancel: done,
  };
}
