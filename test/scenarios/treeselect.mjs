// The navigator selects several rows: a click takes one, ⌘-click adds or drops one, ⇧-click takes a run; the right-click menu then removes them together.
import fs from 'node:fs';
import path from 'node:path';
export default async function ({ page, shot, run, work }) {
  for (const n of ['a.txt', 'b.txt', 'c.txt', 'd.txt']) fs.writeFileSync(path.join(work, n), n);
  const row = (name) => `.treerow:has-text("${name}")`;
  const rows = () => page.evaluate(() => [...document.querySelectorAll('.treerow')].map((r) => r.textContent));
  const picked = () => page.evaluate(() => [...document.querySelectorAll('.treerow.is-selected')].map((r) => r.textContent));
  const fileTabs = () => page.evaluate(() => [...document.querySelectorAll('.filetab')].map((f) => f.textContent));
  await run(`cd ${work}`);
  await page.keyboard.press('Meta+b'); await page.waitForTimeout(600);
  console.log('rows:', JSON.stringify(await rows()));

  await page.click(row('main.py')); await page.waitForTimeout(900);
  console.log('click:', JSON.stringify(await picked()), '| opened:', JSON.stringify(await fileTabs()));
  await page.click(row('data.json'), { modifiers: ['Meta'] }); await page.waitForTimeout(300);
  console.log('⌘-click adds:', JSON.stringify(await picked()), '| opened:', JSON.stringify(await fileTabs()));
  await page.click(row('main.py'), { modifiers: ['Meta'] }); await page.waitForTimeout(300);
  console.log('⌘-click drops:', JSON.stringify(await picked()));

  await page.click(row('a.txt')); await page.waitForTimeout(600);
  await page.click(row('d.txt'), { modifiers: ['Shift'] }); await page.waitForTimeout(300);
  console.log('⇧-click run:', JSON.stringify(await picked()), '| text selected:', JSON.stringify(await page.evaluate(() => String(getSelection()))));
  await page.click(row('b.txt'), { modifiers: ['Shift'] }); await page.waitForTimeout(300);
  console.log('⇧-click shorter run, same start:', JSON.stringify(await picked()));
  await page.click(row('d.txt'), { modifiers: ['Meta'] }); await page.waitForTimeout(300);
  console.log('⌘-click adds to the run:', JSON.stringify(await picked()));
  await shot('treeselect');

  // a run across an opened folder takes the rows inside it
  await page.click(row('notes')); await page.waitForTimeout(500);
  await page.click(row('a.txt'), { modifiers: ['Shift'] }); await page.waitForTimeout(300);
  console.log('run through an open folder:', JSON.stringify(await picked()));

  // right-click on a row outside the selection: that row alone
  await page.evaluate(() => window.astrolabe.fs.testMenuChoice(null));
  await page.click(row('main.py'), { button: 'right' }); await page.waitForTimeout(400);
  console.log('right-click elsewhere:', JSON.stringify(await picked()));

  // remove three at once from the menu
  await page.click(row('a.txt')); await page.waitForTimeout(500);
  await page.click(row('c.txt'), { modifiers: ['Shift'] });
  await page.click(row('data.json'), { modifiers: ['Meta'] }); await page.waitForTimeout(300);
  await page.click(row('b.txt'), { modifiers: ['Meta'] }); await page.waitForTimeout(300);
  console.log('before removing:', JSON.stringify(await picked()), '| opened:', JSON.stringify(await fileTabs()));
  await page.evaluate(() => window.astrolabe.fs.testMenuChoice('trash'));
  await page.click(row('c.txt'), { button: 'right' }); await page.waitForTimeout(1200);
  console.log('after removing:', JSON.stringify(await rows()), '| toast:', JSON.stringify(await page.evaluate(() => document.querySelector('.toast')?.textContent)), '| on disk:', JSON.stringify(fs.readdirSync(work).filter((f) => !f.startsWith('.')).sort()), '| opened:', JSON.stringify(await fileTabs()), '| still selected:', JSON.stringify(await picked()));

  // a folder and a file inside it, removed together
  await page.click(row('plan.md'), { modifiers: ['Meta'] });
  await page.click(row('notes'), { modifiers: ['Meta'] }); await page.waitForTimeout(300);
  console.log('folder + file inside:', JSON.stringify(await picked()));
  await page.evaluate(() => window.astrolabe.fs.testMenuChoice('trash'));
  await page.click(row('plan.md'), { button: 'right' }); await page.waitForTimeout(1200);
  console.log('after:', JSON.stringify(await rows()), '| toast:', JSON.stringify(await page.evaluate(() => document.querySelector('.toast')?.textContent)));

  // clicking the empty space lets go of the selection
  await page.click(row('b.txt')); await page.waitForTimeout(500);
  const box = await page.locator('.tree-scroll').boundingBox();
  await page.click('.tree-scroll', { position: { x: box.width / 2, y: box.height - 20 } }); await page.waitForTimeout(300);
  console.log('after clicking empty space:', JSON.stringify(await picked()));
}
