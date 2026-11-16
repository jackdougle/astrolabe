// An untitled note with nothing in it is cleared away as soon as you are off it: its tab closes and the file is
// deleted. That covers Untitled.md, Untitled 2.md, Untitled 3.md and so on, however they were made (⌘N, ⌘T, ⌃⌘F, the
// navigator). "On it" means it is the file its editor is showing; a note left behind as a background tab is not, and
// neither is one whose editor is out of sight because the terminals fill the window (⌃⌘F from a terminal, or ⌘E).
//
// Empty means the file holds only white space, or exactly the text it was made with (the `noteTemplate` header a ⌘N
// note starts from). A note with unsaved typing, or one given a name of its own, is never touched, and the file's
// text is checked again in the main process just before it goes.
import { api, basename } from './api';
import { bus } from './panes';
import { showing, useStore } from './store';

const UNTITLED = /^Untitled( \d+)?\.md$/;
/** Notes already looked at while off screen, so each is read once. Forgotten when the note is shown again or closed. */
const looked = new Set<string>();

type S = ReturnType<typeof useStore.getState>;
/** The files on screen: what each editor is showing, or nothing while the terminals fill the window. */
function onScreen(s: S) {
  const shown = new Set<string>();
  if (showing(s) === 'terminal') return shown;
  for (const p of Object.values(s.panes)) if (p.kind === 'editor' && p.active) shown.add(p.active);
  return shown;
}

function sweep() {
  const s = useStore.getState();
  if (!s.ready) return;
  const shown = onScreen(s);
  const made = new Map<string, string | undefined>(); // untitled notes that are open → the text each was made with
  for (const p of Object.values(s.panes)) {
    if (p.kind !== 'editor') continue;
    for (const f of p.files) if (UNTITLED.test(basename(f.path))) made.set(f.path, f.blank ?? made.get(f.path));
  }
  for (const path of looked) if (!made.has(path) || shown.has(path)) looked.delete(path);
  for (const [path, blank] of made) {
    if (shown.has(path) || s.dirty[path] || looked.has(path)) continue;
    looked.add(path);
    void clear(path, blank);
  }
}

async function clear(path: string, blank: string | undefined) {
  const res = await api.fs.readFile(path);
  if (typeof res?.text !== 'string') return;
  if (res.text !== blank && res.text.trim() !== '') return;
  const s = useStore.getState();
  // You came back to it, or typed in it, while it was being read: it stays.
  if (onScreen(s).has(path) || s.dirty[path]) { looked.delete(path); return; }
  if (!(await api.fs.discardBlank(path, res.text))) return;
  const now = useStore.getState();
  for (const p of Object.values(now.panes)) if (p.kind === 'editor' && p.files.some((f) => f.path === path)) now.closeFile(p.id, path);
  bus.emit('file.closed', path); // its buffer is let go (monaco.ts)
  bus.emit('fs.changed');
}

useStore.subscribe((s, prev) => { if (s.panes !== prev.panes || s.ready !== prev.ready || s.areas !== prev.areas || s.focus !== prev.focus) sweep(); });
