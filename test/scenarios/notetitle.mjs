// A rendered note shows its file name (no extension) as an italic title; editing the title renames the file.
import fs from 'node:fs';
export default async function ({ page, run, type, work, shot }) {
  const dir = `${work}/notes`;
  await run(`cd ${work}`);
  await page.keyboard.press('Meta+p'); await page.waitForTimeout(350); await type('plan'); await page.keyboard.press('Enter'); await page.waitForTimeout(1300);
  const title = () => page.evaluate(() => { const e = document.querySelector('.rich-title'); if (!e) return null; const c = getComputedStyle(e); return { text: e.textContent, style: c.fontStyle, family: c.fontFamily.slice(0, 30), size: c.fontSize, color: c.color, beside: !!e.closest('.rich-head.is-beside') }; });
  const focus = () => page.evaluate(() => { const a = document.activeElement; return a?.classList.contains('rich-title') ? 'title' : a?.closest('.ProseMirror') ? 'note' : a?.tagName; });
  const tab = () => page.evaluate(() => document.querySelector('.filetab.is-active .filetab-name')?.textContent);
  const retitle = async (text) => { await page.click('.rich-title'); await page.keyboard.press('Meta+a'); await type(text); };
  console.log('title:', JSON.stringify(await title()), '| h1 colour:', await page.evaluate(() => getComputedStyle(document.querySelector('.rich h1')).color));
  await shot('notetitle');

  await retitle('Grand Plan'); console.log('while editing, focus:', await focus());
  await page.keyboard.press('Enter'); await page.waitForTimeout(1200);
  console.log('after Enter:', fs.readdirSync(dir), '| tab:', await tab(), '| title:', (await title())?.text, '| focus:', await focus());
  await type('typed after rename '); await page.waitForTimeout(500);
  await retitle('Dirty Move'); await page.click('.rich p'); await page.waitForTimeout(1200);
  console.log('after blur with unsaved text:', fs.readdirSync(dir), '| tab:', await tab(), '| unsaved:', await page.evaluate(() => document.querySelectorAll('.filetab-close.is-dirty').length), '| has text:', await page.evaluate(() => document.querySelector('.rich').textContent.includes('typed after rename')));
  await page.keyboard.press('Meta+s'); await page.waitForTimeout(600);
  console.log('saved to new name:', fs.readFileSync(`${dir}/Dirty Move.md`, 'utf8').includes('typed after rename'));

  await retitle('thrown away'); await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  console.log('after Escape:', fs.readdirSync(dir), '| title:', (await title())?.text, '| focus:', await focus());
  await retitle('a/b'); await page.keyboard.press('Enter'); await page.waitForTimeout(700);
  console.log('after a slash:', fs.readdirSync(dir), '| title:', (await title())?.text, '| toast:', await page.evaluate(() => document.querySelector('.toast')?.textContent));
  await retitle(''); await page.keyboard.press('Backspace'); await page.keyboard.press('Enter'); await page.waitForTimeout(500);
  console.log('after emptying:', fs.readdirSync(dir), '| title:', (await title())?.text);

  await page.keyboard.press('Meta+r'); await page.waitForTimeout(600);
  console.log('raw view shows title:', await page.evaluate(() => { const e = document.querySelector('.rich-title'); return !!e && e.offsetParent !== null; }));
}
