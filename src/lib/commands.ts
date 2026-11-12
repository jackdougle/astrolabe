import { api, appInfo, basename, dirname } from './api';
import { leaves } from './layout';
import { moveFiles, releaseFile, saveFile } from './monaco';
import { bus, focusPane } from './panes';
import { activePane, activeTab, entryLeaving, isMarkdown, lastOf, projectRoot, showEntry, sides, tabEntries, useStore } from './store';
import { getSession } from './termSession';

export interface Command { id: string; title: string; keys?: string[]; run: () => void; when?: () => boolean }

const S = () => useStore.getState();
const term = () => { const p = activePane(); return p?.kind === 'terminal' ? p : null; };
const editor = () => { const p = activePane(); return p?.kind === 'editor' ? p : null; };
const refocus = () => { const t = activeTab(); if (t) focusPane(t.activePane); };
/** The tab has an editor with something beside it, so it can expand or change sides. */
const editorBeside = () => { const t = activeTab(); const ids = t ? leaves(t.root) : []; return ids.length > 1 && ids.some((id) => S().panes[id]?.kind === 'editor'); };

function focusDirection(dx: number, dy: number) {
  const tab = activeTab();
  if (!tab) return;
  const els = [...document.querySelectorAll<HTMLElement>(`.tab-area[data-tab="${tab.id}"] .pane`)];
  const cur = els.find((e) => e.dataset.pane === tab.activePane);
  if (!cur) return;
  const c = cur.getBoundingClientRect();
  let best: { id: string; d: number } | null = null;
  for (const el of els) {
    if (el === cur) continue;
    const r = el.getBoundingClientRect();
    const overlap = dx !== 0 ? Math.min(c.bottom, r.bottom) - Math.max(c.top, r.top) : Math.min(c.right, r.right) - Math.max(c.left, r.left);
    if (overlap <= 0) continue;
    const d = dx > 0 ? r.left - c.right : dx < 0 ? c.left - r.right : dy > 0 ? r.top - c.bottom : c.top - r.bottom;
    if (d < -1) continue;
    if (!best || d < best.d || (d === best.d && overlap > 0)) best = { id: el.dataset.pane!, d };
  }
  if (best) { S().focusPane(best.id); focusPane(best.id); }
}

/** Jumps between the editor and the terminals in this tab (into the terminal used last). */
function switchEditorTerminal() {
  const t = activeTab();
  if (!t) return;
  const want = S().panes[t.activePane]?.kind === 'editor' ? 'terminal' : 'editor';
  const target = lastOf(t, want, S().panes, S().leaving);
  if (!target) return;
  S().focusPane(target);
  focusPane(target);
}

/** ⌃⌘F. With terminals and an editor side by side, the one you are in fills the tab; pressed again, the other comes back
 *  beside it. A side that is not there yet is made: an empty page for terminals, a terminal for a page. */
export async function toggleFull() {
  const t = activeTab();
  if (!t) return;
  const { terms, editor } = sides(t, S().panes);
  if (editor && terms.length) S().toggleFull();
  else if (editor) S().addTerminal();
  else {
    // The empty page is a note like any other; closed with nothing typed in it, it is deleted again.
    const res = await api.fs.newNote(projectRoot());
    if (res.error) { S().showToast(`Could not create a note: ${res.error}`); return; }
    S().openFile(res.path, null, { blank: res.text ?? '', stay: true });
    bus.emit('fs.changed');
  }
  refocus();
}

const shellEscape = (p: string) => p.replace(/([^A-Za-z0-9_\-.,:+/@%=])/g, '\\$1');
function relativePath(fromDir: string, to: string) {
  const a = fromDir.split('/').filter(Boolean); const b = to.split('/').filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/') || '.';
}
const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|heic)$/i;
/** Markdown for a file dropped into a note: an image embed for pictures, a link for everything else. */
export function markdownLink(noteDir: string, path: string) {
  const rel = relativePath(noteDir, path);
  const dest = /[\s()]/.test(rel) ? `<${rel}>` : rel;
  return `${IMAGE.test(path) ? '!' : ''}[${basename(path)}](${dest})`;
}

/** Puts file paths wherever the user is working: the command line, the running program, or the open note. */
export function attachPaths(paths: string[], paneId?: string) {
  const pane = paneId ? S().panes[paneId] : activePane();
  if (!paths.length || !pane) return;
  if (pane.kind === 'terminal') {
    const text = paths.map(shellEscape).join(' ') + ' ';
    if (pane.integrated && pane.atPrompt) bus.emit('input.insert', { pane: pane.id, text });
    else getSession(pane.id)?.paste(text);
  } else if (pane.active) {
    bus.emit('editor.attach', { pane: pane.id, paths });
  }
  focusPane(pane.id);
}
export async function pickAndAttach() {
  const pane = activePane();
  if (!pane) return;
  const dir = pane.kind === 'terminal' ? pane.cwd : pane.active ? dirname(pane.active) : undefined;
  attachPaths(await api.fs.pick(dir), pane.id);
}

export async function renameEntry(path: string, name: string) {
  const res = await api.fs.rename(path, name);
  if (res.error || !res.path) { S().showToast(res.error ?? 'Could not rename.'); return false; }
  if (res.path !== path) { moveFiles(path, res.path); S().renamePath(path, res.path); bus.emit('fs.renamed', { from: path, to: res.path }); }
  bus.emit('fs.changed');
  return true;
}
/** Moves files and folders to the Trash. Something inside a folder that is also going leaves with the folder. */
export async function trashEntries(paths: string[]) {
  const tops = paths.filter((p) => !paths.some((q) => p.startsWith(q + '/')));
  let moved = 0;
  let failure: string | null = null;
  for (const path of tops) {
    const res = await api.fs.trash(path);
    if (!res.ok) { failure = `Could not move ${basename(path)} to Trash: ${res.error}`; break; }
    moved++;
    // Close tabs for what was removed. A tab with unsaved changes stays, so nothing typed is lost; saving it writes the file back.
    for (const p of Object.values(S().panes)) {
      if (p.kind !== 'editor') continue;
      for (const f of p.files) {
        if ((f.path === path || f.path.startsWith(path + '/')) && !S().dirty[f.path]) { S().closeFile(p.id, f.path); releaseFile(f.path); }
      }
    }
  }
  if (failure) S().showToast(failure);
  else if (moved) S().showToast(moved === 1 ? `Moved ${basename(tops[0])} to Trash` : `Moved ${moved} items to Trash`);
  if (moved) bus.emit('fs.changed');
}

/** A new, empty file called `name` in `dir`, opened in the editor (the navigator's "New File"). */
export async function createEntry(dir: string, name: string) {
  const res = await api.fs.createFile(dir, name);
  if (res.error || !res.path) { S().showToast(res.error ?? 'Could not create the file.'); return; }
  S().openFile(res.path);
  bus.emit('fs.changed');
}

/** A new, empty note in the same folder as `path`, opened in the editor (⌘T, and "New File" on the file tab strip). */
export async function newFileBeside(path: string) {
  const res = await api.fs.newNote(dirname(path));
  if (res.error) { S().showToast(`Could not create a note: ${res.error}`); return; }
  S().openFile(res.path);
  bus.emit('fs.changed');
}

export async function closeFileTab(paneId: string, path: string) {
  // Unsaved work is never dropped silently. (If the same file is open in another pane, nothing is lost by closing this one.)
  const elsewhere = Object.values(S().panes).some((p) => p.kind === 'editor' && p.id !== paneId && p.files.some((f) => f.path === path));
  if (S().dirty[path] && !elsewhere) {
    const choice = await api.fs.confirmUnsaved(basename(path));
    if (choice === 'cancel') { refocus(); return; }
    if (choice === 'save' && !(await saveFile(path))) return;
    // Thrown-away typing no longer counts, so a ⌘N note closed this way is cleared like one never typed in.
    if (choice === 'discard') S().setDirty(path, false);
  }
  S().closeFile(paneId, path);
  releaseFile(path);
  refocus();
}

function zoom(delta: number | null) {
  const z = delta === null ? 1 : Math.round((S().settings.zoom + delta) * 100) / 100;
  S().updateSettings({ zoom: Math.min(1.6, Math.max(0.6, z)) });
  S().showToast(`Zoom ${Math.round(S().settings.zoom * 100)}%`);
}

export const commands: Command[] = [
  // In the editor, ⌘T means "new note here"; in a terminal it means "new tab".
  { id: 'note.new', title: 'New note beside this file', keys: ['cmd+t'], when: () => !!editor()?.active, run: () => newFileBeside(editor()!.active!) },
  { id: 'note.newInRepo', title: 'New note in this project, with the date and street at the top', keys: ['cmd+n'], run: async () => {
    const res = await api.fs.newNote(projectRoot(), true);
    if (res.error) { S().showToast(`Could not create a note: ${res.error}`); return; }
    S().openFile(res.path, { line: 1, end: true, blank: res.text });
    bus.emit('fs.changed');
  } },
  { id: 'tab.new', title: 'New terminal tab', keys: ['cmd+t', 'cmd+shift+t'], run: () => { S().newTab(); refocus(); } },
  { id: 'tab.close', title: 'Close tab (this file, or this tab\'s terminals)', keys: ['cmd+shift+w'], run: () => {
    const e = editor();
    if (e?.active) closeFileTab(e.id, e.active);
    else { S().closeTerminals(S().activeTab); refocus(); }
  } },
  { id: 'pane.close', title: 'Close pane or file', keys: ['cmd+w'], run: () => {
    const e = editor();
    if (e?.active) closeFileTab(e.id, e.active);
    else { const t = activeTab(); if (t) S().closePane(t.activePane); refocus(); }
  } },
  { id: 'pane.splitRight', title: 'Split pane right', keys: ['cmd+d'], run: () => { S().split('row'); refocus(); } },
  { id: 'pane.splitDown', title: 'Split pane down', keys: ['cmd+shift+d'], run: () => { S().split('col'); refocus(); } },
  { id: 'pane.next', title: 'Next pane', keys: ['cmd+]'], when: () => !editor(), run: () => { S().cyclePane(1); refocus(); } },
  { id: 'pane.prev', title: 'Previous pane', keys: ['cmd+['], when: () => !editor(), run: () => { S().cyclePane(-1); refocus(); } },
  { id: 'pane.left', title: 'Focus pane to the left', keys: ['cmd+alt+arrowleft'], run: () => focusDirection(-1, 0) },
  { id: 'pane.right', title: 'Focus pane to the right', keys: ['cmd+alt+arrowright'], run: () => focusDirection(1, 0) },
  { id: 'pane.up', title: 'Focus pane above', keys: ['cmd+alt+arrowup'], run: () => focusDirection(0, -1) },
  { id: 'pane.down', title: 'Focus pane below', keys: ['cmd+alt+arrowdown'], run: () => focusDirection(0, 1) },
  { id: 'pane.maximize', title: 'Maximize or restore pane', keys: ['cmd+shift+enter'], run: () => { S().toggleMaximize(); refocus(); } },
  { id: 'pane.switchEditor', title: 'Switch between the editor and the terminal', keys: ['ctrl+`'], when: editorBeside, run: switchEditorTerminal },
  { id: 'editor.expand', title: 'Fill the tab with the terminals or the editor, or put them side by side', keys: ['ctrl+cmd+f'], run: () => { toggleFull(); } },
  { id: 'editor.swapSide', title: 'Switch displays (swap the editor and terminals left and right)', keys: ['ctrl+cmd+s'], when: editorBeside, run: () => { S().setEditorSide('toggle'); refocus(); } },
  { id: 'editor.left', title: 'Put the editor left of the terminals', keys: ['ctrl+cmd+arrowleft'], when: editorBeside, run: () => { S().setEditorSide('left'); refocus(); } },
  { id: 'editor.right', title: 'Put the editor right of the terminals', keys: ['ctrl+cmd+arrowright'], when: editorBeside, run: () => { S().setEditorSide('right'); refocus(); } },
  { id: 'tab.next', title: 'Next tab', keys: ['ctrl+tab', 'cmd+shift+]'], run: () => { S().cycleTab(1); refocus(); } },
  { id: 'tab.prev', title: 'Previous tab', keys: ['ctrl+shift+tab', 'cmd+shift+['], run: () => { S().cycleTab(-1); refocus(); } },
  ...Array.from({ length: 9 }, (_, i): Command => ({
    id: `tab.${i + 1}`, title: `Go to tab ${i + 1}`, keys: [`cmd+${i + 1}`],
    run: () => { const row = tabEntries(S()).filter((e) => !entryLeaving(e, S())); const e = row[i === 8 ? row.length - 1 : i]; if (e) { showEntry(e); refocus(); } },
  })),
  { id: 'sidebar.toggle', title: 'Show or hide the file navigator', keys: ['cmd+b'], when: () => !document.activeElement?.closest('.ProseMirror'), run: () => { const open = !S().sidebar.visible; S().setSidebar({ visible: open, view: 'files' }); if (!open) refocus(); } },
  // ⌘\ works everywhere, the rich note editor included, where ⌘B is bold.
  { id: 'sidebar.toggleAnywhere', title: 'Show or hide the file navigator (works in the text editor)', keys: ['cmd+\\'], run: () => { const open = !S().sidebar.visible; S().setSidebar({ visible: open, view: 'files' }); if (!open) refocus(); } },
  { id: 'sidebar.files', title: 'Show files', keys: ['cmd+shift+e'], run: () => S().setSidebar({ visible: true, view: 'files' }) },
  { id: 'sidebar.search', title: 'Search in project', keys: ['cmd+shift+f'], run: () => { S().setSidebar({ visible: true, view: 'search' }); bus.emit('search.focus'); } },
  { id: 'palette.commands', title: 'Command palette', keys: ['cmd+shift+p'], run: () => S().openPalette('commands') },
  { id: 'palette.files', title: 'Open file by name', keys: ['cmd+p', 'cmd+o'], run: () => S().openPalette('files') },
  { id: 'palette.history', title: 'Search command history', keys: ['ctrl+r'], when: () => !!term() && !term()!.running, run: () => S().openPalette('history') },
  { id: 'palette.themes', title: 'Change theme', run: () => S().openPalette('themes') },
  { id: 'palette.fontsNotes', title: 'Choose notes text font (Google Fonts)', run: () => S().openPalette('fonts-notes') },
  { id: 'palette.fontsHeadings', title: 'Choose notes heading font (Google Fonts)', run: () => S().openPalette('fonts-headings') },
  { id: 'palette.fontsCode', title: 'Choose terminal and code font (Google Fonts)', run: () => S().openPalette('fonts-code') },
  { id: 'palette.settings', title: 'Settings: appearance, fonts, font sizes, behaviour', run: () => S().openPalette('settings') },
  { id: 'term.clear', title: 'Clear terminal', keys: ['cmd+k'], when: () => !!term(), run: () => { getSession(term()!.id)?.clear(); } },
  { id: 'term.find', title: 'Find in terminal', keys: ['cmd+f'], when: () => !!term(), run: () => bus.emit('term.find', term()!.id) },
  { id: 'term.blockPrev', title: 'Select previous block', keys: ['cmd+arrowup'], when: () => !!term() && term()!.atPrompt, run: () => getSession(term()!.id)?.selectRelative(-1) },
  { id: 'term.blockNext', title: 'Select next block', keys: ['cmd+arrowdown'], when: () => !!term() && term()!.atPrompt, run: () => getSession(term()!.id)?.selectRelative(1) },
  { id: 'term.copyOutput', title: 'Copy output of selected or last block', keys: ['cmd+shift+c'], when: () => !!term(), run: () => {
    const s = getSession(term()!.id);
    const b = s?.selected ?? s?.blocks.filter((x) => x.end).at(-1);
    if (s && b) s.copy(b, 'output');
  } },
  { id: 'term.copyCommand', title: 'Copy command of selected or last block', when: () => !!term(), run: () => {
    const s = getSession(term()!.id);
    const b = s?.selected ?? s?.blocks.at(-1);
    if (s && b) s.copy(b, 'command');
  } },
  { id: 'file.attach', title: 'Attach files from Finder', keys: ['cmd+shift+a'], run: () => { pickAndAttach(); } },
  { id: 'editor.save', title: 'Save file', keys: ['cmd+s'], when: () => !!editor()?.active, run: async () => { const e = editor()!; if (await saveFile(e.active!)) S().showToast('Saved'); } },
  { id: 'editor.toggleWrap', title: 'Turn word wrap on or off', keys: ['alt+z'], run: () => { S().updateSettings({ wordWrap: !S().settings.wordWrap }); S().showToast(S().settings.wordWrap ? 'Word wrap on' : 'Word wrap off'); } },
  { id: 'editor.toggleCaret', title: 'Turn smooth caret on or off', run: () => { S().updateSettings({ smoothCaret: !S().settings.smoothCaret }); S().showToast(S().settings.smoothCaret ? 'Smooth caret on' : 'Smooth caret off'); } },
  { id: 'editor.toggleRendered', title: 'Switch Markdown between rendered and raw', keys: ['cmd+r', 'cmd+e', 'cmd+shift+v'], when: () => !!editor()?.active && isMarkdown(editor()!.active!), run: () => { const e = editor()!; S().toggleRendered(e.id, e.active!); refocus(); } },
  {
    // Outside the editor, ⌘R reinstalls Astrolabe from its source folder when the source has changed.
    id: 'app.update', title: 'Install and relaunch the newest version', keys: ['cmd+r'], when: () => !editor(), run: async () => {
      const status = await api.app.checkUpdate();
      if (status === 'current') { S().showToast('Astrolabe is up to date'); return; }
      if (status === 'busy') { S().showToast('Already building the new version…', 120000); return; }
      if (status === 'dev') { S().showToast('This is a development copy; ⌘R only updates the installed app'); return; }
      if (status === 'no-source') { S().showToast('Cannot find the folder this copy was built from'); return; }
      S().showToast('Building the new version… Astrolabe relaunches when it is ready', 180000);
      const res = await api.app.installUpdate();
      if (res.ok) S().showToast('Relaunching…', 10000);
      else S().showToast(`Update failed: ${res.detail ?? 'unknown error'}`, 8000);
    },
  },
  { id: 'view.zoomIn', title: 'Zoom in', keys: ['cmd+='], run: () => zoom(0.1) },
  { id: 'view.zoomOut', title: 'Zoom out', keys: ['cmd+-'], run: () => zoom(-0.1) },
  { id: 'view.zoomReset', title: 'Reset zoom', keys: ['cmd+0'], run: () => zoom(null) },
  { id: 'settings.open', title: 'Open settings file', keys: ['cmd+,'], run: async () => {
    const st = await api.fs.stat(appInfo.settingsFile);
    if (!st.exists) await api.settings.save(S().settings);
    S().openFile(appInfo.settingsFile);
  } },
  { id: 'window.new', title: 'New window', keys: ['cmd+shift+n'], run: () => api.app.newWindow() },
];

export function runCommand(id: string) {
  const c = commands.find((x) => x.id === id);
  if (c && (!c.when || c.when())) c.run();
}

const CODE_KEYS: Record<string, string> = {
  BracketLeft: '[', BracketRight: ']', Equal: '=', Minus: '-', Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Backquote: '`', Semicolon: ';', Quote: "'",
};
export function keyOf(e: KeyboardEvent) {
  let key = e.key.toLowerCase();
  if (e.code.startsWith('Key')) key = e.code.slice(3).toLowerCase();
  else if (e.code.startsWith('Digit')) key = e.code.slice(5);
  else if (CODE_KEYS[e.code]) key = CODE_KEYS[e.code];
  if (['meta', 'control', 'alt', 'shift'].includes(key)) return '';
  return `${e.ctrlKey ? 'ctrl+' : ''}${e.altKey ? 'alt+' : ''}${e.shiftKey ? 'shift+' : ''}${e.metaKey ? 'cmd+' : ''}${key}`;
}

const byKey = new Map<string, Command[]>();
for (const c of commands) for (const k of c.keys ?? []) {
  const parts = k.split('+');
  const key = parts.pop()!;
  const norm = `${parts.includes('ctrl') ? 'ctrl+' : ''}${parts.includes('alt') ? 'alt+' : ''}${parts.includes('shift') ? 'shift+' : ''}${parts.includes('cmd') ? 'cmd+' : ''}${key}`;
  byKey.set(norm, [...(byKey.get(norm) ?? []), c]);
}

/** Returns true when a shortcut was handled, so the key never reaches the terminal or editor. */
export function handleShortcut(e: KeyboardEvent) {
  // Fn+F (Globe+F) is macOS's own full-screen key; here it does what ⌃⌘F does.
  if (e.code === 'KeyF' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && e.getModifierState?.('Fn')) {
    e.preventDefault(); e.stopPropagation(); runCommand('editor.expand'); return true;
  }
  const k = keyOf(e);
  if (!k) return false;
  for (const c of byKey.get(k) ?? []) {
    if (c.when && !c.when()) continue;
    e.preventDefault();
    e.stopPropagation();
    c.run();
    return true;
  }
  return false;
}

export function formatKeys(k: string) {
  const sym: Record<string, string> = { cmd: '⌘', shift: '⇧', alt: '⌥', ctrl: '⌃', enter: '↩', arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', tab: '⇥' };
  // Modifiers in the order macOS menus show them: ⌃⌥⇧⌘.
  const order = ['ctrl', 'alt', 'shift', 'cmd'];
  const parts = k.split('+').sort((a, b) => (order.indexOf(a) + 1 || 9) - (order.indexOf(b) + 1 || 9));
  return parts.map((p) => sym[p] ?? p.toUpperCase()).join('');
}

export function paneCount() { const t = activeTab(); return t ? leaves(t.root).length : 0; }
