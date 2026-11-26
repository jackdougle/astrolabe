// Tables in a rendered note: the row and column grips pick whole rows and columns, ⌫ deletes them, and the
// right-click menu inserts and deletes. The file must stay a plain GFM table throughout.
import fs from 'node:fs';
import path from 'node:path';
export default async function ({ page, shot, work }) {
  const ok = (name, pass, detail = '') => console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  const note = path.join(work, 'notes', 'grid.md');
  fs.writeFileSync(note, '# Grid\n\n| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n| 7 | 8 | 9 |\n\nAfter.\n');
  await page.evaluate((f) => window.__store.getState().openFile(f), note);
  await page.waitForSelector('.ProseMirror table');
  await page.waitForTimeout(400);
  const text = () => page.evaluate(() => window.__monaco.editor.getModels().find((m) => m.uri.path.endsWith('grid.md'))?.getValue());
  // Whitespace and the length of the --- line are the serializer's business; only cells and alignment matter here.
  const table = async () => (await text()).split('\n').filter((l) => l.startsWith('|')).map((l) => l.replace(/\s+/g, ' ').replace(/-+/g, '-')).join(' / ');
  const cell = (t) => page.locator('.ProseMirror td, .ProseMirror th').filter({ hasText: new RegExp(`^${t}$`) }).first();
  const grip = (axis) => page.locator(`.table-grip.is-${axis}.is-on`);
  const hover = async (t) => { await cell(t).hover(); await page.waitForTimeout(150); };

  // One row.
  await hover('5');
  ok('grips show over a table', await grip('row').count() === 1 && await grip('col').count() === 1);
  await shot('tables-1-grips');
  await grip('row').click();
  await page.waitForTimeout(150);
  ok('the row grip picks the whole row', await page.locator('.ProseMirror .selectedCell').count() === 3);
  await shot('tables-2-row');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(400);
  ok('⌫ deletes the row', (await table()) === '| A | B | C | / | - | - | - | / | 1 | 2 | 3 | / | 7 | 8 | 9 |', await table());

  // Two columns by dragging along the column grips.
  await hover('B');
  const g = await grip('col').boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  const c = await cell('C').boundingBox();
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  ok('dragging along the grips picks two columns', await page.locator('.ProseMirror .selectedCell').count() === 6);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(400);
  ok('Delete removes both columns', (await table()) === '| A | / | - | / | 1 | / | 7 |', await table());

  // A partly picked table only empties cells (the editor's own behaviour), and the menu inserts.
  await page.evaluate(() => window.astrolabe.fs.testMenuChoice('right'));
  await cell('1').click({ button: 'right' });
  await page.waitForTimeout(400);
  ok('the menu inserts a column with no alignment', (await table()).startsWith('| A | | / | - | - |'), await table());
  await page.evaluate(() => window.astrolabe.fs.testMenuChoice('below'));
  await cell('7').click({ button: 'right' });
  await page.waitForTimeout(400);
  ok('the menu inserts a row', (await table()).split(' / ').length === 5, await table());

  // The header row: the next row becomes the header.
  await hover('A');
  await grip('row').click();
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(400);
  ok('deleting the header row promotes the next', (await table()).startsWith('| 1 |') && (await table()).includes('| - | - |'), await table());

  await page.evaluate(() => window.astrolabe.fs.testMenuChoice('table'));
  await cell('1').click({ button: 'right' });
  await page.waitForTimeout(400);
  ok('Delete Table removes it', (await table()) === '' && (await text()).includes('After.'), JSON.stringify(await text()));
  ok('the rest of the note is untouched', (await text()).startsWith('# Grid\n'));
  await shot('tables-3-gone');
}
