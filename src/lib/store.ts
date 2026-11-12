import { create } from 'zustand';
import { api, appInfo, basename, dirname, tildify } from './api';
import { LayoutNode, leaves, placeSide, removeLeaf, replaceLeaf, setRatio, sideOf } from './layout';
import { exitDelay } from './motion';
import { bus } from './panes';
import { applyTheme, getTheme } from './themes';

export interface TermPane {
  id: string; kind: 'terminal';
  cwd: string; startCwd: string;
  running: boolean; command: string | null; lastExit: number | null;
  /** The running program is an agent waiting for your reply, so its tab does not pulse. */
  waiting?: boolean;
  branch: string | null; dirty: number; gitRoot: string | null;
  integrated: boolean; atPrompt: boolean; exited: boolean;
}
export interface OpenFile {
  path: string; rendered: boolean;
  /** On a note made by ⌘N: the text it was made with. Closed while it still holds exactly that, the note is deleted. */
  blank?: string;
}
export interface EditorPane {
  id: string; kind: 'editor';
  files: OpenFile[]; active: string | null;
  /** `end`: put the caret on a fresh line at the end of the note (rendered notes stay rendered). */
  reveal: { path: string; line: number; col: number; n: number; end?: boolean } | null;
}
export type Pane = TermPane | EditorPane;
export interface Tab {
  id: string; root: LayoutNode; activePane: string; maximized: boolean;
  /** One side fills the tab: the terminals or the editor, whichever holds the focus. Off, the two sit side by side. */
  full?: boolean;
  /** The folder this tab's last terminal was in when it closed; a terminal brought back beside the editor starts there. */
  termCwd?: string;
  /** A command finished here while you were not looking at its terminals: how it ended, until you look. */
  finished?: 'ok' | 'failed' | null;
}
export type SidebarView = 'files' | 'search';
export type PaletteMode = 'commands' | 'files' | 'history' | 'themes' | 'fonts-notes' | 'fonts-headings' | 'fonts-code' | 'settings' | 'appearance' | 'fonts' | 'sizes' | 'behaviour';

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
  /** Where new terminal tabs start, e.g. "~/brain2". Empty means your home folder. Splits stay in the folder you split from. */
  startDirectory: string;
  /** Faint constellation lines behind everything. */
  starfield: boolean;
  /** 'shell' keeps your own prompt (Powerlevel10k and friends); 'astrolabe' draws the built-in one. */
  prompt: 'shell' | 'astrolabe';
  /** How solid the window background is, from 0 (clear) to 1 (opaque). */
  opacityFocused: number; opacityUnfocused: number;
  /** The same for the editor pane. */
  editorOpacityFocused: number; editorOpacityUnfocused: number;
  /** The same for the tab row and the file navigator, the most solid parts of the window. */
  chromeOpacityFocused: number; chromeOpacityUnfocused: number;
  restoreSession: boolean;
  /** How far a scroll gesture moves, as a multiple of the system's own distance. Applies to terminals, the editor, notes and the navigator. */
  scrollSpeed: number;
  /** Which side of the terminals the code and notes editor sits on. */
  editorSide: 'left' | 'right';
}
export const DEFAULT_SETTINGS: Settings = {
  theme: 'meridian', zoom: 1, fontSize: 12.5, notesSize: 1, sidebarSize: 12.67, fontWeight: 600, fontFamily: '', notesFont: '', headingFont: '',
  wordWrap: true, smoothCaret: true, restoreSession: true, starfield: true, startDirectory: '',
  prompt: 'shell', opacityFocused: 0.95, opacityUnfocused: 0.89, editorOpacityFocused: 0.975, editorOpacityUnfocused: 0.915,
  chromeOpacityFocused: 1, chromeOpacityUnfocused: 0.94, scrollSpeed: 2.5, editorSide: 'right',
};

interface State {
  ready: boolean;
  tabs: Tab[]; activeTab: string;
  panes: Record<string, Pane>;
  dirty: Record<string, boolean>;
  sidebar: { visible: boolean; view: SidebarView; width: number };
  palette: { mode: PaletteMode; n: number } | null;
  settings: Settings;
  fullscreen: boolean;
  toast: { text: string; n: number; ms?: number } | null;
  /** Panes, tabs and file tabs (`fileKey`) fading out after being closed. 'shown' keeps a closing tab's area visible while it fades. */
  leaving: Record<string, 'shown' | 'hidden'>;

  init(): Promise<void>;
  newTab(cwd?: string): string;
  closeTab(id: string): void;
  closePane(id: string): void;
  split(dir: 'row' | 'col'): void;
  setActiveTab(id: string): void;
  focusPane(id: string): void;
  cycleTab(delta: number): void;
  cyclePane(delta: number): void;
  moveTab(from: number, to: number): void;
  setRatio(tabId: string, splitId: string, ratio: number): void;
  toggleMaximize(): void;
  /** In a tab with terminals and an editor: lets the side you are in fill the tab, or puts the two side by side again. */
  toggleFull(): void;
  /** In a tab that holds only an editor: opens a terminal beside it. */
  addTerminal(): void;
  /** Closes a tab's terminals. Its open files stay, as tabs of their own. */
  closeTerminals(tabId: string): void;
  /** Moves a file tab to another file's place in the same editor. */
  moveFile(paneId: string, from: string, to: string): void;
  /** Moves the editor to the left or right of the terminals, in every tab, and keeps that for new editors. */
  setEditorSide(side: 'left' | 'right' | 'toggle'): void;
  patchPane(id: string, patch: Partial<TermPane> | Partial<EditorPane>): void;
  commandFinished(paneId: string, exit: number): void;
  /** Opens a file beside the terminals. `stay` leaves the keyboard where it is. */
  openFile(path: string, pos?: { line: number; col?: number; end?: boolean; blank?: string } | null, opts?: { blank?: string; stay?: boolean }): void;
  closeFile(paneId: string, path: string): void;
  activateFile(paneId: string, path: string): void;
  toggleRendered(paneId: string, path: string): void;
  setDirty(path: string, dirty: boolean): void;
  renamePath(from: string, to: string): void;
  setSidebar(patch: Partial<State['sidebar']>): void;
  openPalette(mode: PaletteMode): void;
  closePalette(): void;
  updateSettings(patch: Partial<Settings>): void;
  /** A short message at the bottom of the window; `ms` keeps it up longer (until the next message). */
  showToast(text: string, ms?: number): void;
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
      if (was('editorOpacityFocused', 1, 0.95)) settings.editorOpacityFocused = DEFAULT_SETTINGS.editorOpacityFocused;
      if (was('editorOpacityUnfocused', 0.8, 0.75)) settings.editorOpacityUnfocused = DEFAULT_SETTINGS.editorOpacityUnfocused;
    }
    if (version < 5) {
      // Unfocused windows now fade only slightly (6 points below focused).
      const was = (key: keyof Settings, ...old: number[]) => old.includes(settings[key] as number);
      if (was('opacityUnfocused', 0.6, 0.7, 0.75)) settings.opacityUnfocused = DEFAULT_SETTINGS.opacityUnfocused;
      if (was('editorOpacityUnfocused', 0.75, 0.775, 0.8)) settings.editorOpacityUnfocused = DEFAULT_SETTINGS.editorOpacityUnfocused;
      if (was('chromeOpacityUnfocused', 0.8)) settings.chromeOpacityUnfocused = DEFAULT_SETTINGS.chromeOpacityUnfocused;
    }
    (settings as any).settingsVersion = 5;
    applyTheme(getTheme(settings.theme));
    api.app.zoom(settings.zoom);
    const session = (state as any)?.session;
    const sidebar = { ...get().sidebar, ...((state as any)?.sidebar ?? {}) };
    if (sidebar.view !== 'search') sidebar.view = 'files';
    if (settings.restoreSession && session?.tabs?.length) {
      const panes: Record<string, Pane> = {};
      for (const p of Object.values(session.panes as Record<string, any>)) {
        if (p.kind === 'terminal') panes[p.id] = { ...makeTerm(p.cwd), id: p.id };
        else panes[p.id] = { id: p.id, kind: 'editor', files: p.files ?? [], active: p.active ?? null, reveal: null };
      }
      const tabs = (session.tabs as Tab[]).filter((t) => leaves(t.root).every((id) => panes[id])).map((t) => ({ ...t, finished: null }));
      if (tabs.length) {
        set({ ready: true, settings, sidebar, panes, tabs: tabs.map((t) => ({ ...t, maximized: false })), activeTab: tabs.find((t) => t.id === session.activeTab)?.id ?? tabs[0].id });
        return;
      }
    }
    set({ ready: true, settings, sidebar });
    get().newTab();
  },

  newTab(cwd) {
    const s = get();
    const pane = makeTerm(cwd ?? startDir(s.settings));
    const tab: Tab = { id: uid('tab'), root: { type: 'leaf', pane: pane.id }, activePane: pane.id, maximized: false };
    const idx = s.tabs.findIndex((t) => t.id === s.activeTab);
    const tabs = [...s.tabs];
    tabs.splice(idx + 1, 0, tab);
    set({ panes: { ...s.panes, [pane.id]: pane }, tabs, activeTab: tab.id });
    return tab.id;
  },

  // Closing is two steps: focus moves on at once and the closed thing fades out, then it is removed.
  closeTab(id) {
    const s = get();
    const tab = s.tabs.find((t) => t.id === id);
    if (!tab || s.leaving[id]) return;
    const remaining = s.tabs.filter((t) => t.id !== id && !s.leaving[t.id]);
    if (!remaining.length) { set({ tabs: [], panes: {}, leaving: {} }); dropBlankNotes(s.panes); api.state.save({ session: null }); api.app.closeWindow(); return; }
    const wasActive = s.activeTab === id;
    if (wasActive) {
      const idx = s.tabs.filter((t) => t.id === id || !s.leaving[t.id]).indexOf(tab);
      get().setActiveTab(remaining[Math.min(idx, remaining.length - 1)].id);
    }
    fadeOut(id, wasActive, () => removeTab(id));
  },

  closePane(id) {
    const s = get();
    if (s.leaving[id]) return;
    const tab = s.tabs.find((t) => leaves(t.root).includes(id));
    if (!tab) return;
    const order = leaves(tab.root).filter((p) => p === id || !s.leaving[p]);
    const rest = order.filter((p) => p !== id);
    if (!rest.length) { get().closeTab(tab.id); return; }
    // While one side fills the tab, closing a pane there moves to another pane of that side, not to the hidden one.
    const same = rest.filter((p) => s.panes[p]?.kind === s.panes[id]?.kind);
    const pool = tab.full && same.length ? same : rest;
    const next = tab.activePane === id ? pool[Math.min(order.filter((p) => p === id || pool.includes(p)).indexOf(id), pool.length - 1)] : tab.activePane;
    set({ tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, activePane: next, maximized: false } : t)) });
    fadeOut(id, true, () => removePane(id));
  },

  split(dir) {
    const s = get();
    const tab = s.tabs.find((t) => t.id === s.activeTab);
    if (!tab) return;
    const from = s.panes[tab.activePane];
    const cwd = from?.kind === 'terminal' ? from.cwd : activeTermPane(s)?.cwd ?? appInfo.home;
    const pane = makeTerm(cwd);
    const root = replaceLeaf(tab.root, tab.activePane, (leaf) => ({ type: 'split', id: uid('s'), dir, ratio: 0.5, a: leaf, b: { type: 'leaf', pane: pane.id } }));
    set({ panes: { ...s.panes, [pane.id]: pane }, tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, root, activePane: pane.id, maximized: false } : t)) });
  },

  setActiveTab(id) {
    const s = get();
    if (!s.tabs.some((t) => t.id === id) || s.leaving[id]) return;
    set({ activeTab: id, tabs: s.tabs.map((t) => (t.id === id ? seen(t, s.panes) : t)) });
  },

  commandFinished(paneId, exit) {
    const s = get();
    const tab = s.tabs.find((t) => leaves(t.root).includes(paneId));
    // Nothing to flag when its terminals are in front of you.
    if (!tab || (tab.id === s.activeTab && showing(tab, s.panes) !== 'editor')) return;
    set({ tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, finished: exit ? 'failed' : 'ok' } : t)) });
  },

  focusPane(id) {
    const s = get();
    const tab = s.tabs.find((t) => leaves(t.root).includes(id));
    if (!tab || s.leaving[id] || s.leaving[tab.id]) return;
    if (tab.activePane === id && s.activeTab === tab.id) return;
    set({ activeTab: tab.id, tabs: s.tabs.map((t) => (t.id === tab.id ? seen({ ...t, activePane: id }, s.panes) : t)) });
  },

  cycleTab(delta) {
    const s = get();
    const row = tabEntries(s).filter((e) => !entryLeaving(e, s));
    const i = row.findIndex((e) => e.key === currentEntry(s));
    if (i < 0) return;
    showEntry(row[(i + delta + row.length) % row.length]);
  },

  cyclePane(delta) {
    const s = get();
    const tab = s.tabs.find((t) => t.id === s.activeTab);
    if (!tab) return;
    const order = leaves(tab.root).filter((p) => !s.leaving[p]);
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

  setRatio(tabId, splitId, ratio) {
    set({ tabs: get().tabs.map((t) => (t.id === tabId ? { ...t, root: setRatio(t.root, splitId, Math.min(1, Math.max(0, ratio))) } : t)) });
  },

  toggleMaximize() {
    const s = get();
    const tab = s.tabs.find((t) => t.id === s.activeTab);
    if (!tab) return;
    const show = showing(tab, s.panes);
    const visible = show === 'both' ? leaves(tab.root).length : show === 'terminal' ? sides(tab, s.panes).terms.length : 1;
    if (visible < 2 && !tab.maximized) return;
    set({ tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, maximized: !t.maximized } : t)) });
  },

  toggleFull() {
    const s = get();
    const tab = s.tabs.find((t) => t.id === s.activeTab);
    if (!tab) return;
    const { terms, editor } = sides(tab, s.panes);
    if (!terms.length || !editor) return;
    set({ tabs: s.tabs.map((t) => (t.id === tab.id ? seen({ ...t, full: !t.full, maximized: false }, s.panes) : t)) });
  },

  addTerminal() {
    const s = get();
    const tab = s.tabs.find((t) => t.id === s.activeTab);
    if (!tab) return;
    const { terms, editor } = sides(tab, s.panes);
    if (terms.length || !editor) return;
    const pane = makeTerm(tab.termCwd ?? (editor.active ? dirname(editor.active) : startDir(s.settings)));
    const leaf: LayoutNode = { type: 'leaf', pane: pane.id };
    const left = s.settings.editorSide === 'left';
    const root: LayoutNode = { type: 'split', id: uid('s'), dir: 'row', ratio: 0.5, a: left ? tab.root : leaf, b: left ? leaf : tab.root };
    set({ panes: { ...s.panes, [pane.id]: pane }, tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, root, full: false, maximized: false } : t)) });
  },

  closeTerminals(tabId) {
    const s = get();
    const tab = s.tabs.find((t) => t.id === tabId);
    if (!tab || s.leaving[tabId]) return;
    const { terms, editor } = sides(tab, s.panes);
    if (!editor) { get().closeTab(tabId); return; }
    for (const id of terms) get().closePane(id);
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

  setEditorSide(side) {
    const s = get();
    const active = s.tabs.find((t) => t.id === s.activeTab);
    const activeEditor = active && leaves(active.root).find((id) => s.panes[id]?.kind === 'editor');
    // 'toggle' flips from wherever the editor in front of you sits, then every tab follows.
    const now = (active && activeEditor && sideOf(active.root, activeEditor)) || s.settings.editorSide;
    const want: 'left' | 'right' = side === 'toggle' ? (now === 'left' ? 'right' : 'left') : side;
    const tabs = s.tabs.map((t) => {
      const ed = leaves(t.root).find((id) => s.panes[id]?.kind === 'editor');
      return ed ? { ...t, root: placeSide(t.root, ed, want).node } : t;
    });
    set({ tabs });
    if (s.settings.editorSide !== want) get().updateSettings({ editorSide: want });
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
    const tab = s.tabs.find((t) => t.id === s.activeTab);
    if (!tab) return;
    const reveal = pos ? { path, line: pos.line, col: pos.col ?? 1, n: Date.now(), end: pos.end } : null;
    const rendered = isMarkdown(path) && (!pos || !!pos.end);
    const blank = opts?.blank ?? pos?.blank;
    const ids = leaves(tab.root);
    const current = s.panes[tab.activePane];
    const editor = (current?.kind === 'editor' ? current : ids.map((id) => s.panes[id]).find((p) => p?.kind === 'editor')) as EditorPane | undefined;
    if (editor) {
      const has = editor.files.some((f) => f.path === path);
      // Reopening a file tab that is still fading out keeps it.
      const key = fileKey(editor.id, path);
      if (s.leaving[key]) { const { [key]: _kept, ...leaving } = s.leaving; set({ leaving }); }
      const files = has ? editor.files : [...editor.files, { path, rendered, blank }];
      // Opened from a terminal, a file shows beside it; opened from an editor that fills the tab, it fills the tab too.
      const within = tab.activePane === editor.id;
      set({
        panes: { ...s.panes, [editor.id]: { ...editor, files, active: path, reveal } },
        tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, activePane: opts?.stay ? t.activePane : editor.id, maximized: t.maximized && within, full: !!t.full && within } : t)),
      });
      return;
    }
    const pane: EditorPane = { id: uid('e'), kind: 'editor', files: [{ path, rendered, blank }], active: path, reveal };
    // New editors open beside the whole tab, on the side chosen in settings, so the terminals keep their arrangement.
    const leaf: LayoutNode = { type: 'leaf', pane: pane.id };
    const left = s.settings.editorSide === 'left';
    const root: LayoutNode = { type: 'split', id: uid('s'), dir: 'row', ratio: 0.5, a: left ? leaf : tab.root, b: left ? tab.root : leaf };
    set({ panes: { ...s.panes, [pane.id]: pane }, tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, root, activePane: opts?.stay ? t.activePane : pane.id, maximized: false, full: false } : t)) });
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
      const tab = s.tabs.find((t) => leaves(t.root).includes(paneId));
      if (tab && s.tabs.length === 1 && leaves(tab.root).length === 1) {
        const term = makeTerm(startDir(s.settings));
        const { [paneId]: _gone, ...rest } = s.panes;
        set({ panes: { ...rest, [term.id]: term }, tabs: [{ ...tab, root: { type: 'leaf', pane: term.id }, activePane: term.id, maximized: false }] });
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

  showToast(text, ms) { set({ toast: { text, n: Date.now(), ms } }); },
}));

export const fileKey = (paneId: string, path: string) => `${paneId}\n${path}`;

type Layout = Pick<State, 'tabs' | 'panes'>;

/** A tab's two sides: its terminals, and its editor if it has one. */
export function sides(tab: Tab, panes: Record<string, Pane>) {
  const terms: string[] = [];
  let editor: EditorPane | null = null;
  for (const id of leaves(tab.root)) { const p = panes[id]; if (p?.kind === 'terminal') terms.push(id); else if (p?.kind === 'editor') editor ??= p; }
  return { terms, editor };
}
/** What a tab has on screen: its terminals and editor side by side, or one of them filling it. */
export function showing(tab: Tab, panes: Record<string, Pane>): 'both' | 'terminal' | 'editor' {
  const { terms, editor } = sides(tab, panes);
  if (!editor) return 'terminal';
  if (!terms.length) return 'editor';
  if (!tab.full) return 'both';
  return panes[tab.activePane]?.kind === 'editor' ? 'editor' : 'terminal';
}
/** A tab whose terminals are on screen has been looked at, so its finished mark goes. */
function seen(tab: Tab, panes: Record<string, Pane>): Tab {
  return tab.finished && showing(tab, panes) !== 'editor' ? { ...tab, finished: null } : tab;
}

/** The pane of each kind ("tabId:kind") last focused in each tab, so coming back to a tab's terminals lands in the same one. */
const lastFocused = new Map<string, string>();
export function lastOf(tab: Tab, kind: Pane['kind'], panes: Record<string, Pane>, leaving: Record<string, unknown> = {}): string | null {
  const ids = leaves(tab.root).filter((id) => panes[id]?.kind === kind && !leaving[id]);
  const last = lastFocused.get(`${tab.id}:${kind}`);
  return last && ids.includes(last) ? last : ids[0] ?? null;
}

/** One tab in the row along the top: a tab's terminals, or one open file. Files follow the terminals they were opened from. */
export interface TabEntry { key: string; tab: Tab; pane: string; file?: string }
export function tabEntries(s: Layout): TabEntry[] {
  const out: TabEntry[] = [];
  for (const tab of s.tabs) {
    const { terms, editor } = sides(tab, s.panes);
    if (terms.length) out.push({ key: tab.id, tab, pane: lastOf(tab, 'terminal', s.panes) ?? terms[0] });
    if (editor) for (const f of editor.files) out.push({ key: fileKey(editor.id, f.path), tab, pane: editor.id, file: f.path });
  }
  return out;
}
/** True while the entry is fading out after being closed. */
export function entryLeaving(e: TabEntry, s: Pick<State, 'panes' | 'leaving'>) {
  if (s.leaving[e.tab.id] || s.leaving[e.pane]) return true;
  if (e.file) return !!s.leaving[e.key];
  return sides(e.tab, s.panes).terms.every((id) => s.leaving[id]);
}
/** The entry that holds the keyboard. */
export function currentEntry(s: Layout & Pick<State, 'activeTab'>) {
  const tab = s.tabs.find((t) => t.id === s.activeTab);
  const p = tab && s.panes[tab.activePane];
  return !tab ? null : p?.kind === 'editor' && p.active ? fileKey(p.id, p.active) : tab.id;
}
/** Brings an entry to the front: its terminals (the one used last), or its file. */
export function showEntry(e: TabEntry) {
  const s = useStore.getState();
  if (entryLeaving(e, s)) return;
  if (e.file) s.activateFile(e.pane, e.file);
  s.focusPane(e.file ? e.pane : lastOf(e.tab, 'terminal', s.panes, s.leaving) ?? e.pane);
}

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
  if (!tabs.length) return;
  useStore.setState({
    tabs, panes: Object.fromEntries(Object.entries(s.panes).filter(([k]) => !gone.has(k))),
    activeTab: s.activeTab === id ? tabs[0].id : s.activeTab,
  });
  dropBlankNotes(s.panes);
}

function removePane(id: string) {
  const s = useStore.getState();
  const tab = s.tabs.find((t) => leaves(t.root).includes(id));
  if (!tab) return;
  const root = removeLeaf(tab.root, id);
  if (!root) { s.closeTab(tab.id); return; }
  const rest = leaves(root);
  const { [id]: gone, ...panes } = s.panes;
  const termCwd = gone?.kind === 'terminal' ? gone.cwd : tab.termCwd;
  useStore.setState({ panes, tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, root, termCwd, activePane: rest.includes(t.activePane) ? t.activePane : rest[0] } : t)) });
  dropBlankNotes(s.panes);
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

export function activeTab(s: State = useStore.getState()) { return s.tabs.find((t) => t.id === s.activeTab) ?? null; }
export function activePane(s: State = useStore.getState()): Pane | null {
  const tab = activeTab(s);
  return tab ? s.panes[tab.activePane] ?? null : null;
}
/** The terminal that file and search panels should follow: the focused one, else the one used last in this tab. */
export function activeTermPane(s: State = useStore.getState()): TermPane | null {
  const tab = activeTab(s);
  if (!tab) return null;
  const cur = s.panes[tab.activePane];
  if (cur?.kind === 'terminal') return cur;
  const id = lastOf(tab, 'terminal', s.panes);
  const p = id ? s.panes[id] : null;
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
/** A tab is named for where you are and what you are running there: "~/brain2 terminal", "~/brain2 claude". */
export function tabLabel(tab: Tab, panes: Record<string, Pane>): { dir: string; app: string } {
  const id = lastOf(tab, 'terminal', panes);
  const p = id ? panes[id] : null;
  if (p?.kind !== 'terminal') return { dir: '', app: 'tab' };
  return { dir: shortDir(tildify(p.gitRoot ?? p.cwd)), app: p.running ? appName(p.command) : 'terminal' };
}

// Save the layout so the next launch reopens the same tabs in the same folders.
let saveTimer: number | undefined;
useStore.subscribe((s, prev) => {
  if (s.tabs !== prev.tabs || s.panes !== prev.panes) for (const t of s.tabs) { const p = s.panes[t.activePane]; if (p) lastFocused.set(`${t.id}:${p.kind}`, p.id); }
  if (!s.ready || (s.tabs === prev.tabs && s.panes === prev.panes && s.activeTab === prev.activeTab && s.sidebar === prev.sidebar)) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const st = useStore.getState();
    if (!st.tabs.length) return;
    const panes: Record<string, unknown> = {};
    for (const p of Object.values(st.panes)) {
      panes[p.id] = p.kind === 'terminal' ? { id: p.id, kind: p.kind, cwd: p.cwd } : { id: p.id, kind: p.kind, files: p.files, active: p.active };
    }
    api.state.save({ session: { tabs: st.tabs, activeTab: st.activeTab, panes }, sidebar: st.sidebar });
  }, 500);
});
(window as any).__store = useStore; // for test/drive.mjs

/** The scroll multiplier from settings, kept to a sane range. */
export function scrollSpeed(s: Settings = useStore.getState().settings) {
  return Number.isFinite(s.scrollSpeed) && s.scrollSpeed > 0 ? Math.min(20, s.scrollSpeed) : DEFAULT_SETTINGS.scrollSpeed;
}
