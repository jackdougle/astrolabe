// The update notice: nothing shows while this copy matches its source folder, and ⌘R does nothing. Once a file
// under src/ is newer, a notice appears at the top middle of the window. Its Reload button builds the interface into the running copy and
// reloads the window where it stands, after which the notice is gone; closing it puts it away instead.
// Only a source file's timestamp is touched, so this is safe to run in the real folder.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

export default async function ({ page, shot }) {
  const ok = (name, pass, detail = '') => console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  const notice = () => page.evaluate(() => document.querySelector('.update-notice')?.textContent ?? null);
  const toast = () => page.evaluate(() => document.querySelector('.toast')?.textContent ?? null);
  const touch = () => { const f = path.join(root, 'src', 'main.tsx'); const now = new Date(); fs.utimesSync(f, now, now); };

  await page.waitForTimeout(3200);
  ok('no notice while up to date', (await notice()) === null, String(await notice()));
  await page.keyboard.press('Meta+r');
  await page.waitForTimeout(700);
  ok('⌘R does nothing', (await toast()) === null && (await notice()) === null, String(await toast()));

  touch();
  await page.waitForSelector('.update-notice', { timeout: 8000 }).catch(() => {});
  ok('notice after a change to the interface', (await notice()) === 'Astrolabe has been updatedReload', String(await notice()));
  await page.waitForTimeout(300);
  const box = await page.evaluate(() => {
    const r = document.querySelector('.update-notice')?.getBoundingClientRect();
    const bar = document.querySelector('.topbar')?.getBoundingClientRect();
    return r && bar ? { offCentre: Math.round((r.left + r.right) / 2 - innerWidth / 2), underBar: Math.round(r.top - bar.bottom) } : null;
  });
  ok('it sits at the top middle, just under the tab row', !!box && Math.abs(box.offCentre) <= 1 && box.underBar >= 0 && box.underBar < 20, JSON.stringify(box));
  await page.hover('.update-go');
  await page.waitForTimeout(1200);
  ok('hovering Reload shows no tooltip', (await page.evaluate(() => document.querySelector('.tooltip')?.textContent ?? null)) === null);
  await shot('updatenotice');

  await page.evaluate(() => { window.__old = true; });
  await page.click('.update-go');
  await page.waitForFunction(() => !window.__old && window.__store?.getState().ready && document.querySelector('.term-host .xterm'), null, { timeout: 60000 }).catch(() => console.log('!! the window never reloaded'));
  await page.waitForTimeout(250);
  ok('nothing is announced after the reload', (await toast()) === null, String(await toast()));
  await page.waitForTimeout(3200);
  ok('Reload updates the window and the notice goes', (await page.evaluate(() => !window.__old)) && (await notice()) === null, String(await notice()));
  ok('up to date afterwards', (await page.evaluate(() => window.astrolabe.app.checkUpdate())) === 'current');

  // The next change brings the notice back, and closing it puts it away.
  touch();
  await page.waitForSelector('.update-notice', { timeout: 8000 }).catch(() => {});
  ok('offered again after the next change', (await notice()) !== null);
  await page.click('.update-x');
  await page.waitForTimeout(3200);
  ok('closing puts it away', (await notice()) === null);
}
