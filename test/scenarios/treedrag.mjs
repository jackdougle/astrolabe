// Rows in the navigator are dragged, as in VS Code: onto a folder to move them there, onto the empty space to move
// them to the top of the project, onto a terminal to paste their text, onto an editor to open them.
import fs from 'node:fs';
import path from 'node:path';
export default async function ({ page, shot, run, work }) {
  for (const n of ['a.txt', 'b.txt', 'c.txt']) fs.writeFileSync(path.join(work, n), `${n} line one\n${n} line two\n`);
  fs.mkdirSync(path.join(work, 'deep', 'inner'), { recursive: true });
  fs.writeFileSync(path.join(work, 'deep', 'inner', 'x.md'), 'x\n');
  fs.writeFileSync(path.join(work, 'deep', 'main.py'), 'other\n');
  // A row by its name, or by its path from the project's top when the name is not enough.
  const row = (name) => (name.includes('/') ? `.treerow[data-path$="/work/${name}"]` : `.treerow:has(.tree-name:text-is("${name}"))`);
  const rows = () => page.evaluate(() => [...document.querySelectorAll('.treerow')].map((r) => `${' '.repeat(Math.round((parseFloat(r.style.paddingLeft) - 10) / 13))}${r.textContent}`));
  const picked = () => page.evaluate(() => [...document.querySelectorAll('.treerow.is-selected')].map((r) => r.textContent));
  const toast = () => page.evaluate(() => document.querySelector('.toast')?.textContent ?? null);
  const tree = (dir = work, pre = '') => fs.readdirSync(dir, { withFileTypes: true }).filter((e) => !e.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name)).flatMap((e) => (e.isDirectory() ? [`${pre}${e.name}/`, ...tree(path.join(dir, e.name), `${pre}${e.name}/`)] : [`${pre}${e.name}`]));
  const mid = async (sel) => { const b = await page.locator(sel).first().boundingBox(); return { x: b.x + Math.min(b.width / 2, 60), y: b.y + b.height / 2 }; };
  // Picks a row up, carries it to a point (or the middle of something), waits there, and lets go.
  const drag = async (from, to, { hold = 200, drop = true, during } = {}) => {
    const a = await mid(from);
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    await page.mouse.move(a.x + 12, a.y + 9, { steps: 3 });
    const b = typeof to === 'string' ? await mid(to) : to;
    await page.mouse.move(b.x, b.y, { steps: 8 }); await page.waitForTimeout(hold);
    if (during) await during();
    if (drop) await page.mouse.up(); else { await page.keyboard.press('Escape'); await page.mouse.up(); }
    await page.waitForTimeout(800);
  };
  const lit = () => page.evaluate(() => ({ tag: document.querySelector('.tree-drag')?.textContent ?? null, into: [...document.querySelectorAll('.tree-node.is-drop > .treerow')].map((r) => r.textContent), top: !!document.querySelector('.tree-scroll.is-drop'), pane: document.querySelector('.pane.is-file-drop') ? (document.querySelector('.pane.is-file-drop .term-host') ? 'terminal' : 'editor') : null }));

  await run(`cd ${work}`);
  await page.keyboard.press('Meta+l'); await page.waitForTimeout(700);
  console.log('⌘L opens the navigator:', JSON.stringify(await rows()));

  let seen;
  await drag(row('a.txt'), row('notes'), { during: async () => { seen = await lit(); await shot('treedrag-over-folder'); } });
  console.log('a.txt onto notes: while held', JSON.stringify(seen), '| toast:', JSON.stringify(await toast()), '| picked:', JSON.stringify(await picked()), '\n  rows:', JSON.stringify(await rows()), '\n  disk:', JSON.stringify(tree()));

  // A closed folder opens when the pointer rests on it.
  await drag(row('b.txt'), row('deep'), { hold: 1000, drop: false });
  console.log('b.txt rested on deep, then Esc:', JSON.stringify(await rows()), '| b.txt still at the top:', fs.existsSync(path.join(work, 'b.txt')));
  await drag(row('b.txt'), row('inner'));
  console.log('b.txt onto deep/inner:', fs.existsSync(path.join(work, 'deep', 'inner', 'b.txt')), '| toast:', JSON.stringify(await toast()));

  // Several selected rows go together.
  await page.click(row('c.txt')); await page.waitForTimeout(500);
  await page.click(row('data.json'), { modifiers: ['Meta'] }); await page.waitForTimeout(300);
  await drag(row('data.json'), row('plan.md'), { during: async () => { seen = await lit(); } });
  console.log('c.txt + data.json onto a file in notes: while held', JSON.stringify(seen), '| toast:', JSON.stringify(await toast()), '| picked:', JSON.stringify(await picked()), '\n  disk:', JSON.stringify(tree()));

  // A file with the same name is already there.
  await drag('.treerow[data-path$="/work/main.py"]', row('deep'));
  console.log('main.py onto deep, which has one:', JSON.stringify(await toast()), '| still at the top:', fs.existsSync(path.join(work, 'main.py')));

  // A folder goes with what is in it, and the tab open on a file inside follows.
  await page.click(row('plan.md')); await page.waitForTimeout(1200);
  await drag(row('notes'), row('deep'));
  const tab = () => page.evaluate(() => { const row = document.querySelector('.treerow.is-active'); return { tabs: [...document.querySelectorAll('.filetab')].map((f) => f.textContent), lit: row?.getAttribute('data-path') ?? null, note: document.querySelector('.rich h1')?.textContent ?? null }; });
  const t = await tab();
  console.log('notes onto deep: disk', JSON.stringify(tree()), '\n  open file:', JSON.stringify(t.tabs), 'lit row ends', JSON.stringify(t.lit?.slice(work.length)), '| note still showing:', JSON.stringify(t.note));
  await page.waitForTimeout(800);
  await page.click('.rich p >> nth=0'); await page.waitForTimeout(300); await page.keyboard.type('Edited after the move. '); await page.waitForTimeout(500);
  const unsaved = await page.evaluate(() => !!document.querySelector('.tab-file.is-dirty'));
  await page.keyboard.press('Meta+s'); await page.waitForTimeout(700);
  console.log('  typed into it: unsaved', unsaved, '| saved where it now is:', fs.readFileSync(path.join(work, 'deep', 'notes', 'plan.md'), 'utf8').includes('Edited after the move.'), '| toast:', JSON.stringify(await toast()), '| old place left empty:', !fs.existsSync(path.join(work, 'notes')), '| text:', JSON.stringify(await page.evaluate(() => document.querySelector('.rich')?.textContent.slice(0, 60))));

  // A folder cannot go inside itself.
  await drag(row('deep'), row('inner'), { during: async () => { seen = await lit(); } });
  console.log('deep onto deep/inner: while held', JSON.stringify(seen), '| deep still at the top:', fs.existsSync(path.join(work, 'deep', 'inner')));

  // Back out to the top of the project: the empty space under the rows.
  const box = await page.locator('.tree-scroll').boundingBox();
  await drag(row('b.txt'), { x: box.x + box.width / 2, y: box.y + box.height - 14 }, { during: async () => { seen = await lit(); await shot('treedrag-to-top'); } });
  console.log('b.txt onto the empty space: while held', JSON.stringify(seen), '| at the top:', fs.existsSync(path.join(work, 'b.txt')), '| toast:', JSON.stringify(await toast()));

  // A click is still a click.
  await page.click(row('b.txt')); await page.waitForTimeout(900);
  console.log('click after dragging: picked', JSON.stringify(await picked()), '| tabs:', JSON.stringify((await tab()).tabs));

  // Onto a terminal: the file's text, on the command line.
  const term = '.pane:has(.term-host)';
  const termMid = async () => { const b = await page.locator(term).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  await drag(row('b.txt'), await termMid(), { during: async () => { seen = await lit(); await shot('treedrag-over-terminal'); } });
  const input = () => page.evaluate(() => [...document.querySelectorAll('.cmd-input .view-line')].map((l) => l.textContent.replace(/ /g, ' ')));
  console.log('b.txt onto the terminal: while held', JSON.stringify(seen), '| command line:', JSON.stringify(await input()), '| file untouched:', fs.existsSync(path.join(work, 'b.txt')), '| focus:', await page.evaluate(() => !!document.activeElement?.closest('.cmd-input')));
  await page.keyboard.press('Meta+a'); await page.keyboard.press('Backspace'); await page.waitForTimeout(200);
  // ...and to a program running there.
  await run('cat > caught.txt', 700);
  await drag('.treerow[data-path$="/work/main.py"]', await termMid());
  await page.keyboard.press('Enter'); await page.keyboard.press('Control+d'); await page.waitForTimeout(900);
  const caught = fs.existsSync(path.join(work, 'caught.txt')) ? fs.readFileSync(path.join(work, 'caught.txt'), 'utf8') : null;
  console.log('main.py onto a running cat: got the whole file', caught?.trim() === fs.readFileSync(path.join(work, 'main.py'), 'utf8').trim(), JSON.stringify(caught?.slice(0, 40)));

  // Onto an editor: it opens there.
  const ed = await page.locator('.pane:has(.editor-pane)').first().boundingBox();
  await drag('.treerow[data-path$="/work/main.py"]', { x: ed.x + ed.width / 2, y: ed.y + ed.height / 2 }, { during: async () => { seen = await lit(); } });
  console.log('main.py onto the editor: while held', JSON.stringify(seen), '| tabs:', JSON.stringify((await tab()).tabs));
  await shot('treedrag-end');
}
