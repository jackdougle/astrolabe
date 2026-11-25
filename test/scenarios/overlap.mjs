// Two panes full of text are never drawn on top of each other: a terminal brought back from hiding, one carried
// to another place, one that is hidden or closed, and the first file opened beside the terminals. (Each used to
// fade or glide across its neighbour, which was still drawn at its old size: two screens of text at once.)
export const settings = { zoom: 1 };
export default async function ({ page, run, work }) {
  const ok = (name, pass, detail = '') => console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  const at = (ms) => page.waitForTimeout(ms);
  // Watches every frame for `ms`: the largest area (px²) shared by two panes that can both be seen.
  const watch = (ms) => page.evaluate((ms) => new Promise((done) => {
    let worst = 0; let frames = 0; const t0 = performance.now();
    const step = () => {
      frames += 1;
      const seen = [...document.querySelectorAll('.pane')].filter((p) => { const c = getComputedStyle(p); return c.visibility !== 'hidden' && +c.opacity > 0.04 && p.getClientRects().length; }).map((p) => p.getBoundingClientRect());
      for (let i = 0; i < seen.length; i++) for (let j = i + 1; j < seen.length; j++) {
        const w = Math.min(seen[i].right, seen[j].right) - Math.max(seen[i].left, seen[j].left);
        const h = Math.min(seen[i].bottom, seen[j].bottom) - Math.max(seen[i].top, seen[j].top);
        if (w > 2 && h > 2) worst = Math.max(worst, Math.round(w * h));
      }
      if (performance.now() - t0 < ms) requestAnimationFrame(step); else done({ worst, frames });
    };
    step();
  }), ms);
  const during = async (name, act) => { const w = watch(900); await act(); const r = await w; ok(name, r.worst === 0 && r.frames > 20, `${r.worst}px² shared over ${r.frames} frames`); await at(300); };
  const S = (fn, arg) => page.evaluate(fn, arg);

  await run(`cd ${work}`);
  await run('seq 1 60', 500);
  await page.keyboard.press('Meta+d'); await at(1500);
  await run('seq 100 160', 500);
  const [a, b] = await S(() => { const s = window.__store.getState(); return Object.keys(s.panes).filter((id) => s.panes[id].kind === 'terminal'); });

  await during('hiding the right terminal', () => page.keyboard.press('Meta+u'));
  await during('bringing it back', () => page.keyboard.press('Meta+Shift+u'));
  await during('hiding the left terminal', () => S((a) => window.__store.getState().hideTerm(a), a));
  await during('bringing it back', () => page.keyboard.press('Meta+Shift+u'));
  await during('carrying one to the other side', () => S(([a, b]) => window.__store.getState().movePane(b, a, 'left'), [a, b]));
  await during('carrying it below', () => S(([a, b]) => window.__store.getState().movePane(b, a, 'bottom'), [a, b]));
  await during('a third terminal opening', () => page.keyboard.press('Meta+d'));
  await at(900);
  await during('closing it', () => page.keyboard.press('Meta+w'));
  await during('the first file opening beside them', () => S((p) => window.__store.getState().openFile(p, null, { keep: true }), `${work}/notes/plan.md`));
  const sizes = await S(() => [...window.__sessions.values()].map((s) => { const r = s.host.getBoundingClientRect(); const f = s.term; const cell = r.width / f.cols; return { cols: f.cols, px: Math.round(r.width), cell: Math.round(cell * 10) / 10 }; }));
  ok('each terminal ends at the width of its pane', sizes.every((x) => x.cell > 7 && x.cell < 10), JSON.stringify(sizes));
}
