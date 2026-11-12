export default async function ({ page, shot }) {
  await page.keyboard.press('Meta+t');
  await page.waitForTimeout(900);
  await page.keyboard.type('abc', { delay: 30 });
  await page.waitForTimeout(600);
  await shot('c2-before');
  console.log(await page.evaluate(() => { const s = [...window.__sessions.values()].at(-1); const b = s.term.buffer.normal; return `xterm cursor at x=${b.cursorX} y=${b.cursorY}; focus=${s.host.querySelector('.xterm').classList.contains('focus')}; monaco cursors=${document.querySelectorAll('.cmd-input .cursor').length}`; }));
  await page.evaluate(() => { const s = [...window.__sessions.values()].at(-1); s.term.refresh(0, s.term.rows - 1); });
  await page.waitForTimeout(400);
  await shot('c2-after-refresh');
}
