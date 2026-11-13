import { Terminal, IMarker } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { SerializeAddon } from '@xterm/addon-serialize';
import { api, formatDuration, tildify } from './api';
import { carried, carry } from './handoff';
import { monoFont, pushHistory, refreshFiles } from './monaco';
import { bus } from './panes';
import { scrollSpeed, useStore } from './store';
import { getTheme, xtermTheme } from './themes';
import { fileTarget, openLink } from './links';

export interface Block {
  id: number;
  head: IMarker;            // first row of the block: our header row, or the top of your own prompt
  headPartial: boolean;     // the row at head still held the tail of earlier output, so the block starts one lower
  native: boolean;          // drawn under your own prompt, so no header row of ours
  out: IMarker;             // first row of output
  end: IMarker | null;      // row after the last output row; null while running
  endInclusive: boolean;    // output ended mid-line, so the end row still belongs to it
  command: string; cwd: string; branch: string | null;
  start: number; duration: number | null; exit: number | null;
  el: HTMLDivElement | null;
}

type Listener = (ev: 'prompt' | 'running' | 'blocks') => void;

/** A terminal as its page leaves it when the window reloads in place: enough for the next page to draw the
 *  same screen and carry on with the same shell. Rows are counted from the top of the scrollback. */
interface TermSnap {
  cols: number; rows: number;
  /** The scrollback and screen, then (apart, so block rows can be marked in between) the alternate screen and modes. */
  normal: string; rest: string;
  viewportY: number; atBottom: boolean;
  state: TermSession['state']; native: boolean; booted: boolean; promptSeen: boolean; awaitingPrompt: boolean; submitted: boolean; agentBusy: boolean;
  early: string; earlyEnter: boolean; input: string;
  pendingHead: number | null; pendingPartial: boolean; blockSeq: number;
  blocks: (Pick<Block, 'id' | 'headPartial' | 'native' | 'endInclusive' | 'command' | 'cwd' | 'branch' | 'start' | 'duration' | 'exit'> & { head: number; out: number; end: number | null; running: boolean })[];
}

const sessions = new Map<string, TermSession>();
let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  api.pty.onData((id, data) => sessions.get(id)?.term.write(data));
  api.pty.onExit((id) => sessions.get(id)?.handleExit());
}
export function getSession(id: string) { return sessions.get(id); }
(window as any).__sessions = sessions;
export function allSessions() { return [...sessions.values()]; }

function b64(s: string) {
  try { return new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0))); } catch { return ''; }
}

const ICON = {
  copy: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/></svg>',
  out: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M3 4h10M3 8h10M3 12h6"/></svg>',
  rerun: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5v3h-3"/></svg>',
};

export class TermSession {
  readonly term: Terminal;
  readonly host: HTMLDivElement;
  private fit = new FitAddon();
  private search = new SearchAddon();
  private serializer = new SerializeAddon();
  /** Settles once the terminal is ready to show: at once, or when a reloaded window's screen is back in place. */
  ready: Promise<void> = Promise.resolve();
  /** Set by the pane: what is typed in the command input. */
  inputText: (() => string) | null = null;
  /** Text the command input held when the window reloaded, for the pane to put back. */
  resumedInput = '';
  private uncarry: () => void = () => {};
  private layer: HTMLDivElement;
  private opened = false;
  private spawned = false;
  private disposed = false;
  private ro: ResizeObserver;
  private raf = 0;
  private listeners = new Set<Listener>();
  private blockSeq = 0;
  private awaitingPrompt = false;
  private submitted = false;
  private inputEl: HTMLElement | null = null;
  /** Typing the shell cannot take yet (it is still starting, or a command has just ended and the next prompt
   *  is not up), held back so it lands in the command input instead of being echoed into the shell's own
   *  line (where it stuck, uneditable, under the input, and ran with the next command). */
  private early = '';
  private earlyEnter = false;
  private booted = false;
  /** The shell has reported a prompt at least once, so after each command it will again. */
  private promptSeen = false;
  /** Set by the pane: adds held-back typing to the command input, and runs it if Enter was pressed. */
  onEarlyInput: ((text: string, enter: boolean) => void) | null = null;
  /** Set by the pane: moves keyboard focus to the command input. */
  wantInput: (() => void) | null = null;
  private pendingHead: IMarker | null = null;
  private pendingPartial = false;
  /** True when the shell keeps its own prompt (Powerlevel10k etc.) and the input sits at its cursor. */
  native = false;
  private current: Block | null = null;
  /** The agent in this terminal has shown its working spinner since it last waited for you. */
  private agentBusy = false;
  private tick: number | undefined;
  private settle: number | undefined;
  blocks: Block[] = [];
  selected: Block | null = null;
  state: 'boot' | 'prompt' | 'running' = 'boot';

  constructor(readonly id: string, private startCwd: string) {
    wire();
    const st = useStore.getState();
    const snap = carried<TermSnap>(`term:${id}`);
    this.host = document.createElement('div');
    this.host.className = 'term-host';
    this.layer = document.createElement('div');
    this.layer.className = 'blk-layer';
    this.term = new Terminal({
      ...(snap ? { cols: snap.cols, rows: snap.rows } : {}),
      allowProposedApi: true,
      fontFamily: monoFont(), fontSize: st.settings.fontSize, lineHeight: 1.32,
      // Output keeps the weights its program asks for: regular, and bold where marked.
      fontWeight: '400', fontWeightBold: '700',
      cursorBlink: true, cursorStyle: 'bar', cursorWidth: 2, cursorInactiveStyle: 'none', allowTransparency: true,
      scrollback: 20000, scrollSensitivity: scrollSpeed(st.settings), fastScrollSensitivity: scrollSpeed(st.settings) * 4, macOptionClickForcesSelection: true, drawBoldTextInBrightColors: false,
      theme: xtermTheme(getTheme(st.settings.theme)),
      // Links a program marks itself (OSC 8): Claude Code sends files as file:// links with a #L line.
      linkHandler: {
        allowNonHttpProtocols: true,
        activate: (ev, uri) => {
          if (ev.metaKey) void openLink(uri, this.cwd());
          else useStore.getState().showToast(`Hold ⌘ and click to open the ${fileTarget(uri, '/') ? 'file' : 'link'}`);
        },
      },
    });
    this.term.loadAddon(this.fit);
    this.term.loadAddon(this.search);
    this.term.loadAddon(this.serializer);
    const unicode = new Unicode11Addon();
    this.term.loadAddon(unicode);
    this.term.unicode.activeVersion = '11';
    this.term.parser.registerOscHandler(7777, (data) => { this.handleOsc(data); return true; });
    this.term.onTitleChange((title) => this.handleTitle(title));
    this.term.attachCustomKeyEventHandler((ev) => this.handleKey(ev));
    this.term.onData((d) => this.fromTerminal(d));
    this.term.onBinary((d) => api.pty.write(this.id, d));
    this.term.onResize(({ cols, rows }) => { if (this.spawned) api.pty.resize(this.id, cols, rows); this.schedule(); });
    this.term.onScroll(() => this.schedule());
    this.term.onRender(() => this.schedule());
    this.term.onWriteParsed(() => this.schedule());
    this.term.registerLinkProvider({ provideLinks: (y, cb) => { this.provideLinks(y).then(cb, () => cb(undefined)); } });
    this.layer.addEventListener('click', (e) => this.handleLayerClick(e));
    this.host.addEventListener('mouseup', (e) => this.handleMouseUp(e));
    // Resize once the pane has stopped changing size, not on every frame of a drag. A shell (or a program
    // like Claude) repaints after each resize; if resizes outrun those repaints, each repaint lands on
    // text already rewrapped for a newer width and everything creeps down the screen.
    this.ro = new ResizeObserver(() => {
      if (!this.spawned) { this.refit(); return; }
      window.clearTimeout(this.settle);
      this.settle = window.setTimeout(() => this.refit(), 140);
    });
    sessions.set(id, this);
    this.uncarry = carry(`term:${id}`, () => this.snapshot());
    if (snap) this.ready = this.resume(snap);
  }

  // ---------- carrying on through a window reload ----------

  private async snapshot(): Promise<TermSnap | null> {
    if (!this.spawned || this.disposed) return null;
    // Output already on its way in is part of the picture.
    await new Promise<void>((done) => this.term.write('', done));
    const normal = this.serializer.serialize({ excludeAltBuffer: true, excludeModes: true });
    let full = this.serializer.serialize();
    // Two things the terminal is in the middle of that the serializer leaves out.
    const core = (this.term as any)._core;
    try { if (core.coreService.isCursorHidden) full += '\x1b[?25l'; } catch {}
    try { const enc = core.coreMouseService.activeEncoding; if (enc === 'SGR') full += '\x1b[?1006h'; else if (enc === 'SGR_PIXELS') full += '\x1b[?1016h'; } catch {}
    const apart = full.startsWith(normal);
    const row = (m: IMarker | null) => (m && !m.isDisposed && m.line >= 0 ? m.line : null);
    const buf = this.term.buffer.active;
    return {
      cols: this.term.cols, rows: this.term.rows,
      normal: apart ? normal : full, rest: apart ? full.slice(normal.length) : '',
      viewportY: buf.viewportY, atBottom: buf.viewportY >= buf.baseY,
      state: this.state, native: this.native, booted: this.booted, promptSeen: this.promptSeen, awaitingPrompt: this.awaitingPrompt, submitted: this.submitted, agentBusy: this.agentBusy,
      early: this.early, earlyEnter: this.earlyEnter, input: this.inputText?.() ?? '',
      pendingHead: row(this.pendingHead), pendingPartial: this.pendingPartial, blockSeq: this.blockSeq,
      blocks: this.blocks.flatMap((b) => {
        const head = row(b.head); const out = row(b.out);
        if (head === null || out === null) return [];
        return [{ id: b.id, head, out, end: row(b.end), running: !b.end, headPartial: b.headPartial, native: b.native, endInclusive: b.endInclusive, command: b.command, cwd: b.cwd, branch: b.branch, start: b.start, duration: b.duration, exit: b.exit }];
      }),
    };
  }

  /** Draws the screen the last page left and takes its shell back, which never stopped. */
  private resume(snap: TermSnap) {
    this.spawned = true;
    this.native = snap.native; this.state = snap.state; this.booted = snap.booted; this.promptSeen = snap.promptSeen;
    this.awaitingPrompt = snap.awaitingPrompt; this.submitted = snap.submitted; this.agentBusy = snap.agentBusy;
    this.early = snap.early; this.earlyEnter = snap.earlyEnter; this.resumedInput = snap.input;
    this.pendingPartial = snap.pendingPartial; this.blockSeq = snap.blockSeq;
    return new Promise<void>((done) => {
      this.term.write(snap.normal, () => {
        // The rows are where they were, so the blocks can be pinned to them again.
        const buf = this.term.buffer.normal;
        const at = (line: number) => this.term.registerMarker(line - (buf.baseY + buf.cursorY));
        if (snap.pendingHead !== null) this.pendingHead = at(snap.pendingHead);
        for (const b of snap.blocks) {
          const { head, out, end, running, ...rest } = b;
          const block: Block = { ...rest, head: at(head), out: at(out), end: running || end === null ? null : at(end), el: null };
          if (running) { block.end = null; this.current = block; } else if (!block.end) continue;
          this.blocks.push(block);
        }
      });
      if (snap.rest) this.term.write(snap.rest);
      this.term.write('', () => {
        if (this.disposed) { done(); return; }
        if (!snap.atBottom) this.term.scrollToLine(snap.viewportY);
        if (this.current) this.tick = window.setInterval(() => this.schedule(), 1000);
        this.emit('blocks');
        this.schedule();
        // From here the shell's output flows again, starting with what it printed while there was no page.
        api.pty.attach(this.id).then((alive) => { if (!alive) this.handleExit(); }, () => {}).finally(done);
      });
    });
  }

  on(fn: Listener) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit(ev: 'prompt' | 'running' | 'blocks') { for (const fn of this.listeners) fn(ev); }

  private cwd() {
    const pane = useStore.getState().panes[this.id];
    return pane?.kind === 'terminal' ? pane.cwd : this.startCwd;
  }

  mount(container: HTMLElement) {
    container.appendChild(this.host);
    if (!this.opened) {
      this.opened = true;
      this.term.open(this.host);
      this.host.appendChild(this.layer);
      // The GPU renderer can leave the terminal's own caret painted after focus moves to the command input,
      // which showed as a second caret stuck at the start of the line. Repaint when the terminal lets go.
      this.term.textarea?.addEventListener('blur', () => this.repaintCaret());
      try {
        const gl = new WebglAddon();
        gl.onContextLoss(() => gl.dispose());
        this.term.loadAddon(gl);
      } catch {}
      this.ro.observe(this.host);
    }
    this.refit();
  }

  refit() {
    if (this.disposed || !this.opened || this.host.offsetWidth < 8 || this.host.offsetHeight < 8) return;
    const next = this.fit.proposeDimensions();
    if (this.native && this.spawned && this.state === 'prompt' && next && next.cols !== this.term.cols) {
      // Your prompt is on screen and the width is about to change. A full-width prompt line would wrap
      // and be left behind when the shell redraws it, so wipe the prompt first and let the shell repaint.
      const buf = this.term.buffer.normal;
      const row = buf.baseY + buf.cursorY;
      const head = this.pendingHead && !this.pendingHead.isDisposed && this.pendingHead.line >= 0 ? this.pendingHead.line + (this.pendingPartial ? 1 : 0) : row;
      const up = Math.max(0, Math.min(row - head, buf.cursorY));
      this.term.write(`\x1b7${up ? `\x1b[${up}A` : ''}\r\x1b[0J\x1b8`, () => { try { this.fit.fit(); } catch {} this.schedule(); });
      return;
    }
    try { this.fit.fit(); } catch {}
    if (!this.spawned) {
      this.spawned = true;
      this.native = useStore.getState().settings.prompt !== 'astrolabe';
      api.pty.spawn(this.id, { cwd: this.startCwd, cols: this.term.cols, rows: this.term.rows, prompt: this.native ? 'native' : 'own' }).then((res: { integrated: boolean }) => {
        if (!res.integrated) { this.state = 'running'; useStore.getState().patchPane(this.id, { integrated: false, atPrompt: false }); this.boot(false); }
      });
      // A shell that never reports its prompt still gets what you typed, once it has had time to start.
      window.setTimeout(() => this.boot(false), 6000);
    }
    this.schedule();
  }

  focus() { this.term.focus(); }

  private repaintCaret() {
    requestAnimationFrame(() => { if (!this.disposed && this.opened) this.term.refresh(0, this.term.rows - 1); });
  }

  applyAppearance(themeId?: string) {
    const st = useStore.getState();
    this.term.options.theme = xtermTheme(getTheme(themeId ?? st.settings.theme));
    this.term.options.fontSize = st.settings.fontSize;
    this.term.options.scrollSensitivity = scrollSpeed(st.settings);
    this.term.options.fastScrollSensitivity = scrollSpeed(st.settings) * 4;
    const family = monoFont();
    // Assigning the same family is a no-op, so bounce it to make xterm measure a newly loaded font.
    if (this.term.options.fontFamily === family) this.term.options.fontFamily = 'monospace';
    this.term.options.fontFamily = family;
    this.refit();
  }

  // ---------- shell integration ----------

  private handleOsc(data: string) {
    const [kind, a, b] = data.split(';');
    const store = useStore.getState();
    if (kind === 'precmd') {
      const exit = Number(a) || 0;
      const cwd = b64(b) || this.startCwd;
      if (this.current) this.finishBlock(exit);
      else store.patchPane(this.id, { lastExit: exit });
      this.awaitingPrompt = true;
      this.state = 'boot';
      if (this.native) {
        // Your prompt is about to be drawn from here down; remember where it starts.
        if (this.pendingHead) this.pendingHead.dispose();
        this.pendingPartial = this.term.buffer.normal.cursorX > 0;
        this.pendingHead = this.term.registerMarker(0);
      }
      this.agentBusy = false;
      store.patchPane(this.id, { cwd, running: false, waiting: false, command: null, integrated: true });
      bus.emit('fs.changed');
      api.git.info(cwd).then((g: { root: string; branch: string; dirty: number } | null) => {
        useStore.getState().patchPane(this.id, { branch: g?.branch ?? null, dirty: g?.dirty ?? 0, gitRoot: g?.root ?? null });
      });
      refreshFiles();
    } else if (kind === 'input') {
      // The shell's line editor is ready (also fires for continuation lines such as an open quote).
      if (this.current || !this.native) return;
      // The input was hidden (first prompt, or a command that turned out to need more typing), so it lost focus.
      const reshow = this.awaitingPrompt || this.submitted;
      this.awaitingPrompt = false;
      this.submitted = false;
      this.state = 'prompt';
      store.patchPane(this.id, { atPrompt: true, integrated: true });
      this.schedule();
      if (reshow) this.emit('prompt');
      this.boot(true);
    } else if (kind === 'typed') {
      // Keys that were waiting for the shell when its line editor started (typed while the last command ran).
      // The shell hands them over instead of taking them into its own line.
      if (this.current) return;
      const raw = b64(a).replace(/\x1b(?:\[[0-9;?]*[ -\/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)?|O.|.)/g, '').replace(/\r\n?/g, '\n');
      const nl = raw.indexOf('\n');
      this.stash((nl < 0 ? raw : raw.slice(0, nl)).replace(/[\x00-\x1f\x7f]/g, ''), nl >= 0);
      if (this.state === 'prompt') this.boot(true);
    } else if (kind === 'prompt') {
      // Fires on every prompt draw, including redraws after a resize, so the anchor row stays right.
      if (this.current || this.native) return;
      if (this.pendingHead) this.pendingHead.dispose();
      this.pendingPartial = false;
      this.pendingHead = this.term.registerMarker(-1);
      this.submitted = false;
      this.state = 'prompt';
      store.patchPane(this.id, { atPrompt: true, integrated: true });
      if (this.awaitingPrompt) { this.awaitingPrompt = false; this.emit('prompt'); }
      this.schedule();
      this.boot(true);
    } else if (kind === 'preexec') {
      const command = b64(a);
      const pane = store.panes[this.id];
      // No anchor means the shell drew a prompt that is not ours (a theme won the fight).
      // Fall back to a plain terminal for this command rather than drawing blocks in the wrong place.
      if (!this.pendingHead || this.pendingHead.isDisposed) {
        this.state = 'running';
        this.agentBusy = false;
        store.patchPane(this.id, { running: true, waiting: false, atPrompt: false, command });
        this.emit('running');
        return;
      }
      const head = this.pendingHead;
      this.pendingHead = null;
      const block: Block = {
        id: ++this.blockSeq, head, headPartial: this.pendingPartial, native: this.native,
        out: this.term.registerMarker(0), end: null, endInclusive: false,
        command, cwd: pane?.kind === 'terminal' ? pane.cwd : this.startCwd,
        branch: pane?.kind === 'terminal' ? pane.branch : null,
        start: Date.now(), duration: null, exit: null, el: null,
      };
      this.blocks.push(block);
      this.current = block;
      this.state = 'running';
      this.select(null);
      this.agentBusy = false;
      store.patchPane(this.id, { running: true, waiting: false, atPrompt: false, command });
      window.clearInterval(this.tick);
      this.tick = window.setInterval(() => this.schedule(), 1000);
      this.emit('running');
      this.emit('blocks');
    }
  }

  /** Agents put their state in the window title. Claude Code leads it with ✳ while it waits for you and
   *  with a spinner glyph while it works; the tab only pulses for the second. When a turn ends on a tab
   *  you are not looking at, the tab flashes as if a command had finished. */
  private handleTitle(title: string) {
    if (this.state !== 'running') return;
    const glyph = [...title.trimStart()][0] ?? '';
    const store = useStore.getState();
    if (glyph === '✳') {
      store.patchPane(this.id, { waiting: true });
      if (this.agentBusy) { this.agentBusy = false; store.commandFinished(this.id, 0); }
    } else if (glyph && /[\u2800-\u28ff\u25d0-\u25d3\u25f4-\u25f7\u2722-\u273d\u00b7\u23fa]/.test(glyph)) {
      this.agentBusy = true;
      store.patchPane(this.id, { waiting: false });
    }
  }

  private finishBlock(exit: number) {
    const block = this.current!;
    const buf = this.term.buffer.normal;
    block.endInclusive = buf.cursorX > 0;
    block.end = this.term.registerMarker(0);
    block.exit = exit;
    block.duration = Date.now() - block.start;
    this.current = null;
    window.clearInterval(this.tick);
    useStore.getState().patchPane(this.id, { lastExit: exit });
    useStore.getState().commandFinished(this.id, exit);
    this.emit('blocks');
  }

  handleExit() {
    window.clearInterval(this.tick);
    useStore.getState().patchPane(this.id, { exited: true, running: false, waiting: false });
  }

  // ---------- input ----------

  run(text: string) {
    const cmd = text.replace(/\x1b\[20[01]~/g, '');
    if (!cmd.trim()) return;
    pushHistory(cmd.trim());
    this.select(null);
    this.term.clearSelection();
    this.term.scrollToBottom();
    this.submitted = true;
    this.schedule();
    // If no command starts (an unfinished quote, say), bring the input back.
    window.setTimeout(() => { if (this.submitted) { this.submitted = false; this.schedule(); this.emit('prompt'); } }, 1500);
    api.pty.write(this.id, `\x1b[200~${cmd}\x1b[201~\r`);
  }

  setInputElement(el: HTMLElement | null) { this.inputEl = el; this.schedule(); }

  send(data: string) { api.pty.write(this.id, data); }
  /** Hands text to the running program the way a paste would. */
  paste(text: string) { this.term.paste(text); }

  /** Typing has nowhere to go yet: the shell is starting, or is between a finished command and its next prompt. */
  private holding() { return !this.booted || (this.state === 'boot' && this.promptSeen); }

  private stash(text: string, enter = false) {
    if (this.earlyEnter) return;
    this.early += text;
    if (enter && this.early.trim()) this.earlyEnter = true;
  }

  /** Everything xterm sends the shell passes through here: keys, but also pastes and text that comes with no
   *  key event (dictation, the emoji picker, an input method), which the key handler never sees. While the
   *  command input owns typing, such text goes to it. Sent on, it would sit in the shell's own line under
   *  the input, out of reach of Backspace, and run with the next command. */
  private fromTerminal(data: string) {
    const atInput = this.state === 'prompt' && !this.submitted;
    if (atInput || this.holding()) {
      const text = data.replace(/\x1b\[20[01]~/g, '').replace(/\r\n?/g, '\n');
      // Text only: control keys and the terminal's own replies to the shell's queries still go through.
      if (/[^\x00-\x1f\x7f]/.test(text) && !/[\x00-\x08\x0b-\x1f\x7f]/.test(text)) {
        if (atInput) bus.emit('input.insert', { pane: this.id, text }); else this.stash(text);
        return;
      }
    }
    api.pty.write(this.id, data);
  }

  /** The shell is ready for input: hand over anything typed while it was not. */
  private boot(atPrompt: boolean) {
    if (this.booted && !atPrompt) return; // the fallbacks only count before the first prompt
    this.booted = true;
    if (atPrompt) this.promptSeen = true;
    const text = this.early; const enter = this.earlyEnter;
    this.early = ''; this.earlyEnter = false;
    if (!text && !enter) return;
    if (atPrompt && this.onEarlyInput) this.onEarlyInput(text, enter);
    else api.pty.write(this.id, text + (enter ? '\r' : ''));
  }

  private handleKey(ev: KeyboardEvent): boolean {
    if (this.holding() && !ev.metaKey && !ev.ctrlKey && !ev.altKey && (ev.key.length === 1 || ev.key === 'Backspace' || ev.key === 'Enter')) {
      ev.preventDefault();
      if (ev.type === 'keydown') {
        if (ev.key === 'Backspace') { if (!this.earlyEnter) this.early = this.early.slice(0, -1); }
        else this.stash(ev.key === 'Enter' ? '' : ev.key, ev.key === 'Enter');
      }
      return false;
    }
    if (ev.type !== 'keydown') return true;
    if (this.state === 'prompt' && !this.submitted && !ev.metaKey && !ev.ctrlKey && !ev.altKey && (ev.key.length === 1 || ev.key === 'Backspace' || ev.key === 'Enter')) {
      this.wantInput?.(); // typing belongs in the command input, not the hidden shell line
      return false;
    }
    const send = (s: string) => { ev.preventDefault(); api.pty.write(this.id, s); return false; };
    if (ev.key === 'Enter' && ev.shiftKey && !ev.metaKey && !ev.ctrlKey) return send('\x1b\r');
    if (ev.altKey && !ev.metaKey && !ev.ctrlKey) {
      if (ev.key === 'ArrowLeft') return send('\x1bb');
      if (ev.key === 'ArrowRight') return send('\x1bf');
    }
    if (ev.metaKey && !ev.altKey && !ev.ctrlKey && !ev.shiftKey) {
      if (ev.key === 'ArrowLeft') return send('\x01');
      if (ev.key === 'ArrowRight') return send('\x05');
      if (ev.key === 'Backspace') return send('\x15');
    }
    return true;
  }

  clear() {
    this.term.clear();
    if (this.state === 'prompt') {
      if (this.pendingHead) this.pendingHead.dispose();
      this.pendingPartial = false;
      if (this.native) this.pendingHead = this.term.registerMarker(0);
      else this.term.write('\n\n', () => { this.pendingHead = this.term.registerMarker(-1); this.schedule(); });
    }
    for (const b of this.blocks) if (b !== this.current) { b.el?.remove(); b.head.dispose(); b.out.dispose(); b.end?.dispose(); }
    this.blocks = this.current ? [this.current] : [];
    this.selected = null;
    this.schedule();
    this.emit('blocks');
  }

  // ---------- blocks ----------

  private schedule() {
    if (this.raf || this.disposed) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.renderBlocks(); });
  }

  /** The smallest the pane can be and still show one row of two columns. */
  minSize() {
    const screen = this.host.querySelector('.xterm-screen') as HTMLElement | null;
    const el = this.host.querySelector('.xterm') as HTMLElement | null;
    const ch = this.cellHeight() || Math.ceil(this.term.options.fontSize! * 1.32 + 1);
    const cw = screen && this.term.cols ? screen.clientWidth / this.term.cols : ch * 0.6;
    const cs = el ? getComputedStyle(el) : null;
    const padY = cs ? parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) : 8;
    const padX = cs ? parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) : 22;
    return { w: Math.ceil(padX + cw * 2 + 1), h: Math.ceil(padY + ch + 1) };
  }

  private cellHeight() {
    const screen = this.host.querySelector('.xterm-screen') as HTMLElement | null;
    return screen && this.term.rows ? screen.clientHeight / this.term.rows : 0;
  }

  private blockRange(b: Block): [number, number] {
    const buf = this.term.buffer.normal;
    const end = b.end ? b.end.line + (b.endInclusive ? 1 : 0) : buf.baseY + buf.cursorY + 1;
    const start = b.head.line + (b.headPartial ? 1 : 0);
    return [start, Math.max(end, start + 1)];
  }

  private renderBlocks() {
    const screen = this.host.querySelector('.xterm-screen') as HTMLElement | null;
    const ch = this.cellHeight();
    if (!screen || !ch) return;
    const alt = this.term.buffer.active.type === 'alternate';
    this.layer.style.display = alt ? 'none' : '';
    if (alt) return;
    const hostRect = this.host.getBoundingClientRect();
    const rect = screen.getBoundingClientRect();
    this.layer.style.top = `${rect.top - hostRect.top}px`;
    this.layer.style.height = `${rect.height}px`;
    this.layer.style.setProperty('--row', `${ch}px`);
    this.layer.style.setProperty('--gutter', `${rect.left - hostRect.left}px`);
    const top = this.term.buffer.active.viewportY;
    const rows = this.term.rows;
    if (this.inputEl) {
      const el = this.inputEl;
      const show = this.state === 'prompt' && !this.submitted;
      if (show && el.classList.contains('is-hidden')) this.repaintCaret();
      el.classList.toggle('is-hidden', !show);
      el.classList.toggle('is-native', this.native);
      if (show) {
        const buf = this.term.buffer.normal;
        const offsetY = rect.top - hostRect.top;
        const offsetX = rect.left - hostRect.left;
        el.style.setProperty('--row', `${ch}px`);
        el.style.setProperty('--gutter', `${offsetX}px`);
        let x = 0; let wanted: number;
        if (this.native) {
          // Sit exactly where the shell's cursor is, and stop short of a right-hand prompt on the same row.
          const cw = rect.width / this.term.cols;
          const row = buf.baseY + buf.cursorY;
          const line = buf.getLine(row);
          let endCol = this.term.cols;
          if (line) for (let c = buf.cursorX + 2; c < this.term.cols; c++) { if (line.getCell(c)?.getChars().trim()) { endCol = c - 1; break; } }
          x = offsetX + buf.cursorX * cw;
          wanted = offsetY + (row - top) * ch;
          el.style.width = `${Math.max(cw * 8, (endCol - buf.cursorX) * cw - 2)}px`;
        } else {
          const headLine = this.pendingHead && !this.pendingHead.isDisposed && this.pendingHead.line >= 0 ? this.pendingHead.line : buf.baseY + buf.cursorY - 1;
          wanted = offsetY + (headLine - 1 - top) * ch;
          el.style.width = '';
        }
        const y = Math.max(0, Math.min(wanted, hostRect.height - el.offsetHeight));
        el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
        // Off its natural spot (scrolled away, or grown past the bottom) it covers output, so it needs a backdrop.
        el.classList.toggle('is-floating', Math.abs(y - wanted) > 1 || (!this.native && el.offsetHeight > ch * 3 + 2));
      }
    }
    this.blocks = this.blocks.filter((b) => { if (b.head.isDisposed || b.head.line < 0) { b.el?.remove(); return false; } return true; });
    for (const b of this.blocks) {
      const [start, end] = this.blockRange(b);
      if (end <= top || start >= top + rows) { if (b.el?.isConnected) b.el.remove(); continue; }
      const el = b.el ?? (b.el = this.buildBlock(b));
      if (!el.isConnected) this.layer.appendChild(el);
      const y = (start - top) * ch;
      const h = (end - start) * ch;
      el.style.transform = `translateY(${y}px)`;
      el.style.height = `${h}px`;
      const pinned = y < 0 && y + h > ch * 2;
      const head = el.firstElementChild as HTMLElement;
      head.style.transform = pinned ? `translateY(${-y}px)` : '';
      el.classList.toggle('is-pinned', pinned);
      el.classList.toggle('is-running', b.exit === null);
      el.classList.toggle('is-failed', !!b.exit);
      el.classList.toggle('is-selected', this.selected === b);
      const meta = el.querySelector('.blk-meta') as HTMLElement;
      const text = b.exit === null
        ? formatDuration(Date.now() - b.start)
        : `${b.exit ? `exit ${b.exit}, ` : ''}${formatDuration(b.duration ?? 0)}`;
      if (meta.textContent !== text) meta.textContent = text;
    }
  }

  private buildBlock(b: Block) {
    const el = document.createElement('div');
    el.className = b.native ? 'blk is-native' : 'blk';
    el.dataset.block = String(b.id);
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
    el.innerHTML = `<div class="blk-head">
      <span class="blk-cwd">${esc(tildify(b.cwd))}</span>${b.branch ? `<span class="blk-branch">${esc(b.branch)}</span>` : ''}
      <span class="blk-cmd">${esc(b.command.split('\n')[0])}</span>
      <span class="blk-meta"></span>
      <span class="blk-actions">
        <button data-act="copy-cmd" title="Copy command">${ICON.copy}</button>
        <button data-act="copy-out" title="Copy output">${ICON.out}</button>
        <button data-act="rerun" title="Run again">${ICON.rerun}</button>
      </span>
    </div><div class="blk-stripe"></div>`;
    return el;
  }

  private blockFromEvent(e: Event) {
    const el = (e.target as HTMLElement).closest('.blk') as HTMLElement | null;
    return el ? this.blocks.find((b) => String(b.id) === el.dataset.block) ?? null : null;
  }

  private handleLayerClick(e: MouseEvent) {
    const btn = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    const block = this.blockFromEvent(e);
    if (!block) return;
    if (!btn) { this.select(block); return; }
    e.stopPropagation();
    const act = btn.dataset.act;
    if (act === 'copy-cmd') this.copy(block, 'command');
    else if (act === 'copy-out') this.copy(block, 'output');
    else if (act === 'rerun' && this.state === 'prompt') this.run(block.command);
  }

  private handleMouseUp(e: MouseEvent) {
    if (this.state !== 'prompt' || e.button !== 0) return;
    if (this.term.hasSelection()) return;
    this.wantInput?.();
    if ((e.target as HTMLElement).closest('.blk-head')) return;
    const screen = this.host.querySelector('.xterm-screen') as HTMLElement | null;
    const ch = this.cellHeight();
    if (!screen || !ch) return;
    const line = this.term.buffer.active.viewportY + Math.floor((e.clientY - screen.getBoundingClientRect().top) / ch);
    const hit = this.blocks.find((b) => { const [s, en] = this.blockRange(b); return line >= s && line < en; }) ?? null;
    this.select(hit === this.selected ? null : hit);
  }

  select(b: Block | null) {
    if (this.selected === b) return;
    this.selected = b;
    this.schedule();
    this.emit('blocks');
  }

  selectRelative(delta: number) {
    const done = this.blocks.filter((b) => b.end);
    if (!done.length) return;
    const i = this.selected ? done.indexOf(this.selected) : done.length;
    const next = done[Math.min(done.length - 1, Math.max(0, i + delta))];
    if (delta > 0 && this.selected === done[done.length - 1]) { this.select(null); this.term.scrollToBottom(); return; }
    this.select(next);
    const [start, end] = this.blockRange(next);
    const top = this.term.buffer.active.viewportY;
    // Away from the bottom, the command input covers the last three rows, so keep the block clear of them.
    const usable = this.term.rows - 3;
    if (start < top) this.term.scrollToLine(Math.max(0, start));
    else if (end > top + usable) this.term.scrollToLine(Math.max(0, Math.min(start, end - usable)));
  }

  blockText(b: Block, what: 'command' | 'output' | 'both') {
    if (what === 'command') return b.command;
    const buf = this.term.buffer.normal;
    const [, end] = this.blockRange(b);
    let out = '';
    for (let y = b.out.line; y < end; y++) {
      const line = buf.getLine(y);
      if (!line) continue;
      if (y > b.out.line && !line.isWrapped) out += '\n';
      out += line.translateToString(!buf.getLine(y + 1)?.isWrapped);
    }
    out = out.replace(/\s+$/, '');
    return what === 'output' ? out : `${b.command}\n${out}`;
  }

  copy(b: Block, what: 'command' | 'output' | 'both') {
    api.clipboard.write(this.blockText(b, what));
    useStore.getState().showToast(what === 'command' ? 'Copied command' : what === 'output' ? 'Copied output' : 'Copied command and output');
  }

  // ---------- find ----------

  find(query: string, dir: 1 | -1 = 1) {
    const t = getTheme(useStore.getState().settings.theme);
    const opts = { incremental: dir === 1, decorations: { matchBackground: t.selection, matchOverviewRuler: t.faint, activeMatchBackground: t.accent + '99', activeMatchColorOverviewRuler: t.accent } };
    return dir === 1 ? this.search.findNext(query, opts) : this.search.findPrevious(query, opts);
  }
  clearFind() { this.search.clearDecorations(); this.term.clearSelection(); }

  // ---------- links ----------

  private async provideLinks(y: number) {
    // A link can run over several rows: wrapped by the terminal, or broken at the right edge by a program
    // such as Claude Code (which goes on, indented, on the next row). Read the rows it spans as one string,
    // remembering which cell each character came from, so every piece of the link opens all of it.
    const buf = this.term.buffer.active;
    const cols = this.term.cols;
    const rowText = (r: number) => buf.getLine(r)?.translateToString(true) ?? '';
    const continues = (r: number) => {
      const next = buf.getLine(r + 1);
      if (!next) return false;
      if (next.isWrapped) return true;
      const t = rowText(r);
      return t.length >= cols - 2 && /[\w\/.\-~%#@+=&?:]$/.test(t) && /^\s*[\w\/.\-~%#@+=&?]/.test(rowText(r + 1));
    };
    let first = y - 1; let last = y - 1;
    while (first > 0 && y - 1 - first < 8 && continues(first - 1)) first--;
    while (last - (y - 1) < 8 && continues(last)) last++;
    let text = '';
    const cells: { x: number; y: number }[] = [];
    for (let r = first; r <= last; r++) {
      const line = buf.getLine(r);
      if (!line) break;
      const soft = !!buf.getLine(r + 1)?.isWrapped && r < last;
      const t = line.translateToString(!soft);
      const from = r > first && !line.isWrapped ? t.length - t.trimStart().length : 0; // drop the indent of a broken line
      for (let i = from; i < t.length; i++) { text += t[i]; cells.push({ x: i + 1, y: r + 1 }); }
    }
    if (!text.trim()) return undefined;
    // The part of a link on the hovered row; null if the link does not touch it.
    const onRow = (i: number, len: number) => {
      let a = -1; let b = -1;
      for (let k = i; k < i + len; k++) if (cells[k]?.y === y) { if (a < 0) a = k; b = k; }
      return a < 0 ? null : { start: { x: cells[a].x, y }, end: { x: cells[b].x, y } };
    };
    const links: any[] = [];
    const url = /https?:\/\/[^\s"'<>)\]]+/g;
    let m: RegExpExecArray | null;
    while ((m = url.exec(text))) {
      const href = m[0].replace(/[.,;:]+$/, '');
      const range = onRow(m.index, href.length);
      if (!range) continue;
      links.push({
        range, text: href,
        activate: (ev: MouseEvent) => { if (ev.metaKey) api.app.openExternal(href); else useStore.getState().showToast('Hold ⌘ and click to open the link'); },
      });
    }
    const cwd = this.cwd();
    const SUFFIX = String.raw`(?::\d+(?::\d+)?|#L\d+(?:C\d+)?(?:-L?\d+)?)?`;
    const pathRe = new RegExp(String.raw`(?:file:\/\/)?(?:~|\.{1,2})?(?:\/[\w.@+\-%]+)+${SUFFIX}|[\w.@+\-]+(?:\/[\w.@+\-]+)+${SUFFIX}|[\w@+\-][\w.@+\-]*\.[A-Za-z]\w{0,7}${SUFFIX}`, 'g');
    const candidates: { range: any; raw: string; path: string; line?: number; col?: number }[] = [];
    while ((m = pathRe.exec(text)) && candidates.length < 12) {
      if (/^https?:?$/.test(m[0]) || text.slice(Math.max(0, m.index - 3), m.index).includes('://') && !m[0].startsWith('file:')) continue;
      const range = onRow(m.index, m[0].length);
      if (!range) continue;
      const t = fileTarget(m[0], cwd);
      if (t) candidates.push({ range, raw: m[0], ...t });
    }
    const stats = await Promise.all(candidates.map((c) => api.fs.stat(c.path)));
    candidates.forEach((c, i) => {
      if (!stats[i].exists || stats[i].dir) return;
      links.push({
        range: c.range, text: c.raw,
        activate: (ev: MouseEvent) => {
          if (ev.metaKey) useStore.getState().openFile(c.path, c.line ? { line: c.line, col: c.col } : undefined);
          else useStore.getState().showToast('Hold ⌘ and click to open the file');
        },
      });
    });
    return links.length ? links : undefined;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    window.clearInterval(this.tick);
    window.clearTimeout(this.settle);
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.uncarry();
    sessions.delete(this.id);
    api.pty.kill(this.id);
    this.term.dispose();
    this.host.remove();
  }
}
