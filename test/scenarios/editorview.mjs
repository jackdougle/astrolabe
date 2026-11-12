// ⌃⌘F or the expand button (top right) makes the editor fill the tab and back; the editor can swap sides with the terminals;
// rendered notes show the file name as a title; full screen keeps focused opacity when the app loses focus.
export default async function ({ page, shot, work }) {
  const rects = () => page.evaluate(() => [...document.querySelectorAll('.pane')].map((p) => {
    const r = p.getBoundingClientRect();
    return `${p.querySelector('.editor-pane') ? 'editor' : 'term'}@${Math.round(r.x)}w${Math.round(r.width)}${getComputedStyle(p).visibility === 'hidden' ? '(hidden)' : ''}`;
  }).join(' '));
  await page.evaluate((p) => window.__store?.getState?.().openFile?.(p), `${work}/notes/plan.md`);
  if (!(await page.$('.editor-pane'))) {
    await page.keyboard.press('Meta+p'); await page.keyboard.type('plan.md', { delay: 10 }); await page.keyboard.press('Enter');
  }
  await page.waitForSelector('.editor-pane'); await page.waitForTimeout(900);
  console.log('opened:', await rects());
  console.log('title:', JSON.stringify(await page.evaluate(() => document.querySelector('.rich-title')?.textContent)),
    'style:', await page.evaluate(() => { const c = getComputedStyle(document.querySelector('.rich-title')); const h = document.querySelector('.rich h1'); return `${c.fontWeight} ${c.fontSize} vs h1 ${h ? getComputedStyle(h).fontWeight + ' ' + getComputedStyle(h).fontSize : '-'}`; }));
  await shot('ev-1-opened');
  await page.keyboard.press('Control+Meta+f'); await page.waitForTimeout(700);
  console.log('after ⌃⌘F:', await rects());
  await shot('ev-2-expanded');
  await page.keyboard.press('Control+Meta+f'); await page.waitForTimeout(700);
  console.log('after ⌃⌘F again:', await rects());
  await page.click('.view-full'); await page.waitForTimeout(700);
  console.log('after expand button:', await rects());
  await page.click('.view-full'); await page.waitForTimeout(700);
  console.log('after button again:', await rects());
  await page.click('.view-tools [data-tip="Switch displays"]'); await page.waitForTimeout(700);
  console.log('after swap button:', await rects());
  await shot('ev-3-swapped');
  await page.keyboard.press('Control+Meta+ArrowRight'); await page.waitForTimeout(700);
  console.log('after ⌃⌘→:', await rects());
  await page.keyboard.press('Control+Meta+ArrowLeft'); await page.waitForTimeout(700);
  console.log('after ⌃⌘←:', await rects());
  // A new tab's editor opens on the side chosen last (left).
  await page.keyboard.press('Meta+Shift+t'); await page.waitForTimeout(1200);
  await page.keyboard.press('Meta+p'); await page.waitForTimeout(800); await page.keyboard.type('main.py', { delay: 30 }); await page.waitForTimeout(800); await page.keyboard.press('Enter'); await page.waitForTimeout(1200);
  console.log('new tab editor:', await rects(), 'title visible on code:', await page.evaluate(() => { const t = document.querySelector('.tab-area.is-active .rich-title'); return !!t && t.offsetParent !== null; }));
  // Full screen: losing focus keeps the focused tint.
  const alpha = () => page.evaluate(() => getComputedStyle(document.querySelector('.app')).getPropertyValue('--alpha').trim() + ' bg ' + getComputedStyle(document.querySelector('.app')).backgroundColor);
  await page.evaluate(() => document.body.classList.add('is-blurred'));
  console.log('windowed, blurred:', await alpha());
  await page.evaluate(() => document.querySelector('.app').classList.add('is-fullscreen'));
  await page.waitForTimeout(500);
  console.log('full screen, blurred:', await alpha());
}
