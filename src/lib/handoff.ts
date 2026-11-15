import { api } from './api';

// A window can reload in place (the update notice's Reload after a change to the interface, or Reload Window):
// the page is replaced but the main process, and every shell it runs, carries on. Just before the old page
// goes it hands over whatever the new one needs to look and behave as if nothing happened: the layout, each
// terminal's screen, unsaved typing. Anything can add a piece with `carry`; the new page reads it with `carried`.

type Part = () => unknown | Promise<unknown>;
const parts = new Map<string, Part>();
let incoming: Record<string, unknown> = {};
let resumedNow = false;
let live = false;
/** The page is fully up. Only then does it have anything worth handing on. */
export function markLive() { live = true; }

/** Names a piece of state to carry across a reload. `get` runs just before the page goes; what it returns
 *  must survive being sent between processes (plain data). Returns a function that withdraws the piece. */
export function carry(name: string, get: Part) {
  parts.set(name, get);
  return () => { if (parts.get(name) === get) parts.delete(name); };
}

/** The piece the last page left under this name. It is handed out once. */
export function carried<T>(name: string): T | undefined {
  const value = incoming[name] as T | undefined;
  delete incoming[name];
  return value;
}
export const hasCarried = (name: string) => name in incoming;
/** Leaves a piece under a name as a reloaded page would have: for what arrives from another window (movein.ts). */
export function offer(name: string, value: unknown) { if (value != null) incoming[name] = value; }
/** What a named piece would hand on at this moment: for a tab that leaves for another window (tearoff.ts). */
export async function partNow<T>(name: string): Promise<T | undefined> {
  try { return (await parts.get(name)?.()) as T | undefined; } catch { return undefined; }
}
/** True when this page took over from one that was reloaded in place. */
export const resumed = () => resumedNow;

/** Reads what the last page left, if this page replaces one. Call once, before anything asks for a piece. */
export async function loadHandoff() {
  const data = (await api.app.takeHandoff?.()) as Record<string, unknown> | null;
  incoming = data ?? {};
  resumedNow = !!data;
}

api.app.onPrepareReload?.(async () => {
  // A page that never finished starting says nothing, so what the page before it left still stands.
  if (!live) return null;
  const out: Record<string, unknown> = {};
  await Promise.all([...parts].map(async ([name, get]) => { try { out[name] = await get(); } catch {} }));
  return out;
});
