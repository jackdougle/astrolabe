// Any pane can be dragged down to a single terminal row, or a couple of columns wide; scroll speed reaches xterm and Monaco.
export default async function ({ page, shot, run }) {
  const info = () => page.evaluate(() => [...document.querySelectorAll('.pane')].map((p) => {
    const s = window.__sessions.get(p.dataset.pane); const r = p.getBoundingClientRect();
    return `${Math.round(r.width)}x${Math.round(r.height)} term ${s?.term.cols}x${s?.term.rows}`;
  }));
  const drag = async (sel, dx, dy) => {
    const b = await page.locator(sel).first().boundingBox();
    const x = b.x + b.width / 2; const y = b.y + b.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 5 }); await page.mouse.move(x + dx, y + dy, { steps: 5 });
    await page.mouse.up(); await page.waitForTimeout(600);
  };
  await run('seq 1 40', 700);
  await page.keyboard.press('Meta+Shift+d'); await page.waitForTimeout(1500);
  await drag('.divider.is-col', 0, 2000);
  console.log('bottom squashed:', JSON.stringify(await info()));
  await shot('squash-1-bottom');
  await page.keyboard.type('echo still-works'); await page.keyboard.press('Enter'); await page.waitForTimeout(700);
  await shot('squash-2-bottom-typed');
  await drag('.divider.is-col', 0, -3000);
  console.log('top squashed:', JSON.stringify(await info()));
  await shot('squash-3-top');
  await page.keyboard.press('Meta+d'); await page.waitForTimeout(1500);
  await drag('.divider.is-row', 3000, 0);
  console.log('right squashed:', JSON.stringify(await info()));
  await shot('squash-4-right');
  await drag('.divider.is-row', -3000, 0);
  console.log('left squashed:', JSON.stringify(await info()));
  await shot('squash-5-left');
  console.log('scroll:', JSON.stringify(await page.evaluate(() => { const s = [...window.__sessions.values()][0]; return [s.term.options.scrollSensitivity, s.term.options.fastScrollSensitivity]; })));
}
