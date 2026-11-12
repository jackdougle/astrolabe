// An edit made outside the editor (an agent, another program) shows up in the open file by itself,
// in raw and rendered views, without marking the file unsaved. Unsaved typing is never replaced.
// Also: right-clicking the file tab strip makes a new file, and the word wrap button is gone.
import fs from 'node:fs';
import path from 'node:path';

export default async function ({ page, shot, run, type, work }) {
  const wait = (ms) => page.waitForTimeout(ms);
  const raw = () => page.evaluate(() => [...document.querySelectorAll('.editor-host .view-line')].map((l) => l.textContent.replace(/ /g, ' ')).join('\n'));
  const rich = () => page.evaluate(() => document.querySelector('.rich')?.innerText ?? '');
  const dirty = () => page.evaluate(() => !!document.querySelector('.filetab.is-active .filetab-close.is-dirty'));
  const tabs = () => page.evaluate(() => [...document.querySelectorAll('.filetab-name')].map((e) => e.textContent));
  const open = async (q) => { await page.keyboard.press('Meta+p'); await wait(400); await type(q); await page.keyboard.press('Enter'); await wait(1300); };
  const check = (label, ok, detail = '') => console.log(ok ? 'PASS' : 'FAIL', label, detail);

  await run(`cd ${work}`);
  const py = path.join(work, 'main.py');
  await open('main');

  fs.writeFileSync(py, fs.readFileSync(py, 'utf8').replace('import sys', 'import sys  # AGENT-ONE'));
  await wait(700);
  check('overwrite in place shows up', (await raw()).includes('AGENT-ONE') && !(await dirty()));

  fs.writeFileSync(`${py}.tmp`, 'import os\n\nprint("AGENT-TWO")\n');
  fs.renameSync(`${py}.tmp`, py);
  await wait(700);
  check('write-then-rename shows up', (await raw()).includes('AGENT-TWO') && !(await raw()).includes('AGENT-ONE') && !(await dirty()));

  await page.click('.editor-host .view-lines');
  await page.keyboard.press('Meta+ArrowDown');
  await type('typed_by_me');
  await wait(200);
  fs.writeFileSync(py, 'print("AGENT-THREE")\n');
  await wait(700);
  const kept = await raw();
  const toast = await page.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
  check('unsaved typing is kept', kept.includes('typed_by_me') && !kept.includes('AGENT-THREE') && (await dirty()), `toast: ${JSON.stringify(toast)}`);
  await shot('reload-conflict');
  for (let i = 0; i < 'typed_by_me'.length; i++) await page.keyboard.press('Backspace');
  await page.keyboard.press('Meta+s');
  await wait(500);
  fs.writeFileSync(py, 'print("AGENT-FOUR")\n');
  await wait(700);
  check('reloads again after a save', (await raw()).includes('AGENT-FOUR') && !(await dirty()));

  // A rendered note: text the rendered view would write differently (star bullets, raw HTML) must not come back as an edit.
  const md = path.join(work, 'notes', 'plan.md');
  await open('plan');
  const five = '# Plan\n\n* star bullet AGENT-FIVE\n* another\n\nA *new* paragraph.\n';
  fs.writeFileSync(md, five);
  await wait(1200);
  check('rendered note shows the edit', (await rich()).includes('AGENT-FIVE'));
  check('rendered note stays saved', !(await dirty()) && fs.readFileSync(md, 'utf8') === five);
  fs.writeFileSync(md, five.replace('AGENT-FIVE', 'AGENT-SIX'));
  await wait(1200);
  check('rendered note shows a second edit', (await rich()).includes('AGENT-SIX') && !(await dirty()));
  await shot('reload-rendered');
  await page.click('.rich p');
  await type(' typed here');
  await wait(700);
  check('typing in the rendered view still counts as an edit', await dirty());

  // The view controls: no word wrap button. Right-clicking a file's tab makes a new file beside it.
  console.log('header tools:', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.view-tools button')].map((b) => b.textContent || b.querySelector('svg')?.getAttribute('data-icon') || 'icon'))));
  await page.evaluate(() => window.astrolabe.fs.testMenuChoice('newFile'));
  await page.click('.toptab.filetab:has-text("plan.md")', { button: 'right' });
  await wait(1200);
  const made = fs.readdirSync(path.join(work, 'notes')).filter((f) => f.startsWith('Untitled'));
  check('right-click makes a new file', made.length === 1 && (await tabs()).includes(made[0]), JSON.stringify({ made, tabs: await tabs() }));
  await shot('reload-header');
}
