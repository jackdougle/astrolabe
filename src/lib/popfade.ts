// Whatever pops up over the window fades in and out, 200 ms each way. Fading in is CSS (styles.css, "pop-ups").
// Fading out is done here: when a pop-up is taken off the page, by React or by hand, a picture of it goes back in
// its place, takes no clicks or keys, fades and is removed. Closing itself is as immediate as before.
import { reducedMotion } from './motion';

export const POP_MS = 200;
const POPS = '.findbar, .toast, .palette-scrim, .tooltip, .link-box, .counts-pop, .hidden-pop, .hidden-chip, .changes-bar, .update-notice';

function leave(el: HTMLElement, parent: Node, before: Node | null) {
  const ghost = el.cloneNode(true) as HTMLElement;
  ghost.classList.add('is-ghost');
  ghost.inert = true;
  ghost.setAttribute('aria-hidden', 'true');
  for (const n of [ghost, ...ghost.querySelectorAll<HTMLElement>('*')]) for (const a of ['id', 'role', 'aria-label', 'data-tip']) n.removeAttribute(a);
  parent.insertBefore(ghost, before?.parentNode === parent ? before : null);
  // A copy starts scrolled to the top; the list in it stays where it was left.
  const lists = ghost.querySelectorAll('.palette-list');
  el.querySelectorAll('.palette-list').forEach((list, i) => { lists[i].scrollTop = scrolled.get(list) ?? 0; });
  setTimeout(() => ghost.remove(), POP_MS);
}
// An element off the page has lost its scroll position, so it is noted as it happens.
const scrolled = new WeakMap<Element, number>();

export function watchPops() {
  document.addEventListener('scroll', (e) => { if (e.target instanceof Element) scrolled.set(e.target, e.target.scrollTop); }, { capture: true, passive: true });
  new MutationObserver((records) => {
    if (reducedMotion()) return;
    for (const { target, removedNodes, nextSibling } of records) {
      for (const node of removedNodes) {
        if (!(node instanceof HTMLElement) || node.isConnected || !target.isConnected) continue;
        if (!node.matches(POPS) || node.classList.contains('is-ghost')) continue;
        // One put straight in the place of another (the palette moving to a new list) is not closing.
        if (node.matches('.palette-scrim') && document.querySelector('.palette-scrim:not(.is-ghost)')) continue;
        leave(node, target, nextSibling);
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
}
