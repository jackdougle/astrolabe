// A pasted URL that a program marks with OSC 8 and fails to close (Claude Code's prompt does this)
// must not underline every row below on hover. A properly closed mark, and a mark broken over two
// rows on purpose, still underline only the link.
export default async function ({ page, run, work }) {
  let fails = 0;
  const ok = (name, pass, detail = '') => { if (!pass) fails += 1; console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail && !pass ? `: ${detail}` : ''}`); };
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
  const lines = () => page.evaluate(() => {
    const t = [...window.__sessions.values()][0].term;
    const cell = t._core._renderService.dimensions.css.cell;
    return [...document.querySelectorAll('.term-link-line')].map((el) => `${Math.round((parseFloat(el.style.top) + 2) / cell.height) - 1}:${Math.round(parseFloat(el.style.left) / cell.width)}+${Math.round(parseFloat(el.style.width) / cell.width)}`).sort().join(' ');
  });
  const hover = async (t, row, col) => { await page.mouse.move(t.box.x + (col + 0.5) * t.cell.width, t.box.y + (row + 0.5) * t.cell.height, { steps: 4 }); await at(500); };

  await run(`cd ${work}`);

  // Unclosed OSC 8: the same urlId stains every row after the URL.
  await run(String.raw`printf '\e]8;;https://example.com/leak\e\\https://example.com/leak\nleaked-a\nleaked-b\nleaked-c\n'`);
  let t = await term();
  const leak = t.rows.findIndex((r) => r.includes('https://example.com/leak') && !r.includes('printf'));
  ok('leak setup', leak >= 0 && t.rows[leak + 1] === 'leaked-a', JSON.stringify(t.rows.slice(leak, leak + 4)));
  await hover(t, leak, 5);
  ok('unclosed OSC 8: hover does not underline the rows below', (await lines()) === '', await lines());

  // Closed OSC 8 on one row: nothing else to underline.
  await run(String.raw`printf '\e]8;;https://example.com/ok\e\\https://example.com/ok\e]8;;\e\\\nbelow-ok\n'`);
  t = await term();
  const closed = t.rows.findIndex((r) => r.includes('https://example.com/ok') && !r.includes('printf'));
  await hover(t, closed, 5);
  ok('closed OSC 8: no extra lines', (await lines()) === '', await lines());

  // Same address re-opened on the next row (Claude Code's indented break): still underline the other piece.
  await run(String.raw`printf '\e]8;;https://example.com/doc\e\\see-the-first-part-\e]8;;\e\\\n    \e]8;;https://example.com/doc\e\\of-the-link\e]8;;\e\\ and more\n'`);
  t = await term();
  const a = t.rows.findIndex((r) => r.startsWith('see-the-first-part-'));
  ok('re-opened link is on two rows', a >= 0 && t.rows[a + 1].startsWith('    of-the-link and more'), JSON.stringify(t.rows.slice(a, a + 2)));
  await hover(t, a, 5);
  ok('re-opened: the second piece is underlined', (await lines()) === `${a + 1}:4+11`, await lines());
  await hover(t, a + 1, 8);
  ok('re-opened: the first piece is underlined', (await lines()) === `${a}:0+19`, await lines());

  // One OSC 8 span the terminal wraps: same urlId on every row, still underlined along all of it.
  const url = `https://example.com/${'abcdefghij'.repeat(Math.ceil(t.cols * 2.3 / 10))}`;
  await run(`printf '\\e]8;;${url}\\e\\\\${url}\\e]8;;\\e\\\\\\n'`);
  t = await term();
  const first = t.rows.findIndex((r, i) => r.startsWith('https://example.com/abcdefghij') && !t.rows[i - 1]?.includes('printf'));
  const last = first + Math.ceil(url.length / t.cols) - 1;
  const tail = url.length - (last - first) * t.cols;
  ok('wrapped OSC 8 spans three rows', first >= 0 && last === first + 2, `rows ${first}..${last}`);
  await hover(t, first, 10);
  ok('wrapped OSC 8: the other rows are underlined', (await lines()) === `${first + 1}:0+${t.cols} ${last}:0+${tail}`, await lines());

  if (fails) throw new Error(`${fails} failed`);
}
