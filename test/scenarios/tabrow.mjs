// Terminals and open files are tabs in the same row, joined in one block when they belong together (shown here in { }).
// A file opened from a terminal shows beside it; ⌃⌘F lets the side
// you are in fill the tab, and brings the other side back (an empty page for a terminal with no files yet, a new
// terminal for an editor with none).
import fs from 'node:fs';
export default async function ({ page, run, type, work, shot }) {
  const at = (ms) => page.waitForTimeout(ms);
  const row = () => page.evaluate(() => [...document.querySelectorAll('.tab-group')].map((g) => `{ ${[...g.querySelectorAll('.toptab')].map((t) => {
    const name = t.querySelector('.toptab-text').textContent.trim().replace(/^.*\/(work)/, '$1');
    const cls = [...t.classList].filter((c) => /^is-(active|shown|finished|leaving)$/.test(c)).map((c) => c.slice(3)).join(',');
    return `${t.classList.contains('filetab') ? 'file' : 'term'}:${name}${cls ? `[${cls}]` : ''}${t.querySelector('.toptab-key') ? `(${t.querySelector('.toptab-key').dataset.key})` : ''}`;
  }).join(' + ')} }${g.classList.contains('is-joined') ? '' : ' (single)'}`).join('   '));
  const panes = () => page.evaluate(() => [...document.querySelectorAll('.tab-area.is-active .pane')].map((p) => {
    const r = p.getBoundingClientRect(); const all = document.querySelector('.tab-area.is-active').getBoundingClientRect();
    return `${p.querySelector('.editor-pane') ? 'editor' : 'term'}@${Math.round((r.x - all.x) / all.width * 100)}+${Math.round(r.width / all.width * 100)}%${getComputedStyle(p).visibility === 'hidden' ? '(hidden)' : ''}`;
  }).join(' '));
  const where = () => page.evaluate(() => { const p = document.activeElement?.closest('.pane'); return p?.querySelector('.editor-pane') ? 'editor' : p?.querySelector('.term-host') ? 'terminal' : 'elsewhere'; });
  const tools = () => page.evaluate(() => [...document.querySelectorAll('.view-tools button')].map((b) => b.textContent || b.dataset.tip).join(' | '));
  const look = async (label) => { await at(600); console.log(`${label}\n    row:   ${await row()}\n    panes: ${await panes()}   focus: ${await where()}   tools: ${await tools()}`); };
  const open = async (name) => { await page.keyboard.press('Meta+p'); await at(350); await type(name); await page.keyboard.press('Enter'); await at(900); };
  const full = () => page.keyboard.press('Control+Meta+f');

  await run(`cd ${work}`);
  await look('start');
  await open('plan'); await look('opened plan.md from the terminal');
  await shot('tabrow-1-split');
  console.log('    editor has its own tab strip:', await page.evaluate(() => !!document.querySelector('.filetabs')));
  await full(); await look('⌃⌘F in the editor');
  await shot('tabrow-2-editor-full');
  await full(); await look('⌃⌘F again');
  await page.keyboard.press('Control+Backquote'); await at(300);
  await full(); await look('⌃` to the terminal, ⌃⌘F');
  await shot('tabrow-3-terminal-full');
  await full(); await look('⌃⌘F again');
  await open('main'); await look('opened main.py from the terminal');
  await page.click('.toptab.filetab >> text=plan.md'); await look('clicked the plan.md tab');
  await page.keyboard.press('Meta+1'); await look('⌘1');
  await page.keyboard.press('Meta+3'); await look('⌘3');
  await page.keyboard.press('Control+Tab'); await look('⌃Tab (wraps to the first)');
  await full(); await look('terminal full');
  await page.click('.toptab.filetab >> text=main.py'); await look('clicked main.py while the terminal was full');
  await page.click('.toptab:not(.filetab)'); await look('clicked the terminal tab while the editor was full');
  await full(); await look('⌃⌘F');

  // A command that ends while the editor fills the tab marks the terminal's tab.
  await run('sleep 1', 100);
  await page.keyboard.press('Control+Backquote'); await at(200); await full(); await at(1800);
  await look('sleep 1 ended behind a full editor');
  await full(); await look('⌃⌘F brings the terminal back');

  // A terminal with no file yet gets an empty page.
  await page.keyboard.press('Meta+Shift+t'); await at(1500);
  await run(`cd ${work}/notes`);
  await look('new terminal tab');
  await full(); await at(600); await look('⌃⌘F in a terminal with no files');
  console.log('    notes folder:', fs.readdirSync(`${work}/notes`).join(', '));
  await shot('tabrow-4-empty-page');
  await full(); await look('⌃⌘F again');
  await page.hover('.toptab.filetab >> text=Untitled.md'); await page.click('.toptab.filetab:has-text("Untitled.md") .toptab-close'); await at(900);
  await look('closed the empty page from its tab');
  console.log('    notes folder:', fs.readdirSync(`${work}/notes`).join(', '));
  await page.keyboard.press('Meta+Shift+w'); await look('⇧⌘W in that terminal');

  // Closing the terminals leaves their files; ⌃⌘F there opens a terminal beside them, where the old one was.
  await page.keyboard.press('Meta+1'); await at(300);
  await page.hover('.toptab:not(.filetab)'); await page.click('.toptab:not(.filetab) .toptab-close');
  await look('closed the terminal from its tab');
  await full(); await at(1500); await look('⌃⌘F in an editor with no terminal');
  console.log('    new terminal starts in:', await page.evaluate(() => { const s = window.__store.getState(); return Object.values(s.panes).filter((p) => p.kind === 'terminal').map((p) => p.cwd.replace(/^.*\/work/, 'work')).join(', '); }));
  await shot('tabrow-5-terminal-back');
  await page.keyboard.press('Meta+w'); await look('⌘W on main.py');
  await page.keyboard.press('Meta+w'); await look('⌘W on plan.md, the last file');
}
