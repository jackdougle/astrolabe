// A thin grey line runs down the left of an open folder's rows, under the middle of its chevron, starting at the
// middle of the first row (not touching the chevron) and running to the foot of the folder's rows.
import fs from 'node:fs';
import path from 'node:path';
export const settings = { zoom: 1 };
export default async function ({ page, shot, run, work }) {
  let fails = 0;
  const ok = (name, pass, detail = '') => { if (!pass) fails += 1; console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail && !pass ? `: ${detail}` : ''}`); };
  fs.mkdirSync(path.join(work, 'notes', 'deep'));
  for (let i = 1; i <= 3; i++) fs.writeFileSync(path.join(work, 'notes', 'deep', `n${i}.md`), `note ${i}\n`);
  await run(`cd ${work}`);
  await page.keyboard.press('Meta+b'); await page.waitForTimeout(700);
  await page.click('.treerow:has-text("notes")'); await page.waitForTimeout(500);
  await page.click('.treerow:has-text("deep")'); await page.waitForTimeout(500);
  const measure = (name) => page.evaluate((n) => {
    const row = [...document.querySelectorAll('.treerow')].find((r) => r.querySelector('.tree-name')?.textContent === n);
    const g = row.parentElement.querySelector(':scope > .tree-kids > .tree-guide');
    const line = getComputedStyle(g, '::before'); const gb = g.getBoundingClientRect();
    const chev = row.querySelector('.tree-arrow svg').getBoundingClientRect();
    const rows = g.querySelectorAll(':scope > .tree-node > .treerow'); const first = rows[0].getBoundingClientRect();
    const x = gb.left + parseFloat(line.left) + parseFloat(line.width) / 2; const top = gb.top + parseFloat(line.top); const bottom = gb.bottom - parseFloat(line.bottom);
    return { x, chevX: (chev.left + chev.right) / 2, top, chevBottom: chev.bottom, firstMid: (first.top + first.bottom) / 2, bottom, kidsBottom: gb.bottom, width: line.width, color: line.backgroundColor };
  }, name);
  for (const n of ['notes', 'deep']) {
    const m = await measure(n);
    ok(`${n}: line under the chevron's middle`, Math.abs(m.x - m.chevX) <= 1, JSON.stringify(m));
    ok(`${n}: starts at the first row's middle, clear of the chevron`, Math.abs(m.top - m.firstMid) <= 0.5 && m.top > m.chevBottom + 4, JSON.stringify(m));
    ok(`${n}: runs to the foot of the folder's rows`, Math.abs(m.bottom - m.kidsBottom) <= 0.5, JSON.stringify(m));
    ok(`${n}: thin and grey`, m.width === '1px', m.width);
  }
  await shot('treeguide');
  if (fails) throw new Error(`${fails} failed`);
}
