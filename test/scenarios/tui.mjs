export default async function ({ page, shot, run, type, state, work }) {
  await run(`cd ${work}`);
  await run('less main.py', 900);
  const st1 = await state();
  const alt = await page.evaluate(() => [...window.__sessions.values()][0].term.buffer.active.type);
  console.log('in less:', alt, JSON.stringify(st1));
  await shot('40-less');
  await page.keyboard.press('q');
  await page.waitForTimeout(700);
  console.log('after q:', JSON.stringify(await state()));
  await run('seq 1 120', 900);
  await run('python3 -c "name = input(\'name? \'); print(\'hi\', name)"', 900);
  await type('Ada');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
  await shot('41-interactive');
  // scroll up into the long block: its header should pin with the command
  await page.mouse.move(700, 400);
  await page.mouse.wheel(0, -1500);
  await page.waitForTimeout(500);
  await shot('42-pinned');
  console.log('pinned:', await page.evaluate(() => [...document.querySelectorAll('.blk.is-pinned .blk-cmd')].map((e) => e.textContent)));
  await page.keyboard.press('Meta+ArrowUp');
  await page.waitForTimeout(300);
  await page.keyboard.press('Meta+Shift+c');
  await page.waitForTimeout(300);
  const clip = await page.evaluate(() => window.astrolabe.clipboard.read());
  console.log('copied output starts:', JSON.stringify(clip.slice(0, 40)));
  await shot('43-selected');
  console.log('end', JSON.stringify(await state()));
}
