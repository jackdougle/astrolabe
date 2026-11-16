import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { api, basename, tildify } from '../lib/api';
import { attachPaths, closeFileTab, formatKeys, handleShortcut, newFileBeside, pathsOf, pickAndAttach, runCommand, updateApp } from '../lib/commands';
import { areaRects, computeLayout, DividerRect, findSplit, keepLeaves, leafShares, LayoutNode, leaves } from '../lib/layout';
import { carry, docking } from '../lib/dock';
import { graphRoot, isGraph } from '../lib/graph';
import { fileIconName } from '../lib/fileIcons';
import { markBooted, reducedMotion, useEntering } from '../lib/motion';
import { monoFont, refreshFiles, setMonacoTheme } from '../lib/monaco';
import { richHooks } from '../lib/richMarkdown';
import { bus, focusPane, paneHandles } from '../lib/panes';
import { EditorPane as EditorPaneState, EDITORS, fileKey, focusedId, hiddenTerms, isMarkdown, liveEditors, openFiles, Pane, scrollSpeed, showing, shownTerms, Tab, tabGroups, TermPane, termLabel, useStore } from '../lib/store';
import { allSessions, getSession } from '../lib/termSession';
import { Landing, landing, onBlock, Over } from '../lib/movein';
import { canTear, TEAR_EDGE, tearSpec, Torn } from '../lib/tearoff';
import { getTheme } from '../lib/themes';
import { EditorPane } from './EditorPane';
import { Icon } from './Icons';
import { tip, Tooltip } from './Tooltip';
import { Palette } from './Palette';
import { Sidebar } from './Sidebar';
import { Starfield } from './Starfield';
import { TerminalPane } from './TerminalPane';

export function App() {
  const ready = useStore((s) => s.ready);
  const theme = useStore((s) => s.settings.theme);
  const zoom = useStore((s) => s.settings.zoom);
  const settings = useStore((s) => s.settings);
  const fullscreen = useStore((s) => s.fullscreen);
  const focused = useStore((s) => focusedId(s));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (!useStore.getState().palette) handleShortcut(e); };
    window.addEventListener('keydown', onKey, true);
    richHooks.attach = () => { pickAndAttach(); };
    // Dropping files on a pane attaches them there.
    const onDragOver = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); };
    const onDrop = (e: DragEvent) => {
      const files = [...(e.dataTransfer?.files ?? [])];
      if (!files.length) return;
      e.preventDefault();
      const paneEl = (e.target as HTMLElement).closest?.('.pane') as HTMLElement | null;
      const id = paneEl?.dataset.pane;
      if (id) useStore.getState().focusPane(id);
      void pathsOf(files).then((paths) => attachPaths(paths, id, { x: e.clientX, y: e.clientY }));
    };
    // Pasting files or a picture into a terminal attaches them the same way: to the command line, or to the
    // program running there (an agent takes an image's path as the image). A picture pasted into a note goes into
    // the note. Code keeps its own paste, and so does a note for everything else.
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])];
      if (!files.length) return;
      const id = ((e.target as HTMLElement).closest?.('.pane') as HTMLElement | null)?.dataset.pane;
      const pane = id ? useStore.getState().panes[id] : null;
      const intoNote = pane?.kind === 'editor' && !!pane.active && isMarkdown(pane.active) && !(e.target as HTMLElement).closest?.('.rich-title') && files.some((f) => f.type.startsWith('image/'));
      if (!id || !pane || (pane.kind !== 'terminal' && !intoNote)) return;
      // Copied text that comes with a picture of itself (a table, styled text) is still pasted as text.
      if (!files.some((f) => api.fs.pathOf(f)) && e.clipboardData?.getData('text/plain')) return;
      e.preventDefault(); e.stopPropagation();
      void pathsOf(files).then((paths) => attachPaths(paths, id));
    };
    window.addEventListener('paste', onPaste, true);
    // Notes and the navigator scroll natively; scale their wheel distance to match the terminals and the code editor.
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.defaultPrevented) return;
      const el = (e.target as HTMLElement).closest?.('.markdown, .tree-scroll') as HTMLElement | null;
      if (!el) return;
      const k = scrollSpeed() * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1);
      e.preventDefault();
      el.scrollTop += e.deltaY * k;
      el.scrollLeft += e.deltaX * k;
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    const offs = [
      api.app.onMenuCommand((cmd) => runCommand(cmd)),
      api.app.onFullscreen((on) => useStore.setState({ fullscreen: on })),
      api.app.onFocus((on) => { document.body.classList.toggle('is-blurred', !on); if (on) refreshFiles(); }),
      bus.on('theme.preview', (id?: string) => allSessions().forEach((s) => s.applyAppearance(id))),
    ];
    return () => { window.removeEventListener('paste', onPaste, true); window.removeEventListener('keydown', onKey, true); window.removeEventListener('wheel', onWheel); window.removeEventListener('dragover', onDragOver); window.removeEventListener('drop', onDrop); offs.forEach((off) => off()); };
  }, []);

  useEffect(() => { setMonacoTheme(getTheme(theme)); }, [theme]);
  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-size', `${settings.sidebarSize}px`);
    document.documentElement.style.setProperty('--notes-size', String(settings.notesSize));
  }, [settings.sidebarSize, settings.notesSize]);
  useEffect(() => { document.documentElement.style.setProperty('--zoom', String(zoom)); }, [zoom]);
  useEffect(() => {
    const r = document.documentElement.style;
    const clamp = (n: number, fallback: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0.15, n)) : fallback);
    r.setProperty('--alpha-focused', String(clamp(settings.opacityFocused, 0.9)));
    r.setProperty('--alpha-unfocused', String(clamp(settings.opacityUnfocused, 0.6)));
    r.setProperty('--chrome-alpha-focused', String(clamp(settings.chromeOpacityFocused, 1)));
    r.setProperty('--chrome-alpha-unfocused', String(clamp(settings.chromeOpacityUnfocused, 0.8)));
    r.setProperty('--mono', monoFont());
  }, [settings.opacityFocused, settings.opacityUnfocused, settings.chromeOpacityFocused, settings.chromeOpacityUnfocused, settings.fontFamily]);
  // Keyboard focus follows the pane that has it in the store.
  useEffect(() => { if (focused) focusPane(focused); }, [focused]);
  // Once the opening layout is on screen, new tabs and panes animate in.
  useEffect(() => { if (ready) { const t = window.setTimeout(markBooted, 300); return () => window.clearTimeout(t); } }, [ready]);

  if (!ready) return null;
  return (
    <div className={`app${fullscreen ? ' is-fullscreen' : ''}`}>
      {settings.starfield && <Starfield />}
      <TabStrip />
      <div className="app-body">
        <Sidebar />
        <div className="app-main">
          <Stack />
        </div>
      </div>
      <Palette />
      <Toast />
      <UpdateNotice />
      <Incoming />
      <DockPreview />
      <Tooltip />
    </div>
  );
}


// ---------- the row along the top ----------
// The row is cut where the window is: the stretch over the terminals holds the terminal tabs (⌘1–9), and the stretch
// over each editor holds that editor's open files (⌥⌘1–9, counted left to right). The two know nothing of each other:
// changing terminal tab leaves the files alone. A terminal tab is one block of a fixed length, divided into a segment
// for each terminal it is split into, so splitting a tab never makes its block longer.

/** The narrowest a stretch of the row may get, in px, however small the pane under it. */
const ZONE_MIN = 120;
interface Zone { key: string; kind: 'tabs' | 'files'; x0: number; x1: number; editors: string[] }

function TabStrip() {
  const tabs = useStore((s) => s.tabs);
  const panes = useStore((s) => s.panes);
  const activeTab = useStore((s) => s.activeTab);
  const editors = useStore((s) => s.editors);
  const focus = useStore((s) => s.focus);
  const ratio = useStore((s) => s.areas.ratio);
  const leaving = useStore((s) => s.leaving);
  const dirty = useStore((s) => s.dirty);
  const sidebar = useStore((s) => s.sidebar);
  const side = useStore((s) => s.settings.editorSide);
  const show = useStore((s) => showing(s));
  const ref = useRef<HTMLDivElement>(null);
  // The row's own place in the window, so its stretches can line up with the panes below.
  const [box, setBox] = useState<{ left: number; width: number; win: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const r = ref.current!.getBoundingClientRect();
      setBox((b) => (b && b.left === r.left && b.width === r.width && b.win === window.innerWidth ? b : { left: r.left, width: r.width, win: window.innerWidth }));
    };
    measure();
    const sizes = new ResizeObserver(measure);
    sizes.observe(ref.current!);
    window.addEventListener('resize', measure);
    return () => { sizes.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  const live = liveEditors({ panes, editors, leaving });
  const groups = tabGroups({ tabs, panes, leaving });
  const both = live.length > 0 && groups.length > 0;
  const placed = areaRects(both, ratio, side);
  const sideW = sidebar.visible ? sidebar.width : 0;
  // With one area above the other, both run the width of the window: the terminals' tabs keep to the start of the
  // row, with the room their blocks need, and the editors' files have the rest.
  const lead = !box ? 35 : Math.min(50, Math.max(18, (groups.length * 237 + 48) / Math.max(1, box.win - sideW) * 100));
  const spans = placed.cut?.dir === 'col' ? { term: { x: 0, w: lead }, editor: { x: lead, w: 100 - lead } } : { term: placed.term, editor: placed.editor };
  const zones: Zone[] = [];
  // The terminals' stretch is always there, so the button for a new terminal is too.
  zones.push({ key: 'tabs', kind: 'tabs', x0: both ? spans.term.x : 0, x1: both ? spans.term.x + spans.term.w : live.length ? 0 : 100, editors: [] });
  if (live.length && editors.root) {
    // One stretch for each editor along the top of the editor area; an editor below another shares the stretch above it.
    const shown = editors.maximized ? null : keepLeaves(editors.root, (id) => !leaving[id]);
    const rects = shown ? computeLayout(shown).panes : [{ pane: editors.active, rect: { x: 0, y: 0, w: 100, h: 100 } }];
    const across = (x: number) => spans.editor.x + x * spans.editor.w / 100;
    const cols: Zone[] = rects.filter((r) => r.rect.y < 0.01).sort((a, b) => a.rect.x - b.rect.x).map((r) => ({ key: r.pane, kind: 'files', x0: across(r.rect.x), x1: across(r.rect.x + r.rect.w), editors: [r.pane] }));
    for (const r of rects) {
      if (r.rect.y < 0.01) continue;
      const cx = across(r.rect.x + r.rect.w / 2);
      (cols.find((c) => cx >= c.x0 && cx <= c.x1) ?? cols[cols.length - 1])?.editors.push(r.pane);
    }
    zones.push(...cols);
  }
  zones.sort((a, b) => a.x0 - b.x0);
  // In px along the row: the first stretch starts at the row's start and the last runs to its end, wherever the panes begin and end.
  const edges = box ? zones.map((z, i) => (i === 0 ? 0 : Math.min(box.width, Math.max(0, sideW + z.x0 / 100 * (box.win - sideW) - box.left)))) : [];
  if (box) {
    edges.push(box.width);
    for (let i = 1; i < zones.length; i++) edges[i] = Math.max(edges[i], edges[i - 1] + ZONE_MIN);
    for (let i = zones.length - 1; i >= 1; i--) edges[i] = Math.min(edges[i], edges[i + 1] - ZONE_MIN);
  }
  const files = openFiles({ panes, editors, leaving });
  const sidebarOpen = useStore((s) => s.sidebar.visible);
  const termsOnScreen = show !== 'editor';
  const editorsOnScreen = show !== 'terminal';

  // Right-click on the row itself (not on a tab, which has a menu of its own): something new for the area under the
  // click. Over the terminals that is a terminal, over an editor a note or another editor. An area that is not open
  // yet can be opened from the other's menu.
  const onMenu = async (e: React.MouseEvent) => {
    if (e.defaultPrevented) return;
    e.preventDefault();
    if (!api.app.menu || !ref.current) return;
    const x = e.clientX;
    const away = (z: HTMLElement) => { const r = z.getBoundingClientRect(); return x < r.left ? r.left - x : x > r.right ? x - r.right : 0; };
    const zone = [...ref.current.querySelectorAll<HTMLElement>(':scope > .zone')].sort((a, b) => away(a) - away(b))[0];
    if (!zone) return;
    const over = zone.classList.contains('is-files') ? 'editor' : 'terminal';
    const at = useStore.getState();
    const noEditors = !liveEditors(at).length;
    const noTerms = !tabGroups(at).length;
    const pick = await api.app.menu(over === 'terminal' ? [
      { id: 'tab', label: 'New Terminal Tab' },
      { id: 'right', label: 'New Terminal on the Right', enabled: !noTerms },
      { id: 'down', label: 'New Terminal Below', enabled: !noTerms },
      ...(noEditors ? [null, { id: 'editor', label: 'New Editor' }] : []),
    ] : [
      { id: 'note', label: 'New Note' },
      { id: 'editorRight', label: 'New Editor on the Right' },
      { id: 'editorDown', label: 'New Editor Below' },
      ...(noTerms ? [null, { id: 'tab', label: 'New Terminal' }] : []),
    ]);
    if (!pick) return;
    const st = useStore.getState();
    const pane = zone.dataset.pane;
    if (pick === 'tab') st.newTab(st.termCwd ?? undefined);
    else if (pick === 'right' || pick === 'down') { st.focusArea('terminal'); useStore.getState().split(pick === 'right' ? 'row' : 'col'); }
    else if (pick === 'editor') st.newEditor('right');
    else if (pick === 'editorRight' || pick === 'editorDown') st.newEditor(pick === 'editorRight' ? 'right' : 'bottom', pane);
    else if (pick === 'note') { if (pane) st.focusPane(pane); await runCommand('note.newInRepo'); return; }
    focusFront();
  };
  return (
    <header className="topbar is-open" onContextMenu={onMenu}>
      {/* The navigator's button: always here, between the window's own buttons and the first tab, level with them,
          whether the navigator is open or closed. */}
      <button className={`top-btn side-open${sidebarOpen ? ' is-on' : ''}`} {...tip('Toggle sidebar', 'sidebar.toggle')} onClick={() => runCommand('sidebar.toggle')}><Icon name="sidebar" size={15} /></button>
      <div className="top-tabs" ref={ref}>
        {zones.map((z, i) => (
          <div key={z.key} className={`zone is-${z.kind}${i > 0 ? ' is-next' : ''}`} data-pane={z.kind === 'files' ? z.key : undefined}
            style={box ? { left: edges[i], width: Math.max(0, edges[i + 1] - edges[i]) } : { left: `${z.x0}%`, width: `${z.x1 - z.x0}%` }}>
            {z.kind === 'tabs' ? (
              <TabRow tabs={tabs} panes={panes} leaving={leaving} activeTab={activeTab} focused={focus === 'terminal'} onScreen={termsOnScreen} />
            ) : z.editors.map((id) => {
              const p = panes[id];
              return p?.kind === 'editor' ? <FileRow key={id} pane={p} leaving={leaving} dirty={dirty} files={files} focused={focus === 'editor' && editors.active === id} onScreen={editorsOnScreen} /> : null;
            })}
          </div>
        ))}
      </div>
      <div className="top-actions">
        <ViewTools />
        <button className="top-btn" {...tip('Open file by name', 'palette.files')} onClick={() => runCommand('palette.files')}><Icon name="search" size={15} /></button>
        <button className="top-btn" {...tip('Split right', 'pane.splitRight')} onClick={() => runCommand('pane.splitRight')}><Icon name="splitRight" size={15} /></button>
        <button className="top-btn" {...tip('Split down', 'pane.splitDown')} onClick={() => runCommand('pane.splitDown')}><Icon name="splitDown" size={15} /></button>
        <button className="top-btn" {...tip('Command palette', 'palette.commands')} onClick={() => runCommand('palette.commands')}><Icon name="command" size={15} /></button>
      </div>
    </header>
  );
}

/** Puts the keyboard in the pane that has it in the store. */
const focusFront = () => { const id = focusedId(); if (id) focusPane(id); };
/** A terminal taken off screen with ⌘U. It stays where it is in its tab, running, and is left out of what is drawn. */
const isOff = (p: Pane | undefined) => p?.kind === 'terminal' && !!p.hidden;

/** When the children of a row change places, each slides from where it was to where it now is. */
function useFlip(ref: React.RefObject<HTMLElement | null>) {
  const last = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const row = ref.current;
    if (!row) return;
    const nodes = [...row.querySelectorAll<HTMLElement>(':scope > [data-flip]')];
    const now = new Map(nodes.map((n) => [n.dataset.flip!, n.offsetLeft]));
    const was = last.current;
    last.current = now;
    // Only a change of order: things arriving, leaving and resizing have motion of their own.
    if (reducedMotion() || was.size !== now.size || [...now.keys()].join('\n') === [...was.keys()].join('\n') || ![...now.keys()].every((k) => was.has(k))) return;
    for (const n of nodes) {
      if (n.classList.contains('is-dragging')) continue;
      // From where it is drawn now, which is mid-slide if it was already moving.
      const moving = new DOMMatrix(getComputedStyle(n).transform).m41;
      const d = was.get(n.dataset.flip!)! - now.get(n.dataset.flip!)! + moving;
      n.getAnimations().filter((a) => a.id === 'flip').forEach((a) => a.cancel());
      if (Math.abs(d) > 0.5) n.animate([{ transform: `translateX(${d}px)` }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', id: 'flip' });
    }
  });
}

interface DragOpts {
  /** Puts the dragged tab where the tab `onto` is. The row must have changed by the time this returns. */
  reorder(key: string, onto: string): void;
  /** For a tab that can be taken out of its row: where it is while outside, that it came back, and where it was let go. */
  away?: {
    over(x: number, y: number): void; back(): void;
    /** Let go out there. False: it went nowhere. */
    drop(x: number, y: number): boolean | void;
    /** It is out only once it is below the row, not past the ends of its stretch. */ below?: boolean;
    /** While out, the tab waits in its place in the row: what was taken from it is shown some other way. */ stay?: boolean;
    /** Once out, it stays out, over the row too. */ sticky?: boolean;
  };
  /** For a tab that can leave the window: let go outside it, the tab becomes a window of its own there (tearoff.ts). */
  tear?: Torn;
  /** For a tab that can be combined with another of its row: let go on the middle of that one, it joins it. */
  onto?(key: string): void;
  /** The tab was only clicked, or let go in its own row or somewhere it could not go: what a click on it does. */
  click?(): void;
}
/** Drags a tab of the row by hand: it stays under the pointer, and the tabs it passes slide out of its way as it goes. */
function dragTab(e: React.MouseEvent<HTMLElement>, opts: DragOpts) {
  if (e.button !== 0 || e.ctrlKey) return;
  const el = e.currentTarget;
  const row = el.parentElement!;
  const start = { x: e.clientX, y: e.clientY };
  let grab = { x: 0, y: 0 };
  let on = false;
  let out = false;
  let lifted = false;
  // Past the window's edge: the tab waits in its place in the row, and an outline out there shows the window it would become.
  let torn = false;
  const tears = !!opts.tear && canTear();
  const tearNow = () => { const r = row.getBoundingClientRect(); return tearSpec(opts.tear!, at, grab, { x: r.left + el.offsetLeft, y: r.top + el.offsetTop, w: el.offsetWidth, h: el.offsetHeight }); };
  let at = start;
  // The tab it is over the middle of, and would join if let go.
  let onto: HTMLElement | null = null;
  const aim = (n: HTMLElement | null) => {
    if (n === onto) return;
    onto?.classList.remove('is-target');
    onto = n;
    n?.classList.add('is-target');
    el.classList.toggle('is-joining', !!n);
  };
  // Its own place in the row is worked out afresh each time, since the row changes under it.
  const place = (x: number, y: number) => {
    el.style.transform = '';
    const r = el.getBoundingClientRect();
    el.style.transform = `translate(${x - grab.x - r.left}px, ${out ? y - grab.y - r.top : 0}px)`;
    return r;
  };
  const move = (ev: MouseEvent) => {
    at = { x: ev.clientX, y: ev.clientY };
    if (!on) {
      if (Math.hypot(at.x - start.x, at.y - start.y) < 5) return;
      on = true;
      const r = el.getBoundingClientRect();
      grab = { x: start.x - r.left, y: start.y - r.top };
      el.style.transition = 'none';
      el.classList.add('is-dragging');
      document.body.classList.add('is-dragging-tab');
    }
    if (tears && (at.x < -TEAR_EDGE || at.y < -TEAR_EDGE || at.x > window.innerWidth + TEAR_EDGE || at.y > window.innerHeight + TEAR_EDGE)) {
      if (!torn) {
        torn = true;
        aim(null);
        if (out) { out = false; opts.away!.back(); }
        el.classList.remove('is-away');
        el.classList.add('is-torn');
        el.style.transition = reducedMotion() ? 'none' : 'transform 0.18s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.18s';
        el.style.transform = '';
      }
      api.app.tearOver(tearNow());
      return;
    }
    if (torn) { torn = false; el.classList.remove('is-torn'); el.style.transition = 'none'; api.app.tearOver(null); }
    const bar = row.closest('.topbar')!.getBoundingClientRect();
    const zone = (row.closest('.zone') ?? row).getBoundingClientRect();
    const wasOut = out;
    out = !!opts.away && (lifted || at.y > bar.bottom + 4 || (!opts.away.below && (at.x < zone.left - 12 || at.x > zone.right + 12)));
    if (out && opts.away!.sticky) lifted = true;
    el.classList.toggle('is-away', out);
    if (out && opts.away!.stay) {
      if (!wasOut) { aim(null); el.style.transition = reducedMotion() ? 'none' : 'transform 0.18s cubic-bezier(0.2, 0.8, 0.2, 1)'; el.style.transform = ''; }
      opts.away!.over(at.x, at.y);
      return;
    }
    if (wasOut && opts.away!.stay) el.style.transition = 'none';
    const r = place(at.x, at.y);
    if (out) { opts.away!.over(at.x, at.y); return; }
    if (wasOut) opts.away!.back();
    // It takes the place of whichever tab its middle has passed.
    const all = [...row.querySelectorAll<HTMLElement>(':scope > [data-flip]')].filter((n) => !n.classList.contains('is-leaving'));
    const left = row.getBoundingClientRect().left;
    const mid = at.x - grab.x + r.width / 2;
    let to = 0;
    if (opts.onto) {
      // The pointer decides. On the middle half of another tab, this one would join it; a tab gives up its place
      // only once the pointer is past that middle, so there is room to stop on it.
      const me = all.indexOf(el);
      const span = (n: HTMLElement) => ({ left: left + n.offsetLeft, width: n.offsetWidth });
      const hit = at.y <= bar.bottom + 24 ? all.find((n) => n !== el && at.x >= span(n).left && at.x <= span(n).left + n.offsetWidth && onBlock(at.x, span(n))) : undefined;
      aim(hit ?? null);
      if (hit) return;
      all.forEach((n, i) => { if (n !== el && span(n).left + n.offsetWidth * (i < me ? 0.25 : 0.75) < at.x) to++; });
    } else for (const n of all) if (n !== el && left + n.offsetLeft + n.offsetWidth / 2 < mid) to++;
    if (to !== all.indexOf(el) && all[to]) { flushSync(() => opts.reorder(el.dataset.flip!, all[to].dataset.flip!)); place(at.x, at.y); }
  };
  const end = (dropped: boolean) => {
    window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); window.removeEventListener('keydown', key, true);
    if (!on) { if (dropped) opts.click?.(); return; }
    document.body.classList.remove('is-dragging-tab');
    const join = dropped && !torn ? onto?.dataset.flip : undefined;
    aim(null);
    let went = !!join || torn;
    if (join) opts.onto!(join);
    if (torn) api.app.tearDrop(dropped ? tearNow() : null);
    else if (out) { if (dropped) went = opts.away!.drop(at.x, at.y) !== false; else opts.away!.back(); }
    if (dropped && !went) opts.click?.();
    // It settles into its place.
    el.style.transition = reducedMotion() ? 'none' : 'transform 0.18s cubic-bezier(0.2, 0.8, 0.2, 1)';
    el.style.transform = '';
    el.classList.remove('is-away', 'is-torn');
    window.setTimeout(() => { el.style.transition = ''; el.classList.remove('is-dragging'); }, 190);
    focusFront();
  };
  const up = () => end(true);
  const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); end(false); } };
  window.addEventListener('mousemove', move); window.addEventListener('mouseup', up); window.addEventListener('keydown', key, true);
}

/** The terminal tabs, each one block, and the button for a new one. */
function TabRow({ tabs, panes, leaving, activeTab, focused, onScreen }: { tabs: Tab[]; panes: Record<string, Pane>; leaving: Record<string, unknown>; activeTab: string; /** The terminals have the keyboard. */ focused: boolean; onScreen: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useFlip(ref);
  let n = 0;
  return (
    <>
      <div className="tab-row" ref={ref}>
        {tabs.map((t) => {
          // A hidden terminal has no segment (one still fading out keeps its own until it has), and a tab with every
          // terminal hidden is out of the row until one is brought back.
          const ids = leaves(t.root).filter((id) => !!leaving[id] || !isOff(panes[id]));
          if (!ids.length) return null;
          const live = !leaving[t.id] && ids.some((id) => !leaving[id]);
          return <TabBlock key={t.id} tab={t} ids={ids} panes={panes} leaving={leaving} n={live ? n++ : -1} front={t.id === activeTab} focused={focused} onScreen={onScreen} />;
        })}
      </div>
      <button className="top-btn" {...tip('New terminal tab', 'tab.new')} onClick={() => runCommand('tab.new')}><Icon name="plus" size={14} /></button>
    </>
  );
}

/** One terminal tab's block: a segment for each of its terminals, then the number that brings it to the front. */
function TabBlock({ tab, ids, panes, leaving, n, front, focused, onScreen }: { tab: Tab; /** Its terminals that are not hidden. */ ids: string[]; panes: Record<string, Pane>; leaving: Record<string, unknown>; n: number; front: boolean; focused: boolean; onScreen: boolean }) {
  const [entering, entered] = useEntering();
  const ref = useRef<HTMLDivElement>(null);
  useFlip(ref);
  const gone = !!leaving[tab.id] || ids.every((id) => leaving[id]);
  const flagged = tab.finished ? (tab.finishedPane && ids.includes(tab.finishedPane) ? tab.finishedPane : ids[0]) : undefined;
  const reorder = (key: string, onto: string) => { const st = useStore.getState(); st.moveTab(st.tabs.findIndex((t) => t.id === key), st.tabs.findIndex((t) => t.id === onto)); };
  // Let go on another tab, this one joins it, and the terminal that was taken hold of keeps the keyboard.
  const onto = (key: string) => useStore.getState().joinTab(tab.id, key, { take: true });
  // Right-click: combine it with the tab in front, or give the terminal clicked a tab of its own.
  const onMenu = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (gone || !api.app.tabMenu) return;
    const seg = (e.target as HTMLElement).closest<HTMLElement>('.toptab')?.dataset.flip;
    const s = useStore.getState();
    const pick = await api.app.tabMenu({ join: s.activeTab !== tab.id && tabGroups(s).some((t) => t.id === s.activeTab), part: shownTerms(s, tab).length > 1 });
    const st = useStore.getState();
    if (pick === 'join') st.joinTab(tab.id, st.activeTab);
    else if (pick === 'part') st.moveTerm(seg && shownTerms(st, tab).includes(seg) ? seg : tab.activePane, null);
    else if (pick === 'close') st.closeTab(tab.id);
    if (pick) focusFront();
  };
  // Along the row the whole block moves. Carried below the row, the terminal whose own stretch of the block was taken
  // hold of goes alone, to wherever among the panes it is let go (dock.ts), and the block waits in its place.
  const down = (e: React.MouseEvent<HTMLElement>) => {
    if (gone || e.button !== 0 || e.ctrlKey) return;
    const seg = (e.target as HTMLElement).closest<HTMLElement>('.toptab')?.dataset.flip;
    const pane = seg && ids.includes(seg) && !leaving[seg] ? seg : tab.activePane;
    let held: ReturnType<typeof carry> | null = null;
    // A tab behind the one on show comes to the front when it is let go, not when it is taken hold of, so that one of
    // its terminals can be carried in among the terminals on show.
    const toFront = () => { useStore.getState().focusPane(pane); focusFront(); };
    if (front) toFront();
    dragTab(e, { reorder, onto, tear: { kind: 'tab', id: tab.id }, click: front ? undefined : toFront, away: {
      below: true, stay: true, sticky: ids.length > 1,
      over: (x, y) => { held ??= carry({ kind: 'term', pane }, { chip: true, row: true }); held.over(x, y); },
      back: () => { held?.cancel(); held = null; },
      drop: (x, y) => { held?.over(x, y); const went = !!held?.drop(); held = null; return went; },
    } });
  };
  return (
    <div ref={ref} className={`tab-group${front ? ' is-front' : ''}${ids.length > 3 ? ' is-dense' : ''}${entering ? ' is-entering' : ''}${gone ? ' is-leaving' : ''}`} data-tab={tab.id} data-flip={tab.id}
      onAnimationEnd={entered} onContextMenu={onMenu} onMouseDown={down}>
      {ids.map((id) => {
        const p = panes[id];
        if (p?.kind !== 'terminal') return null;
        // What has the keyboard gets the most room; a terminal hidden behind a maximized one, the least.
        const up = !tab.maximized || id === tab.activePane;
        const mine = id === tab.activePane;
        return <TermSeg key={id} pane={p} weight={mine ? 3 : up ? 2 : 1} active={front && focused && mine} shown={front && onScreen && up && !(focused && mine)}
          leaving={!!leaving[id] || !!leaving[tab.id]} finished={flagged === id ? tab.finished ?? null : null} />;
      })}
      {n >= 0 && n < 9 && !gone && <span className="tab-num" data-key={`⌘${n + 1}`} onMouseDown={(e) => { if (e.button === 0) { useStore.getState().setActiveTab(tab.id); focusFront(); } }} />}
    </div>
  );
}

interface SegProps {
  /** Its share of the block's length, against the other segments'. */ weight: number;
  /** It has the keyboard. */ active: boolean; /** It is on screen, without the keyboard. */ shown: boolean; leaving: boolean;
}
const segClass = (p: SegProps, entering: boolean) => `${p.active ? ' is-active' : ''}${p.shown ? ' is-shown' : ''}${entering ? ' is-entering' : ''}${p.leaving ? ' is-leaving' : ''}`;

/** A terminal, named for the project folder and the running program. When there is not room for both, the program stays. */
function TermSeg(props: SegProps & { pane: TermPane; finished: 'ok' | 'failed' | null }) {
  const { pane: p, finished, active, weight } = props;
  const [entering, entered] = useEntering();
  const l = termLabel(p);
  const running = p.running && !p.waiting;
  const failed = !p.running && !!p.lastExit;
  const close = () => { useStore.getState().closePane(p.id); focusFront(); };
  const lifted = useDocking()?.pane === p.id;
  return (
    <div className={`toptab${lifted ? ' is-lifted' : ''}${running ? ' is-running' : ''}${finished ? ` is-finished is-${finished}` : ''}${segClass(props, entering)}`} style={{ flexGrow: weight }} title={`${l.dir} ${l.app}`} data-flip={p.id}
      onAnimationEnd={entered}
      onAuxClick={(e) => { if (e.button === 1) close(); }}>
      <span className={`tab-mark${running ? ' is-running' : finished === 'ok' ? ' is-ok' : failed || finished === 'failed' ? ' is-failed' : ''}`} />
      <span className="toptab-text is-path"><span className="top-dir">{l.dir ? `${l.dir} ` : ''}</span><span className="top-app">{l.app}</span></span>
      <button className="toptab-close" {...tip('Close terminal', active ? 'pane.close' : undefined)} onMouseDown={(e) => e.stopPropagation()} onClick={close}><Icon name="x" size={11} /></button>
    </div>
  );
}

/** One editor's open files, over that editor. */
function FileRow({ pane, leaving, dirty, files, focused, onScreen }: { pane: EditorPaneState; leaving: Record<string, unknown>; dirty: Record<string, boolean>; /** Every open file in the order ⌥⌘1–9 count them. */ files: { pane: string; path: string }[]; focused: boolean; onScreen: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useFlip(ref);
  return (
    <div className="file-row" ref={ref} data-pane={pane.id}>
      {pane.files.map((f) => {
        const k = files.findIndex((x) => x.pane === pane.id && x.path === f.path);
        const up = pane.active === f.path;
        return <FileTab key={f.path} pane={pane.id} path={f.path} temp={!!f.temp} dirty={!!dirty[f.path]} hint={k >= 0 && k < 9 ? `⌥⌘${k + 1}` : undefined}
          active={focused && up} shown={onScreen && up && !focused} leaving={!!leaving[fileKey(pane.id, f.path)] || !!leaving[pane.id]} />;
      })}
    </div>
  );
}

/** An open file. Right-click for a new file beside it. Dragged along its row it changes places; dragged onto another
 *  editor's row it joins that editor; dragged down among the panes it gets an editor of its own where the outline
 *  shows; dragged out of the window it becomes a window of its own. */
function FileTab({ pane, path, temp, dirty, hint, active, shown, leaving }: { pane: string; path: string; /** A temporary tab: the next file opened takes its place. A double click keeps it. */ temp: boolean; dirty: boolean; /** The keys that bring it to the front. */ hint?: string; active: boolean; shown: boolean; leaving: boolean }) {
  const [entering, entered] = useEntering();
  const close = () => closeFileTab(pane, path);
  // A code file shows its language's mark, a little larger than the page a note shows.
  const icon = isGraph(path) ? 'graph' : fileIconName(path);
  const lang = icon !== 'graph' && icon !== 'file';
  const onMenu = async (e: React.MouseEvent) => {
    e.preventDefault();
    if ((await api.fs.headerMenu()) === 'newFile') newFileBeside(path);
  };
  // The other editor's stretch of the row under a point, if any.
  const rowAt = (x: number, y: number) => (document.elementsFromPoint(x, y).map((n) => n.closest<HTMLElement>('.zone.is-files')).find((z) => z && !z.querySelector(`.file-row[data-pane="${pane}"]`)) ?? null);
  const mark = (zone: HTMLElement | null) => document.querySelectorAll('.zone.is-target').forEach((z) => { if (z !== zone) z.classList.remove('is-target'); });
  const down = (e: React.MouseEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const st = useStore.getState();
    st.activateFile(pane, path); st.focusPane(pane); focusFront();
    if (leaving) return;
    // Over another editor's stretch of the row it would join that editor; anywhere below, it goes where the outline shows (dock.ts).
    let held: ReturnType<typeof carry> | null = null;
    const letGo = () => { held?.cancel(); held = null; };
    dragTab(e, {
      tear: { kind: 'file', pane, path },
      reorder: (key, onto) => useStore.getState().moveFile(pane, key, onto),
      away: {
        over: (x, y) => {
          const zone = rowAt(x, y);
          mark(zone); zone?.classList.add('is-target');
          if (zone) letGo(); else { held ??= carry({ kind: 'file', pane, path }); held.over(x, y); }
        },
        back: () => { mark(null); letGo(); },
        drop: (x, y) => {
          const zone = rowAt(x, y);
          mark(null);
          if (zone?.dataset.pane) { letGo(); useStore.getState().placeFile(pane, path, zone.querySelector<HTMLElement>('.file-row')?.dataset.pane ?? zone.dataset.pane, 'into'); }
          else { held ??= carry({ kind: 'file', pane, path }); held.over(x, y); held.drop(); held = null; }
        },
      },
    });
  };
  return (
    <div className={`toptab filetab${temp ? ' is-temp' : ''}${active ? ' is-active' : ''}${shown ? ' is-shown' : ''}${entering ? ' is-entering' : ''}${leaving ? ' is-leaving' : ''}`} title={isGraph(path) ? `Graph of the notes in ${tildify(graphRoot(path))}` : tildify(path)} data-flip={path}
      onAnimationEnd={entered} onContextMenu={onMenu} onMouseDown={down} onDoubleClick={() => useStore.getState().keepFile(path, pane)}
      onAuxClick={(e) => { if (e.button === 1) close(); }}>
      {/* A file with unsaved changes has no mark of its own: its page glows and pulses, as a terminal's dot does while it works. */}
      <span className={`tab-file${lang ? ' is-lang' : ''}${dirty ? ' is-dirty' : ''}`} title={dirty ? 'Unsaved changes' : undefined}><Icon name={icon} size={lang ? 14 : 12} /></span>
      <span className="toptab-text"><span className="top-app filetab-name">{isGraph(path) ? 'Graph' : basename(path)}</span></span>
      {hint && <span className="toptab-key" data-key={hint} />}
      <button className={`toptab-close filetab-close${dirty ? ' is-dirty' : ''}`} {...tip(dirty ? 'Unsaved changes. Close without saving' : 'Close', active ? 'pane.close' : undefined)}
        onMouseDown={(e) => e.stopPropagation()} onClick={close}><Icon name="x" size={11} /></button>
    </div>
  );
}

/** A tab dragged out of another window is over this one: shows where it would land if let go (movein.ts). */
function Incoming() {
  const [over, setOver] = useState<Over | null>(null);
  useEffect(() => bus.on('tearhover', (o: Over | null) => setOver(o && Number.isFinite(o.x) && Number.isFinite(o.y) ? o : null)), []);
  // The window may be behind another and get no word that the tab has gone: a tab that stops moving for long is taken as gone.
  useEffect(() => { if (!over) return; const t = window.setTimeout(() => setOver(null), 15000); return () => window.clearTimeout(t); }, [over]);
  const land: Landing | null = over ? landing(over) : null;
  const block = land?.kind === 'join' && land.block ? land.tab : null;
  useEffect(() => {
    const el = block ? document.querySelector<HTMLElement>(`.tab-group[data-tab="${block}"]`) : null;
    el?.classList.add('is-target');
    return () => el?.classList.remove('is-target');
  }, [block]);
  if (!over || !land) return null;
  const box = land.kind === 'tab' ? null : land.kind === 'join' && land.block ? null : land.box;
  return (
    <div className="incoming">
      {box && <div className="incoming-box" style={box} />}
      {land.kind === 'tab' && land.bar && <div className="incoming-bar" style={land.bar} />}
      <div className="incoming-chip" style={{ left: Math.max(4, Math.min(over.x + 14, window.innerWidth - 250)), top: Math.max(4, Math.min(over.y + 16, window.innerHeight - 30)) }}>
        <Icon name={over.kind === 'file' ? 'file' : 'terminal'} size={12} /><span>{over.label || (over.kind === 'file' ? 'File' : 'Terminal')}</span>
      </div>
    </div>
  );
}

/** What is being carried about the window by hand, if anything (dock.ts). */
const useDocking = () => useSyncExternalStore(docking.subscribe, docking.get);

/** While a terminal, a file or an editor is carried: the outline of the place it would take if let go, and, for a
 *  thing whose own tab is not following the pointer, its name beside the pointer. No outline: it would stay put. */
function DockPreview() {
  const d = useDocking();
  if (!d || (!d.box && !d.chip)) return null;
  return (
    <div className="dock">
      {d.box && <div className="dock-box" style={d.box} />}
      {d.chip && (
        <div className={`incoming-chip${d.box ? '' : ' is-idle'}`} style={{ left: Math.max(4, Math.min(d.chip.x + 14, window.innerWidth - 250)), top: Math.max(4, Math.min(d.chip.y + 16, window.innerHeight - 30)) }}>
          <Icon name={d.chip.icon} size={12} /><span>{d.chip.label}</span>
        </div>
      )}
    </div>
  );
}

/** Controls for what is in front: a note rendered or raw, which side the editors are on, and one area or both. */
function ViewTools() {
  const panes = useStore((s) => s.panes);
  const editors = useStore((s) => s.editors);
  const focus = useStore((s) => s.focus);
  const show = useStore((s) => showing(s));
  const many = useStore((s) => liveEditors(s).length);
  const terms = useStore((s) => tabGroups(s).length);
  // With several editors, these act on the one used last.
  const editor = many ? panes[editors.active] : null;
  const file = editor?.kind === 'editor' && show !== 'terminal' ? editor.files.find((f) => f.path === editor.active) : null;
  const note = file && isMarkdown(file.path) ? file : null;
  const both = many > 0 && terms > 0;
  const eds = `editor${many > 1 ? 's' : ''}`;
  const label = show === 'both' ? (focus === 'editor' ? `Expand the ${eds}` : 'Expand the terminals')
    : !both ? (many ? `Open a terminal beside the ${eds}` : 'Open a page beside the terminals')
    : show === 'editor' ? 'Bring the terminals back' : `Bring the ${eds} back`;
  const setRendered = (on: boolean) => { if (note && note.rendered !== on) useStore.getState().toggleRendered(editor!.id, note.path); focusFront(); };
  return (
    <div className="view-tools">
      {note && (
        <div className="seg" role="group" aria-label="Markdown view">
          <button className={note.rendered ? 'is-on' : ''} {...tip('Rendered', 'editor.toggleRendered')} onClick={() => setRendered(true)}><Icon name="book" size={14} /></button>
          <button className={!note.rendered ? 'is-on' : ''} {...tip('Raw', 'editor.toggleRendered')} onClick={() => setRendered(false)}><Icon name="code" size={14} /></button>
        </div>
      )}
      {show === 'both' && <button className="top-btn" {...tip('Switch displays', 'editor.swapSide')} onClick={() => runCommand('editor.swapSide')}><Icon name="swap" size={15} /></button>}
      <button className="top-btn view-graph" {...tip('Graph of notes', 'graph.open')} onClick={() => runCommand('graph.open')}><Icon name="graph" size={15} /></button>
      <button className="top-btn view-full" {...tip(label, 'editor.expand')} onClick={() => runCommand('editor.expand')}><Icon name={show === 'both' ? 'expand' : 'collapse'} size={15} /></button>
    </div>
  );
}

// ---------- the panes ----------
/** The window below the row: the terminal tabs' area and the editors' area, side by side or one above the other when both are open. */
function Stack() {
  const tabs = useStore((s) => s.tabs);
  const activeTab = useStore((s) => s.activeTab);
  const editors = useStore((s) => s.editors);
  const focus = useStore((s) => s.focus);
  const ratio = useStore((s) => s.areas.ratio);
  const side = useStore((s) => s.settings.editorSide);
  const show = useStore((s) => showing(s));
  const liveEds = useStore((s) => liveEditors(s).length);
  const liveTabs = useStore((s) => tabGroups(s).length);
  const ref = useRef<HTMLDivElement>(null);
  // An area that is hidden, or fading out with the last thing in it, keeps the place it had beside the other.
  const spans = areaRects(!!editors.root && tabs.length > 0, ratio, side);
  const cut = spans.cut;
  const all = { x: 0, y: 0, w: 100, h: 100 };
  const term = show === 'terminal' ? all : spans.term;
  const editor = show === 'editor' ? all : spans.editor;
  const front = tabs.find((t) => t.id === activeTab);

  const drag = (e: React.MouseEvent) => {
    e.preventDefault();
    const box = ref.current!.getBoundingClientRect();
    // Each area can shrink until its narrowest pane shows two columns (or, one above the other, its shortest a single row).
    const row = cut?.dir !== 'col';
    const need = (root: LayoutNode | null | undefined) => (root ? Math.max(0, ...leafShares(root).map((l) => (row ? paneMin(l.pane).w / l.fw : paneMin(l.pane).h / l.fh))) / (row ? box.width : box.height) : 0);
    const lo = need(front?.root);
    const hi = 1 - need(editors.root);
    const move = (ev: MouseEvent) => {
      const f = row ? (ev.clientX - box.left) / box.width : (ev.clientY - box.top) / box.height;
      const share = side === 'left' || side === 'top' ? 1 - f : f;
      useStore.getState().setAreaRatio(lo <= hi ? Math.min(hi, Math.max(lo, share)) : 0.5);
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); document.body.classList.remove('is-resizing', 'is-resizing-col'); };
    document.body.classList.add('is-resizing');
    if (!row) document.body.classList.add('is-resizing-col');
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };

  return (
    <div className="stack" ref={ref}>
      <div className={`area is-terminals${show === 'editor' && liveTabs ? ' is-hidden' : ''}${liveTabs ? '' : ' is-going'}`} style={{ left: `${term.x}%`, top: `${term.y}%`, width: `${term.w}%`, height: `${term.h}%` }}>
        {tabs.map((t) => <PaneTree key={t.id} id={t.id} root={t.root} activePane={t.activePane} maximized={t.maximized} active={t.id === activeTab} focused={focus === 'terminal' && t.id === activeTab} />)}
      </div>
      {editors.root && (
        <div className={`area is-editors${show === 'terminal' && liveEds ? ' is-hidden' : ''}${liveEds ? '' : ' is-going'}`} style={{ left: `${editor.x}%`, top: `${editor.y}%`, width: `${editor.w}%`, height: `${editor.h}%` }}>
          <PaneTree id={EDITORS} root={editors.root} activePane={editors.active} maximized={editors.maximized} active focused={focus === 'editor'} />
        </div>
      )}
      {show === 'both' && cut && <div className={`divider is-${cut.dir} area-divider`} style={cut.dir === 'row' ? { left: `${cut.at}%`, height: '100%' } : { top: `${cut.at}%`, width: '100%' }} onMouseDown={drag} onDoubleClick={() => useStore.getState().setAreaRatio(0.5)} />}
      <HiddenTerms right={show !== 'editor' && liveTabs ? 100 - term.x - term.w : null} bottom={show !== 'editor' && liveTabs ? 100 - term.y - term.h : 0} />
    </div>
  );
}

/** Which way a new pane slides in from: the far side of the split it was added to. */
function enterOffset(node: LayoutNode, id: string): React.CSSProperties | undefined {
  if (node.type === 'leaf') return undefined;
  if (node.b.type === 'leaf' && node.b.pane === id) return { [node.dir === 'row' ? '--in-x' : '--in-y']: node.dir === 'row' ? '14px' : '12px' } as React.CSSProperties;
  return enterOffset(node.a, id) ?? enterOffset(node.b, id);
}

/** One arrangement of panes: a terminal tab's terminals, or the editors (`id` is EDITORS). */
function PaneTree({ id: tree, root, activePane, maximized, active, focused }: { id: string; root: LayoutNode; activePane: string; maximized: boolean; /** It is the one its area shows. */ active: boolean; /** Its area has the keyboard. */ focused: boolean }) {
  const panes = useStore((s) => s.panes);
  const leaving = useStore((s) => s.leaving);
  const [entering, entered] = useEntering();
  const ref = useRef<HTMLDivElement>(null);
  // Panes that are fading out keep their place; the rest are laid out as if they were already gone, so they glide into the space.
  const full = useMemo(() => computeLayout(root), [root]);
  // Hidden terminals are laid out around in the same way, for as long as they are hidden.
  const off = leaves(root).filter((id) => isOff(panes[id])).join('\n');
  const liveRoot = useMemo(() => { const out = new Set(off.split('\n')); return keepLeaves(root, (id) => !leaving[id] && !out.has(id)) ?? root; }, [root, leaving, off]);
  const { panes: rects, dividers } = useMemo(() => computeLayout(liveRoot), [liveRoot]);
  const ids = useMemo(() => leaves(root).slice().sort(), [root]);
  const carried = useDocking()?.pane;
  const split = rects.length > 1;
  const rectOf = (id: string) => (rects.find((r) => r.pane === id) ?? full.panes.find((r) => r.pane === id))!.rect;

  // A pane is also moved by the bar at its top edge: it goes where the outline shows (dock.ts), and a terminal
  // carried up to the row joins the tab it lands on, or gets a tab of its own beside the tabs.
  const grab = (id: string) => (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const from = { x: e.clientX, y: e.clientY };
    let held: ReturnType<typeof carry> | null = null;
    const move = (ev: MouseEvent) => {
      if (!held) {
        if (Math.hypot(ev.clientX - from.x, ev.clientY - from.y) < 5) return;
        held = carry(tree === EDITORS ? { kind: 'editor', pane: id } : { kind: 'term', pane: id }, { chip: true, row: true });
        document.body.classList.add('is-moving-pane');
      }
      held.over(ev.clientX, ev.clientY);
    };
    const end = (place: boolean) => {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); window.removeEventListener('keydown', key, true);
      document.body.classList.remove('is-moving-pane');
      if (place) held?.drop(); else held?.cancel();
      focusFront();
    };
    const up = () => end(true);
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); end(false); } };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up); window.addEventListener('keydown', key, true);
  };

  const drag = (d: DividerRect) => (e: React.MouseEvent) => {
    e.preventDefault();
    const box = ref.current!.getBoundingClientRect();
    const node = findSplit(liveRoot, d.id);
    if (!node) return;
    // A pane can shrink until it shows a single terminal row (or two columns), whatever is nested beside it.
    const row = d.dir === 'row';
    const span = (row ? d.region.w / 100 * box.width : d.region.h / 100 * box.height) || 1;
    const need = (side: LayoutNode) => Math.max(0, ...leafShares(side).map((l) => {
      const m = paneMin(l.pane);
      return (row ? m.w : m.h) / (span * (row ? l.fw : l.fh));
    }));
    const lo = need(node.a);
    const hi = 1 - need(node.b);
    const move = (ev: MouseEvent) => {
      const ratio = row
        ? ((ev.clientX - box.left) / box.width * 100 - d.region.x) / d.region.w
        : ((ev.clientY - box.top) / box.height * 100 - d.region.y) / d.region.h;
      useStore.getState().setRatio(tree, d.id, lo <= hi ? Math.min(hi, Math.max(lo, ratio)) : (lo + hi) / 2);
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); document.body.classList.remove('is-resizing', 'is-resizing-col'); };
    document.body.classList.add('is-resizing');
    if (d.dir === 'col') document.body.classList.add('is-resizing-col');
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };

  return (
    <div className={`tab-area${active ? ' is-active' : ''}${entering ? ' is-entering' : ''}${leaving[tree] === 'shown' ? ' is-leaving' : ''}`} data-tab={tree} ref={ref} onAnimationEnd={entered}>
      {ids.map((id) => {
        const pane = panes[id];
        if (!pane) return null;
        const gone = !!leaving[id];
        const r = maximized && !gone ? { x: 0, y: 0, w: 100, h: 100 } : rectOf(id);
        const away = isOff(pane);
        const hidden = !gone && (away || (maximized && id !== activePane));
        const isActive = active && focused && id === activePane;
        return (
          <PaneBox key={id} id={id} isActive={isActive} split={split} leaving={gone} away={away} offset={enterOffset(root, id)}
            moving={carried === id} onGrab={split && !maximized && !gone ? grab(id) : undefined}
            style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%`, visibility: hidden ? 'hidden' : undefined }}>
            {pane.kind === 'terminal' ? <TerminalPane pane={pane} active={isActive || !split} /> : <EditorPane pane={pane} active={isActive || !split} />}
          </PaneBox>
        );
      })}
      {!maximized && dividers.map((d) => (
        <div key={d.id} className={`divider is-${d.dir}`} style={{ left: `${d.rect.x}%`, top: `${d.rect.y}%`, width: d.dir === 'col' ? `${d.rect.w}%` : undefined, height: d.dir === 'row' ? `${d.rect.h}%` : undefined }}
          onMouseDown={drag(d)} onDoubleClick={() => useStore.getState().setRatio(tree, d.id, 0.5)} />
      ))}
    </div>
  );
}

/** The smallest a pane may be dragged: one terminal row, or one line of an editor. */
function paneMin(id: string) {
  const session = getSession(id);
  if (session) return session.minSize();
  return { w: 48, h: Math.ceil(useStore.getState().settings.fontSize * 1.55) + 43 };
}

function PaneBox({ id, isActive, split, leaving, away, moving, onGrab, offset, style, children }: {
  id: string; isActive: boolean; split: boolean; leaving: boolean; /** A hidden terminal. */ away: boolean; moving: boolean; onGrab?: (e: React.MouseEvent) => void;
  offset?: React.CSSProperties; style: React.CSSProperties; children: React.ReactNode;
}) {
  const [made, entered] = useEntering();
  // A hidden terminal brought back comes in as a new one does.
  const [back, setBack] = useState(false);
  const was = useRef(away);
  useLayoutEffect(() => { if (was.current && !away && !reducedMotion()) setBack(true); was.current = away; }, [away]);
  const entering = made || back;
  return (
    <div className={`pane${isActive ? ' is-active' : ''}${split ? ' is-split' : ''}${entering ? ' is-entering' : ''}${leaving ? ' is-leaving' : ''}${moving ? ' is-moving' : ''}`} data-pane={id}
      style={entering ? { ...style, ...offset } : style} onAnimationEnd={(e) => { entered(e); if (e.target === e.currentTarget) setBack(false); }}
      onMouseDownCapture={() => { if (!isActive) { useStore.getState().focusPane(id); requestAnimationFrame(() => paneHandles.get(id)?.focus()); } }}>
      {children}
      {onGrab && <div className="pane-grip" {...tip('Drag to move this pane')} onMouseDown={onGrab} />}
    </div>
  );
}

/** Where the typing caret is on screen, whatever holds the keyboard: a terminal (xterm keeps its hidden input at the
 *  cursor), the command input or raw editor (Monaco), a rendered note. Null when nothing is being typed into. */
function caretBox(): DOMRect | null {
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body) return null;
  if (el.classList.contains('xterm-helper-textarea')) return el.getBoundingClientRect();
  const drawn = el.closest('.monaco-editor')?.querySelector('.cursors-layer .cursor') ?? el.closest('.markdown')?.querySelector('.rich-caret');
  if (drawn) return drawn.getBoundingClientRect();
  const sel = window.getSelection();
  if (sel?.rangeCount && el.contains(sel.focusNode)) { const r = sel.getRangeAt(0).getBoundingClientRect(); if (r.width || r.height) return r; }
  return null;
}

/** The terminals taken off screen with ⌘U: a chip in the bottom right corner of the terminals, there while any are
 *  hidden, that opens the list of them. A click on one brings it back to its place; ⇧⌘U brings them all back.
 *  `right`: how far the terminals' right edge is from the window's, in percent; null while no terminal is on screen,
 *  when the chip waits in the bottom left corner instead, clear of the editor's own corner. */
function HiddenTerms({ right, bottom }: { right: number | null; /** How far the terminals' bottom edge is from the window's, in percent. */ bottom: number }) {
  const panes = useStore((s) => s.panes);
  const list = useMemo(() => hiddenTerms({ panes }), [panes]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!list.length) setOpen(false); }, [list.length]);
  // A click anywhere else, or Esc, puts the list away.
  useEffect(() => {
    if (!open) return;
    const press = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); focusFront(); } };
    window.addEventListener('mousedown', press, true); window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('mousedown', press, true); window.removeEventListener('keydown', key, true); };
  }, [open]);
  // Typing with the caret close by turns the chip to glass, so the words show through it; moving the pointer brings it back.
  const [clear, setClear] = useState(false);
  useEffect(() => {
    if (!list.length || open) { setClear(false); return; }
    let frame = 0;
    const look = () => {
      frame = 0;
      const chip = ref.current?.querySelector('.hidden-chip')?.getBoundingClientRect();
      const caret = caretBox();
      // A caret that cannot be found for a moment (it is redrawn as the keys go in) changes nothing.
      if (!chip || !caret) return;
      // Within a few words of it on the same lines, either side. Once it has turned to glass the caret has to go a
      // little further off before it comes back, so typing along the edge of that reach does not flick it to and fro.
      setClear((was) => { const far = was ? 50 : 0; return caret.right > chip.left - 90 - far && caret.left < chip.right + 40 + far && caret.bottom > chip.top - 26 - far / 2 && caret.top < chip.bottom + 26 + far / 2; });
    };
    // Looked at as the keys go in, and once more when they stop: the drawn caret glides, so it gets there a little late.
    let settle = 0;
    const key = (e: KeyboardEvent) => {
      if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return;
      if (!frame) frame = requestAnimationFrame(() => { frame = requestAnimationFrame(look); });
      window.clearTimeout(settle);
      settle = window.setTimeout(look, 220);
    };
    // Only a pointer that has really moved: the page reports a move of its own when what is under a still pointer changes.
    let at: { x: number; y: number } | null = null;
    const move = (e: MouseEvent) => {
      const was = at;
      at = { x: e.screenX, y: e.screenY };
      if (was && Math.abs(was.x - at.x) + Math.abs(was.y - at.y) > 2) setClear(false);
    };
    window.addEventListener('keydown', key, true); window.addEventListener('mousemove', move, true);
    return () => { cancelAnimationFrame(frame); window.clearTimeout(settle); window.removeEventListener('keydown', key, true); window.removeEventListener('mousemove', move, true); };
  }, [list.length, open]);
  if (!list.length) return null;
  // A command is running there and is not waiting for you: an agent at work, say. Its terminal mark pulses.
  const working = (p: TermPane) => p.running && !p.waiting;
  const show = (id: string) => { useStore.getState().showTerm(id); focusFront(); };
  return (
    <div className={`hidden-terms${right === null ? ' is-apart' : ''}${clear ? ' is-clear' : ''}`} ref={ref} style={{ ...(right === null ? { left: 12 } : { right: `calc(${right}% + 14px)` }), bottom: bottom > 0 ? `calc(${bottom}% + 7px)` : undefined }}>
      {open && (
        <div className="hidden-pop" role="menu" aria-label="Hidden terminals">
          <div className="hidden-head">Hidden terminals, still running</div>
          {list.map((p) => {
            const l = termLabel(p);
            return (
              <button key={p.id} className="hidden-row" role="menuitem" data-pane={p.id} title={`Bring back ${l.dir} ${l.app}`} onClick={() => show(p.id)}>
                <span className={`hidden-mark${working(p) ? ' is-working' : ''}`}><Icon name="terminal" size={13} /></span>
                <span className="hidden-name"><span className="top-dir">{l.dir ? `${l.dir} ` : ''}</span><span className="top-app">{l.app}</span></span>
              </button>
            );
          })}
          <button className="hidden-row hidden-all" role="menuitem" onClick={() => runCommand('term.showAll')}><span>Bring all back</span><kbd>{formatKeys('cmd+shift+u')}</kbd></button>
        </div>
      )}
      <button className="hidden-chip" aria-expanded={open} {...tip('Hidden terminals. Bring them all back', 'term.showAll')} onClick={() => { setOpen(!open); if (open) focusFront(); }}>
        <span className={`hidden-mark${list.some(working) ? ' is-working' : ''}`}><Icon name="terminal" size={13} /></span>{list.length} hidden
      </button>
    </div>
  );
}

/** How often a window looks at the source folder for something newer than itself. */
const UPDATE_POLL = 2500;
/** A notice at the top middle of the window once the folder this copy was built from holds something newer: it is the way to
 *  update (no key does it). Closing it puts it away until the folder next goes from matching to changed, or
 *  the change grows from one a reload brings in to one that needs a relaunch. */
function UpdateNotice() {
  const [pending, setPending] = useState<'reload' | 'relaunch' | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    const look = async () => {
      if (document.visibilityState !== 'visible') return;
      const status = await api.app.checkUpdate().catch(() => null);
      if (!live || !status || status === 'busy') return;
      setPending(status === 'reload' || status === 'relaunch' ? status : null);
    };
    void look();
    const timer = window.setInterval(look, UPDATE_POLL);
    const offFocus = api.app.onFocus((on) => { if (on) void look(); });
    return () => { live = false; window.clearInterval(timer); offFocus?.(); };
  }, []);
  useEffect(() => { setHidden(false); }, [pending]);
  if (!pending || hidden) return null;
  const relaunch = pending === 'relaunch';
  const go = async () => { setBusy(true); try { await updateApp(); } finally { setBusy(false); } };
  return (
    <div className="update-notice" role="status">
      <span className="update-dot" />
      <span>Astrolabe has been updated</span>
      <button className="update-go" disabled={busy} onClick={go}>{relaunch ? 'Relaunch' : 'Reload'}</button>
      <button className="update-x" aria-label="Dismiss" onClick={() => setHidden(true)}><Icon name="x" size={11} /></button>
    </div>
  );
}

function Toast() {
  const toast = useStore((s) => s.toast);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => { if (useStore.getState().toast?.n === toast.n) useStore.setState({ toast: null }); }, toast.ms ?? 1800);
    return () => window.clearTimeout(t);
  }, [toast?.n]);
  return toast ? <div className={`toast${toast.top ? ' is-top' : ''}`} role="status" key={toast.n}>{toast.text}</div> : null;
}
