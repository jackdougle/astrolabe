// Temporary tabs: a file opened to look at takes the place of the last one, until it is saved or double-clicked.
import fs from 'node:fs';
export const settings = { previewTabs: true };
export default async function ({ page, run, type, work, shot }) {
  const at = (ms) => page.waitForTimeout(ms);
  for (const n of ['one', 'two', 'three', 'four', 'five']) fs.writeFileSync(`${work}/${n}.md`, `${n}\n`);
  await run(`cd ${work}`);
  // Each editor's tabs in order: ~name~ is a temporary tab, * the one in front, ! unsaved.
  const tabs = () => page.evaluate(() => { const s = window.__store.getState(); return Object.values(s.panes).filter((p) => p.kind === 'editor').map((p) => `[${p.files.map((f) => { const n = f.path.split('/').pop(); return `${f.temp ? `~${n}~` : n}${p.active === f.path ? '*' : ''}${s.dirty[f.path] ? '!' : ''}`; }).join(' ')}]`).join(' ') || 'none'; });
  const slanted = () => page.evaluate(() => [...document.querySelectorAll('.filetab')].filter((t) => !t.classList.contains('is-leaving')).map((t) => `${t.querySelector('.filetab-name').textContent}:${getComputedStyle(t.querySelector('.filetab-name')).fontStyle}`).join(' '));
  const open = async (name, key = 'Enter') => { await page.keyboard.press('Meta+o'); await at(350); await type(name); await page.keyboard.press(key); await at(900); };
  const say = async (label) => console.log(`${label}: ${await tabs()}`);

  await open('one'); await say('open one');
  await open('two'); await say('open two (takes its place)');
  console.log('   on the row:', await slanted());
  // Saving keeps it.
  await page.click('.rich p'); await at(300); await type('x'); await at(300); await say('typed in two');
  await open('three'); await say('open three while two is unsaved (two is not dropped)');
  await page.evaluate(() => { const s = window.__store.getState(); const p = Object.values(s.panes).find((p) => p.kind === 'editor'); s.activateFile(p.id, p.files.find((f) => f.path.endsWith('two.md')).path); }); await at(500);
  await page.keyboard.press('Meta+s'); await at(600); await say('saved two');
  await open('four'); await say('open four (takes the place of three, two stays)');
  // A double click on the tab keeps it.
  await page.dblclick('.filetab:has-text("four.md")'); await at(500); await say('double click on the tab of four');
  await open('five'); await say('open five (a new temporary tab)');
  await shot('temptabs');
  // The navigator: one click opens a temporary tab, a double click keeps it.
  await page.keyboard.press('Meta+l'); await at(700);
  await page.click('.treerow:has-text("one.md")'); await at(800); await say('click one in the navigator');
  await page.dblclick('.treerow:has-text("three.md")'); await at(900); await say('double click three in the navigator');
  await page.click('.treerow:has-text("main.py")'); await at(800); await say('click main.py');
  // A file that is already open is only brought to the front.
  await open('two'); await say('open two again');
  // A new note stays, and does not take the temporary tab's place.
  await page.keyboard.press('Meta+n'); await at(1500); await say('⌘N');
  // To the side: a temporary tab in the new editor.
  await open('one', 'Meta+Enter'); await say('one, to the side');
  console.log('buffers held:', await page.evaluate(() => window.__monaco.editor.getModels().map((m) => m.uri.path.split('/').pop()).sort().join(' ')));
}
