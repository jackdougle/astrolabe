import { useEffect, useMemo, useRef, useState } from 'react';
import { api, basename } from '../lib/api';
import { commands, formatKeys } from '../lib/commands';
import { applyHeadingFont, applyNotesFont, FontInfo, googleFonts, loadGoogleFont, SYSTEM } from '../lib/fonts';
import { fuzzyFilter } from '../lib/fuzzy';
import { history, MONO, setMonacoTheme } from '../lib/monaco';
import { bus, focusPane } from '../lib/panes';
import { activeTermPane, focusedId, isMarkdown, PaletteMode, projectRoot, Settings, useStore } from '../lib/store';
import { applyTheme, getTheme, THEMES } from '../lib/themes';

interface Row { key: string; label: string; detail?: string; hint?: string; positions?: number[]; /** `side`: chosen with ⌘ held. */ run: (side?: boolean) => void; preview?: () => void; /** CSS font stack the label is drawn in. */ face?: string; /** Google Fonts family to fetch once the row is on screen. */ load?: string }
const LITERATA_FACE = '"Literata Variable", Georgia, serif';

const PLACEHOLDER: Record<PaletteMode, string> = {
  commands: 'Run a command',
  files: 'Open a note by name, last edited first (⌘↩: to the side). A . brings in other files, > commands',
  history: 'Search past commands',
  themes: 'Choose a theme',
  'fonts-notes': 'Search Google Fonts for the text of notes',
  'fonts-headings': 'Search Google Fonts for note headings',
  'fonts-code': 'Search monospaced Google Fonts for the terminal and editor',
  settings: 'Settings',
  appearance: 'Theme, starfield',
  fonts: 'Which font',
  sizes: 'Font and navigator sizes',
  behaviour: 'Editing, terminal and session options',
};

// Escape steps back to the menu a mode was opened from; the top-level modes close.
const PARENT: Partial<Record<PaletteMode, PaletteMode>> = {
  appearance: 'settings', fonts: 'settings', sizes: 'settings', behaviour: 'settings',
  'fonts-notes': 'fonts', 'fonts-headings': 'fonts', 'fonts-code': 'fonts',
};

type Choice = Omit<Row, 'positions'>;
const SCROLL_STEPS = [1, 1.5, 2, 2.5, 3, 4];
const SIZE_STEPS = {
  fontSize: [11, 12, 12.5, 13, 14, 15, 16],
  notesSize: [0.9, 1, 1.1, 1.2, 1.35],
  sidebarSize: [11, 12, 12.67, 13, 14, 15],
} as const;

export function Palette() {
  const palette = useStore((s) => s.palette);
  if (!palette) return null;
  return <PaletteBody key={palette.n} initial={palette.mode} />;
}

function PaletteBody({ initial }: { initial: PaletteMode }) {
  const [mode, setMode] = useState<PaletteMode>(initial);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [files, setFiles] = useState<string[] | null>(null);
  const [fonts, setFonts] = useState<FontInfo[] | null>(null);
  // Bumped whenever a preview is cancelled or chosen, so a font still loading cannot land after that.
  const previewSeq = useRef(0);
  const originalFonts = useRef({ notes: useStore.getState().settings.notesFont, headings: useStore.getState().settings.headingFont, code: useStore.getState().settings.fontFamily });
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const root = useStore((s) => projectRoot(s));
  const originalTheme = useRef(useStore.getState().settings.theme);
  const committed = useRef(false);

  const settings = useStore((s) => s.settings);
  // Undo any preview (a theme or font shown while moving through the list) that was not chosen.
  const revertPreview = () => {
    previewSeq.current++;
    if (committed.current) return;
    if (mode === 'themes' || mode === 'appearance') { const t = getTheme(originalTheme.current); applyTheme(t); setMonacoTheme(t); bus.emit('theme.preview'); }
    if (mode === 'fonts-notes') applyNotesFont(originalFonts.current.notes);
    if (mode === 'fonts-headings') applyHeadingFont(originalFonts.current.headings);
    if (mode === 'fonts-code') useStore.getState().updateSettings({ fontFamily: originalFonts.current.code });
  };
  const close = (refocus = true) => {
    revertPreview();
    useStore.getState().closePalette();
    if (refocus) { const id = focusedId(); if (id) focusPane(id); }
  };
  const go = (next: PaletteMode) => { revertPreview(); setMode(next); setQuery(''); };
  const back = () => { const parent = PARENT[mode]; if (parent) go(parent); else close(); };
  const flip = (key: 'wordWrap' | 'smoothCaret' | 'restoreSession' | 'previewTabs' | 'starfield') => {
    const patch: Partial<Settings> = { [key]: !useStore.getState().settings[key] };
    useStore.getState().updateSettings(patch);
  };
  const choose = (items: Choice[]): Row[] => fuzzyFilter(query, items, (c) => c.label, 60).map((h) => ({ ...h.item, positions: h.positions }));

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    if (mode !== 'files') return;
    let live = true;
    api.fs.listFiles(root).then((list: string[]) => { if (live) setFiles(list); });
    return () => { live = false; };
  }, [mode, root]);

  useEffect(() => {
    if (mode !== 'fonts-notes' && mode !== 'fonts-headings' && mode !== 'fonts-code') return;
    let live = true;
    googleFonts().then((list) => { if (live) setFonts(list); });
    return () => { live = false; };
  }, [mode]);

  const rows: Row[] = useMemo(() => {
    const on = (b: boolean) => (b ? 'On' : 'Off');
    if (mode === 'settings') return choose([
      { key: 'appearance', label: 'Appearance and themes', detail: getTheme(settings.theme).name, run: () => go('appearance') },
      { key: 'fonts', label: 'Fonts', detail: settings.fontFamily || 'Commit Mono', run: () => go('fonts') },
      { key: 'sizes', label: 'Font sizes', detail: `${settings.fontSize}px terminal, ${settings.sidebarSize}px navigator`, run: () => go('sizes') },
      { key: 'behaviour', label: 'Behaviour', detail: `word wrap ${on(settings.wordWrap)}, smooth caret ${on(settings.smoothCaret)}`, run: () => go('behaviour') },
      { key: 'file', label: 'Open settings file', hint: formatKeys('cmd+,'), run: () => { close(); commands.find((c) => c.id === 'settings.open')?.run(); } },
    ]);
    if (mode === 'appearance') return choose([
      ...THEMES.map((t): Choice => ({
        key: `theme:${t.id}`, label: t.name, detail: (t.dark ? 'Dark' : 'Light') + (t.id === settings.theme ? ', in use' : ''),
        preview: () => { applyTheme(t); setMonacoTheme(t); bus.emit('theme.preview', t.id); },
        run: () => { committed.current = true; useStore.getState().updateSettings({ theme: t.id }); setMonacoTheme(t); close(); },
      })),
      { key: 'starfield', label: 'Starfield behind the window', detail: on(settings.starfield), run: () => flip('starfield') },
    ]);
    if (mode === 'fonts') return choose([
      { key: 'code', label: 'Terminal and code font', detail: settings.fontFamily || 'Commit Mono, built in', run: () => go('fonts-code') },
      { key: 'notes', label: 'Notes text font', detail: settings.notesFont || 'SF Pro, built in', run: () => go('fonts-notes') },
      { key: 'headings', label: 'Notes heading font', detail: settings.headingFont || 'Literata, built in', run: () => go('fonts-headings') },
    ]);
    // Sizes and options stay open while you change them, so you can try several in a row.
    if (mode === 'sizes') return choose([
      ...SIZE_STEPS.fontSize.map((v): Choice => ({ key: `fs${v}`, label: `Terminal and code ${v}px`, detail: settings.fontSize === v ? 'in use' : '', run: () => useStore.getState().updateSettings({ fontSize: v }) })),
      ...SIZE_STEPS.notesSize.map((v): Choice => ({ key: `ns${v}`, label: `Notes text ${Math.round(14 * v)}px`, detail: settings.notesSize === v ? 'in use' : '', run: () => useStore.getState().updateSettings({ notesSize: v }) })),
      ...SIZE_STEPS.sidebarSize.map((v): Choice => ({ key: `ss${v}`, label: `Navigator ${v}px`, detail: settings.sidebarSize === v ? 'in use' : '', run: () => useStore.getState().updateSettings({ sidebarSize: v }) })),
      { key: 'reset', label: 'Reset font sizes', detail: 'terminal 12.5px, notes 14px, navigator 12.67px', run: () => useStore.getState().updateSettings({ fontSize: 12.5, notesSize: 1, sidebarSize: 12.67 }) },
    ]);
    if (mode === 'behaviour') {
      const next = SCROLL_STEPS[(SCROLL_STEPS.indexOf(settings.scrollSpeed) + 1) % SCROLL_STEPS.length] ?? 2.5;
      return choose([
        { key: 'wrap', label: 'Word wrap in the editor', detail: on(settings.wordWrap), hint: formatKeys('alt+z'), run: () => flip('wordWrap') },
        { key: 'caret', label: 'Smooth caret', detail: on(settings.smoothCaret), run: () => flip('smoothCaret') },
        { key: 'preview', label: 'Temporary tabs for opened files', detail: on(settings.previewTabs), run: () => flip('previewTabs') },
        { key: 'restore', label: 'Reopen last session on launch', detail: on(settings.restoreSession), run: () => flip('restoreSession') },
        { key: 'scroll', label: `Scroll speed ${settings.scrollSpeed}×`, detail: `click for ${next}×`, run: () => useStore.getState().updateSettings({ scrollSpeed: next }) },
      ]);
    }
    if (mode === 'fonts-notes' || mode === 'fonts-headings' || mode === 'fonts-code') {
      if (!fonts) return [];
      const code = mode === 'fonts-code';
      const headings = mode === 'fonts-headings';
      const apply = headings ? applyHeadingFont : applyNotesFont;
      const pool: FontInfo[] = [{ family: '', category: code ? 'Built in: Commit Mono' : headings ? 'Built in: Literata' : 'Built in: SF Pro' }, ...(code ? fonts.filter((f) => f.category === 'Monospace') : fonts)];
      const current = code ? originalFonts.current.code : headings ? originalFonts.current.headings : originalFonts.current.notes;
      const builtIn = code ? MONO : headings ? LITERATA_FACE : SYSTEM;
      // Applies the font at once. Its stack falls back to the built-in face until the file arrives, so nothing waits on the network;
      // the terminals are re-measured once it has loaded.
      const preview = (family: string) => {
        const seq = ++previewSeq.current;
        if (code) useStore.getState().updateSettings({ fontFamily: family });
        else apply(family);
        if (!family) return;
        loadGoogleFont(family).then(async (ok) => {
          if (!ok || !code || seq !== previewSeq.current || committed.current) return;
          const { allSessions } = await import('../lib/termSession');
          allSessions().forEach((s) => s.applyAppearance());
        });
      };
      return fuzzyFilter(query, pool, (f) => f.family || 'Default', 70).map((h) => ({
        key: h.item.family || 'default', label: h.item.family || 'Default', positions: h.item.family ? h.positions : [],
        face: h.item.family ? `"${h.item.family}", ${code ? MONO : SYSTEM}` : builtIn,
        load: h.item.family || undefined,
        detail: h.item.category + (h.item.family === current ? ', in use' : ''),
        preview: () => preview(h.item.family),
        run: () => {
          const family = h.item.family;
          const s = useStore.getState();
          previewSeq.current++;
          committed.current = true;
          if (code) s.updateSettings({ fontFamily: family });
          else { apply(family); s.updateSettings(headings ? { headingFont: family } : { notesFont: family }); }
          s.showToast(family ? `Using ${family}` : 'Using the built-in font');
          close();
          if (family) loadGoogleFont(family).then(async (ok) => {
            if (!ok) { useStore.getState().showToast(`Could not load ${family}. Check your connection.`); return; }
            if (code) (await import('../lib/termSession')).allSessions().forEach((x) => x.applyAppearance());
          });
        },
      }));
    }
    if (mode === 'commands') {
      const usable = commands.filter((c) => !/^tab\.\d$/.test(c.id) && (!c.when || c.when()));
      return fuzzyFilter(query, usable, (c) => c.title, 60).map((h) => ({
        key: h.item.id, label: h.item.title, positions: h.positions, hint: h.item.keys?.[0] ? formatKeys(h.item.keys[0]) : undefined,
        run: () => { close(false); h.item.run(); if (!useStore.getState().palette) { const id = focusedId(); if (id && !['sidebar.search'].includes(h.item.id)) focusPane(id); } },
      }));
    }
    if (mode === 'files') {
      if (!files) return [];
      // What sits inside a dot folder (.git, .venv, .claude, .obsidian) is machinery, not something to go looking for:
      // it is left out unless the search itself asks for one, with a part that starts with a dot.
      const seen = /(^|[/\s])\./.test(query) ? files : files.filter((f) => !/(^|\/)\.[^/]+\//.test(f));
      // Notes only. A dot anywhere in the search (an extension such as .ts, a dot folder) brings in every other kind of file.
      const pool = query.includes('.') ? seen : seen.filter(isMarkdown);
      const row = (rel: string, positions: number[]): Row => {
        const slash = rel.lastIndexOf('/');
        return {
          key: rel, label: basename(rel), detail: slash >= 0 ? rel.slice(0, slash) : '', positions,
          // In the editor used last; with ⌘, in a new editor beside it.
          run: (side?: boolean) => { close(false); useStore.getState().openFile(`${root}/${rel}`, null, side ? { beside: 'right' } : undefined); },
        };
      };
      // The list arrives last edited first, and that order is kept: with nothing typed, and for every file whose name
      // holds each typed word. Looser matches (letters spread through the path) follow, best match first.
      const LIMIT = 60;
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      if (!words.length) return pool.slice(0, LIMIT).map((f) => row(f, []));
      const named: Row[] = [];
      const taken = new Set<string>();
      for (const f of pool) {
        if (named.length >= LIMIT) break;
        const name = basename(f).toLowerCase();
        const at = words.map((w) => name.indexOf(w));
        if (at.some((i) => i < 0)) continue;
        taken.add(f);
        named.push(row(f, at.flatMap((i, k) => Array.from({ length: words[k].length }, (_, j) => i + j))));
      }
      if (named.length >= LIMIT) return named;
      const loose = fuzzyFilter(query, pool.filter((f) => !taken.has(f)), (f) => f, LIMIT - named.length).map((h) => {
        const slash = h.item.lastIndexOf('/');
        return row(h.item, h.positions.filter((p) => p > slash).map((p) => p - slash - 1));
      });
      return [...named, ...loose];
    }
    if (mode === 'history') {
      const recent = [...history].reverse();
      return fuzzyFilter(query, recent, (c) => c, 80).map((h, i) => ({
        key: `${i}:${h.item}`, label: h.item.split('\n')[0], positions: h.positions,
        run: () => { const pane = activeTermPane(); close(); if (pane) bus.emit('input.set', { pane: pane.id, text: h.item }); },
      }));
    }
    return fuzzyFilter(query, THEMES, (t) => t.name).map((h) => ({
      key: h.item.id, label: h.item.name, detail: h.item.dark ? 'Dark' : 'Light', positions: h.positions,
      preview: () => { applyTheme(h.item); setMonacoTheme(h.item); bus.emit('theme.preview', h.item.id); },
      run: () => { committed.current = true; useStore.getState().updateSettings({ theme: h.item.id }); setMonacoTheme(h.item); close(); },
    }));
  }, [mode, query, files, fonts, root, settings]);

  useEffect(() => { setIndex(0); }, [query, mode]);
  // Keyed on the highlighted row, not the row list: a preview changes settings, which rebuilds the list.
  const activeKey = rows[index]?.key;
  useEffect(() => {
    rows[index]?.preview?.();
    listRef.current?.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' });
  }, [index, activeKey, mode]);

  // Each font's stylesheet is fetched as its row scrolls into view, so the list shows every name in its own face.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      const family = (e.target as HTMLElement).dataset.font;
      if (family) loadGoogleFont(family);
    }), { root: list });
    list.querySelectorAll<HTMLElement>('[data-font]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [rows]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); back(); }
    else if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) { e.preventDefault(); setIndex((i) => Math.min(rows.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); rows[index]?.run(e.metaKey); }
  };
  const onChange = (v: string) => {
    if (mode === 'files' && v.startsWith('>')) { setMode('commands'); setQuery(v.slice(1).trimStart()); return; }
    setQuery(v);
  };

  const empty = mode === 'files' && !files ? 'Listing files…'
    : mode === 'files' ? (query.includes('.') ? 'No file matches that name.' : 'No note matches that name. Type a . to look through every file.')
    : mode === 'history' ? (history.length ? 'No past command matches.' : 'No command history yet.')
    : (mode === 'fonts-notes' || mode === 'fonts-headings' || mode === 'fonts-code') ? (!fonts ? 'Fetching the Google Fonts list…' : fonts.length ? 'No font matches that name.' : 'Could not reach Google Fonts. Check your connection.')
    : 'Nothing matches.';

  return (
    <div className="palette-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="palette" role="dialog" aria-label="Palette">
        <input ref={inputRef} value={query} placeholder={PLACEHOLDER[mode]} spellCheck={false} onChange={(e) => onChange(e.target.value)} onKeyDown={onKey} />
        {/* Clicking a row keeps the keyboard in the search box, so Escape still steps back. */}
        <div className="palette-list" ref={listRef} onMouseDown={(e) => e.preventDefault()}>
          {rows.length === 0 && <div className="palette-empty">{empty}</div>}
          {rows.map((r, i) => (
            <div key={r.key} data-font={r.load} className={`palette-row${i === index ? ' is-selected' : ''}${mode === 'history' ? ' is-mono' : ''}`} onMouseMove={() => i !== index && setIndex(i)} onClick={(e) => r.run(e.metaKey)}>
              <span className="palette-label" style={r.face ? { fontFamily: r.face } : undefined}><Highlight text={r.label} positions={r.positions} /></span>
              {r.detail && <span className="palette-detail">{r.detail}</span>}
              {r.hint && <kbd>{r.hint}</kbd>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Highlight({ text, positions }: { text: string; positions?: number[] }) {
  if (!positions?.length) return <>{text}</>;
  const set = new Set(positions);
  const out: React.ReactNode[] = [];
  let run = ''; let on = false;
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i);
    if (hit !== on && run) { out.push(on ? <b key={i}>{run}</b> : run); run = ''; }
    on = hit; run += text[i];
  }
  if (run) out.push(on ? <b key="end">{run}</b> : run);
  return <>{out}</>;
}
