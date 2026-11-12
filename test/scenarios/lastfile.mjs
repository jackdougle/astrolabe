export default async function ({ app, page, run, type, work }) {
  const st = async (label) => { const wins = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length).catch(() => 0); const s = wins ? await page.evaluate(() => ({ panes: [...document.querySelectorAll('.tab-area.is-active .pane')].map((p) => p.firstElementChild.className.split('-')[0]), tab: document.querySelector('.toptab-text')?.textContent })).catch(() => null) : null; console.log(label, 'windows:', wins, JSON.stringify(s)); };
  await st('launch:');
  await run(`cd ${work}`);
  await page.keyboard.press('Meta+p'); await page.waitForTimeout(350); await type('main'); await page.keyboard.press('Enter'); await page.waitForTimeout(900);
  await page.keyboard.press('Meta+Alt+ArrowLeft'); await page.waitForTimeout(300);
  await page.keyboard.press('Meta+w'); await page.waitForTimeout(500); await st('closed the terminal, one file left:');
  await page.keyboard.press('Meta+w'); await page.waitForTimeout(1500); await st('⌘W on the only file →');
  await page.keyboard.press('Meta+t'); await page.waitForTimeout(1200); await st('new tab →');
  await page.keyboard.press('Meta+w'); await page.waitForTimeout(400);
  await page.keyboard.press('Meta+w'); await page.waitForTimeout(700); await st('⌘W in the empty terminal →');
}
