// Typing before a new tab's shell is ready lands in the command input; Tab completes grey text with no menu.
export default async function ({ page, shot, run, type, work }) {
  const input = () => page.evaluate(() => [...document.querySelectorAll('.cmd-input')].map((e) => `${e.classList.contains('is-hidden') ? 'hidden' : 'shown'}:${JSON.stringify(e.querySelector('.view-lines')?.textContent)}`));
  const menu = () => page.evaluate(() => [...document.querySelectorAll('.suggest-widget')].some((w) => w.offsetParent && getComputedStyle(w).visibility !== 'hidden' && w.classList.contains('visible')));
  await page.keyboard.press('Meta+t');
  await page.keyboard.type('echo typed-early', { delay: 5 });
  await page.waitForTimeout(2500);
  console.log('new tab, typed at once:', JSON.stringify(await input()));
  await shot('early-1-typed');
  const rows = () => page.evaluate(() => { const s = [...window.__sessions.values()].at(-1); const b = s.term.buffer.normal; const out = []; for (let y = 0; y < b.length; y++) { const t = b.getLine(y).translateToString(true); if (t.trim()) out.push(t.trim().slice(0, 60)); } return out; });
  console.log('screen:', JSON.stringify(await rows()));
  await page.keyboard.press('Meta+t');
  await page.keyboard.type('echo ran-early', { delay: 5 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  console.log('typed + Enter at once:', JSON.stringify(await rows()));
  await shot('early-2-ran');

  await run(`cd ${work}`);
  await type('cat no');
  await page.waitForTimeout(600);
  await shot('early-3-ghost');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(400);
  console.log('after Tab on "cat no":', JSON.stringify(await input()), 'menu open:', await menu());
  await page.keyboard.press('Tab');
  await page.waitForTimeout(400);
  console.log('after 2nd Tab:', JSON.stringify(await input()), 'menu open:', await menu());
  await shot('early-4-completed');
  // fast Tab before the grey text appears
  await page.keyboard.press('Control+u');
  await type('ls ma');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(400);
  console.log('quick Tab on "ls ma":', JSON.stringify(await input()), 'menu open:', await menu());
}
