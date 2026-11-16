// "\[name]\(<address>)" in a file shows in the rendered view as the name, linked; the file is left as written until
// that block is edited, and then holds an ordinary link. A paste that lands in the same shape is put right too.
import fs from 'node:fs';
import path from 'node:path';
export default async function ({ page, type, work, shot }) {
  const file = path.join(work, 'notes', 'people.md');
  const src = [
    '# People', '',
    '- - \\[Charles Fracchia]\\(<https://www.linkedin.com/in/charlesfracchia/>)',
    '- plain \\[Ada Lovelace]\\(https://example.com/ada) after',
    '- a real [link](https://example.com/real) stays',
    '- a picture is not one: !\\[alt]\\(<https://example.com/pic.png>)',
    '- nor words in brackets (see <https://example.com/bare>) alone',
    '- `\\[code]\\(<https://example.com/code>)` in code', '',
  ].join('\n');
  fs.writeFileSync(file, src);
  await page.evaluate((f) => window.__store.getState().openFile(f, null, { keep: true }), file);
  await page.waitForSelector('.rich a', { timeout: 10000 }); await page.waitForTimeout(800);
  const links = () => page.evaluate(() => [...document.querySelectorAll('.rich a')].map((a) => `${a.textContent} → ${a.getAttribute('href')}`));
  const text = () => page.evaluate(() => [...document.querySelectorAll('.rich li p, .rich > p')].map((p) => p.textContent));
  console.log('1 links:', JSON.stringify(await links(), null, 1));
  console.log('1 lines:', JSON.stringify(await text()));
  console.log('1 file untouched:', fs.readFileSync(file, 'utf8') === src, '| unsaved marks:', await page.evaluate(() => Object.values(window.__store.getState().dirty).filter(Boolean).length));
  await shot('collapselink');

  // edit the first line and save: it is written as an ordinary link
  await page.click('.rich a:has-text("Charles Fracchia")'); await page.waitForTimeout(300);
  await page.keyboard.press('Escape'); await page.keyboard.press('End'); await page.waitForTimeout(250);
  await type(' (BioBolt)'); await page.waitForTimeout(400);
  await page.keyboard.press('Meta+s'); await page.waitForTimeout(700);
  // the whole list is one block, so all of it is written again: links as links, the rest as it was
  console.log('2 on disk after the edit:\n' + fs.readFileSync(file, 'utf8'));

  // a paste of formatted text in the same shape
  await page.keyboard.press('Meta+ArrowDown'); await page.waitForTimeout(250);
  await page.keyboard.press('Enter'); await page.waitForTimeout(250);
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/html', '<p>[Grace Hopper](<a href="https://example.com/grace">https://example.com/grace</a>)</p>');
    dt.setData('text/plain', '[Grace Hopper](https://example.com/grace)');
    document.querySelector('.rich').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(600);
  console.log('3 after paste, links:', JSON.stringify((await links()).filter((l) => l.includes('Grace'))), '| literal left:', (await text()).some((t) => t.includes('[Grace')));
  await page.keyboard.press('Meta+s'); await page.waitForTimeout(700);
  console.log('3 on disk:', JSON.stringify(fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.includes('Grace'))));
}
