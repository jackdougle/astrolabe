// A link that runs over several rows is underlined along all of it while the pointer is on any piece: one the
// terminal wrapped, and one a program marked itself (OSC 8) and broke over two rows with an indent.
export const settings = { zoom: 1 };
export default async function ({ page, shot, run, work }) {
  const ok = (name, pass, detail = '') => console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  const at = (ms) => page.waitForTimeout(ms);
  const term = () => page.evaluate(() => {
    const s = [...window.__sessions.values()][0];
    const t = s.term;
    const cell = t._core._renderService.dimensions.css.cell;
    const box = t.element.querySelector('.xterm-screen').getBoundingClientRect();
    const rows = [];
    for (let y = 0; y < t.rows; y++) rows.push(t.buffer.active.getLine(t.buffer.active.viewportY + y)?.translateToString(true) ?? '');
    return { cols: t.cols, cell, box: { x: box.x, y: box.y }, rows };
  });
  // The lines drawn, as row:firstColumn+columns, in rows of the screen.
  const lines = () => page.evaluate(() => {
    const t = [...window.__sessions.values()][0].term;
    const cell = t._core._renderService.dimensions.css.cell;
    return [...document.querySelectorAll('.term-link-line')].map((el) => `${Math.round((parseFloat(el.style.top) + 2) / cell.height) - 1}:${Math.round(parseFloat(el.style.left) / cell.width)}+${Math.round(parseFloat(el.style.width) / cell.width)}`).sort().join(' ');
  });
  const hover = async (t, row, col) => { await page.mouse.move(t.box.x + (col + 0.5) * t.cell.width, t.box.y + (row + 0.5) * t.cell.height, { steps: 4 }); await at(500); };

  await run(`cd ${work}`);
  // Long enough to wrap twice at any width the test window has.
  let t = await term();
  const url = `https://example.com/${'abcdefghij'.repeat(Math.ceil(t.cols * 2.3 / 10))}`;
  await run(`echo ${url}`);
  t = await term();
  const first = t.rows.findIndex((r, i) => r.startsWith('https://example.com/') && !t.rows[i - 1]?.includes('echo'));
  const last = first + Math.ceil(url.length / t.cols) - 1;
  const tail = url.length - (last - first) * t.cols;
  ok('the link is on three rows', first >= 0 && last === first + 2, `rows ${first}..${last} of ${t.cols} columns`);

  await hover(t, first, 10);
  let got = await lines();
  ok('pointer on its first row: the other two are underlined', got === `${first + 1}:0+${t.cols} ${last}:0+${tail}`, got);
  await shot('linkline-1-wrapped');
  await hover(t, last, 3);
  got = await lines();
  ok('pointer on its last row: the first two are', got === `${first}:0+${t.cols} ${first + 1}:0+${t.cols}`, got);
  await hover(t, last + 1, 40);
  ok('off the link, the lines go', (await lines()) === '');

  // A link marked by a program, broken over two rows, the second indented.
  await run(String.raw`printf '\e]8;;https://example.com/doc\e\\see-the-first-part-\e]8;;\e\\\n    \e]8;;https://example.com/doc\e\\of-the-link\e]8;;\e\\ and more\n'`);
  t = await term();
  const a = t.rows.findIndex((r) => r.startsWith('see-the-first-part-'));
  ok('the marked link is on two rows', a >= 0 && t.rows[a + 1].startsWith('    of-the-link and more'), JSON.stringify(t.rows.slice(a, a + 2)));
  await hover(t, a, 5);
  got = await lines();
  ok('pointer on the first piece: the second is underlined, without its indent or what follows', got === `${a + 1}:4+11`, got);
  await shot('linkline-2-marked');
  await hover(t, a + 1, 8);
  got = await lines();
  ok('pointer on the second piece: the first is', got === `${a}:0+19`, got);
  await hover(t, a + 1, 20);
  ok('past the link on that row, nothing', (await lines()) === '');
}
