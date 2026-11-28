// Pop-ups fade in and out over 200 ms; and Backspace after a heading's "### " takes the space, not a #.
import fs from 'node:fs';
import path from 'node:path';
export const settings = { zoom: 1 };
export default async function ({ page, run, type, work }) {
  const file = path.join(work, 'notes', 'pop.md');
  fs.writeFileSync(file, 'Words here.\n');
  await run(`cd ${work}`);
  await page.evaluate((f) => window.__store.getState().openFile(f, null, { keep: true }), file);
  await page.waitForSelector('.rich p'); await page.waitForTimeout(900);
  let fails = 0;
  const ok = (name, pass, extra = '') => { if (!pass) fails += 1; console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };
  const state = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].map((e) => ({ ghost: e.classList.contains('is-ghost'), o: +(+getComputedStyle(e).opacity).toFixed(2) })), sel);
  const pop = async (name, sel, open, close) => {
    await open(); await page.waitForTimeout(60); const a = await state(sel);
    await page.waitForTimeout(350); const b = await state(sel);
    await close(); await page.waitForTimeout(70); const c = await state(sel);
    await page.waitForTimeout(350); const d = await state(sel);
    ok(`${name} fades in, then out, then is gone`, a.length === 1 && a[0].o < 1 && b[0]?.o === 1 && c.length === 1 && c[0].ghost && c[0].o > 0 && c[0].o < 1 && !d.length, JSON.stringify([a, b, c, d]));
  };
  await page.click('.rich p');
  await pop('find bar', '.findbar', () => page.keyboard.press('Meta+f'), () => page.keyboard.press('Escape'));
  await pop('palette', '.palette-scrim', () => page.keyboard.press('Meta+p'), () => page.keyboard.press('Escape'));
  await pop('toast', '.toast', () => page.evaluate(() => window.__store.getState().showToast('Saved', 600)), () => page.waitForTimeout(210));
  await pop('word count', '.counts-pop', () => page.click('.counts-chip'), () => page.click('.counts-chip'));
  await page.click('.rich p'); await page.keyboard.press('Meta+ArrowRight'); await page.keyboard.press('Enter');
  await type('## '); await page.waitForTimeout(300); await page.keyboard.press('Backspace'); await page.waitForTimeout(300);
  const last = await page.evaluate(() => { const e = document.querySelector('.rich').lastElementChild; return `${e.tagName} ${e.textContent}`; });
  ok('"## " then Backspace leaves "##"', last === 'P ##', last);
  console.log(fails ? `${fails} FAILED` : 'all ok');
}
