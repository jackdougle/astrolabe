import { create } from 'zustand';
import { api, appInfo, basename, tildify } from './api';
import { carried, carry, hasCarried } from './handoff';
import { addLeaf, addNode, Edge, keepLeaves, LayoutNode, leaves, moveLeaf, removeLeaf, replaceLeaf, setRatio } from './layout';
import { exitDelay } from './motion';
import { bus, markMoving } from './panes';
import { applyTheme, getTheme } from './themes';

export interface TermPane {
  id: string; kind: 'terminal';
  cwd: string; startCwd: string;
  running: boolean; command: string | null; lastExit: number | null;
  /** The running program is an agent waiting for your reply, so its tab does not pulse. */
  waiting?: boolean;
  branch: string | null; dirty: number; gitRoot: string | null;
  integrated: boolean; atPrompt: boolean; exited: boolean;
  /** Hidden (⌘U): when it was. It keeps its place in its tab and its program keeps running; it is only off screen. */
  hidden?: number;
}
export interface OpenFile {
  path: string; rendered: boolean;
  /** On a note made by ⌘N: the text it was made with. Closed while it still holds exactly that, the note is deleted. */
  blank?: string;
  /** A temporary tab: the file was opened to look at, and the next file opened in this editor takes its place.
   *  Saving it, or a double click on it (in the navigator or on its tab), keeps it. */
  temp?: boolean;
}
export interface EditorPane {
  id: string; kind: 'editor';
  files: OpenFile[]; active: string | null;
  /** `end`: put the caret on a fresh line at the end of the note (rendered notes stay rendered). */
  reveal: { path: string; line: number; col: number; n: number; end?: boolean } | null;
}
export type Pane = TermPane | EditorPane;
/** A terminal tab: one block of the row along the top, and the terminals it is split into. */
export interface Tab {
  id: string; root: LayoutNode; activePane: string; maximized: boolean;
  /** A command finished here while you were not looking at its terminals: how it ended, until you look. */
  finished?: 'ok' | 'failed' | null;
  /** The terminal that command ran in. */
  finishedPane?: string;
}
/** The id the editor area's arrangement goes by, wherever a tab's id would go. */
export const EDITORS = 'editors';
/** The editor area: how its editors are arranged (null while no file is open), and the one that has, or last had, the keyboard. */
export interface EditorArea { root: LayoutNode | null; active: string; maximized: boolean }
export type SidebarView = 'files' | 'search';
export type PaletteMode = 'commands' | 'files' | 'history' | 'themes' | 'fonts-notes' | 'fonts-headings' | 'fonts-code' | 'settings' | 'appearance' | 'fonts' | 'sizes' | 'behaviour' | 'keys';

export interface Settings {
  theme: string; zoom: number;
  fontSize: number;
  /** Text size of rendered notes, as a multiple of 14px. */
  notesSize: number;
  /** Text size of the file navigator, in px. */
  sidebarSize: number;
  /** Weight of what you type in the terminal. Medium (500) is the floor; lighter values are raised to it.
   *  Program output is left alone, so replies can mix regular and bold. */
  fontWeight: number;
  /** Google Fonts family for the terminal and raw editor; empty means the built-in Commit Mono. */
  fontFamily: string;
  /** Google Fonts family for the text of rendered notes; empty means SF Pro, the system font. */
  notesFont: string;
  /** Google Fonts family for headings in rendered notes; empty means the bundled Literata. */
  headingFont: string;
  wordWrap: boolean; smoothCaret: boolean;
  /** Where new terminal tabs start, e.g. "~/projects". Empty means your home folder. Splits stay in the folder you split from. */
  startDirectory: string;
  /** Faint constellation lines behind everything. */
  starfield: boolean;
  /** A command that uploads a picture: it is given the file's path as its last argument and prints the picture's web
   *  address. When set, a picture put into a note is uploaded and the note holds that address, so it shows wherever
   *  the note's text goes. Empty (the default) sends nothing anywhere: pictures stay files beside the note. */
  imageUpload: string;
  /** A command that prints what a new note (⌘N) starts with: a date line, a heading, a template. It is given the
   *  note's folder as its last argument. Empty (the default): notes start empty. */
  noteTemplate: string;
  /** A command run each time a file's last tab is closed, with the file's path as its last argument. The last line it
   *  prints, if any, is shown as a message. Empty (the default) runs nothing. */
  onFileClose: string;
  /** 'shell' keeps your own prompt (Powerlevel10k and friends); 'astrolabe' draws the built-in one. */
  prompt: 'shell' | 'astrolabe';
  /** How solid the window background is, from 0 (clear) to 1 (opaque). */
  opacityFocused: number; opacityUnfocused: number;
  /** The same for the tab row. (The editor and the file navigator are always solid.) */
  chromeOpacityFocused: number; chromeOpacityUnfocused: number;
  restoreSession: boolean;
  /** Files open in a temporary tab until they are saved or double-clicked. Off: every file opened gets a tab that stays. */
  previewTabs: boolean;
  /** How far a scroll gesture moves, as a multiple of the system's own distance. Applies to terminals, the editor, notes and the navigator. */
  scrollSpeed: number;
  /** Which side of the terminals the code and notes editor sits on. */
  editorSide: 'left' | 'right';
}
export const DEFAULT_SETTINGS: Settings = {
  theme: 'meridian', zoom: 1, fontSize: 12.5, notesSize: 1, sidebarSize: 12.67, fontWeight: 600, fontFamily: '', notesFont: '', headingFont: '',
  wordWrap: true, smoothCaret: true, restoreSession: true, previewTabs: true, starfield: true, startDirectory: '', imageUpload: '', noteTemplate: '', onFileClose: '',
  prompt: 'shell', opacityFocused: 0.95, opacityUnfocused: 0.89,
  chromeOpacityFocused: 1, chromeOpacityUnfocused: 0.94, scrollSpeed: 2.5, editorSide: 'right',
};

interface State {
  ready: boolean;
  // The window has two areas side by side that know nothing of each other: terminal tabs on one side, editors on the
  // other. Changing tab leaves the files as they are, and opening a file leaves the terminals as they are.
  tabs: Tab[]; activeTab: string;
  editors: EditorArea;
  /** Which area has the keyboard. */
  focus: 'terminal' | 'editor';
  /** `ratio`: the terminals' share of the width while both areas show. `full`: the area with the keyboard fills the window. */
  areas: { ratio: number; full: boolean };
  /** The folder the last terminal to close was in; a terminal brought back beside the editors starts there. */
  termCwd: string | null;
  panes: Record<string, Pane>;
  dirty: Record<string, boolean>;
  sidebar: { visible: boolean; view: SidebarView; width: number };
  palette: { mode: PaletteMode; n: number } | null;
  settings: Settings;
  fullscreen: boolean;
  toast: { text: string; n: number; ms?: number; top?: boolean } | null;
  /** Panes, tabs and file tabs (`fileKey`) fading out after being closed. 'shown' keeps a closing tab's area visible while it fades. */
  leaving: Record<string, 'shown' | 'hidden'>;

  init(): Promise<void>;
  /** `stay` leaves the keyboard where it is and shows both areas. */
  newTab(cwd?: string, opts?: { stay?: boolean }): string;
  closeTab(id: string): void;
  closePane(id: string): void;
  /** Takes a terminal off screen and leaves it running: the one given, or the one used last in the tab in front. */
  hideTerm(id?: string): void;
  /** Brings a hidden terminal back to its place in its tab, with the keyboard. */
  showTerm(id: string): void;
  /** Brings every hidden terminal back. The one hidden last ends up in front. */
  showAllTerms(): void;
  /** A new terminal beside the one used last. Always a terminal, wherever the keyboard is. */
  split(dir: 'row' | 'col'): void;
  setActiveTab(id: string): void;
  focusPane(id: string): void;
  /** Puts the keyboard in the other area, where it was last. */
  focusArea(kind: 'terminal' | 'editor'): void;
  cycleTab(delta: number): void;
  cyclePane(delta: number): void;
  moveTab(from: number, to: number): void;
  /** `tree`: a tab's id, or EDITORS. */
  setRatio(tree: string, splitId: string, ratio: number): void;
  setAreaRatio(ratio: number): void;
  /** Moves a pane against one edge of another pane of its own area (of its own tab, for a terminal), or of the whole of it when `target` is null. */
  movePane(id: string, target: string | null, edge: Edge): void;
  /** Combines two terminal tabs: every terminal on show in `from` goes into `into`, arranged as it was, against one
   *  edge of the terminal `target` there (the right of the whole tab unless told otherwise). Nothing stops running.
   *  `take` gives the keyboard to the terminal that had it in `from`; otherwise it stays where it is in `into`. */
  joinTab(from: string, into: string, at?: { target?: string | null; edge?: Edge; take?: boolean }): void;
  /** Moves one terminal to another tab, against one edge of the terminal `target` there, or (`into` null) to a new
   *  tab of its own beside the one it was in. It keeps running, and takes the keyboard. */
  moveTerm(id: string, into: string | null, at?: { target?: string | null; edge?: Edge }): void;
  /** Takes in a terminal tab that came from another window (movein.ts): into a tab of this one, or as a tab of
   *  the row at `index`. False when it cannot (a terminal of the same name is already here). */
  takeIn(tab: Tab, panes: Record<string, Pane>, place: { tab: string; target: string | null; edge: Edge } | { index: number }): boolean;
  toggleMaximize(): void;
  /** With terminals and editors both open: lets the area you are in fill the window, or shows both again. */
  toggleFull(): void;
  /** Shows the editors, or puts them away with their files as they are. With no file open it opens an editor that
   *  holds nothing yet and asks for a file's name; put away again, that editor goes. Never makes a file itself. */
  toggleEditors(): void;
  /** Moves a file to another file's place in the same editor. */
  moveFile(paneId: string, from: string, to: string): void;
  /** Takes a file out of its editor and puts it in the editor `target` ('into'), or in an editor of its own against
   *  one edge of the editor `target` (of the whole editor area when `target` is null). */
  placeFile(paneId: string, path: string, target: string | null, where: Edge | 'into'): void;
  /** Shows the file you are in a second time, in a new editor against one edge of this one. */
  splitEditor(edge: Edge): void;
  /** Puts the editors left or right of the terminals, and keeps that. */
  setEditorSide(side: 'left' | 'right' | 'toggle'): void;
  patchPane(id: string, patch: Partial<TermPane> | Partial<EditorPane>): void;
  commandFinished(paneId: string, exit: number): void;
  /** Opens a file in the editor used last (the first file opens the editor area). `beside` opens it in a new editor
   *  against that edge of the editor used last instead. `stay` leaves the keyboard where it is. */
  openFile(path: string, pos?: { line: number; col?: number; end?: boolean; blank?: string } | null, opts?: { blank?: string; stay?: boolean; beside?: Edge; keep?: boolean }): void;
  /** Makes a temporary tab one that stays: in one editor, or wherever the file is open. */
  keepFile(path: string, paneId?: string): void;
  closeFile(paneId: string, path: string): void;
  activateFile(paneId: string, path: string): void;
  toggleRendered(paneId: string, path: string): void;
  setDirty(path: string, dirty: boolean): void;
  renamePath(from: string, to: string): void;
  setSidebar(patch: Partial<State['sidebar']>): void;
  openPalette(mode: PaletteMode): void;
  closePalette(): void;
  updateSettings(patch: Partial<Settings>): void;
  /** A short message at the bottom of the window; `ms` keeps it up longer (until the next message). `top` shows it
   *  at the top instead, for something to be noticed once. */
  showToast(text: string, ms?: number, top?: boolean): void;
}

let seq = 0;
export const uid = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

function makeTerm(cwd: string): TermPane {
  return { id: uid('t'), kind: 'terminal', cwd, startCwd: cwd, running: false, waiting: false, command: null, lastExit: null, branch: null, dirty: 0, gitRoot: null, integrated: false, atPrompt: false, exited: false };
}

/** What you type is never lighter than medium. */
export const termWeight = (s: Settings) => String(Math.min(700, Math.max(500, Math.round((Number(s.fontWeight) || 600) / 100) * 100)));

/** The folder new terminal tabs open in. */
export function startDir(s: Settings = useStore.getState().settings) {
  const d = (s.startDirectory || '').trim();
  if (!d || d === '~') return appInfo.home;
  return d.startsWith('~/') ? appInfo.home + d.slice(1) : d;
}

export const isMarkdown = (p: string) => /\.(md|markdown|mdx)$/i.test(p);

export const useStore = create<State>((set, get) => ({
  ready: false,
  tabs: [], activeTab: '',
  editors: { root: null, active: '', maximized: false },
  focus: 'terminal',
  areas: { ratio: 0.5, full: false },
  termCwd: null,
  panes: {},
  dirty: {},
  sidebar: { visible: false, view: 'files', width: 240 },
  palette: null,
  settings: DEFAULT_SETTINGS,
  fullscreen: false,
  toast: null,
  leaving: {},

  async init() {
    const [saved, state] = await Promise.all([api.settings.load(), api.state.load()]);
    const settings = { ...DEFAULT_SETTINGS, ...(saved as Partial<Settings>) };
    // Opacity defaults have been retuned twice. A saved value that still equals an old default was never
    // a choice, so it moves to the current one; anything the user set by hand is left alone.
    const version = (saved as any)?.settingsVersion ?? 1;
    if (version < 4) {
      const was = (key: keyof Settings, ...old: number[]) => old.includes(settings[key] as number);
      if (was('opacityFocused', 0.9)) settings.opacityFocused = DEFAULT_SETTINGS.opacityFocused;
      if (was('opacityUnfocused', 0.6, 0.7)) settings.opacityUnfocused = DEFAULT_SETTINGS.opacityUnfocused;
    }
    if (version < 5) {
      // Unfocused windows now fade only slightly (6 points below focused).
      const was = (key: keyof Settings, ...old: number[]) => old.includes(settings[key] as number);
      if (was('opacityUnfocused', 0.6, 0.7, 0.75)) settings.opacityUnfocused = DEFAULT_SETTINGS.opacityUnfocused;
      if (was('chromeOpacityUnfocused', 0.8)) settings.chromeOpacityUnfocused = DEFAULT_SETTINGS.chromeOpacityUnfocused;
    }
    (settings as any).settingsVersion = 5;
    applyTheme(getTheme(settings.theme));
    api.app.zoom(settings.zoom);
    // A window reloaded in place picks up exactly where the last page left off, shells and all.
    const left = carried<Carried>('layout');
    if (left && (left.tabs?.length || left.editors?.root)) {
      const panes: Record<string, Pane> = {};
      for (const p of Object.values(left.panes)) {
        // A terminal that could not describe itself starts again in its folder.
        panes[p.id] = p.kind === 'editor' ? { ...p, reveal: null } : hasCarried(`term:${p.id}`) ? p : { ...makeTerm(p.cwd), id: p.id };
      }
      const layout = adopt({ ...left, panes });
      if (layout.tabs.length || layout.editors.root) {
        set({ ready: true, settings, sidebar: left.sidebar, fullscreen: left.fullscreen, ...layout });
        // A file taken out of another window is all its own window holds.
        if (!layout.tabs.length && !left.torn) get().newTab(undefined, { stay: true });
        return;
      }
    }
    const session = (state as any)?.session;
    const sidebar = { ...get().sidebar, ...((state as any)?.sidebar ?? {}) };
    if (sidebar.view !== 'search') sidebar.view = 'files';
    if (settings.restoreSession && (session?.tabs?.length || session?.editors?.root)) {
      const panes: Record<string, Pane> = {};
      for (const p of Object.values((session.panes ?? {}) as Record<string, any>)) {
        if (p.kind === 'terminal') panes[p.id] = { ...makeTerm(p.cwd), id: p.id };
        else panes[p.id] = { id: p.id, kind: 'editor', files: p.files ?? [], active: p.active ?? null, reveal: null };
      }
      const layout = adopt({ ...session, panes });
      if (layout.tabs.length || layout.editors.root) {
        set({ ready: true, settings, sidebar, ...layout, tabs: layout.tabs.map((t) => ({ ...t, maximized: false, finished: null })), editors: { ...layout.editors, maximized: false } });
        if (!layout.tabs.length) get().newTab(undefined, { stay: true });
        return;
      }
    }
    set({ ready: true, settings, sidebar });
    get().newTab();
  },

  newTab(cwd, opts) {
    const s = get();
    const pane = makeTerm(cwd ?? startDir(s.settings));
    const tab: Tab = { id: uid('tab'), root: { type: 'leaf', pane: pane.id }, activePane: pane.id, maximized: false };
    const idx = s.tabs.findIndex((t) => t.id === s.activeTab);
    const tabs = [...s.tabs];
    tabs.splice(idx + 1, 0, tab);
    set({ panes: { ...s.panes, [pane.id]: pane }, tabs, activeTab: tab.id, focus: opts?.stay && s.editors.root ? s.focus : 'terminal', areas: opts?.stay ? { ...s.areas, full: false } : s.areas });
    return tab.id;
  },

  // Closing is two steps: focus moves on at once and the closed thing fades out, then it is removed.
  closeTab(id) {
    const s = get();
    const tab = s.tabs.find((t) => t.id === id);
    if (!tab || s.leaving[id]) return;
    const all = leaves(tab.root);
    const hid = all.filter((p) => isHidden(s.panes[p]));
    // A tab with every terminal hidden is not on screen, so it simply goes.
    if (hid.length === all.length) { removeTab(id); return; }
    // Terminals hidden in this tab stay hidden, and running: only the ones on show close.
    const finish = hid.length ? () => removeShown(id, all.filter((p) => !hid.includes(p))) : () => removeTab(id);
    const remaining = tabGroups(s).filter((t) => t.id !== id);
    if (!remaining.length && !liveEditors(s).length) {
      // The window goes with its last tab only when no file is open either, and nothing is hidden.
      if (!hiddenTerms(s).length) { set({ tabs: [], panes: {}, leaving: {}, editors: { root: null, active: '', maximized: false } }); dropBlankNotes(s.panes); api.state.save({ session: null }); api.app.closeWindow(); return; }
      // Hidden terminals are still running, so the window stays, with a new terminal in it.
      get().newTab();
      fadeOut(id, false, finish);
      return;
    }
    const wasActive = s.activeTab === id;
    if (!remaining.length) {
      // The last terminal goes like any other: the files that are open are left with the window, and the keyboard.
      set({ focus: 'editor', areas: { ...s.areas, full: false } });
    } else if (wasActive) {
      const idx = s.tabs.filter((t) => t.id === id || remaining.includes(t)).indexOf(tab);
      set({ activeTab: remaining[Math.min(idx, remaining.length - 1)].id });
    }
    fadeOut(id, wasActive, finish);
  },

  closePane(id) {
    const s = get();
    const tree = treeOf(s, id);
    if (!tree) return;
    // A hidden terminal is not on screen: it goes without changing what is.
    if (isHidden(s.panes[id])) { removePane(id); return; }
    if (s.leaving[id]) return;
    const order = leaves(tree.root).filter((p) => p === id || (!s.leaving[p] && !isHidden(s.panes[p])));
    const rest = order.filter((p) => p !== id);
    if (tree.id === EDITORS) {
      // The last editor takes the editor area with it, and the keyboard goes back to the terminals.
      if (!rest.length) set({ focus: 'terminal', areas: { ...s.areas, full: false } });
      else set({ editors: { ...s.editors, active: s.editors.active === id ? rest[Math.min(order.indexOf(id), rest.length - 1)] : s.editors.active, maximized: false } });
      fadeOut(id, true, () => removePane(id));
      return;
    }
    if (!rest.length) { get().closeTab(tree.id); return; }
    const tab = s.tabs.find((t) => t.id === tree.id)!;
    const next = tab.activePane === id ? rest[Math.min(order.indexOf(id), rest.length - 1)] : tab.activePane;
    set({ tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, activePane: next, maximized: false } : t)) });
    fadeOut(id, true, () => removePane(id));
  },

  hideTerm(id) {
    const s = get();
    const tab = id ? s.tabs.find((t) => leaves(t.root).includes(id)) : tabGroups(s).find((t) => t.id === s.activeTab);
    const pane = tab ? s.panes[id ?? tab.activePane] : null;
    if (!tab || pane?.kind !== 'terminal' || pane.hidden || s.leaving[pane.id] || s.leaving[tab.id]) return;
    const order = shownTerms(s, tab);
    const rest = order.filter((p) => p !== pane.id);
    const panes: Record<string, Pane> = { ...s.panes, [pane.id]: { ...pane, hidden: Date.now() } };
    if (rest.length) {
      // The terminals beside it take its room, and the keyboard.
      const next = tab.activePane === pane.id ? rest[Math.min(order.indexOf(pane.id), rest.length - 1)] : tab.activePane;
      set({ panes, tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, activePane: next, maximized: false } : t)) });
    } else {
      // The only terminal on show in its tab: the tab leaves the row with it.
      const groups = tabGroups(s);
      const remaining = groups.filter((t) => t.id !== tab.id);
      if (remaining.length) set({ panes, activeTab: s.activeTab === tab.id ? remaining[Math.min(groups.indexOf(tab), remaining.length - 1)].id : s.activeTab });
      else if (liveEditors(s).length) set({ panes, activeTab: '', focus: 'editor', areas: { ...s.areas, full: false } });
      // Nothing else is open: a new terminal takes its place, so the window is never empty.
      else { set({ panes }); get().newTab(); }
    }
    // It fades out as a closed terminal does, but it is only marked hidden, never removed.
    fadeOut(pane.id, true, () => {});
  },

  showTerm(id) {
    const s = get();
    const pane = s.panes[id];
    const tab = s.tabs.find((t) => leaves(t.root).includes(id));
    if (!tab || pane?.kind !== 'terminal' || !pane.hidden || s.leaving[tab.id]) return;
    const { [id]: _fading, ...leaving } = s.leaving;
    set({
      leaving, panes: { ...s.panes, [id]: { ...pane, hidden: undefined } }, activeTab: tab.id, focus: 'terminal',
      tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, activePane: id, maximized: false } : t)),
    });
  },

  showAllTerms() {
    for (const p of hiddenTerms(get()).reverse()) get().showTerm(p.id);
  },

  split(dir) {
    const s = get();
    const tab = s.tabs.find((t) => t.id === s.activeTab && !s.leaving[t.id]);
    // With no terminal open, the first one opens beside the editors.
    if (!tab) { get().newTab(s.termCwd ?? undefined); return; }
    const from = s.panes[tab.activePane];
    const pane = makeTerm(from?.kind === 'terminal' ? from.cwd : appInfo.home);
    const root = replaceLeaf(tab.root, tab.activePane, (leaf) => ({ type: 'split', id: uid('s'), dir, ratio: 0.5, a: leaf, b: { type: 'leaf', pane: pane.id } }));
    set({
      panes: { ...s.panes, [pane.id]: pane }, focus: 'terminal', areas: s.focus === 'editor' ? { ...s.areas, full: false } : s.areas,
      tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, root, activePane: pane.id, maximized: false } : t)),
    });
  },

  setActiveTab(id) {
    const s = get();
    if (!tabGroups(s).some((t) => t.id === id)) return;
    set({ activeTab: id, focus: 'terminal' });
  },

  commandFinished(paneId, exit) {
    const s = get();
    const tab = s.tabs.find((t) => leaves(t.root).includes(paneId));
    // Nothing to flag when its terminals are in front of you, or when it is hidden (its row in the list shows how it ended).
    if (!tab || isHidden(s.panes[paneId]) || (tab.id === s.activeTab && showing(s) !== 'editor')) return;
    set({ tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, finished: exit ? 'failed' : 'ok', finishedPane: paneId } : t)) });
  },

  focusPane(id) {
    const s = get();
    const p = s.panes[id];
    if (!p || s.leaving[id] || isHidden(p)) return;
    if (p.kind === 'editor') {
      if (s.focus !== 'editor' || s.editors.active !== id) set({ focus: 'editor', editors: { ...s.editors, active: id } });
      return;
    }
    const tab = s.tabs.find((t) => leaves(t.root).includes(id));
    if (!tab || s.leaving[tab.id]) return;
    if (tab.activePane === id && s.activeTab === tab.id && s.focus === 'terminal') return;
    set({ activeTab: tab.id, focus: 'terminal', tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, activePane: id } : t)) });
  },

  focusArea(kind) {
    const s = get();
    if (kind === 'editor' ? !liveEditors(s).length : !s.tabs.some((t) => t.id === s.activeTab && !s.leaving[t.id])) return;
    set({ focus: kind });
  },

  cycleTab(delta) {
    const s = get();
    const row = tabGroups(s);
    const i = row.findIndex((t) => t.id === s.activeTab);
    if (i < 0) return;
    get().setActiveTab(row[(i + delta + row.length) % row.length].id);
  },

  cyclePane(delta) {
    const s = get();
    const tab = s.tabs.find((t) => t.id === s.activeTab);
    if (!tab) return;
    const order = shownTerms(s, tab);
    const next = order[(order.indexOf(tab.activePane) + delta + order.length) % order.length];
    get().focusPane(next);
  },

  moveTab(from, to) {
    const tabs = [...get().tabs];
    if (from < 0 || from >= tabs.length || to < 0 || to >= tabs.length || from === to) return;
    const [t] = tabs.splice(from, 1);
    tabs.splice(to, 0, t);
    set({ tabs });
  },

  setRatio(tree, splitId, ratio) {
    const s = get();
    const r = Math.min(1, Math.max(0, ratio));
    if (tree === EDITORS) { if (s.editors.root) set({ editors: { ...s.editors, root: setRatio(s.editors.root, splitId, r) } }); }
    else set({ tabs: s.tabs.map((t) => (t.id === tree ? { ...t, root: setRatio(t.root, splitId, r) } : t)) });
  },

  setAreaRatio(ratio) { set({ areas: { ...get().areas, ratio: Math.min(0.95, Math.max(0.05, ratio)) } }); },

  movePane(id, target, edge) {
    const s = get();
    const tree = treeOf(s, id);
    if (!tree || s.leaving[id] || (target && s.leaving[target])) return;
    const root = moveLeaf(tree.root, id, target, edge, uid('s'));
    if (root === tree.root) return;
    if (tree.id === EDITORS) set({ focus: 'editor', editors: { root, active: id, maximized: false } });
    else set({ activeTab: tree.id, focus: 'terminal', tabs: s.tabs.map((t) => (t.id === tree.id ? { ...t, root, activePane: id, maximized: false } : t)) });
  },

  joinTab(from, into, at) {
    const s = get();
    const a = s.tabs.find((t) => t.id === from);
    const b = s.tabs.find((t) => t.id === into);
    if (!a || !b || a === b || s.leaving[a.id] || s.leaving[b.id]) return;
    const ids = shownTerms(s, a);
    const sub = keepLeaves(a.root, (id) => ids.includes(id));
    if (!sub) return;
    // Terminals hidden in `from` stay in it, hidden and running.
    const rest = keepLeaves(a.root, (id) => !ids.includes(id));
    const there = shownTerms(s, b);
    const target = at?.target && there.includes(at.target) ? at.target : null;
    const active = at?.take && ids.includes(a.activePane) ? a.activePane : there.includes(b.activePane) ? b.activePane : ids[0];
    markMoving(ids);
    const root = addNode(b.root, sub, target, at?.edge ?? 'right', uid('s'));
    const tabs = s.tabs.flatMap((t): Tab[] => {
      if (t.id === a.id) return rest ? [{ ...t, root: rest, activePane: leaves(rest)[0], maximized: false, finished: null, finishedPane: undefined }] : [];
      return t.id === b.id ? [{ ...t, root, activePane: active, maximized: false }] : [t];
    });
    set({ tabs, activeTab: b.id, focus: 'terminal' });
  },

  moveTerm(id, into, at) {
    const s = get();
    const a = s.tabs.find((t) => leaves(t.root).includes(id));
    const pane = s.panes[id];
    if (!a || pane?.kind !== 'terminal' || pane.hidden || s.leaving[id] || s.leaving[a.id] || into === a.id) return;
    const shown = shownTerms(s, a);
    const rest = removeLeaf(a.root, id);
    const b = into ? s.tabs.find((t) => t.id === into) : null;
    // Alone on show in its tab, it has a tab of its own already.
    if (into ? !b || !!s.leaving[b.id] : shown.length < 2 || !rest) return;
    const left = shown.filter((p) => p !== id);
    const was: Tab[] = rest ? [{ ...a, root: rest, activePane: a.activePane !== id ? a.activePane : left[Math.min(shown.indexOf(id), left.length - 1)] ?? leaves(rest)[0], maximized: false }] : [];
    markMoving([id]);
    const leaf: LayoutNode = { type: 'leaf', pane: id };
    if (!b) {
      const tab: Tab = { id: uid('tab'), root: leaf, activePane: id, maximized: false };
      set({ tabs: s.tabs.flatMap((t) => (t.id === a.id ? [...was, tab] : [t])), activeTab: tab.id, focus: 'terminal' });
      return;
    }
    const target = at?.target && shownTerms(s, b).includes(at.target) ? at.target : null;
    const root = addNode(b.root, leaf, target, at?.edge ?? 'right', uid('s'));
    set({ tabs: s.tabs.flatMap((t) => (t.id === a.id ? was : t.id === b.id ? [{ ...t, root, activePane: id, maximized: false }] : [t])), activeTab: b.id, focus: 'terminal' });
  },

  takeIn(tab, incoming, place) {
    const s = get();
    const ids = tab?.root ? leaves(tab.root) : [];
    if (!s.ready || !ids.length || ids.some((id) => s.panes[id] || incoming[id]?.kind !== 'terminal')) return false;
    const panes = { ...s.panes };
    // A terminal that could not describe itself starts again in its folder.
    for (const id of ids) { const p = incoming[id] as TermPane; panes[id] = hasCarried(`term:${id}`) ? { ...p, hidden: undefined } : { ...makeTerm(p.cwd), id }; }
    const active = ids.includes(tab.activePane) ? tab.activePane : ids[0];
    const b = 'tab' in place ? s.tabs.find((t) => t.id === place.tab && !s.leaving[t.id]) : null;
    if (b && 'tab' in place) {
      const target = place.target && shownTerms(s, b).includes(place.target) ? place.target : null;
      const root = addNode(b.root, tab.root, target, place.edge, uid('s'));
      set({ panes, tabs: s.tabs.map((t) => (t.id === b.id ? { ...t, root, activePane: active, maximized: false } : t)), activeTab: b.id, focus: 'terminal' });
      return true;
    }
    const id = s.tabs.some((t) => t.id === tab.id) ? uid('tab') : tab.id;
    const row = tabGroups(s);
    const before = 'index' in place ? row[place.index] : undefined;
    const tabs = [...s.tabs];
    tabs.splice(before ? tabs.indexOf(before) : tabs.length, 0, { id, root: tab.root, activePane: active, maximized: false, finished: null });
    set({ panes, tabs, activeTab: id, focus: 'terminal' });
    return true;
  },

  toggleMaximize() {
    const s = get();
    if (s.focus === 'editor' && s.editors.root) {
      if (liveEditors(s).length < 2 && !s.editors.maximized) return;
      set({ editors: { ...s.editors, maximized: !s.editors.maximized } });
      return;
    }
    const tab = s.tabs.find((t) => t.id === s.activeTab);
    if (!tab || (shownTerms(s, tab).length < 2 && !tab.maximized)) return;
    set({ tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, maximized: !t.maximized } : t)) });
  },

  toggleFull() {
    const s = get();
    if (!liveEditors(s).length || !tabGroups(s).length) return;
    set({ areas: { ...s.areas, full: !s.areas.full } });
  },

  toggleEditors() {
    const s = get();
    const live = liveEditors(s);
    if (!live.length) {
      const pane: EditorPane = { id: uid('e'), kind: 'editor', files: [], active: null, reveal: null };
      set({ panes: { ...s.panes, [pane.id]: pane }, editors: { root: { type: 'leaf', pane: pane.id }, active: pane.id, maximized: false }, focus: 'editor', areas: { ...s.areas, full: false } });
      return;
    }
    if (showing(s) === 'terminal') { set({ focus: 'editor', areas: { ...s.areas, full: false } }); return; }
    // Editors that hold nothing are closed; ones with files are only hidden, behind terminals that fill the window.
    if (live.every((e) => !e.files.length)) { for (const e of live) get().closePane(e.id); return; }
    if (tabGroups(s).length) set({ focus: 'terminal', areas: { ...s.areas, full: true } });
  },

  moveFile(paneId, from, to) {
    const p = get().panes[paneId];
    if (!p || p.kind !== 'editor') return;
    const files = [...p.files];
    const i = files.findIndex((f) => f.path === from);
    const j = files.findIndex((f) => f.path === to);
    if (i < 0 || j < 0 || i === j) return;
    const [f] = files.splice(i, 1);
    files.splice(j, 0, f);
    set({ panes: { ...get().panes, [paneId]: { ...p, files } } });
  },

  placeFile(paneId, path, target, where) {
    const s = get();
    const from = s.panes[paneId];
    const tree = s.editors.root;
    if (!tree || from?.kind !== 'editor' || s.leaving[paneId] || s.leaving[fileKey(paneId, path)]) return;
    if (target && (s.leaving[target] || !leaves(tree).includes(target))) return;
    const at = from.files.findIndex((f) => f.path === path);
    if (at < 0) return;
    const file = from.files[at];
    const rest = from.files.filter((f) => f.path !== path);
    // The editor it leaves shows the file that was next to it.
    const left: EditorPane = { ...from, files: rest, active: from.active === path ? rest[Math.min(at, rest.length - 1)]?.path ?? null : from.active, reveal: null };
    if (where === 'into') {
      const to = target ? s.panes[target] : null;
      if (to?.kind !== 'editor' || to.id === paneId) return;
      const panes: Record<string, Pane> = { ...s.panes, [to.id]: { ...to, files: to.files.some((f) => f.path === path) ? to.files : [...to.files, file], active: path, reveal: null } };
      let root = tree;
      // An editor left with nothing in it goes.
      if (rest.length) panes[paneId] = left; else { delete panes[paneId]; root = removeLeaf(root, paneId) ?? root; }
      set({ panes, focus: 'editor', editors: { root, active: to.id, maximized: false } });
      return;
    }
    // Its only file: the editor itself moves there.
    if (!rest.length) { get().movePane(paneId, target, where); return; }
    const pane: EditorPane = { id: uid('e'), kind: 'editor', files: [file], active: path, reveal: null };
    set({ panes: { ...s.panes, [paneId]: left, [pane.id]: pane }, focus: 'editor', editors: { root: addLeaf(tree, pane.id, target, where, uid('s')), active: pane.id, maximized: false } });
  },

  splitEditor(edge) {
    const s = get();
    const from = s.editors.root ? s.panes[s.editors.active] : null;
    const file = from?.kind === 'editor' ? from.files.find((f) => f.path === from.active) : null;
    if (!s.editors.root || !from || !file || s.leaving[from.id]) return;
    const pane: EditorPane = { id: uid('e'), kind: 'editor', files: [{ ...file }], active: file.path, reveal: null };
    set({ panes: { ...s.panes, [pane.id]: pane }, focus: 'editor', editors: { root: addLeaf(s.editors.root, pane.id, from.id, edge, uid('s')), active: pane.id, maximized: false } });
  },

  setEditorSide(side) {
    const now = get().settings.editorSide;
    const want: 'left' | 'right' = side === 'toggle' ? (now === 'left' ? 'right' : 'left') : side;
    if (now !== want) get().updateSettings({ editorSide: want });
  },

  patchPane(id, patch) {
    const p = get().panes[id];
    if (!p) return;
    let changed = false;
    for (const k of Object.keys(patch)) if ((p as any)[k] !== (patch as any)[k]) { changed = true; break; }
    if (changed) set({ panes: { ...get().panes, [id]: { ...p, ...patch } as Pane } });
  },

  openFile(path, pos, opts) {
    const s = get();
    const reveal = pos ? { path, line: pos.line, col: pos.col ?? 1, n: Date.now(), end: pos.end } : null;
    const rendered = isMarkdown(path) && (!pos || !!pos.end);
    const blank = opts?.blank ?? pos?.blank;
    // A file opened to look at gets a temporary tab. One made here (a new note), the graph, and one asked to be kept, stay.
    const temp = s.settings.previewTabs && !opts?.keep && blank === undefined && !path.startsWith('graph:');
    const live = liveEditors(s);
    const last = live.find((e) => e.id === s.editors.active) ?? live[0] ?? null;
    const focus = opts?.stay && s.tabs.length ? s.focus : 'editor';
    // Opened from the terminals while they fill the window, a file shows beside them; opened from the editors, it stays as it was.
    const areas = { ...s.areas, full: s.areas.full && s.focus === 'editor' };
    if (last && !opts?.beside) {
      const has = last.files.some((f) => f.path === path);
      // Reopening a file tab that is still fading out keeps it.
      const key = fileKey(last.id, path);
      if (s.leaving[key]) { const { [key]: _kept, ...leaving } = s.leaving; set({ leaving }); }
      const next: OpenFile = { path, rendered, blank, ...(temp ? { temp: true } : null) };
      // The editor's temporary tab gives its place to the file: unless it holds unsaved typing, which is never dropped.
      const old = !has && temp ? last.files.find((f) => f.temp && !s.dirty[f.path] && !s.leaving[fileKey(last.id, f.path)]) : undefined;
      const files = has ? (opts?.keep ? last.files.map((f) => (f.path === path && f.temp ? { ...f, temp: undefined } : f)) : last.files)
        : old ? last.files.map((f) => (f === old ? next : f)) : [...last.files, next];
      set({ panes: { ...s.panes, [last.id]: { ...last, files, active: path, reveal } }, focus, areas, editors: { ...s.editors, active: last.id } });
      if (old) bus.emit('file.closed', old.path); // its buffer is let go (monaco.ts)
      return;
    }
    const pane: EditorPane = { id: uid('e'), kind: 'editor', files: [{ path, rendered, blank, ...(temp ? { temp: true } : null) }], active: path, reveal };
    // The first file opens the editor area; a file opened to the side takes half of the editor used last.
    const root: LayoutNode = s.editors.root && last ? addLeaf(s.editors.root, pane.id, last.id, opts?.beside ?? 'right', uid('s')) : s.editors.root ? addLeaf(s.editors.root, pane.id, null, 'right', uid('s')) : { type: 'leaf', pane: pane.id };
    set({ panes: { ...s.panes, [pane.id]: pane }, focus, areas, editors: { root, active: pane.id, maximized: false } });
  },

  closeFile(paneId, path) {
    const p = get().panes[paneId];
    const key = fileKey(paneId, path);
    if (!p || p.kind !== 'editor' || get().leaving[key] || get().leaving[paneId]) return;
    const live = p.files.filter((f) => f.path === path || !get().leaving[fileKey(paneId, f.path)]);
    const idx = live.findIndex((f) => f.path === path);
    if (idx < 0) return;
    const files = live.filter((f) => f.path !== path);
    if (!files.length) {
      // Closing the last file when nothing else is open leaves you at an empty terminal, not a closed app.
      const s = get();
      if (!tabGroups(s).length && liveEditors(s).length === 1) {
        const { [paneId]: _gone, ...rest } = s.panes;
        set({ panes: rest, editors: { root: null, active: '', maximized: false }, areas: { ...s.areas, full: false } });
        get().newTab();
        dropBlankNotes(s.panes);
        return;
      }
      get().closePane(paneId);
      return;
    }
    const active = p.active === path ? files[Math.min(idx, files.length - 1)].path : p.active;
    set({ panes: { ...get().panes, [paneId]: { ...p, active } } });
    fadeOut(key, true, () => removeFile(paneId, path));
  },

  activateFile(paneId, path) { get().patchPane(paneId, { active: path }); },

  keepFile(path, paneId) {
    const s = get();
    const held = (p: Pane) => p.kind === 'editor' && (!paneId || p.id === paneId) && p.files.some((f) => f.path === path && f.temp);
    if (!Object.values(s.panes).some(held)) return;
    set({ panes: Object.fromEntries(Object.entries(s.panes).map(([id, p]) => [id, held(p) && p.kind === 'editor' ? { ...p, files: p.files.map((f) => (f.path === path ? { ...f, temp: undefined } : f)) } : p])) });
  },

  toggleRendered(paneId, path) {
    const p = get().panes[paneId];
    if (!p || p.kind !== 'editor') return;
    set({ panes: { ...get().panes, [paneId]: { ...p, files: p.files.map((f) => (f.path === path ? { ...f, rendered: !f.rendered } : f)) } } });
  },

  setDirty(path, dirty) {
    if (!!get().dirty[path] === dirty) return;
    const next = { ...get().dirty, [path]: dirty };
    set({ dirty: next });
    api.app.unsavedCount(Object.values(next).filter(Boolean).length);
  },

  renamePath(from, to) {
    const s = get();
    const move = (p: string) => (p === from || p.startsWith(from + '/') ? to + p.slice(from.length) : p);
    const panes: Record<string, Pane> = {};
    for (const p of Object.values(s.panes)) {
      // A ⌘N note that is given a name of its own is no longer a blank one to clear away.
      panes[p.id] = p.kind === 'editor' ? { ...p, files: p.files.map((f) => ({ ...f, path: move(f.path), blank: f.path === from ? undefined : f.blank })), active: p.active ? move(p.active) : null, reveal: null } : p;
    }
    set({ panes, dirty: Object.fromEntries(Object.entries(s.dirty).map(([k, v]) => [move(k), v])) });
  },

  setSidebar(patch) { set({ sidebar: { ...get().sidebar, ...patch } }); },
  openPalette(mode) { set({ palette: { mode, n: Date.now() } }); },
  closePalette() { set({ palette: null }); },

  updateSettings(patch) {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    if (patch.theme) applyTheme(getTheme(settings.theme));
    if (patch.zoom) api.app.zoom(settings.zoom);
    api.settings.save(settings);
  },

  showToast(text, ms, top) { set({ toast: { text, n: Date.now(), ms, top } }); },
}));

export const fileKey = (paneId: string, path: string) => `${paneId}\n${path}`;

type Layout = Pick<State, 'tabs' | 'panes' | 'editors' | 'leaving'>;

/** The editors that are open and not on their way out, in the order they sit on screen. */
export function liveEditors(s: Pick<State, 'panes' | 'editors' | 'leaving'>): EditorPane[] {
  if (!s.editors.root) return [];
  return leaves(s.editors.root).filter((id) => !s.leaving[id]).map((id) => s.panes[id]).filter((p): p is EditorPane => p?.kind === 'editor');
}
const isHidden = (p: Pane | undefined) => p?.kind === 'terminal' && !!p.hidden;
/** The terminals of a tab that are on show: not on their way out, and not hidden. */
export function shownTerms(s: Pick<State, 'panes' | 'leaving'>, tab: Pick<Tab, 'root'>): string[] {
  return leaves(tab.root).filter((id) => !s.leaving[id] && !isHidden(s.panes[id]));
}
/** The terminals hidden with ⌘U, the one hidden last first. They are still in their tabs and still running. */
export function hiddenTerms(s: Pick<State, 'panes'>): TermPane[] {
  return Object.values(s.panes).filter((p): p is TermPane => p.kind === 'terminal' && !!p.hidden).sort((a, b) => b.hidden! - a.hidden!);
}
/** The blocks of the tab row, left to right: every terminal tab still open with a terminal on show. ⌘1–9 count these. */
export function tabGroups(s: Pick<State, 'tabs' | 'panes' | 'leaving'>): Tab[] {
  return s.tabs.filter((t) => !s.leaving[t.id] && shownTerms(s, t).length > 0);
}
/** The tab in front and the area with the keyboard, once terminals have gone: a tab still in the row, else the editors. */
function frontAfter(s: Pick<State, 'tabs' | 'panes' | 'leaving' | 'activeTab' | 'focus'>): Pick<State, 'activeTab' | 'focus'> {
  const groups = tabGroups(s);
  return { activeTab: groups.some((t) => t.id === s.activeTab) ? s.activeTab : groups[0]?.id ?? '', focus: groups.length ? s.focus : 'editor' };
}
/** Every open file, in the order their tabs sit in the row. ⌥⌘1–9 count these. */
export function openFiles(s: Pick<State, 'panes' | 'editors' | 'leaving'>): { pane: string; path: string }[] {
  return liveEditors(s).flatMap((e) => e.files.filter((f) => !s.leaving[fileKey(e.id, f.path)]).map((f) => ({ pane: e.id, path: f.path })));
}
/** What the window has on screen: both areas side by side, or one of them filling it. */
export function showing(s: Pick<State, 'tabs' | 'panes' | 'editors' | 'leaving' | 'focus' | 'areas'>): 'both' | 'terminal' | 'editor' {
  const editors = liveEditors(s).length > 0;
  const terms = tabGroups(s).length > 0;
  if (!editors) return 'terminal';
  if (!terms) return 'editor';
  if (!s.areas.full) return 'both';
  return s.focus;
}
/** The pane that has the keyboard. */
export function focusedId(s: Pick<State, 'tabs' | 'activeTab' | 'editors' | 'focus'> = useStore.getState()): string | null {
  const term = s.tabs.find((t) => t.id === s.activeTab)?.activePane ?? null;
  const editor = s.editors.root ? s.editors.active : null;
  return s.focus === 'editor' ? editor ?? term : term ?? editor;
}
/** The arrangement a pane belongs to: its tab's, or the editor area's. */
function treeOf(s: Pick<State, 'tabs' | 'editors'>, pane: string): { id: string; root: LayoutNode } | null {
  if (s.editors.root && leaves(s.editors.root).includes(pane)) return { id: EDITORS, root: s.editors.root };
  const tab = s.tabs.find((t) => leaves(t.root).includes(pane));
  return tab ? { id: tab.id, root: tab.root } : null;
}

/** What is kept of the layout between launches, and handed across when a page reloads in place (see handoff.ts). */
interface SavedLayout { tabs?: any[]; activeTab?: string; panes: Record<string, Pane>; editors?: EditorArea; focus?: State['focus']; areas?: State['areas']; termCwd?: string | null }
/** Checks a saved layout against its panes and brings it into the present shape. One saved before the terminals and
 *  the editors were parted has editors inside its tabs: those tabs keep their terminals, and every file that was open
 *  goes to one editor (the front tab's own, so that it keeps its place in each file). */
function adopt(saved: SavedLayout): Pick<State, 'tabs' | 'activeTab' | 'panes' | 'editors' | 'focus' | 'areas' | 'termCwd'> {
  const panes = { ...saved.panes };
  const kind = (id: string) => panes[id]?.kind;
  const old = (saved.tabs ?? []) as (Tab & { full?: boolean })[];
  const tabs: Tab[] = [];
  for (const t of old) {
    if (!t?.root || !leaves(t.root).every((id) => panes[id])) continue;
    const root = keepLeaves(t.root, (id) => kind(id) === 'terminal');
    if (!root) continue;
    const ids = leaves(root);
    tabs.push({ id: t.id, root, activePane: ids.includes(t.activePane) ? t.activePane : ids[0], maximized: !!t.maximized && ids.length === leaves(t.root).length, finished: t.finished ?? null, finishedPane: t.finishedPane });
  }
  const front = old.find((t) => t.id === saved.activeTab);
  let editors: EditorArea = { root: null, active: '', maximized: false };
  let focus: State['focus'] = saved.focus ?? (front && kind(front.activePane) === 'editor' ? 'editor' : 'terminal');
  if (saved.editors) {
    const root = saved.editors.root ? keepLeaves(saved.editors.root, (id) => kind(id) === 'editor') : null;
    const ids = root ? leaves(root) : [];
    if (root) editors = { root, active: ids.includes(saved.editors.active) ? saved.editors.active : ids[0], maximized: !!saved.editors.maximized };
  } else {
    const inTabs = old.flatMap((t) => (t?.root ? leaves(t.root) : [])).filter((id) => kind(id) === 'editor');
    const mine = front ? leaves(front.root).filter((id) => kind(id) === 'editor') : [];
    const order = [...new Set([...(mine.includes(front?.activePane ?? '') ? [front!.activePane] : []), ...mine, ...inTabs])];
    const keep = order[0] ? (panes[order[0]] as EditorPane) : null;
    if (keep) {
      const files = [...keep.files];
      for (const id of order.slice(1)) for (const f of (panes[id] as EditorPane).files) if (!files.some((x) => x.path === f.path)) files.push(f);
      for (const id of order.slice(1)) delete panes[id];
      panes[keep.id] = { ...keep, files, active: keep.active ?? files[0]?.path ?? null };
      if (files.length) editors = { root: { type: 'leaf', pane: keep.id }, active: keep.id, maximized: false }; else delete panes[keep.id];
    }
  }
  // Nothing is kept that the layout does not show.
  const used = new Set([...tabs.flatMap((t) => leaves(t.root)), ...(editors.root ? leaves(editors.root) : [])]);
  for (const id of Object.keys(panes)) if (!used.has(id)) delete panes[id];
  // A tab whose terminals are all hidden is not in the row, so it is never the one in front.
  const seen = tabs.filter((t) => leaves(t.root).some((id) => !isHidden(panes[id])));
  if (focus === 'editor' ? !editors.root : !seen.length) focus = editors.root && !seen.length ? 'editor' : 'terminal';
  const ratio = Number(saved.areas?.ratio);
  return {
    tabs, panes, editors, focus, termCwd: saved.termCwd ?? null,
    activeTab: seen.find((t) => t.id === saved.activeTab)?.id ?? seen[0]?.id ?? '',
    areas: { ratio: ratio > 0.04 && ratio < 0.96 ? ratio : 0.5, full: saved.areas ? !!saved.areas.full : !!front?.full },
  };
}

/** What a page reloading in place leaves for the next one (see handoff.ts). */
interface Carried extends SavedLayout { sidebar: State['sidebar']; fullscreen: boolean; /** It is a tab taken out of another window (tearoff.ts). */ torn?: boolean }
carry('layout', (): Carried | null => {
  const s = useStore.getState();
  if (!s.ready || (!s.tabs.length && !s.editors.root)) return null;
  // Whatever was fading out after being closed is gone.
  const tabs = s.tabs.filter((t) => !s.leaving[t.id]);
  return { tabs, activeTab: s.activeTab, panes: s.panes, editors: s.editors, focus: s.focus, areas: s.areas, termCwd: s.termCwd, sidebar: s.sidebar, fullscreen: s.fullscreen };
});

/** Marks something as leaving so it can animate out, then runs `finish` (unless the close was called off meanwhile). */
function fadeOut(key: string, shown: boolean, finish: () => void) {
  const ms = exitDelay();
  if (!ms) { finish(); return; }
  useStore.setState((s) => ({ leaving: { ...s.leaving, [key]: shown ? 'shown' : 'hidden' } }));
  window.setTimeout(() => {
    const s = useStore.getState();
    if (!s.leaving[key]) return;
    const { [key]: _done, ...leaving } = s.leaving;
    useStore.setState({ leaving });
    finish();
  }, ms);
}

function removeTab(id: string) {
  const s = useStore.getState();
  const tab = s.tabs.find((t) => t.id === id);
  if (!tab) return;
  const gone = new Set(leaves(tab.root));
  const tabs = s.tabs.filter((t) => t.id !== id);
  if (!tabs.length && !s.editors.root) return;
  const last = s.panes[tab.activePane];
  const panes = Object.fromEntries(Object.entries(s.panes).filter(([k]) => !gone.has(k)));
  useStore.setState({ tabs, panes, ...frontAfter({ ...s, tabs, panes }), termCwd: last?.kind === 'terminal' && !last.hidden ? last.cwd : s.termCwd });
  dropBlankNotes(s.panes);
}

/** Takes the terminals `ids` out of a tab that keeps others: hidden ones, which stay in it and stay running. */
function removeShown(tabId: string, ids: string[]) {
  const s = useStore.getState();
  const tab = s.tabs.find((t) => t.id === tabId);
  if (!tab) return;
  const gone = new Set(ids);
  const root = keepLeaves(tab.root, (p) => !gone.has(p));
  if (!root) { removeTab(tabId); return; }
  const rest = leaves(root);
  const last = s.panes[tab.activePane];
  const panes = Object.fromEntries(Object.entries(s.panes).filter(([k]) => !gone.has(k)));
  const tabs = s.tabs.map((t) => (t.id === tabId ? { ...t, root, activePane: rest.includes(t.activePane) ? t.activePane : rest[0], maximized: false, finished: null, finishedPane: undefined } : t));
  useStore.setState({ tabs, panes, ...frontAfter({ ...s, tabs, panes }), termCwd: last?.kind === 'terminal' ? last.cwd : s.termCwd });
}

function removePane(id: string) {
  const s = useStore.getState();
  const tree = treeOf(s, id);
  if (!tree) return;
  const root = removeLeaf(tree.root, id);
  const { [id]: gone, ...panes } = s.panes;
  if (tree.id === EDITORS) {
    const rest = root ? leaves(root) : [];
    useStore.setState({ panes, editors: { root, active: rest.includes(s.editors.active) ? s.editors.active : rest[0] ?? '', maximized: s.editors.maximized && rest.length > 1 }, focus: root ? s.focus : 'terminal' });
    dropBlankNotes(s.panes);
    return;
  }
  if (!root) { s.closeTab(tree.id); return; }
  const rest = leaves(root);
  // The keyboard goes to a terminal that is on show, when the tab has one.
  const next = rest.find((p) => !s.leaving[p] && !isHidden(panes[p])) ?? rest[0];
  const tabs = s.tabs.map((t) => (t.id === tree.id ? { ...t, root, activePane: rest.includes(t.activePane) ? t.activePane : next } : t));
  useStore.setState({ panes, tabs, ...frontAfter({ ...s, tabs, panes }), termCwd: gone?.kind === 'terminal' && !gone.hidden ? gone.cwd : s.termCwd });
}

function removeFile(paneId: string, path: string) {
  const s = useStore.getState();
  const p = s.panes[paneId];
  if (!p || p.kind !== 'editor') return;
  const files = p.files.filter((f) => f.path !== path);
  if (!files.length || files.length === p.files.length) return;
  const active = p.active === path ? files[0].path : p.active;
  useStore.setState({ panes: { ...s.panes, [paneId]: { ...p, files, active } } });
  dropBlankNotes(s.panes);
}

/** Deletes ⌘N notes that have just been closed with nothing added. `before` is the panes as they were before the close.
 *  A note still open somewhere, or holding unsaved typing, is kept; the file's text is checked again before it goes. */
function dropBlankNotes(before: Record<string, Pane>) {
  const s = useStore.getState();
  const open = new Set<string>();
  for (const p of Object.values(s.panes)) if (p.kind === 'editor') for (const f of p.files) open.add(f.path);
  for (const p of Object.values(before)) {
    if (p.kind !== 'editor') continue;
    for (const f of p.files) {
      if (f.blank === undefined || open.has(f.path) || s.dirty[f.path]) continue;
      api.fs.discardBlank(f.path, f.blank).then((gone) => { if (gone) bus.emit('fs.changed'); });
    }
  }
}

/** The terminal tab in front, wherever the keyboard is. */
export function activeTab(s: State = useStore.getState()) { return s.tabs.find((t) => t.id === s.activeTab) ?? null; }
/** The pane that has the keyboard. */
export function activePane(s: State = useStore.getState()): Pane | null {
  const id = focusedId(s);
  return id ? s.panes[id] ?? null : null;
}
/** The terminal that file and search panels follow: the one used last in the tab in front. */
export function activeTermPane(s: State = useStore.getState()): TermPane | null {
  const tab = activeTab(s);
  const p = tab ? s.panes[tab.activePane] : null;
  return p?.kind === 'terminal' ? p : null;
}
export function projectRoot(s: State = useStore.getState()) {
  const t = activeTermPane(s);
  return t ? t.gitRoot ?? t.cwd : appInfo.home;
}
/** The program a command line runs: "claude", "vim", "npm". Skips env assignments and wrappers such as sudo. */
export function appName(command: string | null) {
  if (!command) return 'terminal';
  const words = command.trim().split(/\s+/);
  let i = 0;
  while (i < words.length - 1 && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]) || ['sudo', 'exec', 'time', 'nohup', 'command', 'env', 'npx', 'bunx', 'uvx'].includes(words[i]))) i++;
  return basename(words[i]) || 'terminal';
}
/** A path too long for a tab keeps its two ends: "~/…/astrolabe", "/var/…/work". */
function shortDir(dir: string) {
  if (dir.length <= 28) return dir;
  const parts = dir.split('/');
  if (parts.length < 4) return dir;
  const first = parts[0] === '' ? `/${parts[1]}` : parts[0];
  return `${first}/…/${parts[parts.length - 1]}`;
}
/** A terminal is named for where you are and what you are running there: "~/project terminal", "~/project claude". */
export function termLabel(p: TermPane): { dir: string; app: string } {
  return { dir: shortDir(tildify(p.gitRoot ?? p.cwd)), app: p.running ? appName(p.command) : 'terminal' };
}

// Save the layout so the next launch reopens the same tabs in the same folders, and the same files.
let saveTimer: number | undefined;
useStore.subscribe((s, prev) => {
  // A tab whose terminals are on screen has been looked at, so its finished mark goes.
  const front = s.tabs.find((t) => t.id === s.activeTab);
  if (front?.finished && showing(s) !== 'editor') { useStore.setState({ tabs: s.tabs.map((t) => (t.id === front.id ? { ...t, finished: null, finishedPane: undefined } : t)) }); return; }
  if (!s.ready || (s.tabs === prev.tabs && s.panes === prev.panes && s.activeTab === prev.activeTab && s.sidebar === prev.sidebar && s.editors === prev.editors && s.areas === prev.areas && s.focus === prev.focus)) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const st = useStore.getState();
    if (!st.tabs.length && !st.editors.root) return;
    const panes: Record<string, unknown> = {};
    for (const p of Object.values(st.panes)) {
      panes[p.id] = p.kind === 'terminal' ? { id: p.id, kind: p.kind, cwd: p.cwd } : { id: p.id, kind: p.kind, files: p.files, active: p.active };
    }
    api.state.save({ session: { tabs: st.tabs.filter((t) => !st.leaving[t.id]), activeTab: st.activeTab, panes, editors: st.editors, focus: st.focus, areas: st.areas, termCwd: st.termCwd }, sidebar: st.sidebar });
  }, 500);
});
(window as any).__store = useStore; // for test/drive.mjs

/** The scroll multiplier from settings, kept to a sane range. */
export function scrollSpeed(s: Settings = useStore.getState().settings) {
  return Number.isFinite(s.scrollSpeed) && s.scrollSpeed > 0 ? Math.min(20, s.scrollSpeed) : DEFAULT_SETTINGS.scrollSpeed;
}
