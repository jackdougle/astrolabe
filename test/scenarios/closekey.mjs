// ⌘W closes what the keyboard is in: the terminal (the last one too, which leaves the editor the window), or the file
// in the editor. ⌃⌘F then brings a terminal back on half the window.
import fs from 'node:fs';
export default async function ({ page, run, type, work }) {
  const at = (ms) => page.waitForTimeout(ms);
  for (const n of ['one', 'two']) fs.writeFileSync(`${work}/${n}.md`, `${n}\n`);
  await run(`cd ${work}`);
  const st = () => page.evaluate(() => { const s = window.__store.getState(); return `focus ${s.focus} | terminals ${s.tabs.map((t) => Object.values(s.panes).filter((p) => p.kind === 'terminal').length).join(',')} in ${s.tabs.length} tab(s) | editors ${Object.values(s.panes).filter((p) => p.kind === 'editor').map((p) => `[${p.files.map((f) => f.path.split('/').pop()).join(' ')}]`).join('') || 'none'} | on screen ${[...document.querySelectorAll('.tab-area.is-active .pane')].filter((p) => getComputedStyle(p).visibility !== 'hidden' && !p.classList.contains('is-leaving')).map((p) => (p.querySelector('.editor-pane') ? 'editor' : 'term')).join('+')}`; });
  const say = async (label) => { await at(700); console.log(`${label}: ${await st()}`); };
  const open = async (name) => { await page.keyboard.press('Meta+o'); await at(350); await type(name); await page.keyboard.press('Enter'); await at(900); };
  await open('one'); await open('two'); await say('two files open, keyboard in the editor');
  await page.keyboard.press('Meta+w'); await say('⌘W in the editor');
  await page.keyboard.press('Meta+w'); await say('⌘W in the editor again');
  await open('one'); await page.keyboard.press('Meta+d'); await say('one file, two terminals, keyboard in a terminal');
  await page.keyboard.press('Meta+w'); await say('⌘W in the terminal');
  await page.keyboard.press('Meta+w'); await say('⌘W in the last terminal');
  const widths = () => page.evaluate(() => [...document.querySelectorAll('.tab-area.is-active .pane')].filter((p) => getComputedStyle(p).visibility !== 'hidden' && !p.classList.contains('is-leaving')).map((p) => `${p.querySelector('.editor-pane') ? 'editor' : 'term'} ${Math.round(p.getBoundingClientRect().width)}px`).join(', '));
  console.log('   on screen:', await widths());
  await page.evaluate(() => window.__store.getState().setAreaRatio(0.8));
  await page.keyboard.press('Control+Meta+f'); await say('⌃⌘F');
  console.log('   on screen:', await widths());
  await page.keyboard.press('Control+Backquote'); await at(400); await run('echo alive-$((6*7))', 700);
  console.log('   the new terminal ran a command (blocks):', await page.evaluate(() => document.querySelectorAll('.tab-area.is-active .blk').length));
  await page.keyboard.press('Meta+w'); await say('⌘W in it');
  await page.keyboard.press('Meta+w'); await say('⌘W on the last file, no terminal');
}
