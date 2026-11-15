// Things panes expose to the rest of the app without going through React state.
export interface PaneHandle { focus(): void }
export const paneHandles = new Map<string, PaneHandle>();

/** Terminals on their way from one tab to another. Each is drawn afresh in its new tab, and while its id is here the
 *  terminal itself (its screen and its shell) is kept for that instead of being closed (see `park` in termSession.ts). */
export const moving = new Set<string>();
/** Marks terminals as about to change tabs. The mark lapses by itself if they never do. */
export function markMoving(ids: string[]) {
  for (const id of ids) moving.add(id);
  window.setTimeout(() => { for (const id of ids) moving.delete(id); }, 1000);
}

type Handler = (arg?: any) => void;
const handlers = new Map<string, Set<Handler>>();
export const bus = {
  on(ev: string, fn: Handler) {
    if (!handlers.has(ev)) handlers.set(ev, new Set());
    handlers.get(ev)!.add(fn);
    return () => { handlers.get(ev)?.delete(fn); };
  },
  emit(ev: string, arg?: any) { handlers.get(ev)?.forEach((fn) => fn(arg)); },
};

export function focusPane(id: string) {
  requestAnimationFrame(() => paneHandles.get(id)?.focus());
}
