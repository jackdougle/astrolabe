import { useEffect, useRef, useState } from 'react';
import { basename, dirname } from '../lib/api';
import { closeFileTab, markdownLink, pickAndAttach, renameEntry } from '../lib/commands';
import { attachEmoji, contextValue, loadFile, loneColon, monaco, monoFont, overflowNode } from '../lib/monaco';
import { bus, paneHandles } from '../lib/panes';
import { mountRich, RichHandle } from '../lib/richMarkdown';
import { leaves } from '../lib/layout';
import { EditorPane as EditorPaneState, isMarkdown, scrollSpeed, showing, useStore } from '../lib/store';

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?/;

/** In raw Markdown, * _ ~ typed over a selection go around it instead of replacing it, as ( [ ` already do. */
function handleWrapKey(editor: monaco.editor.IStandaloneCodeEditor, e: monaco.IKeyboardEvent) {
  const key = e.browserEvent.key;
  if ((key !== '*' && key !== '_' && key !== '~') || e.metaKey || e.ctrlKey || e.browserEvent.isComposing) return;
  const sels = editor.getSelections();
  if (editor.getModel()?.getLanguageId() !== 'markdown' || !sels?.length || sels.some((s) => s.isEmpty())) return;
  e.preventDefault(); e.stopPropagation();
  const at = sels.flatMap((s) => [s.getStartPosition(), s.getEndPosition()]);
  // The words stay selected, so a second * makes them bold.
  const start = (ln: number, col: number) => col + at.filter((p) => p.lineNumber === ln && p.column <= col).length;
  const end = (ln: number, col: number) => col + at.filter((p) => p.lineNumber === ln && p.column < col).length;
  editor.pushUndoStop();
  editor.executeEdits('wrap', at.map((p) => ({ range: monaco.Range.fromPositions(p), text: key, forceMoveMarkers: true })),
    sels.map((s) => monaco.Selection.createWithDirection(s.startLineNumber, start(s.startLineNumber, s.startColumn), s.endLineNumber, end(s.endLineNumber, s.endColumn), s.getDirection())));
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
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(0);
  const [richNote, setRichNote] = useState<string | null>(null);
  const settings = useStore((s) => s.settings);
  // The editor fills its tab: no terminals beside it, or expanded over them.
  const alone = useStore((s) => { const t = s.tabs.find((x) => leaves(x.root).includes(pane.id)); return !t || showing(t, s.panes) === 'editor' || (t.maximized && t.activePane === pane.id); });
  const file = pane.files.find((f) => f.path === pane.active) ?? null;
  const rendered = !!file && file.rendered && isMarkdown(file.path);
  const renderedRef = useRef(rendered);
  const endDone = useRef(0); // the last end-of-note reveal already applied
  renderedRef.current = rendered;

  const isFocusedPane = () => {
    const s = useStore.getState();
    return !s.palette && s.tabs.find((t) => t.id === s.activeTab)?.activePane === pane.id;
  };
  const focusNow = () => {
    if (renderedRef.current && document.activeElement?.classList.contains('rich-title') && richRef.current?.parentElement?.contains(document.activeElement)) return; // the title is being edited
    if (renderedRef.current && richHandle.current) richHandle.current.focus(); else editorRef.current?.focus();
  };

  useEffect(() => {
    const s = useStore.getState().settings;
    const editor = monaco.editor.create(hostRef.current!, {
      model: null, theme: 'astrolabe', fontFamily: monoFont(), fontSize: s.fontSize, lineHeight: 1.55,
      wordWrap: s.wordWrap ? 'on' : 'off', wrappingIndent: 'same',
      cursorSmoothCaretAnimation: s.smoothCaret ? 'on' : 'off', cursorBlinking: 'smooth', cursorWidth: 2,
      smoothScrolling: true, emptySelectionClipboard: true,
      mouseWheelScrollSensitivity: scrollSpeed(s), fastScrollSensitivity: scrollSpeed(s) * 4,
      minimap: { enabled: false }, scrollBeyondLastLine: false, renderLineHighlight: 'line',
      automaticLayout: true, fixedOverflowWidgets: true, overflowWidgetsDomNode: overflowNode, stickyScroll: { enabled: false },
      bracketPairColorization: { enabled: true }, guides: { indentation: true, bracketPairs: false },
      padding: { top: 10, bottom: 24 }, lineNumbersMinChars: 3, lineDecorationsWidth: 12, glyphMargin: false,
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
      overviewRulerBorder: false, unicodeHighlight: { ambiguousCharacters: false },
    });
    editorRef.current = editor;
    editor.onKeyDown((e) => { handleWrapKey(editor, e); handleListKey(editor, e); });
    attachEmoji(editor, () => ['markdown', 'plaintext'].includes(editor.getModel()?.getLanguageId() ?? ''));
    paneHandles.set(pane.id, { focus: focusNow });
    // Files attached from Finder (or dropped on the pane) become links in notes and plain paths in code.
    const offAttach = bus.on('editor.attach', (arg: { pane: string; paths: string[] }) => {
      const model = editor.getModel();
      if (arg.pane !== pane.id || !model) return;
      const isNote = model.getLanguageId() === 'markdown';
      const dir = dirname(model.uri.path);
      const text = arg.paths.map((p) => (isNote ? markdownLink(dir, p) : p)).join(isNote ? ' ' : '\n');
      if (renderedRef.current && richHandle.current) richHandle.current.insertMarkdown(text);
      else editor.executeEdits('attach', [{ range: editor.getSelection()!, text, forceMoveMarkers: true }]);
    });
    return () => { offAttach(); paneHandles.delete(pane.id); editor.dispose(); editorRef.current = null; };
  }, [pane.id]);

  // Show the active file, keeping each file's scroll position and cursor.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !pane.active) return;
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

  useEffect(() => {
    editorRef.current?.updateOptions({
      wordWrap: settings.wordWrap ? 'on' : 'off', cursorSmoothCaretAnimation: settings.smoothCaret ? 'on' : 'off',
      fontSize: settings.fontSize, fontFamily: monoFont(),
      mouseWheelScrollSensitivity: scrollSpeed(settings), fastScrollSensitivity: scrollSpeed(settings) * 4,
    });
  }, [settings.wordWrap, settings.smoothCaret, settings.fontSize, settings.fontFamily, settings.scrollSpeed]);

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
      handle = h; richHandle.current = h;
      const r = useStore.getState().panes[pane.id];
      const reveal = r?.kind === 'editor' ? r.reveal : null;
      if (reveal?.end && reveal.path === pane.active && endDone.current !== reveal.n) { endDone.current = reveal.n; h.focusEnd(); }
      else if (isFocusedPane()) h.focus();
    });
    return () => { cancelled = true; handle?.destroy(); if (richHandle.current === handle) richHandle.current = null; root.textContent = ''; };
  }, [rendered, loaded, error]);

  useEffect(() => {
    if (rendered) return;
    editorRef.current?.layout();
    if (isFocusedPane()) editorRef.current?.focus();
  }, [rendered]);

  // Its files are tabs in the row along the top of the window, beside the terminals' (TabStrip in App.tsx).
  return (
    <div className={`editor-pane${alone ? ' is-centered' : ''}`}>
      {/* A centred raw note leaves empty margins: the wheel and clicks there still reach the editor. */}
      <div className="editor-body" tabIndex={-1}
        onWheel={(e) => { const ed = editorRef.current; if (e.target === e.currentTarget && ed && !rendered) ed.setScrollTop(ed.getScrollTop() + e.deltaY * scrollSpeed(settings)); }}
        onMouseDown={(e) => { if (e.target === e.currentTarget && !rendered && !error) { e.preventDefault(); editorRef.current?.focus(); } }}>
        <div className={`editor-host${file && isMarkdown(file.path) ? ' is-note' : ''}`} ref={hostRef} style={{ display: rendered || error ? 'none' : undefined }} />
        <div className="markdown" style={{ display: rendered && !error ? undefined : 'none' }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); richHandle.current?.focus(); } }}>
          {file && rendered && <NoteTitle path={file.path} toNote={() => richHandle.current?.focus()} note={richRef} alone={!richNote} />}
          {richNote && <div className="rich-note">{richNote}</div>}
          <div ref={richRef} />
        </div>
        {error && <div className="editor-error"><p>{error}</p><button onClick={() => closeFileTab(pane.id, pane.active!)}>Close this tab</button></div>}
      </div>
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

/** Where the title sits beside the note's first line (how far to lower it so the baselines meet), or null when that line leaves no room. */
function titleBeside(root: HTMLElement | null, head: HTMLElement, title: HTMLElement): number | null {
  const block = root?.querySelector('.rich')?.firstElementChild;
  if (!block || !/^(P|H[1-6]|UL|OL|BLOCKQUOTE)$/.test(block.tagName) || block.querySelector('img')) return null;
  const top = block.getBoundingClientRect().top;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let text = walker.nextNode();
  while (text && !text.nodeValue) text = walker.nextNode();
  let right = 0;
  let baseline: number;
  if (text) {
    const range = document.createRange();
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

/** The note's file name with its rendered text, without the extension: right-aligned beside the first line when that line is short enough, above the note otherwise. Editing it renames the file. */
function NoteTitle({ path, toNote, note, alone }: { path: string; toNote: () => void; note: React.RefObject<HTMLDivElement | null>; alone: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const [drop, setDrop] = useState<number | null>(null);
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
    edits.observe(root, { subtree: true, childList: true, characterData: true });
    document.fonts.addEventListener('loadingdone', later);
    measure();
    return () => { cancelAnimationFrame(frame); sizes.disconnect(); edits.disconnect(); document.fonts.removeEventListener('loadingdone', later); };
  }, [alone, path]);
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  useEffect(() => { if (ref.current && ref.current.textContent !== stem) ref.current.textContent = stem; }, [stem]);
  /** True when the file was renamed (the note then reloads under its new name and takes the caret itself). */
  const commit = async () => {
    const el = ref.current;
    if (!el || busy.current) return false;
    const next = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!next || next === stem) { el.textContent = stem; return false; }
    busy.current = true;
    const ok = await renameEntry(path, next + ext).finally(() => { busy.current = false; });
    if (!ok && ref.current) ref.current.textContent = stem;
    return ok;
  };
  return (
    <div ref={headRef} className={`rich-head${drop === null ? '' : ' is-beside'}`}>
      <div ref={ref} className="rich-title" contentEditable="plaintext-only" suppressContentEditableWarning spellCheck={false} role="textbox" aria-label="Note title"
        style={drop === null ? undefined : { top: drop }}
        onBlur={() => { void commit(); }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); void commit().then((renamed) => { if (!renamed) toNote(); }); }
          else if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.textContent = stem; toNote(); }
        }} />
    </div>
  );
}
