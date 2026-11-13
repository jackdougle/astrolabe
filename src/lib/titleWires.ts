// The faint traces that run out from a note's title: lines laid out as the copper on a circuit board is, on a grid,
// turning only by 45 degrees, leaving the title as the pins of a chip do, running in parallel bundles that peel
// apart, and ending in vias and pads. They are drawn for each file from its name, so a file keeps its own pattern,
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
interface Trace { cells: [number, number][]; end: 'via' | 'pad' | 'fade'; pulse: number; from?: [number, number] }

const INK = 96; // how opaque a pixel of the title has to be to count as letter
const REACH_IN = 5; // how many cells a line from the side crosses to reach a letter: further, and it reads as a rule over the word
/** The title's letters drawn as the page draws them, as each pixel's opacity, over a stretch of the grid that starts
 *  at (x0, y0). Null when there is nothing to draw. */
function inkOf(scene: WireScene) {
  const g = scene.glyphs;
  if (!g || !g.text.trim()) return null;
  const pad = PITCH * 2;
  const x0 = Math.max(0, Math.floor((scene.title.left - pad) / PITCH) * PITCH), y0 = Math.max(0, Math.floor((scene.title.top - pad) / PITCH) * PITCH);
  const w = Math.ceil((scene.title.right + pad - x0) / PITCH) * PITCH, h = Math.ceil((scene.title.bottom + pad - y0) / PITCH) * PITCH;
  if (w <= 0 || h <= 0 || w * h > 4e6) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const [a, b, c, d, e, f] = g.matrix;
  ctx.setTransform(a, b, c, d, e - x0, f - y0);
  ctx.font = g.font;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(g.text, g.x, g.baseline);
  const data = ctx.getImageData(0, 0, w, h).data;
  const alpha = new Uint8Array(w * h);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
  return { x0, y0, w, h, alpha };
}

function layOut(scene: WireScene): Trace[] {
  // Each pin and each bundle draws its chances from its own place on the title, not from one shared run of them:
  // a line that the text gets in the way of then changes alone, and the rest stay as they were while you type.
  const rng = (key: string) => random(`${scene.seed}\n${key}`);
  const picker = (rand: () => number) => (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
  const cols = Math.floor(scene.width / PITCH);
  const rows = Math.floor(scene.height / PITCH);
  const t = scene.title;
  // The cells the letters are in, and the block of cells that holds them all: the chip the traces leave. Its pins are
  // the letters: a line starts against a letter and crosses whatever of the block is empty on its way out.
  const ink = inkOf(scene);
  const inked = new Uint8Array(cols * rows);
  let c0 = cols, c1 = -1, r0 = rows, r1 = -1;
  if (ink) {
    for (let r = ink.y0 / PITCH; r < Math.min(rows, (ink.y0 + ink.h) / PITCH); r++) for (let c = ink.x0 / PITCH; c < Math.min(cols, (ink.x0 + ink.w) / PITCH); c++) {
      let n = 0;
      for (let y = 0; y < PITCH; y++) for (let x = 0; x < PITCH; x++) if (ink.alpha[(r * PITCH - ink.y0 + y) * ink.w + c * PITCH - ink.x0 + x] > INK) n++;
      if (n < 3) continue;
      inked[r * cols + c] = 1;
      c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, r); r1 = Math.max(r1, r);
    }
  }
  const lettered = c1 >= 0;
  if (!lettered) { c0 = Math.floor(t.left / PITCH); c1 = Math.ceil(t.right / PITCH) - 1; r0 = Math.floor(t.top / PITCH); r1 = Math.ceil(t.bottom / PITCH) - 1; }
  const shut = new Uint8Array(cols * rows); // the title and the text
  const shutCells = (ca: number, cb: number, ra: number, rb: number) => {
    for (let r = Math.max(0, ra); r <= Math.min(rows - 1, rb); r++) for (let c = Math.max(0, ca); c <= Math.min(cols - 1, cb); c++) shut[r * cols + c] = 1;
  };
  shutCells(c0, c1, r0, r1);
  // A cell is the text's when its middle is.
  for (const b of scene.blocks) shutCells(Math.ceil(b.left / PITCH - 0.5), Math.floor(b.right / PITCH - 0.5), Math.ceil(b.top / PITCH - 0.5), Math.floor(b.bottom / PITCH - 0.5));
  const taken = new Uint8Array(cols * rows);
  const slashes = new Map<number, number>(); // diagonal steps, by the square they cross: two may not cross each other
  const closed = (c: number, r: number) => c < 0 || r < 1 || c >= cols || r >= rows || shut[r * cols + c] === 1; // a row clear of the top edge
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
  const run = (c: number, r: number, plan: Step[], length: number, rand: () => number): Trace | null => {
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
    if (cells.length < 6) return null; // too short to read as a line: left out (its cells stay taken, which only keeps others clear of the title)
    const kind = rand();
    return { cells, end: kind < 0.45 ? 'via' : kind < 0.65 ? 'pad' : 'fade', pulse: rand() < 0.4 ? 0.12 + rand() * 0.45 : -1 };
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
  const inner = new Uint8Array(cols * rows); // cells of the title's block that a line crosses to reach its letter
  /** The way in from the cell (c, r) at the block's edge, going `dir`, to the nearest letter: the cells crossed,
   *  the one against the letter first. Null when there is no letter within `max` cells, or another line's way in
   *  lies across it. With no letters to go by, a line starts at the edge. */
  const lead = (c: number, r: number, dir: number, max: number): [number, number][] | null => {
    if (!lettered) return [];
    const cells: [number, number][] = [];
    for (let k = 0; k <= max; k++) {
      if (c < c0 || c > c1 || r < r0 || r > r1) return null;
      if (inked[r * cols + c]) return cells.reverse();
      if (inner[r * cols + c]) return null;
      cells.push([c, r]);
      c += DX[dir]; r += DY[dir];
    }
    return null;
  };
  /** Where a line that starts in the cell (c, r), with its letter in the direction `dir`, meets that letter. */
  const touch = (c: number, r: number, dir: number): [number, number] | undefined => {
    if (!ink) return undefined;
    const x = (c + 0.5) * PITCH, y = (r + 0.5) * PITCH;
    for (let k = 1; k <= PITCH * 2; k++) {
      const px = Math.round(x + DX[dir] * k - ink.x0), py = Math.round(y + DY[dir] * k - ink.y0);
      if (px < 0 || py < 0 || px >= ink.w || py >= ink.h) break;
      if (ink.alpha[py * ink.w + px] > INK) return [x + DX[dir] * (k - 1), y + DY[dir] * (k - 1)];
    }
    return undefined;
  };
  /** Keeps a line that was laid from the pin cell (c, r), with its way in to the letter that lies `dir` of it. */
  const add = (made: Trace | null, way: [number, number][], c: number, r: number, dir: number) => {
    if (!made) return;
    for (const [wc, wr] of way) inner[wr * cols + wc] = 1;
    const [fc, fr] = way[0] ?? [c, r];
    made.cells = [...way, ...made.cells];
    made.from = touch(fc, fr, dir);
    traces.push(made);
  };
  const reach = Math.max(18, Math.floor(Math.min(scene.width * 0.6, 640) / PITCH));
  const room = cols - 1 - c1; // cells to the right of the title
  // The left side of the first letter (and of a taller one just after it) gives the pins of the left edge. They leave in bundles: the lines of a bundle make the same turns, so they stay side by side, and stop one after another.
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
        const way = lead(c0, r, E, REACH_IN);
        if (way) add(run(c0 - 1, r, plan, Math.max(6, length + stagger * k), rng(`l${r - r0}`)), way, c0 - 1, r, E);
      }
      if (rand() < 0.35) r += 1;
    }
  }
  // The right edge, where there is room beside the text: out, then down the margin.
  if (room > 4) {
    for (let r = r0; r <= r1; r++) {
      const own = rng(`r${r - r0}`);
      const pick = picker(own);
      if (own() < 0.3) continue;
      const out = pick(2, Math.max(3, Math.min(room - 2, 12)));
      const plan: Step[] = [{ dir: E, len: out + (r1 - r) }, { dir: 1, len: pick(1, 3) }, ...snake(own, S, 70, 0)];
      const way = lead(c1, r, W, REACH_IN);
      if (way) add(run(c1 + 1, r, plan, pick(14, 64), own), way, c1 + 1, r, W);
    }
  }
  // The tops of the letters: each line escapes upwards, a row higher than the last so that they can turn and run side by side.
  {
    const rand = rng('top');
    const above = r0;
    const ways = new Map<number, [number, number][]>();
    const tops: number[] = [];
    for (let c = c0 + 1; c <= c1 - 1; c += 2) if (rand() < 0.6) { const way = lead(c, r0, S, rows); if (way) { tops.push(c); ways.set(c, way); } }
    const westward = tops.filter((c) => c < (c0 + c1) / 2).slice(0, Math.max(0, above - 2));
    const eastward = tops.filter((c) => c >= (c0 + c1) / 2).reverse().slice(0, Math.max(0, above - 2));
    const shared = snake(rand, W, reach, 0.12).map((s) => (s.dir === 5 ? { ...s, dir: 3 } : s));
    westward.forEach((c, i) => {
      const own = rng(`t${c - c0}`);
      const plan: Step[] = [{ dir: N, len: i + 1 }, { dir: 5, len: 1 }, { dir: W, len: c - c0 + picker(own)(2, 6) }, ...shared];
      const way = lead(c, r0, S, rows); // again: a line laid since may lie across it
      if (way) add(run(c, r0 - 1, plan, Math.floor(reach * (0.45 + own() * 0.5)), own), way, c, r0 - 1, S);
    });
    if (room > 6) {
      const down = snake(rand, S, 60, 0);
      eastward.forEach((c, i) => {
        const own = rng(`t${c - c0}`);
        const plan: Step[] = [{ dir: N, len: i + 1 }, { dir: 7, len: 1 }, { dir: E, len: c1 - c + 2 + i }, { dir: 1, len: 2 }, ...down];
        const way = lead(c, r0, S, rows);
        if (way) add(run(c, r0 - 1, plan, picker(own)(24, 70), own), way, c, r0 - 1, S);
      });
    }
  }
  // The feet of the letters, where the note leaves room under the title (beside its first line, that is past the
  // ends of the short lines below): down into it, in bundles. A pin with text close under it has none.
  {
    const rand = rng('bottom');
    const pick = picker(rand);
    const open = (c: number) => { for (let k = 1; k <= 5; k++) if (!free(c, r1 + k)) return false; return true; };
    for (let c = c0 + 1; c <= c1 - 1;) {
      const size = pick(1, 3);
      const plan: Step[] = [{ dir: S, len: pick(2, 5) }, ...snake(rand, S, 70, 0)];
      const length = pick(12, 46);
      const stagger = pick(2, 5) * (rand() < 0.5 ? 1 : -1);
      for (let k = 0; k < size && c <= c1 - 1; k++, c++) {
        if (rand() < 0.15 || !open(c)) continue;
        const way = lead(c, r1, N, rows);
        if (way) add(run(c, r1 + 1, plan, Math.max(6, length + stagger * k), rng(`b${c - c0}`)), way, c, r1 + 1, N);
      }
      c += pick(2, 6);
    }
  }
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
  const traces = layOut(scene);
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
    // Where it leaves the title: a pin, a little heavier than the line.
    const [px, py] = points[1];
    const ang = Math.atan2(py - y0, px - x0);
    ctx.save(); ctx.translate(x0, y0); ctx.rotate(ang); ctx.fillRect(-3.2, -1, 3.4, 2); ctx.restore();
    // Where it stops: a via (a ring with its hole), a pad, or nothing.
    if (trace.end === 'via') {
      ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.arc(x1, y1, 2.3, 0, Math.PI * 2); ctx.stroke();
    } else if (trace.end === 'pad') {
      const [bx, by] = points[points.length - 2];
      ctx.save(); ctx.translate(x1, y1); ctx.rotate(Math.atan2(y1 - by, x1 - bx));
      ctx.beginPath(); ctx.roundRect(-0.5, -1.9, 5.2, 3.8, 1); ctx.fill(); ctx.restore();
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
