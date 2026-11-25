// The hidden-terminals chip and the word counter turn almost fully see-through while you type right next to them,
// and not while you type a little way off; the chip's text is just "Hidden terminals" and its key; ⇧⌘B puts the
// top bar away and brings it back.
import fs from 'node:fs';
import path from 'node:path';

export const settings = { zoom: 1, previewTabs: false };
export default async function ({ page, work, shot, run }) {
  let fails = 0;
  const ok = (name, pass, detail = '') => { if (!pass) fails += 1; console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail && !pass ? `: ${detail}` : ''}`); };
  const at = (ms) => page.waitForTimeout(ms);
  await page.keyboard.press('Meta+d'); await at(1500);
  await page.keyboard.press('Meta+u'); await at(800);
  ok('the chip is there', await page.isVisible('.hidden-chip'));
  ok('its tip says only "Hidden terminals"', (await page.getAttribute('.hidden-chip', 'data-tip')) === 'Hidden terminals');
  await page.click('.hidden-chip'); await at(300);
  const pop = await page.evaluate(() => document.querySelector('.hidden-pop').innerText);
  ok('the list has no "Bring all back"', !/bring/i.test(pop) && /Hidden terminals/.test(pop), JSON.stringify(pop));
  await page.keyboard.press('Escape'); await at(300);
  // Fill the terminal so its input sits at the bottom, by the chip, then type towards it.
  await run('seq 400', 1200);
  const dist = () => page.evaluate(() => { const c = document.querySelector('.hidden-chip').getBoundingClientRect(); const k = document.querySelector('.cmd-input .cursors-layer .cursor')?.getBoundingClientRect(); return k ? { dx: c.left - k.right, dy: Math.abs((c.top + c.bottom) / 2 - (k.top + k.bottom) / 2) } : null; });
  const clear = () => page.evaluate(() => document.querySelector('.hidden-terms').classList.contains('is-clear'));
  let d = await dist(); let far = null; let n = 0;
  while (d && d.dx > 4 && n < 400) { await page.keyboard.type('x'); n += 1; if (n % 4 === 0) { await at(60); d = await dist(); if (far === null && d.dx < 90 && d.dx > 60) { await at(300); far = await clear(); } } }
  await at(400);
  console.log('caret', JSON.stringify(await dist()));
  ok('typing a little way off leaves it as it is', far === false, String(far));
  ok('typing right next to it turns it to glass', await clear());
  const op = await page.evaluate(() => getComputedStyle(document.querySelector('.hidden-chip')).opacity);
  ok('almost fully see-through', parseFloat(op) <= 0.1, op);
  await shot('glass-chip');
  await page.mouse.move(100, 100); await page.mouse.move(140, 160); await at(500);
  ok('moving the pointer brings it back', !(await clear()));
  // ⇧⌘B
  await page.keyboard.press('Meta+Shift+b'); await at(400);
  ok('⇧⌘B hides the top bar', !(await page.isVisible('.topbar')));
  await shot('glass-notopbar');
  await page.keyboard.press('Meta+Shift+b'); await at(400);
  ok('and brings it back', await page.isVisible('.topbar'));
  console.log(fails ? `${fails} FAILED` : 'all passed');
}
