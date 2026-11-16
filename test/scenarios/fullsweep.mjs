// The terminals filling the window (⌃⌘F from a terminal, or ⌘E) puts every note out of sight, so an empty untitled
// one that an editor was showing is deleted and its tab closed. A note with words, or a file with its own name, stays.
import fs from 'node:fs';
export default async function ({ page, run, type, work }) {
  const notes = () => fs.readdirSync(work).filter((f) => f.endsWith('.md')).sort();
  const st = () => page.evaluate(() => { const s = window.__store.getState(); return { tabs: Object.values(s.panes).flatMap((p) => p.kind === 'editor' ? p.files.map((f) => f.path.split('/').pop() + (p.active === f.path ? '*' : '')) : []), focus: s.focus, full: s.areas.full, editors: Object.values(s.panes).filter((p) => p.kind === 'editor').length }; });
  const say = async (label) => console.log(label, '→ notes:', notes(), JSON.stringify(await st()));
  const key = async (k, wait = 1500) => { await page.keyboard.press(k); await page.waitForTimeout(wait); };
  await run(`cd ${work} && git init -q`, 1200);

  // 1. ⌘N makes an empty note; back in the terminal, ⌃⌘F fills the window with it
  await key('Meta+n', 2500);
  await say('1 ⌘N');
  await key('Control+`', 800);
  await say('1 keyboard in the terminal, note still showing');
  await key('Control+Meta+f');
  await say('1 terminal fills the window');

  // 2. the same with other files open: only the empty note goes, the editor shows what is left when it comes back
  await page.evaluate((f) => window.__store.getState().openFile(f, null, { keep: true }), `${work}/main.py`); await page.waitForTimeout(1000);
  await key('Meta+n', 2500);
  await key('Control+`', 800);
  await key('Control+Meta+f');
  await say('2 beside main.py, terminal fills');
  await key('Control+Meta+f', 800);
  await say('2 side by side again');

  // 3. words in the note: it stays
  await page.click('.editor-pane'); await page.waitForTimeout(300);
  await key('Meta+n', 2500); await type('kept words'); await page.waitForTimeout(400);
  await key('Meta+s', 600);
  await key('Control+`', 800); await key('Control+Meta+f');
  await say('3 saved words, terminal fills');
  await key('Control+Meta+f', 800);

  // 4. unsaved typing: it stays
  await page.click('.editor-pane'); await page.waitForTimeout(300);
  await key('Meta+n', 2500); await type('not saved'); await page.waitForTimeout(400);
  await key('Control+`', 800); await key('Control+Meta+f');
  await say('4 unsaved typing, terminal fills');
  await key('Control+Meta+f', 800);
  await page.click('.editor-pane'); await page.waitForTimeout(300);
  await key('Meta+s', 600);

  // 5. ⌘E hides the editors behind the terminals: same thing
  await key('Meta+n', 2500);
  await say('5 ⌘N');
  await key('Meta+e');
  await say('5 ⌘E hid the editors');

  // 6. the editor filling the window keeps its empty note
  await key('Meta+e', 800);
  await page.click('.editor-pane'); await page.waitForTimeout(300);
  await key('Meta+n', 2500);
  await key('Control+Meta+f');
  await say('6 editor fills the window');
}
