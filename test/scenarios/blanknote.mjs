// A ⌘N note closed with nothing added is deleted; one that was typed in and saved, or given a name, is kept.
import fs from 'node:fs';
export default async function ({ page, run, type, work }) {
  const notes = () => fs.readdirSync(work).filter((f) => f.endsWith('.md')).sort();
  const fileTabs = () => page.evaluate(() => [...document.querySelectorAll('.filetab')].map((f) => f.textContent));
  const treeHas = (name) => page.evaluate((n) => [...document.querySelectorAll('.treerow')].some((r) => r.textContent === n), name);
  const fresh = async () => { await page.keyboard.press('Meta+n'); await page.waitForTimeout(2500); };
  const close = async () => { await page.keyboard.press('Meta+w'); await page.waitForTimeout(900); };
  await run(`cd ${work} && git init -q`, 1200);
  await page.keyboard.press('Meta+b'); await page.waitForTimeout(500);
  // keep a second file open so closing a note never closes the editor
  await page.click('.treerow:has-text("main.py")'); await page.waitForTimeout(900);

  await fresh();
  console.log('1 made:', notes(), JSON.stringify(fs.readFileSync(`${work}/Untitled.md`, 'utf8')), '| in tree:', await treeHas('Untitled.md'));
  await close();
  console.log('1 closed untouched → notes:', notes(), '| in tree:', await treeHas('Untitled.md'), '| tabs:', JSON.stringify(await fileTabs()));

  await fresh(); await type('typed then thrown away'); await page.waitForTimeout(400);
  console.log('2 unsaved marks:', await page.evaluate(() => document.querySelectorAll('.filetab-close.is-dirty').length));
  await close(); // a scripted run answers "Don't Save"
  console.log('2 typed, not saved, closed → notes:', notes());

  await fresh(); await type('kept words'); await page.waitForTimeout(400);
  await page.keyboard.press('Meta+s'); await page.waitForTimeout(600);
  await close();
  console.log('3 typed and saved → notes:', notes(), JSON.stringify(notes()[0] && fs.readFileSync(`${work}/${notes()[0]}`, 'utf8')));
  fs.rmSync(`${work}/Untitled.md`); await page.waitForTimeout(300);

  await fresh();
  await page.click('.rich-title'); await page.keyboard.press('Meta+a'); await type('Named'); await page.keyboard.press('Enter'); await page.waitForTimeout(1200);
  await close();
  console.log('4 given a name only → notes:', notes());
  fs.rmSync(`${work}/Named.md`); await page.waitForTimeout(300);

  await fresh();
  const marked = await page.evaluate(() => Object.values(window.__store.getState().panes).flatMap((p) => p.kind === 'editor' ? p.files.filter((f) => f.blank !== undefined).map((f) => f.path.split('/').pop()) : []));
  await page.waitForTimeout(700); // the layout is saved half a second after it changes
  console.log('5 marked in the store:', marked, '| saved with the session:', /"blank"/.test(fs.readFileSync(`${work}/../state.json`, 'utf8')));
  await page.evaluate(() => { const s = window.__store.getState(); s.closePane(Object.values(s.panes).find((p) => p.kind === 'editor').id); });
  await page.waitForTimeout(900);
  console.log('5 whole editor closed → notes:', notes(), '| panes:', await page.evaluate(() => document.querySelectorAll('.pane').length));

  // ⌘T's empty note beside a file goes the same way (it was left alone until 2026-11-15)
  await page.click('.treerow:has-text("main.py")'); await page.waitForTimeout(900);
  await page.keyboard.press('Meta+t'); await page.waitForTimeout(1200);
  await close();
  console.log('6 ⌘T note closed empty → notes:', notes());

  // a note edited by something else while open is kept
  fs.rmSync(`${work}/Untitled.md`, { force: true }); await page.waitForTimeout(300);
  await fresh();
  fs.appendFileSync(`${work}/Untitled.md`, 'written by an agent\n'); await page.waitForTimeout(1500);
  await close();
  console.log('7 changed on disk by something else → notes:', notes());
}
