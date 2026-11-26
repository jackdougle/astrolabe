// The built-in themes: Tokyo Night (Night and Day), Pure Black and White, GitHub and GitHub High Contrast,
// each with its light or dark twin on ⌘0, and back to the very theme you left.
import path from 'node:path';
export const settings = { zoom: 1, previewTabs: false, theme: 'tokyo-night' };
const IDS = ['tokyo-night', 'tokyo-day', 'pure-black', 'pure-white', 'github-dark', 'github-light', 'github-dark-hc', 'github-light-hc'];
export default async function ({ page, shot, run, work }) {
  let fails = 0;
  const ok = (name, pass, detail = '') => { if (!pass) fails += 1; console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail && !pass ? `: ${detail}` : ''}`); };
  const at = (ms) => page.waitForTimeout(ms);
  const look = () => page.evaluate(() => ({ theme: window.__store.getState().settings.theme, mode: document.documentElement.dataset.theme, bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() }));
  await run(`printf '\\e[31mred \\e[32mgreen \\e[33myellow \\e[34mblue \\e[35mmagenta \\e[36mcyan\\e[0m \\e[1mbold\\e[0m\\n'`, 700);
  await page.evaluate((p) => window.__store.getState().openFile(p, null, { keep: true }), path.join(work, 'main.py'));
  await at(1200);
  await page.keyboard.press('Meta+p'); await page.keyboard.type('theme'); await at(500);
  const listed = await page.evaluate(() => document.querySelector('.palette')?.innerText ?? '');
  await page.keyboard.press('Escape'); await at(300);
  for (const id of IDS) {
    await page.evaluate((t) => window.__store.getState().updateSettings({ theme: t }), id); await at(500);
    const s = await look();
    ok(`${id} applies`, s.theme === id && s.mode === (/day|white|light/.test(id) ? 'light' : 'dark'), JSON.stringify(s));
    await shot(`theme-${id}`);
  }
  ok('pure black is black', (await page.evaluate((t) => { window.__store.getState().updateSettings({ theme: 'pure-black' }); return getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(); })).toUpperCase() === '#000000');
  // ⌘0: Night → Day → Night, GitHub Dark HC → Light HC → Dark HC, Pure Black ⇄ White.
  const pairs = [['tokyo-night', 'tokyo-day'], ['github-dark-hc', 'github-light-hc'], ['pure-black', 'pure-white'], ['github-light', 'github-dark']];
  for (const [a, b] of pairs) {
    await page.evaluate((t) => window.__store.getState().updateSettings({ theme: t, themeBefore: 'antares' }), a); await at(300);
    await page.keyboard.press('Meta+0'); await at(400);
    const one = (await look()).theme;
    await page.keyboard.press('Meta+0'); await at(400);
    const two = (await look()).theme;
    ok(`⌘0 ${a} → ${b} → ${a}`, one === b && two === a, `${one}, ${two}`);
  }
  // A theme with no twin still goes to Vellum and back.
  await page.evaluate(() => window.__store.getState().updateSettings({ theme: 'antares', themeBefore: '' })); await at(300);
  await page.keyboard.press('Meta+0'); await at(400); const v = (await look()).theme;
  await page.keyboard.press('Meta+0'); await at(400);
  ok('Antares still goes to Vellum and back', v === 'vellum' && (await look()).theme === 'antares', v);
  console.log('palette:', listed.replace(/\n+/g, ' | ').slice(0, 400));
  if (fails) throw new Error(`${fails} failed`);
}
