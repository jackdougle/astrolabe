// The file navigator narrows to 85px, then hides when dragged further.
export default async function ({ page, shot }) {
  await page.keyboard.press('Meta+b');
  await page.waitForTimeout(600);
  const width = () => page.evaluate(() => document.querySelector('.sidebar')?.getBoundingClientRect().width ?? null);
  const h = await (await page.$('.sidebar-resize')).boundingBox();
  const x0 = h.x + h.width / 2; const y = h.y + 300;
  await page.mouse.move(x0, y); await page.mouse.down();
  for (const dx of [-60, -120, -155]) { await page.mouse.move(x0 + dx, y, { steps: 5 }); await page.waitForTimeout(150); console.log(`dragged ${dx}: width`, await width()); }
  await shot('narrow-85');
  await page.mouse.move(x0 - 215, y, { steps: 5 }); await page.waitForTimeout(150);
  console.log('dragged -215: width', await width());
  await page.mouse.move(x0 - 120, y, { steps: 5 }); await page.waitForTimeout(150);
  console.log('dragged back to -120: width', await width());
  await page.mouse.up();
}
