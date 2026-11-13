// With a file open, closing the last terminal leaves the editor with the window. Closing the last file when there is
// no terminal leaves an empty terminal. With no file open, closing the last terminal closes the window.
export default async function ({ app, page, run, type, work }) {
  const st = async (label) => { const wins = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length).catch(() => 0); const s = wins ? await page.evaluate(() => { const s = window.__store.getState(); return { terminals: s.tabs.map((t) => JSON.stringify(t.root).match(/"pane"/g).length), files: Object.values(s.panes).filter((p) => p.kind === 'editor').flatMap((p) => p.files.map((f) => f.path.split('/').pop())), focus: s.focus }; }).catch(() => null) : null; console.log(label, 'windows:', wins, JSON.stringify(s)); };
  await st('launch:');
  await run(`cd ${work}`);
  await page.keyboard.press('Meta+p'); await page.waitForTimeout(350); await type('main.py'); await page.keyboard.press('Enter'); await page.waitForTimeout(900);
  await page.keyboard.press('Control+Backquote'); await page.waitForTimeout(300);
  await page.keyboard.press('Meta+w'); await page.waitForTimeout(900); await st('⌘W in the only terminal, a file open →');
  await page.keyboard.press('Meta+w'); await page.waitForTimeout(1200); await st('⌘W on the only file →');
  await page.keyboard.press('Meta+t'); await page.waitForTimeout(1200); await st('⌘T →');
  await page.keyboard.press('Meta+w'); await page.waitForTimeout(600); await st('⌘W →');
  await page.keyboard.press('Meta+w'); await page.waitForTimeout(900); await st('⌘W in the last terminal, no file open →');
}
