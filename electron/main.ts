import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, protocol, net, shell, clipboard, systemPreferences, WebContents } from 'electron';
import * as pty from 'node-pty';
import { spawn, execFile, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installZshIntegration, shellEnv, stripSessionMarkers } from './shell';

// Before anything is spawned: never carry a launching agent session's markers into this app's children.
stripSessionMarkers(process.env);

const DIST = path.join(__dirname, '..', 'dist');
const CONFIG_DIR = process.env.ASTROLABE_CONFIG_DIR || path.join(os.homedir(), '.astrolabe');
const SETTINGS_FILE = path.join(CONFIG_DIR, 'settings.json');
const STATE_FILE = path.join(CONFIG_DIR, 'state.json');
const USER_SHELL = process.env.ASTROLABE_SHELL || os.userInfo().shell || process.env.SHELL || '/bin/zsh';

protocol.registerSchemesAsPrivileged([
  { scheme: 'astrolabe', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

// ---------- small helpers ----------

function readJson<T>(file: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}
function expandHome(p: string) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}
function run(cmd: string, args: string[], opts: { cwd?: string; timeout?: number; maxBuffer?: number } = {}) {
  return new Promise<string>((resolve) => {
    execFile(cmd, args, { cwd: opts.cwd, timeout: opts.timeout ?? 4000, maxBuffer: opts.maxBuffer ?? 32 * 1024 * 1024, env: { ...process.env, PATH: userPath } },
      (_err, stdout) => resolve(stdout ?? ''));
  });
}

// Apps launched from Finder get a bare PATH, so ask a login shell for the real one.
let userPath = process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin';
const userPathReady = new Promise<void>((resolve) => {
  execFile(USER_SHELL, ['-ilc', 'printf "__ASTROLABE_PATH__%s__ASTROLABE_END__" "$PATH"'], { timeout: 6000 }, (_e, stdout) => {
    const m = /__ASTROLABE_PATH__(.*)__ASTROLABE_END__/s.exec(stdout || '');
    if (m && m[1]) userPath = m[1];
    resolve();
  });
});

// ---------- updating from source ----------
// An installed copy knows the folder it was built from. ⌘R brings it up to date with that
// folder, doing no more than the change calls for:
//   the interface (src/)            built straight into this copy in about a second; every window then reloads
//                                   where it stands, with its shells still running
//   the main process (electron/)    built straight into this copy, which then relaunches (that ends its shells)
//   Electron, node-pty, the icon    the whole app is packaged again and swapped in, as `npm run install-app` does

interface Stamp { source: string; builtAt: number; ui?: number; main?: number }
const APP_DIR = app.getAppPath();
const STAMP_FILE = path.join(APP_DIR, 'dist-electron', 'source.json');
const UI_PARTS = ['src', 'index.html', 'vite.config.ts'];
const MAIN_PARTS = ['electron'];
const PACKAGE_PARTS = ['build'];
async function newestMtime(p: string): Promise<number> {
  try {
    const st = await fsp.stat(p);
    if (!st.isDirectory()) return st.mtimeMs;
    let newest = 0;
    for (const e of await fsp.readdir(p)) if (e !== '.DS_Store') newest = Math.max(newest, await newestMtime(path.join(p, e)));
    return newest;
  } catch { return 0; }
}
function buildStamp(): Stamp | null {
  const s = readJson<Stamp | null>(STAMP_FILE, null);
  return s?.source && fs.existsSync(path.join(s.source, 'package.json')) ? s : null;
}
/** What a packaged copy holds besides the two builds: its name and version, Electron, and the modules the main
 *  process loads from node_modules instead of bundling. A difference here can only be fixed by packaging again. */
function runtimeOf(dir: string, modules: string[], electron?: string) {
  const pkg = readJson<any>(path.join(dir, 'package.json'), {});
  const version = (name: string) => readJson<any>(path.join(dir, 'node_modules', name, 'package.json'), {}).version;
  return JSON.stringify([pkg.name, pkg.productName, pkg.version, pkg.main, electron ?? version('electron'), modules.map((n) => `${n}@${version(n)}`)]);
}
async function pendingUpdate(stamp: Stamp) {
  const newest = async (parts: string[]) => Math.max(0, ...(await Promise.all(parts.map((part) => newestMtime(path.join(stamp.source, part))))));
  const [ui, main, extra] = await Promise.all([newest(UI_PARTS), newest(MAIN_PARTS), newest(PACKAGE_PARTS)]);
  const mainAt = stamp.main ?? stamp.builtAt;
  const script = String(readJson<any>(path.join(stamp.source, 'package.json'), {}).scripts?.['build:main'] ?? '');
  const modules = [...script.matchAll(/--external:(\S+)/g)].map((m) => m[1]).filter((n) => n !== 'electron');
  return {
    ui: ui > (stamp.ui ?? stamp.builtAt),
    main: main > mainAt,
    // Run from its source folder there is nothing to package.
    pack: app.isPackaged && (extra > mainAt || runtimeOf(stamp.source, modules) !== runtimeOf(APP_DIR, modules, process.versions.electron)),
  };
}
let updating = false;
async function checkUpdate(): Promise<'dev' | 'no-source' | 'current' | 'reload' | 'relaunch' | 'busy'> {
  if (process.env.ASTROLABE_DEV_URL) return 'dev';
  if (updating) return 'busy';
  const stamp = buildStamp();
  if (!stamp) return 'no-source';
  const need = await pendingUpdate(stamp);
  return need.main || need.pack ? 'relaunch' : need.ui ? 'reload' : 'current';
}
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
function build(source: string, script: string) {
  return new Promise<{ ok: boolean; out: string }>((resolve) => {
    let out = '';
    const child = spawn(USER_SHELL, ['-lc', script], { cwd: source, env: { ...stripSessionMarkers({ ...process.env }), PATH: userPath } });
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ ok: code === 0, out }));
    child.on('error', (err) => resolve({ ok: false, out: String(err) }));
  });
}
/** The part of a failed build's output that says what went wrong: from its first error, else its last lines. */
function lastLines(out: string) {
  const lines = out.replace(/\x1b\[[0-9;]*m/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  const at = lines.findIndex((l) => /\berror\b/i.test(l));
  return (at >= 0 ? lines.slice(at, at + 3) : lines.slice(-3)).join(' ').slice(0, 240);
}
/** Quits and opens again. If the quit is called off (unsaved files), it reopens whenever Astrolabe next quits. */
function relaunch(beforeOpen = '') {
  const scripted = !!process.env.ASTROLABE_TEST; // a scripted run closes the app itself and must not see it come back
  if (app.isPackaged) {
    const bundle = path.resolve(APP_DIR, '..', '..', '..'); // …/Astrolabe.app
    const script = `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.1; done; ${beforeOpen}${scripted ? 'true' : `open ${q(bundle)}`}`;
    spawn('/bin/sh', ['-c', script], { detached: true, stdio: 'ignore' }).unref();
  } else if (!scripted) app.relaunch();
  setTimeout(() => app.quit(), 200);
}
async function installUpdate(win: BrowserWindow | null, running: number): Promise<{ ok: boolean; detail?: string }> {
  const stamp = buildStamp();
  if (!stamp || updating) return { ok: false, detail: updating ? 'Already updating' : 'Source folder not found' };
  updating = true;
  const need = await pendingUpdate(stamp);
  const stay = (res: { ok: boolean; detail?: string }) => { updating = false; return res; };
  if (!need.ui && !need.main && !need.pack) return stay({ ok: true, detail: 'Astrolabe is up to date' });
  let restart = need.main || need.pack;
  if (restart && running > 0 && !process.env.ASTROLABE_TEST) {
    // A relaunch ends whatever the terminals are running, so it is never a surprise.
    const buttons = need.ui ? ['Relaunch', 'Reload Window Only', 'Cancel'] : ['Relaunch', 'Cancel'];
    const opts: Electron.MessageBoxOptions = {
      type: 'question', buttons, defaultId: 0, cancelId: buttons.length - 1,
      message: 'This update needs Astrolabe to relaunch.',
      detail: `More than the interface has changed, and relaunching ends the ${running === 1 ? 'command' : `${running} commands`} running in your terminals.${need.ui ? ' Reloading the window alone keeps them running and brings in the changes to the interface.' : ''}`,
    };
    const choice = buttons[(win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)).response];
    if (choice === 'Cancel') return stay({ ok: true, detail: 'Not updated' });
    if (choice !== 'Relaunch') restart = false;
  }
  await userPathReady;
  const started = Date.now(); // not when the build ends: a file saved while it runs is newer than this build
  if (restart && need.pack) {
    const res = await build(stamp.source, 'npm run package');
    const built = path.join(stamp.source, 'release', 'Astrolabe-darwin-arm64', 'Astrolabe.app');
    if (!res.ok || !fs.existsSync(built)) return stay({ ok: false, detail: lastLines(res.out) || 'The build produced nothing' });
    const bundle = path.resolve(APP_DIR, '..', '..', '..');
    relaunch(`rm -rf ${q(bundle)} && ditto ${q(built)} ${q(bundle)} && rm -rf ${q(path.join(stamp.source, 'release'))} && `);
    return { ok: true, detail: 'Relaunching…' };
  }
  // Both builds go into folders beside the ones in use and are swapped in only when they are whole.
  const nextUi = path.join(APP_DIR, 'dist.next');
  const nextMain = path.join(APP_DIR, 'dist-electron.next');
  const lastUi = path.join(APP_DIR, 'dist.old');
  const clear = (...dirs: string[]) => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); };
  clear(nextUi, nextMain);
  const results = await Promise.all([
    need.ui ? build(stamp.source, `npm run build:ui -- --outDir ${q(nextUi)} --emptyOutDir`) : null,
    restart ? build(stamp.source, `npm run build:main -- --outdir=${q(nextMain)}`) : null,
  ]);
  const failed = results.find((r) => r && !r.ok);
  if (failed || (need.ui && !fs.existsSync(path.join(nextUi, 'index.html'))) || (restart && !fs.existsSync(path.join(nextMain, 'main.cjs')))) {
    clear(nextUi, nextMain);
    return stay({ ok: false, detail: (failed && lastLines(failed.out)) || 'The build produced nothing' });
  }
  try {
    if (need.ui) { clear(lastUi); fs.renameSync(DIST, lastUi); fs.renameSync(nextUi, DIST); }
    if (restart) for (const f of fs.readdirSync(nextMain)) fs.renameSync(path.join(nextMain, f), path.join(APP_DIR, 'dist-electron', f));
  } catch (err: any) {
    if (!fs.existsSync(DIST) && fs.existsSync(lastUi)) fs.renameSync(lastUi, DIST);
    clear(nextUi, nextMain);
    return stay({ ok: false, detail: String(err?.message ?? err).slice(0, 240) });
  }
  clear(nextMain);
  if (restart) {
    writeJson(STAMP_FILE, { ...stamp, ui: need.ui ? started : stamp.ui, main: started });
    clear(lastUi);
    relaunch();
    return { ok: true, detail: 'Relaunching…' };
  }
  // Only the interface changed: every window reloads where it stands and its shells never notice.
  writeJson(STAMP_FILE, { ...stamp, ui: started });
  const windows = BrowserWindow.getAllWindows();
  const up = await Promise.all(windows.map((w) => reloadWindow(w, 'Updated')));
  if (up.every(Boolean)) { clear(lastUi); return stay({ ok: true }); }
  // The new build never drew its first screen. Put the last one back rather than leave a blank window.
  clear(DIST);
  fs.renameSync(lastUi, DIST);
  writeJson(STAMP_FILE, stamp);
  await Promise.all(windows.filter((w) => !w.isDestroyed()).map((w) => reloadWindow(w, 'The new build did not start, so the last one is back')));
  return stay({ ok: false, detail: 'The new build did not start' });
}

// ---------- terminal sessions ----------

const unsaved = new Map<number, number>();
let testMenuChoice: string | null = null;

interface Session {
  proc: pty.IPty; wc: WebContents; buf: string; timer: NodeJS.Timeout | null;
  /** Its window is reloading in place: output waits instead of going to a page that is not there. */
  held: boolean;
  /** Output since the reloading page described its screen. The new page starts from that description, so it
   *  is sent this too; it is kept until that page is up, in case the reload has to be done again. */
  since: string | null; cut: number;
  /** It ended while held; the new page is told when it takes over. */
  exit: number | null;
}
const sessions = new Map<string, Session>();
function flushSession(id: string, s: Session) {
  if (s.timer) { clearTimeout(s.timer); s.timer = null; }
  if (!s.buf) return;
  const data = s.buf; s.buf = '';
  if (!s.wc.isDestroyed()) s.wc.send('pty:data', id, data);
}
let integrationDir: string | null = null;

const noteDate = (d = new Date()) => `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}.${d.getFullYear()}`;
let lastAddress: { text: string; at: number } | null = null;
/** House number and street from CoreLocationCLI (brew install corelocationcli), as the Obsidian note script does.
 *  Falls back to the last street found in the past hour, then to "???" to fill in by hand. */
function streetAddress(): Promise<string> {
  const fallback = () => (lastAddress && Date.now() - lastAddress.at < 3600_000 ? lastAddress.text : '???');
  const cli = ['/opt/homebrew/bin/CoreLocationCLI', '/usr/local/bin/CoreLocationCLI'].find((p) => fs.existsSync(p));
  if (!cli) return Promise.resolve(fallback());
  return new Promise((resolve) => {
    execFile(cli, ['--format', '%subThoroughfare %thoroughfare'], { timeout: 6000 }, (_err, stdout) => {
      const line = String(stdout ?? '').split('\n')[0].trim();
      // Exit codes are unreliable: a street has letters and is not an error message.
      if (/[A-Za-z]/.test(line) && !/\b(error|denied|nil|null|unknown)\b/i.test(line)) { lastAddress = { text: line, at: Date.now() }; resolve(line); }
      else resolve(fallback());
    });
  });
}

function spawnSession(wc: WebContents, id: string, opts: { cwd?: string; cols: number; rows: number; prompt?: 'own' | 'native' }) {
  let cwd = opts.cwd ? expandHome(opts.cwd) : os.homedir();
  try { if (!fs.statSync(cwd).isDirectory()) cwd = os.homedir(); } catch { cwd = os.homedir(); }
  const isZsh = path.basename(USER_SHELL) === 'zsh';
  // A page that starts a shell under an id already in use has no further use for the old one.
  const old = sessions.get(id);
  if (old) { sessions.delete(id); try { old.proc.kill(); } catch {} }
  const proc = pty.spawn(USER_SHELL, ['-l'], {
    name: 'xterm-256color',
    cols: Math.max(2, opts.cols),
    rows: Math.max(2, opts.rows),
    cwd,
    env: shellEnv(USER_SHELL, isZsh ? integrationDir : null, opts.prompt ?? 'native') as { [k: string]: string },
  });
  const s: Session = { proc, wc, buf: '', timer: null, held: false, since: null, cut: 0, exit: null };
  sessions.set(id, s);
  proc.onData((d) => {
    if (s.since !== null) { s.since += d; if (s.since.length > 64 << 20) s.since = s.since.slice(-(32 << 20)); }
    if (s.held) return;
    s.buf += d;
    if (s.buf.length > 1 << 16) flushSession(id, s);
    else if (!s.timer) s.timer = setTimeout(() => flushSession(id, s), 4);
  });
  proc.onExit(({ exitCode }) => {
    if (sessions.get(id) !== s) return; // killed, or replaced under the same id
    if (s.held) { s.exit = exitCode; return; }
    flushSession(id, s);
    sessions.delete(id);
    if (!s.wc.isDestroyed()) s.wc.send('pty:exit', id, exitCode);
  });
  return { integrated: isZsh && !!integrationDir, shell: USER_SHELL };
}

/** The page that replaced a reloaded one takes a shell back, along with what it printed in between. */
function attachSession(wc: WebContents, id: string) {
  const s = sessions.get(id);
  if (!s) return false;
  if (s.timer) { clearTimeout(s.timer); s.timer = null; }
  s.buf = '';
  s.wc = wc;
  s.held = false;
  if (s.since) wc.send('pty:data', id, s.since);
  if (s.exit !== null) { sessions.delete(id); wc.send('pty:exit', id, s.exit); }
  return true;
}

// ---------- reloading a window in place ----------
// The page is replaced; the window, this process and the shells are not. The old page describes itself first
// (src/lib/handoff.ts), the shells' output is held while there is no page to take it, and a picture of the
// window covers the gap until the new page has drawn (the preload script shows it).

const handoffs = new Map<number, Record<string, unknown>>();
const shots = new Map<number, Buffer>();
const bootWaiters = new Map<number, (up: boolean) => void>();
const reloading = new Set<number>();
let prepareSeq = 0;

function askPage(wc: WebContents, ms: number) {
  return new Promise<Record<string, unknown> | null>((resolve) => {
    const token = ++prepareSeq;
    const done = (data: Record<string, unknown> | null) => { clearTimeout(timer); ipcMain.removeListener('app:handoff', heard); resolve(data); };
    const heard = (e: Electron.IpcMainEvent, t: number, data: Record<string, unknown> | null) => { if (e.sender === wc && t === token) done(data ?? null); };
    const timer = setTimeout(() => done(null), ms);
    ipcMain.on('app:handoff', heard);
    wc.send('app:prepareReload', token);
  });
}

/** Reloads a window where it stands. Resolves true once the new page is up, false if it never drew. */
async function reloadWindow(win: BrowserWindow, note?: string): Promise<boolean> {
  const wc = win.webContents;
  if (win.isDestroyed() || reloading.has(wc.id)) return false;
  reloading.add(wc.id);
  try {
    const mine = [...sessions].filter(([, s]) => s.wc === wc);
    // Everything printed so far reaches the page before it is asked to describe itself; nothing after does.
    for (const [id, s] of mine) { flushSession(id, s); s.held = true; s.cut = s.since?.length ?? 0; if (s.since === null) s.since = ''; }
    const [data, image] = await Promise.all([askPage(wc, 5000), wc.capturePage().catch(() => null)]);
    if (wc.isDestroyed()) return false;
    if (data) {
      handoffs.set(wc.id, data);
      for (const [, s] of mine) s.since = (s.since ?? '').slice(s.cut);
      if (image && !image.isEmpty()) shots.set(wc.id, image.toPNG()); else shots.delete(wc.id);
    } // a page that cannot answer keeps what the page before it left: its description and its picture
    const kept = handoffs.get(wc.id);
    if (kept) { if (note) kept.note = note; else delete kept.note; }
    const up = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => { bootWaiters.delete(wc.id); resolve(false); }, 8000);
      bootWaiters.set(wc.id, (ok) => { clearTimeout(timer); bootWaiters.delete(wc.id); resolve(ok); });
    });
    wc.reloadIgnoringCache();
    return await up;
  } finally { reloading.delete(wc.id); }
}

/** A page has drawn its first screen (after a reload: with its terminals back). */
function pageBooted(wc: WebContents) {
  handoffs.delete(wc.id);
  shots.delete(wc.id);
  for (const [id, s] of sessions) {
    if (s.wc !== wc) continue;
    s.since = null;
    // A shell the new page did not take back has no terminal any more.
    if (s.held) { sessions.delete(id); try { s.proc.kill(); } catch {} }
  }
  bootWaiters.get(wc.id)?.(true);
}

function killSessionsFor(wc: WebContents) {
  for (const [id, s] of sessions) if (s.wc === wc) { try { s.proc.kill(); } catch {} sessions.delete(id); }
}

// ---------- files ----------

const IGNORED_DIRS = new Set(['.git', 'node_modules', '.DS_Store', 'dist', 'target', '.next', '.venv', '__pycache__', '.cache']);

async function readDir(dir: string) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const out: { name: string; path: string; dir: boolean }[] = [];
  for (const e of entries) {
    if (e.name === '.DS_Store') continue;
    let isDir = e.isDirectory();
    if (e.isSymbolicLink()) {
      try { isDir = (await fsp.stat(path.join(dir, e.name))).isDirectory(); } catch {}
    }
    out.push({ name: e.name, path: path.join(dir, e.name), dir: isDir });
  }
  out.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) : a.dir ? -1 : 1));
  return out;
}

async function listFiles(root: string): Promise<string[]> {
  await userPathReady;
  // Most recently changed first, so the file picker opens on what was worked on last.
  const viaRg = await run('rg', ['--files', '--hidden', '--sortr', 'modified', '-g', '!.git', '-g', '!node_modules'], { cwd: root, timeout: 8000, maxBuffer: 64 * 1024 * 1024 });
  if (viaRg) return viaRg.split('\n').filter(Boolean).slice(0, 40000);
  const out: string[] = [];
  const walk = async (dir: string, rel: string, depth: number) => {
    if (out.length > 20000 || depth > 8) return;
    let entries: fs.Dirent[] = [];
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (IGNORED_DIRS.has(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(path.join(dir, e.name), r, depth + 1);
      else out.push(r);
    }
  };
  await walk(root, '', 0);
  return out;
}

async function completePath(cwd: string, token: string) {
  const expanded = expandHome(token);
  const endsWithSep = token.endsWith('/');
  const abs = path.isAbsolute(expanded) ? expanded : path.join(cwd, expanded);
  const dir = endsWithSep || token === '' ? abs : path.dirname(abs);
  const base = endsWithSep || token === '' ? '' : path.basename(abs);
  try {
    const entries = await readDir(dir);
    const lower = base.toLowerCase();
    return entries
      .filter((e) => e.name.toLowerCase().startsWith(lower) && (base.startsWith('.') || !e.name.startsWith('.')))
      .slice(0, 300)
      .map((e) => ({ name: e.name, dir: e.dir }));
  } catch { return []; }
}

let pathCommands: string[] | null = null;
async function listCommands() {
  if (pathCommands) return pathCommands;
  await userPathReady;
  const seen = new Set<string>();
  for (const dir of userPath.split(':')) {
    try { for (const name of await fsp.readdir(dir)) seen.add(name); } catch {}
  }
  pathCommands = [...seen].sort();
  setTimeout(() => { pathCommands = null; }, 60_000);
  return pathCommands;
}

function loadHistory(): string[] {
  const file = process.env.HISTFILE || path.join(os.homedir(), '.zsh_history');
  let raw = '';
  try {
    const buf = fs.readFileSync(file);
    raw = buf.subarray(Math.max(0, buf.length - 2 * 1024 * 1024)).toString('utf8');
  } catch { return []; }
  const out: string[] = [];
  let pending = '';
  for (const line of raw.split('\n')) {
    let text = line;
    if (!pending) text = text.replace(/^: \d+:\d+;/, '');
    if (text.endsWith('\\')) { pending += text.slice(0, -1) + '\n'; continue; }
    const cmd = (pending + text).trim();
    pending = '';
    if (cmd && !cmd.includes('�')) out.push(cmd);
  }
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (let i = out.length - 1; i >= 0 && uniq.length < 4000; i--) {
    if (!seen.has(out[i])) { seen.add(out[i]); uniq.push(out[i]); }
  }
  return uniq.reverse();
}

async function gitInfo(cwd: string) {
  await userPathReady;
  const out = await run('git', ['-C', cwd, 'rev-parse', '--show-toplevel', '--abbrev-ref', 'HEAD'], { timeout: 1500 });
  const [root, branch] = out.trim().split('\n');
  if (!root || !branch) return null;
  const status = await run('git', ['-C', cwd, 'status', '--porcelain', '--untracked-files=no'], { timeout: 1500 });
  return { root, branch, dirty: status.split('\n').filter(Boolean).length };
}

// ---------- Google Fonts catalogue ----------

const FONTS_FILE = path.join(CONFIG_DIR, 'google-fonts.json');
async function listGoogleFonts(): Promise<{ family: string; category: string }[]> {
  const cached = readJson<{ at: number; fonts: { family: string; category: string }[] } | null>(FONTS_FILE, null);
  if (cached && Date.now() - cached.at < 7 * 86400_000 && cached.fonts?.length) return cached.fonts;
  try {
    const res = await net.fetch('https://fonts.google.com/metadata/fonts');
    const text = (await res.text()).replace(/^\)\]\}'\n?/, '');
    const data = JSON.parse(text);
    const fonts = (data.familyMetadataList as any[]).map((f) => ({ family: String(f.family), category: String(f.category ?? '') }));
    if (fonts.length) writeJson(FONTS_FILE, { at: Date.now(), fonts });
    return fonts;
  } catch {
    return cached?.fonts ?? [];
  }
}

// ---------- project search ----------

const searches = new Map<number, ChildProcess>();
async function searchProject(wc: WebContents, opts: { root: string; query: string; regex?: boolean; caseSensitive?: boolean }) {
  await userPathReady;
  searches.get(wc.id)?.kill();
  if (!opts.query) return { files: [], truncated: false, engine: 'rg' };
  const args = ['--json', '--max-count', '200', '--max-columns', '400', '--hidden', '-g', '!.git'];
  args.push(opts.caseSensitive ? '-s' : '-S');
  if (!opts.regex) args.push('-F');
  args.push('--', opts.query, '.');
  return new Promise<{ files: { path: string; matches: { line: number; col: number; text: string; len: number }[] }[]; truncated: boolean; engine: string; error?: string }>((resolve) => {
    const child = spawn('rg', args, { cwd: opts.root, env: { ...process.env, PATH: userPath } });
    searches.set(wc.id, child);
    const files = new Map<string, { path: string; matches: { line: number; col: number; text: string; len: number }[] }>();
    let total = 0; let truncated = false; let rest = ''; let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      rest += chunk.toString('utf8');
      const lines = rest.split('\n');
      rest = lines.pop() ?? '';
      for (const line of lines) {
        if (!line) continue;
        try {
          const ev = JSON.parse(line);
          if (ev.type !== 'match') continue;
          const p = ev.data.path.text.replace(/^\.\//, '');
          const sub = ev.data.submatches?.[0];
          let f = files.get(p);
          if (!f) { f = { path: p, matches: [] }; files.set(p, f); }
          f.matches.push({ line: ev.data.line_number, col: (sub?.start ?? 0) + 1, len: sub ? sub.end - sub.start : 0, text: (ev.data.lines.text ?? '').replace(/\n$/, '').slice(0, 400) });
          if (++total >= 3000) { truncated = true; child.kill(); break; }
        } catch {}
      }
    });
    child.stderr.on('data', (c: Buffer) => { stderr += c.toString('utf8'); });
    child.on('error', () => resolve({ files: [], truncated: false, engine: 'rg', error: 'Search needs ripgrep (rg) on your PATH.' }));
    child.on('close', () => {
      if (searches.get(wc.id) === child) searches.delete(wc.id);
      resolve({ files: [...files.values()], truncated, engine: 'rg', error: total === 0 && stderr ? stderr.trim().split('\n')[0] : undefined });
    });
  });
}

// ---------- windows ----------

// Windows fade in when they open and out when they close, unless macOS is set to reduce motion or the app is quitting.
let quitting = false;
const fadingOut = new WeakSet<BrowserWindow>();
const animateWindows = () => !quitting && !systemPreferences.getAnimationSettings().prefersReducedMotion;
function fadeWindow(win: BrowserWindow, to: number, ms: number, done?: () => void) {
  const from = win.getOpacity();
  const start = Date.now();
  const step = () => {
    if (win.isDestroyed()) return;
    const t = Math.min(1, (Date.now() - start) / ms);
    const eased = to > from ? 1 - (1 - t) ** 3 : t * t;
    win.setOpacity(from + (to - from) * eased);
    if (t < 1) setTimeout(step, 8); else done?.();
  };
  step();
}

function createWindow() {
  const state = readJson<{ bounds?: Electron.Rectangle }>(STATE_FILE, {});
  const win = new BrowserWindow({
    width: state.bounds?.width ?? 1360,
    height: state.bounds?.height ?? 860,
    x: BrowserWindow.getAllWindows().length ? undefined : state.bounds?.x,
    y: BrowserWindow.getAllWindows().length ? undefined : state.bounds?.y,
    minWidth: 240,
    minHeight: 72,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 13 },
    // The page paints its own translucent background over the blurred desktop.
    backgroundColor: '#00000000',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });
  const wc = win.webContents;
  win.once('ready-to-show', () => {
    const animate = animateWindows();
    if (animate) win.setOpacity(0);
    if (process.env.ASTROLABE_TEST === 'background') win.showInactive(); else win.show();
    if (animate) fadeWindow(win, 1, 190);
  });
  win.on('close', (ev) => {
    if (!fadingOut.has(win)) {
      // Closing the window (or quitting) with unsaved files asks first, unless a test is driving the app.
      const n = unsaved.get(wc.id) ?? 0;
      if (n > 0 && !process.env.ASTROLABE_TEST) {
        const choice = dialog.showMessageBoxSync(win, { type: 'warning', message: n === 1 ? 'One file has unsaved changes.' : `${n} files have unsaved changes.`, detail: 'Closing now discards them.', buttons: ['Keep Editing', 'Discard and Close'], defaultId: 0, cancelId: 0 });
        if (choice === 0) { ev.preventDefault(); return; }
      }
      // Fade out first, then close for real (the second pass skips straight to the cleanup below).
      fadingOut.add(win);
      if (animateWindows() && win.isVisible() && !win.isFullScreen()) { ev.preventDefault(); fadeWindow(win, 0, 150, () => win.close()); return; }
    }
    unsaved.delete(wc.id);
    handoffs.delete(wc.id);
    shots.delete(wc.id);
    const s = readJson<Record<string, unknown>>(STATE_FILE, {});
    writeJson(STATE_FILE, { ...s, bounds: win.getBounds() });
    killSessionsFor(wc);
  });
  win.on('enter-full-screen', () => wc.send('win:fullscreen', true));
  win.on('leave-full-screen', () => wc.send('win:fullscreen', false));
  wc.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  wc.on('will-navigate', (e, url) => { if (!url.startsWith('astrolabe://') && !url.startsWith(process.env.ASTROLABE_DEV_URL || '\0')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  if (process.env.ASTROLABE_DEV_URL) win.loadURL(process.env.ASTROLABE_DEV_URL);
  else win.loadURL('astrolabe://app/index.html');
  return win;
}

function buildMenu() {
  const send = (cmd: string) => () => BrowserWindow.getFocusedWindow()?.webContents.send('menu:command', cmd);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Astrolabe', submenu: [
      { role: 'about' }, { type: 'separator' },
      { label: 'Settings…', click: send('settings.open') },
      { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' },
    ] },
    { label: 'File', submenu: [
      { label: 'New Note', accelerator: 'CmdOrCtrl+N', click: send('note.newInRepo') },
      { label: 'New Window', accelerator: 'Shift+CmdOrCtrl+N', click: () => createWindow() },
      { label: 'New Tab', click: send('tab.new') },
      { type: 'separator' },
      { label: 'Open File…', click: send('palette.files') },
      { label: 'Save', click: send('editor.save') },
    ] },
    { label: 'Edit', submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
    ] },
    { label: 'View', submenu: [
      { label: 'Command Palette', click: send('palette.commands') },
      { label: 'Toggle Sidebar', click: send('sidebar.toggle') },
      { type: 'separator' },
      { label: 'Split Right', click: send('pane.splitRight') },
      { label: 'Split Down', click: send('pane.splitDown') },
      { type: 'separator' },
      // ⌃⌘F (and Fn+F, handled in the page) expand the editor, so full screen moves off macOS's usual keys.
      { label: 'Expand or Split', accelerator: 'Ctrl+Cmd+F', click: send('editor.expand') },
      { label: 'Switch Displays', accelerator: 'Ctrl+Cmd+S', click: send('editor.swapSide') },
      { label: 'Toggle Full Screen', click: () => { const w = BrowserWindow.getFocusedWindow(); w?.setFullScreen(!w.isFullScreen()); } },
      { label: 'Developer Tools', accelerator: 'Alt+CmdOrCtrl+I', click: () => BrowserWindow.getFocusedWindow()?.webContents.toggleDevTools() },
      { label: 'Reload Window', accelerator: 'Alt+CmdOrCtrl+R', click: () => { const w = BrowserWindow.getFocusedWindow(); if (w) void reloadWindow(w); } },
    ] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }] },
  ]));
}

// ---------- watching open files ----------
// Each window names the files it has open in the editor and is told soon after one of them changes on disk,
// so an edit made by an agent or another program shows up without being asked for. The folders are watched
// rather than the files, because many programs save by writing a new file over the old one.

interface Watched { paths: Set<string>; dirs: Map<string, fs.FSWatcher>; timers: Map<string, NodeJS.Timeout> }
const watched = new Map<number, Watched>();
const sameName = (a: string, b: string) => a.normalize('NFC') === b.normalize('NFC');

function watchFiles(sender: WebContents, paths: string[]) {
  const id = sender.id;
  let w = watched.get(id);
  if (!w) {
    const made: Watched = { paths: new Set(), dirs: new Map(), timers: new Map() };
    watched.set(id, made);
    sender.once('destroyed', () => {
      for (const d of made.dirs.values()) { try { d.close(); } catch {} }
      for (const t of made.timers.values()) clearTimeout(t);
      watched.delete(id);
    });
    w = made;
  }
  const state = w;
  state.paths = new Set(paths);
  const wanted = new Set(paths.map((p) => path.dirname(p)));
  for (const [dir, watcher] of state.dirs) if (!wanted.has(dir)) { try { watcher.close(); } catch {} state.dirs.delete(dir); }
  for (const dir of wanted) {
    if (state.dirs.has(dir)) continue;
    try {
      const watcher = fs.watch(dir, { persistent: false }, (_event, name) => {
        for (const p of state.paths) {
          if (path.dirname(p) !== dir || (name && !sameName(path.basename(p), String(name)))) continue;
          // A save is often several writes in a row; wait for it to settle before reading.
          clearTimeout(state.timers.get(p));
          state.timers.set(p, setTimeout(() => {
            state.timers.delete(p);
            if (!sender.isDestroyed() && state.paths.has(p)) sender.send('fs:fileChanged', p);
          }, 80));
        }
      });
      watcher.on('error', () => { try { watcher.close(); } catch {} if (state.dirs.get(dir) === watcher) state.dirs.delete(dir); });
      state.dirs.set(dir, watcher);
    } catch {}
  }
}

// ---------- files opened from outside ----------
// `open -a Astrolabe note.md`, or a file dropped on the Dock icon, opens that file in the window in front, the way
// ⌘-clicking its path in a terminal would. Paths wait here until a page collects them, so one that arrives while
// the app is still starting, or its window is reloading, is not lost.
const outsideFiles: string[] = [];
let frontWindow: BrowserWindow | null = null;
app.on('browser-window-focus', (_e, win) => { frontWindow = win; });
app.on('open-file', (e, file) => {
  e.preventDefault();
  if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) return;
  outsideFiles.push(file);
  const win = BrowserWindow.getFocusedWindow() ?? (frontWindow && !frontWindow.isDestroyed() ? frontWindow : BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()));
  if (!win) return; // still starting: the first page collects it once it is up
  if (win.isMinimized()) win.restore();
  win.focus();
  win.webContents.send('app:outsideFiles');
});

// ---------- ipc ----------

function registerIpc() {
  ipcMain.handle('pty:spawn', (e, id: string, opts) => spawnSession(e.sender, id, opts));
  ipcMain.on('pty:write', (_e, id: string, data: string) => { sessions.get(id)?.proc.write(data); });
  ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) => {
    try { sessions.get(id)?.proc.resize(Math.max(2, cols), Math.max(2, rows)); } catch {}
  });
  ipcMain.handle('pty:attach', (e, id: string) => attachSession(e.sender, id));
  ipcMain.on('pty:kill', (_e, id: string) => { const s = sessions.get(id); if (s) { try { s.proc.kill(); } catch {} sessions.delete(id); } });

  ipcMain.handle('fs:readDir', (_e, dir: string) => readDir(dir).catch(() => []));
  ipcMain.handle('fs:readFile', async (_e, file: string) => {
    try {
      const st = await fsp.stat(file);
      if (st.isDirectory()) return { error: 'That is a folder, not a file.' };
      if (st.size > 8 * 1024 * 1024) return { error: `This file is ${(st.size / 1048576).toFixed(1)} MB, which is too large to open here.` };
      const buf = await fsp.readFile(file);
      if (buf.subarray(0, 8000).includes(0)) return { error: 'This looks like a binary file, so it is not shown as text.' };
      return { text: buf.toString('utf8'), mtime: st.mtimeMs };
    } catch (err: any) { return { error: err?.code === 'ENOENT' ? 'This file no longer exists.' : String(err?.message ?? err) }; }
  });
  ipcMain.handle('fs:writeFile', async (_e, file: string, text: string) => {
    try { await fsp.mkdir(path.dirname(file), { recursive: true }); await fsp.writeFile(file, text, 'utf8'); return { ok: true, mtime: (await fsp.stat(file)).mtimeMs }; }
    catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
  });
  ipcMain.handle('fs:stat', async (_e, file: string) => {
    try { const st = await fsp.stat(expandHome(file)); return { exists: true, dir: st.isDirectory(), mtime: st.mtimeMs }; } catch { return { exists: false, dir: false, mtime: 0 }; }
  });
  ipcMain.handle('fs:rename', async (_e, from: string, name: string) => {
    const clean = name.trim();
    if (!clean || clean.includes('/') || clean === '.' || clean === '..') return { error: 'That name cannot be used.' };
    const to = path.join(path.dirname(from), clean);
    if (to === from) return { path: from };
    try {
      // A case-only change (notes.md to Notes.md) points at the same file on macOS, which is fine.
      const clash = await fsp.stat(to).then(() => true, () => false);
      if (clash && to.toLowerCase() !== from.toLowerCase()) return { error: `"${clean}" already exists here.` };
      await fsp.rename(from, to);
      return { path: to };
    } catch (err: any) { return { error: String(err?.message ?? err) }; }
  });
  // A file or folder dragged onto a folder in the navigator goes into it under its own name.
  ipcMain.handle('fs:move', async (_e, from: string, dir: string) => {
    const name = path.basename(from);
    const to = path.join(dir, name);
    if (to === from) return { path: from };
    if (dir === from || dir.startsWith(from + path.sep)) return { error: 'A folder cannot go inside itself.' };
    try {
      if (!(await fsp.stat(dir)).isDirectory()) return { error: 'That is not a folder.' };
      if (await fsp.stat(to).then(() => true, () => false)) return { error: `"${name}" already exists there.` };
      await fsp.rename(from, to);
      return { path: to };
    } catch (err: any) { return { error: String(err?.message ?? err) }; }
  });
  ipcMain.handle('fs:createFile', async (_e, dir: string, name: string) => {
    const clean = name.trim();
    if (!clean || clean.includes('/') || clean === '.' || clean === '..') return { error: 'That name cannot be used.' };
    const file = path.join(dir, clean);
    try { await fsp.writeFile(file, '', { flag: 'wx' }); return { path: file }; }
    catch (err: any) { return { error: err?.code === 'EEXIST' ? `"${clean}" already exists here.` : String(err?.message ?? err) }; }
  });
  ipcMain.handle('fs:trash', async (_e, target: string) => {
    // Scripted runs work on throwaway files; deleting those outright keeps test debris out of the real Trash.
    if (process.env.ASTROLABE_TEST) { try { await fsp.rm(target, { recursive: true }); return { ok: true }; } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; } }
    try { await shell.trashItem(target); return { ok: true }; } catch (err: any) { return { ok: false, error: String(err?.message ?? err) }; }
  });
  // The navigator's right-click menu. A scripted run cannot click a native menu, so it supplies the choice instead.
  // `on` is what was clicked: a file, a folder, or the empty space around them (where only "New File" applies).
  // `count` is how many entries are selected when the click landed on one of several; those can only be removed together.
  ipcMain.handle('tree:menu', (e, on: 'file' | 'dir' | 'blank', count = 1) => new Promise<string | null>((resolve) => {
    if (process.env.ASTROLABE_TEST) { resolve(testMenuChoice); testMenuChoice = null; return; }
    const win = BrowserWindow.fromWebContents(e.sender);
    const menu = Menu.buildFromTemplate([
      { label: 'New File', click: () => resolve('newFile') },
      ...(on === 'blank' ? [] : count > 1 ? [
        { type: 'separator' as const },
        { label: `Move ${count} Items to Trash`, click: () => resolve('trash') },
      ] : [
        { type: 'separator' as const },
        { label: 'Rename', click: () => resolve('rename') },
        { label: 'Move to Trash', click: () => resolve('trash') },
        { type: 'separator' as const },
        { label: on === 'dir' ? 'Reveal Folder in Finder' : 'Reveal in Finder', click: () => resolve('reveal') },
      ]),
    ]);
    menu.popup({ window: win ?? undefined, callback: () => setTimeout(() => resolve(null), 50) });
  }));
  // Right-clicking the strip of file tabs above the editor.
  ipcMain.handle('editor:menu', (e) => new Promise<string | null>((resolve) => {
    if (process.env.ASTROLABE_TEST) { resolve(testMenuChoice); testMenuChoice = null; return; }
    const win = BrowserWindow.fromWebContents(e.sender);
    const menu = Menu.buildFromTemplate([{ label: 'New File', click: () => resolve('newFile') }]);
    menu.popup({ window: win ?? undefined, callback: () => setTimeout(() => resolve(null), 50) });
  }));
  ipcMain.on('fs:watch', (e, paths: string[]) => watchFiles(e.sender, Array.isArray(paths) ? paths : []));
  ipcMain.on('test:menuChoice', (_e, choice: string) => { if (process.env.ASTROLABE_TEST) testMenuChoice = choice; });
  ipcMain.handle('fs:listFiles', (_e, root: string) => listFiles(root));
  ipcMain.handle('fs:complete', (_e, cwd: string, token: string) => completePath(cwd, token));
  ipcMain.handle('shell:commands', () => listCommands());
  ipcMain.handle('fonts:list', () => listGoogleFonts());
  ipcMain.handle('dialog:unsaved', async (e, name: string) => {
    if (process.env.ASTROLABE_TEST) return 'discard'; // nothing can click a native dialog in a scripted run
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts: Electron.MessageBoxOptions = { type: 'warning', message: `Save changes to ${name}?`, detail: 'Your changes will be lost if you close it without saving.', buttons: ['Save', "Don't Save", 'Cancel'], defaultId: 0, cancelId: 2 };
    const res = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
    return (['save', 'discard', 'cancel'] as const)[res.response] ?? 'cancel';
  });
  ipcMain.handle('app:checkUpdate', () => checkUpdate());
  ipcMain.handle('app:installUpdate', (e, running: number) => installUpdate(BrowserWindow.fromWebContents(e.sender), Number(running) || 0));
  ipcMain.handle('app:takeHandoff', (e) => handoffs.get(e.sender.id) ?? null);
  ipcMain.handle('app:takeOutsideFiles', () => outsideFiles.splice(0));
  ipcMain.on('app:shot', (e) => { e.returnValue = shots.has(e.sender.id) ? e.sender.id : 0; });
  ipcMain.on('app:booted', (e) => pageBooted(e.sender));
  ipcMain.on('app:bootFailed', (e) => bootWaiters.get(e.sender.id)?.(false));
  ipcMain.on('app:unsavedCount', (e, n: number) => { unsaved.set(e.sender.id, n); });
  ipcMain.handle('dialog:pickFiles', async (e, defaultPath?: string) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts: Electron.OpenDialogOptions = { title: 'Attach files', buttonLabel: 'Attach', defaultPath, properties: ['openFile', 'openDirectory', 'multiSelections'] };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return res.canceled ? [] : res.filePaths;
  });
  ipcMain.handle('fs:newNote', async (_e, dir: string, stamped?: boolean) => {
    // A stamped note starts like his Obsidian notes: "*11.11.2026 - 2520 Milvia St*", then a blank line.
    const text = stamped ? `*${noteDate()} - ${await streetAddress()}*\n\n` : '';
    for (let i = 1; i < 500; i++) {
      const file = path.join(dir, i === 1 ? 'Untitled.md' : `Untitled ${i}.md`);
      try { await fsp.writeFile(file, text, { flag: 'wx' }); return { path: file, text }; }
      catch (err: any) { if (err?.code !== 'EEXIST') return { error: String(err?.message ?? err) }; }
    }
    return { error: 'Too many untitled notes in this folder.' };
  });
  // Something pasted or dropped that is not a file on disk (a screenshot on the clipboard, a picture dragged out of
  // a browser) is saved here so that it has a path to hand to a program. Copies older than two weeks are cleared out.
  ipcMain.handle('fs:savePasted', async (_e, name: string, data: Uint8Array) => {
    const dir = path.join(CONFIG_DIR, 'pasted');
    try {
      await fsp.mkdir(dir, { recursive: true });
      const old = Date.now() - 14 * 86400_000;
      for (const f of await fsp.readdir(dir)) { const p = path.join(dir, f); try { if ((await fsp.stat(p)).mtimeMs < old) await fsp.unlink(p); } catch {} }
      const d = new Date();
      const two = (n: number) => String(n).padStart(2, '0');
      const stamp = `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
      const clean = path.basename(String(name || 'file')).replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'file';
      for (let i = 0; i < 100; i++) {
        const file = path.join(dir, `${stamp}${i ? `-${i}` : ''}-${clean}`);
        try { await fsp.writeFile(file, data, { flag: 'wx' }); return { path: file }; }
        catch (err: any) { if (err?.code !== 'EEXIST') throw err; }
      }
      return { error: 'Could not find a free name for it.' };
    } catch (err: any) { return { error: String(err?.message ?? err) }; }
  });
  // A picture put into a note from somewhere else on the disk is copied into `attachments` beside the note, so the
  // note's folder holds everything the note shows. The same picture brought in twice is kept once.
  ipcMain.handle('fs:importImage', async (_e, noteDir: string, from: string) => {
    try {
      const dir = path.join(noteDir, 'attachments');
      const data = await fsp.readFile(from);
      await fsp.mkdir(dir, { recursive: true });
      const ext = path.extname(from);
      // Pasted pictures arrive stamped with the time (see fs:savePasted), so their names do not collide.
      const stem = path.basename(from, ext).replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'image';
      for (let n = 0; n < 500; n++) {
        const to = path.join(dir, `${stem}${n ? `-${n}` : ''}${ext}`);
        const there = await fsp.readFile(to).catch(() => null);
        if (there?.equals(data)) return { path: to };
        if (!there) { await fsp.writeFile(to, data, { flag: 'wx' }); return { path: to }; }
      }
      return { error: 'Too many pictures with that name.' };
    } catch (err: any) { return { error: String(err?.message ?? err) }; }
  });
  // Uploading is whatever command the `imageUpload` setting names: it is given the picture's path as its last
  // argument and prints the web address the picture can then be seen at. Nothing is sent anywhere unless that is set.
  ipcMain.handle('fs:uploadImage', async (_e, command: string, file: string) => {
    await userPathReady;
    return new Promise<{ url?: string; error?: string }>((resolve) => {
      execFile('/bin/sh', ['-c', `${command} "$0"`, file], { timeout: 120000, maxBuffer: 1024 * 1024, env: { ...process.env, PATH: userPath } }, (err, stdout, stderr) => {
        const url = String(stdout ?? '').trim().split(/\s+/).reverse().find((word) => /^https?:\/\/\S+$/.test(word));
        resolve(!err && url ? { url } : { error: (String(stderr ?? '').trim() || err?.message || 'the command printed no web address').slice(0, 300) });
      });
    });
  });
  // A ⌘N note closed with nothing added is deleted. `text` is what it was made with; a file holding anything else is left alone.
  ipcMain.handle('fs:discardBlank', async (_e, file: string, text: string) => {
    try {
      if ((await fsp.readFile(file, 'utf8')) !== text) return false;
      await fsp.unlink(file);
      return true;
    } catch { return false; }
  });
  ipcMain.handle('shell:history', () => loadHistory());
  ipcMain.handle('git:info', (_e, cwd: string) => gitInfo(cwd));
  ipcMain.handle('search:run', (e, opts) => searchProject(e.sender, opts));

  ipcMain.handle('app:info', () => ({ home: os.homedir(), shell: USER_SHELL, platform: process.platform, settingsFile: SETTINGS_FILE, version: app.getVersion() }));
  ipcMain.handle('settings:load', () => readJson<Record<string, unknown>>(SETTINGS_FILE, {}));
  ipcMain.handle('settings:save', (_e, data) => { writeJson(SETTINGS_FILE, data); return true; });
  ipcMain.handle('state:load', () => readJson<Record<string, unknown>>(STATE_FILE, {}));
  ipcMain.handle('state:save', (_e, data) => { writeJson(STATE_FILE, { ...readJson<Record<string, unknown>>(STATE_FILE, {}), ...data }); return true; });
  ipcMain.on('app:zoom', (e, factor: number) => { e.sender.setZoomFactor(Math.min(2, Math.max(0.5, factor))); });
  ipcMain.on('app:openExternal', (_e, url: string) => { if (/^(https?|mailto):/.test(url)) shell.openExternal(url); });
  ipcMain.on('app:reveal', (_e, file: string) => shell.showItemInFolder(file));
  ipcMain.on('app:newWindow', () => createWindow());
  ipcMain.on('app:closeWindow', (e) => BrowserWindow.fromWebContents(e.sender)?.close());
  ipcMain.on('clipboard:write', (_e, text: string) => clipboard.writeText(text));
  ipcMain.handle('clipboard:read', () => clipboard.readText());
}

const PICTURE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|heic|ico|tiff?)$/i;
app.whenReady().then(() => {
  protocol.handle('astrolabe', (req) => {
    const u = new URL(req.url);
    let p = decodeURIComponent(u.pathname);
    if (p === '/' || p === '') p = '/index.html';
    const shot = /^\/__shot\/(\d+)\.png$/.exec(p);
    if (shot) {
      const png = shots.get(Number(shot[1]));
      return png ? new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png', 'cache-control': 'no-store' } }) : new Response('Not found', { status: 404 });
    }
    // A picture in a note is a file on disk, which a page served from here may not load by its own path.
    const local = /^\/__file(\/.+)$/.exec(p);
    if (local) {
      if (!PICTURE.test(local[1])) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(local[1]).toString()).catch(() => new Response('Not found', { status: 404 }));
    }
    const file = path.normalize(path.join(DIST, p));
    if (!file.startsWith(DIST)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  try { integrationDir = installZshIntegration(CONFIG_DIR); } catch { integrationDir = null; }
  registerIpc();
  buildMenu();
  // Run from source, the Dock would show Electron's icon; the packaged app carries its own.
  if (!app.isPackaged) { try { app.dock?.setIcon(nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png'))); } catch {} }
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

// "Focused" means Astrolabe is the active app. Which of its windows is in front makes no difference,
// so every window is told the same thing, and only once focus has really left the app.
let appActive = true;
function setAppActive(active: boolean) {
  if (active === appActive) return;
  appActive = active;
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('win:focus', active);
}
app.on('browser-window-focus', () => setAppActive(true));
app.on('browser-window-blur', () => { setTimeout(() => { if (!BrowserWindow.getFocusedWindow()) setAppActive(false); }, 60); });
app.on('browser-window-created', (_e, w) => { w.webContents.on('did-finish-load', () => w.webContents.send('win:focus', appActive)); });

app.on('window-all-closed', () => { app.quit(); });
app.on('before-quit', () => { quitting = true; for (const s of sessions.values()) { try { s.proc.kill(); } catch {} } });
