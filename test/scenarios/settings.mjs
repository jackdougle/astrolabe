// The gear in the navigator's footer opens Settings; Escape steps back a level.
export default async function ({ page, shot, run, work }) {
  await run(`cd ${work}`);
  await page.keyboard.press('Meta+b');
  await page.waitForTimeout(600);
  const size = await page.evaluate(() => getComputedStyle(document.querySelector('.sidebar .tree-name') ?? document.querySelector('.sidebar')).fontSize);
  console.log('navigator font', size);
  const footer = await page.evaluate(() => [...document.querySelectorAll('.side-foot button')].map((b) => b.getBoundingClientRect().left));
  console.log('footer buttons left edges', JSON.stringify(footer.map(Math.round)));
  await page.click('.side-foot .side-settings');
  await page.waitForTimeout(300);
  console.log('settings rows', await page.evaluate(() => [...document.querySelectorAll('.palette-row')].map((r) => r.textContent)));
  await shot('settings-menu');
  await page.click('.palette-row:has-text("Fonts")');
  await page.waitForTimeout(250);
  const navigatorSize = page.getByRole('spinbutton', { name: 'Navigator size in pixels' });
  await navigatorSize.fill('14');
  await navigatorSize.press('Enter');
  await page.waitForTimeout(250);
  console.log('navigator after 14px', await page.evaluate(() => getComputedStyle(document.querySelector('.sidebar')).fontSize));
  console.log('palette still open', await page.evaluate(() => !!document.querySelector('.palette')));
  await shot('settings-sizes');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  console.log('after Escape', await page.evaluate(() => document.querySelector('.palette input')?.placeholder));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  console.log('palette closed', await page.evaluate(() => !document.querySelector('.palette')));
  await page.click('.side-foot .side-settings');
  await page.waitForTimeout(250);
  await page.click('.palette-row:has-text("Appearance and themes")');
  await page.waitForTimeout(250);
  await page.click('.palette-row:has-text("Starfield")');
  await page.waitForTimeout(200);
  console.log('starfield row', await page.evaluate(() => [...document.querySelectorAll('.palette-row')].find((row) => row.textContent.includes('Starfield'))?.textContent));
  await shot('settings-appearance');
}
