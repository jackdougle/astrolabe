// Text in the rendered view slides instead of jumping when Markdown's own characters come and go. Nothing is
// moved by hand: what appears grows in from no width and what goes shrinks away, so the words beside it are
// carried along by the layout, across line breaks too.
//  - Brackets put around a selection grow in (richEditing.ts says which characters, with `motionKey`).
//  - The * _ ` ~ typed around words shrink away when they turn into bold, italic, code or strike-through.
//  - A heading's #s grow in as the caret enters it and shrink away as it leaves (richHashes.ts says where, with `motionKey`).
//  - A list item indented or outdented (Tab, ⇧Tab, ⌘] and ⌘[) slides to its new place instead of jumping (`shift`).
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { AddMarkStep, ReplaceStep } from '@milkdown/kit/prose/transform';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

/** How long a character takes to grow in or shrink away; the same as `slide-in` and `slide-out` in styles.css. */
export const SLIDE_MS = 110;
/** Meta on a transaction: `grow` lists the ranges (in the new document) of characters that should grow in, and
 *  `shrink` the places where characters just taken out should be seen to shrink away, with what they were. */
export interface MotionMeta { grow?: [number, number][]; shrink?: [number, string][]; done?: number }
export const motionKey = new PluginKey<{ set: DecorationSet; ids: number[] }>('astrolabe-motion');

let nextId = 1;
const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const ghost = (text: string) => () => {
  const el = document.createElement('span');
  el.className = 'rich-ghost';
  el.textContent = text;
  el.setAttribute('aria-hidden', 'true');
  return el;
};

export const motion = $prose(() => new Plugin<{ set: DecorationSet; ids: number[] }>({
  key: motionKey,
  state: {
    init: () => ({ set: DecorationSet.empty, ids: [] }),
    apply(tr, value) {
      const meta = tr.getMeta(motionKey) as MotionMeta | undefined;
      let { set, ids } = value;
      if (meta?.done != null) {
        const { done } = meta;
        set = set.remove(set.find(undefined, undefined, (spec) => spec.id === done));
        ids = ids.filter((id) => id !== done);
      }
      if (!tr.docChanged) return set === value.set ? value : { set, ids };
      if (set !== DecorationSet.empty) set = set.map(tr.mapping, tr.doc);
      if (still()) return { set, ids };
      const added: Decoration[] = [];
      const id = nextId++;
      for (const [from, to] of meta?.grow ?? []) added.push(Decoration.inline(from, to, { class: 'is-growing' }, { id }));
      (meta?.shrink ?? []).forEach(([at, text], i) => added.push(Decoration.widget(at, ghost(text), { id, key: `gone-${id}-${i}`, side: -1, ignoreSelection: true })));
      // Markdown's characters taken out as their words get the mark they stood for: a copy of each shrinks away where it was.
      if (tr.steps.some((step) => step instanceof AddMarkStep)) {
        tr.steps.forEach((step, i) => {
          if (!(step instanceof ReplaceStep) || step.slice.size || step.to - step.from > 4) return;
          const text = tr.docs[i].textBetween(step.from, step.to);
          if (!text || /[\p{L}\p{N}\s]/u.test(text)) return;
          const at = tr.mapping.slice(i + 1).map(step.from, -1);
          added.push(Decoration.widget(at, ghost(text), { id, key: `ghost-${id}-${i}`, side: -1, ignoreSelection: true }));
        });
      }
      return added.length ? { set: set.add(tr.doc, added), ids: [...ids, id] } : { set, ids };
    },
  },
  props: { decorations: (state) => motionKey.getState(state)?.set },
  view: () => {
    const timers = new Map<number, number>();
    return {
      update(view) {
        for (const id of motionKey.getState(view.state)?.ids ?? []) {
          if (timers.has(id)) continue;
          timers.set(id, window.setTimeout(() => {
            timers.delete(id);
            if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(motionKey, { done: id } satisfies MotionMeta).setMeta('addToHistory', false));
          }, SLIDE_MS + 50));
        }
      },
      destroy() { for (const timer of timers.values()) window.clearTimeout(timer); },
    };
  },
}));

/** How long an indented or outdented line takes to slide across. */
export const SHIFT_MS = 180;
/** The list items whose own line the selection touches, as they are drawn. */
function itemsAt(view: EditorView): HTMLElement[] {
  const { from, to } = view.state.selection;
  const out: HTMLElement[] = [];
  view.state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name !== 'list_item' || !node.firstChild) return true;
    const el = from <= pos + 1 + node.firstChild.nodeSize && to >= pos + 1 ? view.nodeDOM(pos) : null;
    if (el instanceof HTMLElement) out.push(el);
    return true;
  });
  return out;
}
// The keys that indent and outdent are Milkdown's. This only notes where the lines are when one is pressed and,
// if the note changed, starts each line from there: it is drawn where it was and eased to where it now is.
// The items are new elements afterwards, so they are matched by their order.
export const shift = $prose(() => new Plugin({
  view(view) {
    let from: { x: number; y: number }[] | null = null;
    let timer = 0;
    const onKey = (e: KeyboardEvent) => {
      const indent = e.key === 'Tab' ? !e.metaKey && !e.ctrlKey && !e.altKey : (e.key === ']' || e.key === '[') && e.metaKey && !e.altKey && !e.ctrlKey;
      if (!indent || still()) return;
      from = itemsAt(view).map((el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top }; });
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { from = null; });
    };
    view.dom.addEventListener('keydown', onKey, true);
    return {
      update(view, prev) {
        const was = from;
        if (!was || view.state.doc.eq(prev.doc)) return;
        from = null;
        const items = itemsAt(view);
        if (items.length !== was.length) return;
        let moved = false;
        items.forEach((el, i) => {
          if (items.some((other) => other !== el && other.contains(el))) return; // carried along inside one that is sliding
          const r = el.getBoundingClientRect();
          const dx = was[i].x - r.left;
          const dy = was[i].y - r.top;
          if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
          el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: SHIFT_MS, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
          moved = true;
        });
        // The drawn caret keeps pace with anything in the note that announces a motion this way (richEditing.ts).
        if (moved) view.dom.dispatchEvent(new Event('animationstart'));
      },
      destroy() { view.dom.removeEventListener('keydown', onKey, true); window.clearTimeout(timer); },
    };
  },
}));
