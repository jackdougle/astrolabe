// Typing in a rendered note is written to the file's text a few characters at a time (only what differs), and the
// text is always exactly what the note says: paragraphs, list items, nested items, new lines, characters made of
// two halves, and a file with Windows line endings.
import fs from 'node:fs';
import path from 'node:path';

export const settings = { zoom: 1, previewTabs: false };
export default async function ({ page, work, logs }) {
  const ok = (name, pass, detail = '') => console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  const at = (ms) => page.waitForTimeout(ms);
  const open = async (file) => { await page.evaluate((file) => window.__store.getState().openFile(file, null, { keep: true }), file); await at(1300); };
  const text = (file) => page.evaluate((file) => window.__monaco.editor.getModels().find((m) => m.uri.path === file).getValue(), file);
  const endOf = async (sel) => { await page.click(sel); await page.keyboard.press('End'); };

  const file = path.join(work, 'notes', 'typed.md');
  fs.writeFileSync(file, '# Title\n\nAlpha beta gamma.\n\n- one\n- two\n  - deep\n- three\n\nOmega 😀 end.\n');
  await open(file);
  await endOf('.rich p >> nth=0'); await page.keyboard.type(' delta', { delay: 5 }); await at(450);
  ok('typing at the end of a paragraph', (await text(file)) === '# Title\n\nAlpha beta gamma. delta\n\n- one\n- two\n  - deep\n- three\n\nOmega 😀 end.\n', JSON.stringify(await text(file)));
  await page.click('.rich p >> nth=0'); await page.keyboard.press('Home'); await page.keyboard.type('Zero ', { delay: 5 }); await at(450);
  ok('typing at its start', (await text(file)).split('\n')[2] === 'Zero Alpha beta gamma. delta', JSON.stringify((await text(file)).split('\n')[2]));
  await endOf('.rich li li p'); await page.keyboard.type('er', { delay: 5 }); await at(450);
  ok('typing in a nested list item changes only that line', (await text(file)) === '# Title\n\nZero Alpha beta gamma. delta\n\n- one\n- two\n  - deeper\n- three\n\nOmega 😀 end.\n', JSON.stringify(await text(file)));
  await endOf('.rich li p:text-is("three")'); await page.keyboard.press('Enter'); await page.keyboard.type('four', { delay: 5 }); await at(450);
  ok('a new list item', (await text(file)).includes('- three\n- four\n'), JSON.stringify(await text(file)));
  await endOf('.rich > p:last-of-type'); await page.keyboard.insertText('👍'); await at(450);
  ok('characters made of two halves stay whole', (await text(file)).includes('Omega 😀 end.👍\n'), JSON.stringify((await text(file)).slice(-30)));
  await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace'); await at(450);
  ok('and are deleted whole', (await text(file)).includes('Omega 😀 end\n') || (await text(file)).endsWith('Omega 😀 end\n'), JSON.stringify((await text(file)).slice(-30)));
  await page.keyboard.press('Meta+s'); await at(600);
  ok('the saved file is the text', fs.readFileSync(file, 'utf8') === (await text(file)));

  const win = path.join(work, 'notes', 'windows.md');
  fs.writeFileSync(win, 'First line.\r\n\r\nSecond line.\r\n\r\n- a\r\n- b\r\n');
  await open(win);
  await endOf('.rich p >> nth=1'); await page.keyboard.type(' More', { delay: 5 }); await at(450);
  await endOf('.rich li:last-child p'); await page.keyboard.type('!', { delay: 5 }); await at(450);
  ok('Windows line endings are kept', (await text(win)) === 'First line.\r\n\r\nSecond line. More\r\n\r\n- a\r\n- b!\r\n', JSON.stringify(await text(win)));
  ok('the bridge never had to fall back to writing the whole text', !logs.some((l) => l.includes('bridge:')), logs.filter((l) => l.includes('bridge:')).join(' | '));
}
