import { api, appInfo, basename, dirname, joinPath } from './api';
import { GRAPH, graphRoot, isGraph } from './graph';
import { leaves } from './layout';
import { fileEntry, moveFiles, releaseFile, saveFile } from './monaco';
import { bus, focusPane } from './panes';
import { activePane, activeTab, focusedId, isMarkdown, liveEditors, openFiles, projectRoot, tabGroups, useStore } from './store';
import { getSession } from './termSession';

/** `keyWhen` holds a further condition for one of the keys alone: the command's other keys work without it. */
export interface Command { id: string; title: string; keys?: string[]; run: () => void; when?: () => boolean; keyWhen?: Record<string, () => boolean> }

const S = () => useStore.getState();
const term = () => { const p = activePane(); return p?.kind === 'terminal' ? p : null; };
const editor = () => { const p = activePane(); return p?.kind === 'editor' ? p : null; };
const refocus = () => { const id = focusedId(); if (id) focusPane(id); };
/** The keyboard is in the text of a rendered note. */
const inRendered = () => !!(document.activeElement as HTMLElement | null)?.closest?.('.rich');
/** The keyboard is in a file shown as text (raw Markdown, or code): VS Code's editor, with its own keys. */
const inRaw = () => !!(document.activeElement as HTMLElement | null)?.closest?.('.editor-pane .monaco-editor');
/** Terminals and editors are both open, so the keyboard can cross and the two can change sides. */
const bothAreas = () => liveEditors(S()).length > 0 && tabGroups(S()).length > 0;

function focusDirection(dx: number, dy: number) {
  const now = focusedId();
  // Every pane on screen, in either area.
  const els = [...document.querySelectorAll<HTMLElement>('.tab-area.is-active .pane')].filter((e) => !e.classList.contains('is-leaving') && getComputedStyle(e).visibility !== 'hidden');
  const cur = els.find((e) => e.dataset.pane === now);
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
    if (!best || d < best.d) best = { id: el.dataset.pane!, d };
  }
  if (best) { S().focusPane(best.id); focusPane(best.id); }
}

/** Jumps between the editors and the terminals, into the pane used last on the other side. */
function switchEditorTerminal() {
  S().focusArea(S().focus === 'editor' ? 'terminal' : 'editor');
  refocus();
}

/** ⌃⌘F. With terminals and editors side by side, the area you are in fills the window; pressed again, the other comes
 *  back beside it. An area that is not there yet is made: an empty page for terminals, and for a page a terminal on
 *  half the window. */
export async function toggleFull() {
  const editors = liveEditors(S()).length > 0;
  const terms = tabGroups(S()).length > 0;
  if (editors && terms) S().toggleFull();
  else if (editors) { S().setAreaRatio(0.5); S().newTab(S().termCwd ?? undefined, { stay: true }); }
  else {
    // The empty page is a note like any other; closed with nothing typed in it, it is deleted again.
    const res = await api.fs.newNote(projectRoot());
    if (res.error) { S().showToast(`Could not create a note: ${res.error}`); return; }
    S().openFile(res.path, null, { blank: res.text ?? '', stay: true, keep: true });
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
export const isImage = (path: string) => IMAGE.test(path);
/** Markdown for a file dropped into a note: an image embed for pictures, a link for everything else. */
export function markdownLink(noteDir: string, path: string) {
  const rel = relativePath(noteDir, path);
  const dest = /[\s()]/.test(rel) ? `<${rel}>` : rel;
  return `${IMAGE.test(path) ? '!' : ''}[${basename(path)}](${dest})`;
}

/** Markdown for a file put into a note. A picture is first made to travel with the note: uploaded, when an uploader
 *  is set (`imageUpload`), so that the note shows it wherever its text goes; otherwise copied into `attachments`
 *  beside the note, unless it already lives in the note's folder or project. */
export async function noteLink(noteDir: string, path: string) {
  if (!isImage(path) || !api.fs.importImage) return markdownLink(noteDir, path);
  const command = (S().settings.imageUpload ?? '').trim();
  if (command) {
    S().showToast(`Uploading ${basename(path)}…`, 120000);
    const res = await api.fs.uploadImage(command, path);
    if (res.url) { S().showToast('Uploaded'); return `![${basename(path)}](${res.url})`; }
    S().showToast(`Upload failed, so the picture stays a file: ${res.error ?? 'unknown error'}`, 7000);
  }
  const root = projectRoot(S());
  const within = (dir: string, p: string) => p.startsWith(`${dir.replace(/\/+$/, '')}/`);
  if (!within(noteDir, path) && !(root && within(root, path) && within(root, `${noteDir}/`))) {
    const res = await api.fs.importImage(noteDir, path);
    if (res.path) { path = res.path; bus.emit('fs.changed'); }
    else S().showToast(`Could not copy ${basename(path)} beside the note: ${res.error ?? 'unknown error'}`, 6000);
  }
  return markdownLink(noteDir, path);
}
/** Uploads every picture the note shows from a file and writes the web addresses in their place (one undo step). */
export async function uploadNoteImages(file: string) {
  const command = (S().settings.imageUpload ?? '').trim();
  if (!command) { S().showToast('Nothing uploads pictures yet: set "imageUpload" in the settings file (⌘,) to a command that does', 8000); return; }
  const entry = fileEntry(file);
  if (!entry) return;
  const EMBED = /!\[([^\]]*)\]\((<[^>]+>|[^)\s]+)((?:\s+"[^"]*")?)\)/g;
  const bare = (dest: string) => dest.replace(/^<|>$/g, '');
  const local = new Set([...entry.model.getValue().matchAll(EMBED)].map((m) => bare(m[2])).filter((dest) => !/^[a-z][a-z0-9+.-]*:/i.test(dest)));
  if (!local.size) { S().showToast('This note has no pictures kept as files'); return; }
  const urls = new Map<string, string>();
  let failure: string | null = null;
  for (const dest of local) {
    S().showToast(`Uploading ${basename(dest)}…`, 120000);
    let path = dest;
    try { path = decodeURI(dest); } catch { /* as written */ }
    const res = await api.fs.uploadImage(command, joinPath(dirname(file), path));
    if (res.url) urls.set(dest, res.url); else failure = `${basename(dest)}: ${res.error ?? 'unknown error'}`;
  }
  if (urls.size) {
    const next = entry.model.getValue().replace(EMBED, (all, alt, dest, title) => { const url = urls.get(bare(dest)); return url ? `![${alt}](${url}${title})` : all; });
    entry.model.pushEditOperations([], [{ range: entry.model.getFullModelRange(), text: next }], () => null);
  }
  S().showToast(failure ? `${urls.size} uploaded. Failed: ${failure}` : `${urls.size} ${urls.size === 1 ? 'picture' : 'pictures'} uploaded`, failure ? 8000 : undefined);
}
/** Puts file paths wherever the user is working: the command line, the running program, or the open note
 *  (at the point `at` in the window when they were dropped there, else at the caret). */
export function attachPaths(paths: string[], paneId?: string, at?: { x: number; y: number }) {
  const pane = paneId ? S().panes[paneId] : activePane();
  if (!paths.length || !pane) return;
  if (pane.kind === 'terminal') {
    const text = paths.map(shellEscape).join(' ') + ' ';
    if (pane.integrated && pane.atPrompt) bus.emit('input.insert', { pane: pane.id, text });
    else getSession(pane.id)?.paste(text);
  } else if (pane.active) {
    bus.emit('editor.attach', { pane: pane.id, paths, at });
  }
  focusPane(pane.id);
}
/** What a paste or a drop handed over, as paths. A file on disk is itself; anything else (a screenshot on the
 *  clipboard, a picture dragged out of a browser) is saved under ~/.astrolabe/pasted first. */
export async function pathsOf(files: File[]) {
  const out: string[] = [];
  for (const f of files) {
    const onDisk = api.fs.pathOf(f);
    if (onDisk) { out.push(onDisk); continue; }
    const res = await api.fs.savePasted(f.name, new Uint8Array(await f.arrayBuffer()));
    if (res.path) out.push(res.path); else S().showToast(`Could not attach ${f.name || 'that'}: ${res.error ?? 'unknown error'}`, 5000);
  }
  return out;
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
/** Moves files and folders into the folder `dir` (a drag in the navigator). Tabs open on them follow. */
export async function moveEntries(paths: string[], dir: string) {
  // A copy still running the main process from before this was added has to be relaunched first.
  if (!api.fs.move) { S().showToast('Relaunch Astrolabe to move files by dragging', 5000); return; }
  const tops = paths.filter((p) => !paths.some((q) => p.startsWith(q + '/')) && dirname(p) !== dir);
  const moved: string[] = [];
  let failure: string | null = null;
  for (const path of tops) {
    const res = await api.fs.move(path, dir);
    if (res.error || !res.path) { failure = `Could not move ${basename(path)}: ${res.error ?? 'unknown error'}`; break; }
    moveFiles(path, res.path); S().renamePath(path, res.path); bus.emit('fs.renamed', { from: path, to: res.path });
    moved.push(res.path);
  }
  if (failure) S().showToast(failure, 5000);
  else if (moved.length) S().showToast(moved.length === 1 ? `Moved ${basename(moved[0])} to ${basename(dir)}` : `Moved ${moved.length} items to ${basename(dir)}`);
  if (moved.length) bus.emit('fs.changed');
}
/** Files dragged from the navigator onto a pane. A terminal gets their text, as if pasted: on the command line, or
 *  to the program running there; a picture, or anything else that is not text, is attached there by its path.
 *  An editor opens them, and a picture dropped on a note goes into the note where it was dropped. */
export async function dropEntries(paths: string[], paneId: string, at?: { x: number; y: number }) {
  const pane = S().panes[paneId];
  if (!pane) return;
  if (pane.kind === 'editor') {
    S().focusPane(paneId);
    const pictures = pane.active && isMarkdown(pane.active) ? paths.filter(isImage) : [];
    if (pictures.length) bus.emit('editor.attach', { pane: paneId, paths: pictures, at });
    for (const path of paths) if (!pictures.includes(path) && !isImage(path) && !(await api.fs.stat(path)).dir) S().openFile(path, null, { keep: paths.length > 1 }); // several at once each keep a tab
    return;
  }
  const texts: string[] = [];
  const whole: string[] = [];
  for (const path of paths) {
    const res = isImage(path) ? null : await api.fs.readFile(path);
    if (res?.text != null) texts.push(res.text.replace(/\r?\n$/, '')); else whole.push(path);
  }
  const text = (whole.length ? `${whole.map(shellEscape).join(' ')} ` : '') + texts.join('\n');
  if (text) {
    if (pane.integrated && pane.atPrompt) bus.emit('input.insert', { pane: pane.id, text });
    else getSession(pane.id)?.paste(text);
  }
  S().focusPane(paneId);
  focusPane(paneId);
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
  S().openFile(res.path, null, { keep: true });
  bus.emit('fs.changed');
}

/** A new, empty note in the same folder as `path`, opened in the editor (⌘T, and "New File" on the file tab strip). */
export async function newFileBeside(path: string) {
  const res = await api.fs.newNote(isGraph(path) ? graphRoot(path) : dirname(path));
  if (res.error) { S().showToast(`Could not create a note: ${res.error}`); return; }
  S().openFile(res.path, null, { keep: true });
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
    S().openFile(res.path, { line: 1, end: true, blank: res.text }, { keep: true });
    bus.emit('fs.changed');
  } },
  { id: 'tab.new', title: 'New terminal tab', keys: ['cmd+t', 'cmd+shift+t'], run: () => { S().newTab(); refocus(); } },
  { id: 'tab.close', title: 'Close tab (this file, or this tab with all its terminals)', keys: ['cmd+shift+w'], run: () => {
    const e = editor();
    if (e?.active) closeFileTab(e.id, e.active);
    else { S().closeTab(S().activeTab); refocus(); }
  } },
  { id: 'pane.close', title: 'Close pane or file', keys: ['cmd+w'], run: () => {
    const e = editor();
    if (e?.active) closeFileTab(e.id, e.active);
    else { const id = focusedId(); if (id) S().closePane(id); refocus(); }
  } },
  { id: 'pane.splitRight', title: 'Split right: a new terminal', keys: ['cmd+d'], run: () => { S().split('row'); refocus(); } },
  { id: 'pane.splitDown', title: 'Split down: a new terminal', keys: ['cmd+shift+d'], run: () => { S().split('col'); refocus(); } },
  { id: 'pane.next', title: 'Next pane', keys: ['cmd+]'], when: () => !editor(), run: () => { S().cyclePane(1); refocus(); } },
  { id: 'pane.prev', title: 'Previous pane', keys: ['cmd+['], when: () => !editor(), run: () => { S().cyclePane(-1); refocus(); } },
  { id: 'pane.left', title: 'Focus pane to the left', keys: ['cmd+alt+arrowleft'], run: () => focusDirection(-1, 0) },
  { id: 'pane.right', title: 'Focus pane to the right', keys: ['cmd+alt+arrowright'], run: () => focusDirection(1, 0) },
  // In a file shown as text, ⌥⌘↑ and ⌥⌘↓ are the editor's: a second caret on the line above or below, as in VS Code.
  { id: 'pane.up', title: 'Focus pane above', keys: ['cmd+alt+arrowup'], keyWhen: { 'alt+cmd+arrowup': () => !inRaw() }, run: () => focusDirection(0, -1) },
  { id: 'pane.down', title: 'Focus pane below', keys: ['cmd+alt+arrowdown'], keyWhen: { 'alt+cmd+arrowdown': () => !inRaw() }, run: () => focusDirection(0, 1) },
  { id: 'pane.maximize', title: 'Maximize or restore pane', keys: ['cmd+shift+enter'], run: () => { S().toggleMaximize(); refocus(); } },
  // ⌘\ is VS Code's key for this. ⌘D and ⇧⌘D always make terminals.
  { id: 'editor.splitRight', title: 'Split the editor: this file again in a second editor on the right', keys: ['cmd+\\'], when: () => !!editor()?.active, run: () => { S().splitEditor('right'); refocus(); } },
  { id: 'editor.splitDown', title: 'Split the editor: this file again in a second editor below', keys: ['cmd+shift+\\'], when: () => !!editor()?.active, run: () => { S().splitEditor('bottom'); refocus(); } },
  // Obsidian's key for its graph.
  { id: 'graph.open', title: 'Graph: show the notes of this project as a network', keys: ['cmd+g'], run: () => { S().openFile(GRAPH + projectRoot()); refocus(); } },
  { id: 'pane.switchEditor', title: 'Switch between the editor and the terminal', keys: ['ctrl+`'], when: bothAreas, run: switchEditorTerminal },
  // ⌘E shows the editors or puts them away. Unlike ⌃⌘F it never makes a file: with none open, the editor it shows asks for a name.
  { id: 'editor.toggle', title: 'Show or hide the editor', keys: ['cmd+e'], run: () => { S().toggleEditors(); refocus(); } },
  { id: 'editor.expand', title: 'Fill the window with the terminals or the editors, or put them side by side', keys: ['ctrl+cmd+f'], run: () => { toggleFull(); } },
  { id: 'editor.swapSide', title: 'Switch displays (swap the editor and terminals left and right)', keys: ['ctrl+cmd+s'], when: bothAreas, run: () => { S().setEditorSide('toggle'); refocus(); } },
  { id: 'editor.left', title: 'Put the editor left of the terminals', keys: ['ctrl+cmd+arrowleft'], when: bothAreas, run: () => { S().setEditorSide('left'); refocus(); } },
  { id: 'editor.right', title: 'Put the editor right of the terminals', keys: ['ctrl+cmd+arrowright'], when: bothAreas, run: () => { S().setEditorSide('right'); refocus(); } },
  { id: 'tab.next', title: 'Next terminal tab', keys: ['ctrl+tab', 'cmd+shift+]'], run: () => { S().cycleTab(1); refocus(); } },
  { id: 'tab.prev', title: 'Previous terminal tab', keys: ['ctrl+shift+tab', 'cmd+shift+['], run: () => { S().cycleTab(-1); refocus(); } },
  ...Array.from({ length: 9 }, (_, i): Command => ({
    id: `tab.${i + 1}`, title: `Go to terminal tab ${i + 1}`, keys: [`cmd+${i + 1}`],
    // ⌘1–9 count the terminal tabs, from the editors as well. ⌘9 is the last one.
    run: () => { const groups = tabGroups(S()); const t = groups[i === 8 ? groups.length - 1 : i]; if (t) { S().setActiveTab(t.id); refocus(); } },
  })),
  // ⌥⌘1–9 count the open files, left to right as their tabs sit over the editors (⌥⌘9 is the last), from the terminals as well.
  ...Array.from({ length: 9 }, (_, i): Command => ({
    id: `file.${i + 1}`, title: `Go to file ${i + 1}`, keys: [`cmd+alt+${i + 1}`],
    run: () => { const files = openFiles(S()); const f = files[i === 8 ? files.length - 1 : i]; if (f) { S().activateFile(f.pane, f.path); S().focusPane(f.pane); refocus(); } },
  })),
  // ⌘B is the navigator everywhere, a rendered note included (bold there is ** typed, or * twice over a selection).
  // ⌘L everywhere. ⌘B too, except in a rendered note, where it makes the text bold (Milkdown's own key).
  { id: 'sidebar.toggle', title: 'Show or hide the file navigator', keys: ['cmd+l', 'cmd+b'], keyWhen: { 'cmd+b': () => !inRendered() }, run: () => { const open = !S().sidebar.visible; S().setSidebar({ visible: open, view: 'files' }); if (!open) refocus(); } },
  { id: 'sidebar.files', title: 'Show files', keys: ['cmd+shift+e'], run: () => S().setSidebar({ visible: true, view: 'files' }) },
  { id: 'sidebar.search', title: 'Search in project', keys: ['cmd+shift+f'], run: () => { S().setSidebar({ visible: true, view: 'search' }); bus.emit('search.focus'); } },
  { id: 'palette.commands', title: 'Command palette', keys: ['cmd+shift+p'], run: () => S().openPalette('commands') },
  { id: 'palette.files', title: 'Open file by name (Enter: in the editor you are in; ⌘Enter: in a new editor beside it)', keys: ['cmd+p', 'cmd+o'], run: () => S().openPalette('files') },
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
  { id: 'editor.copyPath', title: 'Copy the full path of this file', keys: ['alt+cmd+c'], when: () => !!editor()?.active, run: () => { api.clipboard.write(editor()!.active!); S().showToast('Path copied'); } },
  { id: 'editor.uploadImages', title: 'Upload the pictures in this note', when: () => !!editor()?.active && isMarkdown(editor()!.active!), run: () => { void uploadNoteImages(editor()!.active!); } },
  { id: 'editor.save', title: 'Save file', keys: ['cmd+s'], when: () => !!editor()?.active, run: async () => { const e = editor()!; if (await saveFile(e.active!)) S().showToast('Saved'); } },
  { id: 'editor.toggleWrap', title: 'Turn word wrap on or off', keys: ['alt+z'], run: () => { S().updateSettings({ wordWrap: !S().settings.wordWrap }); S().showToast(S().settings.wordWrap ? 'Word wrap on' : 'Word wrap off'); } },
  { id: 'editor.toggleCaret', title: 'Turn smooth caret on or off', run: () => { S().updateSettings({ smoothCaret: !S().settings.smoothCaret }); S().showToast(S().settings.smoothCaret ? 'Smooth caret on' : 'Smooth caret off'); } },
  { id: 'editor.toggleRendered', title: 'Switch Markdown between rendered and raw', keys: ['cmd+shift+r', 'cmd+shift+v'], when: () => !!editor()?.active && isMarkdown(editor()!.active!), run: () => { const e = editor()!; S().toggleRendered(e.id, e.active!); refocus(); } },
  {
    // ⌘R, anywhere, brings Astrolabe up to date with its source folder. A change to the interface alone is
    // built in about a second and the window reloads where it stands, terminals still running; more than that relaunches.
    id: 'app.update', title: 'Update Astrolabe from its source folder', keys: ['cmd+r'], run: async () => {
      const status = await api.app.checkUpdate();
      if (status === 'current') { S().showToast('Astrolabe is up to date'); return; }
      if (status === 'busy') { S().showToast('Already updating…', 120000); return; }
      if (status === 'dev') { S().showToast('This copy runs from the dev server, which updates by itself'); return; }
      if (status === 'no-source') { S().showToast('Cannot find the folder this copy was built from'); return; }
      S().showToast(status === 'reload' ? 'Updating…' : 'Building the new version…', 180000);
      const running = Object.values(S().panes).filter((p) => p.kind === 'terminal' && p.running).length;
      const res = await api.app.installUpdate(running);
      if (!res.ok) S().showToast(`Update failed: ${res.detail ?? 'unknown error'}`, 8000);
      else S().showToast(res.detail ?? 'Updated', res.detail === 'Relaunching…' ? 10000 : undefined);
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
    if ((c.when && !c.when()) || (c.keyWhen?.[k] && !c.keyWhen[k]())) continue;
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

