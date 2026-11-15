// A look at the graph of a real folder (REAL=/some/folder, or the scenario's own small one): fitted, with the pointer
// on its busiest note, a middling one and a lone one, zoomed in, and after a ⌘-click. Nothing is checked; it is for
// the eye, and prints where the view and the notes ended up (`window.__graph()` in GraphView.tsx).
export default async function ({ page, run, work, shot }) {
  const at = (ms) => page.waitForTimeout(ms);
  await run(`cd ${work}`);
  await page.evaluate((p) => window.__store.getState().openFile(`graph:${p}`), process.env.REAL ?? work);
  await page.waitForFunction(() => /notes,/.test(document.querySelector('.graph-count')?.textContent ?? ''), null, { timeout: 60000 });
  await page.keyboard.press('Control+Meta+f'); await at(Number(process.env.SETTLE ?? 6000));
  console.log(await page.evaluate(() => document.querySelector('.graph-count')?.textContent));
  await shot('look-1-fit');
  const g = () => page.evaluate(() => window.__graph?.());
  const info = await g();
  if (!info) { console.log('no window.__graph'); return; }
  console.log('view', JSON.stringify(info.view), 'extent', JSON.stringify(info.extent), 'stats', JSON.stringify(info.stats), 'pane', JSON.stringify(info.pane), 'stretch', info.stretch.toFixed(2), 'alpha', info.alpha.toFixed(3), 'moved', info.moved, 'refit', info.refit);
  const box = await page.locator('.graph canvas').boundingBox();
  const to = async (n) => { const i = await g(); const p = i.picks[n]; await page.mouse.move(box.x + p.sx, box.y + p.sy, { steps: 4 }); return p; };
  for (const name of ['hub', 'mid', 'leaf']) {
    const p = await to(name); await at(900);
    console.log(name, p.name, 'deg', p.deg, '| over:', await page.evaluate(() => document.querySelector('.graph-over')?.textContent));
    await shot(`look-2-hover-${name}`);
  }
  await page.mouse.move(box.x + 5, box.y + box.height - 60); await at(600);
  // Zoom in on the hub by the wheel.
  let p = await to('hub');
  await page.mouse.move(box.x + 5, box.y + box.height - 60);
  await page.mouse.move(box.x + p.sx + 30, box.y + p.sy + 30);
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -120); await at(60); }
  await at(700);
  await shot('look-3-zoomed');
  p = await to('hub'); await at(900);
  await shot('look-4-zoomed-hover');
  // Back out, then a ⌘-click on the middling note: it opens beside the graph and the view comes in on it.
  // A double click on the background fits everything again; a spot with no note under it is found first.
  for (let i = 0; i < 40; i++) {
    const x = box.x + 30 + (i * 97) % (box.width - 60), y = box.y + 60 + (i * 53) % (box.height - 120);
    await page.mouse.move(x, y); await at(60);
    if (!(await page.evaluate(() => document.querySelector('.graph-over')?.textContent))) { await page.mouse.dblclick(x, y); break; }
  }
  await at(900);
  await shot('look-5-fit-again');
  p = await to('mid');
  await page.keyboard.down('Meta'); await page.mouse.click(box.x + p.sx, box.y + p.sy); await page.keyboard.up('Meta'); await at(1600);
  console.log('⌘-clicked', p.name, '| view', JSON.stringify((await g()).view));
  await shot('look-6-clicked');
}
