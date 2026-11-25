// ⌘-click on a file a program names at the very end or the very start of a row, next to a row that is full.
// Rows a program breaks itself are joined to find names broken across them, which must not cost the names
// that simply end one row or start the next.
import fs from 'node:fs';
import path from 'node:path';
export const settings = { zoom: 1 };
export default async function ({ page, shot, run, work }) {
  let fails = 0;
  const ok = (name, pass, detail = '') => { if (!pass) fails += 1; console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`); };
  const at = (ms) => page.waitForTimeout(ms);
  const term = () => page.evaluate(() => {
    const t = [...window.__sessions.values()][0].term;
    const cell = t._core._renderService.dimensions.css.cell;
    const box = t.element.querySelector('.xterm-screen').getBoundingClientRect();
    const rows = [];
    for (let y = 0; y < t.rows; y++) rows.push(t.buffer.active.getLine(t.buffer.active.viewportY + y)?.translateToString(true) ?? '');
    return { cell, box: { x: box.x, y: box.y }, rows, cols: t.cols };
  });
  const active = () => page.evaluate(() => { const s = window.__store.getState(); const e = Object.values(s.panes).find((p) => p.kind === 'editor'); return e?.active ? e.active.split('/work/')[1] : null; });
  const shut = async () => {
    await page.evaluate(() => { const s = window.__store.getState(); for (const p of Object.values(s.panes)) if (p.kind === 'editor') for (const f of [...p.files]) s.closeFile(p.id, f.path); });
    await at(400);
    if (await page.evaluate(() => window.__store.getState().focus) !== 'terminal') { await page.keyboard.press('Control+`'); await at(400); }
  };
  // ⌘-click on the last place `word` shows in output.
  const cmdClick = async (word) => {
    const t = await term();
    let row = -1;
    for (let i = t.rows.length - 1; i >= 0; i--) if (t.rows[i].includes(word) && !t.rows[i].includes('printf')) { row = i; break; }
    if (row < 0) return false;
    const col = t.rows[row].indexOf(word) + Math.floor(word.length / 2);
    const x = t.box.x + (col + 0.5) * t.cell.width; const y = t.box.y + (row + 0.5) * t.cell.height;
    await page.mouse.move(x - 30, y + 40, { steps: 2 }); await page.mouse.move(x, y, { steps: 4 }); await at(1100);
    await page.keyboard.down('Meta'); await page.mouse.click(x, y); await page.keyboard.up('Meta'); await at(900);
    return true;
  };
  fs.mkdirSync(path.join(work, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(work, 'reports', 'pacing-frontier-brief-2026-11-21.md'), '# Brief\n');
  await run(`cd ${work}`);
  const { cols } = await term();
  const NAME = 'reports/pacing-frontier-brief-2026-11-21.md';
  /** Words that fill a row to `n` columns, ending in `tail`. */
  const fill = (n, tail) => { let s = ''; while (s.length < n - tail.length - 1) s += 'lorem '; return `${s.slice(0, n - tail.length - 1).replace(/ $/, 'x')} ${tail}`; };
  const say = async (...lines) => { await run(`printf '${lines.map(() => '%s\\n').join('')}' ${lines.map((l) => `'${l}'`).join(' ')}`); await at(300); };

  await say(fill(cols - 1, NAME), 'and then the sentence goes on');
  await cmdClick('frontier-brief');
  ok('a name that ends a full row, a word starting the next', (await active()) === NAME, String(await active()));
  await shut();

  await say(fill(cols - 1, 'saved'), `${NAME} for you to read`);
  await cmdClick('frontier-brief');
  ok('a name that starts the row after a full one', (await active()) === NAME, String(await active()));
  await shut();

  await say(fill(cols - 1, NAME.slice(0, 20)), `  ${NAME.slice(20)} is the brief`);
  await cmdClick('brief-2026');
  ok('a name broken over two rows, clicked on its second row', (await active()) === NAME, String(await active()));
  await shut();
  await cmdClick(NAME.slice(8, 20));
  ok('and on its first', (await active()) === NAME, String(await active()));
  await shot('rowedge');
  console.log(fails ? `${fails} FAILED` : 'all ok');
}
