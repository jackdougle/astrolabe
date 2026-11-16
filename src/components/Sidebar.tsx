import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { carried, carry } from '../lib/handoff';
import { api, basename, dirname, tildify } from '../lib/api';
import { createEntry, dropEntries, moveEntries, renameEntry, runCommand, trashEntries } from '../lib/commands';
import { exitDelay, reducedMotion } from '../lib/motion';
import { bus, focusPane } from '../lib/panes';
import { focusedId, projectRoot, SidebarView, useStore } from '../lib/store';
import { Icon } from './Icons';
import { tip } from './Tooltip';

// The navigator opens like a drawer: its slot widens while the panel slides out from behind the left edge.
// When hidden it stays mounted only until it has slid away.
export function Sidebar() {
  const visible = useStore((s) => s.sidebar.visible);
  const [mounted, setMounted] = useState(visible);
  const [open, setOpen] = useState(visible);
  useEffect(() => {
    if (visible) {
      setMounted(true);
      if (reducedMotion()) { setOpen(true); return; }
      // Lay it out closed first, so the opening has somewhere to start from.
      let raf = requestAnimationFrame(() => { raf = requestAnimationFrame(() => setOpen(true)); });
      return () => cancelAnimationFrame(raf);
    }
    setOpen(false);
    const t = window.setTimeout(() => setMounted(false), exitDelay() + 120);
    return () => window.clearTimeout(t);
  }, [visible]);
  return mounted ? <SidebarPanel open={open} /> : null;
}

function SidebarPanel({ open }: { open: boolean }) {
  const sidebar = useStore((s) => s.sidebar);
  const setSidebar = useStore((s) => s.setSidebar);
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX; const startW = sidebar.width;
    // The navigator narrows to 85px; drag well past that and it hides (drag back out, still holding, to bring it back).
    const move = (ev: MouseEvent) => {
      const w = startW + ev.clientX - startX;
      setSidebar({ width: Math.min(460, Math.max(85, w)), visible: w >= 40 });
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); document.body.classList.remove('is-resizing'); };
    document.body.classList.add('is-resizing');
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };
  return (
    <div className={`sidebar-slot${open ? ' is-open' : ''}`} style={{ width: open ? sidebar.width : 0 }}>
      <div className="sidebar-clip">
        <aside className="sidebar" style={{ width: sidebar.width }}>
          <div className="sidebar-body">
            {sidebar.view === 'files' && <FileTree />}
            {sidebar.view === 'search' && <SearchPanel />}
          </div>
          <SideFoot />
        </aside>
      </div>
      {open && <div className="sidebar-resize" onMouseDown={startResize} />}
    </div>
  );
}

/** The bar at the foot of the navigator: the same buttons in the same places whatever the navigator shows, as in
 *  Obsidian's ribbon. Where to look (files, search), then the app's own (every command, settings). A new note is ⌘N
 *  or a right-click on the top row, opening a file by name is ⌘O, the hotkeys are listed under Settings, and the graph's button is with
 *  the view buttons at the top right. They sit centred on one line; a navigator too narrow for that gets them on as
 *  few lines as will hold them, the same number on each. */
const FOOT: { icon: string; label: string; command: string; view?: SidebarView; cls?: string }[] = [
  { icon: 'files', label: 'Files', command: 'sidebar.files', view: 'files' },
  { icon: 'search', label: 'Search in project', command: 'sidebar.search', view: 'search' },
  { icon: 'command', label: 'Command palette', command: 'palette.commands' },
  { icon: 'gear', label: 'Settings', command: 'palette.settings', cls: 'side-settings' },
];
/** A button is 24px wide with 4px between it and the next, and the bar has 10px either side. */
const FOOT_STEP = 28;
function SideFoot() {
  const view = useStore((s) => s.sidebar.view);
  const width = useStore((s) => s.sidebar.width);
  const fits = Math.max(1, Math.floor((width - 20 + 4) / FOOT_STEP));
  const perLine = Math.ceil(FOOT.length / Math.ceil(FOOT.length / fits));
  return (
    <div className="side-foot">
      <div className="side-foot-row" style={{ '--per-line': perLine } as React.CSSProperties}>
        {FOOT.map((b) => (
          <button key={b.command} className={`${b.cls ?? ''}${b.view === view ? ' is-on' : ''}`} {...tip(b.label, b.command)} onClick={() => runCommand(b.command)}><Icon name={b.icon} size={16} /></button>
        ))}
      </div>
    </div>
  );
}

interface Entry { name: string; path: string; dir: boolean }

/** What a row folds away: a folder's rows, a file's search hits. They drop down as it opens and draw back up as it
 *  closes (`.tree-kids` in styles.css), staying in the page until they are out of sight. What is already open when
 *  its row first shows is simply there, however late its rows arrive (`ready`): a window opening does not unfold. */
function Fold({ open, ready = true, children }: { open: boolean; ready?: boolean; children: () => React.ReactNode }) {
  const on = open && ready;
  const born = useRef(open);
  const [shown, setShown] = useState(on);
  const [full, setFull] = useState(on);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open) born.current = false;
    if (on) {
      setShown(true);
      if (born.current || reducedMotion()) setFull(true);
      born.current = false;
      return;
    }
    setFull(false);
    const timer = window.setTimeout(() => setShown(false), exitDelay());
    return () => window.clearTimeout(timer);
  }, [on, open]);
  // In the page at no height first, and seen there, so that there is something to grow from.
  useLayoutEffect(() => { if (shown && on && !full) { ref.current?.getBoundingClientRect(); setFull(true); } }, [shown, on, full]);
  if (!shown) return null;
  return <div ref={ref} className={`tree-kids${full ? ' is-open' : ''}`}><div>{children()}</div></div>;
}

function FileTree() {
  const root = useStore((s) => projectRoot(s));
  const openFile = useStore((s) => s.openFile);
  // The file in the editor used last: its row is lit, and the folders it is in are opened so that it shows.
  const activeFile = useStore((s) => { const p = s.editors.root ? s.panes[s.editors.active] : null; return p?.kind === 'editor' ? p.active : null; });
  const [children, setChildren] = useState<Record<string, Entry[]>>({});
  const [open, setOpen] = useState<Record<string, boolean>>(() => carried<Record<string, boolean>>('tree') ?? {}); // folders stay open through a window reload
  const [showHidden, setShowHidden] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  // The folder a new file is being named in, if any.
  const [creating, setCreating] = useState<string | null>(null);
  // The rows picked out by clicking: a click takes one, ⌘-click adds or drops one, ⇧-click takes everything from the last one clicked.
  const [selected, setSelected] = useState<string[]>([]);
  const anchor = useRef<string | null>(null);
  /** Every row on show, top to bottom. */
  const visible = () => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const e of children[dir] ?? []) {
        if (!showHidden && e.name.startsWith('.')) continue;
        out.push(e.path);
        if (e.dir && open[e.path]) walk(e.path);
      }
    };
    walk(root);
    return out;
  };
  const onRowClick = (ev: React.MouseEvent, e: Entry) => {
    if (renaming === e.path || dragged.current) return;
    if (ev.shiftKey) {
      const rows = visible();
      const to = rows.indexOf(e.path);
      const from = rows.indexOf(anchor.current ?? activeFile ?? e.path);
      const start = from < 0 ? to : from;
      setSelected(rows.slice(Math.min(start, to), Math.max(start, to) + 1));
      return;
    }
    anchor.current = e.path;
    if (ev.metaKey) { setSelected((s) => (s.includes(e.path) ? s.filter((p) => p !== e.path) : [...s, e.path])); return; }
    setSelected([e.path]);
    // ⌥-click, as in VS Code, opens the file to the side: in a new editor beside the one used last.
    if (e.dir) toggle(e); else openFile(e.path, null, ev.altKey ? { beside: 'right' } : undefined);
  };
  // Right-clicking a folder puts the new file inside it, a file beside it, and anywhere else at the top of the project.
  // On one of several selected rows the menu is about all of them; on any other row, that row becomes the selection.
  const onMenu = async (ev: React.MouseEvent, e: Entry | null) => {
    ev.preventDefault();
    ev.stopPropagation();
    const rows = visible();
    let group = selected.filter((p) => rows.includes(p));
    if (e && !group.includes(e.path)) { group = [e.path]; anchor.current = e.path; setSelected(group); }
    const many = !!e && group.length > 1;
    const choice = await api.fs.treeMenu(e ? (e.dir ? 'dir' : 'file') : 'blank', many ? group.length : 1);
    if (choice === 'newFile') {
      const dir = !e ? root : e.dir ? e.path : dirname(e.path);
      if (dir !== root) { setOpen((o) => ({ ...o, [dir]: true })); if (!children[dir]) load(dir); }
      setRenaming(null);
      setCreating(dir);
    } else if (!e) return;
    else if (choice === 'rename') setRenaming(e.path);
    else if (choice === 'trash') { setSelected([]); trashEntries(many ? group : [e.path]); }
    else if (choice === 'reveal') api.app.reveal(e.path);
  };
  const openRef = useRef(open);
  openRef.current = open;

  // Rows are dragged as in VS Code: onto a folder (or a file inside it) to move them there, onto the empty space
  // below to move them to the top of the project. Onto a terminal, their text is pasted; onto an editor, they open.
  // A row that is one of several selected takes the others along. Esc calls it off.
  const [drag, setDrag] = useState<{ label: string; paths: string[]; x: number; y: number; dir: string | null } | null>(null);
  const dragged = useRef(false); // a drag has just ended: the click that follows it is not a click
  const listRef = useRef<HTMLDivElement>(null);
  const startDrag = (ev: React.MouseEvent, e: Entry) => {
    if (ev.button !== 0 || ev.shiftKey || ev.metaKey || ev.ctrlKey || renaming === e.path) return;
    const from = { x: ev.clientX, y: ev.clientY };
    const rows = visible();
    const group = selected.includes(e.path) ? selected.filter((p) => rows.includes(p)) : [e.path];
    const paths = group.filter((p) => !group.some((q) => p.startsWith(q + '/')));
    const label = paths.length === 1 ? basename(paths[0]) : `${paths.length} items`;
    let started = false;
    let drop: { dir: string } | { pane: string } | null = null;
    let lit: HTMLElement | null = null; // the pane outlined as the place they would land
    let resting: { dir: string; timer: number } | null = null; // a closed folder the pointer has stopped on
    let at = from;
    let frame = 0;
    const light = (el: HTMLElement | null) => { if (lit === el) return; lit?.classList.remove('is-file-drop'); lit = el; lit?.classList.add('is-file-drop'); };
    // A closed folder opens when the pointer rests on it, so the rows can go further in.
    const rest = (dir: string | null) => {
      if ((resting?.dir ?? null) === dir) return;
      if (resting) window.clearTimeout(resting.timer);
      resting = dir && !openRef.current[dir] ? { dir, timer: window.setTimeout(() => { setOpen((o) => ({ ...o, [dir]: true })); load(dir); }, 600) } : null;
    };
    const aim = () => {
      const el = document.elementFromPoint(at.x, at.y) as HTMLElement | null;
      const row = el?.closest<HTMLElement>('.treerow[data-path]') ?? null;
      const pane = row ? null : el?.closest<HTMLElement>('.pane[data-pane]') ?? null;
      let dir = row ? (row.dataset.dir ? row.dataset.path! : dirname(row.dataset.path!)) : el?.closest('.tree-scroll') ? root : null;
      rest(row?.dataset.dir ? row.dataset.path! : null);
      // Nothing happens where the rows already are, and a folder cannot go inside itself.
      if (dir != null && (paths.every((p) => dirname(p) === dir) || paths.some((p) => dir === p || dir!.startsWith(p + '/')))) dir = null;
      drop = dir != null ? { dir } : pane ? { pane: pane.dataset.pane! } : null;
      light(pane);
      setDrag({ label, paths, x: at.x, y: at.y, dir });
    };
    // Held near the top or bottom of the list, it scrolls.
    const scroll = () => {
      frame = requestAnimationFrame(scroll);
      const list = listRef.current;
      if (!list) return;
      const box = list.getBoundingClientRect();
      if (at.x < box.left || at.x > box.right || at.y < box.top || at.y > box.bottom) return;
      const by = at.y < box.top + 26 ? -8 : at.y > box.bottom - 26 ? 8 : 0;
      const was = list.scrollTop;
      if (by) list.scrollTop += by;
      if (list.scrollTop !== was) aim();
    };
    const move = (m: MouseEvent) => {
      at = { x: m.clientX, y: m.clientY };
      if (!started) {
        if (Math.hypot(at.x - from.x, at.y - from.y) < 5) return;
        started = true;
        document.body.classList.add('is-dragging-files');
        frame = requestAnimationFrame(scroll);
      }
      aim();
    };
    const end = (place: boolean) => {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); window.removeEventListener('keydown', key, true);
      cancelAnimationFrame(frame);
      rest(null); light(null);
      document.body.classList.remove('is-dragging-files');
      setDrag(null);
      if (!started) return;
      dragged.current = true;
      window.setTimeout(() => { dragged.current = false; });
      if (!place || !drop) return;
      if ('pane' in drop) { void dropEntries(paths, drop.pane, at); return; }
      const { dir } = drop;
      if (dir !== root) setOpen((o) => ({ ...o, [dir]: true }));
      anchor.current = paths[0];
      setSelected(paths); // they stay picked out where they land (`fs.renamed` below follows them there)
      void moveEntries(paths, dir).then(() => load(dir));
    };
    const up = () => end(true);
    const key = (k: KeyboardEvent) => { if (k.key === 'Escape') { k.preventDefault(); k.stopPropagation(); end(false); } };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up); window.addEventListener('keydown', key, true);
  };

  const load = useCallback(async (dir: string) => {
    const list = (await api.fs.readDir(dir)) as Entry[];
    setChildren((c) => ({ ...c, [dir]: list }));
  }, []);
  const reload = useCallback(() => {
    load(root);
    for (const [dir, isOpen] of Object.entries(openRef.current)) if (isOpen && dir.startsWith(root + '/')) load(dir);
  }, [root, load]);

  useEffect(() => { setChildren({}); setSelected([]); anchor.current = null; reload(); }, [root]);
  useEffect(() => carry('tree', () => openRef.current), []);
  useEffect(() => bus.on('fs.changed', reload), [reload]);
  // The list keeps itself up to date: the folders on show are read again every couple of seconds while the window is
  // on screen, so a file an agent or another program makes, moves or deletes shows without being asked for. (There is
  // no reload button; ⌘R still reads everything again.) A folder whose list has not changed is left as it is.
  useEffect(() => {
    let busy = false;
    const same = (a: Entry[] | undefined, b: Entry[]) => !!a && a.length === b.length && a.every((e, i) => e.path === b[i].path && e.dir === b[i].dir);
    const look = async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const dirs = [root, ...Object.entries(openRef.current).filter(([dir, isOpen]) => isOpen && dir.startsWith(root + '/')).map(([dir]) => dir)];
        const lists = await Promise.all(dirs.map((dir) => api.fs.readDir(dir) as Promise<Entry[]>));
        setChildren((c) => {
          let next = c;
          dirs.forEach((dir, i) => { if (Array.isArray(lists[i]) && !same(c[dir], lists[i])) next = { ...next, [dir]: lists[i] }; });
          return next;
        });
      } catch { /* a folder that has gone is dealt with by the next full reload */ } finally { busy = false; }
    };
    const timer = window.setInterval(look, 2000);
    return () => window.clearInterval(timer);
  }, [root]);
  // A renamed folder stays expanded under its new name.
  useEffect(() => bus.on('fs.renamed', ({ from, to }: { from: string; to: string }) => {
    const move = (k: string) => (k === from || k.startsWith(from + '/') ? to + k.slice(from.length) : k);
    setOpen((o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [move(k), v])));
    setSelected((s) => s.map(move));
    if (anchor.current) anchor.current = move(anchor.current);
  }), []);
  useEffect(() => api.app.onFocus((on) => { if (on) reload(); }), [reload]);

  // The open file is always on show: every folder above it opens (one closed by hand afterwards stays closed until
  // another file comes to the front), and the list scrolls to its row once that is there.
  const reveal = useRef<string | null>(null);
  useEffect(() => {
    if (!activeFile || !activeFile.startsWith(root + '/')) return;
    const dirs: string[] = [];
    for (let d = dirname(activeFile); d.length > root.length && d.startsWith(root + '/'); d = dirname(d)) dirs.unshift(d);
    const shut = dirs.filter((d) => !openRef.current[d]);
    if (shut.length) setOpen((o) => ({ ...o, ...Object.fromEntries(shut.map((d) => [d, true])) }));
    for (const d of dirs) load(d);
    reveal.current = activeFile;
  }, [activeFile, root]);
  useEffect(() => {
    if (!reveal.current) return;
    const row = document.querySelector<HTMLElement>('.tree-scroll .treerow.is-active');
    if (!row) return;
    reveal.current = null;
    row.scrollIntoView({ block: 'nearest' });
    // A folder that is still dropping open has its rows short of where they will be.
    window.setTimeout(() => { if (row.isConnected) row.scrollIntoView({ block: 'nearest' }); }, 260);
  }, [children, open, activeFile]);

  const toggle = (e: Entry) => {
    const next = !open[e.path];
    setOpen((o) => ({ ...o, [e.path]: next }));
    if (next && !children[e.path]) load(e.path);
  };
  // A file has no chevron, so its name is set in to where a folder's chevron is drawn.
  const FILE_INSET = 5;
  const renderDir = (dir: string, depth: number): React.ReactNode => {
    const list = children[dir];
    const field = creating === dir ? (
      <div key="\0new" className="treerow" style={{ paddingLeft: 10 + depth * 13 + FILE_INSET }}>
        <RenameField initial="" onDone={(name) => { setCreating(null); if (name) createEntry(dir, name); }} />
      </div>
    ) : null;
    if (!list) return field ?? (depth === 0 ? <div className="side-note">Loading…</div> : null);
    const shown = showHidden ? list : list.filter((e) => !e.name.startsWith('.'));
    if (!shown.length && depth === 0 && !field) return <div className="side-note">This folder is empty.</div>;
    const rows = shown.map((e) => (
      <div key={e.path} className={drag?.dir === e.path ? 'tree-node is-drop' : 'tree-node'}>
        <div className={`treerow${e.path === activeFile ? ' is-active' : ''}${selected.includes(e.path) ? ' is-selected' : ''}${drag?.paths.includes(e.path) ? ' is-dragged' : ''}`} style={{ paddingLeft: 10 + depth * 13 + (e.dir ? 0 : FILE_INSET) }} title={drag ? undefined : tildify(e.path)}
          data-path={e.path} data-dir={e.dir ? '1' : undefined}
          onMouseDown={(ev) => startDrag(ev, e)}
          onContextMenu={(ev) => onMenu(ev, e)}
          onClick={(ev) => { ev.stopPropagation(); onRowClick(ev, e); }}
          onDoubleClick={() => { if (!e.dir && renaming !== e.path) useStore.getState().keepFile(e.path); }}>
          {e.dir ? <span className={`tree-arrow${open[e.path] ? ' is-open' : ''}`}><Icon name="chevron" size={12} /></span> : null}
          {renaming === e.path
            ? <RenameField initial={e.name} onDone={async (name) => { setRenaming(null); if (name && name !== e.name) await renameEntry(e.path, name); }} />
            : <span className={`tree-name${e.dir ? ' is-dir' : ''}`}>{e.name}</span>}
        </div>
        {e.dir && <Fold open={!!open[e.path]} ready={!!children[e.path] || creating === e.path}>{() => renderDir(e.path, depth + 1)}</Fold>}
      </div>
    ));
    return field ? [field, ...rows] : rows;
  };
  return (
    <div className="filetree" onContextMenu={(ev) => onMenu(ev, null)}>
      <div className="side-title">
        <span title={tildify(root)}>{basename(root)}</span>
        <button className={showHidden ? 'is-on' : ''} {...tip(showHidden ? 'Hide dotfiles' : 'Show dotfiles')} onClick={() => setShowHidden(!showHidden)}><Icon name="eye" size={15} /></button>
      </div>
      <div className={`tree-scroll${drag?.dir === root ? ' is-drop' : ''}`} ref={listRef} onClick={() => { if (!dragged.current) setSelected([]); }}>{renderDir(root, 0)}</div>
      {drag && createPortal(<div className="tree-drag" style={{ transform: `translate(${drag.x + 12}px, ${drag.y + 8}px)` }}>{drag.label}</div>, document.body)}
    </div>
  );
}

function RenameField({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    const el = ref.current!;
    el.focus();
    // Select the name without its extension, as Finder does.
    const dot = initial.lastIndexOf('.');
    el.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, []);
  const finish = (name: string | null) => { if (done.current) return; done.current = true; onDone(name); };
  return (
    <input ref={ref} className="tree-rename" defaultValue={initial} spellCheck={false} onClick={(e) => e.stopPropagation()}
      onBlur={(e) => finish(e.target.value.trim() || null)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish((e.target as HTMLInputElement).value.trim() || null);
        else if (e.key === 'Escape') finish(null);
      }} />
  );
}

interface SearchFile { path: string; matches: { line: number; col: number; len: number; text: string }[] }

function SearchPanel() {
  const root = useStore((s) => projectRoot(s));
  const openFile = useStore((s) => s.openFile);
  const [query, setQuery] = useState('');
  const [regex, setRegex] = useState(false);
  const [exact, setExact] = useState(false);
  const [result, setResult] = useState<{ files: SearchFile[]; truncated: boolean; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const runId = useRef(0);

  useEffect(() => { inputRef.current?.focus(); return bus.on('search.focus', () => { inputRef.current?.focus(); inputRef.current?.select(); }); }, []);
  useEffect(() => {
    const id = ++runId.current;
    if (!query) { setResult(null); setBusy(false); return; }
    setBusy(true);
    const timer = window.setTimeout(async () => {
      const res = await api.search.run({ root, query, regex, caseSensitive: exact });
      if (id === runId.current) { setResult(res); setBusy(false); }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [query, regex, exact, root]);

  const total = result?.files.reduce((n, f) => n + f.matches.length, 0) ?? 0;
  return (
    <div className="searchpanel">
      <div className="side-title"><span title={tildify(root)}>Search {basename(root)}</span></div>
      <div className="search-box">
        <input ref={inputRef} value={query} placeholder="Text to find" spellCheck={false} onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); const id = focusedId(); if (id) focusPane(id); } }} />
        <button className={exact ? 'is-on' : ''} {...tip('Match case')} onClick={() => setExact(!exact)}>Aa</button>
        <button className={regex ? 'is-on' : ''} {...tip('Use a regular expression')} onClick={() => setRegex(!regex)}>.*</button>
      </div>
      <div className="search-status">
        {result?.error ? result.error
          : !query ? 'Searches every file in the project, skipping what .gitignore skips.'
          : busy && !result ? 'Searching…'
          : result ? (total === 0 ? 'No matches.' : `${total}${result.truncated ? '+' : ''} ${total === 1 ? 'match' : 'matches'} in ${result.files.length} ${result.files.length === 1 ? 'file' : 'files'}`) : ''}
      </div>
      <div className="tree-scroll">
        {result?.files.map((f) => (
          <div key={f.path} className="hit-file">
            <div className="hit-head" onClick={() => setClosed((c) => ({ ...c, [f.path]: !c[f.path] }))}>
              <span className={`tree-arrow${closed[f.path] ? '' : ' is-open'}`}><Icon name="chevron" size={11} /></span>
              <span className="hit-name">{basename(f.path)}</span>
              <span className="hit-dir">{f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''}</span>
              <span className="hit-count">{f.matches.length}</span>
            </div>
            <Fold open={!closed[f.path]}>{() => f.matches.map((m, i) => {
              const start = Math.max(0, m.col - 1 - 24);
              const pre = m.text.slice(start, m.col - 1).trimStart();
              return (
                <div key={i} className="hit-line" onClick={() => openFile(`${root}/${f.path}`, { line: m.line, col: m.col })} onDoubleClick={() => useStore.getState().keepFile(`${root}/${f.path}`)}>
                  <span className="hit-no">{m.line}</span>
                  <span className="hit-text">{start > 0 && '…'}{pre}<mark>{m.text.slice(m.col - 1, m.col - 1 + m.len)}</mark>{m.text.slice(m.col - 1 + m.len, m.col - 1 + m.len + 120)}</span>
                </div>
              );
            })}</Fold>
          </div>
        ))}
      </div>
    </div>
  );
}

