import { useState } from 'react';

/** How long a closed tab, pane or file tab takes to fade out. It stays in the store this long, marked as leaving. */
export const EXIT_MS = 170;

export const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
export const exitDelay = () => (reducedMotion() ? 0 : EXIT_MS);

// What is already there when the window opens (a restored session) appears at once; only things made later animate in.
let booted = false;
export function markBooted() { booted = true; }

/** True on the first render of something made after launch, until its entrance animation ends. */
export function useEntering() {
  const [on, setOn] = useState(() => booted && !reducedMotion());
  const done = (e: React.AnimationEvent) => { if (e.target === e.currentTarget) setOn(false); };
  return [on, done] as const;
}
