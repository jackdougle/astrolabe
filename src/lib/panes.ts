// Things panes expose to the rest of the app without going through React state.
export interface PaneHandle { focus(): void }
export const paneHandles = new Map<string, PaneHandle>();

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
