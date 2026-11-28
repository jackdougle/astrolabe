import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, protocol, net, screen, session, shell, clipboard, systemPreferences, WebContents } from 'electron';
import * as pty from 'node-pty';
import { spawn, execFile, ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
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
// An installed copy knows the folder it was built from. The update notice's button brings it up to date with that
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
/** A secret each shell is started with and puts on the marks it sends the page (electron/shell.ts), so that
 *  nothing a program prints can pass for one of them. */
const newNonce = () => crypto.randomBytes(16).toString('hex');
const sessions = new Map<string, Session>();
function flushSession(id: string, s: Session) {
  if (s.timer) { clearTimeout(s.timer); s.timer = null; }
  if (!s.buf) return;
  const data = s.buf; s.buf = '';
  if (!s.wc.isDestroyed()) s.wc.send('pty:data', id, data);
}
let integrationDir: string | null = null;

/** Runs a command that a setting names (`noteTemplate`, `onFileClose`), with `arg` as its last argument, and gives
 *  back what it printed. Nothing of the kind runs unless the setting is filled in. */
async function runUserCommand(command: string, arg: string, timeout: number) {
  await userPathReady;
  return new Promise<{ out: string; error?: string }>((resolve) => {
    execFile('/bin/sh', ['-c', `${command} "$0"`, arg], { timeout, maxBuffer: 1024 * 1024, env: { ...process.env, PATH: userPath } }, (err, stdout, stderr) => {
      resolve(err ? { out: '', error: (String(stderr ?? '').trim() || err.message).slice(0, 300) } : { out: String(stdout ?? '') });
    });
  });
}

const contextFile = (id: number) => path.join(CONFIG_DIR, `editor-${process.pid}-${id}.json`);

function spawnSession(wc: WebContents, id: string, opts: { cwd?: string; cols: number; rows: number; prompt?: 'own' | 'native' }) {
  let cwd = opts.cwd ? expandHome(opts.cwd) : os.homedir();
  try { if (!fs.statSync(cwd).isDirectory()) cwd = os.homedir(); } catch { cwd = os.homedir(); }
  const isZsh = path.basename(USER_SHELL) === 'zsh';
  // A page that starts a shell under an id already in use has no further use for the old one.
  const old = sessions.get(id);
  if (old) { sessions.delete(id); try { old.proc.kill(); } catch {} }
  const nonce = newNonce();
  const env = shellEnv(USER_SHELL, isZsh ? integrationDir : null, opts.prompt ?? 'native', nonce);
  env.ASTROLABE_CONTEXT_PATH = contextFile(wc.id);
  env.ASTROLABE_CONTEXT_HOOK = path.join(__dirname, 'editorContext.cjs');
  const command = 'node "$ASTROLABE_CONTEXT_HOOK"';
  const hook = { type: 'command', command };
  env.ASTROLABE_CLAUDE_CONTEXT = JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [hook] }] } });
  env.ASTROLABE_CODEX_CONTEXT = `hooks.UserPromptSubmit=[{hooks=[{type="command",command=${JSON.stringify(command)}}]}]`;
  const proc = pty.spawn(USER_SHELL, ['-l'], {
    name: 'xterm-256color',
    cols: Math.max(2, opts.cols),
    rows: Math.max(2, opts.rows),
    cwd,
    env: env as { [k: string]: string },
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
  return { integrated: isZsh && !!integrationDir, shell: USER_SHELL, nonce };
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

function askPage(wc: WebContents, ms: number, channel = 'app:prepareReload', arg?: unknown) {
  return new Promise<Record<string, unknown> | null>((resolve) => {
    const token = ++prepareSeq;
    const done = (data: Record<string, unknown> | null) => { clearTimeout(timer); ipcMain.removeListener('app:handoff', heard); resolve(data); };
    const heard = (e: Electron.IpcMainEvent, t: number, data: Record<string, unknown> | null) => { if (e.sender === wc && t === token) done(data ?? null); };
    const timer = setTimeout(() => done(null), ms);
    ipcMain.on('app:handoff', heard);
    wc.send(channel, token, arg);
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

// ---------- tabs taken out of a window ----------
// A tab dragged past the edge of its window and let go there becomes a window of its own, where it was let go
// (src/lib/tearoff.ts). The new window's page starts from a handoff, as a page reloaded in place does, so a
// terminal arrives with its screen and with its shell, which never stops. While the tab is outside, an outline
// follows the pointer to show where that window will be.

interface TearSpec {
  /** The pointer, in the page's own px. */
  at: { x: number; y: number };
  /** Where the pointer will be in the window to come, measured from that window's corner. */
  grab: { x: number; y: number };
  /** The tab as it will sit in that window, and what it says. */
  tab: { x: number; y: number; w: number; h: number }; label: string;
  /** The page's colours, for the outline. */
  accent: string; surface: string; text: string;
  /** The tab is all its window holds, so the window itself goes there. */
  lone: boolean;
  /** The terminals that go with it. */
  terms: string[];
  /** What the page is asked to hand over. */
  what: unknown;
}

function tearBounds(win: BrowserWindow, spec: TearSpec): Electron.Rectangle {
  const z = win.webContents.getZoomFactor();
  const content = win.getContentBounds();
  const size = win.isFullScreen() || win.isMaximized() ? win.getNormalBounds() : win.getBounds();
  const pt = { x: content.x + spec.at.x * z, y: content.y + spec.at.y * z };
  // Never under the menu bar: the system would move a real window down from there, and the outline should not lie.
  const area = screen.getDisplayNearestPoint({ x: Math.round(pt.x), y: Math.round(pt.y) }).workArea;
  return { x: Math.round(pt.x - spec.grab.x * z), y: Math.max(area.y, Math.round(pt.y - spec.grab.y * z)), width: size.width, height: size.height };
}

const ghosts = new Map<number, BrowserWindow>();
const cssColor = (c: unknown, fallback: string) => (typeof c === 'string' && /^[#\w(),.%\s/-]{1,80}$/.test(c) ? c : fallback);
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Takes away the outline shown for a window's dragged tab. `id` is the window's page's. */
function dropGhost(id: number) {
  const ghost = ghosts.get(id);
  ghosts.delete(id);
  if (ghost && !ghost.isDestroyed()) ghost.destroy();
}

/** Shows the outline of the window a dragged tab would become. */
function showGhost(win: BrowserWindow, spec: TearSpec) {
  const id = win.webContents.id;
  let ghost = ghosts.get(id);
  const bounds = tearBounds(win, spec);
  if (ghost && !ghost.isDestroyed()) { ghost.setBounds(bounds); return; }
  ghost = new BrowserWindow({
    ...bounds, frame: false, transparent: true, hasShadow: false, focusable: false, resizable: false, alwaysOnTop: true, skipTaskbar: true, show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  ghost.setIgnoreMouseEvents(true);
  ghosts.set(id, ghost);
  const z = win.webContents.getZoomFactor();
  const accent = cssColor(spec.accent, '#4DA6FF');
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const t = { x: num(spec.tab?.x), y: num(spec.tab?.y), w: num(spec.tab?.w), h: num(spec.tab?.h) };
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;overflow:hidden;background:transparent">`
    + `<div style="position:fixed;inset:0;box-sizing:border-box;border:1.5px solid ${accent};border-radius:10px;background:color-mix(in srgb, ${accent} 12%, transparent)"></div>`
    + `<div style="position:fixed;left:${t.x * z}px;top:${t.y * z}px;width:${t.w * z}px;height:${t.h * z}px;box-sizing:border-box;padding:0 ${9 * z}px;border-radius:7px;`
    + `background:${cssColor(spec.surface, '#16202E')};color:${cssColor(spec.text, '#E6EDF5')};box-shadow:inset 0 0 0 1px ${accent};font:${11.5 * z}px ui-monospace,'SF Mono',Menlo,monospace;`
    + `line-height:${t.h * z}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(String(spec.label ?? ''))}</div></body>`;
  const mine = ghost;
  ghost.once('ready-to-show', () => { if (!mine.isDestroyed() && ghosts.get(id) === mine) mine.showInactive(); });
  void ghost.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(() => {});
}

/** The shells that go with a dragged tab, held from here on: what they have printed reaches the old page before
 *  it describes them, and what they print next waits for the page that takes them. */
function holdShells(wc: WebContents, spec: TearSpec) {
  const mine = (Array.isArray(spec.terms) ? spec.terms : []).map((id) => [id, sessions.get(id)] as const).filter((x): x is readonly [string, Session] => !!x[1] && x[1].wc === wc);
  for (const [id, s] of mine) { flushSession(id, s); s.held = true; if (s.since === null) s.since = ''; s.cut = s.since.length; }
  return mine;
}
/** The page kept its tab after all, so its shells carry on where they are. */
function releaseShells(wc: WebContents, mine: (readonly [string, Session])[]) {
  for (const [id, s] of mine) {
    if (sessions.get(id) !== s) continue;
    s.held = false;
    const missed = (s.since ?? '').slice(s.cut);
    s.since = null;
    if (wc.isDestroyed()) continue;
    if (missed) wc.send('pty:data', id, missed);
    if (s.exit !== null) { sessions.delete(id); wc.send('pty:exit', id, s.exit); }
  }
}

/** The tab was let go outside its window: it gets a window of its own there. */
async function tearOff(win: BrowserWindow, spec: TearSpec) {
  const wc = win.webContents;
  const page = wc.id;
  const bounds = tearBounds(win, spec);
  if (spec.lone) {
    // Nothing would be left behind, so the window goes there as it is.
    if (!win.isFullScreen()) win.setBounds(bounds, animateWindows());
    dropGhost(page);
    return;
  }
  const mine = holdShells(wc, spec);
  const data = await askPage(wc, 5000, 'app:prepareMove', spec.what);
  if (!data || win.isDestroyed()) { dropGhost(page); releaseShells(wc, mine); return; }
  // The outline stays until the window that takes its place can be seen.
  const next = createWindow({ bounds, handoff: data, shown: () => setTimeout(() => dropGhost(page), animateWindows() ? 200 : 0) });
  for (const [, s] of mine) { s.since = (s.since ?? '').slice(s.cut); s.wc = next.webContents; }
}

// ---------- tabs dragged into another window ----------
// A tab dragged out of its window and over another one joins that window where it is let go, instead of getting
// a window of its own. While it is over the window, that window's page shows where it would land (movein.ts);
// let go, the page it came from hands it over exactly as for a new window, and the other page takes it in, shells
// and all. A tab that was all its window held leaves that window to close.

/** The app's windows, the one used last first: which of two that overlap is on top. */
const stacked: BrowserWindow[] = [];
app.on('browser-window-focus', (_e, win) => { const i = stacked.indexOf(win); if (i >= 0) stacked.splice(i, 1); stacked.unshift(win); });
app.on('browser-window-created', (_e, win) => { win.once('closed', () => { const i = stacked.indexOf(win); if (i >= 0) stacked.splice(i, 1); }); });

/** The window a tab dragged out of `from` is over, and where over it, in that window's page's own px. */
function windowUnder(from: BrowserWindow, spec: TearSpec): { win: BrowserWindow; x: number; y: number } | null {
  const z = from.webContents.getZoomFactor();
  const content = from.getContentBounds();
  const pt = { x: content.x + Number(spec.at?.x) * z, y: content.y + Number(spec.at?.y) * z };
  if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return null;
  const outlines = new Set(ghosts.values());
  const rank = (w: BrowserWindow) => { const i = stacked.indexOf(w); return i < 0 ? stacked.length : i; };
  const over = BrowserWindow.getAllWindows()
    .filter((w) => w !== from && !w.isDestroyed() && !outlines.has(w) && w.isVisible() && !w.isMinimized() && !fadingOut.has(w))
    .filter((w) => { const b = w.getContentBounds(); return pt.x >= b.x && pt.x < b.x + b.width && pt.y >= b.y && pt.y < b.y + b.height; })
    .sort((a, b) => rank(a) - rank(b))[0];
  if (!over) return null;
  const b = over.getContentBounds();
  const oz = over.webContents.getZoomFactor() || 1;
  return { win: over, x: (pt.x - b.x) / oz, y: (pt.y - b.y) / oz };
}

/** For each page with a tab dragged out of it: the window that tab is over. */
const hovered = new Map<number, BrowserWindow>();
function leaveHover(page: number) {
  const was = hovered.get(page);
  hovered.delete(page);
  if (was && !was.isDestroyed()) was.webContents.send('tear:hover', null);
}
const tornKind = (spec: TearSpec) => ((spec.what as { kind?: unknown } | null)?.kind === 'file' ? 'file' : 'tab');

/** A dragged tab has moved, outside its window: over another window, that one shows where it would land;
 *  anywhere else, the outline of the window it would become follows it. */
function tearOver(win: BrowserWindow, spec: TearSpec) {
  const page = win.webContents.id;
  const under = windowUnder(win, spec);
  if (!under) { leaveHover(page); showGhost(win, spec); return; }
  dropGhost(page);
  if (hovered.get(page) !== under.win) { leaveHover(page); hovered.set(page, under.win); }
  under.win.webContents.send('tear:hover', { x: under.x, y: under.y, kind: tornKind(spec), label: String(spec.label ?? '').slice(0, 200) });
}

/** The tab was let go over another window: it joins that window. */
async function moveInto(win: BrowserWindow, to: { win: BrowserWindow; x: number; y: number }, spec: TearSpec) {
  const wc = win.webContents;
  const mine = holdShells(wc, spec);
  // `into`: the page lets go of its tab even when it is all the window holds, and then closes.
  const what = spec.what && typeof spec.what === 'object' ? { ...(spec.what as object), into: true } : spec.what;
  const data = await askPage(wc, 5000, 'app:prepareMove', what);
  if (!data) { releaseShells(wc, mine); return; }
  // From here the page has let its tab go. Its shells answer to the window that takes it, before the old page's
  // closing terminals can end them.
  const point = (next: WebContents) => { for (const [, s] of mine) s.wc = next; };
  for (const [, s] of mine) s.since = (s.since ?? '').slice(s.cut);
  const taken = !to.win.isDestroyed() && (point(to.win.webContents), !!(await askPage(to.win.webContents, 5000, 'app:adopt', { data, at: { x: to.x, y: to.y } })));
  if (taken) {
    if (process.env.ASTROLABE_TEST !== 'background') to.win.focus();
    return;
  }
  // The window could not take it: it gets a window of its own after all, where it was let go.
  const from = win.isDestroyed() ? (to.win.isDestroyed() ? null : to.win) : win;
  const bounds = from ? tearBounds(from, win.isDestroyed() ? { ...spec, at: { x: to.x, y: to.y } } : spec) : undefined;
  const next = bounds ? createWindow({ bounds, handoff: data }) : null;
  if (next) point(next.webContents); else for (const [id, s] of mine) { if (sessions.get(id) === s) { sessions.delete(id); try { s.proc.kill(); } catch {} } }
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
  // A folder's own git settings can name a program for `status` to run (core.fsmonitor); being in a folder is not
  // a reason to run it.
  const status = await run('git', ['-C', cwd, '-c', 'core.fsmonitor=false', 'status', '--porcelain', '--untracked-files=no'], { timeout: 1500 });
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
/** The pages of windows opened beside another one: they start empty instead of reopening the last session. */
const fresh = new Set<number>();
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

/** `from`: the window is for a tab taken out of another one. It opens there, and its page starts from that handoff. */
function createWindow(from?: { bounds: Electron.Rectangle; handoff: Record<string, unknown>; shown?: () => void }) {
  const state = readJson<{ bounds?: Electron.Rectangle }>(STATE_FILE, {});
  const first = !from && !BrowserWindow.getAllWindows().length;
  const win = new BrowserWindow({
    width: from?.bounds.width ?? state.bounds?.width ?? 1360,
    height: from?.bounds.height ?? state.bounds?.height ?? 860,
    x: from ? from.bounds.x : first ? state.bounds?.x : undefined,
    y: from ? from.bounds.y : first ? state.bounds?.y : undefined,
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
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
    },
  });
  const wc = win.webContents;
  const snapshot = contextFile(wc.id);
  wc.once('destroyed', () => fs.rmSync(snapshot, { force: true }));
  if (from) handoffs.set(wc.id, from.handoff);
  // Only the first window reopens the last session. A second one that did would start its shells under the
  // first one's names, which ends the first one's.
  if (!first) fresh.add(wc.id);
  win.once('ready-to-show', () => {
    const animate = animateWindows();
    if (animate) win.setOpacity(0);
    if (process.env.ASTROLABE_TEST === 'background') win.showInactive(); else win.show();
    if (animate) fadeWindow(win, 1, 190);
    from?.shown?.();
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
    fresh.delete(wc.id);
    dropGhost(wc.id);
    leaveHover(wc.id);
    handoffs.delete(wc.id);
    shots.delete(wc.id);
    const s = readJson<Record<string, unknown>>(STATE_FILE, {});
    writeJson(STATE_FILE, { ...s, bounds: win.getBounds() });
    killSessionsFor(wc);
  });
  win.on('enter-full-screen', () => wc.send('win:fullscreen', true));
  win.on('leave-full-screen', () => wc.send('win:fullscreen', false));
  wc.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  // The window only ever shows the app's own page. Anything else it is sent to (a link, a dropped file, a file
  // served through `__file`) would otherwise load with the preload script, and so with the app's reach.
  const stay = (e: Electron.Event, url: string) => { if (!isAppPage(url)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } };
  wc.on('will-navigate', stay);
  wc.on('will-redirect', stay);
  wc.on('will-attach-webview', (e) => e.preventDefault());
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
      { label: 'New Note', click: send('note.newInRepo') },
      { label: 'New Window', click: () => createWindow() },
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
      { label: 'Expand or Split', click: send('editor.expand') },
      { label: 'Switch Displays', click: send('editor.swapSide') },
      { label: 'Toggle Full Screen', click: () => { const w = BrowserWindow.getFocusedWindow(); w?.setFullScreen(!w.isFullScreen()); } },
      { label: 'Developer Tools', click: () => BrowserWindow.getFocusedWindow()?.webContents.toggleDevTools() },
      { label: 'Reload Window', click: () => { const w = BrowserWindow.getFocusedWindow(); if (w) void reloadWindow(w); } },
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

const DEV_URL = process.env.ASTROLABE_DEV_URL || '';
/** The app's own page: the one address its windows are meant to show. */
function isAppPage(url: string) {
  try {
    const u = new URL(url);
    if (DEV_URL) { const d = new URL(DEV_URL); if (u.protocol === d.protocol && u.host === d.host) return true; }
    return u.protocol === 'astrolabe:' && u.host === 'app' && (u.pathname === '/' || u.pathname === '/index.html');
  } catch { return false; }
}
/** Messages are taken only from the top frame of a window showing the app's own page. */
function trusted(e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) {
  const frame = e.senderFrame;
  return !!frame && !frame.parent && isAppPage(frame.url);
}
const guarded = {
  handle: (channel: string, fn: (e: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown) =>
    ipcMain.handle(channel, (e, ...args) => { if (!trusted(e)) throw new Error('Not allowed'); return fn(e, ...args); }),
  on: (channel: string, fn: (e: Electron.IpcMainEvent, ...args: any[]) => void) =>
    ipcMain.on(channel, (e, ...args) => { if (trusted(e)) fn(e, ...args); else if (channel === 'app:shot') e.returnValue = 0; }),
};

// The title and icon of a web page, for the box a clicked link in a note shows. Only http(s), only the first
// 512 KB of the page and 256 KB of the icon, no cookies sent, and nothing at all if it takes more than 6 seconds.
const previews = new Map<string, Promise<{ title?: string; icon?: string }>>();
async function readCapped(res: Response, cap: number) {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  const parts: Uint8Array[] = []; let size = 0;
  while (size < cap) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    parts.push(value); size += value.length;
  }
  void reader.cancel().catch(() => {});
  const out = new Uint8Array(Math.min(size, cap)); let at = 0;
  for (const p of parts) { const take = p.subarray(0, out.length - at); out.set(take, at); at += take.length; if (at >= out.length) break; }
  return out;
}
const unescapeHtml = (t: string) => t.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (m, c: string) => {
  const k = c.toLowerCase();
  if (k[0] === '#') { const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
  return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' } as Record<string, string>)[k] ?? m;
});
function linkPreview(address: string) {
  let url: URL;
  try { url = new URL(address); } catch { return Promise.resolve({}); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return Promise.resolve({});
  const key = url.href;
  const known = previews.get(key);
  if (known) return known;
  const job = (async () => {
    const stop = AbortSignal.timeout(6000);
    const get = (u: string, accept: string) => net.fetch(u, { signal: stop, credentials: 'omit', headers: { accept, 'user-agent': 'Mozilla/5.0 (Macintosh) Astrolabe' } } as RequestInit);
    const res = await get(url.href, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5');
    const final = new URL(res.url || url.href);
    const type = res.headers.get('content-type') ?? '';
    let title: string | undefined;
    let iconUrl = new URL('/favicon.ico', final).href;
    if (res.ok && /html|xml/i.test(type)) {
      const bytes = await readCapped(res, 512 * 1024);
      const charset = /charset=([\w-]+)/i.exec(type)?.[1];
      let html: string;
      try { html = new TextDecoder(charset || 'utf-8').decode(bytes); } catch { html = new TextDecoder().decode(bytes); }
      const body = html.search(/<body[\s>]/i);
      const head = body > 0 ? html.slice(0, body) : html;
      const meta = (name: string) => {
        for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
          const which = /\b(?:property|name)\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1]?.toLowerCase();
          if (which === name) return /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag)?.slice(1).find((x) => x != null);
        }
        return undefined;
      };
      const raw = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? meta('og:title');
      if (raw) title = unescapeHtml(raw).replace(/\s+/g, ' ').trim().slice(0, 300) || undefined;
      // The biggest icon the page names, with an apple-touch-icon as the last resort (they are large and square).
      let best = -1;
      for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
        const rel = /\brel\s*=\s*["']?([^"'>]+)/i.exec(tag)?.[1]?.toLowerCase() ?? '';
        const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag)?.slice(1).find((x) => x != null);
        if (!href || !/(^|\s)(icon|apple-touch-icon)(\s|$)/.test(rel)) continue;
        const size = Number(/\bsizes\s*=\s*["']?(\d+)/i.exec(tag)?.[1] ?? 16);
        const score = (rel.includes('apple') ? 0 : 1000) + Math.min(size, 256);
        try { if (score > best) { iconUrl = new URL(unescapeHtml(href), final).href; best = score; } } catch {}
      }
    } else void res.body?.cancel().catch(() => {});
    let icon: string | undefined;
    try {
      if (/^https?:/.test(iconUrl)) {
        const got = await get(iconUrl, 'image/*');
        const kind = (got.headers.get('content-type') ?? '').split(';')[0].trim();
        if (got.ok && /^image\/(png|x-icon|vnd\.microsoft\.icon|gif|jpeg|webp|svg\+xml|avif)$/.test(kind)) {
          const bytes = await readCapped(got, 256 * 1024);
          if (bytes.length) icon = `data:${kind};base64,${Buffer.from(bytes).toString('base64')}`;
        } else void got.body?.cancel().catch(() => {});
      }
    } catch {}
    return { title, icon };
  })().catch(() => ({}));
  previews.set(key, job);
  // Nothing found (offline, a slow site): ask again next time rather than remember the failure.
  void job.then((r: { title?: string; icon?: string }) => { if (!r.title && !r.icon && previews.get(key) === job) previews.delete(key); });
  if (previews.size > 300) previews.delete(previews.keys().next().value!);
  return job;
}

function registerIpc() {
  const ipcMain = guarded; // every handler below goes through the check above
  ipcMain.on('editor:activeFile', (event, file: unknown) => {
    if (file !== null && (typeof file !== 'string' || !path.isAbsolute(file))) return;
    const target = contextFile(event.sender.id);
    try {
      fs.writeFileSync(target + '.tmp', JSON.stringify({ activeFile: file }), { mode: 0o600 });
      fs.renameSync(target + '.tmp', target);
    } catch (error) { console.warn('Could not update editor context', error); }
  });
  ipcMain.handle('pty:spawn', (e, id: string, opts) => spawnSession(e.sender, id, opts));
  // A shell answers only to the page it belongs to: one whose tab has gone to another window has no more say in it.
  const own = (e: Electron.IpcMainEvent, id: string) => { const s = sessions.get(id); return s && s.wc === e.sender ? s : null; };
  ipcMain.on('pty:write', (e, id: string, data: string) => { own(e, id)?.proc.write(data); });
  ipcMain.on('pty:resize', (e, id: string, cols: number, rows: number) => {
    try { own(e, id)?.proc.resize(Math.max(2, cols), Math.max(2, rows)); } catch {}
  });
  ipcMain.handle('pty:attach', (e, id: string) => {
    const ok = attachSession(e.sender, id);
    // A page already up (it took the terminal in from another window) will not report that it has booted, which is
    // what ends the keeping of output for a page that is still starting.
    const s = sessions.get(id);
    if (ok && s && !reloading.has(e.sender.id) && !handoffs.has(e.sender.id)) s.since = null;
    return ok;
  });
  ipcMain.on('pty:kill', (e, id: string) => { const s = own(e, id); if (s) { try { s.proc.kill(); } catch {} sessions.delete(id); } });

  ipcMain.handle('fs:readDir', (_e, dir: string) => readDir(dir).catch(() => []));
  ipcMain.handle('fs:readFile', async (_e, file: string) => {
    try {
      const st = await fsp.stat(file);
      if (st.isDirectory()) return { error: 'That is a folder, not a file.' };
      // A device or a pipe has no end to read to (/dev/zero would fill memory until the app died).
      if (!st.isFile()) return { error: 'This is not an ordinary file, so it is not opened.' };
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
  ipcMain.handle('editor:menu', (e, opts: { split?: boolean }) => new Promise<string | null>((resolve) => {
    if (process.env.ASTROLABE_TEST) { resolve(testMenuChoice); testMenuChoice = null; return; }
    const win = BrowserWindow.fromWebContents(e.sender);
    const menu = Menu.buildFromTemplate([
      { label: 'Split view', enabled: !!opts?.split, click: () => resolve('split') },
      { label: 'New File', click: () => resolve('newFile') },
    ]);
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
  ipcMain.handle('link:preview', (_e, address: unknown) => (typeof address === 'string' && address.length < 4096 ? linkPreview(address) : {}));
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
  ipcMain.handle('fs:newNote', async (_e, dir: string, template?: string) => {
    // A note starts with whatever the command the `noteTemplate` setting names prints (it is given the note's folder
    // as its last argument). With no command, or one that fails, the note starts empty.
    const made = template ? await runUserCommand(template, dir, 10000) : null;
    const text = made?.out ?? '';
    for (let i = 1; i < 500; i++) {
      const file = path.join(dir, i === 1 ? 'Untitled.md' : `Untitled ${i}.md`);
      try { await fsp.writeFile(file, text, { flag: 'wx' }); return { path: file, text, warning: made?.error }; }
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
    // What a note calls a picture is whatever path it names; only a picture is ever sent out.
    if (!PICTURE.test(String(file)) || !(await fsp.stat(file).then((st) => st.isFile(), () => false))) return { error: 'not a picture file' };
    await userPathReady;
    return new Promise<{ url?: string; error?: string }>((resolve) => {
      execFile('/bin/sh', ['-c', `${command} "$0"`, file], { timeout: 120000, maxBuffer: 1024 * 1024, env: { ...process.env, PATH: userPath } }, (err, stdout, stderr) => {
        const url = String(stdout ?? '').trim().split(/\s+/).reverse().find((word) => /^https?:\/\/\S+$/.test(word));
        resolve(!err && url ? { url } : { error: (String(stderr ?? '').trim() || err?.message || 'the command printed no web address').slice(0, 300) });
      });
    });
  });
  // What happens when a file's last tab closes is up to the command the `onFileClose` setting names: it is given the
  // file's path as its last argument, and the last line it prints, if any, is shown as a message.
  ipcMain.handle('fs:fileClosed', async (_e, command: string, file: string) => {
    const res = await runUserCommand(command, file, 120000);
    return res.error ? { error: res.error } : { said: res.out.split('\n').map((line) => line.trim()).filter(Boolean).pop() };
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
  ipcMain.handle('state:load', (e) => { const state = readJson<Record<string, unknown>>(STATE_FILE, {}); return fresh.has(e.sender.id) ? { ...state, session: null } : state; });
  ipcMain.handle('state:save', (_e, data) => { writeJson(STATE_FILE, { ...readJson<Record<string, unknown>>(STATE_FILE, {}), ...data }); return true; });
  ipcMain.on('app:zoom', (e, factor: number) => { e.sender.setZoomFactor(Math.min(2, Math.max(0.5, factor))); });
  ipcMain.on('app:openExternal', (_e, url: string) => { if (/^(https?|mailto):/.test(url)) shell.openExternal(url); });
  ipcMain.on('app:reveal', (_e, file: string) => shell.showItemInFolder(file));
  ipcMain.on('app:reloadWindow', (e) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) void reloadWindow(w); });
  ipcMain.on('app:toggleDevTools', (e) => e.sender.toggleDevTools());
  ipcMain.on('app:newWindow', () => createWindow());
  ipcMain.on('tear:over', (e, spec: TearSpec | null) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win && spec) tearOver(win, spec); else { leaveHover(e.sender.id); dropGhost(e.sender.id); }
  });
  ipcMain.on('tear:drop', (e, spec: TearSpec | null) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const page = e.sender.id;
    const under = win && spec ? windowUnder(win, spec) : null;
    leaveHover(page);
    if (win && spec && under) { dropGhost(page); void moveInto(win, under, spec).catch(() => {}); }
    else if (win && spec) void tearOff(win, spec).catch(() => dropGhost(page));
    else dropGhost(page);
  });
  // Right-clicking a terminal tab.
  ipcMain.handle('tab:menu', (e, opts: { join?: boolean; split?: boolean; part?: boolean }) => new Promise<string | null>((resolve) => {
    if (process.env.ASTROLABE_TEST) { resolve(testMenuChoice); testMenuChoice = null; return; }
    const win = BrowserWindow.fromWebContents(e.sender);
    const menu = Menu.buildFromTemplate([
      { label: 'Split view', enabled: !!opts?.split, click: () => resolve('split') },
      { label: 'Combine with Current Tab', enabled: !!opts?.join, click: () => resolve('join') },
      { label: 'Move Terminal to Its Own Tab', enabled: !!opts?.part, click: () => resolve('part') },
      { type: 'separator' as const },
      { label: 'Close Tab', click: () => resolve('close') },
    ]);
    menu.popup({ window: win ?? undefined, callback: () => setTimeout(() => resolve(null), 50) });
  }));
  // A right-click menu the page describes (the top row's): rows with an id and a label, anything else a line.
  ipcMain.handle('app:menu', (e, items: unknown) => new Promise<string | null>((resolve) => {
    if (process.env.ASTROLABE_TEST) { resolve(testMenuChoice); testMenuChoice = null; return; }
    const win = BrowserWindow.fromWebContents(e.sender);
    const rows = (Array.isArray(items) ? items : []).slice(0, 40) as ({ id?: unknown; label?: unknown; enabled?: unknown } | null)[];
    const menu = Menu.buildFromTemplate(rows.map((it) => {
      if (!it || typeof it.id !== 'string' || typeof it.label !== 'string') return { type: 'separator' as const };
      const id = it.id;
      return { label: it.label.slice(0, 80), enabled: it.enabled !== false, click: () => resolve(id) };
    }));
    menu.popup({ window: win ?? undefined, callback: () => setTimeout(() => resolve(null), 50) });
  }));
  ipcMain.on('app:closeWindow', (e) => BrowserWindow.fromWebContents(e.sender)?.close());
  ipcMain.on('win:buttons', (e, show: boolean) => { if (process.platform === 'darwin') BrowserWindow.fromWebContents(e.sender)?.setWindowButtonVisibility(!!show); });
  ipcMain.on('clipboard:write', (_e, text: string) => clipboard.writeText(text));
  ipcMain.handle('clipboard:read', () => clipboard.readText());
}

const PICTURE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|heic|ico|tiff?)$/i;
app.whenReady().then(() => {
  // The app's settings, last session and pasted pictures are nobody else's to read.
  try { fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 }); fs.chmodSync(CONFIG_DIR, 0o700); } catch {}
  // The page asks for nothing but the clipboard; a camera, microphone, location and the rest are refused.
  const ALLOWED = new Set(['clipboard-read', 'clipboard-sanitized-write']);
  session.defaultSession.setPermissionRequestHandler((wc, permission, done) => done(ALLOWED.has(permission) && isAppPage(wc?.getURL() ?? '')));
  session.defaultSession.setPermissionCheckHandler((wc, permission) => ALLOWED.has(permission) && isAppPage(wc?.getURL() ?? ''));
  const notFound = () => new Response('Not found', { status: 404 });
  protocol.handle('astrolabe', async (req) => {
    let p: string;
    try {
      const u = new URL(req.url);
      if (u.host !== 'app') return notFound();
      p = decodeURIComponent(u.pathname);
    } catch { return notFound(); }
    if (p.includes('\0')) return notFound();
    if (p === '/' || p === '') p = '/index.html';
    const shot = /^\/__shot\/(\d+)\.png$/.exec(p);
    if (shot) {
      const png = shots.get(Number(shot[1]));
      return png ? new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png', 'cache-control': 'no-store' } }) : notFound();
    }
    // A picture in a note is a file on disk, which a page served from here may not load by its own path.
    const local = /^\/__file(\/.+)$/.exec(p);
    if (local) {
      if (!PICTURE.test(local[1])) return notFound();
      try {
        const res = await net.fetch(pathToFileURL(local[1]).toString());
        // It is only ever a picture to look at. Opened as a page (an SVG can hold scripts) it could do nothing:
        // no scripts, and not the app's own origin.
        const headers = new Headers(res.headers);
        headers.set('content-security-policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
        headers.set('x-content-type-options', 'nosniff');
        return new Response(res.body, { status: res.status, headers });
      } catch { return notFound(); }
    }
    const file = path.normalize(path.join(DIST, p));
    // Inside the built interface and nowhere else ("dist-electron" and "dist.old" also start with "dist").
    if (!file.startsWith(DIST + path.sep)) return notFound();
    return net.fetch(pathToFileURL(file).toString()).catch(notFound);
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
