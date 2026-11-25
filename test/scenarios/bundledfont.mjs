// A font that ships with the app is used for notes without a request to Google Fonts, and leads the picker.
export const settings = { notesFont: 'Atkinson Hyperlegible Next' };
export default async function ({ page, shot, run, work }) {
  await run(`cd ${work}`);
  await page.keyboard.press('Meta+b');
  await page.waitForTimeout(500);
  await page.click('.treerow:has-text("notes")');
  await page.waitForTimeout(300);
  await page.click('.treerow:has-text("plan.md")');
  await page.waitForTimeout(1300);
  console.log('note', JSON.stringify(await page.evaluate(() => {
    const p = getComputedStyle(document.querySelector('.rich p'));
    const face = p.fontFamily.split(',')[0];
    const width = (font) => { const c = document.createElement('canvas').getContext('2d'); c.font = font; return c.measureText('Illegible 0O1l').width; };
    return {
      face, weight: p.fontWeight,
      loaded: document.fonts.check(`500 14px ${face}`), italic: document.fonts.check(`italic 500 14px ${face}`),
      differsFromSystem: width(`500 14px ${face}`) !== width('500 14px -apple-system'),
      fetched: [...document.querySelectorAll('link[rel=stylesheet]')].filter((l) => l.href.includes('fonts.googleapis.com')).length,
    };
  })));
  await shot('bundledfont-note');
  await page.click('.side-foot .side-settings');
  await page.waitForTimeout(250);
  await page.click('.palette-row:has-text("Fonts")');
  await page.waitForTimeout(250);
  console.log('fonts row', await page.evaluate(() => [...document.querySelectorAll('.palette-row')].find((r) => r.textContent.includes('Notes text font'))?.textContent));
  await page.click('.palette-row:has-text("Notes text font")');
  await page.waitForTimeout(1200);
  console.log('picker', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.palette-row')].slice(0, 3).map((r) => [r.textContent, getComputedStyle(r.querySelector('.palette-label')).fontFamily.split(',')[0]]))));
  console.log('listed once', await page.evaluate(() => [...document.querySelectorAll('.palette-label')].filter((l) => l.textContent === 'Atkinson Hyperlegible Next').length));
  await shot('bundledfont-picker');
}
