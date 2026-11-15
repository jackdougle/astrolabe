import { useEffect, useRef, useState } from 'react';
import { tildify } from '../lib/api';
import { Graph, GNode, noteColor, scanNotes, Sim } from '../lib/graph';
import { reducedMotion } from '../lib/motion';
import { bus } from '../lib/panes';
import { openFiles, useStore } from '../lib/store';
import { Icon } from './Icons';
import { tip } from './Tooltip';

// A project's graph is kept while the window is open, so coming back to its tab shows it as it was left.
const kept = new Map<string, { sim: Sim; view: View | null }>();
/** A note's size in the arrangement's own units. On screen it grows with the zoom, but slower than the distances
 *  do: far out the notes are still easy to see, and close up they do not swell into each other. */
const radius = (n: GNode, k: number) => Math.max((3.3 + Math.sqrt(n.deg) * 1.3) * Math.pow(k, -0.45), 1.3 / k);
/** Whether the zoom alone is enough for a note to be named: the busiest notes are named first, from far out. */
const named = (n: GNode, k: number) => k * (1 + 0.18 * Math.sqrt(n.deg)) >= 1.5;
/** A long name is cut short, except for the note under the pointer. */
const short = (name: string) => (name.length > 34 ? `${name.slice(0, 32).trimEnd()}…` : name);
const DIM = 0.56;      // how much of a note that is not picked out fades away
const NAME = 10.5;     // the size of a name, and of the name of the note under the pointer
const NAME_OVER = 12;
/** Moves `v` towards `to`, most of the way in about three times `ms`. */
const ease = (v: number, to: number, dt: number, ms: number) => (Math.abs(to - v) < 0.012 ? to : v + (to - v) * (1 - Math.exp(-dt / ms)));
type View = { k: number; x: number; y: number };

/** The notes of a project as a network (see lib/graph.ts). Scroll to zoom, drag to move about, drag a note to pull
 *  it, click a note to open it (⌘-click: to the side) and bring the view in on it. Typing in the box picks out the
 *  notes whose names match. */
export function GraphView({ root }: { root: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const [graph, setGraph] = useState<Graph | null>(kept.get(root)?.sim.g ?? null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [over, setOver] = useState<GNode | null>(null);
  const [scan, setScan] = useState(0);
  const theme = useStore((s) => s.settings.theme);
  const open = useStore((s) => openFiles(s).map((f) => f.path).join('\n'));
  // What the drawing reads each frame, kept out of React's way.
  const live = useRef({
    sim: null as Sim | null, view: { k: 1, x: 0, y: 0 } as View, hover: -1, match: null as Set<number> | null, open: new Set<string>(), frame: 0, fitted: false,
    /** The view was moved or zoomed by hand, so it is no longer refitted. */ moved: false, w: 0, h: 0,
    /** The notes are moving to fill a pane that changed shape, and the view follows them. */ refit: false, reshape: 0,
    /** When the last frame was drawn (0 when nothing was moving), and when the pointer came onto its note. */ last: 0, hoverAt: 0,
    /** The view on its way somewhere: after a click on a note, or a double click on the background. */ glide: null as { from: View; to: View; t0: number; ms: number } | null,
    /** What fades: how far the notes that are not picked out have dimmed, how picked out each note is, how far each
     *  name has come in, and how far the lines of the note under the pointer have lit (`lit` is that note). */
    focus: 0, glow: new Float32Array(0), names: new Float32Array(0), lit: -1, litAmt: 0,
    /** For the graph these were made for: the notes from most linked to least, and how wide each name is. */
    of: null as Graph | null, order: [] as number[], wide: new Float32Array(0), font: '',
  });
  const kick = useRef<() => void>(() => {});

  live.current.open = new Set(open.split('\n'));
  useEffect(() => {
    const q = query.trim().toLowerCase();
    const sim = live.current.sim;
    live.current.match = q && sim ? new Set(sim.g.nodes.map((n, i) => (n.rel.toLowerCase().includes(q) ? i : -1)).filter((i) => i >= 0)) : null;
    kick.current();
  }, [query, graph]);
  useEffect(() => { kick.current(); }, [open, theme]);

  // Read the notes: at first, when asked to, and a moment after files change.
  useEffect(() => {
    let dead = false;
    const had = kept.get(root);
    if (had && !scan) { live.current.sim = had.sim; if (had.view) { live.current.view = had.view; live.current.fitted = true; live.current.moved = true; } setGraph(had.sim.g); kick.current(); return; }
    if (!had) setProgress('Reading notes…');
    scanNotes(root, (done, of) => { if (!dead && !had) setProgress(`Reading notes… ${done} of ${of}`); }).then((g) => {
      if (dead) return;
      // Notes that were already there keep their places; new ones start beside a note they link to.
      const before = new Map((had?.sim.g.nodes ?? []).map((n) => [n.path, n]));
      g.nodes.forEach((n) => { const b = before.get(n.path); if (b) { n.x = b.x; n.y = b.y; } });
      g.nodes.forEach((n, i) => { if (before.size && !before.has(n.path)) { const by = g.near[i].map((j) => g.nodes[j]).find((m) => m.x || m.y); n.x = (by?.x ?? 0) + (i % 9 - 4) * 3 + 1; n.y = (by?.y ?? 0) + (i % 7 - 3) * 3 + 1; } });
      const wrap = wrapRef.current;
      const sim = new Sim(g, wrap && wrap.clientHeight ? wrap.clientWidth / wrap.clientHeight : had?.sim.stretch ?? 1.5);
      sim.scatter();
      // Most of the settling happens before it is first shown, so it does not open as a ball flying apart. A large
      // project gets fewer steps, so it does not keep you waiting, and does the rest in view.
      if (!before.size) for (let i = Math.round(Math.min(220, Math.max(50, 330000 / g.nodes.length))); i > 0; i--) sim.tick();
      else sim.alpha = 0.3;
      kept.set(root, { sim, view: had?.view ?? null });
      live.current.sim = sim;
      setProgress(null); setError(null); setGraph(g);
      kick.current();
    }).catch((e) => { if (!dead) { setProgress(null); setError(String(e?.message ?? e)); } });
    return () => { dead = true; };
  }, [root, scan]);
  useEffect(() => {
    let timer = 0;
    const off = bus.on('fs.changed', () => { window.clearTimeout(timer); timer = window.setTimeout(() => setScan((n) => n + 1), 1500); });
    return () => { off(); window.clearTimeout(timer); };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext('2d')!;
    const st = live.current;
    const size = () => ({ w: wrap.clientWidth, h: wrap.clientHeight });
    const fitView = (): View | null => {
      const { w, h } = size();
      const ns = st.sim?.g.nodes ?? [];
      if (!ns.length || !w || !h) return null;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const n of ns) { x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x); y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y); }
      // Room is left for the box at the top and the line at the bottom.
      const k = Math.min(2.2, Math.max(0.04, 0.94 * Math.min(w / (x1 - x0 + 40), (h - 56) / (y1 - y0 + 40))));
      return { k, x: w / 2 - (x0 + x1) / 2 * k, y: h / 2 + 6 - (y0 + y1) / 2 * k };
    };
    const fit = () => { const v = fitView(); if (v) { st.view = v; st.fitted = true; st.glide = null; } };
    const keep = (v: View) => { const had = kept.get(root); if (had) had.view = v; };
    /** Takes the view somewhere smoothly. */
    const glideTo = (to: View, ms = 420) => {
      st.moved = true; keep(to);
      if (reducedMotion()) { st.view = to; st.glide = null; } else st.glide = { from: st.view, to, t0: performance.now(), ms };
      kick.current();
    };

    /** Draws a frame, `dt` ms after the last. Says whether anything is still fading or gliding. */
    const draw = (dt: number, now: number) => {
      const { w, h } = size();
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const sim = st.sim;
      if (!sim || !w || !h) return false;
      // When the pane changes size, a view nobody has touched is fitted again; one that has been moved keeps its middle.
      if (st.w && (st.w !== w || st.h !== h)) {
        const dx = (w - st.w) / 2, dy = (h - st.h) / 2;
        const shift = (v: View) => ({ ...v, x: v.x + dx, y: v.y + dy });
        if (st.moved) { st.view = shift(st.view); if (st.glide) { st.glide = { ...st.glide, from: shift(st.glide.from), to: shift(st.glide.to) }; keep(st.glide.to); } else keep(st.view); }
        else st.fitted = false;
        // Once the pane has stopped changing, the notes move to fill its new shape.
        window.clearTimeout(st.reshape);
        st.reshape = window.setTimeout(() => { const now = size(); if (now.h && st.sim?.reshape(now.w / now.h)) { st.refit = true; kick.current(); } }, 320);
      }
      st.w = w; st.h = h;
      if (st.refit && !st.moved && !st.glide) st.fitted = false;
      if (!st.fitted) fit();
      let busy = false;
      if (st.glide) {
        const { from, to, t0, ms } = st.glide;
        const t = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - t, 3);
        // The zoom goes by ratio and the middle of the pane travels straight, which reads as one movement.
        const k = from.k * Math.pow(to.k / from.k, e);
        const cx = (w / 2 - from.x) / from.k + ((w / 2 - to.x) / to.k - (w / 2 - from.x) / from.k) * e;
        const cy = (h / 2 - from.y) / from.k + ((h / 2 - to.y) / to.k - (h / 2 - from.y) / from.k) * e;
        st.view = { k, x: w / 2 - cx * k, y: h / 2 - cy * k };
        if (t >= 1) { st.view = to; st.glide = null; } else busy = true;
      }
      const { nodes, links, near } = sim.g;
      const css = getComputedStyle(document.documentElement);
      const dark = document.documentElement.dataset.theme !== 'light';
      const text = css.getPropertyValue('--text').trim() || '#ddd';
      const font = css.getPropertyValue('--mono').trim() || 'monospace';
      if (st.of !== sim.g || st.font !== font) {
        st.of = sim.g; st.font = font;
        st.order = nodes.map((_, i) => i).sort((a, b) => nodes[b].deg - nodes[a].deg || a - b);
        st.glow = new Float32Array(nodes.length); st.names = new Float32Array(nodes.length);
        ctx.font = `500 ${NAME}px ${font}`;
        st.wide = Float32Array.from(nodes, (n) => ctx.measureText(short(n.name)).width);
        st.lit = -1; st.litAmt = 0;
      }
      const { k, x, y } = st.view;
      const still = reducedMotion();
      // Picked out: the note under the pointer with the notes it is linked to, or the notes the box has found.
      const over = st.hover < nodes.length ? st.hover : -1;
      const hot = over >= 0 ? new Set([over, ...near[over]]) : st.match;
      // The rest fade back a little, and gradually; when nothing is picked out any more they come back the same way.
      const focus = still ? (hot ? 1 : 0) : ease(st.focus, hot ? 1 : 0, dt, 110);
      if (focus !== (hot ? 1 : 0)) busy = true;
      st.focus = focus;
      if (over >= 0 && st.lit !== over) { st.lit = over; st.litAmt = 0; }
      st.litAmt = still ? (over >= 0 ? 1 : 0) : ease(st.litAmt, over >= 0 ? 1 : 0, dt, 90);
      if (st.litAmt !== (over >= 0 ? 1 : 0)) busy = true;
      const glow = st.glow;
      if (hot) for (let i = 0; i < nodes.length; i++) { const to = hot.has(i) ? 1 : 0; if (glow[i] !== to) { glow[i] = still ? to : ease(glow[i], to, dt, 90); if (glow[i] !== to) busy = true; } }

      ctx.translate(x, y); ctx.scale(k, k);
      ctx.lineWidth = Math.min(1.4, 0.8 / k);
      ctx.strokeStyle = text;
      ctx.globalAlpha = (dark ? 0.16 : 0.22) * (1 - 0.5 * focus);
      ctx.beginPath();
      for (const [a, b] of links) { ctx.moveTo(nodes[a].x, nodes[a].y); ctx.lineTo(nodes[b].x, nodes[b].y); }
      ctx.stroke();
      if (st.lit >= 0 && st.lit < nodes.length && st.litAmt > 0) {
        ctx.globalAlpha = 0.7 * st.litAmt; ctx.lineWidth = Math.min(2.2, 1.2 / k); ctx.strokeStyle = noteColor(nodes[st.lit].t, dark);
        ctx.beginPath();
        for (const j of near[st.lit]) { ctx.moveTo(nodes[st.lit].x, nodes[st.lit].y); ctx.lineTo(nodes[j].x, nodes[j].y); }
        ctx.stroke();
      }
      // Only what is in view is drawn.
      const vx0 = -x / k - 30 / k, vy0 = -y / k - 30 / k, vx1 = (w - x) / k + 30 / k, vy1 = (h - y) / k + 30 / k;
      const seen = (n: GNode) => n.x >= vx0 && n.x <= vx1 && n.y >= vy0 && n.y <= vy1;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (!seen(n)) continue;
        ctx.globalAlpha = 1 - focus * (1 - glow[i]) * DIM;
        ctx.fillStyle = noteColor(n.t, dark);
        ctx.beginPath(); ctx.arc(n.x, n.y, radius(n, k), 0, 6.2832); ctx.fill();
        // A note that is open in an editor wears a ring.
        if (st.open.has(n.path)) { ctx.lineWidth = 1.4 / k; ctx.strokeStyle = text; ctx.beginPath(); ctx.arc(n.x, n.y, radius(n, k) + 2.4 / k, 0, 6.2832); ctx.stroke(); }
      }

      // Names, in the pane's own units so they stay one size. A name is only written where it does not run into one
      // already written, and they are tried in order: the note under the pointer, then what is picked out, then the
      // rest as the zoom brings them in, each lot from the most linked note down. So a busy note's neighbours are not
      // all named on top of each other; the ones left out get their turn as you zoom in and room opens up.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const want = new Float32Array(nodes.length);
      const cells = new Map<number, number[]>();
      const boxes: number[] = [];
      const place = (i: number, must: boolean) => {
        const n = nodes[i];
        const big = i === over;
        if (big) ctx.font = `600 ${NAME_OVER}px ${font}`;
        const half = (big ? ctx.measureText(n.name).width : st.wide[i]) / 2 + 5, tall = (big ? NAME_OVER : NAME) + 5;
        const cx = n.x * k + x, top = n.y * k + y + radius(n, k) * k + 2;
        const x0 = cx - half, x1 = cx + half, y1 = top + tall;
        const c0 = Math.floor(x0 / 96), c1 = Math.floor(x1 / 96), r0 = Math.floor(top / 32), r1 = Math.floor(y1 / 32);
        if (!must) for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) for (const b of cells.get(c * 4096 + r) ?? []) if (x0 < boxes[b + 2] && x1 > boxes[b] && top < boxes[b + 3] && y1 > boxes[b + 1]) return false;
        const b = boxes.length;
        boxes.push(x0, top, x1, y1);
        for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) { const key = c * 4096 + r; const list = cells.get(key); if (list) list.push(b); else cells.set(key, [b]); }
        return true;
      };
      if (over >= 0) { place(over, true); want[over] = 1; }
      const few = !!hot && hot.size <= 400;
      if (few) {
        // The notes linked to the one under the pointer are named one after another, not all at once.
        const each = Math.min(28, 360 / hot!.size);
        let turn = 0;
        for (const i of st.order) {
          if (i === over || !hot!.has(i) || !seen(nodes[i])) continue;
          if (over >= 0 && !still && now - st.hoverAt < ++turn * each) { busy = true; continue; }
          if (place(i, false)) want[i] = 1;
        }
      }
      for (const i of st.order) {
        const n = nodes[i];
        if (!named(n, k)) break;
        if (!want[i] && !(few && hot!.has(i)) && seen(n) && place(i, false)) want[i] = 0.84;
      }
      ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.lineJoin = 'round'; ctx.lineWidth = 3;
      ctx.strokeStyle = css.getPropertyValue('--bg').trim() || (dark ? '#000' : '#fff');
      ctx.fillStyle = text;
      const names = st.names;
      for (let i = 0; i < nodes.length; i++) {
        if (names[i] !== want[i]) { names[i] = still ? want[i] : ease(names[i], want[i], dt, want[i] > names[i] ? 70 : 50); if (names[i] !== want[i]) busy = true; }
        if (names[i] <= 0.012 || !seen(nodes[i])) continue;
        const n = nodes[i];
        const big = i === over;
        const a = names[i] * (1 - focus * (1 - glow[i]) * DIM);
        const tx = n.x * k + x, ty = n.y * k + y + radius(n, k) * k + 4;
        ctx.font = `${big ? 600 : 500} ${big ? NAME_OVER : NAME}px ${font}`;
        // A soft edge in the background's colour keeps a name readable where it crosses lines and notes.
        const name = big ? n.name : short(n.name);
        ctx.globalAlpha = a * 0.7; ctx.strokeText(name, tx, ty);
        ctx.globalAlpha = a; ctx.fillText(name, tx, ty);
      }
      ctx.globalAlpha = 1;
      return busy;
    };

    const loop = (now: number) => {
      st.frame = 0;
      const dt = st.last ? Math.min(64, now - st.last) : 0;
      st.last = now;
      const sim = st.sim;
      // A graph kept from before may come back in a pane of another shape.
      if (sim && !st.w) { const { w, h } = size(); if (w && h && sim.reshape(w / h)) st.refit = true; }
      const moving = !!sim && (sim.alpha > 0.004 || sim.alphaTarget > 0);
      if (sim && moving) { sim.tick(); if (reducedMotion()) for (let i = 0; i < 200 && sim.alpha > 0.004; i++) sim.tick(); }
      if (!moving) st.refit = false;
      const busy = draw(dt, now);
      if (moving || busy) st.frame = requestAnimationFrame(loop); else st.last = 0;
    };
    kick.current = () => { if (!st.frame) st.frame = requestAnimationFrame(loop); };
    kick.current();

    const at = (e: MouseEvent) => { const r = canvas.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top, x: (e.clientX - r.left - st.view.x) / st.view.k, y: (e.clientY - r.top - st.view.y) / st.view.k }; };
    const under = (p: { x: number; y: number }) => {
      const ns = st.sim?.g.nodes ?? [];
      let best = -1, bd = Infinity;
      for (let i = 0; i < ns.length; i++) { const d = Math.hypot(ns[i].x - p.x, ns[i].y - p.y) - Math.max(radius(ns[i], st.view.k), 7 / st.view.k); if (d < 0 && d < bd) { bd = d; best = i; } }
      return best;
    };
    const hover = (i: number) => { if (i === st.hover) return; st.hover = i; st.hoverAt = performance.now(); canvas.style.cursor = i >= 0 ? 'pointer' : ''; setOver(i >= 0 ? st.sim!.g.nodes[i] : null); kick.current(); };
    const down = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const p = at(e);
      const i = under(p);
      const node = i >= 0 ? st.sim!.g.nodes[i] : null;
      const from = { x: e.clientX, y: e.clientY, vx: st.view.x, vy: st.view.y };
      st.refit = false;
      let moved = false;
      const move = (ev: MouseEvent) => {
        if (!moved && Math.hypot(ev.clientX - from.x, ev.clientY - from.y) < 4) return;
        moved = true;
        if (node) { const q = at(ev); node.fx = q.x; node.fy = q.y; st.sim!.alphaTarget = 0.3; }
        else { st.glide = null; st.view = { ...st.view, x: from.vx + ev.clientX - from.x, y: from.vy + ev.clientY - from.y }; st.moved = true; canvas.style.cursor = 'grabbing'; }
        kick.current();
      };
      const up = (ev: MouseEvent) => {
        window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
        canvas.style.cursor = st.hover >= 0 ? 'pointer' : '';
        if (node) { node.fx = null; node.fy = null; st.sim!.alphaTarget = 0; }
        if (st.moved && !st.glide) keep(st.view);
        // A click on a note brings the view in on it, and opens it in this editor; with ⌘, in a new editor beside it.
        if (node && !moved) {
          const { w, h } = size();
          const k = st.view.k < 1.7 ? 1.7 : Math.min(3.4, st.view.k * 1.15);
          glideTo({ k, x: w / 2 - node.x * k, y: h / 2 - node.y * k });
          useStore.getState().openFile(node.path, null, ev.metaKey ? { beside: 'right' } : undefined);
        }
        kick.current();
      };
      window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    };
    const move = (e: MouseEvent) => { if (!e.buttons) hover(under(at(e))); };
    const leave = () => hover(-1);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = at(e);
      const k = Math.min(6, Math.max(0.03, st.view.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0022))));
      // What is under the pointer stays under it.
      st.glide = null;
      st.view = { k, x: p.sx - p.x * k, y: p.sy - p.y * k };
      st.moved = true;
      keep(st.view);
      kick.current();
    };
    const dbl = (e: MouseEvent) => { const v = under(at(e)) < 0 ? fitView() : null; if (v) { glideTo(v, 380); st.moved = false; const had = kept.get(root); if (had) had.view = null; } };
    canvas.addEventListener('mousedown', down); canvas.addEventListener('mousemove', move); canvas.addEventListener('mouseleave', leave);
    canvas.addEventListener('wheel', wheel, { passive: false }); canvas.addEventListener('dblclick', dbl);
    const sizes = new ResizeObserver(() => kick.current());
    sizes.observe(wrap);
    // For test/drive.mjs: where things are, and three notes to point at (the most linked, a middling one, a lone one).
    (window as any).__graph = () => {
      const g = st.sim?.g;
      if (!g) return null;
      const on = (i: number) => ({ name: g.nodes[i].name, deg: g.nodes[i].deg, sx: g.nodes[i].x * st.view.k + st.view.x, sy: g.nodes[i].y * st.view.k + st.view.y });
      const by = g.nodes.map((_, i) => i).sort((a, b) => g.nodes[b].deg - g.nodes[a].deg);
      const linked = by.filter((i) => g.nodes[i].deg > 0);
      const lens = g.links.map(([a, b]) => Math.hypot(g.nodes[a].x - g.nodes[b].x, g.nodes[a].y - g.nodes[b].y)).sort((a, b) => a - b);
      const xs = g.nodes.map((n) => n.x), ys = g.nodes.map((n) => n.y);
      return {
        view: st.view, alpha: st.sim!.alpha, stretch: st.sim!.stretch, moved: st.moved, refit: st.refit, pane: [st.w, st.h], extent: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(Math.round),
        stats: { link50: Math.round(lens[lens.length >> 1] ?? 0), link90: Math.round(lens[Math.floor(lens.length * 0.9)] ?? 0), lone: by.length - linked.length },
        picks: { hub: on(by[0]), mid: on(linked[linked.length >> 1] ?? by[0]), leaf: on(by[by.length - 1]) },
      };
    };
    return () => {
      cancelAnimationFrame(st.frame); st.frame = 0; kick.current = () => {}; window.clearTimeout(st.reshape);
      canvas.removeEventListener('mousedown', down); canvas.removeEventListener('mousemove', move); canvas.removeEventListener('mouseleave', leave);
      canvas.removeEventListener('wheel', wheel); canvas.removeEventListener('dblclick', dbl);
      sizes.disconnect();
    };
  }, [root]);

  const dark = document.documentElement.dataset.theme !== 'light';
  const found = query.trim() && graph ? graph.nodes.filter((n) => n.rel.toLowerCase().includes(query.trim().toLowerCase())) : [];
  const tops = graph ? [...graph.tops].sort((a, b) => b.count - a.count).slice(0, 10).sort((a, b) => a.t - b.t) : [];
  return (
    <div className="graph" ref={wrapRef}>
      <canvas ref={canvasRef} />
      <div className="graph-top">
        <input ref={findRef} className="graph-find" value={query} placeholder="Find a note" spellCheck={false} onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); setQuery(''); }
            else if (e.key === 'Enter' && found.length) { e.preventDefault(); useStore.getState().openFile(found[0].path, null, e.metaKey ? { beside: 'right' } : undefined); }
          }} />
        <span className="graph-count">{graph ? `${query.trim() ? `${found.length} of ` : ''}${graph.nodes.length} notes, ${graph.links.length} links` : ''}</span>
        <button className="top-btn" {...tip('Read the notes again')} onClick={() => setScan((n) => n + 1)}><Icon name="refresh" size={14} /></button>
      </div>
      {tops.length > 1 && (
        <div className="graph-key">
          {tops.map((t) => <div key={t.name}><i style={{ background: noteColor(t.t, dark) }} /><span>{t.name || tildify(root).split('/').pop()}</span><b>{t.count}</b></div>)}
        </div>
      )}
      <div className="graph-over">{over ? `${over.rel}${over.deg ? `  ·  ${over.deg} link${over.deg === 1 ? '' : 's'}` : ''}` : ''}</div>
      {(progress || error || (graph && !graph.nodes.length)) && <div className="graph-note">{error ?? progress ?? `No notes in ${tildify(root)}.`}</div>}
    </div>
  );
}
