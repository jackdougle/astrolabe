// The file picker (⌘O): notes only unless the search has a dot in it, and last edited first, both with nothing typed
// and among the files whose name holds what was typed.
import fs from 'node:fs';
export default async function ({ page, run, type, work }) {
  const at = (ms) => page.waitForTimeout(ms);
  // Edited in this order, oldest first. The driver's own notes/plan.md, main.py and data.json are older than all of them.
  const made = ['old plan.md', 'plans/planet.md', 'planner.ts', 'sub/explain.md', 'new plan.md', 'photo.png', 'late.py'];
  fs.mkdirSync(`${work}/plans`); fs.mkdirSync(`${work}/sub`);
  const start = Date.now() / 1000 - 100;
  for (const [i, f] of made.entries()) { fs.writeFileSync(`${work}/${f}`, 'x\n'); fs.utimesSync(`${work}/${f}`, start + i * 10, start + i * 10); }
  for (const [i, f] of ['notes/plan.md', 'main.py', 'data.json'].entries()) fs.utimesSync(`${work}/${f}`, start - 50 + i, start - 50 + i);
  await run(`cd ${work}`);

  const rows = () => page.evaluate(() => [...document.querySelectorAll('.palette-row')].map((r) => `${r.querySelector('.palette-label').textContent}${r.querySelector('.palette-detail') ? ` (${r.querySelector('.palette-detail').textContent})` : ''}`).join(' | ') || `nothing: ${document.querySelector('.palette-empty')?.textContent}`);
  const bold = () => page.evaluate(() => [...document.querySelectorAll('.palette-row')].map((r) => [...r.querySelectorAll('.palette-label b')].map((b) => b.textContent).join('+')).join(' | '));
  const ask = async (q) => {
    await page.keyboard.press('Meta+o'); await at(600);
    if (q) { await type(q); await at(300); }
    console.log(`⌘O "${q}":`, await rows());
    if (q) console.log('   bold:', await bold());
    await page.keyboard.press('Escape'); await at(300);
  };
  await ask('');          // notes only, last edited first
  await ask('plan');      // names holding "plan", last edited first; then looser matches
  await ask('new pl');    // every word must be in the name
  await ask('late');      // no note is called that
  await ask('zzz');       // nothing at all
  await ask('.py');       // a dot brings in the other files
  await ask('plan.');     // notes and code together, still last edited first
  console.log('placeholder:', await (async () => { await page.keyboard.press('Meta+o'); await at(400); const p = await page.evaluate(() => document.querySelector('.palette input').placeholder); await page.keyboard.press('Escape'); return p; })());
}
