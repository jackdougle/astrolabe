export default async function ({ page, run, type, work }) {
  await run(`cd ${work}`);
  await page.keyboard.press('Meta+b'); await page.waitForTimeout(400);
  await page.keyboard.press('Meta+p'); await page.waitForTimeout(400); await type('main'); await page.keyboard.press('Enter'); await page.waitForTimeout(1200);
  const read = () => page.evaluate(() => {
    const a = (el) => { const m = /\/ ([\d.]+)\)/.exec(getComputedStyle(el).backgroundColor); const c = getComputedStyle(el).backgroundColor; return /rgba\(0, 0, 0, 0\)|\/ 0\)/.test(c) ? 0 : m ? Number(m[1]) : 1; };
    const base = a(document.querySelector('.app'));
    const total = (sel) => (1 - (1 - base) * (1 - a(document.querySelector(sel)))).toFixed(2);
    return { terminal: base.toFixed(2), editor: total('.editor-pane'), fileNavigator: total('.sidebar'), tabRow: total('.topbar') };
  });
  await page.evaluate(() => document.body.classList.remove('is-blurred')); await page.waitForTimeout(600);
  console.log('app focused  ', JSON.stringify(await read()));
  await page.evaluate(() => document.body.classList.add('is-blurred')); await page.waitForTimeout(600);
  console.log('app unfocused', JSON.stringify(await read()));
  console.log('pane dimming layers:', await page.evaluate(() => document.querySelectorAll('.pane-veil').length), '| panes:', await page.evaluate(() => document.querySelectorAll('.pane').length));
  console.log('placeholder:', JSON.stringify(await page.evaluate(() => document.querySelector('.cmd-editor .monaco-placeholder, .cmd-editor .editorPlaceholder')?.textContent ?? window.__monaco.editor.getEditors().find((e) => e.getModel()?.uri.scheme === 'astrolabe-input')?.getOption(window.__monaco.editor.EditorOption.placeholder))));
}
