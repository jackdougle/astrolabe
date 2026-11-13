import { useEffect, useRef, useState } from 'react';
import { tildify } from '../lib/api';
import { Graph, GNode, noteColor, scanNotes, Sim } from '../lib/graph';
import { reducedMotion } from '../lib/motion';
import { bus } from '../lib/panes';
import { openFiles, useStore } from '../lib/store';
import { Icon } from './Icons';
import { tip } from './Tooltip';

// A project's graph is kept while the window is open, so coming back to its tab shows it as it was left.
const kept = new Map<string, { sim: Sim; view: { k: number; x: number; y: number } | null }>();
const radius = (n: GNode) => 3.2 + Math.sqrt(n.deg) * 1.5;

/** The notes of a project as a network (see lib/graph.ts). Scroll to zoom, drag to move about, drag a note to pull
 *  it, click a note to open it (⌘-click: to the side). Typing in the box picks out the notes whose names match. */
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
  const live = useRef({ sim: null as Sim | null, view: { k: 1, x: 0, y: 0 }, hover: -1, match: null as Set<number> | null, open: new Set<string>(), frame: 0, fitted: false, /** The view was moved or zoomed by hand, so it is no longer refitted. */ moved: false, w: 0, h: 0 });
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
      const sim = new Sim(g);
      sim.scatter();
      // Most of the settling happens before it is first shown, so it does not open as a ball flying apart.
      if (!before.size) for (let i = 0; i < (g.nodes.length > 4000 ? 40 : 140); i++) sim.tick();
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
    const fit = () => {
      const { w, h } = size();
      const ns = st.sim?.g.nodes ?? [];
      if (!ns.length || !w || !h) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const n of ns) { x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x); y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y); }
      const k = Math.min(2.2, Math.max(0.04, 0.9 * Math.min(w / (x1 - x0 + 60), h / (y1 - y0 + 60))));
      st.view = { k, x: w / 2 - (x0 + x1) / 2 * k, y: h / 2 - (y0 + y1) / 2 * k };
      st.fitted = true;
    };

    const draw = () => {
      const { w, h } = size();
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const sim = st.sim;
      if (!sim || !w || !h) return;
      // When the pane changes size, a view nobody has touched is fitted again; one that has been moved keeps its middle.
      if (st.w && (st.w !== w || st.h !== h)) { if (st.moved) st.view = { ...st.view, x: st.view.x + (w - st.w) / 2, y: st.view.y + (h - st.h) / 2 }; else st.fitted = false; }
      st.w = w; st.h = h;
      if (!st.fitted) fit();
      const { nodes, links, near } = sim.g;
      const css = getComputedStyle(document.documentElement);
      const dark = document.documentElement.dataset.theme !== 'light';
      const text = css.getPropertyValue('--text').trim() || '#ddd';
      const { k, x, y } = st.view;
      // Picked out: the note under the pointer with the notes it is linked to, or the notes the box has found.
      const hot = st.hover >= 0 ? new Set([st.hover, ...near[st.hover]]) : st.match;
      ctx.translate(x, y); ctx.scale(k, k);
      ctx.lineWidth = Math.min(1.4, 0.8 / k);
      ctx.strokeStyle = text;
      ctx.globalAlpha = hot ? 0.05 : dark ? 0.16 : 0.22;
      ctx.beginPath();
      for (const [a, b] of links) { ctx.moveTo(nodes[a].x, nodes[a].y); ctx.lineTo(nodes[b].x, nodes[b].y); }
      ctx.stroke();
      if (st.hover >= 0) {
        ctx.globalAlpha = 0.75; ctx.lineWidth = Math.min(2.2, 1.3 / k); ctx.strokeStyle = noteColor(nodes[st.hover].t, dark);
        ctx.beginPath();
        for (const j of near[st.hover]) { ctx.moveTo(nodes[st.hover].x, nodes[st.hover].y); ctx.lineTo(nodes[j].x, nodes[j].y); }
        ctx.stroke();
      }
      // Only what is in view is drawn.
      const vx0 = -x / k - 30, vy0 = -y / k - 30, vx1 = (w - x) / k + 30, vy1 = (h - y) / k + 30;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (n.x < vx0 || n.x > vx1 || n.y < vy0 || n.y > vy1) continue;
        ctx.globalAlpha = hot && !hot.has(i) ? 0.14 : 1;
        ctx.fillStyle = noteColor(n.t, dark);
        ctx.beginPath(); ctx.arc(n.x, n.y, radius(n), 0, 6.2832); ctx.fill();
        // A note that is open in an editor wears a ring.
        if (st.open.has(n.path)) { ctx.lineWidth = 1.4 / k; ctx.strokeStyle = text; ctx.beginPath(); ctx.arc(n.x, n.y, radius(n) + 2.4 / k, 0, 6.2832); ctx.stroke(); }
      }
      // Names: all of them once you are close enough to read them, and always for what is picked out.
      const all = Math.min(1, Math.max(0, (k - 1.1) / 0.7));
      const font = css.getPropertyValue('--mono').trim() || 'monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = text;
      const few = !!hot && hot.size <= 400;
      if (all > 0 || few) {
        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i];
          const picked = few && hot!.has(i);
          if (!picked && (all <= 0 || (hot && !hot.has(i)))) continue;
          if (n.x < vx0 || n.x > vx1 || n.y < vy0 || n.y > vy1) continue;
          const px = (i === st.hover ? 12.5 : 11) / k;
          ctx.font = `${i === st.hover ? 600 : 500} ${px}px ${font}`;
          ctx.globalAlpha = picked ? 1 : all * 0.85;
          ctx.fillText(n.name, n.x, n.y + radius(n) + 3 / k);
        }
      }
      ctx.globalAlpha = 1;
    };

    const loop = () => {
      st.frame = 0;
      const sim = st.sim;
      const moving = !!sim && (sim.alpha > 0.004 || sim.alphaTarget > 0);
      if (sim && moving) { sim.tick(); if (reducedMotion()) for (let i = 0; i < 200 && sim.alpha > 0.004; i++) sim.tick(); }
      draw();
      if (moving) st.frame = requestAnimationFrame(loop);
    };
    kick.current = () => { if (!st.frame) st.frame = requestAnimationFrame(loop); };
    kick.current();

    const at = (e: MouseEvent) => { const r = canvas.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top, x: (e.clientX - r.left - st.view.x) / st.view.k, y: (e.clientY - r.top - st.view.y) / st.view.k }; };
    const under = (p: { x: number; y: number }) => {
      const ns = st.sim?.g.nodes ?? [];
      let best = -1, bd = Infinity;
      for (let i = 0; i < ns.length; i++) { const d = Math.hypot(ns[i].x - p.x, ns[i].y - p.y) - Math.max(radius(ns[i]), 7 / st.view.k); if (d < 0 && d < bd) { bd = d; best = i; } }
      return best;
    };
    const hover = (i: number) => { if (i === st.hover) return; st.hover = i; canvas.style.cursor = i >= 0 ? 'pointer' : ''; setOver(i >= 0 ? st.sim!.g.nodes[i] : null); kick.current(); };
    const down = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const p = at(e);
      const i = under(p);
      const node = i >= 0 ? st.sim!.g.nodes[i] : null;
      const from = { x: e.clientX, y: e.clientY, vx: st.view.x, vy: st.view.y };
      let moved = false;
      const move = (ev: MouseEvent) => {
        if (!moved && Math.hypot(ev.clientX - from.x, ev.clientY - from.y) < 4) return;
        moved = true;
        if (node) { const q = at(ev); node.fx = q.x; node.fy = q.y; st.sim!.alphaTarget = 0.25; }
        else { st.view = { ...st.view, x: from.vx + ev.clientX - from.x, y: from.vy + ev.clientY - from.y }; st.moved = true; canvas.style.cursor = 'grabbing'; }
        kick.current();
      };
      const up = (ev: MouseEvent) => {
        window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
        canvas.style.cursor = st.hover >= 0 ? 'pointer' : '';
        if (node) { node.fx = null; node.fy = null; st.sim!.alphaTarget = 0; }
        // A click on a note opens it in this editor; with ⌘, in a new editor beside it.
        if (node && !moved) useStore.getState().openFile(node.path, null, ev.metaKey ? { beside: 'right' } : undefined);
        const had = kept.get(root); if (had && st.moved) had.view = st.view;
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
      st.view = { k, x: p.sx - p.x * k, y: p.sy - p.y * k };
      st.moved = true;
      const had = kept.get(root); if (had && st.moved) had.view = st.view;
      kick.current();
    };
    const dbl = (e: MouseEvent) => { if (under(at(e)) < 0) { fit(); st.moved = false; kick.current(); } };
    canvas.addEventListener('mousedown', down); canvas.addEventListener('mousemove', move); canvas.addEventListener('mouseleave', leave);
    canvas.addEventListener('wheel', wheel, { passive: false }); canvas.addEventListener('dblclick', dbl);
    const sizes = new ResizeObserver(() => kick.current());
    sizes.observe(wrap);
    return () => {
      cancelAnimationFrame(st.frame); st.frame = 0; kick.current = () => {};
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
