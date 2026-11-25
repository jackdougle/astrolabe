// Line-by-line differences between two versions of a text, and the merge of two sets of edits made to the same text.

/** Lines [a0, a1) of the old text became lines [b0, b1) of the new one. Either stretch may be empty. */
export interface Change { a0: number; a1: number; b0: number; b1: number }

const LIMIT = 6_000_000; // cells of the table below; past this the middle is reported as one change

/** The changes that turn `a` into `b`, in order, never touching each other. */
export function diffLines(a: string[], b: string[]): Change[] {
  let lo = 0;
  const max = Math.min(a.length, b.length);
  while (lo < max && a[lo] === b[lo]) lo++;
  let hi = 0;
  while (hi < max - lo && a[a.length - 1 - hi] === b[b.length - 1 - hi]) hi++;
  const n = a.length - lo - hi;
  const m = b.length - lo - hi;
  if (!n && !m) return [];
  if (!n || !m || n * m > LIMIT) return [{ a0: lo, a1: lo + n, b0: lo, b1: lo + m }];
  // Longest common subsequence of the middle, from the end backwards, so the walk below runs forwards.
  const w = m + 1;
  const t = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    const ai = a[lo + i];
    for (let j = m - 1; j >= 0; j--) t[i * w + j] = ai === b[lo + j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
  }
  const out: Change[] = [];
  let i = 0; let j = 0; let open: Change | null = null;
  const touch = () => (open ??= { a0: lo + i, a1: lo + i, b0: lo + j, b1: lo + j });
  while (i < n || j < m) {
    if (i < n && j < m && a[lo + i] === b[lo + j]) { if (open) { out.push(open); open = null; } i++; j++; }
    else if (j < m && (i === n || t[i * w + j + 1] >= t[(i + 1) * w + j])) { touch().b1 = lo + ++j; }
    else { touch().a1 = lo + ++i; }
  }
  if (open) out.push(open);
  // Lines added or removed among others like them (a paragraph and the blank line beside it) can be cut in more
  // than one place. Cut so that the stretch starts on its text, not on a blank line.
  out.forEach((c, k) => {
    const next = out[k + 1];
    const side = c.a0 === c.a1 ? b : c.b0 === c.b1 ? a : null;
    if (!side) return;
    const at = side === a ? 'a' : 'b';
    while (c[`${at}0`] < c[`${at}1`] && !side[c[`${at}0`]].trim() && c[`${at}1`] < side.length && side[c[`${at}1`]] === side[c[`${at}0`]]
      && (!next || (c.a1 + 1 < next.a0 && c.b1 + 1 < next.b0))) { c.a0++; c.a1++; c.b0++; c.b1++; }
  });
  return out;
}

export interface Merged {
  lines: string[];
  /** Changes of theirs that fell on lines of mine that I had changed too: left out of `lines`, which keeps mine
   *  there. `m0`..`m1` are those lines of mine in `lines`; `theirs` is what the other side has in their place. */
  clashes: { m0: number; m1: number; theirs: string[] }[];
}

/** `mine` and `theirs` both started as `base`. Theirs is laid over mine: every change of theirs to lines I left
 *  alone goes in; where both changed the same lines, mine stays and theirs is reported. Two additions at the same
 *  place both go in, mine first. */
export function merge3(base: string[], mine: string[], theirs: string[]): Merged {
  const dm = diffLines(base, mine);
  const dt = diffLines(base, theirs);
  const lines: string[] = [];
  const clashes: Merged['clashes'] = [];
  const put = (from: string[], a: number, b: number) => { for (let i = a; i < b; i++) lines.push(from[i]); };
  let at = 0; let km = 0; let kt = 0;
  while (km < dm.length || kt < dt.length) {
    const M = dm[km]; const T = dt[kt];
    if (M && (!T || M.a1 <= T.a0)) { put(base, at, M.a0); put(mine, M.b0, M.b1); at = M.a1; km++; continue; }
    if (T && (!M || T.a1 <= M.a0)) { put(base, at, T.a0); put(theirs, T.b0, T.b1); at = T.a1; kt++; continue; }
    // Both changed the same lines: everything of either side that runs into this stretch belongs to it.
    const from = Math.min(M.a0, T.a0);
    let to = Math.max(M.a1, T.a1);
    const m = [M]; const t = [T];
    km++; kt++;
    for (;;) {
      if (dm[km] && dm[km].a0 < to) { to = Math.max(to, dm[km].a1); m.push(dm[km++]); }
      else if (dt[kt] && dt[kt].a0 < to) { to = Math.max(to, dt[kt].a1); t.push(dt[kt++]); }
      else break;
    }
    put(base, at, from);
    const m0 = lines.length;
    put(mine, m[0].b0 - (m[0].a0 - from), m[m.length - 1].b1 + (to - m[m.length - 1].a1));
    clashes.push({ m0, m1: lines.length, theirs: theirs.slice(t[0].b0 - (t[0].a0 - from), t[t.length - 1].b1 + (to - t[t.length - 1].a1)) });
    at = to;
  }
  put(base, at, base.length);
  return { lines, clashes };
}
