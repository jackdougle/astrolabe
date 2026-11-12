export default async function ({ page, shot, run, type, work }) {
  await run(`cd ${work}`);
  await page.keyboard.press('Meta+b');
  await page.waitForTimeout(500);
  await page.click('.treerow:has-text("notes")');
  await page.waitForTimeout(300);
  await page.click('.treerow:has-text("plan.md")');
  await page.waitForTimeout(1300);
  const fam = (sel) => page.evaluate((q) => { const el = document.querySelector(q); return el ? getComputedStyle(el).fontFamily.split(',')[0] : null; }, sel);
  console.log(JSON.stringify({ tree: await fam('.treerow'), sideTitle: await fam('.side-title'), tab: await fam('.toptab'), fileTab: await fam('.filetab'), toggle: await fam('.seg button'), rendered: await fam('.rich p'), crumbs: await page.evaluate(() => !!document.querySelector('.crumbs')) }));
  console.log('notes:', JSON.stringify(await page.evaluate(() => { const h = getComputedStyle(document.querySelector('.rich h1')); const b = getComputedStyle(document.querySelector('.rich p')); return { heading: h.fontFamily.split(',')[0], headingWeight: h.fontWeight, loraLoaded: document.fonts.check('700 20px "Lora"'), text: b.fontFamily.split(',')[0], textWeight: b.fontWeight }; })));
  await shot('70-mono');
}
