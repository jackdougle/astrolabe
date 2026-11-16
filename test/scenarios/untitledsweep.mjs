// An untitled note with nothing in it is deleted, and its tab closed, as soon as you are off it: Untitled, Untitled 2,
// Untitled 3 alike. One with words in it, unsaved typing, or a name of its own, stays.
import fs from 'node:fs';
import path from 'node:path';
export default async function ({ page, run, type, work }) {
  const notes = (dir = work) => fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
  const fileTabs = () => page.evaluate(() => Object.values(window.__store.getState().panes).flatMap((p) => p.kind === 'editor' ? p.files.map((f) => f.path.split('/').pop() + (p.active === f.path ? '*' : '')) : []));
  const fresh = async () => { await page.keyboard.press('Meta+n'); await page.waitForTimeout(2500); };
  const open = async (name) => { await page.click(`.treerow:has-text("${name}")`); await page.waitForTimeout(1200); };
  // a file made behind the app's back is opened through the store, as a link or the navigator would
  const openPath = async (file) => { await page.evaluate((f) => window.__store.getState().openFile(f, null, { keep: true }), file); await page.waitForTimeout(1200); };
  await run(`cd ${work} && git init -q`, 1200);
  await page.keyboard.press('Meta+b'); await page.waitForTimeout(500);
  await open('main.py');

  // 1. three ⌘N in a row: each empty one goes as the next takes its place
  await fresh(); await fresh(); await fresh();
  console.log('1 three ⌘N → notes:', notes(), '| tabs:', JSON.stringify(await fileTabs()));
  await open('main.py');
  console.log('1 moved to main.py → notes:', notes(), '| tabs:', JSON.stringify(await fileTabs()));

  // 2. a note with saved words stays when you leave it
  await fresh(); await type('kept words'); await page.waitForTimeout(400);
  await page.keyboard.press('Meta+s'); await page.waitForTimeout(600);
  await open('main.py');
  console.log('2 written and saved, left → notes:', notes(), '| tabs:', JSON.stringify(await fileTabs()));

  // 3. unsaved typing is never dropped
  await fresh(); await type('not saved yet'); await page.waitForTimeout(400);
  await open('main.py');
  console.log('3 typed, unsaved, left → notes:', notes(), '| tabs:', JSON.stringify(await fileTabs()));

  // 4. an empty Untitled file that was already on disk, opened from the navigator and left
  fs.writeFileSync(path.join(work, 'Untitled 7.md'), '\n'); await page.waitForTimeout(1200);
  await openPath(path.join(work, 'Untitled 7.md'));
  console.log('4 on the empty one:', JSON.stringify(await fileTabs()));
  await open('main.py');
  console.log('4 left it → notes:', notes(), '| tabs:', JSON.stringify(await fileTabs()));

  // 5. an empty file with a name of its own is left alone
  fs.writeFileSync(path.join(work, 'ideas.md'), ''); await page.waitForTimeout(1200);
  await openPath(path.join(work, 'ideas.md')); await open('main.py');
  console.log('5 empty but named → notes:', notes(), '| tabs:', JSON.stringify(await fileTabs()));

  // 6. ⌘T's note beside a file, left empty
  await openPath(path.join(work, 'notes', 'plan.md'));
  await page.click('.editor-pane'); await page.waitForTimeout(300);
  await page.keyboard.press('Meta+t'); await page.waitForTimeout(1500);
  console.log('6 ⌘T made:', notes(path.join(work, 'notes')));
  await open('main.py');
  console.log('6 left it → notes/:', notes(path.join(work, 'notes')), '| tabs:', JSON.stringify(await fileTabs()));

  // 7. the one you are on is kept, even with the keyboard in the terminal
  await fresh();
  await page.keyboard.press('Control+`'); await page.waitForTimeout(800);
  console.log('7 on it, keyboard in the terminal → notes:', notes(), '| tabs:', JSON.stringify(await fileTabs()));
}
