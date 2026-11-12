export default async function ({ app, page, run, type, work }) {
  const st = async (label) => { const wins = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length).catch(() => 'app gone'); const s = wins === 0 || wins === 'app gone' ? null : await page.evaluate(() => ({ tabs: document.querySelectorAll('.toptab').length, panes: [...document.querySelectorAll('.tab-area.is-active .pane')].map((p) => p.firstElementChild.className.split('-')[0]), files: [...document.querySelectorAll('.filetab-name')].map((f) => f.textContent) })).catch(() => 'page gone'); console.log(label, 'windows:', wins, JSON.stringify(s)); };
  const open = async (name) => { await page.keyboard.press('Meta+p'); await page.waitForTimeout(350); await type(name); await page.keyboard.press('Enter'); await page.waitForTimeout(900); };
  await run(`cd ${work}`);
  await open('main'); await open('data');
  await st('terminal + editor(2 files):');
  await page.keyboard.press('Meta+w'); await page.waitForTimeout(400); await st('⌘W in editor        →');
  await page.keyboard.press('Meta+w'); await page.waitForTimeout(400); await st('⌘W on the last file →');
  await page.keyboard.press('Meta+d'); await page.waitForTimeout(1200); await st('split right         →');
  await page.keyboard.press('Meta+w'); await page.waitForTimeout(400); await st('⌘W in right terminal→');
  await page.keyboard.press('Meta+t'); await page.waitForTimeout(1200); await st('new tab             →');
  await page.keyboard.press('Meta+w'); await page.waitForTimeout(400); await st('⌘W in tab 2         →');
  await open('plan'); await st('opened a note (rendered):');
  await page.keyboard.press('Meta+Alt+ArrowLeft'); await page.waitForTimeout(400);
  await page.keyboard.press('Meta+w'); await page.waitForTimeout(500); await st('⌘W in the terminal, note still open →');
  await page.keyboard.press('Meta+w'); await page.waitForTimeout(700); await st('⌘W on the only thing left →');
}
