// The notes of a project as a network: every Markdown file is a point, and a link from one note to another
// ([[wiki links]], ![[embeds]] and [ordinary](links.md)) is a line between them. The points arrange themselves:
// linked notes pull together, notes near each other push apart, and everything leans towards the middle.
import { api } from './api';

/** An editor shows the graph of a project when its file's path is this followed by the project's folder. */
export const GRAPH = 'graph:';
export const isGraph = (path: string | null | undefined): path is string => !!path && path.startsWith(GRAPH);
export const graphRoot = (path: string) => path.slice(GRAPH.length);

export interface GNode {
  path: string; /** From the project's folder. */ rel: string; /** Without its folder or extension. */ name: string;
  /** Its folder at the top of the project ('' for a note that sits there itself). */ top: string;
  /** Where it falls among all the notes when they are listed folder by folder, from 0 to 1. Its colour comes from this,
   *  so notes that live together are coloured alike and the whole project runs through one gradient. */
  t: number;
  /** How many notes it is linked with. */ deg: number;
  x: number; y: number; vx: number; vy: number;
  /** Held here (while it is dragged). */ fx: number | null; fy: number | null;
}
export interface Graph {
  root: string; nodes: GNode[]; links: [number, number][];
  /** For each note, the notes it is linked with. */ near: number[][];
  /** The folders at the top of the project, with the middle of their stretch of the gradient. */
  tops: { name: string; t: number; count: number }[];
}

const NOTE = /\.(md|markdown|mdx)$/i;
const byFolder = (a: string, b: string) => {
  const x = a.toLowerCase().split('/'), y = b.toLowerCase().split('/');
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return x.length - y.length;
};
const dirOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
/** `to` as written in a note in `dir`, as a path from the project's folder; null when it climbs out of the project. */
function join(dir: string, to: string) {
  const out = to.startsWith('/') ? [] : dir.split('/').filter(Boolean);
  for (const part of to.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!out.length) return null; out.pop(); } else out.push(part);
  }
  return out.join('/');
}

/** Reads every note under `root` and works out which link to which. `progress` hears how far the reading has got. */
export async function scanNotes(root: string, progress?: (done: number, of: number) => void): Promise<Graph> {
  // Notes inside dot folders (.claude, .obsidian) are tools' own files, not the project's notes.
  const rels = ((await api.fs.listFiles(root)) as string[]).filter((f) => NOTE.test(f) && !/(^|\/)\.[^/]+\//.test(f)).sort(byFolder);
  const nodes: GNode[] = rels.map((rel, i) => ({
    path: `${root}/${rel}`, rel, name: rel.slice(rel.lastIndexOf('/') + 1).replace(NOTE, ''), top: rel.includes('/') ? rel.slice(0, rel.indexOf('/')) : '',
    t: rels.length > 1 ? i / (rels.length - 1) : 0.5, deg: 0, x: 0, y: 0, vx: 0, vy: 0, fx: null, fy: null,
  }));
  // A wiki link names a note by its name alone, or by the end of its path; an ordinary link gives a path from the note it is in.
  const byPath = new Map<string, number>();
  const byName = new Map<string, number[]>();
  nodes.forEach((n, i) => {
    byPath.set(n.rel.toLowerCase(), i);
    byPath.set(n.rel.replace(NOTE, '').toLowerCase(), i);
    const key = n.name.toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), i]);
  });
  const shared = (a: string, b: string) => { let k = 0; while (k < a.length && k < b.length && a[k] === b[k]) k++; return k; };
  const wiki = (from: number, target: string) => {
    const want = target.trim().replace(NOTE, '').toLowerCase();
    if (!want) return -1;
    const exact = byPath.get(want);
    if (exact !== undefined) return exact;
    let found = byName.get(want.slice(want.lastIndexOf('/') + 1)) ?? [];
    if (want.includes('/')) found = found.filter((i) => nodes[i].rel.replace(NOTE, '').toLowerCase().endsWith(`/${want}`));
    // Of several notes with the name, the one nearest the note that links to it.
    return found.length ? found.reduce((best, i) => (shared(nodes[i].rel, nodes[from].rel) > shared(nodes[best].rel, nodes[from].rel) ? i : best)) : -1;
  };
  const plain = (from: number, target: string) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) return -1;
    let to = target.replace(/[#?].*$/, '');
    try { to = decodeURIComponent(to); } catch {}
    const at = join(dirOf(nodes[from].rel), to);
    return at === null ? -1 : byPath.get(at.toLowerCase()) ?? -1;
  };

  const seen = new Set<number>();
  const links: [number, number][] = [];
  const link = (a: number, b: number) => {
    if (b < 0 || a === b) return;
    const key = a < b ? a * nodes.length + b : b * nodes.length + a;
    if (seen.has(key)) return;
    seen.add(key);
    links.push([a, b]);
  };
  let next = 0;
  let done = 0;
  const read = async () => {
    while (next < nodes.length) {
      const i = next++;
      const res = await api.fs.readFile(nodes[i].path).catch(() => null);
      // Links inside code are examples, not links.
      const text = typeof res?.text === 'string' ? res.text.replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, '').replace(/`[^`\n]*`/g, '') : '';
      for (const m of text.matchAll(/\[\[([^\]\n|#^]+)(?:[#^][^\]\n|]*)?(?:\|[^\]\n]*)?\]\]/g)) link(i, wiki(i, m[1]));
      for (const m of text.matchAll(/\]\(\s*<([^>\n]+)>[^)\n]*\)|\]\(\s*([^)\s]+)[^)\n]*\)/g)) link(i, plain(i, m[1] ?? m[2]));
      if (++done % 40 === 0 || done === nodes.length) progress?.(done, nodes.length);
    }
  };
  await Promise.all(Array.from({ length: 24 }, read));

  const near: number[][] = nodes.map(() => []);
  for (const [a, b] of links) { near[a].push(b); near[b].push(a); nodes[a].deg++; nodes[b].deg++; }
  const groups = new Map<string, { sum: number; count: number }>();
  for (const n of nodes) { const g = groups.get(n.top) ?? { sum: 0, count: 0 }; g.sum += n.t; g.count++; groups.set(n.top, g); }
  const tops = [...groups].map(([name, g]) => ({ name, t: g.sum / g.count, count: g.count })).sort((a, b) => a.t - b.t);
  return { root, nodes, links, near, tops };
}

/** A note's colour from its place among the folders: green through teal to blue, a little deeper as it goes. */
export function noteColor(t: number, dark: boolean) {
  const hue = 148 + 116 * t;
  return dark ? `oklch(${(0.82 - 0.1 * t).toFixed(3)} 0.125 ${hue.toFixed(1)})` : `oklch(${(0.62 - 0.1 * t).toFixed(3)} 0.14 ${hue.toFixed(1)})`;
}

interface Cell { x0: number; y0: number; s: number; m: number; cx: number; cy: number; kids: (Cell | undefined)[] | null; at: number }
/** The arrangement's numbers. What the eye sees depends on their ratios, since the view is fitted to the whole. */
export const PHYS = {
  /** How long a link likes to be, before the room its two notes take. */ link: 46,
  /** How hard notes push each other apart. */ charge: -60,
  /** How hard everything leans to the middle. */ gravity: 0.07,
  /** How much a note with no links pushes, against 1 for a linked one: lone notes pack closer, and leave the room to the linked. */ lone: 0.5,
  /** How much more a note pushes for each link it has (by the square root), so busy notes get room about them. */ hub: 0.3,
  /** How stiff links are. */ stiff: 0.7,
  /** How much is left of a note's speed after each step. */ drag: 0.6,
  /** How fast the arrangement cools. */ cool: 0.0228,
  /** How far a note's push reaches at full strength; past this it fades fast, so a far-off group does not hold
   *  lone notes away and they settle right beside it. */ reach: 140,
  /** How much room a unit of push ends up with, roughly; only the starting places use it. */ room: 3600,
};
const THETA2 = 0.81;  // how far off a cluster of notes must be to count as one (Barnes–Hut)

/** The arrangement, settling a step at a time. `alpha` is how much it still moves; it cools towards `alphaTarget`. */
export class Sim {
  alpha = 1;
  alphaTarget = 0;
  /** How hard each note pushes the others. */ private mass: Float32Array;
  /** `stretch` is the pane's width over its height: the notes settle into an oval of that shape, so they fill the pane. */
  constructor(public g: Graph, public stretch = 1) {
    this.mass = Float32Array.from(g.nodes, (n) => (n.deg ? 1 + PHYS.hub * Math.sqrt(n.deg) : PHYS.lone));
    this.stretch = Sim.shape(stretch);
    // With more notes the lean is gentler, so a large project is not pressed tighter than a small one.
    this.lean = PHYS.gravity / Math.sqrt(Math.max(1, this.mass.reduce((a, b) => a + b, 0) / 200));
  }
  private static shape = (stretch: number) => Math.min(2.2, Math.max(0.6, stretch || 1));
  /** The pane has a new shape: the notes move to fill it. Says whether that was enough of a change to move for. */
  reshape(stretch: number) {
    const to = Sim.shape(stretch);
    if (Math.abs(Math.log(to / this.stretch)) < 0.1) return false;
    this.stretch = to;
    this.alpha = Math.max(this.alpha, 0.4);
    return true;
  }
  private lean: number;

  /** Starting places for notes that have none. Left to themselves the notes end up evenly spread over an oval (each
   *  with room in proportion to its push), so they start that way: linked notes on a spiral from the middle, the most
   *  linked first, and lone notes sprinkled over the whole of it, since they are to end up in the gaps between groups. */
  scatter() {
    const nodes = this.g.nodes;
    const order = nodes.map((_, i) => i).sort((a, b) => nodes[b].deg - nodes[a].deg);
    const sx = Math.sqrt(this.stretch), sy = 1 / sx;
    const per = PHYS.room / Math.PI;
    const total = this.mass.reduce((a, b) => a + b, 0);
    let sum = 0;
    order.forEach((i, k) => {
      const n = nodes[i];
      sum += this.mass[i];
      if (n.x || n.y) return;
      // A lone note's place comes from its number alone, anywhere in the oval.
      const u = n.deg ? sum : total * (((i * 0.7548776662) % 1) * 0.96 + 0.02);
      const r = Math.sqrt(u * per), a = n.deg ? k * 2.39996 : ((i * 0.569840291) % 1) * 6.2832;
      n.x = r * Math.cos(a) * sx; n.y = r * Math.sin(a) * sy;
    });
  }

  tick() {
    const { nodes, links } = this.g;
    this.alpha += (this.alphaTarget - this.alpha) * PHYS.cool;
    const a = this.alpha;
    for (const [i, j] of links) {
      const s = nodes[i], t = nodes[j];
      const dx = t.x + t.vx - s.x - s.vx || 0.01, dy = t.y + t.vy - s.y - s.vy || 0.01;
      const l = Math.hypot(dx, dy);
      // A link between busy notes is longer, so their own notes have room to gather round each.
      const rest = PHYS.link + 5 * (Math.sqrt(s.deg) + Math.sqrt(t.deg));
      // A note with many links is tugged less by each one, so hubs hold still and their notes gather round.
      const k = (l - rest) / l * a * PHYS.stiff / Math.min(s.deg, t.deg);
      const b = s.deg / (s.deg + t.deg);
      t.vx -= dx * k * b; t.vy -= dy * k * b;
      s.vx += dx * k * (1 - b); s.vy += dy * k * (1 - b);
    }
    this.repel(a);
    // The lean to the middle is weaker along the pane's longer side, which is what makes the oval. Notes only push
    // those near them, so the oval is as long as the square root of how much weaker: hence the whole stretch each way.
    const gx = this.lean / this.stretch * a, gy = this.lean * this.stretch * a;
    for (const n of nodes) {
      n.vx -= n.x * gx; n.vy -= n.y * gy;
      if (n.fx !== null && n.fy !== null) { n.x = n.fx; n.y = n.fy; n.vx = 0; n.vy = 0; continue; }
      n.vx *= PHYS.drag; n.vy *= PHYS.drag;
      n.x += n.vx; n.y += n.vy;
    }
  }

  /** Every note pushes every other away. Far-off groups are taken as one point, which keeps thousands of notes quick. */
  private repel(a: number) {
    const nodes = this.g.nodes;
    if (nodes.length < 2) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes) { if (n.x < x0) x0 = n.x; if (n.x > x1) x1 = n.x; if (n.y < y0) y0 = n.y; if (n.y > y1) y1 = n.y; }
    const cell = (x: number, y: number, s: number): Cell => ({ x0: x, y0: y, s, m: 0, cx: 0, cy: 0, kids: null, at: -1 });
    const root = cell(x0, y0, Math.max(x1 - x0, y1 - y0) + 1);
    const put = (start: Cell, i: number) => {
      let c = start;
      for (let depth = 0; depth < 48; depth++) {
        if (!c.kids) {
          if (c.at < 0) { c.at = i; return; }
          const was = c.at;
          c.at = -1; c.kids = [undefined, undefined, undefined, undefined];
          put(c, was);
        }
        const h = c.s / 2;
        const n = nodes[i];
        const q = (n.x >= c.x0 + h ? 1 : 0) | (n.y >= c.y0 + h ? 2 : 0);
        c = c.kids[q] ??= cell(c.x0 + (q & 1 ? h : 0), c.y0 + (q & 2 ? h : 0), h);
      }
    };
    for (let i = 0; i < nodes.length; i++) put(root, i);
    const weigh = (c: Cell) => {
      if (!c.kids) { if (c.at >= 0) { c.m = this.mass[c.at]; c.cx = nodes[c.at].x; c.cy = nodes[c.at].y; } return; }
      for (const k of c.kids) { if (!k) continue; weigh(k); c.m += k.m; c.cx += k.cx * k.m; c.cy += k.cy * k.m; }
      if (c.m) { c.cx /= c.m; c.cy /= c.m; }
    };
    weigh(root);
    const stack: Cell[] = [];
    const reach2 = PHYS.reach * PHYS.reach;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      stack.length = 0; stack.push(root);
      while (stack.length) {
        const c = stack.pop()!;
        if (!c.m || (!c.kids && c.at === i)) continue;
        let dx = c.cx - n.x, dy = c.cy - n.y;
        let d2 = dx * dx + dy * dy;
        if (c.kids && c.s * c.s / THETA2 >= d2) { for (const k of c.kids) if (k) stack.push(k); continue; }
        if (d2 < 1) { dx = (i % 7 - 3) * 0.1 + 0.05; dy = (i % 5 - 2) * 0.1 + 0.05; d2 = 1; }
        const f = PHYS.charge * c.m * a / d2 * (d2 > reach2 ? reach2 / d2 : 1);
        n.vx += dx * f; n.vy += dy * f;
      }
    }
  }
}
