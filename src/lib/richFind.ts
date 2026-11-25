// ⌘F in a rendered note: every match of the words in the bar is marked in the note's text, and one of them is the
// current one (find.ts has the rest of the story). The words are looked for as the note reads, not as its Markdown is
// written, and without regard to capitals.
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import type { Node as PMNode } from '@milkdown/kit/prose/model';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import { FIND_LIMIT, seedOf } from './find';
import type { Finder, Found } from './find';

interface Hit { from: number; to: number }
interface State { query: string; hits: Hit[]; at: number; marks: DecorationSet }
type Meta = { query: string; from: number } | { step: 1 | -1 } | { stop: true };

const NONE: State = { query: '', hits: [], at: -1, marks: DecorationSet.empty };
const key = new PluginKey<State>('astrolabe-find');

/** Every match in the note, in order. A match lies within one block of text (a paragraph, a heading, a list item's
 *  line, a table cell, a block of code). */
function scan(doc: PMNode, query: string): Hit[] {
  const hits: Hit[] = [];
  const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return hits.length < FIND_LIMIT;
    // The block's text, a character for each position in it: anything that is not text (a picture, a line break)
    // stands as a character no search can match.
    let text = '';
    node.forEach((kid) => { text += kid.isText ? kid.text! : '￼'.repeat(kid.nodeSize); });
    re.lastIndex = 0;
    for (let m = re.exec(text); m && hits.length < FIND_LIMIT; m = re.exec(text)) hits.push({ from: pos + 1 + m.index, to: pos + 1 + m.index + m[0].length });
    return false;
  });
  return hits;
}

const paint = (doc: PMNode, hits: Hit[], at: number) => DecorationSet.create(doc, hits.map((h, i) => Decoration.inline(h.from, h.to, { class: i === at ? 'find-hit is-now' : 'find-hit' })));

export const findMarks = $prose(() => new Plugin<State>({
  key,
  state: {
    init: () => NONE,
    apply(tr, was) {
      const meta = tr.getMeta(key) as Meta | undefined;
      if (meta && 'stop' in meta) return NONE;
      if (meta && 'step' in meta) {
        if (!was.hits.length) return was;
        const at = (was.at + meta.step + was.hits.length) % was.hits.length;
        return { ...was, at, marks: paint(tr.doc, was.hits, at) };
      }
      if (!meta && (!tr.docChanged || !was.query)) return was;
      const query = meta ? meta.query : was.query;
      if (!query) return NONE;
      // After a change to the note, the current match is the one where the last one was.
      const from = meta ? meta.from : was.at >= 0 ? tr.mapping.map(was.hits[was.at].from, -1) : 0;
      const hits = scan(tr.doc, query);
      let at = hits.findIndex((h) => h.from >= from);
      if (at < 0) at = hits.length ? 0 : -1;
      return { query, hits, at, marks: paint(tr.doc, hits, at) };
    },
  },
  props: { decorations: (state) => key.getState(state)?.marks },
  // Tells the bar when the count changes because the note did.
  view: () => ({ update(view, before) { const now = key.getState(view.state); if (now !== key.getState(before)) listeners.get(view)?.(now ?? NONE); } }),
}));

const listeners = new WeakMap<EditorView, (s: State) => void>();

export function richFinder(view: EditorView, report: (f: Found) => void): Finder {
  const alive = () => !view.isDestroyed;
  const state = () => key.getState(view.state) ?? NONE;
  const send = (meta: Meta) => view.dispatch(view.state.tr.setMeta(key, meta).setMeta('addToHistory', false));
  /** Brings the current match into view, opening any closed toggle it is inside. */
  const show = () => {
    const s = state();
    const hit = s.hits[s.at];
    if (!hit) return;
    const $at = view.state.doc.resolve(hit.from);
    let tr = view.state.tr;
    for (let d = $at.depth; d > 0; d--) { const node = $at.node(d); if (node.type.name === 'toggle' && !node.attrs.open) tr = tr.setNodeMarkup($at.before(d), undefined, { ...node.attrs, open: true }); }
    if (tr.docChanged) view.dispatch(tr.setMeta('addToHistory', false));
    const scroller = view.dom.closest<HTMLElement>('.markdown');
    if (!scroller) return;
    const box = scroller.getBoundingClientRect();
    const spot = view.coordsAtPos(hit.from);
    if (spot.top < box.top + 48 || spot.bottom > box.bottom - 48) scroller.scrollTop += (spot.top + spot.bottom) / 2 - (box.top + box.height / 2);
  };
  listeners.set(view, (s) => report({ count: s.hits.length, at: s.at + 1, more: s.hits.length >= FIND_LIMIT }));

  return {
    find(query) { if (!alive()) return; const s = state(); send({ query, from: s.hits[s.at]?.from ?? view.state.selection.from }); show(); },
    step(dir) { if (!alive()) return; send({ step: dir }); show(); },
    place() {
      if (!alive()) return;
      const s = state();
      const hit = s.hits[s.at];
      if (hit) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, hit.from, hit.to)));
    },
    end() { listeners.delete(view); if (alive() && state() !== NONE) send({ stop: true }); },
    selection() { const { from, to, empty } = view.state.selection; return alive() && !empty ? seedOf(view.state.doc.textBetween(from, to, '\n', '\n')) : ''; },
  };
}
