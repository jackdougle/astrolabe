import { api, basename } from './api';
import { isGraph } from './graph';
import { partNow } from './handoff';
import { keepLeaves } from './layout';
import { releaseFile } from './monaco';
import { activeTermPane, EditorPane, hiddenTerms, liveEditors, openFiles, shownTerms, tabGroups, termLabel, uid, useStore } from './store';

// A tab dragged past the edge of the window and let go there becomes a window of its own, as in a browser. A
// terminal tab goes with every terminal it is split into, and their shells never stop: the new window's page is
// handed what a page reloading in place hands on (handoff.ts), so each terminal arrives with its screen and takes
// its shell back. A file goes with its caret, its scroll position and any unsaved typing. A tab that is all its
// window holds takes the window there instead. The main process does the windows (`tearOff` in electron/main.ts).
// Let go over another of the app's windows, the tab joins that window instead (movein.ts), and a window left with
// nothing closes.

export type Torn = { kind: 'tab'; id: string } | { kind: 'file'; pane: string; path: string };

/** How far past the window's edge, in px, the pointer must be before the tab counts as out of it. */
export const TEAR_EDGE = 14;
/** Tabs can leave the window. (False under a main process from before they could.) */
export const canTear = () => !!api.app.tearOver && !!api.app.tearDrop;

/** The tab is the only thing in its window, so nothing would be left behind. */
function alone(t: Torn) {
  const s = useStore.getState();
  return t.kind === 'tab' ? tabGroups(s).length === 1 && !liveEditors(s).length : !tabGroups(s).length && openFiles(s).length === 1;
}

/** What the main process needs to show where the window would be, and to make it: `at` is the pointer, `held` where
 *  in the tab it was taken hold of, `home` the tab's own place in the row. All in px of the page. */
export function tearSpec(t: Torn, at: { x: number; y: number }, held: { x: number; y: number }, home: { x: number; y: number; w: number; h: number }) {
  const s = useStore.getState();
  const lone = alone(t);
  // In its own window the tab is the first of the row. (A file's row starts after the terminals' stretch, or the navigator.)
  const row = document.querySelector('.top-tabs')?.getBoundingClientRect();
  const side = s.sidebar.visible ? s.sidebar.width : 0;
  const x = lone || !row ? home.x : t.kind === 'tab' ? row.left : row.left + Math.max(120, side - row.left) + 8;
  const tab = t.kind === 'tab' ? s.tabs.find((x) => x.id === t.id) : null;
  const term = tab ? s.panes[tab.activePane] : null;
  const name = term?.kind === 'terminal' ? termLabel(term) : null;
  const look = getComputedStyle(document.documentElement);
  return {
    at, grab: { x: x + held.x, y: home.y + held.y }, tab: { x, y: home.y, w: home.w, h: home.h },
    label: name ? `${name.dir} ${name.app}`.trim() : t.kind === 'file' ? (isGraph(t.path) ? 'Graph' : basename(t.path)) : '',
    accent: look.getPropertyValue('--accent').trim(), surface: look.getPropertyValue('--surface').trim(), text: look.getPropertyValue('--text').trim(),
    lone, terms: tab ? shownTerms(s, tab) : [], what: t,
  };
}

/** Hands the tab over to the window to come, and lets it go from this one. Null leaves everything as it is. */
async function pack(t: Torn & { /** It is going to another window, not to one of its own. */ into?: boolean }): Promise<Record<string, unknown> | null> {
  const s = useStore.getState();
  const lone = alone(t);
  if (!s.ready || (lone && !t.into)) return null;
  const window_ = { sidebar: s.sidebar, fullscreen: false, areas: { ratio: s.areas.ratio, full: false }, torn: true };
  const files = await partNow<{ unsaved: Record<string, string>; history: string[] }>('files');
  if (t.kind === 'tab') {
    const tab = s.tabs.find((x) => x.id === t.id);
    if (!tab || s.leaving[tab.id]) return null;
    // Terminals hidden in the tab stay behind, hidden and running in this window.
    const ids = shownTerms(s, tab);
    const root = keepLeaves(tab.root, (id) => ids.includes(id));
    if (!root) return null;
    const out: Record<string, unknown> = {
      layout: { ...window_, tabs: [{ ...tab, root, activePane: ids.includes(tab.activePane) ? tab.activePane : ids[0] }], activeTab: tab.id, panes: Object.fromEntries(ids.map((id) => [id, s.panes[id]])), focus: 'terminal', termCwd: null },
      files: { unsaved: {}, history: files?.history ?? [] },
    };
    for (const id of ids) {
      const snap = await partNow(`term:${id}`);
      if (snap) out[`term:${id}`] = snap;
    }
    // Once this answer is on its way the shells answer to the new window (main.ts), so the terminals closing here end nothing.
    window.setTimeout(() => useStore.getState().closeTab(tab.id), 0);
    return out;
  }
  const from = s.panes[t.pane];
  const file = from?.kind === 'editor' ? from.files.find((f) => f.path === t.path) : null;
  if (from?.kind !== 'editor' || !file || s.leaving[from.id]) return null;
  const pane: EditorPane = { id: uid('e'), kind: 'editor', files: [{ path: file.path, rendered: file.rendered, blank: file.blank }], active: file.path, reveal: null };
  const kept = await partNow<{ views: [string, unknown][]; scroll: number }>(`editor:${from.id}`);
  // Unsaved typing goes along, unless the file is still open in another editor here, which keeps it.
  const elsewhere = Object.values(s.panes).some((p) => p.kind === 'editor' && p.id !== from.id && p.files.some((f) => f.path === t.path));
  const typed = !elsewhere && s.dirty[t.path] ? files?.unsaved[t.path] : undefined;
  window.setTimeout(() => {
    const st = useStore.getState();
    const now = st.panes[from.id];
    // A ⌘N note with nothing added is deleted when its tab closes. This one is only moving.
    if (now?.kind === 'editor') st.patchPane(from.id, { files: now.files.map((f) => (f.path === t.path ? { ...f, blank: undefined } : f)) });
    // It was all the window held (and nothing is hidden in it): the window goes, with nothing unsaved left in it.
    if (lone && !hiddenTerms(st).length) {
      st.setDirty(t.path, false);
      useStore.setState({ tabs: [], panes: {}, leaving: {}, editors: { root: null, active: '', maximized: false } });
      api.state.save({ session: null });
      api.app.closeWindow();
      return;
    }
    st.closeFile(from.id, t.path);
    releaseFile(t.path);
  }, 0);
  return {
    layout: { ...window_, tabs: [], panes: { [pane.id]: pane }, editors: { root: { type: 'leaf', pane: pane.id }, active: pane.id, maximized: false }, focus: 'editor', termCwd: activeTermPane(s)?.cwd ?? s.termCwd },
    files: { unsaved: typed === undefined ? {} : { [t.path]: typed }, history: files?.history ?? [] },
    [`editor:${pane.id}`]: { views: (kept?.views ?? []).filter(([path]) => path === t.path), scroll: from.active === t.path ? kept?.scroll ?? 0 : 0 },
  };
}

api.app.onPrepareMove?.((what) => pack(what as Torn));
