import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { commands, formatKeys } from '../lib/commands';

/** Props for a button's hover tip: its name, and its shortcut. `keys` is a command id (the shortcut is read
 *  from the command, so it stays right if the binding changes) or a key written out, such as "Esc". */
export function tip(label: string, keys?: string) {
  const cmd = keys ? commands.find((c) => c.id === keys) : undefined;
  const shown = cmd ? (cmd.keys?.[0] ? formatKeys(cmd.keys[0]) : undefined) : keys;
  return { 'data-tip': label, 'data-keys': shown, 'aria-label': label };
}

interface Shown { label: string; keys?: string; x: number; top: number; bottom: number }

/** One tooltip for the whole window. It appears quickly on anything with `data-tip`, unlike the browser's
 *  slow native title tooltips, and shows the shortcut beside the name. */
export function Tooltip() {
  const [shown, setShown] = useState<Shown | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let current: HTMLElement | null = null;
    let timer: number | undefined;
    let visible = false;
    let hiddenAt = 0; // moving straight from one tip to the next button shows its tip at once
    const hide = () => {
      if (visible) hiddenAt = Date.now();
      visible = false; current = null;
      window.clearTimeout(timer);
      setShown(null);
    };
    const over = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null;
      if (el === current) return;
      hide();
      if (!el) return;
      current = el;
      timer = window.setTimeout(() => {
        if (current !== el || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        visible = true;
        setShown({ label: el.dataset.tip ?? '', keys: el.dataset.keys || undefined, x: r.left + r.width / 2, top: r.top, bottom: r.bottom });
      }, Date.now() - hiddenAt < 500 ? 0 : 380);
    };
    // A click hides the tip, and it stays hidden until the pointer moves to something else.
    const press = (e: MouseEvent) => { const el = (e.target as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null; hide(); current = el; };
    const out = (e: MouseEvent) => { if (!e.relatedTarget) hide(); }; // the pointer left the window
    const opts = { capture: true, passive: true } as const;
    document.addEventListener('mouseover', over);
    document.addEventListener('mouseout', out);
    document.addEventListener('mousedown', press, true);
    document.addEventListener('keydown', hide, true);
    document.addEventListener('wheel', hide, opts);
    window.addEventListener('blur', hide);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mouseover', over);
      document.removeEventListener('mouseout', out);
      document.removeEventListener('mousedown', press, true);
      document.removeEventListener('keydown', hide, true);
      document.removeEventListener('wheel', hide, opts);
      window.removeEventListener('blur', hide);
    };
  }, []);

  // Sit below the button, or above it near the bottom of the window, and stay inside the window.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !shown) return;
    const w = el.offsetWidth; const h = el.offsetHeight;
    const left = Math.max(6, Math.min(window.innerWidth - w - 6, shown.x - w / 2));
    const below = shown.bottom + 6 + h < window.innerHeight - 6;
    el.style.left = `${left}px`;
    el.style.top = `${below ? shown.bottom + 6 : shown.top - 6 - h}px`;
    el.style.visibility = 'visible';
  }, [shown]);

  if (!shown) return null;
  return (
    <div className="tooltip" ref={ref} role="tooltip" style={{ visibility: 'hidden' }}>
      <span>{shown.label}</span>
      {shown.keys && <kbd>{shown.keys}</kbd>}
    </div>
  );
}
