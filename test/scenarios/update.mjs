// ⌘R outside the editor, in a packaged copy: says "up to date" when nothing changed; after TOUCH (a file under electron/ or
// build/) it rebuilds and the app quits to relaunch. A change under src/ alone reloads in place instead: see hotreload.mjs.
import fs from 'node:fs';
export default async function ({ page, app }) {
  const toast = () => page.evaluate(() => document.querySelector('.toast')?.textContent ?? null);
  await page.keyboard.press('Meta+r');
  await page.waitForTimeout(1200);
  console.log('unchanged source:', JSON.stringify(await toast()));
  const marker = process.env.TOUCH;
  const now = new Date(); fs.utimesSync(marker, now, now);
  await page.waitForTimeout(1900);
  const closed = new Promise((r) => app.process().once('exit', () => r('exited')));
  await page.keyboard.press('Meta+r');
  // The main process builds in well under a second, so the app may already be on its way out.
  console.log('after touching source:', JSON.stringify(await page.waitForTimeout(400).then(toast).catch(() => 'already quitting')));
  console.log('app:', await Promise.race([closed, new Promise((r) => setTimeout(() => r('still running after 240s'), 240000))]));
}
