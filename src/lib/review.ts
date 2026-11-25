// Changes made to an open file from outside the editor (an agent, a script, another program) go into the text you
// are looking at, typing included, and are marked there until you have looked at them: what was added is tinted
// green, what was taken out is shown in red above it, and each can be kept or undone on its own. Where the outside
// change falls on lines with unsaved typing of yours, your lines stay and the other version is offered beside them.
//
// This file holds which changes are waiting and where they are; the two views draw them (reviewMonaco.ts for the
// raw view and code, the bridge in richMarkdown.ts for a rendered note).
import type * as monacoNs from 'monaco-editor';
import { carried, carry } from './handoff';
import { diffLines, merge3 } from './lineDiff';

type Model = monacoNs.editor.ITextModel;

/** One change waiting to be looked at. */
interface Held {
  id: string;
  /** Follows the lines through whatever is typed around them. */
  deco: string;
  /** Whether it had lines of its own in the text when it was made (a pure removal has none). */
  lines: boolean;
  /** A removal from the very end of the file: it sits below the last line, not above a line. */
  tail?: boolean;
  /** The lines that were there before. */
  old: string[];
  /** Set when the change was NOT made, because it fell on unsaved typing: the lines the other side has there. */
  offer?: string[];
}

/** A change as the views see it: lines `start`..`end` of the text, counted from 1. With no lines of its own
 *  (`end` is `start - 1`), it sits above line `start`. */
export interface Span { id: string; start: number; end: number; old: string[]; offer?: string[] }

interface State { model: Model; held: Held[]; sub: monacoNs.IDisposable; timer: number; /** An undo or redo has run since the last tidy. */ undone: boolean }

const states = new Map<Model, State>();
const watchers = new Set<() => void>();
let version = 0;
let seq = 0;
const changed = () => { version += 1; watchers.forEach((fn) => fn()); };

export function subscribe(fn: () => void) { watchers.add(fn); return () => { watchers.delete(fn); }; }
export const reviewVersion = () => version;

/** What the editor that owns the files can do for this one: say whether a file has unsaved typing, and save it. */
export const host: { isDirty: (model: Model) => boolean; save: (model: Model) => void } = { isDirty: () => true, save: () => {} };

const linesOf = (text: string) => text.split(/\r\n|\r|\n/);
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

function stateOf(model: Model) {
  let st = states.get(model);
  if (!st) {
    const made: State = { model, held: [], timer: 0, undone: false, sub: model.onDidChangeContent((e) => {
      if (!made.held.length) return;
      if (e.isUndoing || e.isRedoing) made.undone = true;
      // Typing can make a change moot (its lines typed back to what they were). Checked once the typing pauses.
      window.clearTimeout(made.timer);
      made.timer = window.setTimeout(() => { if (tidy(made)) changed(); }, 160);
      changed();
    }) };
    model.onWillDispose(() => forget(model));
    states.set(model, made);
    st = made;
  }
  return st;
}

/** Stops following a file (it was closed). */
export function forget(model: Model) {
  const st = states.get(model);
  if (!st) return;
  window.clearTimeout(st.timer);
  st.sub.dispose();
  states.delete(model);
  changed();
}

function spanOf(model: Model, h: Held): Span | null {
  const r = model.getDecorationRange(h.deco);
  if (!r) return null;
  const line = r.startLineNumber;
  if (h.lines) {
    // Its lines, unless an edit that replaced them all has left the mark as a point in the middle of some other line.
    const point = line === r.endLineNumber && r.startColumn === r.endColumn;
    if (!point || model.getLineMaxColumn(line) === 1) return { id: h.id, start: line, end: r.endLineNumber, old: h.old, offer: h.offer };
    return { id: h.id, start: line, end: line - 1, old: h.old, offer: h.offer };
  }
  // Nothing of its own: above the line it is on, or below the last line when it marks the end of the file.
  const at = h.tail && line === model.getLineCount() ? line + 1 : line;
  return { id: h.id, start: at, end: at - 1, old: h.old, offer: h.offer };
}

/** The changes waiting in a file, top to bottom. */
export function spans(model: Model | null | undefined): Span[] {
  const st = model ? states.get(model) : null;
  if (!st || !st.held.length) return [];
  const out: Span[] = [];
  for (const h of st.held) { const s = spanOf(st.model, h); if (s) out.push(s); }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}
export const waiting = (model: Model | null | undefined) => (model ? states.get(model)?.held.length ?? 0 : 0);

/** Drops changes that are no longer changes: the text there is what it was before. */
function tidy(st: State) {
  const before = st.held.length;
  const all = st.model.getLinesContent();
  const undone = st.undone;
  st.undone = false;
  const gone: string[] = [];
  st.held = st.held.filter((h) => {
    const s = spanOf(st.model, h);
    if (!s) return false;
    const now = s.end >= s.start ? all.slice(s.start - 1, s.end) : [];
    let moot = same(now, h.offer ?? h.old);
    // ⌘Z after a change puts its old lines back beside the mark, which is left with no lines of its own.
    if (!moot && undone && !h.offer && !now.length && h.old.length) {
      moot = same(all.slice(s.start - 1, s.start - 1 + h.old.length), h.old) || same(all.slice(Math.max(0, s.start - 1 - h.old.length), s.start - 1), h.old);
    }
    if (moot) gone.push(h.deco);
    return !moot;
  });
  if (gone.length) st.model.deltaDecorations(gone, []);
  return st.held.length !== before;
}

/** The edit that puts `lines` in place of lines [a0, a1) (counted from 0) of the model. */
function swap(model: Model, a0: number, a1: number, lines: string[]): monacoNs.editor.IIdentifiedSingleEditOperation {
  const n = model.getLineCount();
  const eol = model.getEOL();
  const end = (line: number) => model.getLineMaxColumn(line);
  if (a1 > a0 && lines.length) return { range: { startLineNumber: a0 + 1, startColumn: 1, endLineNumber: a1, endColumn: end(a1) }, text: lines.join(eol) };
  if (a1 > a0) {
    if (a1 < n) return { range: { startLineNumber: a0 + 1, startColumn: 1, endLineNumber: a1 + 1, endColumn: 1 }, text: '' };
    if (a0 > 0) return { range: { startLineNumber: a0, startColumn: end(a0), endLineNumber: a1, endColumn: end(a1) }, text: '' };
    return { range: { startLineNumber: 1, startColumn: 1, endLineNumber: n, endColumn: end(n) }, text: '' };
  }
  if (a0 < n) return { range: { startLineNumber: a0 + 1, startColumn: 1, endLineNumber: a0 + 1, endColumn: 1 }, text: lines.join(eol) + eol };
  return { range: { startLineNumber: n, startColumn: end(n), endLineNumber: n, endColumn: end(n) }, text: eol + lines.join(eol) };
}

/** Marks lines [b0, b1) (from 0) of the model. With no lines, the place above line b0 (below the last line when b0 is past it). */
function mark(model: Model, b0: number, b1: number): string {
  const n = model.getLineCount();
  let range: monacoNs.IRange;
  if (b1 > b0) range = { startLineNumber: b0 + 1, startColumn: 1, endLineNumber: b1, endColumn: model.getLineMaxColumn(b1) };
  else if (b0 < n) range = { startLineNumber: b0 + 1, startColumn: 1, endLineNumber: b0 + 1, endColumn: 1 };
  else range = { startLineNumber: n, startColumn: model.getLineMaxColumn(n), endLineNumber: n, endColumn: model.getLineMaxColumn(n) };
  // 1: typing at either end of the marked lines is not part of them.
  return model.deltaDecorations([], [{ range, options: { stickiness: 1 } }])[0];
}

/** The file changed on disk: `base` is what was there before (the text the editor last read or wrote), `theirs`
 *  what is there now. Puts the change into the model, around any unsaved typing, and (with `review`) marks what
 *  changed. Returns how many places could not be changed because unsaved typing is on the same lines. */
export function takeOutside(model: Model, base: string, theirs: string, review: boolean): { clashes: number; changed: boolean } {
  const st = stateOf(model);
  const mine = model.getLinesContent();
  const baseLines = linesOf(base);
  const merged = same(mine, baseLines) ? { lines: linesOf(theirs), clashes: [] } : merge3(baseLines, mine, linesOf(theirs));
  // The text as it would be had none of the changes still waiting been made.
  const orig = mine.slice();
  const done = spans(model).filter((s) => !s.offer).sort((a, b) => b.start - a.start);
  let floor = Infinity;
  for (const s of done) {
    if (s.end >= floor) continue; // two that ran into each other: the upper one is left as it is
    orig.splice(s.start - 1, Math.max(0, s.end - s.start + 1), ...s.old);
    floor = s.start;
  }
  const ops = diffLines(mine, merged.lines).map((c) => swap(model, c.a0, c.a1, merged.lines.slice(c.b0, c.b1)));
  if (ops.length) model.pushEditOperations([], ops, () => null);
  window.clearTimeout(st.timer);
  // Offers already made stay where their marks have moved to; everything else is worked out afresh.
  const offers = st.held.filter((h) => h.offer && model.getDecorationRange(h.deco));
  model.deltaDecorations(st.held.filter((h) => !offers.includes(h)).map((h) => h.deco), []);
  st.held = offers;
  if (review) {
    const now = model.getLinesContent();
    for (const c of diffLines(orig, now)) {
      st.held.push({ id: `c${++seq}`, deco: mark(model, c.b0, c.b1), lines: c.b1 > c.b0, tail: c.b1 === c.b0 && c.b0 >= now.length, old: orig.slice(c.a0, c.a1) });
    }
    for (const c of merged.clashes) {
      st.held.push({ id: `c${++seq}`, deco: mark(model, c.m0, c.m1), lines: c.m1 > c.m0, tail: c.m1 === c.m0 && c.m0 >= now.length, old: [], offer: c.theirs });
    }
    tidy(st);
  }
  changed();
  return { clashes: merged.clashes.length, changed: ops.length > 0 };
}

function drop(st: State, ids: string[]) {
  const gone = st.held.filter((h) => ids.includes(h.id));
  if (!gone.length) return false;
  st.model.deltaDecorations(gone.map((h) => h.deco), []);
  st.held = st.held.filter((h) => !ids.includes(h.id));
  return true;
}

/** Keeps a change (or every change): it stays as it is and is no longer marked. An offer kept is an offer turned down. */
export function keep(model: Model, id?: string) {
  const st = states.get(model);
  if (st && drop(st, id ? [id] : st.held.map((h) => h.id))) changed();
}

/** Undoes a change (or every one): the lines that were there before come back. For an offer, takes it: the other
 *  side's lines replace yours. A file with nothing unsaved is saved again, so the file on disk follows. */
export function undo(model: Model, id?: string) {
  const st = states.get(model);
  if (!st) return;
  const clean = !host.isDirty(model);
  const list = spans(model).filter((s) => !id || s.id === id);
  if (!list.length) return;
  drop(st, list.map((s) => s.id));
  // From the bottom up, one at a time, so the lines above keep their numbers and two that touch cannot collide.
  for (const s of list.sort((a, b) => b.start - a.start || b.end - a.end)) model.pushEditOperations([], [swap(model, s.start - 1, Math.max(s.start - 1, s.end), s.offer ?? s.old)], () => null);
  window.clearTimeout(st.timer);
  tidy(st);
  changed();
  if (clean) host.save(model);
}


// A window reloading in place keeps what is waiting.
interface Kept { [uri: string]: { start: number; end: number; old: string[]; offer?: string[]; lines: boolean; tail?: boolean }[] }
carry('review', (): Kept => {
  const out: Kept = {};
  for (const st of states.values()) {
    if (st.model.isDisposed() || !st.held.length) continue;
    out[st.model.uri.toString()] = st.held.flatMap((h) => { const s = spanOf(st.model, h); return s ? [{ start: s.start, end: s.end, old: h.old, offer: h.offer, lines: h.lines, tail: h.tail }] : []; });
  }
  return out;
});
let left: Kept | null | undefined;
/** Call when a file's text is in its model again after a reload. */
export function restore(model: Model) {
  if (left === undefined) left = carried<Kept>('review') ?? null;
  const list = left?.[model.uri.toString()];
  if (!list) return;
  delete left![model.uri.toString()];
  const st = stateOf(model);
  const n = model.getLineCount();
  for (const k of list) {
    if (k.start < 1 || k.end > n || k.start > n + 1) continue;
    st.held.push({ id: `c${++seq}`, deco: mark(model, k.start - 1, Math.max(k.start - 1, k.end)), lines: k.lines, tail: k.tail, old: k.old, offer: k.offer });
  }
  tidy(st);
  changed();
}

(window as any).__review = { spans, waiting }; // for test/drive.mjs
