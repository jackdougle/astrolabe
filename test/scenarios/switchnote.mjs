// ⌃` jumps between the editor and the terminal; rendered notes show the file name as a title (see notetitle.mjs); ⌘N makes a stamped note in the project.
import fs from 'node:fs';
export default async function ({ page, run, type, work, shot }) {
  await run(`cd ${work} && git init -q`, 1200);
  await page.keyboard.press('Meta+p'); await page.waitForTimeout(350); await type('plan'); await page.keyboard.press('Enter'); await page.waitForTimeout(1300);
  const where = () => page.evaluate(() => { const p = document.activeElement?.closest('.pane'); return p?.querySelector('.editor-pane') ? 'editor' : p?.querySelector('.term-host') ? 'terminal' : 'elsewhere'; });
  console.log('title elements:', await page.evaluate(() => document.querySelectorAll('.rich-title').length), '| first rendered block:', await page.evaluate(() => document.querySelector('.rich')?.firstElementChild?.outerHTML.slice(0, 60)));
  console.log('after open:', await where());
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Control+Backquote'); await page.waitForTimeout(400); console.log('⌃` →', await where()); }
  await page.keyboard.press('Meta+n'); await page.waitForTimeout(2500);
  const notes = fs.readdirSync(work).filter((f) => f.startsWith('Untitled'));
  console.log('new notes in project root:', notes, JSON.stringify(notes[0] && fs.readFileSync(`${work}/${notes[0]}`, 'utf8')));
  console.log('focus:', await where(), '| active file tab:', await page.evaluate(() => document.querySelector('.filetab.is-active .filetab-name, .filetab.active .filetab-name')?.textContent));
  await type('first line typed');
  await page.waitForTimeout(500);
  await page.keyboard.press('Meta+s'); await page.waitForTimeout(600);
  console.log('after typing + save:', JSON.stringify(fs.readFileSync(`${work}/${notes[0]}`, 'utf8')));
  await shot('switchnote');
}
