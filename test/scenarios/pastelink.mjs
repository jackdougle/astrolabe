// Links must not underline unrelated rows. Soft wraps still underline the rest of the same link.
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
    return { cols: t.cols, cell, box: { x: box.x, y: box.y }, rows, viewportY: t.buffer.active.viewportY };
  });
  const lines = () => page.evaluate(() => {
    const t = [...window.__sessions.values()][0].term;
    const cell = t._core._renderService.dimensions.css.cell;
    return [...document.querySelectorAll('.term-link-line')].map((el) => `${Math.round((parseFloat(el.style.top) + 2) / cell.height) - 1}:${Math.round(parseFloat(el.style.left) / cell.width)}+${Math.round(parseFloat(el.style.width) / cell.width)}`).sort().join(' ');
  });
  const oscOn = (from, n) => page.evaluate(({ from, n }) => {
    const s = [...window.__sessions.values()][0];
    const core = s.term._core;
    const out = [];
    for (let i = 0; i < n; i++) {
      const abs = s.term.buffer.active.viewportY + from + i;
      const marks = core._bufferService.buffer.lines.get(abs)?._extendedAttrs || {};
      let cells = 0;
      for (const k in marks) if (marks[k]?.urlId) cells++;
      out.push(cells);
    }
    return out;
  }, { from, n });
  const hover = async (t, row, col) => { await page.mouse.move(t.box.x + (col + 0.5) * t.cell.width, t.box.y + (row + 0.5) * t.cell.height, { steps: 4 }); await at(500); };

  await run(`cd ${work}`);

  // Unclosed OSC 8: an explicit line feed must close it so later rows are not linked.
  await run(String.raw`printf '\e]8;;https://example.com/leak\e\\https://example.com/leak\nleaked-a\nleaked-b\nleaked-c\n'`);
  let t = await term();
  const leak = t.rows.findIndex((r) => r.includes('https://example.com/leak') && !r.includes('printf'));
  ok('leak setup', leak >= 0 && t.rows[leak + 1] === 'leaked-a', JSON.stringify(t.rows.slice(leak, leak + 4)));
  const stained = await oscOn(leak, 4);
  ok('line feed closes anonymous OSC 8: rows below have no urlId', stained[0] > 0 && stained.slice(1).every((c) => c === 0), JSON.stringify(stained));
  await hover(t, leak, 5);
  ok('unclosed OSC 8: hover does not underline the rows below', (await lines()) === '', await lines());

  // Closed OSC 8 on one row: nothing else to underline.
  await run(String.raw`printf '\e]8;;https://example.com/ok\e\\https://example.com/ok\e]8;;\e\\\nbelow-ok\n'`);
  t = await term();
  const closed = t.rows.findIndex((r) => r.includes('https://example.com/ok') && !r.includes('printf'));
  await hover(t, closed, 5);
  ok('closed OSC 8: no extra lines', (await lines()) === '', await lines());

  // Two labels at the same address on independent rows must not underline each other.
  await run(String.raw`printf '\e]8;;https://example.com/doc\e\\see-the-first-part-\e]8;;\e\\\n    \e]8;;https://example.com/doc\e\\of-the-link\e]8;;\e\\ and more\n'`);
  t = await term();
  const a = t.rows.findIndex((r) => r.startsWith('see-the-first-part-'));
  ok('same address appears on two hard lines', a >= 0 && t.rows[a + 1].startsWith('    of-the-link and more'), JSON.stringify(t.rows.slice(a, a + 2)));
  await hover(t, a, 5);
  ok('hover on first label does not underline the second', (await lines()) === '', await lines());
  await hover(t, a + 1, 8);
  ok('hover on second label does not underline the first', (await lines()) === '', await lines());

  const write = (chunks) => page.evaluate(async (data) => {
    const { term } = [...window.__sessions.values()][0];
    for (const chunk of data) await new Promise((done) => term.write(chunk, done));
  }, chunks);
  const linksAt = (row) => page.evaluate(async (y) => {
    const s = [...window.__sessions.values()][0];
    return (await s.provideLinks(s.term.buffer.active.viewportY + y + 1) ?? []).map((link) => link.text);
  }, row);
  // Fill the row to its edge so the file-path join heuristic is triggered, but not the URL parser.
  const plain = 'https://example.com/' + 'a'.repeat(t.cols - 'https://example.com/'.length);
  await write(['\x1b[H\x1b[2J', plain + '\r\n   unrelated-row\r\n']);
  t = await term();
  ok('plain URL stops at explicit newline even at right edge', (await linksAt(0)).includes(plain), JSON.stringify(await linksAt(0)));
  ok('text below plain URL is not linked', (await linksAt(1)).length === 0, JSON.stringify(await linksAt(1)));
  await hover(t, 0, 5);
  ok('plain URL underlines just its own row', (await lines()) === '', await lines());

  await write(['\x1b[H\x1b[2J\x1b', ']8;;https://example.com/split\x1b', '\\visible-link\r\nnot-a-link\r\n']);
  t = await term();
  const split = await oscOn(0, 2);
  ok('OSC 8 parsed across chunks and closed before next row', split[0] > 0 && split[1] === 0, JSON.stringify(split));

  // One OSC 8 span the terminal wraps: same urlId on every row, still underlined along all of it.
  const url = `https://example.com/${'abcdefghij'.repeat(Math.ceil(t.cols * 2.3 / 10))}`;
  await write(['\x1b[H\x1b[2J', `\x1b]8;;${url}\x07${url}\x1b]8;;\x07\r\n`]);
  t = await term();
  const first = t.rows.findIndex((r, i) => r.startsWith('https://example.com/abcdefghij') && !t.rows[i - 1]?.includes('printf'));
  const last = first + Math.ceil(url.length / t.cols) - 1;
  const tail = url.length - (last - first) * t.cols;
  ok('wrapped OSC 8 spans three rows', first >= 0 && last === first + 2, `rows ${first}..${last}`);
  await hover(t, first, 10);
  ok('wrapped OSC 8: the other rows are underlined', (await lines()) === `${first + 1}:0+${t.cols} ${last}:0+${tail}`, await lines());

  if (fails) throw new Error(`${fails} failed`);
}
