import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { basename, dirname } from '../lib/api';
import { closeFileTab, createEntry, noteLink, pickAndAttach, renameEntry } from '../lib/commands';
import { count, Counts, plain } from '../lib/counts';
import { graphRoot, isGraph } from '../lib/graph';
import { useGlass } from '../lib/glass';
import { monacoFinder } from '../lib/find';
import { carried, carry } from '../lib/handoff';
import { attachEmoji, contextValue, loadFile, loneColon, monaco, monoFont, overflowNode } from '../lib/monaco';
import { bus, paneHandles } from '../lib/panes';
import { pasteLink } from '../lib/rawMarkdown';
import { keep as keepChanges, reviewVersion, spans as changeSpans, subscribe as onChanges, undo as undoChanges } from '../lib/review';
import { attachReview, revealNext } from '../lib/reviewMonaco';
import { drawWires, rgb } from '../lib/titleWires';
import { mountRich, RichHandle } from '../lib/richMarkdown';
import { EditorPane as EditorPaneState, focusedId, isMarkdown, projectRoot, scrollSpeed, useStore } from '../lib/store';
import { FindBar } from './FindBar';
import { GraphView } from './GraphView';
import { Icon } from './Icons';

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?/;

// In raw Markdown these typed over a selection go around it instead of replacing it, as ( [ ` already do in the
// editor: the same set as the rendered view (`WRAPS` in richEditing.ts).
const WRAP_KEYS: Record<string, string> = { '*': '*', '_': '_', '"': '"', "'": "'", '{': '}', '<': '>', '“': '”', '‘': '’' };
function handleWrapKey(editor: monaco.editor.IStandaloneCodeEditor, e: monaco.IKeyboardEvent) {
  const key = e.browserEvent.key;
  const close = WRAP_KEYS[key];
  if (!close || e.metaKey || e.ctrlKey || e.browserEvent.isComposing) return;
  const sels = editor.getSelections();
  if (editor.getModel()?.getLanguageId() !== 'markdown' || !sels?.length || sels.some((s) => s.isEmpty())) return;
  e.preventDefault(); e.stopPropagation();
  const at = sels.flatMap((s) => [s.getStartPosition(), s.getEndPosition()]);
  // The words stay selected, so a second * makes them bold.
  const start = (ln: number, col: number) => col + at.filter((p) => p.lineNumber === ln && p.column <= col).length;
  const end = (ln: number, col: number) => col + at.filter((p) => p.lineNumber === ln && p.column < col).length;
  editor.pushUndoStop();
  editor.executeEdits('wrap', at.map((p, i) => ({ range: monaco.Range.fromPositions(p), text: i % 2 ? close : key, forceMoveMarkers: true })),
    sels.map((s) => monaco.Selection.createWithDirection(s.startLineNumber, start(s.startLineNumber, s.startColumn), s.endLineNumber, end(s.endLineNumber, s.endColumn), s.getDirection())));
  editor.pushUndoStop();
}

/** ⌘U in raw Markdown with words selected: puts <u></u> around each selection, or takes it away again (the tags may be
 *  inside the selection or just outside it). The words stay selected. False when there is nothing to underline. */
function toggleUnderline(editor: monaco.editor.IStandaloneCodeEditor) {
  const model = editor.getModel();
  const sels = editor.getSelections() ?? [];
  if (!model || model.getLanguageId() !== 'markdown' || !sels.length || sels.some((s) => s.isEmpty())) return false;
  const OPEN = '<u>'; const CLOSE = '</u>';
  const full = model.getValue();
  // Each selection as offsets in the text as it is now, first to last.
  const spans = sels.map((s) => [model.getOffsetAt(s.getStartPosition()), model.getOffsetAt(s.getEndPosition())]).sort((x, y) => x[0] - y[0]);
  const edits: monaco.editor.IIdentifiedSingleEditOperation[] = [];
  const words: [number, number][] = [];
  let delta = 0;
  for (const [a, b] of spans) {
    const text = full.slice(a, b);
    let from = a; let to = b; let put: string; let at: number;
    if (text.length >= OPEN.length + CLOSE.length && text.toLowerCase().startsWith(OPEN) && text.toLowerCase().endsWith(CLOSE)) {
      put = text.slice(OPEN.length, -CLOSE.length); at = 0;
    } else if (full.slice(a - OPEN.length, a).toLowerCase() === OPEN && full.slice(b, b + CLOSE.length).toLowerCase() === CLOSE) {
      from = a - OPEN.length; to = b + CLOSE.length; put = text; at = 0;
    } else { put = OPEN + text + CLOSE; at = OPEN.length; }
    edits.push({ range: monaco.Range.fromPositions(model.getPositionAt(from), model.getPositionAt(to)), text: put });
    const start = from + delta + at;
    words.push([start, start + (put.length - (at ? OPEN.length + CLOSE.length : 0))]);
    delta += put.length - (to - from);
  }
  editor.pushUndoStop();
  editor.executeEdits('underline', edits);
  editor.setSelections(words.map(([x, y]) => { const p = model.getPositionAt(x); const q = model.getPositionAt(y); return new monaco.Selection(p.lineNumber, p.column, q.lineNumber, q.column); }));
  editor.pushUndoStop();
  return true;
}

/** ⇧⌘X in raw Markdown: puts ~~ around each selection (the word at the caret when nothing is selected), or takes it away again. */
function toggleStrike(editor: monaco.editor.IStandaloneCodeEditor) {
  const model = editor.getModel();
  if (!model || model.getLanguageId() !== 'markdown') return;
  const edits: monaco.editor.IIdentifiedSingleEditOperation[] = [];
  for (const sel of editor.getSelections() ?? []) {
    let range: monaco.Range = sel;
    if (sel.isEmpty()) {
      const word = model.getWordAtPosition(sel.getPosition());
      if (!word) continue;
      range = new monaco.Range(sel.startLineNumber, word.startColumn, sel.startLineNumber, word.endColumn);
    }
    const text = model.getValueInRange(range);
    // The tildes may be inside the selection or just outside it.
    const around = new monaco.Range(range.startLineNumber, Math.max(1, range.startColumn - 2), range.endLineNumber, range.endColumn + 2);
    const outer = model.getValueInRange(around);
    if (text.length >= 4 && text.startsWith('~~') && text.endsWith('~~')) edits.push({ range, text: text.slice(2, -2) });
    else if (outer.length === text.length + 4 && outer.startsWith('~~') && outer.endsWith('~~')) edits.push({ range: around, text });
    else edits.push({ range, text: `~~${text}~~` });
  }
  if (!edits.length) return;
  editor.pushUndoStop();
  editor.executeEdits('strike', edits);
  editor.pushUndoStop();
}

/** Renumbers the numbered items of the list around lines `from`..`to`: each level counts on from the item above
 *  it at that level. A level that begins at or below `fresh` (the first line just indented or outdented) begins at 1. */
function renumberList(editor: monaco.editor.IStandaloneCodeEditor, model: monaco.editor.ITextModel, from: number, to: number, fresh = Infinity) {
  const tab = model.getOptions().tabSize;
  const width = (s: string) => { let w = 0; for (const ch of s) w += ch === '\t' ? tab - (w % tab) : 1; return w; };
  // The list runs while lines are items, indented under one, or blank.
  const inside = (ln: number) => { const t = model.getLineContent(ln); return t.trim() === '' || /^\s/.test(t) || LIST_ITEM.test(t); };
  let top = from;
  let bottom = to;
  while (top > 1 && inside(top - 1)) top -= 1;
  while (bottom < model.getLineCount() && inside(bottom + 1)) bottom += 1;
  const levels: { indent: number; next: number | null }[] = [];
  const edits: monaco.editor.IIdentifiedSingleEditOperation[] = [];
  let fenced = false;
  for (let ln = top; ln <= bottom; ln++) {
    const text = model.getLineContent(ln);
    if (/^\s*(```|~~~)/.test(text)) { fenced = !fenced; continue; }
    const m = fenced ? null : LIST_ITEM.exec(text);
    if (!m) continue;
    const indent = width(m[1]);
    const num = /^(\d+)[.)]$/.exec(m[2]);
    while (levels.length && levels[levels.length - 1].indent > indent) levels.pop();
    let level = levels[levels.length - 1];
    if (!level || level.indent < indent) { level = { indent, next: null }; levels.push(level); }
    if (!num) { level.next = null; continue; } // a bullet ends the count at its level
    const want: number = level.next ?? (ln >= fresh ? 1 : Number(num[1]));
    level.next = want + 1;
    if (String(want) !== num[1]) edits.push({ range: new monaco.Range(ln, m[1].length + 1, ln, m[1].length + 1 + num[1].length), text: String(want) });
  }
  if (!edits.length) return;
  // Carets after a number that changed width keep their place in the text.
  const moved = (ln: number, col: number) => col + edits.reduce((d, e) => d + (e.range.startLineNumber === ln && e.range.endColumn <= col ? e.text!.length - (e.range.endColumn - e.range.startColumn) : 0), 0);
  const sels = (editor.getSelections() ?? []).map((s) => new monaco.Selection(s.selectionStartLineNumber, moved(s.selectionStartLineNumber, s.selectionStartColumn), s.positionLineNumber, moved(s.positionLineNumber, s.positionColumn)));
  editor.executeEdits('list', edits, sels.length ? sels : undefined);
}

/** Notion-style list editing in raw Markdown: Enter continues a list, Enter on an empty item ends it, Tab and Shift+Tab nest. */
function handleListKey(editor: monaco.editor.IStandaloneCodeEditor, e: monaco.IKeyboardEvent) {
  const model = editor.getModel();
  const sel = editor.getSelection();
  const lang = model?.getLanguageId();
  if (!model || !sel || (lang !== 'markdown' && lang !== 'plaintext') || (editor.getSelections()?.length ?? 1) > 1) return;
  const K = monaco.KeyCode;
  const line = model.getLineContent(sel.startLineNumber);
  if (e.keyCode === K.Enter && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    // A bare ":" opens emoji suggestions; Enter there is a new line, not "pick the first emoji".
    if (contextValue(editor, 'suggestWidgetVisible') && loneColon(line.slice(0, sel.startColumn - 1))) editor.trigger('astrolabe', 'hideSuggestWidget', {});
    if (sel.isEmpty() && line.trim() === '/file') {
      e.preventDefault(); e.stopPropagation();
      editor.executeEdits('attach', [{ range: new monaco.Range(sel.startLineNumber, 1, sel.startLineNumber, line.length + 1), text: '' }]);
      pickAndAttach();
      return;
    }
  }
  const m = lang === 'markdown' ? LIST_ITEM.exec(line) : null;
  // ⌘Enter on a task's line ticks or unticks it.
  if (m?.[4] && e.keyCode === K.Enter && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    e.preventDefault(); e.stopPropagation();
    const ln = sel.startLineNumber;
    const col = m[1].length + m[2].length + m[3].length + 2; // the character between the brackets
    editor.executeEdits('task', [{ range: new monaco.Range(ln, col, ln, col + 1), text: m[4][1] === ' ' ? 'x' : ' ' }], editor.getSelections() ?? undefined);
    return;
  }
  if (lang !== 'markdown' || e.metaKey || e.ctrlKey || e.altKey || contextValue(editor, 'suggestWidgetVisible')) return;
  if (!m) return;
  const [marker, indent, bullet, gap, task] = m;
  const stop = () => { e.preventDefault(); e.stopPropagation(); };

  if (e.keyCode === K.Enter && !e.shiftKey && sel.isEmpty() && sel.startColumn > marker.length) {
    stop();
    const ln = sel.startLineNumber;
    if (line.slice(marker.length).trim() === '') {
      // An empty item: step out one level, or leave the list.
      const text = indent.length >= 2 ? line.slice(Math.min(indent.length, model.getOptions().tabSize)) : '';
      editor.executeEdits('list', [{ range: new monaco.Range(ln, 1, ln, line.length + 1), text }], [new monaco.Selection(ln, text.length + 1, ln, text.length + 1)]);
      return;
    }
    const num = /^(\d+)([.)])$/.exec(bullet);
    const next = `${indent}${num ? `${Number(num[1]) + 1}${num[2]}` : bullet}${gap}${task ? '[ ] ' : ''}`;
    editor.executeEdits('list', [{ range: sel, text: `\n${next}` }], [new monaco.Selection(ln + 1, next.length + 1, ln + 1, next.length + 1)]);
    editor.revealPosition({ lineNumber: ln + 1, column: next.length + 1 });
    if (num) renumberList(editor, model, ln + 1, ln + 1); // the items below count on from the new one
  } else if (e.keyCode === K.Tab) {
    stop();
    editor.trigger('list', e.shiftKey ? 'editor.action.outdentLines' : 'editor.action.indentLines', {});
    // Numbers follow the item above at the new level (or start from 1 under it), and close up where the lines left.
    renumberList(editor, model, sel.startLineNumber, sel.endLineNumber, sel.startLineNumber);
  }
}

export function EditorPane({ pane, active }: { pane: EditorPaneState; active: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const richRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const richHandle = useRef<RichHandle | null>(null);
  const viewStates = useRef(new Map<string, monaco.editor.ICodeEditorViewState | null>());
  const shownPath = useRef<string | null>(null);
  const keptScroll = useRef(0); // where a rendered note was scrolled to when the window reloaded in place
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(0);
  const [richNote, setRichNote] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const [richUp, setRichUp] = useState(0); // counts the rendered views made, so ⌘F's bar knows a new one is there
  const findWords = useRef('');
  const settings = useStore((s) => s.settings);
  // The editor fills its tab: nothing beside it, or expanded over the rest.
  const file = pane.files.find((f) => f.path === pane.active) ?? null;
  const rendered = !!file && file.rendered && isMarkdown(file.path);
  const renderedRef = useRef(rendered);
  const endDone = useRef(0); // the last end-of-note reveal already applied
  renderedRef.current = rendered;

  const isFocusedPane = () => {
    const s = useStore.getState();
    return !s.palette && focusedId(s) === pane.id;
  };
  // The graph of notes, and an editor with no file in it, are not text: the keyboard goes to their own box.
  const graph = isGraph(pane.active) ? pane.active : null;
  const other = useRef(false);
  other.current = !!graph || !pane.active;
  const focusNow = () => {
    if (other.current) { hostRef.current?.parentElement?.querySelector<HTMLElement>('.graph-find, .editor-empty input')?.focus(); return; }
    if (renderedRef.current && document.activeElement?.classList.contains('rich-title') && richRef.current?.parentElement?.contains(document.activeElement)) return; // the title is being edited
    if (renderedRef.current && richHandle.current) richHandle.current.focus(); else editorRef.current?.focus();
  };

  useEffect(() => {
    const s = useStore.getState().settings;
    const editor = monaco.editor.create(hostRef.current!, {
      model: null, theme: 'astrolabe', fontFamily: monoFont(), fontSize: s.fontSize, lineHeight: 1.55,
      // Lines always wrap: nothing in the app scrolls sideways.
      wordWrap: 'on', wrappingIndent: 'same', scrollBeyondLastColumn: 0,
      cursorSmoothCaretAnimation: s.smoothCaret ? 'on' : 'off', cursorBlinking: 'smooth', cursorWidth: 2,
      smoothScrolling: true, emptySelectionClipboard: true,
      mouseWheelScrollSensitivity: scrollSpeed(s), fastScrollSensitivity: scrollSpeed(s) * 4,
      minimap: { enabled: false }, scrollBeyondLastLine: false, renderLineHighlight: 'line',
      automaticLayout: true, fixedOverflowWidgets: true, overflowWidgetsDomNode: overflowNode, stickyScroll: { enabled: false },
      bracketPairColorization: { enabled: true }, guides: { indentation: true, bracketPairs: false },
      padding: { top: 10, bottom: 24 }, lineNumbersMinChars: 3, lineDecorationsWidth: 12, glyphMargin: false,
      scrollbar: { verticalScrollbarSize: 10, horizontal: 'hidden', horizontalScrollbarSize: 0, useShadows: false },
      overviewRulerBorder: false, unicodeHighlight: { ambiguousCharacters: false },
    });
    editorRef.current = editor;
    editor.onKeyDown((e) => {
      handleWrapKey(editor, e); handleListKey(editor, e);
      if (e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey && e.keyCode === monaco.KeyCode.KeyX) { e.preventDefault(); e.stopPropagation(); toggleStrike(editor); }
      // ⌘U underlines the selected words (<u>words</u>); with nothing selected it hides the terminal (commands.ts).
      if (e.metaKey && !e.shiftKey && !e.ctrlKey && !e.altKey && e.keyCode === monaco.KeyCode.KeyU && toggleUnderline(editor)) { e.preventDefault(); e.stopPropagation(); }
      // ⌃L selects the line, as ⌘L does in VS Code: here ⌘L copies the file's path (commands.ts).
      if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.keyCode === monaco.KeyCode.KeyL) { e.preventDefault(); e.stopPropagation(); editor.trigger('keyboard', 'expandLineSelection', null); }
    });
    attachEmoji(editor, () => ['markdown', 'plaintext'].includes(editor.getModel()?.getLanguageId() ?? ''));
    const offReview = attachReview(editor);
    const onPaste = (e: ClipboardEvent) => { pasteLink(editor, e); };
    hostRef.current!.addEventListener('paste', onPaste, true);
    const host = hostRef.current!;
    paneHandles.set(pane.id, { focus: focusNow });
    // ⌘F. The graph and the empty page have a box of their own to type in, and the keyboard goes there.
    const offFind = bus.on('find.toggle', (id) => {
      if (id !== pane.id) return;
      if (other.current) { focusNow(); return; }
      setFinding((on) => { if (on) requestAnimationFrame(focusNow); return !on; });
    });
    // A window reloading in place keeps each file's caret and scroll position.
    type Kept = { views: [string, monaco.editor.ICodeEditorViewState | null][]; scroll: number };
    const kept = carried<Kept>(`editor:${pane.id}`);
    if (kept) { for (const [path, view] of kept.views) viewStates.current.set(path, view); keptScroll.current = kept.scroll; }
    const uncarry = carry(`editor:${pane.id}`, (): Kept => {
      if (shownPath.current) viewStates.current.set(shownPath.current, editor.saveViewState());
      return { views: [...viewStates.current], scroll: renderedRef.current ? richRef.current?.parentElement?.scrollTop ?? 0 : 0 };
    });
    // Files attached from Finder (or dropped on the pane) become links in notes and plain paths in code.
    // A picture is first uploaded or copied beside the note (`noteLink`). Dropped, they go in where they were dropped.
    const offAttach = bus.on('editor.attach', async (arg: { pane: string; paths: string[]; at?: { x: number; y: number } }) => {
      const model = editor.getModel();
      if (arg.pane !== pane.id || !model) return;
      const isNote = model.getLanguageId() === 'markdown';
      const dir = dirname(model.uri.path);
      const parts = isNote ? await Promise.all(arg.paths.map((p) => noteLink(dir, p))) : arg.paths;
      if (editor.getModel() !== model) return; // another file came to the front meanwhile
      const text = parts.join(isNote ? ' ' : '\n');
      if (renderedRef.current && richHandle.current) { richHandle.current.insertMarkdown(text, arg.at); return; }
      const hit = arg.at ? editor.getTargetAtClientPoint(arg.at.x, arg.at.y)?.position : null;
      const range = hit ? { startLineNumber: hit.lineNumber, startColumn: hit.column, endLineNumber: hit.lineNumber, endColumn: hit.column } : editor.getSelection()!;
      editor.executeEdits('attach', [{ range, text, forceMoveMarkers: true }]);
    });
    return () => { offReview(); offAttach(); offFind(); uncarry(); host.removeEventListener('paste', onPaste, true); paneHandles.delete(pane.id); editor.dispose(); editorRef.current = null; };
  }, [pane.id]);

  // Show the active file, keeping each file's scroll position and cursor.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !pane.active) return;
    if (isGraph(pane.active)) {
      if (shownPath.current) viewStates.current.set(shownPath.current, editor.saveViewState());
      editor.setModel(null); shownPath.current = null; setError(null);
      if (isFocusedPane()) requestAnimationFrame(focusNow);
      return;
    }
    let cancelled = false;
    const path = pane.active;
    loadFile(path).then((res) => {
      if (cancelled || !editorRef.current) return;
      if (shownPath.current) viewStates.current.set(shownPath.current, editor.saveViewState());
      if ('error' in res) { editor.setModel(null); shownPath.current = null; setError(res.error); return; }
      setError(null);
      editor.setModel(res.model);
      shownPath.current = path;
      const vs = viewStates.current.get(path);
      if (vs) editor.restoreViewState(vs);
      setLoaded((n) => n + 1);
      if (isFocusedPane() && !renderedRef.current) editor.focus();
    });
    return () => { cancelled = true; };
  }, [pane.active]);

  useEffect(() => {
    const editor = editorRef.current;
    const r = pane.reveal;
    if (!editor || !r || shownPath.current !== r.path) return;
    if (renderedRef.current) return; // the rendered view places its own caret
    const model = editor.getModel();
    const line = r.end && model ? model.getLineCount() : r.line;
    editor.setPosition({ lineNumber: line, column: r.end && model ? model.getLineMaxColumn(line) : r.col });
    editor.revealLineInCenter(line);
    editor.focus();
  }, [pane.reveal?.n, loaded]);

  // Spellcheck follows the setting in both views of a note and in the raw editor. The rendered view is made anew
  // for each file, so this runs again when one is shown (richUp).
  useEffect(() => {
    const on = settings.spellcheck;
    hostRef.current?.querySelectorAll<HTMLElement>('textarea, [contenteditable]').forEach((el) => { el.spellcheck = on; });
    richRef.current?.querySelectorAll<HTMLElement>('.rich').forEach((el) => { el.spellcheck = on; });
  }, [settings.spellcheck, loaded, richUp, rendered]);

  useEffect(() => {
    editorRef.current?.updateOptions({
      cursorSmoothCaretAnimation: settings.smoothCaret ? 'on' : 'off',
      fontSize: settings.fontSize, fontFamily: monoFont(),
      mouseWheelScrollSensitivity: scrollSpeed(settings), fastScrollSensitivity: scrollSpeed(settings) * 4,
    });
  }, [settings.smoothCaret, settings.fontSize, settings.fontFamily, settings.scrollSpeed]);

  // The rendered view is a second editor over the same text: edits made there are written back to the file's buffer.
  useEffect(() => {
    if (!rendered || error) return;
    const model = editorRef.current?.getModel();
    const root = richRef.current;
    if (!model || !root || shownPath.current !== pane.active) return;
    let cancelled = false;
    let handle: RichHandle | null = null;
    root.textContent = '';
    setRichNote(null);
    mountRich(root, model, (note) => { if (!cancelled) setRichNote(note); }).then((h) => {
      if (cancelled) { h.destroy(); return; }
      handle = h; richHandle.current = h; setRichUp((n) => n + 1);
      const r = useStore.getState().panes[pane.id];
      const reveal = r?.kind === 'editor' ? r.reveal : null;
      if (reveal?.end && reveal.path === pane.active && endDone.current !== reveal.n) { endDone.current = reveal.n; h.focusEnd(); }
      else if (isFocusedPane()) h.focus();
      if (keptScroll.current && root.parentElement) { root.parentElement.scrollTop = keptScroll.current; keptScroll.current = 0; }
    });
    return () => { cancelled = true; handle?.destroy(); if (richHandle.current === handle) { richHandle.current = null; setRichUp((n) => n + 1); } root.textContent = ''; };
  }, [rendered, loaded, error]);

  useEffect(() => {
    if (rendered) return;
    editorRef.current?.layout();
    if (isFocusedPane()) editorRef.current?.focus();
  }, [rendered]);

  // Its files are tabs in the row along the top of the window, beside the terminals' (TabStrip in App.tsx).
  return (
    <div className="editor-pane">
      {/* A centred raw note leaves empty margins: the wheel and clicks there still reach the editor. */}
      <div className="editor-body" tabIndex={-1}
        onWheel={(e) => { const ed = editorRef.current; if (e.target === e.currentTarget && ed && !rendered) ed.setScrollTop(ed.getScrollTop() + e.deltaY * scrollSpeed(settings)); }}
        onMouseDown={(e) => { if (e.target === e.currentTarget && !rendered && !error) { e.preventDefault(); editorRef.current?.focus(); } }}>
        <div className={`editor-host${file && isMarkdown(file.path) ? ' is-note' : ''}`} ref={hostRef} style={{ display: rendered || error || graph || !file ? 'none' : undefined }} />
        <div className="markdown" style={{ display: rendered && !error ? undefined : 'none' }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); richHandle.current?.focus(); } }}>
          {file && rendered && settings.noteTitle && <NoteTitle path={file.path} toNote={() => richHandle.current?.focus()} note={richRef} alone={!richNote} />}
          {richNote && <div className="rich-note">{richNote}</div>}
          <div ref={richRef} />
        </div>
        {graph && <GraphView root={graphRoot(graph)} />}
        {!file && <EmptyEditor />}
        {error && <div className="editor-error"><p>{error}</p><button onClick={() => closeFileTab(pane.id, pane.active!)}>Close this tab</button></div>}
      </div>
      {finding && file && !graph && !error && <FindBar placeholder={isMarkdown(file.path) ? 'Find in note' : 'Find in file'} memory={findWords}
        target={rendered ? `note:${richUp}` : 'text'} make={rendered ? (richHandle.current ? (report) => richHandle.current!.finder(report) : null) : (report) => monacoFinder(editorRef.current!, report)}
        onClose={() => { setFinding(false); focusNow(); }} />}
      {file && !graph && !error && <WordCount editor={editorRef} rich={richRef} rendered={rendered} loaded={loaded} />}
      {file && !graph && !error && <ChangesBar pane={pane.id} editor={editorRef} rich={richRef} rendered={rendered} loaded={loaded} />}
    </div>
  );
}

/** Shown at the foot of a file while changes made to it from outside are waiting to be looked at (review.ts): how
 *  many, chevrons to go from one to the next, and Keep all / Undo all. Each change has its own Keep and Undo beside it. */
function ChangesBar({ pane, editor, rich, rendered, loaded }: { pane: string; editor: React.RefObject<monaco.editor.IStandaloneCodeEditor | null>; rich: React.RefObject<HTMLDivElement | null>; rendered: boolean; loaded: number }) {
  useSyncExternalStore(onChanges, reviewVersion);
  const at = useRef(-1);
  const model = editor.current?.getModel() ?? null;
  const list = changeSpans(model);
  useEffect(() => { at.current = -1; }, [loaded]);
  useEffect(() => bus.on('review.act', (arg: { pane: string; what: 'keep' | 'undo' | 'next' | 'prev' }) => {
    if (arg.pane !== pane) return;
    const m = editor.current?.getModel();
    if (!m) return;
    if (arg.what === 'keep') keepChanges(m); else if (arg.what === 'undo') undoChanges(m); else go(arg.what === 'prev');
  }), [pane, rendered]);
  const go = (back: boolean) => {
    const ed = editor.current;
    if (!ed) return;
    if (!rendered) { revealNext(ed, back); ed.focus(); return; }
    const boxes = [...(rich.current?.querySelectorAll<HTMLElement>('.rv-box') ?? [])];
    if (!boxes.length) return;
    at.current = at.current < 0 ? (back ? boxes.length - 1 : 0) : (at.current + (back ? -1 : 1) + boxes.length) % boxes.length;
    boxes[at.current].scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  if (!model || !list.length) return null;
  const offers = list.filter((s) => s.offer).length;
  const made = list.length - offers;
  const label = [made ? many(made, 'change') : '', offers ? `${num(offers)} on your unsaved lines` : ''].filter(Boolean).join(', ');
  return (
    <div className="changes-bar" role="toolbar" aria-label="Changes made outside the editor">
      <span className="changes-n">{label}</span>
      <button className="changes-step" aria-label="Previous change" title="Previous change" onClick={() => go(true)}><Icon name="left" size={12} /></button>
      <button className="changes-step" aria-label="Next change" title="Next change" onClick={() => go(false)}><Icon name="right" size={12} /></button>
      <button className="rv-keep" title="Keep all (⌘K)" onClick={() => keepChanges(model)}>Keep all</button>
      <button className="rv-undo" title="Undo all (⌥⌘N)" onClick={() => undoChanges(model)}>Undo all</button>
    </div>
  );
}

const COUNT_LIMIT = 2_000_000; // characters: a file longer than this is not counted as it is typed in
const num = (n: number) => n.toLocaleString('en-US');
const many = (n: number, one: string) => `${num(n)} ${one}${n === 1 ? '' : 's'}`;

/** The counter in the bottom right corner of a note or a text file (not of code): its words, or how many of them are
 *  selected. A click opens the rest: characters with and without spaces, paragraphs, and how long it takes to read.
 *  A note's Markdown is not counted (counts.ts), so the numbers are the same raw and rendered. */
function WordCount({ editor, rich, rendered, loaded }: { editor: React.RefObject<monaco.editor.IStandaloneCodeEditor | null>; rich: React.RefObject<HTMLDivElement | null>; rendered: boolean; loaded: number }) {
  const [all, setAll] = useState<Counts | null>(null);
  const [picked, setPicked] = useState<Counts | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ed = editor.current;
    const model = ed?.getModel();
    const lang = model?.getLanguageId();
    if (!ed || !model || (lang !== 'markdown' && lang !== 'plaintext') || model.getValueLength() > COUNT_LIMIT) { setAll(null); setPicked(null); return; }
    const read = (text: string) => count(lang === 'markdown' ? plain(text) : text);
    let timer = 0;
    let frame = 0;
    const total = () => { timer = 0; setAll(read(model.getValue())); };
    const selected = () => {
      frame = 0;
      if (rendered) {
        // The rendered view's selection is the page's own. What it still shows as written ([[a note's name]], the #s
        // of the heading the caret is in) is left out here as it is from the whole.
        const sel = document.getSelection();
        const root = rich.current;
        const inside = !!sel && !sel.isCollapsed && !!root && root.contains(sel.anchorNode) && root.contains(sel.focusNode);
        setPicked(inside ? read(sel.toString()) : null);
      } else {
        const sels = (ed.getSelections() ?? []).filter((s) => !s.isEmpty());
        setPicked(sels.length ? read(sels.map((s) => model.getValueInRange(s)).join('\n')) : null);
      }
    };
    const later = () => { if (!frame) frame = requestAnimationFrame(selected); };
    total(); selected();
    const edits = model.onDidChangeContent(() => { if (!timer) timer = window.setTimeout(total, 120); later(); });
    const carets = rendered ? null : ed.onDidChangeCursorSelection(later);
    if (rendered) document.addEventListener('selectionchange', later);
    return () => { window.clearTimeout(timer); cancelAnimationFrame(frame); edits.dispose(); carets?.dispose(); document.removeEventListener('selectionchange', later); };
  }, [loaded, rendered]);

  // A click anywhere else, or Esc, puts it away.
  useEffect(() => {
    if (!open) return;
    const press = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', press, true);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('mousedown', press, true); document.removeEventListener('keydown', key, true); };
  }, [open]);

  // Typing right next to it turns it to glass, so the words under it show; moving the pointer brings it back.
  const clear = useGlass(ref, '.counts-chip', !!all && !open);
  if (!all) return null;
  const rows = (c: Counts) => (<>
    <b>{num(c.words)}</b><span>{c.words === 1 ? 'word' : 'words'}</span>
    <b>{num(c.chars)}</b><span>{c.chars === 1 ? 'character' : 'characters'}</span>
    <b>{num(c.noSpaces)}</b><span>{c.noSpaces === 1 ? 'character' : 'characters'} without spaces</span>
  </>);
  const minutes = !all.words ? '0 min' : all.minutes < 1 ? '< 1 min' : `${Math.round(all.minutes)} min`;
  // The mouse going down here does not take the keyboard from the text, so what is selected there stays selected.
  return (
    <div className={`counts${clear ? ' is-clear' : ''}`} ref={ref} onMouseDown={(e) => e.preventDefault()}>
      {open && (
        <div className="counts-pop" role="dialog" aria-label="Word count">
          {picked && <><div className="counts-head">Selected</div>{rows(picked)}<div className="counts-head">Whole file</div></>}
          {rows(all)}
          <b>{num(all.paragraphs)}</b><span>{all.paragraphs === 1 ? 'paragraph' : 'paragraphs'}</span>
          <b>{minutes}</b><span>to read</span>
        </div>
      )}
      <button className="counts-chip" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {picked ? `${num(picked.words)} of ${many(all.words, 'word')}` : many(all.words, 'word')}
      </button>
    </div>
  );
}

/** A file's name cannot hold a slash. One that arrives anyway (pasted or dictated; the key itself does nothing)
 *  is taken out of the title, and the caret keeps its place. */
function dropSlashes(el: HTMLElement) {
  const text = el.textContent ?? '';
  if (!text.includes('/')) return;
  const sel = window.getSelection();
  let caret = text.length;
  if (sel?.focusNode && el.contains(sel.focusNode)) {
    const upTo = document.createRange();
    upTo.selectNodeContents(el);
    upTo.setEnd(sel.focusNode, sel.focusOffset);
    caret = upTo.toString().length;
  }
  el.textContent = text.replace(/\//g, '');
  if (el.firstChild && sel && document.activeElement === el) sel.collapse(el.firstChild, text.slice(0, caret).replace(/\//g, '').length);
}

/** What an editor shows while it holds no file: a box to name a new one. */
function EmptyEditor() {
  const root = useStore((s) => projectRoot(s));
  const [name, setName] = useState('');
  const make = () => {
    const n = name.trim();
    if (!n) return;
    // A name with no ending is a note.
    void createEntry(root, /\.[^./]+$/.test(n) ? n : `${n}.md`);
  };
  return (
    <div className="editor-empty">
      <div className="editor-empty-title">No file open</div>
      <input value={name} placeholder="Name a new file" spellCheck={false} onChange={(e) => setName(e.target.value.replace(/\//g, ''))}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); make(); } }} />
      <div className="editor-empty-hint">Enter makes it in <b>{basename(root)}</b> (a name with no ending becomes a note). ⌘O opens a file that is already there, ⌘N starts a dated note.</div>
    </div>
  );
}

const measureCtx = document.createElement('canvas').getContext('2d')!;
/** Ascent and descent of an element's font, in pixels. */
function fontBox(el: Element) {
  const cs = getComputedStyle(el);
  measureCtx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`; // the `font` shorthand can come back empty, which would leave the last font set
  const m = measureCtx.measureText('x');
  return { asc: m.fontBoundingBoxAscent, desc: m.fontBoundingBoxDescent };
}
const TITLE_GAP = 28; // clear space kept between the note's first line and a title beside it

/** A title keeps to one line: one too long for it is set smaller until it fits (`--fit` scales its size in styles.css), down to
 *  three tenths of its size; a name longer still is cut short. */
function fitTitle(head: HTMLElement, title: HTMLElement) {
  const now = parseFloat(title.style.getPropertyValue('--fit')) || 1;
  const natural = title.scrollWidth / now; // its width at full size: text grows in step with its size
  const fit = Math.max(0.3, Math.min(1, (head.clientWidth - 2) / natural));
  if (fit === now || (fit < 1 && Math.abs(fit - now) < 0.01)) return; // steady: rounding must not set it shifting back and forth
  if (fit === 1) title.style.removeProperty('--fit'); else title.style.setProperty('--fit', fit.toFixed(3));
}

/** Where the title sits beside the note's first line (how far to lower it so the baselines meet), or null when that line leaves no room. */
function titleBeside(root: HTMLElement | null, head: HTMLElement, title: HTMLElement): number | null {
  const block = root?.querySelector('.rich')?.firstElementChild;
  if (!block || !/^(P|H[1-6]|UL|OL|BLOCKQUOTE)$/.test(block.tagName) || block.querySelector('img')) return null;
  const top = block.getBoundingClientRect().top;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let text = walker.nextNode();
  const range = document.createRange();
  // Text that takes no room is passed over: a heading's #s are there but folded away while the note does not have the keyboard.
  const shown = (node: Node) => { if (!node.nodeValue) return false; range.selectNodeContents(node); return range.getBoundingClientRect().height > 1; };
  while (text && !shown(text)) text = walker.nextNode();
  let right = 0;
  let baseline: number;
  if (text) {
    range.setStart(text, 0); range.setEnd(text, 1);
    const first = range.getBoundingClientRect();
    baseline = first.bottom - fontBox(text.parentElement!).desc;
    // The first line ends where the text first drops below it.
    for (let node: Node | null = text; node; node = walker.nextNode()) {
      range.selectNodeContents(node);
      const rects = [...range.getClientRects()];
      const onLine = rects.filter((r) => r.top < first.top + first.height / 2);
      for (const r of onLine) right = Math.max(right, r.right);
      if (onLine.length < rects.length) break;
    }
  } else {
    let leaf = block; // an empty first line: work the baseline out from its font and line height
    while (leaf.firstElementChild && leaf.firstElementChild.tagName !== 'BR') leaf = leaf.firstElementChild;
    const cs = getComputedStyle(leaf);
    const f = fontBox(leaf);
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
    baseline = leaf.getBoundingClientRect().top + (lh - f.asc - f.desc) / 2 + f.asc;
  }
  // The title is one size whether it sits beside the line or above it, so it is measured as it is.
  const beside = head.classList.contains('is-beside');
  const scale = 1;
  const used = right ? right - head.getBoundingClientRect().left : 0;
  if (used + TITLE_GAP + title.offsetWidth * scale > head.clientWidth + (beside ? 2 : 0)) return null; // a little slack, so it never flips back and forth at the limit
  const f = fontBox(title);
  return Math.round(baseline - top - ((title.offsetHeight - f.asc - f.desc) / 2 + f.asc) * scale);
}

/** The title's letters for the traces, which leave from the letters themselves: what to draw, in which font, where
 *  (the start of the text and its baseline, before its slant) and under which transform, all in the page's own
 *  coordinates. `t` is the title's box on screen, slant included. */
function titleGlyphs(title: HTMLElement, t: DOMRect, x0: number, y0: number) {
  const text = title.textContent ?? '';
  if (!text.trim()) return undefined;
  const cs = getComputedStyle(title);
  const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  // Until the title's own face has loaded it is drawn in a stand-in. (Only the first family is asked about: the
  // whole list is never "ready" while a fallback further down it has not been needed yet.)
  if (!document.fonts.check(`${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily.split(',')[0]}`)) return undefined;
  const f = fontBox(title); // also sets the measuring font
  const w = title.offsetWidth, h = title.offsetHeight;
  const m = new DOMMatrix(cs.transform === 'none' ? undefined : cs.transform);
  const [ox, oy] = cs.transformOrigin.split(' ').map((v) => parseFloat(v) || 0);
  // The box before its slant, from the slanted one: where its corners go under the transform.
  const xs = [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => m.a * (x - ox) + m.c * (y - oy) + m.e + ox);
  const ys = [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => m.b * (x - ox) + m.d * (y - oy) + m.f + oy);
  const left = t.left - Math.min(...xs) - x0, top = t.top - Math.min(...ys) - y0;
  const about = new DOMMatrix().translate(left + ox, top + oy).multiply(m).translate(-(left + ox), -(top + oy));
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return {
    text, font,
    x: round(left + w - measureCtx.measureText(text).width), // the text ends at the box's right edge
    baseline: round(top + (h - f.asc - f.desc) / 2 + f.asc),
    matrix: [about.a, about.b, about.c, about.d, about.e, about.f].map(round),
  };
}

/** What the title's traces keep out of, down to `bottom`: each line of the note's text, from the column's left edge
 *  (`left`) to a little past where the line ends, and every block that is not text as a whole. In the page's own
 *  coordinates: `x0`, `y0` is where the page's corner is on screen. */
function noteBoxes(scroller: HTMLElement, x0: number, y0: number, left: number, bottom: number) {
  const half = (n: number) => Math.round(n * 2) / 2;
  const out: { left: number; top: number; right: number; bottom: number }[] = [];
  const add = (r: DOMRect) => { out.push({ left: half(left), top: half(r.top - y0 - 6), right: half(r.right - x0 + 14), bottom: half(r.bottom - y0 + 6) }); };
  const banner = scroller.querySelector('.rich-note');
  if (banner) add(banner.getBoundingClientRect());
  const range = document.createRange();
  for (const block of scroller.querySelector('.rich')?.children ?? []) {
    const b = block.getBoundingClientRect();
    if (b.top - y0 > bottom) break;
    if (b.height < 1) continue;
    if (!/^(P|H[1-6]|UL|OL|BLOCKQUOTE)$/.test(block.tagName)) { add(b); continue; }
    for (const el of block.querySelectorAll('img, pre, table, hr, .toggle')) add(el.getBoundingClientRect());
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    scan: for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.nodeValue) continue;
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) {
        if (r.top - y0 > bottom) break scan;
        if (r.height > 1 && r.width > 0) add(r);
      }
    }
  }
  return out;
}

/** The note's file name with its rendered text, without the extension: right-aligned beside the first line when that line is short enough, above the note otherwise. Editing it renames the file. */
function NoteTitle({ path, toNote, note, alone }: { path: string; toNote: () => void; note: React.RefObject<HTMLDivElement | null>; alone: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const [drop, setDrop] = useState<number | null>(null);
  useEffect(() => {
    const head = headRef.current, title = ref.current;
    if (!head || !title) return;
    let frame = 0;
    const fit = () => { frame = 0; fitTitle(head, title); };
    const later = () => { if (!frame) frame = requestAnimationFrame(fit); };
    const sizes = new ResizeObserver(later); // the title's own size changes as it is typed in
    sizes.observe(head); sizes.observe(title);
    document.fonts.addEventListener('loadingdone', later);
    title.addEventListener('input', later); // once it fills the row its box no longer changes size as more is typed
    fit();
    return () => { cancelAnimationFrame(frame); sizes.disconnect(); document.fonts.removeEventListener('loadingdone', later); title.removeEventListener('input', later); };
  }, [path]);
  useEffect(() => {
    const head = headRef.current, title = ref.current, root = note.current;
    if (!head || !title || !root) return;
    if (!alone) { setDrop(null); return; }
    let frame = 0;
    const measure = () => { frame = 0; setDrop(titleBeside(root, head, title)); };
    const later = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const sizes = new ResizeObserver(later);
    sizes.observe(head); sizes.observe(title); sizes.observe(root);
    const edits = new MutationObserver(later);
    edits.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] }); // a class can widen the first line: its heading shows its #s while the caret is in it
    document.fonts.addEventListener('loadingdone', later);
    root.addEventListener('transitionend', later); // text that slides in (a heading's #s) has its full width only now
    root.addEventListener('animationend', later);
    measure();
    return () => { cancelAnimationFrame(frame); sizes.disconnect(); edits.disconnect(); document.fonts.removeEventListener('loadingdone', later); root.removeEventListener('transitionend', later); root.removeEventListener('animationend', later); };
  }, [alone, path]);
  // The title has traces running out from it into whatever the note leaves open around it (titleWires.ts), wherever
  // it sits: on a row of its own or beside the first line. They are laid out again as the text changes shape.
  const wires = useRef<HTMLCanvasElement>(null);
  const theme = useStore((s) => s.settings.theme);
  const wired = useStore((s) => s.settings.titleWires);
  useEffect(() => {
    const head = headRef.current, title = ref.current, canvas = wires.current, root = note.current;
    const scroller = head?.closest('.markdown') as HTMLElement | null;
    if (!head || !title || !canvas || !scroller) return;
    let frame = 0;
    let last = '';
    const draw = () => {
      frame = 0;
      const h = head.getBoundingClientRect(), s = scroller.getBoundingClientRect(), t = title.getBoundingClientRect();
      if (!h.width || !t.width) return; // not on show
      const top = s.top - scroller.scrollTop; // where the note's page begins
      const width = scroller.clientWidth;
      const height = Math.round(Math.max(h.bottom, t.bottom) - top + 240);
      const css = getComputedStyle(head);
      const half = (n: number) => Math.round(n * 2) / 2;
      // To the half pixel, so that the same layout always gives the same drawing.
      const box = { left: half(t.left - s.left - 2), top: half(t.top - top + t.height * 0.14), right: half(t.right - s.left + 2), bottom: half(t.bottom - top - t.height * 0.1) };
      // A title with no characters in it gets a mark where its first letter would stand, and the traces leave that.
      const empty = !(title.textContent ?? '').trim();
      const scene = {
        width, height, seed: path,
        title: box,
        glyphs: titleGlyphs(title, t, s.left, top),
        mark: empty ? { x: half((box.left + box.right) / 2), y: half((box.top + box.bottom) / 2), r: half(Math.max(9, Math.min(18, (box.bottom - box.top) * 0.42))) } : undefined,
        blocks: noteBoxes(scroller, s.left, top, h.left - s.left - 14, height),
        near: rgb(css.getPropertyValue('--accent')), mid: rgb(css.getPropertyValue('--neon')), far: rgb(css.getPropertyValue('--faint')),
        strength: 0.24,
      };
      const key = JSON.stringify(scene);
      if (key === last) return;
      last = key;
      canvas.style.left = `${s.left - h.left}px`; canvas.style.top = `${top - h.top}px`;
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
      canvas.dataset.layout = drawWires(canvas, scene); // for tests: which traces were drawn
    };
    const later = () => { if (!frame) frame = requestAnimationFrame(draw); };
    const sizes = new ResizeObserver(later);
    sizes.observe(head); sizes.observe(title); sizes.observe(scroller);
    const edits = new MutationObserver(later);
    if (root) {
      sizes.observe(root);
      edits.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
      root.addEventListener('transitionend', later); // text that slides in (a heading's #s) has its full width only now
      root.addEventListener('animationend', later);
    }
    document.fonts.addEventListener('loadingdone', later);
    title.addEventListener('input', later); // the first letter typed into an empty title leaves its box the same size
    draw();
    return () => {
      cancelAnimationFrame(frame); sizes.disconnect(); edits.disconnect(); document.fonts.removeEventListener('loadingdone', later); title.removeEventListener('input', later);
      root?.removeEventListener('transitionend', later); root?.removeEventListener('animationend', later);
    };
  }, [drop, path, theme, wired]);
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  useEffect(() => { if (ref.current && ref.current.textContent !== stem) ref.current.textContent = stem; }, [stem]);
  /** True when the file was renamed (the note then reloads under its new name and takes the caret itself). */
  const commit = async () => {
    const el = ref.current;
    if (!el || busy.current) return false;
    const next = (el.textContent ?? '').replace(/\//g, '').replace(/\s+/g, ' ').trim();
    if (!next || next === stem) { el.textContent = stem; return false; }
    busy.current = true;
    const ok = await renameEntry(path, next + ext).finally(() => { busy.current = false; });
    if (!ok && ref.current) ref.current.textContent = stem;
    return ok;
  };
  return (
    <div ref={headRef} className={`rich-head${drop === null ? '' : ' is-beside'}${wired ? ' has-wires' : ''}`}>
      {wired && <canvas ref={wires} className="title-wires" aria-hidden="true" />}
      <div ref={ref} className="rich-title" contentEditable="plaintext-only" suppressContentEditableWarning spellCheck={false} role="textbox" aria-label="Note title"
        style={drop === null ? undefined : { top: drop }}
        onBlur={() => { void commit(); }}
        onInput={(e) => dropSlashes(e.currentTarget)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === '/' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); return; } // a file's name cannot hold one
          if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); void commit().then((renamed) => { if (!renamed) toNote(); }); }
          else if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.textContent = stem; toNote(); }
        }} />
    </div>
  );
}
