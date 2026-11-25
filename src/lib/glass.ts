// Small chips that sit over text (the hidden-terminals chip, a file's word counter) turn to glass while you type
// right next to them: almost fully see-through, letting clicks pass, so the words under them show. Moving the
// pointer brings them back.
import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

/** Where the typing caret is on screen, whatever holds the keyboard: a terminal (xterm keeps its hidden input at the
 *  cursor), the command input or raw editor (Monaco), a rendered note. Null when nothing is being typed into. */
export function caretBox(): DOMRect | null {
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body) return null;
  if (el.classList.contains('xterm-helper-textarea')) return el.getBoundingClientRect();
  const drawn = el.closest('.monaco-editor')?.querySelector('.cursors-layer .cursor') ?? el.closest('.markdown')?.querySelector('.rich-caret');
  if (drawn) return drawn.getBoundingClientRect();
  const sel = window.getSelection();
  if (sel?.rangeCount && el.contains(sel.focusNode)) { const r = sel.getRangeAt(0).getBoundingClientRect(); if (r.width || r.height) return r; }
  return null;
}

/** True while the caret is close to the element `selector` finds under `ref` and keys are going in. Only a caret
 *  about touching it counts: a word or two to the left, a few characters to the right, the line it sits on. Once
 *  it is glass the caret has to go a little further off before it comes back, so typing along the edge does not
 *  flick it to and fro. */
export function useGlass(ref: RefObject<HTMLElement | null>, selector: string, active: boolean) {
  const [clear, setClear] = useState(false);
  useEffect(() => {
    if (!active) { setClear(false); return; }
    let frame = 0;
    const look = () => {
      frame = 0;
      const chip = ref.current?.querySelector(selector)?.getBoundingClientRect();
      const caret = caretBox();
      // A caret that cannot be found for a moment (it is redrawn as the keys go in) changes nothing.
      if (!chip || !caret) return;
      setClear((was) => {
        const far = was ? 18 : 0;
        return caret.right > chip.left - 36 - far && caret.left < chip.right + 14 + far && caret.bottom > chip.top - 6 - far / 2 && caret.top < chip.bottom + 6 + far / 2;
      });
    };
    // Looked at as the keys go in, and once more when they stop: the drawn caret glides, so it gets there a little late.
    let settle = 0;
    const key = (e: KeyboardEvent) => {
      if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return;
      if (!frame) frame = requestAnimationFrame(() => { frame = requestAnimationFrame(look); });
      window.clearTimeout(settle);
      settle = window.setTimeout(look, 220);
    };
    // Only a pointer that has really moved: the page reports a move of its own when what is under a still pointer changes.
    let at: { x: number; y: number } | null = null;
    const move = (e: MouseEvent) => {
      const was = at;
      at = { x: e.screenX, y: e.screenY };
      if (was && Math.abs(was.x - at.x) + Math.abs(was.y - at.y) > 2) setClear(false);
    };
    window.addEventListener('keydown', key, true); window.addEventListener('mousemove', move, true);
    return () => { cancelAnimationFrame(frame); window.clearTimeout(settle); window.removeEventListener('keydown', key, true); window.removeEventListener('mousemove', move, true); };
  }, [active, selector]);
  return clear;
}
