// The counter in the bottom right corner of a note or a text file: its words, the rest on a click, the selection's
// share while something is selected, the same numbers raw and rendered, and nothing at all on code.
import fs from 'node:fs';
import path from 'node:path';
export default async function ({ page, shot, type, work }) {
  const chip = () => page.evaluate(() => document.querySelector('.counts-chip')?.textContent ?? null);
  const pop = () => page.evaluate(() => { const p = document.querySelector('.counts-pop'); return p ? [...p.children].map((c) => c.textContent).join(' | ') : null; });
  const focus = () => page.evaluate(() => { const el = document.activeElement; return el?.closest('.rich') ? 'rendered note' : el?.closest('.monaco-editor') ? 'raw editor' : el?.tagName; });
  const open = async (p) => { await page.evaluate((f) => window.__store.getState().openFile(f), p); await page.waitForTimeout(1200); };
  fs.writeFileSync(path.join(work, 'plain.txt'), 'Two words\n\n**three** more here\n');

  await open(`${work}/notes/plan.md`);
  console.log('note, rendered:', await chip(), '(want 27 words)');
  const box = await page.evaluate(() => { const c = document.querySelector('.counts-chip').getBoundingClientRect(); const p = document.querySelector('.editor-pane').getBoundingClientRect(); return { right: Math.round(p.right - c.right), bottom: Math.round(p.bottom - c.bottom) }; });
  console.log('from the corner:', JSON.stringify(box));
  await shot('wc-1-corner');
  await page.click('.rich p'); await page.waitForTimeout(200);
  await page.click('.counts-chip'); await page.waitForTimeout(300);
  console.log('opened:', await pop(), '(want 27 / 121 / 104 / 10 paragraphs)');
  console.log('keyboard still in:', await focus());
  await shot('wc-2-open');
  await page.keyboard.press('Meta+ArrowDown'); await page.keyboard.press('Enter');
  await type('three more words'); await page.waitForTimeout(400);
  console.log('after typing 3 words with it open:', await chip(), '|', await pop());
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  console.log('Esc closes it:', (await pop()) === null, '| keyboard in:', await focus());
  await page.keyboard.press('Meta+a'); await page.waitForTimeout(300);
  console.log('all selected, rendered:', await chip(), '(want 30 of 30)');
  await page.click('.counts-chip'); await page.waitForTimeout(300);
  console.log('opened with a selection:', await pop());
  await shot('wc-3-selection');
  await page.click('.rich p'); await page.waitForTimeout(300);
  console.log('a click elsewhere closes it:', (await pop()) === null, '| chip:', await chip());

  await page.keyboard.press('Meta+Shift+r'); await page.waitForTimeout(800);
  console.log('note, raw:', await chip());
  await page.evaluate(() => { const ed = window.__monaco.editor.getEditors().find((e) => e.getModel()?.uri.path.endsWith('plan.md')); ed.setSelection(new window.__monaco.Range(3, 1, 3, 200)); ed.focus(); });
  await page.waitForTimeout(300);
  console.log('line 3 selected, raw:', await chip(), '(want 8 of 30)');
  await page.click('.counts-chip'); await page.waitForTimeout(300);
  console.log('opened:', await pop(), '| keyboard in:', await focus());
  await shot('wc-4-raw');
  await page.keyboard.press('Escape');

  await open(`${work}/plain.txt`);
  console.log('text file:', await chip(), '(want 5 words)');
  await page.click('.counts-chip'); await page.waitForTimeout(300);
  console.log('opened:', await pop(), '(its * are counted: 28 characters)');
  await page.keyboard.press('Escape');
  await open(`${work}/main.py`);
  console.log('code has none:', (await chip()) === null);
  await open(`${work}/notes/plan.md`);
  console.log('back on the note:', await chip());
}
