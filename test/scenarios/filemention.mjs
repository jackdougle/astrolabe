// Four things from 2026-11-15:
// 1. ⌘-click on a file a program names in the terminal opens it in the editor, even when it is named from another
//    folder of the project, by its bare name, with spaces in it, or with a full stop after it.
// 2. The box under a clicked link in a rendered note has no arrow.
// 3. The note title and its wire artwork can each be turned off in settings.
// 4. The hidden-terminals chip clears while you type near it and comes back when the pointer moves.
import fs from 'node:fs';
import path from 'node:path';
export const settings = { zoom: 1 };
export default async function ({ page, shot, type, run, work }) {
  const ok = (name, pass, detail = '') => console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  const at = (ms) => page.waitForTimeout(ms);
  const term = () => page.evaluate(() => {
    const t = [...window.__sessions.values()][0].term;
    const cell = t._core._renderService.dimensions.css.cell;
    const box = t.element.querySelector('.xterm-screen').getBoundingClientRect();
    const rows = [];
    for (let y = 0; y < t.rows; y++) rows.push(t.buffer.active.getLine(t.buffer.active.viewportY + y)?.translateToString(true) ?? '');
    return { cell, box: { x: box.x, y: box.y }, rows };
  });
  const active = () => page.evaluate(() => { const s = window.__store.getState(); const e = Object.values(s.panes).find((p) => p.kind === 'editor'); return e?.active ? e.active.split('/work/')[1] : null; });
  const caretLine = () => page.evaluate(() => window.__monaco?.editor.getEditors().map((e) => e.getPosition()?.lineNumber).filter(Boolean).pop() ?? null);
  // ⌘-click on the first place `word` shows in output (not on the line that typed it).
  const cmdClick = async (word) => {
    const t = await term();
    let row = -1;
    for (let i = t.rows.length - 1; i >= 0; i--) if (t.rows[i].includes(word) && !t.rows[i].includes('printf')) { row = i; break; }
    if (row < 0) return false;
    const col = t.rows[row].indexOf(word) + Math.floor(word.length / 2);
    const x = t.box.x + (col + 0.5) * t.cell.width; const y = t.box.y + (row + 0.5) * t.cell.height;
    await page.mouse.move(x - 30, y, { steps: 2 }); await page.mouse.move(x, y, { steps: 4 }); await at(1300);
    await page.keyboard.down('Meta'); await page.mouse.click(x, y); await page.keyboard.up('Meta'); await at(900);
    return true;
  };

  // Output is asked for from the terminal, wherever the keyboard was left.
  const say = async (line) => {
    if (await page.evaluate(() => window.__store.getState().focus) !== 'terminal') { await page.keyboard.press('Control+`'); await at(500); }
    await run(`printf '${line}\\n'`);
  };
  fs.mkdirSync(path.join(work, 'proj', 'src', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(work, 'proj', 'src', 'lib', 'thing.ts'), 'one\ntwo\nthree\nfour\n');
  fs.writeFileSync(path.join(work, 'proj', 'Lonely.toml'), 'a = 1\n');
  fs.writeFileSync(path.join(work, 'notes', 'my big plan.md'), '# Big\n\nSee [the site](https://example.com/site).\n');
  await run(`cd ${work}`);

  await say('The logic is in src/lib/thing.ts:3.');
  ok('found the row', await cmdClick('lib/thing'));
  ok('1 named from another folder, with a line and a full stop', (await active()) === 'proj/src/lib/thing.ts', `${await active()} line ${await caretLine()}`);

  await say('Then (Lonely.toml) was changed');
  await cmdClick('Lonely');
  ok('1 a bare name in brackets', (await active()) === 'proj/Lonely.toml', String(await active()));

  await say('  Read notes/my big plan.md (3 lines)');
  await cmdClick('big plan');
  ok('1 a name with spaces', (await active()) === 'notes/my big plan.md', String(await active()));

  await say('still plain: main.py and nothing.zzz');
  await cmdClick('main.py');
  ok('1 a file in this folder, as before', (await active()) === 'main.py', String(await active()));
  await cmdClick('nothing.zzz');
  ok('1 a name that is no file opens nothing', (await active()) === 'main.py', String(await active()));
  await shot('filemention-1');

  // 2. the link box
  await page.evaluate((f) => window.__store.getState().openFile(f, null, { keep: true }), path.join(work, 'notes', 'my big plan.md'));
  await page.waitForSelector('.rich a'); await at(600);
  await page.click('.rich a'); await at(400);
  ok('2 the link box shows the address', (await page.evaluate(() => document.querySelector('.link-box .link-go')?.textContent)) === 'https://example.com/site');
  ok('2 with no arrow, and still a pencil', await page.evaluate(() => !document.querySelector('.link-box .link-go svg') && !!document.querySelector('.link-box .link-edit svg')));
  await shot('filemention-2-linkbox');
  await page.keyboard.press('Escape'); await at(200);

  // 3. settings
  const marks = () => page.evaluate(() => ({ title: document.querySelectorAll('.rich-title').length, wires: document.querySelectorAll('.title-wires').length }));
  ok('3 title and wires on by default', JSON.stringify(await marks()) === '{"title":1,"wires":1}', JSON.stringify(await marks()));
  await page.evaluate(() => window.__store.getState().updateSettings({ titleWires: false })); await at(400);
  ok('3 wires off, title stays', JSON.stringify(await marks()) === '{"title":1,"wires":0}', JSON.stringify(await marks()));
  await shot('filemention-3-nowires');
  await page.evaluate(() => window.__store.getState().updateSettings({ noteTitle: false })); await at(400);
  ok('3 title off', JSON.stringify(await marks()) === '{"title":0,"wires":0}', JSON.stringify(await marks()));
  ok('3 saved to the settings file', /"noteTitle":\s*false/.test(fs.readFileSync(path.join(work, '..', 'settings.json'), 'utf8')) && /"titleWires":\s*false/.test(fs.readFileSync(path.join(work, '..', 'settings.json'), 'utf8')));
  await page.evaluate(() => window.__store.getState().openPalette('settings')); await at(300);
  await page.click('.palette-row:has-text("Appearance and themes")'); await at(300);
  const rows = await page.evaluate(() => [...document.querySelectorAll('.palette-row')].map((r) => r.textContent).filter((t) => /title|Wire|Starfield/.test(t)));
  ok('3 both are in the settings palette, under Appearance', rows.length === 3, JSON.stringify(rows));
  await page.click('.palette-row:has-text("File name as a title")'); await at(300);
  ok('3 a click there turns the title back on', (await marks()).title === 1, JSON.stringify(await marks()));
  await page.keyboard.press('Escape'); await at(200); await page.keyboard.press('Escape'); await at(300); // back to Settings, then closed
  await page.evaluate(() => window.__store.getState().updateSettings({ noteTitle: true, titleWires: true })); await at(400);
  ok('3 and back on', JSON.stringify(await marks()) === '{"title":1,"wires":1}', JSON.stringify(await marks()));

  // 4. the hidden-terminals chip
  if (await page.evaluate(() => window.__store.getState().focus) !== 'terminal') { await page.keyboard.press('Control+`'); await at(500); }
  await page.keyboard.press('Meta+d'); await at(1800);   // a second terminal, so one can be hidden
  await page.keyboard.press('Meta+u'); await at(700);
  await run('seq 1 90', 1200);   // enough output that the prompt, and so the typing, is at the foot of the terminal
  const chip = () => page.evaluate(() => ({ there: !!document.querySelector('.hidden-chip'), clear: !!document.querySelector('.hidden-terms.is-clear'), opacity: document.querySelector('.hidden-chip') ? getComputedStyle(document.querySelector('.hidden-chip')).opacity : null, glass: document.querySelector('.hidden-chip') ? getComputedStyle(document.querySelector('.hidden-chip')).backdropFilter.includes('blur(1.5px)') : false, eased: document.querySelector('.hidden-chip') ? parseFloat(getComputedStyle(document.querySelector('.hidden-chip')).transitionDuration) >= 0.3 : false }));
  ok('4 a terminal is hidden and the chip shows', (await chip()).there && !(await chip()).clear, JSON.stringify(await chip()));
  await page.mouse.move(300, 300); await at(200);
  await type('ls'); await at(400);
  ok('4 typing far from it leaves it', !(await chip()).clear, JSON.stringify(await chip()));
  // The caret is walked along the bottom line until it is under the chip.
  const gap = await page.evaluate(() => {
    const c = document.querySelector('.hidden-chip').getBoundingClientRect();
    const el = document.activeElement;
    const caret = el.classList.contains('xterm-helper-textarea') ? el.getBoundingClientRect() : el.closest('.monaco-editor')?.querySelector('.cursors-layer .cursor')?.getBoundingClientRect();
    return caret ? { dx: Math.round(c.left - caret.right), dy: Math.round(c.top - caret.bottom), active: el.className.slice(0, 40) } : null;
  });
  console.log('   caret to chip:', JSON.stringify(gap));
  const cellW = (await term()).cell.width;
  await type('x'.repeat(Math.max(1, Math.ceil(((gap?.dx ?? 400) - 60) / cellW)))); await at(500);
  console.log('   after typing:', await page.evaluate(() => { const c = document.querySelector('.hidden-chip').getBoundingClientRect(); const k = document.activeElement.closest('.monaco-editor')?.querySelector('.cursors-layer .cursor')?.getBoundingClientRect(); return k ? `caret ${Math.round(k.left)},${Math.round(k.top)} chip ${Math.round(c.left)},${Math.round(c.top)}` : document.activeElement.className; }));
  await at(600);   // the change is eased, so it is read once it has settled
  const near = await chip();
  ok('4 typing near it turns it to glass (still there, eased)', near.clear && Number(near.opacity) === 1 && near.glass && near.eased, JSON.stringify(near));
  await shot('filemention-4-clear');
  await page.mouse.move(320, 320, { steps: 3 }); await at(400);
  const back = await chip();
  ok('4 the pointer brings it back', !back.clear && Number(back.opacity) > 0.9, JSON.stringify(back));
}
