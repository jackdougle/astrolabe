// How nested lists look in the rendered view, written with the indents people actually type, and typed there.
import fs from 'node:fs';
import path from 'node:path';
export default async function ({ page, type, run, work, shot }) {
  fs.writeFileSync(path.join(work, 'notes', 'lists.md'), [
    '1. one', '2. two', '   1. two-a', '   2. two-b', '      1. two-b-i', '      2. two-b-ii', '3. three', '',
    'Two spaces under a number:', '', '1. x', '  - y', '  1. z', '    1. zz', '  2. z2', '2. w', '  ```sh', '  echo hi', '  ```', '',
    '- [ ] task', '  - [ ] sub task', '- loose one', '', '  - loose child', '', '- loose two', '',
  ].join('\n'));
  await run(`cd ${work}`);
  await page.keyboard.press('Meta+p');
  await page.waitForTimeout(400);
  await type('lists');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  await page.keyboard.press('Control+Meta+f');
  const html = () => page.evaluate(() => document.querySelector('.rich').innerHTML.replace(/ data-(label|spread|list-type)="[^"]*"/g, '').replace(/<br[^>]*>/g, ''));
  const text = () => page.evaluate(() => window.__monaco.editor.getModels().find((m) => m.uri.path.endsWith('lists.md'))?.getValue());
  const h = await html();
  console.log('two spaces under a number nest:', h.includes('<li><p>x</p><ul><li><p>y</p></li></ul><ol><li><p>z</p><ol><li><p>zz</p></li></ol></li><li><p>z2</p></li></ol></li>'), '| code stays in its item:', /<li><p>w<\/p><pre/.test(h));
  console.log('file untouched by opening:', (await text()).includes('\n  - y\n  1. z\n'));
  await shot('nested');
  // Typed in the rendered view: Tab nests under the item above, Shift+Tab comes back out, and the numbers follow.
  await page.click('.rich li:has-text("loose two")');
  await page.waitForTimeout(250);
  await page.keyboard.press('Meta+ArrowDown');
  await page.waitForTimeout(250);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await type('1. alpha');
  await page.keyboard.press('Enter');
  await type('beta');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await type('beta one');
  await page.keyboard.press('Enter');
  await type('beta two');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await type('deep');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await type('gamma');
  await page.waitForTimeout(500);
  const t = await text();
  console.log('typed list:', JSON.stringify(t.slice(t.indexOf('1. alpha'))));
  await page.evaluate(() => { const m = document.querySelector('.markdown'); m.scrollTop = m.scrollHeight; });
  await shot('nested-typed');
}
