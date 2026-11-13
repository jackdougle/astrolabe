import { useEffect, useRef, useState } from 'react';
import { api, tildify } from '../lib/api';
import { pickAndAttach } from '../lib/commands';
import { attachEmoji, contextValue, ensureHistory, ghostFor, history, loneColon, monaco, monoFont, overflowNode, registerInput } from '../lib/monaco';
import { bus, paneHandles } from '../lib/panes';
import { focusedId, TermPane, termWeight, useStore } from '../lib/store';
import { TermSession } from '../lib/termSession';
import { Icon } from './Icons';
import { tip } from './Tooltip';

let inputSeq = 0;

export function TerminalPane({ pane, active }: { pane: TermPane; active: boolean }) {
  const areaRef = useRef<HTMLDivElement>(null);
  const inputWrapRef = useRef<HTMLDivElement>(null);
  const inputHostRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<TermSession | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [finding, setFinding] = useState(false);
  const settings = useStore((s) => s.settings);
  const closePane = useStore((s) => s.closePane);

  // One session and one input editor per pane, for the pane's whole life.
  useEffect(() => {
    const session = new TermSession(pane.id, pane.startCwd);
    sessionRef.current = session;
    session.mount(areaRef.current!);
    ensureHistory();

    const uri = monaco.Uri.parse(`astrolabe-input://pane/${++inputSeq}`);
    const model = monaco.editor.createModel('', 'shell', uri);
    const unregister = registerInput(uri.toString(), { cwd: () => { const p = useStore.getState().panes[pane.id]; return p?.kind === 'terminal' ? p.cwd : pane.startCwd; } });
    const s0 = useStore.getState().settings;
    const editor = monaco.editor.create(inputHostRef.current!, {
      model, theme: 'astrolabe', fontFamily: monoFont(), fontSize: s0.fontSize, fontWeight: termWeight(s0),
      lineNumbers: 'off', glyphMargin: false, folding: false, lineDecorationsWidth: 0, lineNumbersMinChars: 0,
      minimap: { enabled: false }, overviewRulerLanes: 0, hideCursorInOverviewRuler: true, overviewRulerBorder: false,
      scrollbar: { vertical: 'hidden', horizontal: 'hidden', useShadows: false, alwaysConsumeMouseWheel: false },
      renderLineHighlight: 'none', wordWrap: 'on', scrollBeyondLastLine: false, contextmenu: false,
      cursorSmoothCaretAnimation: s0.smoothCaret ? 'on' : 'off', cursorBlinking: 'smooth', cursorStyle: 'line', cursorWidth: 2,
      fixedOverflowWidgets: true, overflowWidgetsDomNode: overflowNode, quickSuggestions: false, wordBasedSuggestions: 'off', suggestOnTriggerCharacters: true,
      inlineSuggest: { enabled: true, showToolbar: 'never' }, tabCompletion: 'off', acceptSuggestionOnEnter: 'on',
      suggest: { showWords: false, showSnippets: false, snippetsPreventQuickSuggestions: false },
      matchBrackets: 'never', occurrencesHighlight: 'off', selectionHighlight: false, links: false,
      guides: { indentation: false }, renderWhitespace: 'none', stickyScroll: { enabled: false },
      padding: { top: 0, bottom: 0 }, automaticLayout: true, unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false },
      emptySelectionClipboard: false,
      autoClosingBrackets: 'beforeWhitespace', autoClosingQuotes: 'beforeWhitespace', autoSurround: 'never',
      placeholder: 'command',
    } as monaco.editor.IStandaloneEditorConstructionOptions);
    editorRef.current = editor;

    const fitHeight = () => {
      const h = Math.min(editor.getContentHeight(), 260);
      inputHostRef.current!.style.height = `${h}px`;
      editor.layout();
      session.setInputElement(inputWrapRef.current);
    };
    editor.onDidContentSizeChange(fitHeight);

    let histIndex = -1; let draft = '';
    const setText = (text: string) => { editor.setValue(text); editor.setPosition({ lineNumber: model.getLineCount(), column: model.getLineMaxColumn(model.getLineCount()) }); };
    const K = monaco.KeyCode;
    editor.onKeyDown((e) => {
      let suggest = contextValue(editor, 'suggestWidgetVisible');
      const pos = editor.getPosition()!;
      // Emoji suggestions open on a bare ":"; Enter then should still run the command, not pick the first emoji.
      if (suggest && e.keyCode === K.Enter && loneColon(model.getLineContent(pos.lineNumber).slice(0, pos.column - 1))) {
        editor.trigger('astrolabe', 'hideSuggestWidget', {});
        suggest = false;
      }
      const stop = () => { e.preventDefault(); e.stopPropagation(); };
      if (e.keyCode === K.Enter && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey && !suggest) {
        stop();
        const text = model.getValue();
        if (!text.trim()) return;
        if (text.trim() === '/file') { editor.setValue(''); pickAndAttach(); return; }
        histIndex = -1; draft = '';
        session.run(text);
        editor.setValue('');
      } else if (e.keyCode === K.Enter && e.altKey) {
        stop(); editor.trigger('astrolabe', 'type', { text: '\n' });
      } else if (e.keyCode === K.Tab && !e.shiftKey && !suggest) {
        // Tab takes the grey suggestion; there is no completion menu. If the grey text has not shown yet, work
        // it out now so a quick Tab still completes.
        stop();
        if (contextValue(editor, 'inlineSuggestionVisible')) { editor.trigger('astrolabe', 'editor.action.inlineSuggest.commit', {}); return; }
        const text = model.getValue();
        ghostFor(model.uri.toString(), text).then((ghost) => { if (ghost && model.getValue() === text) setText(ghost); });
      } else if (e.keyCode === K.RightArrow && !e.shiftKey && !e.metaKey && !e.altKey && contextValue(editor, 'inlineSuggestionVisible')) {
        stop(); editor.trigger('astrolabe', 'editor.action.inlineSuggest.commit', {});
      } else if (((e.keyCode === K.UpArrow && !e.ctrlKey) || (e.keyCode === K.KeyP && e.ctrlKey)) && !suggest && !e.metaKey && !e.altKey && !e.shiftKey && pos.lineNumber === 1) {
        if (!history.length) return;
        stop();
        if (histIndex === -1) { draft = model.getValue(); histIndex = history.length; }
        if (histIndex > 0) { histIndex--; setText(history[histIndex]); }
      } else if (((e.keyCode === K.DownArrow && !e.ctrlKey) || (e.keyCode === K.KeyN && e.ctrlKey)) && !suggest && !e.metaKey && !e.altKey && !e.shiftKey && histIndex !== -1 && pos.lineNumber === model.getLineCount()) {
        stop();
        histIndex++;
        if (histIndex >= history.length) { histIndex = -1; setText(draft); } else setText(history[histIndex]);
      } else if (e.ctrlKey && !e.metaKey && !e.altKey && e.keyCode === K.KeyW) {
        // Terminal habits carry over: Ctrl+W removes the word behind the cursor, back to the previous space.
        stop();
        const line = model.getLineContent(pos.lineNumber);
        let i = pos.column - 1;
        while (i > 0 && /\s/.test(line[i - 1])) i--;
        while (i > 0 && !/\s/.test(line[i - 1])) i--;
        const range = pos.column === 1 && pos.lineNumber > 1
          ? new monaco.Range(pos.lineNumber - 1, model.getLineMaxColumn(pos.lineNumber - 1), pos.lineNumber, 1)
          : new monaco.Range(pos.lineNumber, i + 1, pos.lineNumber, pos.column);
        editor.executeEdits('shell-keys', [{ range, text: '' }]);
      } else if (e.ctrlKey && !e.metaKey && !e.altKey && e.keyCode === K.KeyU) {
        stop(); // Ctrl+U: clear from the start of the line to the cursor
        editor.executeEdits('shell-keys', [{ range: new monaco.Range(pos.lineNumber, 1, pos.lineNumber, pos.column), text: '' }]);
      } else if (e.ctrlKey && !e.metaKey && e.keyCode === K.KeyC) {
        stop();
        if (model.getValue()) { editor.setValue(''); histIndex = -1; } else session.send('\x03');
      } else if (e.ctrlKey && !e.metaKey && e.keyCode === K.KeyD && !model.getValue()) {
        stop(); session.send('\x04');
      } else if (e.ctrlKey && !e.metaKey && e.keyCode === K.KeyL) {
        stop(); session.clear();
      } else if (e.keyCode === K.Escape && !suggest) {
        session.select(null);
      }
    });
    editor.onDidFocusEditorText(() => session.term.scrollToBottom());
    const emojiSub = attachEmoji(editor);

    const focusInput = () => { editor.focus(); };
    session.wantInput = focusInput;
    // A window reloaded in place keeps what was being typed.
    session.inputText = () => model.getValue();
    if (session.resumedInput) { setText(session.resumedInput); session.resumedInput = ''; }
    session.onEarlyInput = (text, enter) => {
      // Added at the cursor, so anything already in the input stays.
      if (text) editor.executeEdits('held', [{ range: editor.getSelection()!, text, forceMoveMarkers: true }]);
      const cmd = model.getValue();
      if (!enter || !cmd.trim()) return;
      editor.setValue('');
      session.run(cmd);
    };
    const focus = () => {
      const p = useStore.getState().panes[pane.id];
      if (p?.kind === 'terminal' && p.integrated && p.atPrompt) focusInput(); else session.focus();
    };
    paneHandles.set(pane.id, { focus });
    const offEvents = session.on((ev) => {
      if (ev !== 'prompt' && ev !== 'running') return;
      const st = useStore.getState();
      if (focusedId(st) === pane.id && !st.palette) requestAnimationFrame(focus);
    });
    const offFind = bus.on('term.find', (id) => { if (id === pane.id) setFinding(true); });
    const offSet = bus.on('input.set', (arg: { pane: string; text: string }) => { if (arg.pane === pane.id) { setText(arg.text); focusInput(); } });
    const offInsert = bus.on('input.insert', (arg: { pane: string; text: string }) => {
      if (arg.pane !== pane.id) return;
      editor.executeEdits('attach', [{ range: editor.getSelection()!, text: arg.text, forceMoveMarkers: true }]);
      focusInput();
    });
    session.setInputElement(inputWrapRef.current);
    fitHeight();

    return () => {
      offEvents(); offFind(); offSet(); offInsert(); emojiSub.dispose(); unregister();
      paneHandles.delete(pane.id);
      editor.dispose(); model.dispose(); session.dispose();
      sessionRef.current = null; editorRef.current = null;
    };
  }, [pane.id]);

  useEffect(() => { if (pane.exited) closePane(pane.id); }, [pane.exited]);

  useEffect(() => {
    sessionRef.current?.applyAppearance();
    editorRef.current?.updateOptions({ fontSize: settings.fontSize, fontFamily: monoFont(), fontWeight: termWeight(settings), cursorSmoothCaretAnimation: settings.smoothCaret ? 'on' : 'off' });
  }, [settings.theme, settings.fontSize, settings.fontWeight, settings.fontFamily, settings.smoothCaret, settings.scrollSpeed]);

  return (
    <div className="term-pane">
      <div className="term-area" ref={areaRef}>
        <div className="cmd-input is-hidden" ref={inputWrapRef}>
          <div className="cmd-chips">
            <span className="chip-cwd">{tildify(pane.cwd)}</span>
            {pane.branch && <span className="chip-branch"><Icon name="branch" size={11} />{pane.branch}{pane.dirty > 0 && <i>{pane.dirty} changed</i>}</span>}
            {!!pane.lastExit && <span className="chip-exit">last exit {pane.lastExit}</span>}
          </div>
          <div className="cmd-editor" ref={inputHostRef} />
        </div>
        {finding && <FindBar session={sessionRef.current} onClose={() => { setFinding(false); sessionRef.current?.clearFind(); paneHandles.get(pane.id)?.focus(); }} />}
      </div>
    </div>
  );
}

function FindBar({ session, onClose }: { session: TermSession | null; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [missing, setMissing] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const go = (dir: 1 | -1, query = q) => { if (!session || !query) { setMissing(false); return; } setMissing(!session.find(query, dir)); };
  return (
    <div className={`findbar${missing ? ' is-missing' : ''}`}>
      <input ref={ref} value={q} placeholder="Find in terminal" spellCheck={false}
        onChange={(e) => { setQ(e.target.value); go(1, e.target.value); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? 1 : -1); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
        }} />
      {missing && <span className="find-none">No matches</span>}
      <button {...tip('Previous match', '↩')} onClick={() => go(-1)}><Icon name="up" /></button>
      <button {...tip('Next match', '⇧↩')} onClick={() => go(1)}><Icon name="down" /></button>
      <button {...tip('Close', 'Esc')} onClick={onClose}><Icon name="x" /></button>
    </div>
  );
}

// Used by the palette to drop a past command into the focused terminal's input.
export function setInputText(paneId: string, text: string) { bus.emit('input.set', { pane: paneId, text }); }
export { api };
