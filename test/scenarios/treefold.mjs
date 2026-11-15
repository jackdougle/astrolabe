// A folder in the navigator drops open and draws shut: its chevron turns, its rows grow from no height and are
// taken out of the page once they are out of sight. A folder open when the window loads is simply there.
import fs from 'node:fs';
import path from 'node:path';
export default async function ({ page, shot, run, work }) {
  fs.mkdirSync(path.join(work, 'notes', 'deep'));
  for (let i = 1; i <= 6; i++) fs.writeFileSync(path.join(work, 'notes', 'deep', `n${i}.md`), `note ${i}\n`);
  const kids = (name) => page.evaluate((n) => {
    const row = [...document.querySelectorAll('.treerow')].find((r) => r.querySelector('.tree-name')?.textContent === n);
    const k = row?.parentElement.querySelector(':scope > .tree-kids');
    const arrow = row?.querySelector('.tree-arrow');
    const turn = arrow ? Math.round(Math.atan2(new DOMMatrix(getComputedStyle(arrow).transform).b, new DOMMatrix(getComputedStyle(arrow).transform).a) * 180 / Math.PI) : null;
    return { there: !!k, height: k ? Math.round(k.getBoundingClientRect().height) : 0, rows: k ? k.querySelectorAll('.treerow').length : 0, chevron: turn };
  }, name);
  const samples = async (name, n = 5, gap = 45) => { const out = []; for (let i = 0; i < n; i++) { await page.waitForTimeout(gap); const k = await kids(name); out.push(`${k.height}px/${k.chevron}°`); } return out.join(' '); };
  await run(`cd ${work}`);
  await page.keyboard.press('Meta+b'); await page.waitForTimeout(700);
  console.log('shut:', JSON.stringify(await kids('notes')));
  await page.click('.treerow:has-text("notes")');
  console.log('opening (first time, rows loading):', await samples('notes'));
  await page.waitForTimeout(300);
  console.log('open:', JSON.stringify(await kids('notes')), '(want 2 rows, 46px, 90°)');
  await page.click('.treerow:has-text("deep")');
  console.log('a folder inside, opening:', await samples('deep'));
  await page.waitForTimeout(300);
  console.log('both open:', JSON.stringify(await kids('notes')), JSON.stringify(await kids('deep')));
  await shot('fold-1-open');
  await page.click('.treerow:has-text("notes")');
  console.log('closing:', await samples('notes'));
  await page.waitForTimeout(300);
  console.log('shut again:', JSON.stringify(await kids('notes')), '(want gone, 0°)');
  await page.click('.treerow:has-text("notes")');
  console.log('opening again, with the folder inside still open:', await samples('notes'));
  await page.waitForTimeout(300);
  console.log('open:', JSON.stringify(await kids('notes')), '(want 8 rows, 184px)');
  // Quick clicks: shut and open again before it has finished.
  await page.click('.treerow:has-text("notes")'); await page.waitForTimeout(60); await page.click('.treerow:has-text("notes")');
  await page.waitForTimeout(500);
  console.log('after a double toggle:', JSON.stringify(await kids('notes')));
  await page.click('.side-foot [data-tip="Reload"]'); await page.waitForTimeout(500);
  console.log('after the list reloads:', JSON.stringify(await kids('notes')));
}
