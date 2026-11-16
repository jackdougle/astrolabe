import { api } from './api';
import { carried, offer } from './handoff';
import { computeLayout, Edge, keepLeaves, leaves } from './layout';
import { spotAt } from './dock';
import { bringUnsaved } from './monaco';
import { bus, focusPane } from './panes';
import { EditorPane, focusedId, Pane, shownTerms, Tab, tabGroups, useStore } from './store';

// A tab dragged out of another window and over this one joins this window where it is let go (the main process
// finds the window under the pointer: `tearOver` in electron/main.ts). A terminal tab let go on a tab of the row
// combines with it, on a terminal it lands against that terminal's nearest edge, and anywhere else it becomes a tab
// of the row. A file opens in the editor it is let go on. What arrives is what a tab taken out of its window hands
// to a window of its own (tearoff.ts), so a terminal comes with its screen and its shell, which never stops.

/** A tab dragged out of another window, over this one: where the pointer is, in px of this page. */
export interface Over { x: number; y: number; kind: 'tab' | 'file'; label: string }
export interface Box { left: number; top: number; width: number; height: number }
/** Where it would land. `box`: the place it would take, to be outlined. `bar`: its place in the row, as a new tab. */
export type Landing =
  | { kind: 'join'; tab: string; target: string | null; edge: Edge; box: Box | null; /** Let go on the tab's block in the row. */ block: boolean }
  | { kind: 'tab'; index: number; bar: Box | null }
  | { kind: 'file'; pane: string | null; box: Box | null };

const boxOf = (r: DOMRect): Box => ({ left: r.left, top: r.top, width: r.width, height: r.height });
/** The middle of a tab's block: let go there, a tab combines with it; to either side, it goes before or after it. */
export const onBlock = (x: number, r: { left: number; width: number }) => { const f = (x - r.left) / (r.width || 1); return f >= 0.25 && f <= 0.75; };

export function landing(over: Pick<Over, 'x' | 'y' | 'kind'>): Landing {
  const s = useStore.getState();
  const { x, y } = over;
  const hit = document.elementsFromPoint(x, y);
  const find = (sel: string) => hit.map((n) => n.closest<HTMLElement>(sel)).find((n) => !!n) ?? null;
  if (over.kind === 'file') {
    const zone = find('.zone.is-files');
    const pane = zone?.querySelector<HTMLElement>('.file-row')?.dataset.pane ?? find('.area.is-editors .pane[data-pane]')?.dataset.pane ?? null;
    const el = pane ? document.querySelector<HTMLElement>(`.area.is-editors .pane[data-pane="${pane}"]`) : document.querySelector<HTMLElement>('.area.is-editors:not(.is-hidden)');
    return { kind: 'file', pane, box: el ? boxOf(el.getBoundingClientRect()) : null };
  }
  const row = tabGroups(s);
  const block = find('.tab-group[data-tab]:not(.is-leaving)');
  const i = block ? row.findIndex((t) => t.id === block.dataset.tab) : -1;
  if (block && i >= 0) {
    const r = block.getBoundingClientRect();
    if (onBlock(x, r)) return { kind: 'join', tab: row[i].id, target: null, edge: 'right', box: boxOf(r), block: true };
    const before = x < r.left + r.width / 2;
    return { kind: 'tab', index: before ? i : i + 1, bar: { left: before ? r.left - 5 : r.right + 3, top: r.top, width: 2, height: r.height } };
  }
  const front = row.find((t) => t.id === s.activeTab);
  const area = front ? document.querySelector<HTMLElement>(`.area.is-terminals:not(.is-hidden) .tab-area.is-active[data-tab="${front.id}"]`) : null;
  const b = area?.getBoundingClientRect();
  if (front && b && b.width > 0 && x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) {
    const ids = shownTerms(s, front);
    const live = keepLeaves(front.root, (id) => ids.includes(id));
    const rects = front.maximized || !live ? [{ pane: front.activePane, rect: { x: 0, y: 0, w: 100, h: 100 } }] : computeLayout(live).panes;
    // As for a terminal carried about its own window (dock.ts): half of the terminal under it, on the pointer's
    // side, or that whole side of the tab close to a wall.
    const at = spotAt(b, rects, x, y);
    if (at) {
      const edge = at.edge;
      const r = rects.find((p) => p.pane === at.target)?.rect ?? { x: 0, y: 0, w: 100, h: 100 };
      const half = edge === 'left' ? { ...r, w: r.w / 2 } : edge === 'right' ? { ...r, x: r.x + r.w / 2, w: r.w / 2 } : edge === 'top' ? { ...r, h: r.h / 2 } : { ...r, y: r.y + r.h / 2, h: r.h / 2 };
      return { kind: 'join', tab: front.id, target: at.target, edge, block: false, box: { left: b.left + half.x / 100 * b.width, top: b.top + half.y / 100 * b.height, width: half.w / 100 * b.width, height: half.h / 100 * b.height } };
    }
  }
  // Anywhere else it becomes the last tab of the row.
  const blocks = [...document.querySelectorAll<HTMLElement>('.tab-row > .tab-group:not(.is-leaving)')];
  const last = blocks[blocks.length - 1]?.getBoundingClientRect();
  return { kind: 'tab', index: row.length, bar: last ? { left: last.right + 3, top: last.top, width: 2, height: last.height } : null };
}

type Handed = Record<string, unknown> & { layout?: { tabs?: Tab[]; panes?: Record<string, Pane> }; files?: { unsaved?: Record<string, string> } };

/** Takes in the tab that was let go over this window at `at`. False leaves it to the main process to find it a home. */
async function adopt(data: Handed | null, at: { x: number; y: number } | null): Promise<boolean> {
  bus.emit('tearhover', null);
  const s = useStore.getState();
  const panes = data?.layout?.panes;
  if (!s.ready || !panes || !at) return false;
  const tab = data.layout?.tabs?.[0];
  if (tab?.root) {
    const ids = leaves(tab.root);
    if (ids.some((id) => s.panes[id])) return false;
    const where = landing({ x: at.x, y: at.y, kind: 'tab' });
    // Each terminal finds its screen waiting, as after a reload, and takes its shell back.
    for (const id of ids) offer(`term:${id}`, data[`term:${id}`]);
    const ok = s.takeIn(tab, panes, where.kind === 'join' ? { tab: where.tab, target: where.target, edge: where.edge } : { index: where.kind === 'tab' ? where.index : tabGroups(s).length });
    if (!ok) for (const id of ids) carried(`term:${id}`);
    else { const id = focusedId(); if (id) focusPane(id); }
    return ok;
  }
  const from = Object.values(panes).find((p): p is EditorPane => p?.kind === 'editor');
  const file = from?.files[0];
  if (!from || !file?.path) return false;
  const where = landing({ x: at.x, y: at.y, kind: 'file' });
  const typed = data.files?.unsaved?.[file.path];
  if (typeof typed === 'string') bringUnsaved(file.path, typed);
  if (where.kind === 'file' && where.pane) s.focusPane(where.pane);
  // A raw file keeps its caret. (A rendered note opens at its top.)
  const views = (data[`editor:${from.id}`] as { views?: [string, { cursorState?: { position?: { lineNumber: number; column: number } }[] } | null][] } | undefined)?.views;
  const caret = views?.find(([path]) => path === file.path)?.[1]?.cursorState?.[0]?.position;
  const open = useStore.getState();
  const had = Object.values(open.panes).some((p) => p.kind === 'editor' && p.id === open.editors.active && p.files.some((f) => f.path === file.path));
  open.openFile(file.path, !file.rendered && caret && !had ? { line: caret.lineNumber, col: caret.column } : null, { keep: true, blank: file.blank });
  const now = useStore.getState();
  const mine = now.panes[now.editors.active];
  const there = mine?.kind === 'editor' ? mine.files.find((f) => f.path === file.path) : null;
  if (mine && there && !had && there.rendered !== file.rendered) now.toggleRendered(mine.id, file.path);
  const id = focusedId();
  if (id) focusPane(id);
  return true;
}

api.app.onTearHover?.((over) => bus.emit('tearhover', over as Over | null));
api.app.onAdopt?.((data, at) => adopt(data as Handed | null, at as { x: number; y: number } | null));
