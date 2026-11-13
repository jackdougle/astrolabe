export default async function ({ page, run, type, work }) {
  await run(`cd ${work}`);
  await page.keyboard.press('Meta+p'); await page.waitForTimeout(350); await type('plan'); await page.keyboard.press('Enter'); await page.waitForTimeout(1300);
  const mode = () => page.evaluate(() => (document.querySelector('.seg button.is-on')?.textContent) + ' | focus in ' + (document.activeElement?.closest('.rich') ? 'rendered editor' : document.activeElement?.closest('.editor-host') ? 'raw editor' : 'elsewhere'));
  console.log('opened:', await mode());
  for (const key of ['Meta+Shift+r', 'Meta+Shift+r', 'Meta+e', 'Meta+Shift+v']) { await page.keyboard.press(key); await page.waitForTimeout(600); console.log(`${key} →`, await mode()); }
}
