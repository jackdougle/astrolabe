import { useEffect, useMemo, useRef, useState } from 'react';
import { api, basename } from '../lib/api';
import { bindingConflict, commandKeys, commands, defaultBindingConflict, formatKeys, handleShortcut, hotkeys, keyOf, setCommandKeys, shortcutLabel } from '../lib/commands';
import { applyHeadingFont, applyNotesFont, BUNDLED, faceOf, FontInfo, googleFonts, loadGoogleFont, SYSTEM } from '../lib/fonts';
import { fuzzyFilter } from '../lib/fuzzy';
import { history, MONO, setMonacoTheme } from '../lib/monaco';
import { bus, focusPane } from '../lib/panes';
import { activeTermPane, DEFAULT_SETTINGS, focusedId, isMarkdown, outputWeight, PaletteMode, projectRoot, Settings, useStore } from '../lib/store';
import { Icon } from './Icons';
import { applyTheme, getTheme, THEMES, type Theme } from '../lib/themes';

interface Row { theme?: Theme; size?: FontSizeKey; key: string; label: string; detail?: string; hint?: string; positions?: number[]; /** `side`: chosen with ⌘ held. */ run: (side?: boolean) => void; preview?: () => void; /** CSS font stack the label is drawn in. */ face?: string; /** Google Fonts family to fetch once the row is on screen. */ load?: string }
const LITERATA_FACE = '"Literata Variable", Georgia, serif';

const PLACEHOLDER: Record<PaletteMode, string> = {
  commands: 'Run a command',
  files: 'Open a note by name, last edited first (⌘↩: to the side). A . brings in other files, > commands',
  history: 'Search past commands',
  themes: 'Themes',
  'fonts-notes': 'Search Google Fonts for the text of notes',
  'fonts-headings': 'Search Google Fonts for note headings',
  'fonts-code': 'Search monospaced Google Fonts for the terminal and editor',
  settings: 'Settings',
  appearance: '',
  fonts: 'Fonts and sizes',
  behaviour: 'Editing, terminal and session options',
  keys: 'Search hotkeys (Enter to edit)',
};

// Escape steps back to the menu a mode was opened from; the top-level modes close.
const PARENT: Partial<Record<PaletteMode, PaletteMode>> = {
  appearance: 'settings', fonts: 'settings', behaviour: 'settings',
  'fonts-notes': 'fonts', 'fonts-headings': 'fonts', 'fonts-code': 'fonts',
};

type Choice = Omit<Row, 'positions'>;
const SCROLL_STEPS = [1, 1.5, 2, 2.5, 3, 4];
const WEIGHTS: Record<number, string> = { 400: 'Regular', 500: 'Medium', 600: 'Semibold' };
type FontSizeKey = 'fontSize' | 'notesSize' | 'headingSize' | 'sidebarSize';
const px = (value: number) => Number(value.toFixed(2));
function sizeInPx(settings: Settings, field: FontSizeKey) {
  if (field === 'notesSize') return px(settings.notesSize * 14);
  if (field === 'headingSize') return px(settings.headingSize ?? settings.notesSize * 14 * 2.2);
  return settings[field];
}

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
  const [editing, setEditing] = useState<string>();
  const [recording, setRecording] = useState<number>();
  const [bindingError, setBindingError] = useState('');
  const binding = commands.find((c) => c.id === editing);
  const shortcuts = binding ? commandKeys(binding) : [];
  const lightCommand = commands.find((c) => c.id === 'view.light')!;
  const lightKeys = commandKeys(lightCommand);
  const committed = useRef(false);

  const settings = useStore((s) => s.settings);
  // Undo any preview (a theme or font shown while moving through the list) that was not chosen.
  const revertPreview = () => {
    previewSeq.current++;
    if (committed.current) return;
    if (mode === 'themes' || mode === 'appearance') { const t = getTheme(useStore.getState().settings.theme); applyTheme(t, useStore.getState().settings.accentColor); setMonacoTheme(t); bus.emit('theme.preview'); }
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
  const flip = (key: 'wordWrap' | 'smoothCaret' | 'restoreSession' | 'previewTabs' | 'reviewChanges' | 'starfield' | 'noteTitle' | 'titleWires') => {
    const patch: Partial<Settings> = { [key]: !useStore.getState().settings[key] };
    useStore.getState().updateSettings(patch);
  };
  const choose = (items: Choice[]): Row[] => fuzzyFilter(query, items, (c) => c.label, 60).map((h) => ({ ...h.item, positions: h.positions }));

  useEffect(() => { inputRef.current?.focus(); }, [mode]); // also after a row has taken you to another list, so typing searches it
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
    const weightNow = Number(outputWeight(settings));
    const weightNext = weightNow >= 600 ? 400 : weightNow + 100;
    if (mode === 'settings') return choose([
      { key: 'appearance', label: 'Appearance and themes', run: () => go('appearance') },
      { key: 'fonts', label: 'Fonts', run: () => go('fonts') },
      { key: 'behaviour', label: 'Behaviour', run: () => go('behaviour') },
      { key: 'keys', label: 'Hotkeys', run: () => go('keys') },
      { key: 'file', label: 'Open settings file', hint: shortcutLabel('settings.open'), run: () => { close(); commands.find((c) => c.id === 'settings.open')?.run(); } },
    ]);
    const themeRows = () => choose(THEMES.filter((t) => t.dark === getTheme(settings.theme).dark).map((t) => ({
      key: `theme:${t.id}`, label: t.name.replace(/^(GitHub) (?:Dark|Light)/, '$1').replace(/^Pure White$/, 'Pure').replace(/^Tokyo Night Day$/, 'Tokyo Night'),
      theme: t,
      preview: () => { applyTheme(t, settings.accentColor); setMonacoTheme(t); bus.emit('theme.preview', t.id); },
      run: () => { committed.current = true; useStore.getState().updateSettings({ theme: t.id }); setMonacoTheme(t); close(); },
    })));
    if (mode === 'themes') return themeRows();
    if (mode === 'appearance') return [...choose([
      { key: 'starfield', label: 'Starfield behind the window', detail: on(settings.starfield), run: () => flip('starfield') },
      { key: 'accent-color', label: 'Accent colour', detail: settings.accentColor, run: () => {
        const value = window.prompt('Accent colour (hex)', settings.accentColor);
        if (value && /^#[0-9a-f]{6}$/i.test(value.trim())) useStore.getState().updateSettings({ accentColor: value.trim() });
      } },
      { key: 'noteTitle', label: 'File name as a title on rendered notes', detail: on(settings.noteTitle), run: () => flip('noteTitle') },
      { key: 'titleWires', label: 'Wire artwork around the note title', detail: settings.noteTitle ? on(settings.titleWires) : 'Off (the title is off)', run: () => flip('titleWires') },
    ]), ...themeRows()];
    if (mode === 'fonts') return choose([
      { key: 'code', size: 'fontSize', label: 'Terminal and code font', detail: settings.fontFamily || 'Commit Mono, built in', run: () => go('fonts-code') },
      { key: 'notes', size: 'notesSize', label: 'Notes text font', detail: settings.notesFont || 'SF Pro, built in', run: () => go('fonts-notes') },
      { key: 'headings', size: 'headingSize', label: 'Notes heading font', detail: settings.headingFont || 'Literata, built in', run: () => go('fonts-headings') },
      { key: 'navigator', size: 'sidebarSize', label: 'Navigator', run: () => listRef.current?.querySelector<HTMLInputElement>('[data-size="sidebarSize"] input')?.focus() },
      { key: 'outputWeight', label: `Terminal text weight: ${WEIGHTS[weightNow]}`, detail: `click for ${WEIGHTS[weightNext].toLowerCase()}`, run: () => useStore.getState().updateSettings({ outputWeight: weightNext }) },
      { key: 'reset', label: 'Reset font sizes', run: () => {
        const { fontSize, notesSize, headingSize, sidebarSize } = DEFAULT_SETTINGS;
        useStore.getState().updateSettings({ fontSize, notesSize, headingSize, sidebarSize });
      } },
    ]);
    // Options stay open while you change them, so you can try several in a row.
    if (mode === 'behaviour') {
      const next = SCROLL_STEPS[(SCROLL_STEPS.indexOf(settings.scrollSpeed) + 1) % SCROLL_STEPS.length] ?? 2.5;
      return choose([
        { key: 'caret', label: 'Smooth caret', detail: on(settings.smoothCaret), run: () => flip('smoothCaret') },
        { key: 'preview', label: 'Temporary tabs for opened files', detail: on(settings.previewTabs), run: () => flip('previewTabs') },
        { key: 'review', label: 'Mark changes made from outside, to keep or undo', detail: on(settings.reviewChanges), run: () => flip('reviewChanges') },
        { key: 'restore', label: 'Reopen last session on launch', detail: on(settings.restoreSession), run: () => flip('restoreSession') },
        { key: 'scroll', label: `Scroll speed ${settings.scrollSpeed}×`, detail: `click for ${next}×`, run: () => useStore.getState().updateSettings({ scrollSpeed: next }) },
      ]);
    }
    if (mode === 'fonts-notes' || mode === 'fonts-headings' || mode === 'fonts-code') {
      if (!fonts) return [];
      const code = mode === 'fonts-code';
      const headings = mode === 'fonts-headings';
      const apply = headings ? applyHeadingFont : applyNotesFont;
      // The families that ship with the app come first for notes, and are there even when the catalogue could not be fetched.
      const shipped: FontInfo[] = code ? [] : Object.keys(BUNDLED).map((family) => ({ family, category: 'Built in' }));
      const pool: FontInfo[] = [{ family: '', category: code ? 'Built in: Commit Mono' : headings ? 'Built in: Literata' : 'Built in: SF Pro' }, ...shipped, ...(code ? fonts.filter((f) => f.category === 'Monospace') : fonts.filter((f) => !BUNDLED[f.family]))];
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
        face: h.item.family ? `"${faceOf(h.item.family)}", ${code ? MONO : SYSTEM}` : builtIn,
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
    if (mode === 'keys') {
      return fuzzyFilter(query, hotkeys(), (k) => k.title, 200).map((h, i) => ({
        key: h.item.id ?? `key${i}:${h.item.title}`, label: h.item.title, positions: h.positions, hint: h.item.keys,
        run: () => { if (h.item.id) { setBindingError(''); setEditing(h.item.id); } },
      }));
    }
    if (mode === 'commands') {
      const usable = commands.filter((c) => !/^tab\.\d$/.test(c.id) && (!c.when || c.when()));
      return fuzzyFilter(query, usable, (c) => c.title, 60).map((h) => ({
        key: h.item.id, label: h.item.title, positions: h.positions, hint: commandKeys(h.item).slice(0, 1).map(formatKeys)[0],
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
    return [];
  }, [mode, query, files, fonts, root, settings]);

  useEffect(() => { setIndex(0); }, [query, mode]);
  // Keyed on the highlighted row, not the row list: a preview changes settings, which rebuilds the list.
  const activeKey = rows[index]?.key;
  useEffect(() => {
    if (mode === 'appearance' || mode === 'themes') revertPreview();
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
    if (binding && recording !== undefined) {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { setRecording(undefined); setBindingError(''); return; }
      if (e.repeat || e.nativeEvent.isComposing) return;
      const key = keyOf(e.nativeEvent);
      if (!key) return;
      if (!(/[+]/.test(key) || /^f(?:[1-9]|1[0-9]|2[0-4])$/.test(key))) {
        setBindingError('Use a modifier or a function key.'); return;
      }
      const other = key === shortcuts[recording] ? undefined : bindingConflict(binding.id, key);
      if (other || shortcuts.some((k, i) => k === key && i !== recording)) {
        setBindingError(other ? `Already assigned to ${other.title}` : 'Already assigned to this action'); return;
      }
      const next = [...shortcuts]; next[recording] = key;
      setCommandKeys(binding.id, next);
      setRecording(undefined); setBindingError('');
      return;
    }
    if (binding) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditing(undefined); inputRef.current?.focus(); }
      return;
    }
    if (handleShortcut(e.nativeEvent, 'view.light')) {
      setIndex(mode === 'themes' || rows[0]?.theme ? -1 : 0);
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); back(); }
    else if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) { e.preventDefault(); setIndex((i) => Math.min(rows.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); rows[index]?.run(e.metaKey); }
  };
  const capture = (i: number) => { setRecording(i); setBindingError(''); inputRef.current?.focus(); };
  const renderRow = (r: Row, i: number) => {
    const t = r.theme;
    const inUse = t?.id === settings.theme;
    return (
      <div key={r.key} data-font={r.load} className={`palette-row${i === index ? ' is-selected' : ''}${mode === 'history' ? ' is-mono' : ''}${t ? ' is-theme-row' : ''}${inUse ? ' is-in-use' : ''}`}
        style={t ? { background: t.bg, color: t.text, '--tile-line': t.line } as React.CSSProperties : undefined}
        aria-label={inUse ? `${r.label}, in use` : undefined}
        onMouseMove={() => i !== index && setIndex(i)} onClick={(e) => r.run(e.metaKey)}>
        {t && <ThemePreview theme={t} />}
        <span className={t ? 'theme-name' : 'palette-label'} title={t ? r.label : undefined}
          style={r.face ? { fontFamily: r.face } : undefined}>
          <Highlight text={r.label} positions={r.positions} />
        </span>
        {r.detail && <span className="palette-detail">{r.detail}</span>}
        {r.hint && <kbd>{r.hint}</kbd>}
        {r.size && <FontSizeControl field={r.size} label={r.label} value={sizeInPx(settings, r.size)} returnFocus={() => inputRef.current?.focus()} />}
      </div>
    );
  };
  const firstTheme = rows.findIndex((r) => r.theme);
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
        <input ref={inputRef} aria-label={binding ? 'Record a shortcut' : 'Search palette'} readOnly={!!binding} value={binding ? recording === undefined ? binding.title : 'Press a new shortcut • Esc to cancel' : query}
          placeholder={PLACEHOLDER[mode]} spellCheck={false} onChange={(e) => onChange(e.target.value)} onKeyDown={onKey} />
        {binding ? <div className="palette-list shortcut-editor" onKeyDown={(e) => { if (e.key === 'Escape') onKey(e); }}>
          {shortcuts.map((key, i) => <div className="shortcut-slot" key={i}>
            <kbd>{formatKeys(key)}</kbd>
            <button onClick={() => capture(i)}>Change</button>
            <button onClick={() => { setCommandKeys(binding.id, shortcuts.filter((_, j) => j !== i)); setRecording(undefined); setBindingError(''); }}>Remove</button>
          </div>)}
          <div className="shortcut-slot">
            <button onClick={() => capture(shortcuts.length)}>Add shortcut</button>
            <button onClick={() => {
              const conflict = defaultBindingConflict(binding);
              setRecording(undefined);
              if (conflict) setBindingError(`A default shortcut is assigned to ${conflict.title}`);
              else { setCommandKeys(binding.id); setBindingError(''); }
            }}>Restore defaults</button>
            <button onClick={() => { setRecording(undefined); setEditing(undefined); inputRef.current?.focus(); }}>Done</button>
          </div>
          {bindingError && <div className="shortcut-error" role="alert">{bindingError}</div>}
        </div> : <div className={`palette-list${mode === 'settings' ? ' is-settings' : ''}${mode === 'appearance' ? ' is-appearance' : ''}`} ref={listRef} onMouseDown={(e) => {
          if ((e.target as Element).closest('.font-size-control')) return;
          e.preventDefault();
          if (document.activeElement?.closest('.font-size-control')) inputRef.current?.focus();
        }}>
          {rows.length === 0 && <div className="palette-empty">{empty}</div>}
          {(firstTheme < 0 ? rows : rows.slice(0, firstTheme)).map(renderRow)}
          {firstTheme >= 0 && <section className={`palette-themes${firstTheme > 0 ? ' has-divider' : ''}`}>
            <div className="palette-theme-header">
              <h2>Theme</h2>
              {lightKeys.length > 0 && <kbd title="Toggle light or dark mode">{formatKeys(lightKeys[0])}</kbd>}
            </div>
            <div className="palette-theme-grid">{rows.slice(firstTheme).map((r, i) => renderRow(r, firstTheme + i))}</div>
          </section>}
        </div>}
      </div>
    </div>
  );
}

function FontSizeControl({ field, label, value, returnFocus }: { field: FontSizeKey; label: string; value: number; returnFocus: () => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancel = useRef(false);
  const min = field === 'headingSize' ? 12 : 8;
  const max = field === 'headingSize' ? 120 : 64;
  const write = (value: number) => {
    if (!Number.isFinite(value)) return;
    const size = px(Math.max(min, Math.min(max, value)));
    const store = useStore.getState();
    if (size === sizeInPx(store.settings, field)) return;
    store.updateSettings({ [field]: field === 'notesSize' ? size / 14 : size });
  };
  const adjust = (direction: number) => write(sizeInPx(useStore.getState().settings, field) + direction * 0.5);
  return (
    <span className="font-size-control" data-size={field} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); returnFocus(); }
    }}>
      <button type="button" aria-label={`Decrease ${label} size`} disabled={value <= min} onClick={() => adjust(-1)}><Icon name="chevron" size={12} /></button>
      <input type="number" inputMode="decimal" min={min} max={max} step="any" aria-label={`${label} size in pixels`}
        value={draft ?? value} onChange={(e) => setDraft(e.currentTarget.value)}
        onBlur={() => {
          if (!cancel.current && draft?.trim()) write(Number(draft));
          cancel.current = false;
          setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== 'Escape') return;
          e.preventDefault(); e.stopPropagation();
          cancel.current = e.key === 'Escape';
          returnFocus();
        }} />
      <button type="button" aria-label={`Increase ${label} size`} disabled={value >= max} onClick={() => adjust(1)}><Icon name="chevron" size={12} /></button>
    </span>
  );
}

function ThemePreview({ theme: t }: { theme: Theme }) {
  const colors = {
    '--preview-shell': t.bgDeep,
    '--preview-line': t.line,
    '--preview-tab': t.surfaceHi,
    '--preview-text': t.text,
    '--preview-dim': t.dim,
    '--preview-accent': t.accent,
    '--preview-bold': t.emphasis?.bold ?? t.text,
    '--preview-italic': t.emphasis?.italic ?? t.text,
    '--preview-link': t.emphasis?.link ?? t.text,
  } as React.CSSProperties;
  return (
    <span className="theme-preview" style={colors} aria-hidden="true">
      <span className="theme-preview-top"><i /><i /></span>
      <span className="theme-preview-sidebar"><i /><i /><i /></span>
      <span className="theme-preview-terminal"><i /><i /></span>
      <span className="theme-preview-editor">
        <i /><i className="theme-preview-bold" /><i className="theme-preview-italic" /><i className="theme-preview-link" />
      </span>
    </span>
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
