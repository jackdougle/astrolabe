// ⌘U over selected words in a note underlines them (in the file, <u>words</u>), in the rendered and raw views alike,
// and takes the underline away again. A <u>…</u> already in the file shows underlined. With nothing selected, ⌘U
// still hides the terminal.
import fs from 'node:fs';
export default async function ({ page, run, work, shot }) {
  let fails = 0;
  const ok = (name, pass, detail = '') => { if (!pass) fails += 1; console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail && !pass ? `: ${detail}` : ''}`); };
  const at = (ms) => page.waitForTimeout(ms);
  const file = `${work}/notes/under.md`;
  fs.writeFileSync(file, 'Already <u>underlined **bold**</u> here.\n\nLast words here\n');
  const save = async () => { await page.keyboard.press('Meta+s'); await at(500); return fs.readFileSync(file, 'utf8'); };
  const unders = () => page.evaluate(() => [...document.querySelectorAll('.rich u')].map((d) => d.textContent));
  const terms = () => page.evaluate(() => document.querySelectorAll('.toptab:not(.filetab)').length);

  await run(`cd ${work}`);
  await page.evaluate((p) => window.__store.getState().openFile(p), file); await at(1500);
  ok('<u> in the file shows underlined', (await unders()).join('') === 'underlined bold', JSON.stringify(await unders()));
  ok('and is not shown as tags', !(await page.evaluate(() => document.querySelector('.rich').innerText)).includes('<u>'));
  const t0 = await terms();
  await page.locator('.rich >> text=Last words here').dblclick({ position: { x: 12, y: 8 } }); await at(250);
  await page.keyboard.press('Meta+u'); await at(400);
  ok('rendered: ⌘U underlines the selected word', (await unders()).join('') === 'underlined boldLast', JSON.stringify(await unders()));
  let text = await save();
  ok('the file has <u>Last</u>, and the old one is untouched', text.includes('<u>Last</u> words here') && text.includes('Already <u>underlined **bold**</u> here.'), JSON.stringify(text));
  ok('the terminal was not hidden', (await terms()) === t0, `${t0} → ${await terms()}`);
  await shot('underline-rendered');
  await page.keyboard.press('Meta+u'); await at(400);
  text = await save();
  ok('rendered: ⌘U again takes it away', !text.includes('<u>Last</u>') && text.includes('Last words here'), JSON.stringify(text));

  // Raw view.
  await page.evaluate(() => { const s = window.__store.getState(); const p = s.panes[s.editors.active]; s.toggleRendered(p.id, p.active); }); await at(900);
  const lines = page.locator('.editor-host .view-line');
  { const b = await lines.nth(2).boundingBox(); await page.mouse.dblclick(b.x + 14, b.y + b.height / 2); await at(250); }
  await page.keyboard.press('Meta+u'); await at(300);
  text = await save();
  ok('raw: ⌘U wraps the selected word in <u></u>', text.split('\n')[2] === '<u>Last</u> words here', JSON.stringify(text.split('\n')[2]));
  ok('raw: the terminal was not hidden', (await terms()) === t0);
  await page.keyboard.press('Meta+u'); await at(300);
  text = await save();
  ok('raw: ⌘U again unwraps it (the word stayed selected)', text.split('\n')[2] === 'Last words here', JSON.stringify(text.split('\n')[2]));

  // Nothing selected: ⌘U hides the terminal, as before.
  await page.keyboard.press('ArrowRight'); await at(150);
  await page.keyboard.press('Meta+u'); await at(600);
  const hidden = await page.evaluate(() => window.__store.getState().hidden?.length ?? null);
  ok('with nothing selected, ⌘U hides the terminal', (await terms()) < t0 || !!hidden, `${t0} → ${await terms()}`);
  if (fails) throw new Error(`${fails} failed`);
}
