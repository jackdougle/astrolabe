// Ticking a to-do: its words ease to grey and the line through them fades in, rather than snapping; unticking runs back.
import fs from 'node:fs';
export const settings = { zoom: 1 };
export default async function ({ page, run, work, shot }) {
  const file = `${work}/notes/todo.md`;
  fs.writeFileSync(file, 'Things\n\n- [ ] open task with some words in it\n- [x] done task\n');
  await run(`cd ${work}`);
  await page.evaluate((f) => window.__store.getState().openFile(f, null, { keep: true }), file);
  await page.waitForSelector('.rich li[data-item-type="task"]'); await page.waitForTimeout(900);
  let fails = 0;
  const ok = (name, pass, extra = '') => { if (!pass) fails += 1; console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };
  const words = () => page.evaluate(() => { const p = document.querySelector('.rich li[data-item-type="task"] > p'); const c = getComputedStyle(p); return { colour: c.color, line: c.textDecorationLine, lineColour: c.textDecorationColor, cls: p.parentElement.className }; });
  const box = await page.evaluate(() => { const el = document.querySelector('.rich li[data-item-type="task"]'); const r = el.getBoundingClientRect(), b = getComputedStyle(el, '::before'); return { x: r.left + parseFloat(b.left) + 7, y: r.top + parseFloat(b.top) + 7 }; });
  const run2 = async () => { const out = []; for (let i = 0; i < 9; i++) { out.push(await words()); await page.waitForTimeout(35); } await page.waitForTimeout(350); out.push(await words()); return out; };
  const open = await words();
  const done = await page.evaluate(() => { const p = document.querySelectorAll('.rich li[data-item-type="task"] > p')[1]; const c = getComputedStyle(p); return { colour: c.color, line: c.textDecorationLine, lineColour: c.textDecorationColor }; });
  ok('on load nothing is moving', (await page.evaluate(() => document.getAnimations().filter((a) => /strike|task-/.test(a.animationName ?? '')).length)) === 0);
  await page.mouse.click(box.x, box.y);
  let seen = await run2();
  ok('ticked: the words pass through colours between', new Set(seen.map((s) => s.colour)).size >= 4 && seen.at(-1).colour === done.colour, JSON.stringify([...new Set(seen.map((s) => s.colour))].slice(0, 6)));
  ok('the line comes in gradually and ends as a ticked task\'s', new Set(seen.map((s) => s.lineColour)).size >= 4 && seen.every((s) => s.line === 'line-through') && seen.at(-1).lineColour === done.lineColour && seen.at(-1).cls === '', JSON.stringify([...new Set(seen.map((s) => s.lineColour))].slice(0, 6)));
  await shot('strikefade-ticked');
  await page.mouse.click(box.x, box.y);
  seen = await run2();
  ok('unticked: the line fades and the words come back', new Set(seen.map((s) => s.colour)).size >= 4 && seen.at(-1).colour === open.colour && seen.at(-1).line === 'none' && seen.at(-1).cls === '', JSON.stringify(seen.at(-1)));
  ok('the file follows', fs.readFileSync(file, 'utf8') !== null && (await page.evaluate((f) => window.__monaco.editor.getModels().find((m) => m.uri.path === f)?.getValue(), file)).includes('- [ ] open task'));
  console.log(fails ? `${fails} FAILED` : 'all ok');
}
