// Typing straight after opening a split or tab must leave one caret (the input's), not a second, blinking one from the terminal.
export default async function ({ page }) {
  const dir = process.env.SHOTS || 'test/shots';
  const crop = async (name) => {
    const box = await page.evaluate(() => { const r = document.querySelector('.pane.is-active .cmd-input').getBoundingClientRect(); const p = document.querySelector('.pane.is-active').getBoundingClientRect(); return { x: p.x, y: r.y - 6, width: 300, height: 34 }; });
    await page.screenshot({ path: `${dir}/${name}.png`, clip: box });
  };
  for (const [key, name] of [['Meta+d', 'split'], ['Meta+Shift+d', 'down'], ['Meta+t', 'tab']]) {
    await page.keyboard.press(key);
    await page.keyboard.type('echo hi', { delay: 4 });
    await page.waitForTimeout(2200);
    for (let i = 0; i < 6; i++) { await crop(`caret-${name}-${i}`); await page.waitForTimeout(230); }
  }
}
