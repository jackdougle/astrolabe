import fs from 'node:fs';
import path from 'node:path';
export default async function ({ page, shot, run, type, state, work }) {
  const modelText = () => page.evaluate(() => window.__monaco.editor.getModels().find((m) => m.uri.path.endsWith('plan.md'))?.getValue());
  await run(`cd ${work}`);
  await page.keyboard.press('Meta+p');
  await page.waitForTimeout(400);
  await type('plan');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  await shot('30-rich');
  console.log('focus after open:', JSON.stringify((await state()).active));
  const before = await modelText();
  // Edit in rendered mode: add a bullet after "second item", nest it, move it up.
  await page.click('.rich li:has-text("second item")');
  await page.keyboard.press('Meta+ArrowRight');
  await page.keyboard.press('Enter');
  await type('third item');
  await page.keyboard.press('Enter');
  await type('nested child');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(500);
  await shot('31-rich-edited');
  const after = await modelText();
  console.log('--- model after rendered edits ---\n' + after);
  console.log('wiki links intact:', after.includes('[[Some Note]]') && after.includes('![[diagram.png]]'));
  await page.keyboard.press('Alt+ArrowUp');
  await page.waitForTimeout(300);
  console.log('after Alt+Up list:', JSON.stringify((await modelText()).split('\n').filter((l) => /item|child/.test(l))));
  // Raw mode list continuation.
  await page.keyboard.press('Meta+e');
  await page.waitForTimeout(700);
  await page.evaluate(() => { const ed = window.__monaco.editor.getEditors().find((e) => e.getModel()?.uri.path.endsWith('plan.md')); const m = ed.getModel(); const ln = m.getLinesContent().findIndex((l) => /^2[.)] two/.test(l)) + 1; ed.setPosition({ lineNumber: ln, column: m.getLineMaxColumn(ln) }); ed.focus(); });
  await page.keyboard.press('Enter');
  await type('three');
  await page.keyboard.press('Enter');
  await type('sub');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await type('after list');
  await page.waitForTimeout(300);
  console.log('raw list:', JSON.stringify((await modelText()).split('\n').filter((l) => /one|two|three|sub|after/.test(l))));
  // Alt+Up in raw moves the line; Cmd+X with no selection cuts the line.
  await page.keyboard.press('Alt+ArrowUp');
  const cut = await page.evaluate(() => { const ed = window.__monaco.editor.getEditors().find((e) => e.hasTextFocus()); const n = ed.getModel().getLineCount(); ed.trigger('test', 'editor.action.clipboardCutAction', {}); return [n, ed.getModel().getLineCount()]; });
  console.log('lines before/after cut with empty selection:', JSON.stringify(cut));
  await shot('32-raw-lists');
  // Cmd+T in the editor makes a note beside the file.
  await page.keyboard.press('Meta+t');
  await page.waitForTimeout(1200);
  console.log('notes dir:', JSON.stringify(fs.readdirSync(path.join(work, 'notes'))));
  await type('Hello ');
  await type('- a bullet');
  await shot('33-new-note');
  console.log('untitled on disk before save:', JSON.stringify(fs.readFileSync(path.join(work, 'notes', 'Untitled.md'), 'utf8')));
  await page.keyboard.press('Meta+s');
  await page.waitForTimeout(500);
  console.log('untitled on disk after save:', JSON.stringify(fs.readFileSync(path.join(work, 'notes', 'Untitled.md'), 'utf8')));
  // Google Fonts.
  await page.keyboard.press('Meta+Shift+p');
  await type('notes font');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  await type('Lora');
  await page.waitForTimeout(1500);
  await shot('34-fonts');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  console.log('notes font:', await page.evaluate(() => [getComputedStyle(document.documentElement).getPropertyValue('--notes'), document.fonts.check('400 14px "Lora"'), document.querySelectorAll('.palette-row').length]));
  await page.keyboard.press('Meta+1');
  await shot('35-lora');
}
