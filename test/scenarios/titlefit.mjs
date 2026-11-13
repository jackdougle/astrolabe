// A note's title keeps to one line (a long name is set smaller), and ⌘B shows and hides the navigator from a rendered note.
export default async function ({ page, run, type, work, shot }) {
  await run(`cd ${work}`);
  await page.keyboard.press('Meta+p'); await page.waitForTimeout(350); await type('plan'); await page.keyboard.press('Enter'); await page.waitForTimeout(1300);
  const title = () => page.evaluate(() => { const e = document.querySelector('.rich-title'); const h = e.closest('.rich-head'); const c = getComputedStyle(e); const size = parseFloat(c.fontSize); return { size: Math.round(size * 10) / 10, lines: Math.round(e.offsetHeight / (size * 1.25)), width: e.offsetWidth, room: h.clientWidth, fits: e.scrollWidth <= h.clientWidth, beside: h.classList.contains('is-beside') }; });
  const retitle = async (text) => { await page.click('.rich-title'); await page.keyboard.press('Meta+a'); await type(text); await page.waitForTimeout(400); };
  console.log('short name:', JSON.stringify(await title()));
  await retitle('A considerably longer title for this note'); console.log('long while typing:', JSON.stringify(await title()));
  await shot('titlefit-long');
  await page.keyboard.press('Enter'); await page.waitForTimeout(900); console.log('long after renaming:', JSON.stringify(await title()));
  await retitle('A name so long that even at its smallest size it could never fit on one line of a narrow pane however hard it tried to squeeze itself in'); console.log('far too long:', JSON.stringify(await title()));
  await shot('titlefit-toolong');
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  await retitle('Short'); await page.keyboard.press('Enter'); await page.waitForTimeout(900); console.log('short again:', JSON.stringify(await title()));
  await page.setViewportSize({ width: 760, height: 700 }).catch(() => {});
  // ⌘L from a rendered note opens and closes the navigator; ⌘B there is bold.
  const nav = () => page.evaluate(() => { const s = document.querySelector('.sidebar-slot'); return !!s && s.getBoundingClientRect().width > 40; });
  await page.click('.rich p'); await page.waitForTimeout(300);
  const before = await nav();
  await page.keyboard.press('Meta+l'); await page.waitForTimeout(600); const once = await nav();
  await page.keyboard.press('Meta+l'); await page.waitForTimeout(600); const twice = await nav();
  console.log('⌘L in a rendered note: navigator', before, '->', once, '->', twice);
  const strong = () => page.evaluate(() => [...document.querySelectorAll('.rich p strong')].map((e) => e.textContent));
  const had = await strong();
  await page.keyboard.press('Control+l'); await page.waitForTimeout(250); // the line, selected
  await page.keyboard.press('Meta+b'); await page.waitForTimeout(400);
  console.log('⌘B in a rendered note: navigator stays', await nav(), '| bold before:', JSON.stringify(had), 'after:', JSON.stringify(await strong()));
  await page.keyboard.press('Meta+z'); await page.waitForTimeout(300);
  await page.keyboard.press('Meta+Shift+r'); await page.waitForTimeout(700);
  await page.keyboard.press('Meta+b'); await page.waitForTimeout(600); console.log('⌘B in raw: navigator ->', await nav());
}
