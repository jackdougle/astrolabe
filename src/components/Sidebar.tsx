import { useCallback, useEffect, useRef, useState } from 'react';
import { api, basename, dirname, tildify } from '../lib/api';
import { createEntry, renameEntry, trashEntries } from '../lib/commands';
import { exitDelay, reducedMotion } from '../lib/motion';
import { bus, focusPane } from '../lib/panes';
import { projectRoot, SidebarView, useStore } from '../lib/store';
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
  const views: { id: SidebarView; icon: string; label: string }[] = [
    { id: 'files', icon: 'files', label: 'Files' },
    { id: 'search', icon: 'search', label: 'Search in project' },
  ];
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
            {sidebar.view === 'files' && <FileTree views={views} />}
            {sidebar.view === 'search' && <SearchPanel views={views} />}
          </div>
        </aside>
      </div>
      {open && <div className="sidebar-resize" onMouseDown={startResize} />}
    </div>
  );
}

type Views = { id: SidebarView; icon: string; label: string }[];
function ViewSwitch({ views }: { views: Views }) {
  const view = useStore((s) => s.sidebar.view);
  return (
    <>
      {views.filter((v) => v.id !== view).map((v) => (
        <button key={v.id} {...tip(v.label, `sidebar.${v.id}`)} onClick={() => useStore.getState().setSidebar({ view: v.id })}><Icon name={v.icon} size={16} /></button>
      ))}
    </>
  );
}

interface Entry { name: string; path: string; dir: boolean }

function FileTree({ views }: { views: Views }) {
  const root = useStore((s) => projectRoot(s));
  const openFile = useStore((s) => s.openFile);
  const activeFile = useStore((s) => { const t = s.tabs.find((x) => x.id === s.activeTab); const p = t && s.panes[t.activePane]; return p?.kind === 'editor' ? p.active : null; });
  const [children, setChildren] = useState<Record<string, Entry[]>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
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
    if (renaming === e.path) return;
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
    if (e.dir) toggle(e); else openFile(e.path);
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

  const load = useCallback(async (dir: string) => {
    const list = (await api.fs.readDir(dir)) as Entry[];
    setChildren((c) => ({ ...c, [dir]: list }));
  }, []);
  const reload = useCallback(() => {
    load(root);
    for (const [dir, isOpen] of Object.entries(openRef.current)) if (isOpen && dir.startsWith(root + '/')) load(dir);
  }, [root, load]);

  useEffect(() => { setChildren({}); setSelected([]); anchor.current = null; load(root); }, [root]);
  useEffect(() => bus.on('fs.changed', reload), [reload]);
  // A renamed folder stays expanded under its new name.
  useEffect(() => bus.on('fs.renamed', ({ from, to }: { from: string; to: string }) => {
    const move = (k: string) => (k === from || k.startsWith(from + '/') ? to + k.slice(from.length) : k);
    setOpen((o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [move(k), v])));
    setSelected((s) => s.map(move));
    if (anchor.current) anchor.current = move(anchor.current);
  }), []);
  useEffect(() => api.app.onFocus((on) => { if (on) reload(); }), [reload]);

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
      <div key={e.path}>
        <div className={`treerow${e.path === activeFile ? ' is-active' : ''}${selected.includes(e.path) ? ' is-selected' : ''}`} style={{ paddingLeft: 10 + depth * 13 + (e.dir ? 0 : FILE_INSET) }} title={tildify(e.path)}
          onContextMenu={(ev) => onMenu(ev, e)}
          onClick={(ev) => { ev.stopPropagation(); onRowClick(ev, e); }}>
          {e.dir ? <span className={`tree-arrow${open[e.path] ? ' is-open' : ''}`}><Icon name="chevron" size={12} /></span> : null}
          {renaming === e.path
            ? <RenameField initial={e.name} onDone={async (name) => { setRenaming(null); if (name && name !== e.name) await renameEntry(e.path, name); }} />
            : <span className={`tree-name${e.dir ? ' is-dir' : ''}`}>{e.name}</span>}
        </div>
        {e.dir && open[e.path] && renderDir(e.path, depth + 1)}
      </div>
    ));
    return field ? [field, ...rows] : rows;
  };
  return (
    <div className="filetree" onContextMenu={(ev) => onMenu(ev, null)}>
      <div className="side-title">
        <span title={tildify(root)}>{basename(root)}</span>
      </div>
      <div className="tree-scroll" onClick={() => setSelected([])}>{renderDir(root, 0)}</div>
      <div className="side-foot">
        <SettingsButton />
        <button className={showHidden ? 'is-on' : ''} {...tip(showHidden ? 'Hide dotfiles' : 'Show dotfiles')} onClick={() => setShowHidden(!showHidden)}><Icon name="eye" size={16} /></button>
        <button {...tip('Reload')} onClick={reload}><Icon name="refresh" size={16} /></button>
        <ViewSwitch views={views} />
      </div>
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

function SearchPanel({ views }: { views: Views }) {
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
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); const s = useStore.getState(); const t = s.tabs.find((x) => x.id === s.activeTab); if (t) focusPane(t.activePane); } }} />
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
            {!closed[f.path] && f.matches.map((m, i) => {
              const start = Math.max(0, m.col - 1 - 24);
              const pre = m.text.slice(start, m.col - 1).trimStart();
              return (
                <div key={i} className="hit-line" onClick={() => openFile(`${root}/${f.path}`, { line: m.line, col: m.col })}>
                  <span className="hit-no">{m.line}</span>
                  <span className="hit-text">{start > 0 && '…'}{pre}<mark>{m.text.slice(m.col - 1, m.col - 1 + m.len)}</mark>{m.text.slice(m.col - 1 + m.len, m.col - 1 + m.len + 120)}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="side-foot"><SettingsButton /><ViewSwitch views={views} /></div>
    </div>
  );
}

function SettingsButton() {
  return <button {...tip('Settings', 'palette.settings')} onClick={() => useStore.getState().openPalette('settings')}><Icon name="gear" size={16} /></button>;
}
