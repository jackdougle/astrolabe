import { useEffect, useRef } from 'react';

// A sky you barely notice: a great many faint, irregular specks rather than a few bright dots.
// Each star is a tiny ragged cluster of single device pixels, most of them close to invisible,
// and they gather and thin out across the window the way real star fields do.

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Smooth low-frequency noise in 0..1, used to make the density patchy. */
function makeNoise(rand: () => number, gx: number, gy: number) {
  const grid = Array.from({ length: (gx + 1) * (gy + 1) }, () => rand());
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (u: number, v: number) => {
    const x = u * gx; const y = v * gy;
    const x0 = Math.min(gx - 1, Math.floor(x)); const y0 = Math.min(gy - 1, Math.floor(y));
    const fx = smooth(x - x0); const fy = smooth(y - y0);
    const at = (i: number, j: number) => grid[j * (gx + 1) + i];
    const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
    const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
    return top + (bottom - top) * fy;
  };
}

const TINTS: [number, number, number][] = [[205, 222, 255], [255, 255, 255], [232, 240, 255], [255, 238, 214]];

function paint(canvas: HTMLCanvasElement) {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const cssW = canvas.clientWidth; const cssH = canvas.clientHeight;
  if (cssW < 10 || cssH < 10) return;
  const W = Math.round(cssW * dpr); const H = Math.round(cssH * dpr);
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  const rand = rng(1610); // the year Galileo published what he saw through his telescope
  const coarse = makeNoise(rand, 5, 3);
  const fine = makeNoise(rand, 17, 11);
  const wanted = Math.round((cssW * cssH) / 400);
  let placed = 0; let tries = 0;
  while (placed < wanted && tries < wanted * 8) {
    tries++;
    const u = rand(); const v = rand();
    const density = 0.18 + 0.82 * Math.pow(coarse(u, v) * 0.7 + fine(u, v) * 0.3, 1.8);
    if (rand() > density) continue;
    placed++;
    const b = Math.pow(rand(), 5.5);                  // brightness: nearly all of them dim
    const alpha = 0.03 + b * 0.4;
    const [r, g, bl] = TINTS[Math.floor(rand() * TINTS.length)];
    let x = Math.floor(u * W); let y = Math.floor(v * H);
    // A ragged cluster: a short random walk of single pixels with uneven strength.
    const specks = 1 + Math.floor(rand() * 2.2 + b * 5);
    for (let k = 0; k < specks; k++) {
      ctx.fillStyle = `rgba(${r},${g},${bl},${(alpha * (0.45 + rand() * 0.55)).toFixed(3)})`;
      ctx.fillRect(x, y, 1, 1);
      x += Math.floor(rand() * 3) - 1; y += Math.floor(rand() * 3) - 1;
    }
    // The few brighter ones get a faint haze made of several small offset smudges, so it is never a clean disc.
    if (b > 0.55) {
      for (let k = 0; k < 4; k++) {
        const hx = x + (rand() - 0.5) * 5 * dpr; const hy = y + (rand() - 0.5) * 5 * dpr;
        const rad = (0.8 + rand() * 1.8) * dpr;
        const grad = ctx.createRadialGradient(hx, hy, 0, hx, hy, rad);
        grad.addColorStop(0, `rgba(${r},${g},${bl},${(alpha * 0.1).toFixed(3)})`);
        grad.addColorStop(1, `rgba(${r},${g},${bl},0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(hx - rad, hy - rad, rad * 2, rad * 2);
      }
    }
  }
}

export function Starfield() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    let timer: number | undefined;
    const redraw = () => { window.clearTimeout(timer); timer = window.setTimeout(() => paint(canvas), 120); };
    paint(canvas);
    const ro = new ResizeObserver(redraw);
    ro.observe(canvas);
    return () => { ro.disconnect(); window.clearTimeout(timer); };
  }, []);
  return <canvas className="starfield" ref={ref} aria-hidden="true" />;
}
