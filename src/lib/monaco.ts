import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker';
import { gemoji } from 'gemoji';
import { api, basename, joinPath } from './api';
import { carried, carry } from './handoff';
import { getTheme, monacoTheme, Theme } from './themes';
import { EXIT_MS } from './motion';
import { bus } from './panes';
import { useStore } from './store';
import * as review from './review';

(self as any).MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'json') return new JsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker();
    if (label === 'typescript' || label === 'javascript') return new TsWorker();
    return new EditorWorker();
  },
};

export { monaco };
(window as any).__monaco = monaco;
// The symbols font sits right after the text font so prompt themes get their Nerd Font glyphs with any typeface.
export const MONO = '"Commit Mono", "Symbols Nerd Font Mono", "SF Mono", Menlo, Monaco, monospace';
export function monoFont() {
  const custom = useStore.getState().settings.fontFamily.trim();
  return custom ? `"${custom.replace(/"/g, '')}", ${MONO}` : MONO;
}

// Popups (completions, hovers) render here, outside the panes, so pane clipping
// and transforms cannot misplace them.
export const overflowNode = document.createElement('div');
overflowNode.className = 'monaco-editor astro-overflow';
document.body.appendChild(overflowNode);

export function setMonacoTheme(t: Theme) {
  monaco.editor.defineTheme('astrolabe', monacoTheme(t) as monaco.editor.IStandaloneThemeData);
  monaco.editor.setTheme('astrolabe');
}

// Project files rarely resolve their imports inside a bare editor, so semantic
// checks would paint every file red. Keep syntax errors only.
try {
  const ts = (monaco.languages as any).typescript ?? (monaco as any).typescript;
  const quiet = { noSemanticValidation: true, noSyntaxValidation: false };
  ts?.typescriptDefaults?.setDiagnosticsOptions(quiet);
  ts?.javascriptDefaults?.setDiagnosticsOptions(quiet);
} catch {}

setMonacoTheme(getTheme(useStore.getState().settings.theme));

// ---------- file models ----------

interface FileEntry { model: monaco.editor.ITextModel; savedVersion: number; mtime: number; /** The file's text as last read from or written to disk. */ disk: string }
const files = new Map<string, FileEntry>();
const saving = new Set<string>();
const isDirty = (entry: FileEntry) => entry.model.getAlternativeVersionId() !== entry.savedVersion;

// The main process watches every open file and says when one changes on disk.
let watchTimer = 0;
function syncWatch() {
  window.clearTimeout(watchTimer);
  watchTimer = window.setTimeout(() => api.fs.watch([...files.keys()]), 0);
}
api.fs.onFileChanged((path) => { void refreshFile(path); });
const loading = new Map<string, Promise<FileEntry | { error: string }>>();

// A window reloading in place keeps unsaved typing and the commands run this session (see handoff.ts).
interface CarriedFiles { unsaved: Record<string, string>; history: string[] }
let left: CarriedFiles | null | undefined;
const leftBehind = () => (left === undefined ? (left = carried<CarriedFiles>('files') ?? null) : left);
carry('files', (): CarriedFiles => ({
  unsaved: Object.fromEntries([...files].filter(([, e]) => !e.model.isDisposed() && isDirty(e)).map(([path, e]) => [path, e.model.getValue()])),
  history,
}));
/** Unsaved typing that came with a file from another window: the file shows it when it opens here. A file already
 *  open here with unsaved typing of its own keeps that. */
export function bringUnsaved(path: string, text: string) {
  const entry = files.get(path);
  if (entry && !entry.model.isDisposed()) { if (!isDirty(entry) && entry.model.getValue() !== text) entry.model.setValue(text); return; }
  (left ??= { unsaved: {}, history: [] }).unsaved[path] = text;
}
/** Settles when every file being opened has its text. */
export const filesLoaded = () => Promise.allSettled([...loading.values()]);

export function fileEntry(path: string) { return files.get(path); }

export function loadFile(path: string): Promise<FileEntry | { error: string }> {
  const existing = files.get(path);
  if (existing && !existing.model.isDisposed()) return Promise.resolve(existing);
  let p = loading.get(path);
  if (!p) {
    p = (async () => {
      const res = await api.fs.readFile(path);
      if (res.error) return { error: res.error as string };
      const uri = monaco.Uri.file(path);
      const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(res.text, undefined, uri);
      const entry: FileEntry = { model, savedVersion: model.getAlternativeVersionId(), mtime: res.mtime, disk: res.text };
      model.onDidChangeContent(() => {
        useStore.getState().setDirty(path, model.getAlternativeVersionId() !== entry.savedVersion);
      });
      files.set(path, entry);
      syncWatch();
      const unsaved = leftBehind()?.unsaved[path];
      if (unsaved !== undefined) { delete leftBehind()!.unsaved[path]; if (unsaved !== model.getValue()) model.setValue(unsaved); }
      review.restore(model);
      return entry;
    })().finally(() => loading.delete(path));
    loading.set(path, p);
  }
  return p;
}

export async function saveFile(path: string) {
  const entry = files.get(path);
  if (!entry) return false;
  // What is on disk afterwards is this version of the text, even if more is typed while it is being written.
  const version = entry.model.getAlternativeVersionId();
  const text = entry.model.getValue();
  saving.add(path);
  let res;
  try { res = await api.fs.writeFile(path, text); } finally { saving.delete(path); }
  if (!res.ok) { useStore.getState().showToast(`Could not save: ${res.error}`); return false; }
  entry.savedVersion = version;
  entry.mtime = res.mtime;
  entry.disk = text;
  useStore.getState().setDirty(path, isDirty(entry));
  useStore.getState().keepFile(path); // a saved file's tab is no longer a temporary one
  return true;
}

const under = (p: string, root: string) => p === root || p.startsWith(root + '/');
/** A file or folder was renamed: clean buffers are dropped (they reload from the new path); unsaved ones move across intact. */
export function moveFiles(from: string, to: string) {
  for (const [path, entry] of [...files]) {
    if (!under(path, from)) continue;
    const next = to + path.slice(from.length);
    const dirty = entry.model.getAlternativeVersionId() !== entry.savedVersion;
    const text = entry.model.getValue();
    entry.model.dispose();
    files.delete(path);
    if (!dirty) continue;
    const model = monaco.editor.createModel(text, undefined, monaco.Uri.file(next));
    const moved: FileEntry = { model, savedVersion: -1, mtime: 0, disk: '' };
    model.onDidChangeContent(() => { useStore.getState().setDirty(next, model.getAlternativeVersionId() !== moved.savedVersion); });
    files.set(next, moved);
  }
  syncWatch();
}

// A temporary tab that gave its place to another file (`openFile` in store.ts).
bus.on('file.closed', (path: string) => releaseFile(path));

export function releaseFile(path: string) {
  // A closed file tab stays in its pane while it fades out, so check once it has gone.
  window.setTimeout(() => {
    const s = useStore.getState();
    const stillOpen = Object.values(s.panes).some((p) => p.kind === 'editor' && p.files.some((f) => f.path === path));
    if (stillOpen) return;
    const model = files.get(path)?.model;
    if (model) review.forget(model);
    model?.dispose();
    files.delete(path);
    syncWatch();
    s.setDirty(path, false);
  }, EXIT_MS + 40);
}

// A change made to an open file from outside goes into its text, around any unsaved typing, and is marked there to be
// looked at (review.ts). The file is saved again after a change is undone, when nothing else in it is unsaved.
review.host.isDirty = (model) => { for (const e of files.values()) if (e.model === model) return isDirty(e); return true; };
review.host.save = (model) => { for (const [path, e] of files) if (e.model === model) void saveFile(path); };

async function refreshOnce(path: string) {
  const entry = files.get(path);
  if (!entry || entry.model.isDisposed() || saving.has(path)) return;
  const st = await api.fs.stat(path);
  if (!st.exists || st.mtime <= entry.mtime || saving.has(path)) return;
  const res = await api.fs.readFile(path);
  if (res.error || entry.model.isDisposed() || saving.has(path) || files.get(path) !== entry) return;
  entry.mtime = res.mtime;
  if (res.text === entry.disk) return; // touched, not changed
  // Typing in a rendered note reaches the text a moment after the keys: have it now, so it is merged, not lost.
  bus.emit('note.flush', entry.model);
  const dirty = isDirty(entry);
  const out = review.takeOutside(entry.model, entry.disk, res.text, useStore.getState().settings.reviewChanges);
  entry.disk = res.text;
  if (!dirty) {
    // The text is the file's again, changes and all.
    entry.savedVersion = entry.model.getAlternativeVersionId();
    useStore.getState().setDirty(path, false);
  } else if (out.clashes) {
    useStore.getState().showToast(`${basename(path)} changed on disk where you have unsaved edits. Yours are kept; the other version is shown beside them.`, 6000);
  }
}

/** The changes from outside still waiting to be looked at in a file. */
export const reviewOf = (path: string) => review.spans(files.get(path)?.model);

const refreshing = new Map<string, boolean>(); // path -> whether another pass was asked for meanwhile
/** Pick up an edit made outside the editor (by an agent, a command, another app) to a file with no unsaved changes. */
export async function refreshFile(path: string) {
  if (refreshing.has(path)) { refreshing.set(path, true); return; }
  refreshing.set(path, false);
  try {
    do { refreshing.set(path, false); await refreshOnce(path); } while (refreshing.get(path));
  } catch {} finally { refreshing.delete(path); }
}
/** The same for every open file: run when the app regains focus and when a command finishes, in case a change was missed. */
export async function refreshFiles() {
  await Promise.all([...files.keys()].map((path) => refreshFile(path)));
}

// ---------- command input: history ghost text and completions ----------

export interface InputContext { cwd: () => string }
const inputs = new Map<string, InputContext>();
export const history: string[] = [];
let historyLoaded = false;
export async function ensureHistory() {
  if (historyLoaded) return;
  historyLoaded = true;
  const kept = leftBehind()?.history;
  if (kept?.length) { history.unshift(...kept); return; }
  try { history.unshift(...((await api.shell.history()) as string[])); } catch {}
}
export function pushHistory(cmd: string) {
  const i = history.lastIndexOf(cmd);
  if (i >= 0) history.splice(i, 1);
  history.push(cmd);
}

export function registerInput(uri: string, ctx: InputContext) { inputs.set(uri, ctx); return () => inputs.delete(uri); }

const BUILTINS = ['cd', 'echo', 'export', 'alias', 'unalias', 'source', 'exit', 'history', 'pwd', 'set', 'unset', 'which', 'type', 'eval', 'exec', 'jobs', 'fg', 'bg', 'kill', 'wait', 'time', 'pushd', 'popd', 'print', 'read', 'test'];
const GIT_SUBCOMMANDS = ['add', 'bisect', 'blame', 'branch', 'checkout', 'cherry-pick', 'clean', 'clone', 'commit', 'diff', 'fetch', 'grep', 'init', 'log', 'merge', 'mv', 'pull', 'push', 'rebase', 'reflog', 'remote', 'reset', 'restore', 'revert', 'rm', 'show', 'stash', 'status', 'switch', 'tag', 'worktree'];
let commandCache: string[] | null = null;

function currentToken(line: string) {
  // The word being typed: everything after the last unescaped space.
  let start = 0;
  for (let i = 0; i < line.length; i++) if (line[i] === ' ' && line[i - 1] !== '\\') start = i + 1;
  return { token: line.slice(start), start };
}

/** What the word being typed could become: command names, git subcommands, files and folders. Each item is
 *  the whole word, already escaped, with a trailing "/" for folders and a space after anything finished. */
async function completions(ctx: InputContext, line: string) {
  const { token, start } = currentToken(line);
  const before = line.slice(0, start).trim();
  const words = before.split(/\s+/).filter(Boolean);
  const isFirst = before === '' || /[|;&]$/.test(before);
  const done = (items: string[], commands = false) => ({ token, start, commands, items: items.filter((t) => t.startsWith(token) && t.trimEnd() !== token) });
  if (!token || /^["']/.test(token)) return done([]);
  if (isFirst && !token.includes('/') && !token.startsWith('.') && !token.startsWith('~')) {
    if (!commandCache) commandCache = [...new Set([...BUILTINS, ...((await api.shell.commands()) as string[])])];
    return done(commandCache.filter((n) => n.startsWith(token)).sort((x, y) => x.length - y.length || x.localeCompare(y)).map((n) => n + ' '), true);
  }
  if (words[0] === 'git' && words.length === 1 && !token.startsWith('-')) {
    const subs = GIT_SUBCOMMANDS.filter((n) => n.startsWith(token)).map((n) => n + ' ');
    if (subs.length) return done(subs, true);
  }
  if (isFirst && '/file'.startsWith(token) && token.startsWith('/')) return done(['/file']);
  const entries = (await api.fs.complete(ctx.cwd(), token.replace(/\\ /g, ' '))) as { name: string; dir: boolean }[];
  const dirPart = token.slice(0, token.lastIndexOf('/') + 1);
  const dirsOnly = words[0] === 'cd' || words[0] === 'pushd' || words[0] === 'rmdir';
  const items = entries
    .filter((e) => !dirsOnly || e.dir)
    .sort((x, y) => Number(y.dir) - Number(x.dir))
    .map((e) => dirPart + e.name.replace(/([ ()&;'"$`!*?[\]{}<>|\\])/g, '\\$1') + (e.dir ? '/' : ' '));
  return done(items);
}

type Stat = (fullPath: string) => Promise<{ exists: boolean; dir: boolean }>;
function statCache(): Stat {
  const seen = new Map<string, Promise<{ exists: boolean; dir: boolean }>>();
  return (full) => {
    if (!seen.has(full)) seen.set(full, api.fs.stat(full));
    return seen.get(full)!;
  };
}

// Programs whose first path argument must already exist (unlike touch, mkdir, cp or mv, which may name new paths).
const READS_PATH = new Set(['cat', 'less', 'more', 'bat', 'head', 'tail', 'open', 'code', 'cursor', 'vim', 'nvim', 'vi', 'nano', 'emacs', 'source', '.', 'python', 'python3', 'node', 'bash', 'sh', 'zsh', 'ls', 'tree', 'wc', 'diff', 'rm', 'trash']);
const looksLikePath = (a: string) => a.includes('/') || /^[~.]/.test(a) || /\.[A-Za-z]\w{0,7}$/.test(a);

/** A remembered command is only suggested if the places it goes still exist from here: cd's folder must be
 *  a folder, and a file a program opens must be there. Paths after a cd are read from that folder. */
async function historyStillWorks(cmd: string, cwd: string, stat: Stat) {
  let base = cwd;
  const unquoted = cmd.replace(/"(?:\\.|[^"])*"|'[^']*'/g, '""');
  for (const segment of unquoted.split(/&&|\|\||;|\|/)) {
    const words = segment.trim().match(/(?:\\ |[^\s])+/g)?.map((w) => w.replace(/\\ /g, ' ')) ?? [];
    const [prog, ...args] = words;
    if (!prog) continue;
    const plain = args.filter((a) => !a.startsWith('-') && !/^["'$`]/.test(a) && !/[*?{}=]/.test(a));
    if (prog === 'cd' || prog === 'pushd') {
      const dest = plain[0];
      if (!dest || dest === '-') { base = dest ? base : joinPath(base, '~'); continue; }
      const full = joinPath(base, dest);
      const st = await stat(full);
      if (!st.exists || !st.dir) return false;
      base = full;
    } else if (READS_PATH.has(prog) && !args.some((a) => a === '-c' || a === '-m' || a === '-e')) {
      const p = plain.find(looksLikePath);
      if (p && !(await stat(joinPath(base, p))).exists) return false;
    }
  }
  return true;
}

function commonPrefix(items: string[]) {
  let p = items[0];
  for (const t of items) while (!t.startsWith(p)) p = p.slice(0, -1);
  return p;
}

/** The grey text after what you have typed in a command input, which Tab (or →) accepts. Your history comes
 *  first; otherwise the word is completed, as far as the choices agree (or to the first, for files). */
export async function ghostFor(uri: string, text: string): Promise<string | null> {
  const ctx = inputs.get(uri);
  if (!ctx || !text || text.includes('\n')) return null;
  const stat = statCache();
  const cwd = ctx.cwd();
  let checked = 0;
  for (let i = history.length - 1; i >= 0 && checked < 30; i--) {
    const h = history[i];
    if (h.length <= text.length || !h.startsWith(text) || h.includes('\n')) continue;
    checked++;
    if (await historyStillWorks(h, cwd, stat)) return h;
  }
  if (/\s$/.test(text) && !/\\\s$/.test(text)) return null;
  const { token, start, commands, items } = await completions(ctx, text);
  if (!items.length) return null;
  let word = items.length === 1 ? items[0] : commonPrefix(items);
  if (word.length <= token.length) word = commands ? '' : items[0];
  if (!word || word === token) return null;
  return text.slice(0, start) + word;
}

monaco.languages.registerInlineCompletionsProvider('shell', {
  async provideInlineCompletions(model, position) {
    const text = model.getValue();
    const atEnd = position.lineNumber === model.getLineCount() && position.column === model.getLineMaxColumn(position.lineNumber);
    if (!atEnd) return { items: [] };
    const ghost = await ghostFor(model.uri.toString(), text);
    if (!ghost || model.getValue() !== text) return { items: [] };
    return { items: [{ insertText: ghost, range: new monaco.Range(1, 1, 1, text.length + 1) }] };
  },
  freeInlineCompletions() {},
  disposeInlineCompletions() {},
} as any);

// ---------- emoji: suggestions from the first ":" and :shortcode: replacement ----------

const EMOJI = new Map<string, string>();
for (const g of gemoji) for (const name of g.names) EMOJI.set(name, g.emoji);
export const emojiFor = (name: string) => EMOJI.get(name.toLowerCase());
/** A ":" starts an emoji only at the start of a word, so "10:30", "fix:" and "http://" are left alone. */
const EMOJI_OPEN = /(?:^|[\s(>"'])(:[a-z0-9_+-]*)$/i;
export const loneColon = (textBeforeCursor: string) => /(?:^|[\s(>"']):$/.test(textBeforeCursor);

function emojiProvider(onlyInputs: boolean): monaco.languages.CompletionItemProvider {
  return {
    triggerCharacters: [':'],
    provideCompletionItems(model, position) {
      if (onlyInputs && !inputs.has(model.uri.toString())) return { suggestions: [] };
      const m = EMOJI_OPEN.exec(model.getLineContent(position.lineNumber).slice(0, position.column - 1));
      if (!m) return { suggestions: [] };
      const range = new monaco.Range(position.lineNumber, position.column - m[1].length, position.lineNumber, position.column);
      return {
        suggestions: gemoji.map((g, i) => ({
          label: `${g.emoji}  :${g.names[0]}:`,
          kind: monaco.languages.CompletionItemKind.Value,
          insertText: g.emoji,
          filterText: `:${g.names.join(' :')} ${g.tags.join(' ')}`,
          detail: g.description,
          range,
          sortText: String(i).padStart(5, '0'),
        })),
      };
    },
  };
}
monaco.languages.registerCompletionItemProvider('shell', emojiProvider(true));
monaco.languages.registerCompletionItemProvider('markdown', emojiProvider(false));
monaco.languages.registerCompletionItemProvider('plaintext', emojiProvider(false));

/** Turns a finished :shortcode: into its emoji as the closing colon is typed. */
export function attachEmoji(editor: monaco.editor.IStandaloneCodeEditor, enabled: () => boolean = () => true) {
  return editor.onDidChangeModelContent((e) => {
    if (e.isUndoing || e.isRedoing || e.changes.length !== 1 || e.changes[0].text !== ':' || !enabled()) return;
    const model = editor.getModel();
    if (!model) return;
    const ln = e.changes[0].range.startLineNumber;
    const col = e.changes[0].range.startColumn + 1;
    const m = /(?:^|[\s(>"'])(:([a-z0-9_+-]+):)$/i.exec(model.getLineContent(ln).slice(0, col - 1));
    const emoji = m && emojiFor(m[2]);
    if (!m || !emoji) return;
    queueMicrotask(() => {
      editor.trigger('emoji', 'hideSuggestWidget', {});
      editor.executeEdits('emoji', [{ range: new monaco.Range(ln, col - m[1].length, ln, col), text: emoji }]);
    });
  });
}

export function contextValue(editor: monaco.editor.ICodeEditor, key: string): boolean {
  try { return !!(editor as any)._contextKeyService.getContextKeyValue(key); } catch { return false; }
}
