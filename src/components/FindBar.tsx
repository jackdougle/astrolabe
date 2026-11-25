import { useEffect, useRef, useState } from 'react';
import type { Finder, Found } from '../lib/find';
import { Icon } from './Icons';
import { tip } from './Tooltip';

/** ⌘F's bar, the same over a terminal, a file shown as text and a rendered note. `make` gives the searcher for what
 *  the pane is showing (find.ts) and `target` changes when that is something else (another file, the other view of a
 *  note): the words are then looked for there. `memory` keeps the words for the next time the bar opens.
 *  `older`: Enter goes to the match before (a terminal is searched from its newest line upwards). */
export function FindBar({ make, target, placeholder, older, memory, onClose }: {
  make: ((report: (f: Found) => void) => Finder) | null; target: string; placeholder: string; older?: boolean;
  memory: React.MutableRefObject<string>; onClose: () => void;
}) {
  const [q, setQ] = useState(memory.current);
  const [found, setFound] = useState<Found>({ count: 0, at: 0 });
  const input = useRef<HTMLInputElement>(null);
  const finder = useRef<Finder | null>(null);
  const words = useRef(q);
  const touched = useRef(false); // typed in or stepped through: closing then leaves the caret on the match
  const opened = useRef(false);

  // Closing leaves the current match selected (declared before the searcher's own clean-up, so it runs first).
  useEffect(() => () => { if (touched.current) { try { finder.current?.place(); } catch { /* the view went first */ } } }, []);
  useEffect(() => {
    const f = make ? make(setFound) : null;
    finder.current = f;
    if (!f) setFound({ count: 0, at: 0 });
    if (f && !opened.current) {
      // Opened with a word or phrase selected: that is what to look for.
      const picked = f.selection();
      if (picked) { words.current = picked; memory.current = picked; setQ(picked); touched.current = true; }
    }
    if (f) opened.current = true;
    f?.find(words.current);
    return () => { try { f?.end(); } catch { /* the view went first */ } if (finder.current === f) finder.current = null; };
  }, [target, !!make]);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);

  const type = (value: string) => { words.current = value; memory.current = value; touched.current = true; setQ(value); finder.current?.find(value); };
  const go = (dir: 1 | -1) => { touched.current = true; finder.current?.step(dir); };
  const enter: 1 | -1 = older ? -1 : 1;
  const none = !!q && !found.count;
  return (
    <div className="findbar" onMouseDown={(e) => { if (e.target !== input.current) e.preventDefault(); }}>
      <input ref={input} value={q} placeholder={placeholder} spellCheck={false} aria-label={placeholder}
        onChange={(e) => type(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? (-enter as 1 | -1) : enter); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
        }} />
      {q && <span className={`find-count${none ? ' is-none' : ''}`}>{none ? 'No matches' : `${found.at || '–'} of ${found.count}${found.more ? '+' : ''}`}</span>}
      <button {...tip('Previous match', older ? '↩' : '⇧↩')} onClick={() => go(-1)}><Icon name="left" /></button>
      <button {...tip('Next match', older ? '⇧↩' : '↩')} onClick={() => go(1)}><Icon name="right" /></button>
      <button {...tip('Close', '⌘F')} onClick={onClose}><Icon name="x" /></button>
    </div>
  );
}
