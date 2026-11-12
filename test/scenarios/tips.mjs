// Hover tips name each button and its shortcut; a path broken across rows opens from any piece.
import fs from 'node:fs';
import path from 'node:path';
export default async function ({ page, shot, run, work }) {
  const tipText = () => page.evaluate(() => document.querySelector('.tooltip')?.textContent ?? null);
  const hover = async (sel) => { const b = await page.$(sel); const r = await b.boundingBox(); await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2, { steps: 3 }); };
  for (const sel of ['.top-btn:nth-of-type(1)', '[data-tip="Split right"]', '[data-tip="Command palette"]']) {
    await hover(sel);
    await page.waitForTimeout(500);
    console.log(`hover ${sel}:`, JSON.stringify(await tipText()));
  }
  await shot('tips-1');
  await page.mouse.move(600, 500);
  await page.waitForTimeout(200);
  console.log('after leaving:', JSON.stringify(await tipText()));
  await page.evaluate((f) => window.__store.getState().openFile(f), path.join(work, 'notes', 'plan.md'));
  await page.waitForTimeout(1200);
  await hover('[data-tip="Raw"]');
  await page.waitForTimeout(500);
  console.log('hover Raw:', JSON.stringify(await tipText()));
  await shot('tips-2');
  await page.keyboard.press('Meta+w');
  await page.waitForTimeout(600);

  // a path broken at the right edge, the rest indented on the next row, as Claude Code prints it
  const deep = path.join(work, 'a-rather-long-folder-name', 'with-another-long-folder-inside', 'and-one-more-level');
  fs.mkdirSync(deep, { recursive: true });
  const file = path.join(deep, 'target-file-with-a-long-name.txt');
  fs.writeFileSync(file, 'hello\n');
  await run(`cd ${work}`);
  const cols = await page.evaluate(() => [...window.__sessions.values()][0].term.cols);
  const full = '  ' + file;
  const first = full.slice(0, cols); const rest = full.slice(cols);
  fs.writeFileSync(path.join(work, 'broken.txt'), `${first}\n  ${rest}\n`);
  await run('cat broken.txt', 900);
  const where = await page.evaluate((rest) => {
    const s = [...window.__sessions.values()][0]; const b = s.term.buffer.active;
    for (let y = b.length - 1; y >= 0; y--) { const t = b.getLine(y).translateToString(true); if (t.trim() === rest.trim()) { const r = s.host.querySelector('.xterm-screen').getBoundingClientRect(); return { x: r.left + 6.5 * r.width / s.term.cols, y: r.top + (y - b.viewportY + 0.5) * r.height / s.term.rows, row: y }; } }
    return null;
  }, rest);
  console.log('cols', cols, 'second row found:', !!where);
  for (const [label, dy] of [['second row', 0], ['first row', -1]]) {
    if (!where) break;
    const ch = await page.evaluate(() => { const s = [...window.__sessions.values()][0]; return s.host.querySelector('.xterm-screen').getBoundingClientRect().height / s.term.rows; });
    const y = where.y + dy * ch; const x = dy ? where.x + 300 : where.x;
    await page.mouse.move(x - 30, y - 20); await page.waitForTimeout(80); await page.mouse.move(x, y, { steps: 4 });
    await page.waitForTimeout(500);
    await page.keyboard.down('Meta'); await page.mouse.click(x, y); await page.keyboard.up('Meta');
    await page.waitForTimeout(900);
    console.log(`⌘-click on ${label}:`, JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.filetab-name')].map((e) => e.textContent))));
    await shot(`tips-wrap-${dy ? 'first' : 'second'}`);
    await page.keyboard.press('Meta+w');
    await page.waitForTimeout(500);
  }
}
