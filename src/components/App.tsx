import { useEffect, useMemo, useRef } from 'react';
import { api, basename, tildify } from '../lib/api';
import { attachPaths, closeFileTab, handleShortcut, newFileBeside, pickAndAttach, runCommand } from '../lib/commands';
import { computeLayout, DividerRect, findSplit, leafShares, LayoutNode, leaves, removeLeaf } from '../lib/layout';
import { markBooted, useEntering } from '../lib/motion';
import { monoFont, refreshFiles, setMonacoTheme } from '../lib/monaco';
import { richHooks } from '../lib/richMarkdown';
import { bus, focusPane, paneHandles } from '../lib/panes';
import { entryLeaving, isMarkdown, Pane, scrollSpeed, showEntry, showing, sides, Tab, TabEntry, tabEntries, tabLabel, useStore } from '../lib/store';
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
  const tabs = useStore((s) => s.tabs);
  const activeTab = useStore((s) => s.activeTab);
  const theme = useStore((s) => s.settings.theme);
  const zoom = useStore((s) => s.settings.zoom);
  const settings = useStore((s) => s.settings);
  const fullscreen = useStore((s) => s.fullscreen);
  const activePaneId = tabs.find((t) => t.id === activeTab)?.activePane;

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
      attachPaths(files.map((f) => api.fs.pathOf(f)).filter(Boolean), id);
    };
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
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('wheel', onWheel); window.removeEventListener('dragover', onDragOver); window.removeEventListener('drop', onDrop); offs.forEach((off) => off()); };
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
    r.setProperty('--editor-alpha-focused', String(clamp(settings.editorOpacityFocused, 1)));
    r.setProperty('--editor-alpha-unfocused', String(clamp(settings.editorOpacityUnfocused, 0.8)));
    r.setProperty('--chrome-alpha-focused', String(clamp(settings.chromeOpacityFocused, 1)));
    r.setProperty('--chrome-alpha-unfocused', String(clamp(settings.chromeOpacityUnfocused, 0.8)));
    r.setProperty('--mono', monoFont());
  }, [settings.opacityFocused, settings.opacityUnfocused, settings.editorOpacityFocused, settings.editorOpacityUnfocused, settings.chromeOpacityFocused, settings.chromeOpacityUnfocused, settings.fontFamily]);
  // Keyboard focus follows the active pane.
  useEffect(() => { if (activePaneId) focusPane(activePaneId); }, [activeTab, activePaneId]);
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
          <div className="stack">
            {tabs.map((t) => <TabArea key={t.id} tab={t} active={t.id === activeTab} />)}
          </div>
        </div>
      </div>
      <Palette />
      <Toast />
      <Tooltip />
    </div>
  );
}

// Tabs run along the top, as in a browser, in the same strip that holds the window controls,
// so they cost no more height than a plain title bar would. Terminals and open files are tabs of the same kind
// here: a file's tab follows the terminals it was opened from, joined to them in one block, and the two show side by side
// until ⌃⌘F lets one fill the tab.
function TabStrip() {
  const tabs = useStore((s) => s.tabs);
  const panes = useStore((s) => s.panes);
  const activeTab = useStore((s) => s.activeTab);
  const dirty = useStore((s) => s.dirty);
  const leaving = useStore((s) => s.leaving);
  const dragFrom = useRef<TabEntry | null>(null);
  const row = tabEntries({ tabs, panes });
  const front = tabs.find((t) => t.id === activeTab);
  const show = front ? showing(front, panes) : 'terminal';
  const focused = front ? panes[front.activePane]?.kind : undefined;
  const drop = (to: TabEntry) => {
    const from = dragFrom.current;
    dragFrom.current = null;
    if (!from || from.key === to.key) return;
    const st = useStore.getState();
    // A tab dragged onto another group moves with its terminals and files; within a group, files change places.
    if (from.tab.id !== to.tab.id) st.moveTab(st.tabs.findIndex((t) => t.id === from.tab.id), st.tabs.findIndex((t) => t.id === to.tab.id));
    else if (from.file && to.file) st.moveFile(from.pane, from.file, to.file);
  };
  let live = 0;
  const tabOf = (e: TabEntry) => {
    const gone = entryLeaving(e, { panes, leaving });
    const editor = e.file ? panes[e.pane] : null;
    // In front: this tab's terminals, or the file its editor has open.
    const open = e.tab.id === activeTab && (!e.file || (editor?.kind === 'editor' && editor.active === e.file));
    const active = open && focused === (e.file ? 'editor' : 'terminal');
    const common = {
      entry: e, index: gone ? -1 : live++, active, shown: open && !active && show === 'both', leaving: gone,
      onDragStart: () => { dragFrom.current = e; }, onDrop: () => drop(e),
    };
    return e.file ? <FileTab key={e.key} {...common} dirty={!!dirty[e.file]} /> : <TermTab key={e.key} {...common} panes={panes} />;
  };

  return (
    <header className="topbar is-open">
      <div className="top-tabs">
        {tabs.map((t) => {
          // Tabs that belong together (terminals and the files opened from them) are joined in one block.
          const mine = row.filter((e) => e.tab.id === t.id);
          return mine.length ? <div key={t.id} className={`tab-group${mine.length > 1 ? ' is-joined' : ''}${t.id === activeTab ? ' is-front' : ''}`}>{mine.map(tabOf)}</div> : null;
        })}
        <button className="top-btn" {...tip('New terminal tab', 'tab.new')} onClick={() => runCommand('tab.new')}><Icon name="plus" size={14} /></button>
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

/** Puts the keyboard in the pane that is in front. */
const focusFront = () => { const s = useStore.getState(); const t = s.tabs.find((x) => x.id === s.activeTab); if (t) focusPane(t.activePane); };

interface TopTabProps {
  entry: TabEntry; index: number; active: boolean; shown: boolean; leaving: boolean; onDragStart: () => void; onDrop: () => void;
}
const topTabClass = (p: TopTabProps, entering: boolean) =>
  `${p.active ? ' is-active' : ''}${p.shown ? ' is-shown' : ''}${entering ? ' is-entering' : ''}${p.leaving ? ' is-leaving' : ''}`;

/** A tab's terminals, named for the project folder and the running program. */
function TermTab(props: TopTabProps & { panes: Record<string, Pane> }) {
  const { entry, index, active, leaving, panes, onDragStart, onDrop } = props;
  const t = entry.tab;
  const [entering, entered] = useEntering();
  const l = tabLabel(t, panes);
  const running = sides(t, panes).terms.some((id) => { const x = panes[id]; return x?.kind === 'terminal' && x.running && !x.waiting; });
  const p = panes[entry.pane];
  const failed = p?.kind === 'terminal' && !p.running && !!p.lastExit;
  const close = () => useStore.getState().closeTerminals(t.id);
  return (
    <div className={`toptab${running ? ' is-running' : ''}${t.finished ? ` is-finished is-${t.finished}` : ''}${topTabClass(props, entering)}`} title={`${l.dir} ${l.app}`} draggable={!leaving}
      onAnimationEnd={entered}
      onDragStart={onDragStart} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}
      onMouseDown={(e) => { if (e.button === 0) { showEntry(entry); focusFront(); } }}
      onAuxClick={(e) => { if (e.button === 1) close(); }}>
      <span className={`tab-mark${running ? ' is-running' : t.finished === 'ok' ? ' is-ok' : failed || t.finished === 'failed' ? ' is-failed' : ''}`} />
      <span className="toptab-text"><span className="top-dir">{l.dir ? `${l.dir} ` : ''}</span><span className="top-app">{l.app}</span></span>
      {index >= 0 && index < 9 && <span className="toptab-key" data-key={`⌘${index + 1}`} />}
      <button className="toptab-close" {...tip('Close terminal', active ? 'tab.close' : undefined)} onMouseDown={(e) => e.stopPropagation()} onClick={close}><Icon name="x" size={11} /></button>
    </div>
  );
}

/** An open file. Right-click for a new file beside it. */
function FileTab(props: TopTabProps & { dirty: boolean }) {
  const { entry, index, active, leaving, dirty, onDragStart, onDrop } = props;
  const path = entry.file!;
  const [entering, entered] = useEntering();
  const close = () => closeFileTab(entry.pane, path);
  const onMenu = async (e: React.MouseEvent) => {
    e.preventDefault();
    if ((await api.fs.headerMenu()) === 'newFile') newFileBeside(path);
  };
  return (
    <div className={`toptab filetab${topTabClass(props, entering)}`} title={tildify(path)} draggable={!leaving}
      onAnimationEnd={entered} onContextMenu={onMenu}
      onDragStart={onDragStart} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}
      onMouseDown={(e) => { if (e.button === 0) { showEntry(entry); focusFront(); } }}
      onAuxClick={(e) => { if (e.button === 1) close(); }}>
      <span className="tab-file"><Icon name="file" size={12} /></span>
      <span className="toptab-text"><span className="top-app filetab-name">{basename(path)}</span></span>
      {dirty && <span className="toptab-dirty" title="Unsaved changes" />}
      {index >= 0 && index < 9 && <span className="toptab-key" data-key={`⌘${index + 1}`} />}
      <button className={`toptab-close filetab-close${dirty ? ' is-dirty' : ''}`} {...tip(dirty ? 'Unsaved changes. Close without saving' : 'Close', active ? 'pane.close' : undefined)}
        onMouseDown={(e) => e.stopPropagation()} onClick={close}><Icon name="x" size={11} /></button>
    </div>
  );
}

/** Controls for the tab in front: a note rendered or raw, which side the editor is on, and one side or both. */
function ViewTools() {
  const tab = useStore((s) => s.tabs.find((t) => t.id === s.activeTab));
  const panes = useStore((s) => s.panes);
  if (!tab) return null;
  const { terms, editor } = sides(tab, panes);
  const show = showing(tab, panes);
  const file = editor && show !== 'terminal' ? editor.files.find((f) => f.path === editor.active) : null;
  const note = editor && file && isMarkdown(file.path) ? file : null;
  const both = !!editor && terms.length > 0;
  const inEditor = panes[tab.activePane]?.kind === 'editor';
  const label = show === 'both' ? (inEditor ? 'Expand the editor' : 'Expand the terminals')
    : !both ? (editor ? 'Open a terminal beside the editor' : 'Open a page beside the terminals')
    : show === 'editor' ? 'Bring the terminals back' : 'Bring the editor back';
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

/** Which way a new pane slides in from: the far side of the split it was added to. */
function enterOffset(node: LayoutNode, id: string): React.CSSProperties | undefined {
  if (node.type === 'leaf') return undefined;
  if (node.b.type === 'leaf' && node.b.pane === id) return { [node.dir === 'row' ? '--in-x' : '--in-y']: node.dir === 'row' ? '14px' : '12px' } as React.CSSProperties;
  return enterOffset(node.a, id) ?? enterOffset(node.b, id);
}

function TabArea({ tab, active }: { tab: Tab; active: boolean }) {
  const panes = useStore((s) => s.panes);
  const leaving = useStore((s) => s.leaving);
  const [entering, entered] = useEntering();
  const ref = useRef<HTMLDivElement>(null);
  // Panes that are fading out keep their place; the rest are laid out as if they were already gone, so they glide into the space.
  const full = useMemo(() => computeLayout(tab.root), [tab.root]);
  const liveRoot = useMemo(() => {
    let r: LayoutNode | null = tab.root;
    for (const id of leaves(tab.root)) if (leaving[id] && r) r = removeLeaf(r, id);
    return r ?? tab.root;
  }, [tab.root, leaving]);
  // One side can fill the tab (⌃⌘F): the other side's panes stay where they were, hidden, and their terminals keep running.
  const show = showing(tab, panes);
  const editorId = sides(tab, panes).editor?.id;
  const within = (root: LayoutNode): LayoutNode => (show === 'both' || !editorId ? root : show === 'editor' ? { type: 'leaf', pane: editorId } : removeLeaf(root, editorId) ?? root);
  const shownRoot = useMemo(() => within(liveRoot), [liveRoot, show, editorId]);
  const before = useMemo(() => computeLayout(within(tab.root)), [tab.root, show, editorId]);
  const { panes: rects, dividers } = useMemo(() => computeLayout(shownRoot), [shownRoot]);
  const ids = useMemo(() => leaves(tab.root).slice().sort(), [tab.root]);
  const onShow = useMemo(() => new Set(leaves(shownRoot)), [shownRoot]);
  const split = onShow.size > 1;
  const rectOf = (id: string) => (rects.find((r) => r.pane === id) ?? before.panes.find((r) => r.pane === id) ?? full.panes.find((r) => r.pane === id))!.rect;

  const drag = (d: DividerRect) => (e: React.MouseEvent) => {
    e.preventDefault();
    const box = ref.current!.getBoundingClientRect();
    const node = findSplit(shownRoot, d.id);
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
      useStore.getState().setRatio(tab.id, d.id, lo <= hi ? Math.min(hi, Math.max(lo, ratio)) : (lo + hi) / 2);
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); document.body.classList.remove('is-resizing', 'is-resizing-col'); };
    document.body.classList.add('is-resizing');
    if (d.dir === 'col') document.body.classList.add('is-resizing-col');
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };

  return (
    <div className={`tab-area${active ? ' is-active' : ''}${entering ? ' is-entering' : ''}${leaving[tab.id] === 'shown' ? ' is-leaving' : ''}`} data-tab={tab.id} ref={ref} onAnimationEnd={entered}>
      {ids.map((id) => {
        const pane = panes[id];
        if (!pane) return null;
        const gone = !!leaving[id];
        const r = tab.maximized && !gone ? { x: 0, y: 0, w: 100, h: 100 } : rectOf(id);
        // A pane closed on the hidden side goes without fading over what is showing.
        const hidden = gone ? show !== 'both' && pane.kind !== show : tab.maximized ? id !== tab.activePane : !onShow.has(id);
        const isActive = active && id === tab.activePane;
        return (
          <PaneBox key={id} id={id} isActive={isActive} split={split} leaving={gone} offset={enterOffset(tab.root, id)}
            style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%`, visibility: hidden ? 'hidden' : undefined }}>
            {pane.kind === 'terminal' ? <TerminalPane pane={pane} active={isActive || !split} /> : <EditorPane pane={pane} active={isActive || !split} />}
          </PaneBox>
        );
      })}
      {!tab.maximized && dividers.map((d) => (
        <div key={d.id} className={`divider is-${d.dir}`} style={{ left: `${d.rect.x}%`, top: `${d.rect.y}%`, width: d.dir === 'col' ? `${d.rect.w}%` : undefined, height: d.dir === 'row' ? `${d.rect.h}%` : undefined }}
          onMouseDown={drag(d)} onDoubleClick={() => useStore.getState().setRatio(tab.id, d.id, 0.5)} />
      ))}
    </div>
  );
}

/** The smallest a pane may be dragged: one terminal row, or an editor's tab strip and one line. */
function paneMin(id: string) {
  const session = getSession(id);
  if (session) return session.minSize();
  const tabs = (document.querySelector(`.pane[data-pane="${id}"] .filetabs`) as HTMLElement | null)?.offsetHeight ?? 33;
  return { w: 48, h: tabs + Math.ceil(useStore.getState().settings.fontSize * 1.55) + 10 };
}

function PaneBox({ id, isActive, split, leaving, offset, style, children }: {
  id: string; isActive: boolean; split: boolean; leaving: boolean; offset?: React.CSSProperties; style: React.CSSProperties; children: React.ReactNode;
}) {
  const [entering, entered] = useEntering();
  return (
    <div className={`pane${isActive ? ' is-active' : ''}${split ? ' is-split' : ''}${entering ? ' is-entering' : ''}${leaving ? ' is-leaving' : ''}`} data-pane={id}
      style={entering ? { ...style, ...offset } : style} onAnimationEnd={entered}
      onMouseDownCapture={() => { if (!isActive) { useStore.getState().focusPane(id); requestAnimationFrame(() => paneHandles.get(id)?.focus()); } }}>
      {children}
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
