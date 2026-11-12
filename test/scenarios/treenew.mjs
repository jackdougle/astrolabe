import fs from 'node:fs';
import path from 'node:path';
// "New File" from the navigator's right-click menu: on a folder, on a file, and on the empty space.
export default async function ({ page, shot, run, work }) {
  const tree = () => page.evaluate(() => [...document.querySelectorAll('.treerow')].map((r) => r.querySelector('.tree-rename') ? '<field>' : r.textContent));
  const fileTabs = () => page.evaluate(() => [...document.querySelectorAll('.filetab')].map((f) => f.textContent));
  const newFile = async (target, opts = {}) => {
    await page.evaluate(() => window.astrolabe.fs.testMenuChoice('newFile'));
    await page.click(target, { button: 'right', ...opts }); await page.waitForTimeout(400);
  };
  await run(`cd ${work}`);
  await page.keyboard.press('Meta+b'); await page.waitForTimeout(500);
  // on a closed folder: it opens and the field appears inside it
  await newFile('.treerow:has-text("notes")');
  console.log('folder, field placed:', JSON.stringify(await tree()), '| focused:', await page.evaluate(() => document.activeElement?.className));
  await shot('97-newfile-field');
  await page.keyboard.type('ideas.md'); await page.keyboard.press('Enter'); await page.waitForTimeout(900);
  console.log('folder, created:', JSON.stringify(await tree()), JSON.stringify(await fileTabs()), '| on disk:', JSON.stringify(fs.readdirSync(path.join(work, 'notes'))));
  // on a file: beside it
  await newFile('.treerow:has-text("plan.md")');
  await page.keyboard.type('beside.txt'); await page.keyboard.press('Enter'); await page.waitForTimeout(900);
  console.log('file, created beside:', fs.existsSync(path.join(work, 'notes', 'beside.txt')), JSON.stringify(await fileTabs()));
  // on the empty space below the rows: top of the project
  const box = await page.locator('.tree-scroll').boundingBox();
  await newFile('.tree-scroll', { position: { x: box.width / 2, y: box.height - 20 } });
  console.log('blank, field placed:', JSON.stringify(await tree()));
  await page.keyboard.type('top.py'); await page.keyboard.press('Enter'); await page.waitForTimeout(900);
  console.log('blank, created at top:', fs.existsSync(path.join(work, 'top.py')), JSON.stringify(await tree()), JSON.stringify(await fileTabs()));
  // on the title strip, then Escape: nothing is made
  await newFile('.side-title span');
  await page.keyboard.type('never'); await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  console.log('escape cancels:', !fs.existsSync(path.join(work, 'never')), JSON.stringify(await tree()));
  // a name already taken is refused
  await newFile('.tree-scroll', { position: { x: box.width / 2, y: box.height - 20 } });
  await page.keyboard.type('main.py'); await page.keyboard.press('Enter'); await page.waitForTimeout(700);
  console.log('clash:', JSON.stringify(await page.evaluate(() => document.querySelector('.toast')?.textContent)), '| main.py untouched:', fs.readFileSync(path.join(work, 'main.py'), 'utf8').length > 0);
  await shot('98-newfile-after');
}
