// The faint traces that run out from a note's title: lines laid out as the copper on a circuit board is, on a grid,
// turning only by 45 degrees, leaving the title as the pins of a chip do (each from the edge of a letter, at a part
// of it that stands out towards the line: never from inside a letter, nor from a box round the title), running
// leftwards and downwards in parallel bundles that peel apart, with only short stubs over the top and off the
// right-hand end, and ending in vias and small terminals. They are drawn for each file from its name, so a file keeps its own pattern,
// and they thin out and cool in colour as they leave the word. They keep out of the note's text line by line, so
// they find their way into whatever a note leaves open: above it, in its margins, past the ends of its short lines.
export interface Box { left: number; top: number; right: number; bottom: number }
export interface WireScene {
  width: number; height: number;
  title: Box;
  /** The title's letters as they are drawn, so that the traces leave from the letters themselves and not from the box
   *  around them: its text, CSS font, where it starts, its baseline, and the transform it is drawn under (a to f).
   *  Without it they leave from the edges of `title`. */
  glyphs?: { text: string; font: string; x: number; baseline: number; matrix: number[] };
  /** A title with no characters at all: where its first letter would stand, the traces come in from all the way
   *  round and meet at this point. `r` is the radius of the round space they cross straight before they spread. */
  mark?: { x: number; y: number; r: number };
  /** What the traces keep out of: each line of the note's text, and anything else that is in it. */
  blocks: Box[];
  seed: string;
  /** Colours as "r, g, b": by the word, a little way out, and far off. */
  near: string; mid: string; far: string;
  /** How strong the lines are at the word, from 0 to 1. */
  strength: number;
}

const PITCH = 6; // the grid, in CSS pixels
// E, SE, S, SW, W, NW, N, NE
const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DY = [0, 1, 1, 1, 0, -1, -1, -1];
const E = 0, S = 2, W = 4, N = 6;

function random(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `off`: the step is a jog to one side of this heading, and may be taken to the other side when that is where the room is. */
interface Step { dir: number; len: number; off?: number }
/** `from`: where the line meets its letter, when that is not the middle of its first cell. */
interface Trace { cells: [number, number][]; end: 'via' | 'pin' | 'fade'; pulse: number; from?: [number, number] }

const INK = 96; // how opaque a pixel has to be to count
const PAD = 4; // the clear space a line keeps from the letters it runs past, in pixels
const HUB = 2.4; // the radius of the via an empty title's lines meet at
const GAP = 1.5; // the hairline left between a letter and the line that starts at it
const CLOSE = 9; // hollows and gaps narrower than about twice this are filled in: the inside of an n, the space between two letters
const NEAR = 10; // a line lands on a letter only where nothing within this far to either side of it...
const DEEP = 6; // ...stands out this much further towards it: otherwise it would run in beside or over a letter to get there
/** `alpha`: the shape no line runs through. `tight`: the letters themselves, with a hairline round them, which the lines start at. */
interface Ink { x0: number; y0: number; w: number; h: number; alpha: Uint8Array; tight: Uint8Array }
let inkCache: { key: string; ink: Ink | null } | null = null;
/** The title's words as the page draws them, twice over. `tight` is the letters with a hairline round them: a line
 *  starts at its edge. `alpha` is the shape the lines keep out of as they run: the letters made a little bigger all
 *  round, with the hollows in and between them filled, so that no line runs up inside one. A pixel is 255 inside
 *  and 0 outside, over a stretch of the grid that starts at (x0, y0). Null when there is nothing to draw. */
function inkOf(scene: WireScene): Ink | null {
  const g = scene.glyphs;
  const m = scene.mark;
  if (!m && (!g || !g.text.trim())) return null;
  const key = JSON.stringify([g, m, scene.title]);
  if (inkCache?.key === key) return inkCache.ink; // the note changes far more often than its title
  const made = ((): Ink | null => {
    const pad = PITCH * 3;
    const t = m ? { left: Math.min(scene.title.left, m.x - m.r), top: Math.min(scene.title.top, m.y - m.r), right: Math.max(scene.title.right, m.x + m.r), bottom: Math.max(scene.title.bottom, m.y + m.r) } : scene.title;
    const x0 = Math.max(0, Math.floor((t.left - pad) / PITCH) * PITCH), y0 = Math.max(0, Math.floor((t.top - pad) / PITCH) * PITCH);
    const w = Math.ceil((t.right + pad - x0) / PITCH) * PITCH, h = Math.ceil((t.bottom + pad - y0) / PITCH) * PITCH;
    if (w <= 0 || h <= 0 || w * h > 4e6) return null;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    /** The words (or the mark) with `grow` pixels added all round, as 1 or 0 a pixel. */
    const grown = (grow: number) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (m) {
        ctx.beginPath(); ctx.arc(m.x - x0, m.y - y0, m.r + grow, 0, Math.PI * 2); ctx.fill();
      } else if (g) {
        const [a, b, c, d, e, f] = g.matrix;
        ctx.setTransform(a, b, c, d, e - x0, f - y0);
        ctx.font = g.font;
        ctx.textBaseline = 'alphabetic';
        ctx.lineJoin = 'round';
        ctx.lineWidth = grow * 2;
        ctx.fillText(g.text, g.x, g.baseline);
        ctx.strokeText(g.text, g.x, g.baseline);
      }
      const data = ctx.getImageData(0, 0, w, h).data;
      const out = new Uint8Array(w * h);
      for (let i = 0; i < out.length; i++) out[i] = data[i * 4 + 3] > INK ? 1 : 0;
      return out;
    };
    // Grown far enough to close the hollows, then taken back in to PAD: along rows, then along columns, a pixel
    // stays only with `back` pixels of the shape on either side of it.
    const back = CLOSE - PAD;
    const wide = grown(CLOSE);
    const kept = new Uint8Array(w * h);
    const span = new Int32Array(Math.max(w, h));
    for (let y = 0; y < h; y++) {
      let n = 0;
      for (let x = 0; x < w; x++) { n = wide[y * w + x] ? n + 1 : 0; span[x] = n; }
      n = 0;
      for (let x = w - 1; x >= 0; x--) { n = wide[y * w + x] ? n + 1 : 0; kept[y * w + x] = n > back && span[x] > back ? 1 : 0; }
    }
    const closed = new Uint8Array(w * h);
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let y = 0; y < h; y++) { n = kept[y * w + x] ? n + 1 : 0; span[y] = n; }
      n = 0;
      for (let y = h - 1; y >= 0; y--) { n = kept[y * w + x] ? n + 1 : 0; closed[y * w + x] = n > back && span[y] > back ? 1 : 0; }
    }
    // Taking it back in squares off what was round, so the letters with a plain margin are laid over it.
    const near = grown(PAD - 1);
    const alpha = new Uint8Array(w * h);
    for (let i = 0; i < alpha.length; i++) alpha[i] = closed[i] || near[i] ? 255 : 0;
    const hair = grown(GAP);
    const tight = new Uint8Array(w * h);
    for (let i = 0; i < tight.length; i++) tight[i] = hair[i] ? 255 : 0;
    return { x0, y0, w, h, alpha, tight };
  })();
  inkCache = { key, ink: made };
  return made;
}

function layOut(scene: WireScene, ink: Ink | null): Trace[] {
  // Each pin and each bundle draws its chances from its own place on the title, not from one shared run of them:
  // a line that the text gets in the way of then changes alone, and the rest stay as they were while you type.
  const rng = (key: string) => random(`${scene.seed}\n${key}`);
  const picker = (rand: () => number) => (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
  const cols = Math.floor(scene.width / PITCH);
  const rows = Math.floor(scene.height / PITCH);
  const t = scene.title;
  // The cells the words' shape reaches into (`inkOf`), and the block of cells that holds them all: the chip the traces
  // leave. A line starts at the edge of that shape and crosses whatever of the block is empty on its way out.
  const inked = new Uint8Array(cols * rows);
  let c0 = cols, c1 = -1, r0 = rows, r1 = -1;
  if (ink) {
    for (let r = ink.y0 / PITCH; r < Math.min(rows, (ink.y0 + ink.h) / PITCH); r++) for (let c = ink.x0 / PITCH; c < Math.min(cols, (ink.x0 + ink.w) / PITCH); c++) {
      let n = 0;
      for (let y = 0; y < PITCH; y++) for (let x = 0; x < PITCH; x++) if (ink.alpha[(r * PITCH - ink.y0 + y) * ink.w + c * PITCH - ink.x0 + x] > INK) n++;
      if (!n) continue;
      inked[r * cols + c] = 1;
      c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, r); r1 = Math.max(r1, r);
    }
  }
  const lettered = c1 >= 0;
  if (!lettered) { c0 = Math.floor(t.left / PITCH); c1 = Math.ceil(t.right / PITCH) - 1; r0 = Math.floor(t.top / PITCH); r1 = Math.ceil(t.bottom / PITCH) - 1; }
  const shut = new Uint8Array(cols * rows); // the title and the text
  const shutCells = (ca: number, cb: number, ra: number, rb: number, as: number) => {
    for (let r = Math.max(0, ra); r <= Math.min(rows - 1, rb); r++) for (let c = Math.max(0, ca); c <= Math.min(cols - 1, cb); c++) shut[r * cols + c] = as;
  };
  // 2: the title's block, which only a stub may be laid in, and only where it is empty. A mark has no block: its lines
  // leave it all the way round, so the corners of the square it sits in are open ground.
  if (!scene.mark) shutCells(c0, c1, r0, r1, 2);
  // A cell is the text's when its middle is.
  for (const b of scene.blocks) shutCells(Math.ceil(b.left / PITCH - 0.5), Math.floor(b.right / PITCH - 0.5), Math.ceil(b.top / PITCH - 0.5), Math.floor(b.bottom / PITCH - 0.5), 1);
  const taken = new Uint8Array(cols * rows);
  const slashes = new Map<number, number>(); // diagonal steps, by the square they cross: two may not cross each other
  // How high and how far right the line being laid may go. The long ones keep below the title's top and left of its
  // right edge: nothing but a short stub leaves the word upwards or to the right.
  let ceiling = 1; let wall = cols - 1;
  let stub = false; // the line being laid is a stub, which may cross the empty part of the title's block
  const closed = (c: number, r: number) => {
    if (c < 0 || r < 1 || c >= cols || r >= rows || r < ceiling || c > wall) return true; // a row clear of the top edge
    const i = r * cols + c;
    return shut[i] === 1 || inked[i] === 1 || (shut[i] === 2 && !(stub && lettered));
  };
  const free = (c: number, r: number) => !closed(c, r) && !taken[r * cols + c];
  const canStep = (c: number, r: number, dir: number) => {
    const nc = c + DX[dir], nr = r + DY[dir];
    if (!free(nc, nr)) return false;
    if (DX[dir] && DY[dir]) {
      const square = Math.min(r, nr) * cols + Math.min(c, nc);
      const lean = DX[dir] === DY[dir] ? 1 : 2;
      const other = slashes.get(square);
      if (other && other !== lean) return false;
    }
    return true;
  };
  const step = (c: number, r: number, dir: number) => {
    const nc = c + DX[dir], nr = r + DY[dir];
    if (DX[dir] && DY[dir]) slashes.set(Math.min(r, nr) * cols + Math.min(c, nc), DX[dir] === DY[dir] ? 1 : 2);
    taken[nr * cols + nc] = 1;
  };
  const turn = (dir: number, by: number) => (dir + by + 8) % 8;
  /** How far apart two directions are, in turns of 45 degrees. */
  const apart = (a: number, b: number) => { const x = Math.abs(a - b) % 8; return Math.min(x, 8 - x); };
  /** What going `dir` from here has to offer a line that wants to go `want`: the sooner `want` opens again the
   *  better, and failing that the further `dir` itself runs. */
  const promise = (c: number, r: number, dir: number, want: number) => {
    for (let k = 1; k <= 10; k++) {
      if (!canStep(c, r, dir)) return k - 1;
      c += DX[dir]; r += DY[dir];
      if (canStep(c, r, want)) return 100 - k;
    }
    return 10;
  };
  /** The way to go next, for a line going `cur` whose plan says `want`: `want` when it is open, and otherwise the
   *  open way nearest to it that takes the line round what is in the way. A line turns 45 degrees at a time and
   *  never doubles back. -1 when it is boxed in. */
  const choose = (c: number, r: number, cur: number, want: number) => {
    if (apart(cur, want) <= 1 && canStep(c, r, want)) return want;
    let best = -1; let score = -Infinity;
    for (const dir of [cur, turn(cur, 1), turn(cur, -1)]) {
      if (dir === want || apart(dir, want) > 2 || !canStep(c, r, dir)) continue;
      const s = promise(c, r, dir, want) - apart(dir, want) * 1000;
      if (s > score) { score = s; best = dir; }
    }
    return best;
  };
  /** How much is open ahead and to one side (1 or -1) of a line going `heading`: of the 64 cells of a square there. */
  const openness = (c: number, r: number, heading: number, side: number) => {
    const across = turn(heading, side * 2);
    let n = 0;
    for (let i = 0; i < 8; i++) for (let j = 1; j <= 8; j++) if (free(c + DX[heading] * i + DX[across] * j, r + DY[heading] * i + DY[across] * j)) n++;
    return n;
  };
  /** Follows a plan from a pin, finding its way round the text and the lines already laid, and leaning into open
   *  ground: where one side of it is open and the other is not, its jogs go that way, and further. It ends when it is boxed
   *  in, or has slid sideways along something for too long without getting on. */
  const run = (c: number, r: number, plan: Step[], length: number, rand: () => number, least = 6): Trace | null => {
    if (!free(c, r) || !plan.length) return null;
    const cells: [number, number][] = [[c, r]];
    taken[r * cols + c] = 1;
    let left = length;
    let cur = plan[0].dir;
    let slid = 0;
    outer: for (const s of plan) {
      let want = s.dir; let len = s.len;
      if (s.off !== undefined) {
        const a = openness(c, r, s.off, 1), b = openness(c, r, s.off, -1);
        if (Math.max(a, b) >= 40 && Math.abs(a - b) >= 20) { want = turn(s.off, a > b ? 1 : -1); len += Math.floor(Math.max(a, b) / 20); }
      }
      for (let i = 0; i < len; i++) {
        if (left-- <= 0) break outer;
        const dir = choose(c, r, cur, want);
        if (dir < 0) break outer;
        if (apart(dir, want) >= 2) { if (++slid > 8) break outer; } else slid = 0;
        step(c, r, dir);
        c += DX[dir]; r += DY[dir];
        cur = dir;
        cells.push([c, r]);
      }
    }
    if (cells.length < least) return null; // too short to read as a line: left out (its cells stay taken, which only keeps others clear of the title)
    const kind = rand();
    // A terminal only on a short line: at the far end of a long one, which has faded by then, it reads as a stray dash.
    return { cells, end: kind < 0.45 ? 'via' : kind < 0.65 && cells.length <= 9 ? 'pin' : 'fade', pulse: rand() < 0.4 ? 0.12 + rand() * 0.45 : -1 };
  };
  /** A way of snaking along a heading: straight runs with 45-degree jogs to one side or the other, and now and then a longer drift. */
  const snake = (rand: () => number, heading: number, total: number, lean: number): Step[] => {
    const pick = picker(rand);
    const plan: Step[] = [];
    let gone = 0;
    let side = rand() < 0.5 ? 1 : -1;
    while (gone < total) {
      const straight = pick(3, 11);
      plan.push({ dir: heading, len: straight });
      gone += straight;
      if (rand() < 0.3 + lean) side = lean > 0 ? 1 : -side; else side = -side;
      const jog = rand() < 0.22 ? pick(3, 6) : pick(1, 3);
      plan.push({ dir: (heading + side + 8) % 8, len: jog, off: heading });
      gone += jog;
    }
    return plan;
  };

  const traces: Trace[] = [];
  /** How far a straight line coming in along `dir` (E, S, W or N) goes before it meets a letter, from the edge of
   *  the letters' patch: `at` is its y when it runs across and its x when it runs up or down. -1 when it meets none. */
  const meet = (at: number, dir: number) => {
    if (!ink) return -1;
    const across = dir === E || dir === W;
    const n = across ? ink.w : ink.h;
    const p = Math.floor(at - (across ? ink.y0 : ink.x0));
    if (p < 0 || p >= (across ? ink.h : ink.w)) return -1;
    for (let k = 0; k < n; k++) {
      const q = dir === E || dir === S ? k : n - 1 - k;
      if (ink.tight[across ? p * ink.w + q : q * ink.w + p]) return k;
    }
    return -1;
  };
  /** Where a line coming in along `dir` lands on a letter: the point on the letter's edge. Null when there is no
   *  letter in its way, or it would have to pass close beside or over a part of the word to reach one (a hollow, the
   *  space under an overhang, a tall letter beyond a short one): a line lands only on what stands out towards it. */
  const landing = (at: number, dir: number): [number, number] | null => {
    const d = meet(at, dir);
    if (d < 0 || !ink) return null;
    for (let off = 2; off <= NEAR; off += 2) for (const side of [-off, off]) {
      const o = meet(at + side, dir);
      if (o >= 0 && o < d - DEEP) return null;
      if (off === 2 && (o < 0 || o > d + 3)) return null; // it would only graze the side of something: a line lands squarely
    }
    if (dir === E) return [ink.x0 + d - 0.5, at];
    if (dir === W) return [ink.x0 + ink.w - d + 0.5, at];
    if (dir === S) return [at, ink.y0 + d - 0.5];
    return [at, ink.y0 + ink.h - d + 0.5];
  };
  const inner = new Uint8Array(cols * rows); // cells a line crosses between its letter and the open ground
  const clear = (way: [number, number][]) => way.every(([c, r]) => !inner[r * cols + c] && !taken[r * cols + c]);
  /** Keeps a line that was laid, with the cells between it and its letter (the one against the letter first) and
   *  the point on the letter's edge that it starts at. */
  const add = (made: Trace | null, way: [number, number][], from?: [number, number]) => {
    if (!made) return;
    for (const [wc, wr] of way) { inner[wr * cols + wc] = 1; taken[wr * cols + wc] = 1; }
    made.cells = [...way, ...made.cells];
    made.from = from;
    traces.push(made);
  };
  /** A title with no letters: lines run in like spokes from all the way round and meet in its middle. As with
   *  letters, only those heading left, down-left or down run on and snake away; the rest, over the top and off to
   *  the right, are short stubs that bend after a cell or two. */
  const radiate = (m: { x: number; y: number; r: number }) => {
    const SPOKES = 16;
    const ring = m.r + GAP;
    const longs = new Set([S, 3, W]);
    for (let i = 0; i < SPOKES; i++) {
      const own = rng(`s${i}`);
      const pick = picker(own);
      const a = (i / SPOKES) * Math.PI * 2; // 0 is east, and on round the way the clock goes
      // A spoke halfway between two headings takes one of them: one that may run on, when either may.
      const near = [Math.floor(i / 2) % 8, Math.ceil(i / 2) % 8];
      const can = near.filter((d) => longs.has(d));
      const heading = can.length ? can[Math.floor(own() * can.length)] : near[Math.floor(own() * near.length)];
      const long = can.length > 0;
      if (own() < (long ? 0.1 : 0.28)) continue;
      // Out along the spoke to the first cell clear of the mark: the line runs straight in from there to the ring.
      const ux = Math.cos(a), uy = Math.sin(a);
      let c = -1, r = -1;
      for (let d = ring; d < ring + PITCH * 4; d++) {
        const cc = Math.floor((m.x + ux * d) / PITCH), rr = Math.floor((m.y + uy * d) / PITCH);
        if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) break;
        if (!inked[rr * cols + cc]) { c = cc; r = rr; break; }
      }
      if (c < 0) continue;
      const from: [number, number] = [m.x + ux * HUB, m.y + uy * HUB]; // every line runs straight in to the middle
      if (long) {
        ceiling = r0; wall = c1 + 1; stub = false; // below the mark's top, and never out past its right side
        add(run(c, r, snake(own, heading, reach, 0), Math.floor(reach * (0.3 + own() * 0.65)), own), [], from);
      } else {
        ceiling = 1; wall = cols - 1; stub = true;
        const bend = turn(heading, own() < 0.5 ? 1 : -1);
        add(run(c, r, [{ dir: heading, len: pick(1, 2) }, { dir: bend, len: pick(1, 3) }], 5, own, 3), [], from);
      }
    }
    ceiling = 1; wall = cols - 1; stub = false;
  };
  const reach = Math.max(18, Math.floor(Math.min(scene.width * 0.6, 640) / PITCH));
  if (scene.mark && lettered) { radiate(scene.mark); return traces; }
  const room = cols - 1 - c1; // cells to the right of the title
  // The left side of the word gives the pins of the left edge. They leave in bundles: the lines of a bundle make the
  // same turns, so they stay side by side, and stop one after another. They keep below the title's top.
  ceiling = r0;
  {
    const rand = rng('left');
    const pick = picker(rand);
    for (let r = r0; r <= r1;) {
      const size = pick(1, 4);
      const plan = snake(rand, W, reach, 0);
      const length = Math.floor(reach * (0.35 + rand() * 0.6));
      const stagger = pick(2, 5) * (rand() < 0.5 ? 1 : -1);
      for (let k = 0; k < size && r <= r1; k++, r++) {
        if (rand() < 0.12) continue;
        if (!lettered) { add(run(c0 - 1, r, plan, Math.max(6, length + stagger * k), rng(`l${r - r0}`)), []); continue; }
        const land = landing((r + 0.5) * PITCH, E);
        if (!land) continue;
        const way: [number, number][] = [];
        for (let c = Math.floor((land[0] - 1.5) / PITCH - 0.5); c >= c0; c--) way.push([c, r]); // the cells whose middles are short of the letter
        if (clear(way)) add(run(c0 - 1, r, plan, Math.max(6, length + stagger * k), rng(`l${r - r0}`)), way, land);
      }
      if (rand() < 0.35) r += 1;
    }
  }
  // The feet of the word, where the note leaves room under the title (beside its first line, that is past the ends
  // of the short lines below): down into it, in bundles, never out past the title's right edge. A pin with text
  // close under it has none.
  wall = c1;
  {
    const rand = rng('bottom');
    const pick = picker(rand);
    // Room means room: five cells down, and by then two to either side, not a sliver between the text and the margin.
    const open = (c: number) => {
      for (let k = 1; k <= 5; k++) if (!free(c, r1 + k)) return false;
      for (let k = 3; k <= 5; k++) for (const side of [-2, -1, 1, 2]) if (closed(c + side, r1 + k) && c + side <= wall) return false;
      return true;
    };
    for (let c = c0 + 1; c <= c1 - 1;) {
      const size = pick(1, 3);
      const plan: Step[] = [{ dir: S, len: pick(2, 5) }, ...snake(rand, S, 70, 0)];
      const length = pick(12, 46);
      const stagger = pick(2, 5) * (rand() < 0.5 ? 1 : -1);
      for (let k = 0; k < size && c <= c1 - 1; k++, c++) {
        if (rand() < 0.15 || !open(c)) continue;
        if (!lettered) { add(run(c, r1 + 1, plan, Math.max(6, length + stagger * k), rng(`b${c - c0}`)), []); continue; }
        const land = landing((c + 0.5) * PITCH, N);
        if (!land) continue;
        const way: [number, number][] = [];
        for (let r = Math.ceil((land[1] + 1.5) / PITCH - 0.5); r <= r1; r++) way.push([c, r]);
        if (clear(way)) add(run(c, r1 + 1, plan, Math.max(6, length + stagger * k), rng(`b${c - c0}`)), way, land);
      }
      c += pick(2, 6);
    }
  }
  ceiling = 1; wall = cols - 1;
  // Over the top and off the right-hand end there are only stubs: a few short, shallow lines that finish those
  // edges off, each from the top or the end of the letter it is at. Up a cell and away to the left; out a cell or
  // two and down.
  stub = true;
  for (let c = c0 + 1; c <= c1 - 1; c += 2) {
    const own = rng(`t${c - c0}`);
    const pick = picker(own);
    if (own() < 0.55) continue;
    const plan: Step[] = [{ dir: N, len: 1 }, { dir: 5, len: 1 }, ...(own() < 0.5 ? [{ dir: W, len: pick(1, 3) }] : [])];
    if (!lettered) { add(run(c, r0 - 1, plan, 6, own, 3), []); continue; }
    const land = landing((c + 0.5) * PITCH, S);
    if (!land) continue; // between two words, or beside a taller letter
    // From the letter's top up to the first cell clear of the words' shape, and on from there.
    const way: [number, number][] = [];
    let row = Math.floor((land[1] - 1.5) / PITCH - 0.5);
    while (row > 1 && inked[row * cols + c] && way.length < 3) way.push([c, row--]);
    if (clear(way)) add(run(c, row, plan, 6, own, 3), way, land);
  }
  if (room >= 2) {
    for (let r = r0; r <= r1; r++) {
      const own = rng(`r${r - r0}`);
      const pick = picker(own);
      if (own() < 0.45) continue;
      const plan: Step[] = [{ dir: E, len: pick(1, 2) }, { dir: 1, len: pick(1, 2) }, ...(own() < 0.4 ? [{ dir: S, len: pick(1, 2) }] : [])];
      if (!lettered) { add(run(c1 + 1, r, plan, 6, own, 3), []); continue; }
      const land = landing((r + 0.5) * PITCH, W);
      if (!land) continue; // the last letter has nothing at this height
      const way: [number, number][] = [];
      let col = Math.ceil((land[0] + 1.5) / PITCH - 0.5);
      while (col < cols - 1 && inked[r * cols + col] && way.length < 3) way.push([col++, r]);
      if (clear(way)) add(run(col, r, plan, 6, own, 3), way, land);
    }
  }
  stub = false;
  return traces;
}

/** Draws the scene on `canvas`, which is sized here for the screen's pixel density. Returns a mark of the layout
 *  (how many traces, and a sum over where they go): the same scene always gives the same one. */
export function drawWires(canvas: HTMLCanvasElement, scene: WireScene) {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(scene.width * dpr);
  canvas.height = Math.round(scene.height * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, scene.width, scene.height);
  if (scene.strength <= 0 || scene.width < 80 || scene.height < 30) return '';
  const letters = inkOf(scene);
  const traces = layOut(scene, letters);
  const at = (cell: [number, number]): [number, number] => [(cell[0] + 0.5) * PITCH, (cell[1] + 0.5) * PITCH];
  const A = scene.strength;
  const path = (points: [number, number][]) => { ctx.beginPath(); points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); };
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // A soft bloom under the lines, strongest by the word.
  ctx.save();
  ctx.filter = 'blur(2.2px)';
  ctx.lineWidth = 2.6;
  ctx.strokeStyle = `rgba(${scene.near}, ${0.22 * A})`;
  for (const trace of traces) { path(trace.cells.slice(0, Math.ceil(trace.cells.length * 0.6)).map(at)); ctx.stroke(); }
  ctx.restore();
  for (const trace of traces) {
    const points = trace.cells.map(at);
    if (trace.from) points.unshift(trace.from); // from the letter itself
    const [x0, y0] = points[0];
    const [x1, y1] = points[points.length - 1];
    // Along its length a line goes from the word's colour through a cooler one to grey, and thins out.
    const ink = ctx.createLinearGradient(x0, y0, x1, y1);
    ink.addColorStop(0, `rgba(${scene.near}, ${A})`);
    ink.addColorStop(0.22, `rgba(${scene.near}, ${A * 0.86})`);
    ink.addColorStop(0.5, `rgba(${scene.mid}, ${A * 0.6})`);
    ink.addColorStop(0.8, `rgba(${scene.far}, ${A * 0.34})`);
    ink.addColorStop(1, `rgba(${scene.far}, ${A * 0.16})`);
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineWidth = 1;
    path(points);
    ctx.stroke();
    // Where it leaves the title: a pin, a little heavier than the line. (Lines that meet in an empty title's middle have none.)
    if (!scene.mark) {
      const [px, py] = points[1];
      const ang = Math.atan2(py - y0, px - x0);
      ctx.save(); ctx.translate(x0, y0); ctx.rotate(ang); ctx.fillRect(-0.4, -1, 3.4, 2); ctx.restore();
    }
    // Where it stops: a via (a ring with its hole), a terminal like the one it starts with, or nothing.
    if (trace.end === 'via') {
      ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.arc(x1, y1, 2.3, 0, Math.PI * 2); ctx.stroke();
    } else if (trace.end === 'pin') {
      const [bx, by] = points[points.length - 2];
      ctx.save(); ctx.translate(x1, y1); ctx.rotate(Math.atan2(y1 - by, x1 - bx));
      ctx.fillStyle = `rgba(${scene.near}, ${A * 0.55})`;
      ctx.fillRect(-0.4, -1, 3.4, 2); ctx.restore();
    }
    // A stretch of some lines is lit, as if something were passing along it: bright in its middle, gone at its ends.
    if (trace.pulse >= 0 && points.length > 8) {
      const i = Math.floor(trace.pulse * (points.length - 6));
      const lit = points.slice(i, i + 5);
      const glow = ctx.createLinearGradient(lit[0][0], lit[0][1], lit[lit.length - 1][0], lit[lit.length - 1][1]);
      glow.addColorStop(0, `rgba(${scene.mid}, 0)`);
      glow.addColorStop(0.5, `rgba(${scene.mid}, ${Math.min(1, A * 1.25)})`);
      glow.addColorStop(1, `rgba(${scene.mid}, 0)`);
      ctx.strokeStyle = glow; ctx.lineWidth = 1.3;
      path(lit); ctx.stroke();
    }
  }
  // Nothing is left on the letters themselves: not the soft edge of a line, nor its bloom. (An empty title has none.)
  if (letters && !scene.mark) {
    const stamp = document.createElement('canvas');
    stamp.width = letters.w; stamp.height = letters.h;
    const image = new ImageData(letters.w, letters.h);
    for (let i = 0; i < letters.tight.length; i++) image.data[i * 4 + 3] = letters.tight[i];
    stamp.getContext('2d')!.putImageData(image, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(stamp, letters.x0, letters.y0);
    ctx.restore();
  }
  if (scene.mark) drawMark(ctx, scene.mark, scene);
  // Everything fades with its distance from the word: quickly at first, then a long faint tail.
  const cx = (scene.title.left + scene.title.right) / 2;
  const cy = (scene.title.top + scene.title.bottom) / 2;
  const rx = Math.max(240, Math.min(scene.width * 0.66, 680));
  const ry = Math.max(190, scene.height * 0.95);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.translate(cx, cy);
  ctx.scale(rx / ry, 1);
  const fade = ctx.createRadialGradient(0, 0, 0, 0, 0, ry);
  for (const [stop, alpha] of [[0, 1], [0.16, 0.92], [0.34, 0.62], [0.52, 0.34], [0.7, 0.15], [0.86, 0.05], [1, 0]]) fade.addColorStop(stop, `rgba(0, 0, 0, ${alpha})`);
  ctx.fillStyle = fade;
  ctx.fillRect(-ry * 4, -ry * 2, ry * 8, ry * 4);
  ctx.restore();
  let sum = 0;
  for (const trace of traces) for (const [c, r] of trace.cells) sum = (Math.imul(sum, 31) + c * 131 + r) >>> 0;
  return `${traces.length}:${sum}:${traces.filter((trace) => trace.from).length}`; // the last: how many start at a letter
}

/** Where the lines of an empty title meet: a small via in the middle, with a faint glow. Nothing else. */
function drawMark(ctx: CanvasRenderingContext2D, m: { x: number; y: number; r: number }, scene: WireScene) {
  const A = scene.strength;
  const col = (c: string, a: number) => `rgba(${c}, ${Math.min(1, a)})`;
  ctx.save();
  ctx.translate(m.x, m.y);
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, HUB * 4);
  glow.addColorStop(0, col(scene.mid, A * 0.7));
  glow.addColorStop(1, col(scene.mid, 0));
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(0, 0, HUB * 4, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = col(scene.near, A * 1.6);
  ctx.lineWidth = 1.1;
  ctx.beginPath(); ctx.arc(0, 0, HUB, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

/** A CSS colour as "r, g, b". */
export function rgb(color: string) {
  const probe = document.createElement('canvas');
  probe.width = probe.height = 1;
  const ctx = probe.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#000';
  ctx.fillStyle = color.trim();
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `${r}, ${g}, ${b}`;
}
