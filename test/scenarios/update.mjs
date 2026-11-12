// ⌘R outside the editor: says "up to date" when nothing changed; rebuilds and swaps the app when the source did.
import fs from 'node:fs';
export default async function ({ page, app }) {
  const toast = () => page.evaluate(() => document.querySelector('.toast')?.textContent ?? null);
  await page.keyboard.press('Meta+r');
  await page.waitForTimeout(1200);
  console.log('unchanged source:', JSON.stringify(await toast()));
  const marker = process.env.TOUCH;
  const now = new Date(); fs.utimesSync(marker, now, now);
  await page.waitForTimeout(1900);
  await page.keyboard.press('Meta+r');
  await page.waitForTimeout(1500);
  console.log('after touching source:', JSON.stringify(await toast()));
  const closed = new Promise((r) => app.process().once('exit', () => r('exited')));
  console.log('app:', await Promise.race([closed, new Promise((r) => setTimeout(() => r('still running after 240s'), 240000))]));
}
