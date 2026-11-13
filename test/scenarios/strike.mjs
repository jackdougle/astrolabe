// A tilde is only a tilde: typed in a note it stays as typed (rendered and raw), and in a file a single ~ strikes
// nothing through. ⇧⌘X strikes the selection through, and takes the strike away again.
import fs from 'node:fs';
export default async function ({ page, run, type, work, shot }) {
  const at = (ms) => page.waitForTimeout(ms);
  const file = `${work}/notes/tilde.md`;
  fs.writeFileSync(file, 'About ~5 files in ~/notes and ~10 more.\n\nOne ~single~ pair and one ~~double~~ pair.\n\nLast words here\n');
  const save = async () => { await page.keyboard.press('Meta+s'); await at(500); return fs.readFileSync(file, 'utf8'); };
  const struck = () => page.evaluate(() => [...document.querySelectorAll('.rich del')].map((d) => d.textContent));
  const dbl = async (text) => { await page.locator(`.rich >> text=${text}`).first().dblclick({ position: { x: 12, y: 8 } }); await at(250); };

  await run(`cd ${work}`);
  await page.evaluate((p) => window.__store.getState().openFile(p), file); await at(1500);
  console.log('rendered, struck through on opening:', JSON.stringify(await struck()));
  await page.locator('.rich >> text=Last words here').click(); await at(250);
  await page.keyboard.press('End'); await type(' at ~3pm, ~ok~ then ~~no~~'); await at(400);
  console.log('after typing tildes, struck through:', JSON.stringify(await struck()));
  console.log('file:', JSON.stringify((await save()).split('\n').filter(Boolean)));
  await dbl('Last words here');
  await page.keyboard.press('Meta+Shift+x'); await at(400);
  console.log('⇧⌘X on a word, struck through:', JSON.stringify(await struck()), '| file:', JSON.stringify((await save()).split('\n').filter(Boolean).pop()));
  await shot('strike-rendered');
  await page.keyboard.press('Meta+Shift+x'); await at(400);
  console.log('⇧⌘X again:', JSON.stringify(await struck()), '| file:', JSON.stringify((await save()).split('\n').filter(Boolean).pop()));
  await type('~'); await at(300);
  console.log('~ typed over the selected word (it replaces it):', JSON.stringify((await save()).split('\n').filter(Boolean).pop()));
  await page.keyboard.press('Meta+z'); await at(300);

  // Raw view, set through the store so the test does not depend on which key toggles it.
  await page.evaluate(() => { const s = window.__store.getState(); const p = s.panes[s.editors.active]; s.toggleRendered(p.id, p.active); }); await at(900);
  { const b = await page.locator('.editor-host .view-line').first().boundingBox(); await page.mouse.dblclick(b.x + 14, b.y + b.height / 2); await at(250); }
  await page.keyboard.press('Meta+Shift+x'); await at(300);
  console.log('raw, ⇧⌘X on a word:', JSON.stringify((await save()).split('\n')[0]));
  await page.keyboard.press('Meta+Shift+x'); await at(300);
  console.log('raw, ⇧⌘X again:', JSON.stringify((await save()).split('\n')[0]));
  await type('~'); await at(300);
  console.log('raw, ~ typed over the selected word:', JSON.stringify((await save()).split('\n')[0]));
}
