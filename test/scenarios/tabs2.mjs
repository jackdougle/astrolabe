export default async function ({ app, page, shot, run, type, work }) {
  const tabs = () => page.evaluate(() => [...document.querySelectorAll('.toptab')].map((t) => `${t.querySelector('.toptab-text').textContent} [${t.className.replace('toptab', '').trim()}]`));
  const snap = (label) => page.evaluate((l) => { const s = [...window.__sessions.values()][0]; const b = s.term.buffer.normal; let n = 0; for (let y = 0; y < b.length; y++) if (b.getLine(y).translateToString(true)) n = y + 1; return `${l}: cols=${s.term.cols} cursorRow=${b.baseY + b.cursorY} usedRows=${n}`; }, label);
  await run(`cd ${work}`);
  await run('echo one; echo two');
  console.log(await snap('before drag'));
  // a drag: many small width changes in quick succession, narrower then wider
  for (let w = 1360; w >= 800; w -= 40) { await app.evaluate(({ BrowserWindow }, width) => { const win = BrowserWindow.getAllWindows()[0]; const b = win.getBounds(); win.setBounds({ ...b, width }); }, w); await page.waitForTimeout(16); }
  await page.waitForTimeout(700);
  console.log(await snap('after dragging narrower'));
  for (let w = 800; w <= 1360; w += 40) { await app.evaluate(({ BrowserWindow }, width) => { const win = BrowserWindow.getAllWindows()[0]; const b = win.getBounds(); win.setBounds({ ...b, width }); }, w); await page.waitForTimeout(16); }
  await page.waitForTimeout(700);
  console.log(await snap('after dragging wider'));
  await shot('85-after-drag');
  // running + finished indicators on tabs
  await run('sleep 2', 300);
  console.log('while running:', JSON.stringify(await tabs()));
  await page.keyboard.press('Meta+t');
  await page.waitForTimeout(2600);
  console.log('finished in background:', JSON.stringify(await tabs()));
  await shot('86-finished-flash');
  await page.keyboard.press('Meta+1');
  await page.waitForTimeout(400);
  console.log('after visiting:', JSON.stringify(await tabs()));
  await run('sleep 1; false', 200);
  await page.keyboard.press('Meta+2');
  await page.waitForTimeout(1700);
  console.log('failed in background:', JSON.stringify(await tabs()));
}
