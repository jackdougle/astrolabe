// What programs print in a terminal is drawn in medium weight unless the setting says otherwise; bold stays bold.
export const settings = { zoom: 1 };
export default async function ({ page, shot, run }) {
  const ok = (name, pass, detail = '') => console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  const opts = () => page.evaluate(() => { const t = [...window.__sessions.values()][0].term.options; return { w: String(t.fontWeight), b: String(t.fontWeightBold) }; });
  await run(`printf 'plain text from a program \\e[1mand bold\\e[0m\\n'`, 700);
  let o = await opts();
  ok('terminal text is medium by default, bold still bold', o.w === '500' && o.b === '700', JSON.stringify(o));
  await shot('weight-500');
  await page.evaluate(() => window.__store.getState().updateSettings({ outputWeight: 400 })); await page.waitForTimeout(500);
  o = await opts();
  ok('the setting changes it in open terminals', o.w === '400', JSON.stringify(o));
  await shot('weight-400');
  await page.evaluate(() => window.__store.getState().updateSettings({ outputWeight: 950 })); await page.waitForTimeout(300);
  ok('never heavier than semibold', (await opts()).w === '600');
}
