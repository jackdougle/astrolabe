// The selection in a rendered note is drawn, as the caret is, so that its outer corners can be slightly rounded
// (the browser's own highlight is always square). Each line of selected text is one box; the lines of a
// paragraph meet, so a selection reads as one shape, and only the corners that stick out are rounded.
// Inside a code block the browser's own highlight stays: the block has a background this layer would sit behind.
import { NodeSelection, Plugin } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

interface Box { left: number; top: number; right: number; bottom: number; above?: Box; below?: Box }
const RADIUS = 3;

/** One box for each line of text the selection covers, in window coordinates, top to bottom. */
function lineBoxes(view: EditorView): Box[] {
  const { from, to } = view.state.selection;
  const range = document.createRange();
  try {
    const a = view.domAtPos(from);
    const b = view.domAtPos(to);
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
  } catch { return []; }
  const seen = (view.dom.closest('.markdown') ?? view.dom).getBoundingClientRect();
  const found: Box[] = [];
  const add = (r: { left: number; top: number; right: number; bottom: number }) => { if (r.right - r.left > 0.5 && r.bottom > r.top) found.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }); };
  const root = range.commonAncestorContainer.nodeType === Node.TEXT_NODE ? range.commonAncestorContainer.parentNode! : range.commonAncestorContainer;
  const piece = document.createRange();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if (!range.intersectsNode(node)) return NodeFilter.FILTER_REJECT;
      if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
      const el = node as HTMLElement;
      if (el.tagName === 'PRE') return NodeFilter.FILTER_REJECT;
      const r = el.getBoundingClientRect();
      // Far above or below what is on screen: nothing in it needs drawing until it is scrolled to.
      if (r.height > 0 && (r.bottom < seen.top - 200 || r.top > seen.bottom + 200)) return NodeFilter.FILTER_REJECT;
      if (el.tagName === 'IMG') { if (!el.classList.contains('ProseMirror-separator')) add(r); return NodeFilter.FILTER_REJECT; }
      // An empty line inside the selection shows as a short mark, as a selected line break does.
      if (/^(P|H[1-6])$/.test(el.tagName) && !el.textContent && el !== range.endContainer) add({ left: r.left, top: r.top, right: r.left + 7, bottom: r.bottom });
      return NodeFilter.FILTER_SKIP;
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    piece.setStart(text, text === range.startContainer ? range.startOffset : 0);
    piece.setEnd(text, text === range.endContainer ? range.endOffset : text.length);
    for (const r of piece.getClientRects()) add(r);
  }
  // Pieces on one line (plain words, bold ones, a link) become that line's box.
  found.sort((a, b) => a.top - b.top || a.left - b.left);
  const lines: Box[] = [];
  for (const r of found) {
    const line = lines[lines.length - 1];
    const mid = (r.top + r.bottom) / 2;
    if (line && mid > line.top && mid < line.bottom) {
      line.left = Math.min(line.left, r.left); line.right = Math.max(line.right, r.right);
      line.top = Math.min(line.top, r.top); line.bottom = Math.max(line.bottom, r.bottom);
    } else lines.push(r);
  }
  // A little room around the letters; then lines that nearly touch are made to meet, so a paragraph is one shape.
  for (const line of lines) { line.left -= 1.5; line.right += 1.5; line.top -= 2; line.bottom += 2; }
  for (let i = 0; i + 1 < lines.length; i++) {
    const a = lines[i];
    const b = lines[i + 1];
    const gap = b.top - a.bottom;
    if (gap > 4 || gap < -8) continue;
    a.bottom = b.top = (a.bottom + b.top) / 2;
    a.below = b; b.above = a;
  }
  return lines;
}
/** Rounded where a corner sticks out; square where the line above or below carries on past it. */
function corners(box: Box) {
  const out = (other: Box | undefined, side: 'left' | 'right') => !other || (side === 'left' ? other.left > box.left + RADIUS : other.right < box.right - RADIUS);
  const px = (round: boolean) => (round ? `${RADIUS}px` : '0');
  return `${px(out(box.above, 'left'))} ${px(out(box.above, 'right'))} ${px(out(box.below, 'right'))} ${px(out(box.below, 'left'))}`;
}

export const drawnSelection = $prose(() => new Plugin({
  view(view) {
    const layer = document.createElement('div');
    layer.className = 'rich-sel';
    let host: HTMLElement | null = null;
    let frame = 0;
    let followUntil = 0;
    let following = 0;
    const clear = () => { layer.replaceChildren(); host?.classList.remove('has-selection'); };
    const draw = () => {
      const parent = view.dom.parentElement;
      if (!parent) return;
      if (host !== parent) { host = parent; host.prepend(layer); }
      const sel = view.state.selection;
      if (sel.empty || sel instanceof NodeSelection || !view.hasFocus()) { clear(); return; }
      const boxes = lineBoxes(view);
      const origin = host.getBoundingClientRect();
      while (layer.childElementCount > boxes.length) layer.lastElementChild!.remove();
      while (layer.childElementCount < boxes.length) layer.appendChild(document.createElement('div'));
      boxes.forEach((box, i) => {
        const el = layer.children[i] as HTMLElement;
        el.style.cssText = `left:${(box.left - origin.left).toFixed(1)}px;top:${(box.top - origin.top).toFixed(1)}px;width:${(box.right - box.left).toFixed(1)}px;height:${(box.bottom - box.top).toFixed(1)}px;border-radius:${corners(box)}`;
      });
      host.classList.toggle('has-selection', true);
    };
    const sync = () => { draw(); cancelAnimationFrame(frame); frame = requestAnimationFrame(draw); };
    const later = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(draw); };
    // While text in the note is sliding (richMotion.ts), the boxes keep up with it, as the caret does.
    const follow = () => { draw(); following = performance.now() < followUntil ? requestAnimationFrame(follow) : 0; };
    const moving = () => { if (view.state.selection.empty) return; followUntil = performance.now() + 260; if (!following) following = requestAnimationFrame(follow); };
    const scroller = view.dom.closest('.markdown');
    const sizes = new ResizeObserver(later);
    sizes.observe(view.dom);
    view.dom.addEventListener('focus', sync);
    view.dom.addEventListener('blur', sync);
    view.dom.addEventListener('animationstart', moving);
    view.dom.addEventListener('transitionrun', moving);
    scroller?.addEventListener('scroll', later, { passive: true });
    return {
      update: sync,
      destroy() {
        sizes.disconnect();
        view.dom.removeEventListener('focus', sync);
        view.dom.removeEventListener('blur', sync);
        view.dom.removeEventListener('animationstart', moving);
        view.dom.removeEventListener('transitionrun', moving);
        scroller?.removeEventListener('scroll', later);
        cancelAnimationFrame(frame);
        cancelAnimationFrame(following);
        host?.classList.remove('has-selection');
        layer.remove();
      },
    };
  },
}));
