// Raw Markdown: numbered items keep counting on from the item above when lines are indented, outdented or added,
// and * _ ~ typed over a selection go around it.
import fs from 'node:fs';
import path from 'node:path';
export default async function ({ page, type, run, work, shot }) {
  fs.writeFileSync(path.join(work, 'notes', 'raw.md'), ['1. a', '2. b', '3. c', '4. d', '5. e', '', 'Some words here.', ''].join('\n'));
  await run(`cd ${work}`);
  await page.keyboard.press('Meta+p');
  await page.waitForTimeout(400);
  await type('raw.md');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  await page.keyboard.press('Meta+Shift+r');
  await page.waitForTimeout(600);
  const text = () => page.evaluate(() => window.__monaco.editor.getModels().find((m) => m.uri.path.endsWith('raw.md'))?.getValue());
  const list = async () => JSON.stringify((await text()).split('\n').filter((l) => /^\s*\d/.test(l)));
  const caret = (ln, col = 99) => page.evaluate(([l, c]) => { const ed = window.__monaco.editor.getEditors().find((e) => e.getModel()?.uri.path.endsWith('raw.md')); ed.setPosition({ lineNumber: l, column: Math.min(c, ed.getModel().getLineMaxColumn(l)) }); ed.focus(); }, [ln, col]);
  const select = (ln, a, b) => page.evaluate(([l, x, y]) => { const ed = window.__monaco.editor.getEditors().find((e) => e.getModel()?.uri.path.endsWith('raw.md')); ed.setSelection({ startLineNumber: l, startColumn: x, endLineNumber: l, endColumn: y }); ed.focus(); }, [ln, a, b]);
  const press = async (key) => { await page.keyboard.press(key); await page.waitForTimeout(300); };
  await caret(3); await press('Tab');
  console.log('c indented:', await list());
  await caret(4); await press('Tab');
  console.log('d indented, counts on from c:', await list());
  await caret(3); await press('Shift+Tab');
  console.log('c outdented:', await list());
  await caret(4); await press('Shift+Tab');
  console.log('d outdented:', await list(), '| same as the start:', (await text()).startsWith('1. a\n2. b\n3. c\n4. d\n5. e\n'));
  await caret(2); await press('Enter'); await type('new'); await page.waitForTimeout(300);
  console.log('item added in the middle:', await list());
  await press('Tab');
  console.log('and indented:', await list());
  await select(8, 6, 11); await type('*'); await type('*'); await page.waitForTimeout(300);
  console.log('** around a selection:', JSON.stringify((await text()).split('\n')[7]));
  await select(8, 14, 18); await type('~'); await page.waitForTimeout(200);
  await select(8, 1, 5); await type('_'); await page.waitForTimeout(300);
  console.log('~ and _:', JSON.stringify((await text()).split('\n')[7]));
  await shot('rawlists');
}
