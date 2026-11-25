// ⌘F: every place a word or phrase occurs in what the keyboard is in (a file as text, a rendered note, a terminal).
// The bar is the same for all three (FindBar.tsx); each kind of view has a searcher that marks the matches in its own
// way: this file's for a file shown as text, richFind.ts for a rendered note, termSession.ts for a terminal.
import type * as monacoNs from 'monaco-editor';
import { monaco } from './monaco';

/** How many matches there are and which one is the current one (counted from 1; 0 when there is none). `more` when
 *  there are more than were counted. */
export interface Found { count: number; at: number; more?: boolean }

export interface Finder {
  /** Marks every match of `query`; the current one is the first at or after the caret (or the match before it). */
  find(query: string): void;
  step(dir: 1 | -1): void;
  /** Leaves the current match selected, for when the bar closes. */
  place(): void;
  /** Takes the marks away. */
  end(): void;
  /** The text selected in the view, when it is short and on one line: what the bar starts with. */
  selection(): string;
}

export const FIND_LIMIT = 5000;
/** A selection worth searching for: on one line and not long. */
export const seedOf = (text: string) => (text && text.length <= 200 && !/[\r\n]/.test(text) && text.trim() ? text : '');

type Editor = monacoNs.editor.IStandaloneCodeEditor;

/** For a file shown as text (raw Markdown, code). Follows the editor from file to file. */
export function monacoFinder(editor: Editor, report: (f: Found) => void): Finder {
  const marks = editor.createDecorationsCollection();
  let query = '';
  let hits: monacoNs.Range[] = [];
  let at = -1;
  let frame = 0;

  const paint = (show: boolean) => {
    marks.set(hits.map((range, i) => ({
      range,
      options: {
        className: i === at ? 'find-hit is-now' : 'find-hit', stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        overviewRuler: { color: i === at ? '#e8a33dcc' : '#e8a33d66', position: monaco.editor.OverviewRulerLane.Center },
      },
    })));
    if (show && at >= 0) editor.revealRangeInCenterIfOutsideViewport(hits[at]);
    report({ count: hits.length, at: at + 1, more: hits.length >= FIND_LIMIT });
  };
  /** Finds the matches afresh. The current one is the first at or after `from`. */
  const scan = (from: monacoNs.IPosition | null, show: boolean) => {
    const model = editor.getModel();
    hits = model && query ? model.findMatches(query, false, false, false, null, false, FIND_LIMIT).map((m) => m.range) : [];
    at = -1;
    if (hits.length) {
      at = from ? hits.findIndex((r) => !r.getStartPosition().isBefore(from)) : 0;
      if (at < 0) at = 0;
    }
    paint(show);
  };
  const here = () => (at >= 0 ? marks.getRange(at)?.getStartPosition() ?? hits[at].getStartPosition() : null);
  // The text changed under the marks (typing with the bar open, or an agent's edit): count again, without scrolling.
  const later = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; scan(here() ?? editor.getPosition(), false); }); };
  const subs = [editor.onDidChangeModelContent(later), editor.onDidChangeModel(() => { at = -1; hits = []; marks.clear(); later(); })];

  return {
    find(q) { const from = here() ?? editor.getSelection()?.getStartPosition() ?? null; query = q; scan(from, true); },
    step(dir) { if (!hits.length) return; at = (at + dir + hits.length) % hits.length; paint(true); },
    place() { const range = at >= 0 ? marks.getRange(at) : null; if (range && editor.getModel()) editor.setSelection(range); },
    end() { cancelAnimationFrame(frame); subs.forEach((s) => s.dispose()); marks.clear(); },
    selection() { const sel = editor.getSelection(); const model = editor.getModel(); return sel && model && !sel.isEmpty() ? seedOf(model.getValueInRange(sel)) : ''; },
  };
}
