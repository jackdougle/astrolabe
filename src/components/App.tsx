import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { api, basename, tildify } from '../lib/api';
import { attachPaths, closeFileTab, handleShortcut, newFileBeside, pathsOf, pickAndAttach, runCommand } from '../lib/commands';
import { addLeaf, computeLayout, DividerRect, Edge, findSplit, keepLeaves, leafShares, LayoutNode, leaves, moveLeaf, PaneRect, Rect } from '../lib/layout';
import { graphRoot, isGraph } from '../lib/graph';
import { markBooted, reducedMotion, useEntering } from '../lib/motion';
import { monoFont, refreshFiles, setMonacoTheme } from '../lib/monaco';
import { richHooks } from '../lib/richMarkdown';
import { bus, focusPane, paneHandles } from '../lib/panes';
import { EditorPane as EditorPaneState, EDITORS, fileKey, focusedId, isMarkdown, liveEditors, openFiles, Pane, scrollSpeed, showing, Tab, tabGroups, TermPane, termLabel, useStore } from '../lib/store';
import { allSessions, getSession } from '../lib/termSession';
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
      <Tooltip />
    </div>
  );
}


/** Where the two areas sit across the window, in percent of its width: side by side when both are open. */
function areaSpans(both: boolean, ratio: number, side: 'left' | 'right') {
  const all = { x: 0, w: 100 };
  if (!both) return { term: all, editor: all, cut: null as number | null };
  const t = ratio * 100;
  return side === 'left' ? { editor: { x: 0, w: 100 - t }, term: { x: 100 - t, w: t }, cut: 100 - t } : { term: { x: 0, w: t }, editor: { x: t, w: 100 - t }, cut: t };
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
  const groups = tabGroups({ tabs, leaving });
  const both = live.length > 0 && groups.length > 0;
  const spans = areaSpans(both, ratio, side);
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
  const sideW = sidebar.visible ? sidebar.width : 0;
  const edges = box ? zones.map((z, i) => (i === 0 ? 0 : Math.min(box.width, Math.max(0, sideW + z.x0 / 100 * (box.win - sideW) - box.left)))) : [];
  if (box) {
    edges.push(box.width);
    for (let i = 1; i < zones.length; i++) edges[i] = Math.max(edges[i], edges[i - 1] + ZONE_MIN);
    for (let i = zones.length - 1; i >= 1; i--) edges[i] = Math.min(edges[i], edges[i + 1] - ZONE_MIN);
  }
  const files = openFiles({ panes, editors, leaving });
  const termsOnScreen = show !== 'editor';
  const editorsOnScreen = show !== 'terminal';

  return (
    <header className="topbar is-open">
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
        <button className="top-btn" {...tip('File navigator', 'sidebar.toggle')} onClick={() => runCommand('sidebar.toggle')}><Icon name="sidebar" size={15} /></button>
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
  away?: { over(x: number, y: number): void; back(): void; drop(x: number, y: number): void };
}
/** Drags a tab of the row by hand: it stays under the pointer, and the tabs it passes slide out of its way as it goes. */
function dragTab(e: React.MouseEvent<HTMLElement>, opts: DragOpts) {
  if (e.button !== 0) return;
  const el = e.currentTarget;
  const row = el.parentElement!;
  const start = { x: e.clientX, y: e.clientY };
  let grab = { x: 0, y: 0 };
  let on = false;
  let out = false;
  let at = start;
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
    const bar = row.closest('.topbar')!.getBoundingClientRect();
    const zone = (row.closest('.zone') ?? row).getBoundingClientRect();
    const wasOut = out;
    out = !!opts.away && (at.y > bar.bottom + 4 || at.x < zone.left - 12 || at.x > zone.right + 12);
    el.classList.toggle('is-away', out);
    const r = place(at.x, at.y);
    if (out) { opts.away!.over(at.x, at.y); return; }
    if (wasOut) opts.away!.back();
    // It takes the place of whichever tab its middle has passed.
    const all = [...row.querySelectorAll<HTMLElement>(':scope > [data-flip]')].filter((n) => !n.classList.contains('is-leaving'));
    const left = row.getBoundingClientRect().left;
    const mid = at.x - grab.x + r.width / 2;
    let to = 0;
    for (const n of all) if (n !== el && left + n.offsetLeft + n.offsetWidth / 2 < mid) to++;
    if (to !== all.indexOf(el) && all[to]) { flushSync(() => opts.reorder(el.dataset.flip!, all[to].dataset.flip!)); place(at.x, at.y); }
  };
  const end = (dropped: boolean) => {
    window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); window.removeEventListener('keydown', key, true);
    if (!on) return;
    document.body.classList.remove('is-dragging-tab');
    if (out) { if (dropped) opts.away!.drop(at.x, at.y); else opts.away!.back(); }
    // It settles into its place.
    el.style.transition = reducedMotion() ? 'none' : 'transform 0.18s cubic-bezier(0.2, 0.8, 0.2, 1)';
    el.style.transform = '';
    el.classList.remove('is-away');
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
        {tabs.map((t) => <TabBlock key={t.id} tab={t} panes={panes} leaving={leaving} n={leaving[t.id] ? -1 : n++} front={t.id === activeTab} focused={focused} onScreen={onScreen} />)}
      </div>
      <button className="top-btn" {...tip('New terminal tab', 'tab.new')} onClick={() => runCommand('tab.new')}><Icon name="plus" size={14} /></button>
    </>
  );
}

/** One terminal tab's block: a segment for each of its terminals, then the number that brings it to the front. */
function TabBlock({ tab, panes, leaving, n, front, focused, onScreen }: { tab: Tab; panes: Record<string, Pane>; leaving: Record<string, unknown>; n: number; front: boolean; focused: boolean; onScreen: boolean }) {
  const [entering, entered] = useEntering();
  const ref = useRef<HTMLDivElement>(null);
  useFlip(ref);
  const ids = leaves(tab.root);
  const gone = !!leaving[tab.id] || ids.every((id) => leaving[id]);
  const flagged = tab.finished ? (tab.finishedPane && ids.includes(tab.finishedPane) ? tab.finishedPane : ids[0]) : undefined;
  const reorder = (key: string, onto: string) => { const st = useStore.getState(); st.moveTab(st.tabs.findIndex((t) => t.id === key), st.tabs.findIndex((t) => t.id === onto)); };
  return (
    <div ref={ref} className={`tab-group${front ? ' is-front' : ''}${ids.length > 3 ? ' is-dense' : ''}${entering ? ' is-entering' : ''}${gone ? ' is-leaving' : ''}`} data-tab={tab.id} data-flip={tab.id}
      onAnimationEnd={entered} onMouseDown={(e) => { if (!gone) dragTab(e, { reorder }); }}>
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
  return (
    <div className={`toptab${running ? ' is-running' : ''}${finished ? ` is-finished is-${finished}` : ''}${segClass(props, entering)}`} style={{ flexGrow: weight }} title={`${l.dir} ${l.app}`} data-flip={p.id}
      onAnimationEnd={entered}
      onMouseDown={(e) => { if (e.button === 0) { useStore.getState().focusPane(p.id); focusFront(); } }}
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
 *  editor's row it joins that editor; dragged down onto an editor it lands there, against the edge it is nearest. */
function FileTab({ pane, path, temp, dirty, hint, active, shown, leaving }: { pane: string; path: string; /** A temporary tab: the next file opened takes its place. A double click keeps it. */ temp: boolean; dirty: boolean; /** The keys that bring it to the front. */ hint?: string; active: boolean; shown: boolean; leaving: boolean }) {
  const [entering, entered] = useEntering();
  const close = () => closeFileTab(pane, path);
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
    dragTab(e, {
      reorder: (key, onto) => useStore.getState().moveFile(pane, key, onto),
      away: {
        over: (x, y) => { const zone = rowAt(x, y); mark(zone); zone?.classList.add('is-target'); bus.emit('filedrag', zone ? null : { x, y, pane, path }); },
        back: () => { mark(null); bus.emit('filedrag', null); },
        drop: (x, y) => {
          const zone = rowAt(x, y);
          mark(null);
          if (zone?.dataset.pane) { bus.emit('filedrag', null); useStore.getState().placeFile(pane, path, zone.querySelector<HTMLElement>('.file-row')?.dataset.pane ?? zone.dataset.pane, 'into'); }
          else bus.emit('filedrop', { pane, path });
        },
      },
    });
  };
  return (
    <div className={`toptab filetab${temp ? ' is-temp' : ''}${active ? ' is-active' : ''}${shown ? ' is-shown' : ''}${entering ? ' is-entering' : ''}${leaving ? ' is-leaving' : ''}`} title={isGraph(path) ? `Graph of the notes in ${tildify(graphRoot(path))}` : tildify(path)} data-flip={path}
      onAnimationEnd={entered} onContextMenu={onMenu} onMouseDown={down} onDoubleClick={() => useStore.getState().keepFile(path, pane)}
      onAuxClick={(e) => { if (e.button === 1) close(); }}>
      {/* A file with unsaved changes has no mark of its own: its page glows and pulses, as a terminal's dot does while it works. */}
      <span className={`tab-file${dirty ? ' is-dirty' : ''}`} title={dirty ? 'Unsaved changes' : undefined}><Icon name={isGraph(path) ? 'graph' : 'file'} size={12} /></span>
      <span className="toptab-text"><span className="top-app filetab-name">{isGraph(path) ? 'Graph' : basename(path)}</span></span>
      {hint && <span className="toptab-key" data-key={hint} />}
      <button className={`toptab-close filetab-close${dirty ? ' is-dirty' : ''}`} {...tip(dirty ? 'Unsaved changes. Close without saving' : 'Close', active ? 'pane.close' : undefined)}
        onMouseDown={(e) => e.stopPropagation()} onClick={close}><Icon name="x" size={11} /></button>
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
      <button className="top-btn view-full" {...tip(label, 'editor.expand')} onClick={() => runCommand('editor.expand')}><Icon name={show === 'both' ? 'expand' : 'collapse'} size={15} /></button>
    </div>
  );
}

// ---------- the panes ----------
/** The window below the row: the terminal tabs' area and the editors' area, side by side when both are open. */
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
  const spans = areaSpans(!!editors.root && tabs.length > 0, ratio, side);
  const all = { x: 0, w: 100 };
  const term = show === 'terminal' ? all : spans.term;
  const editor = show === 'editor' ? all : spans.editor;
  const front = tabs.find((t) => t.id === activeTab);

  const drag = (e: React.MouseEvent) => {
    e.preventDefault();
    const box = ref.current!.getBoundingClientRect();
    // Each area can shrink until its narrowest pane shows two columns.
    const need = (root: LayoutNode | null | undefined) => (root ? Math.max(0, ...leafShares(root).map((l) => paneMin(l.pane).w / l.fw)) / box.width : 0);
    const lo = need(front?.root);
    const hi = 1 - need(editors.root);
    const move = (ev: MouseEvent) => {
      const x = (ev.clientX - box.left) / box.width;
      const share = side === 'left' ? 1 - x : x;
      useStore.getState().setAreaRatio(lo <= hi ? Math.min(hi, Math.max(lo, share)) : 0.5);
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); document.body.classList.remove('is-resizing'); };
    document.body.classList.add('is-resizing');
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };

  return (
    <div className="stack" ref={ref}>
      <div className={`area is-terminals${show === 'editor' && liveTabs ? ' is-hidden' : ''}${liveTabs ? '' : ' is-going'}`} style={{ left: `${term.x}%`, width: `${term.w}%` }}>
        {tabs.map((t) => <PaneTree key={t.id} id={t.id} root={t.root} activePane={t.activePane} maximized={t.maximized} active={t.id === activeTab} focused={focus === 'terminal' && t.id === activeTab} />)}
      </div>
      {editors.root && (
        <div className={`area is-editors${show === 'terminal' && liveEds ? ' is-hidden' : ''}${liveEds ? '' : ' is-going'}`} style={{ left: `${editor.x}%`, width: `${editor.w}%` }}>
          <PaneTree id={EDITORS} root={editors.root} activePane={editors.active} maximized={editors.maximized} active focused={focus === 'editor'} />
        </div>
      )}
      {show === 'both' && spans.cut !== null && <div className="divider is-row area-divider" style={{ left: `${spans.cut}%`, height: '100%' }} onMouseDown={drag} onDoubleClick={() => useStore.getState().setAreaRatio(0.5)} />}
    </div>
  );
}

/** Which way a new pane slides in from: the far side of the split it was added to. */
function enterOffset(node: LayoutNode, id: string): React.CSSProperties | undefined {
  if (node.type === 'leaf') return undefined;
  if (node.b.type === 'leaf' && node.b.pane === id) return { [node.dir === 'row' ? '--in-x' : '--in-y']: node.dir === 'row' ? '14px' : '12px' } as React.CSSProperties;
  return enterOffset(node.a, id) ?? enterOffset(node.b, id);
}

/** How close to the area's own edge, in px, a dragged pane must be let go to take that whole side. */
const OUTER = 22;

/** Where a dragged pane would land: against the nearest edge of the pane under the pointer, or of the whole area at its rim. */
function dropAt(x: number, y: number, box: DOMRect, rects: PaneRect[], dragged: string): { target: string | null; edge: Edge } | null {
  const px = (x - box.left) / box.width * 100;
  const py = (y - box.top) / box.height * 100;
  const over = rects.find(({ rect: r }) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h);
  // Over its own place it stays put, so a short tug on the grip does nothing.
  if (!over || over.pane === dragged) return null;
  if (rects.length > 2) {
    const rim = ([['left', x - box.left], ['right', box.right - x], ['top', y - box.top], ['bottom', box.bottom - y]] as [Edge, number][]).sort((a, b) => a[1] - b[1])[0];
    if (rim[1] < OUTER) return { target: null, edge: rim[0] };
  }
  const dx = (px - over.rect.x) / over.rect.w - 0.5;
  const dy = (py - over.rect.y) / over.rect.h - 0.5;
  return { target: over.pane, edge: Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'top' : 'bottom' };
}

/** The stand-in for an editor that does not exist yet, while a dragged file's landing place is worked out. */
const PREVIEW = 'preview';

/** Where a file dragged out of the row would land: in the middle of another editor, among its files; anywhere else,
 *  in an editor of its own against the nearest edge of the editor under the pointer, or of the whole area at its rim. */
function fileDropAt(x: number, y: number, box: DOMRect, rects: PaneRect[], from: string, lone: boolean): { target: string | null; where: Edge | 'into' } | null {
  const px = (x - box.left) / box.width * 100;
  const py = (y - box.top) / box.height * 100;
  const over = rects.find(({ rect: r }) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h);
  if (!over) return null;
  const dx = (px - over.rect.x) / over.rect.w - 0.5;
  const dy = (py - over.rect.y) / over.rect.h - 0.5;
  if (over.pane !== from && Math.abs(dx) < 0.25 && Math.abs(dy) < 0.25) return { target: over.pane, where: 'into' };
  // An editor's only file takes its editor along, so over its own place it stays put.
  if (lone && over.pane === from) return null;
  if (rects.length > (lone ? 2 : 1)) {
    const rim = ([['left', x - box.left], ['right', box.right - x], ['top', y - box.top], ['bottom', box.bottom - y]] as [Edge, number][]).sort((a, b) => a[1] - b[1])[0];
    if (rim[1] < OUTER) return { target: null, where: rim[0] };
  }
  return { target: over.pane, where: Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'top' : 'bottom' };
}

/** One arrangement of panes: a terminal tab's terminals, or the editors (`id` is EDITORS). */
function PaneTree({ id: tree, root, activePane, maximized, active, focused }: { id: string; root: LayoutNode; activePane: string; maximized: boolean; /** It is the one its area shows. */ active: boolean; /** Its area has the keyboard. */ focused: boolean }) {
  const panes = useStore((s) => s.panes);
  const leaving = useStore((s) => s.leaving);
  const [entering, entered] = useEntering();
  const ref = useRef<HTMLDivElement>(null);
  // Panes that are fading out keep their place; the rest are laid out as if they were already gone, so they glide into the space.
  const full = useMemo(() => computeLayout(root), [root]);
  const liveRoot = useMemo(() => keepLeaves(root, (id) => !leaving[id]) ?? root, [root, leaving]);
  const { panes: rects, dividers } = useMemo(() => computeLayout(liveRoot), [liveRoot]);
  const ids = useMemo(() => leaves(root).slice().sort(), [root]);
  const split = rects.length > 1;
  const rectOf = (id: string) => (rects.find((r) => r.pane === id) ?? full.panes.find((r) => r.pane === id))!.rect;

  // A pane is moved by its grip: dragged over another pane, it lands against that pane's nearest edge.
  const [moving, setMoving] = useState<{ pane: string; rect: Rect | null } | null>(null);
  const now = useRef({ rects, root });
  now.current = { rects, root };
  const grab = (id: string) => (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const from = { x: e.clientX, y: e.clientY };
    let started = false;
    let drop: ReturnType<typeof dropAt> = null;
    const move = (ev: MouseEvent) => {
      if (!started && Math.hypot(ev.clientX - from.x, ev.clientY - from.y) < 5) return;
      if (!started) { started = true; document.body.classList.add('is-moving-pane'); }
      const { rects, root } = now.current;
      drop = dropAt(ev.clientX, ev.clientY, ref.current!.getBoundingClientRect(), rects, id);
      // The outline shows exactly where the pane will be.
      const next = drop ? moveLeaf(root, id, drop.target, drop.edge, PREVIEW) : root;
      const rect = next === root ? null : computeLayout(next).panes.find((p) => p.pane === id)?.rect ?? null;
      if (!rect) drop = null;
      setMoving({ pane: id, rect });
    };
    const end = (place: boolean) => {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); window.removeEventListener('keydown', key, true);
      document.body.classList.remove('is-moving-pane');
      setMoving(null);
      if (place && drop) useStore.getState().movePane(id, drop.target, drop.edge);
      focusFront();
    };
    const up = () => end(true);
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); end(false); } };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up); window.addEventListener('keydown', key, true);
  };

  // A file dragged out of the row over the editors is put where it is let go, with the same outline to show where.
  const [landing, setLanding] = useState<Rect | null>(null);
  useEffect(() => {
    if (tree !== EDITORS) return;
    let drop: ReturnType<typeof fileDropAt> = null;
    const offMove = bus.on('filedrag', (d: { x: number; y: number; pane: string; path: string } | null) => {
      const box = ref.current?.getBoundingClientRect();
      const from = d ? useStore.getState().panes[d.pane] : null;
      if (!d || !box || from?.kind !== 'editor' || d.x < box.left || d.x > box.right || d.y < box.top || d.y > box.bottom) { drop = null; setLanding(null); return; }
      const { rects, root } = now.current;
      const lone = from.files.length === 1;
      drop = fileDropAt(d.x, d.y, box, rects, d.pane, lone);
      let rect: Rect | null = null;
      if (drop?.where === 'into') rect = rects.find((r) => r.pane === drop!.target)?.rect ?? null;
      else if (drop) {
        const next = lone ? moveLeaf(root, d.pane, drop.target, drop.where, PREVIEW) : addLeaf(root, PREVIEW, drop.target, drop.where, PREVIEW);
        rect = next === root ? null : computeLayout(next).panes.find((p) => p.pane === (lone ? d.pane : PREVIEW))?.rect ?? null;
      }
      if (!rect) drop = null;
      setLanding((was) => (was && rect && was.x === rect.x && was.y === rect.y && was.w === rect.w && was.h === rect.h ? was : rect));
    });
    const offDrop = bus.on('filedrop', (d: { pane: string; path: string }) => {
      const at = drop;
      drop = null;
      setLanding(null);
      if (at) useStore.getState().placeFile(d.pane, d.path, at.target, at.where);
    });
    return () => { offMove(); offDrop(); };
  }, [tree]);

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

  const outline = moving?.rect ?? landing;
  return (
    <div className={`tab-area${active ? ' is-active' : ''}${entering ? ' is-entering' : ''}${leaving[tree] === 'shown' ? ' is-leaving' : ''}`} data-tab={tree} ref={ref} onAnimationEnd={entered}>
      {ids.map((id) => {
        const pane = panes[id];
        if (!pane) return null;
        const gone = !!leaving[id];
        const r = maximized && !gone ? { x: 0, y: 0, w: 100, h: 100 } : rectOf(id);
        const hidden = !gone && maximized && id !== activePane;
        const isActive = active && focused && id === activePane;
        return (
          <PaneBox key={id} id={id} isActive={isActive} split={split} leaving={gone} offset={enterOffset(root, id)}
            moving={moving?.pane === id} onGrab={split && !maximized && !gone ? grab(id) : undefined}
            style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%`, visibility: hidden ? 'hidden' : undefined }}>
            {pane.kind === 'terminal' ? <TerminalPane pane={pane} active={isActive || !split} /> : <EditorPane pane={pane} active={isActive || !split} />}
          </PaneBox>
        );
      })}
      {outline && <div className="pane-drop" style={{ left: `${outline.x}%`, top: `${outline.y}%`, width: `${outline.w}%`, height: `${outline.h}%` }} />}
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

function PaneBox({ id, isActive, split, leaving, moving, onGrab, offset, style, children }: {
  id: string; isActive: boolean; split: boolean; leaving: boolean; moving: boolean; onGrab?: (e: React.MouseEvent) => void;
  offset?: React.CSSProperties; style: React.CSSProperties; children: React.ReactNode;
}) {
  const [entering, entered] = useEntering();
  return (
    <div className={`pane${isActive ? ' is-active' : ''}${split ? ' is-split' : ''}${entering ? ' is-entering' : ''}${leaving ? ' is-leaving' : ''}${moving ? ' is-moving' : ''}`} data-pane={id}
      style={entering ? { ...style, ...offset } : style} onAnimationEnd={entered}
      onMouseDownCapture={() => { if (!isActive) { useStore.getState().focusPane(id); requestAnimationFrame(() => paneHandles.get(id)?.focus()); } }}>
      {children}
      {onGrab && <div className="pane-grip" {...tip('Drag to move this pane')} onMouseDown={onGrab} />}
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
  return toast ? <div className="toast" role="status" key={toast.n}>{toast.text}</div> : null;
}
