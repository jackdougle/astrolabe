// Updating a packaged copy: no notice shows when nothing changed; after TOUCH (a file under electron/ or
// build/) the notice in the corner offers Relaunch, which rebuilds, and the app quits to relaunch. A change under src/
// alone reloads in place instead: see hotreload.mjs and updatenotice.mjs.
import fs from 'node:fs';
export default async function ({ page, app }) {
  const toast = () => page.evaluate(() => document.querySelector('.toast')?.textContent ?? null);
  await page.waitForTimeout(3200);
  console.log('unchanged source:', await page.evaluate(() => window.astrolabe.app.checkUpdate()), '| notice:', JSON.stringify(await page.evaluate(() => document.querySelector('.update-notice')?.textContent ?? null)));
  const marker = process.env.TOUCH;
  const now = new Date(); fs.utimesSync(marker, now, now);
  await page.waitForSelector('.update-notice', { timeout: 8000 });
  console.log('notice:', JSON.stringify(await page.evaluate(() => document.querySelector('.update-notice')?.textContent ?? null)));
  const closed = new Promise((r) => app.process().once('exit', () => r('exited')));
  await page.click('.update-go');
  // The main process builds in well under a second, so the app may already be on its way out.
  console.log('after touching source:', JSON.stringify(await page.waitForTimeout(400).then(toast).catch(() => 'already quitting')));
  console.log('app:', await Promise.race([closed, new Promise((r) => setTimeout(() => r('still running after 240s'), 240000))]));
}
