// A pane is moved by the grip at the middle of its top edge: dragged over another pane, it lands against that pane's
// nearest edge; at the rim of the tab it takes that whole side. Terminals move among the terminals of their tab and
// editors among the editors, and shells keep running.
export default async function ({ page, shot, run, work }) {
  const at = (ms) => page.waitForTimeout(ms);
  // Each pane as kind:name@x,y+w×h in percent of the tab.
  const panes = () => page.evaluate(() => {
    const all = document.querySelector('.tab-area.is-active').getBoundingClientRect();
    const names = window.__names ?? {};
    return [...document.querySelectorAll('.tab-area.is-active .pane')].filter((p) => getComputedStyle(p).visibility !== 'hidden').map((p) => {
      const r = p.getBoundingClientRect(); const pc = (v, of) => Math.round(v / of * 100);
      return `${p.querySelector('.editor-pane') ? 'editor' : names[p.dataset.pane] ?? p.dataset.pane}@${pc(r.x - all.x, all.width)},${pc(r.y - all.y, all.height)}+${pc(r.width, all.width)}x${pc(r.height, all.height)}`;
    }).sort().join('  ');
  });
  const name = (n) => page.evaluate((n) => { const s = window.__store.getState(); const t = s.tabs.find((x) => x.id === s.activeTab); (window.__names ??= {})[t.activePane] = n; }, n);
  const sel = async (n) => page.evaluate((n) => { const id = Object.entries(window.__names).find(([, v]) => v === n)?.[0] ?? document.querySelector('.editor-pane').closest('.pane').dataset.pane; return `.pane[data-pane="${id}"]`; }, n);
  // Drags pane `a` by its grip to a point in pane `b`, given as fractions of b's box.
  const drag = async (a, b, fx, fy, { cancel = false } = {}) => {
    const g = await page.locator(`${await sel(a)} > .pane-grip`).boundingBox();
    const t = await page.locator(await sel(b)).boundingBox();
    const x = g.x + g.width / 2; const y = g.y + g.height / 2;
    await page.mouse.move(x, y); await at(150); await page.mouse.down();
    await page.mouse.move(x + 10, y + 10, { steps: 3 });
    await page.mouse.move(t.x + t.width * fx, t.y + t.height * fy, { steps: 8 }); await at(250);
    const outline = await page.evaluate(() => { const d = document.querySelector('.pane-drop'); return d ? `${d.style.left} ${d.style.top} ${d.style.width} ${d.style.height}` : 'none'; });
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up(); await at(700);
    return outline;
  };
  const look = async (label, extra = '') => console.log(`${label}\n    ${await panes()}${extra ? `\n    ${extra}` : ''}`);

  await run(`cd ${work}`); await name('A');
  console.log('grip with one pane:', await page.locator('.pane-grip').count());
  await run('sleep 300 && echo A-still-here', 300);
  await page.keyboard.press('Meta+d'); await at(1600); await name('B');
  await page.keyboard.press('Meta+Shift+d'); await at(1600); await name('C');
  await look('A | B over C');
  await shot('panedrag-1-start');

  let o = await drag('C', 'A', 0.5, 0.9); await look('C dragged to the bottom of A', `outline was ${o}`);
  await shot('panedrag-2-c-under-a');
  o = await drag('B', 'A', 0.1, 0.5); await look('B dragged to the left of A', `outline was ${o}`);
  o = await drag('B', 'A', 0.1, 0.5); await look('B dragged to the left of A again (already there)', `outline was ${o}`);
  o = await drag('B', 'C', 0.5, 0.5, { cancel: true }); await look('B dragged over C, Esc', `outline was ${o}`);
  o = await drag('C', 'A', 0.5, 0.005); await look('C dragged to the top rim of the tab', `outline was ${o}`);
  await shot('panedrag-3-c-across-top');

  // The editors are an area of their own beside the terminals: a terminal dragged over it stays where it was, and
  // an editor moves among the editors only.
  await page.evaluate((p) => window.__store.getState().openFile(p), `${work}/notes/plan.md`); await at(1200);
  await look('opened plan.md');
  o = await drag('B', 'editor', 0.5, 0.85); await look('B dragged over the editor (nothing moves)', `outline was ${o}`);
  await page.evaluate(() => window.__store.getState().splitEditor('right')); await at(1000);
  {
    const ids = await page.evaluate(() => [...document.querySelectorAll('.tab-area[data-tab="editors"] .pane')].map((p) => p.dataset.pane));
    const g = await page.locator(`.pane[data-pane="${ids[1]}"] > .pane-grip`).boundingBox(); const t = await page.locator(`.pane[data-pane="${ids[0]}"]`).boundingBox();
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await at(150); await page.mouse.down();
    await page.mouse.move(g.x + 20, g.y + 20, { steps: 3 }); await page.mouse.move(t.x + t.width / 2, t.y + t.height * 0.85, { steps: 8 }); await at(250);
    await shot('panedrag-4-editor-outline');
    await page.mouse.up(); await at(700);
    console.log('second editor dragged below the first:', await page.evaluate(() => { const all = document.querySelector('.tab-area[data-tab="editors"]').getBoundingClientRect(); return [...document.querySelectorAll('.tab-area[data-tab="editors"] .pane')].map((p) => { const r = p.getBoundingClientRect(); return `${Math.round((r.x - all.x) / all.width * 100)},${Math.round((r.y - all.y) / all.height * 100)}+${Math.round(r.width / all.width * 100)}x${Math.round(r.height / all.height * 100)}`; }).sort().join('  '); }));
  }

  // The shell that was running in A through all of this is still the same one.
  const a = await sel('A');
  await page.click(`${a} .term-host`, { position: { x: 60, y: 40 } }); await at(300);
  await page.keyboard.press('Control+c'); await at(600);
  await run('echo A-alive-$((6*7))', 800);
  console.log('A after the moves:', await page.evaluate((a) => { const s = window.__sessions.get(document.querySelector(a).dataset.pane); const b = s.term.buffer.active; let out = []; for (let i = 0; i < b.length; i++) out.push(b.getLine(i).translateToString(true)); return out.filter((l) => /sleep 300|A-alive-42/.test(l)).map((l) => l.trim()); }, a));
  console.log('saved layout has', await page.evaluate(() => { const s = window.__store.getState(); return `${Object.keys(s.panes).length} panes, focus on ${window.__names[s.tabs[0].activePane] ?? 'editor'}`; }));
}
