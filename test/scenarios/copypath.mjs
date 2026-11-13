// ⌥⌘C in the editor copies the open file's full path (rendered and raw); ⌃L selects the line.
import path from 'node:path';
export default async function ({ app, page, run, type, work }) {
  const clip = () => app.evaluate(async ({ clipboard }) => clipboard.readText());
  // The test goes through the real clipboard, so what was on it is put back at the end.
  const before = await clip();
  try {
    await run(`cd ${work}`);
    await page.keyboard.press('Meta+p'); await page.waitForTimeout(350); await type('plan'); await page.keyboard.press('Enter'); await page.waitForTimeout(1300);
    const want = path.join(work, 'notes', 'plan.md');
    const same = (got) => got === want || got === `/private${want}` || `/private${got}` === want;
    await app.evaluate(({ clipboard }) => clipboard.writeText('nothing yet'));
    await page.click('.rich p'); await page.waitForTimeout(300);
    await page.keyboard.press('Alt+Meta+c'); await page.waitForTimeout(300);
    let got = await clip();
    console.log('rendered ⌥⌘C copies the path:', same(got), JSON.stringify(got), '| toast:', await page.evaluate(() => document.querySelector('.toast')?.textContent ?? null), '| selection:', JSON.stringify(await page.evaluate(() => getSelection().toString())));
    await page.keyboard.press('Control+l'); await page.waitForTimeout(300);
    console.log('rendered ⌃L selects the line:', JSON.stringify(await page.evaluate(() => getSelection().toString())));
    await page.keyboard.press('Meta+Shift+r'); await page.waitForTimeout(700);
    await app.evaluate(({ clipboard }) => clipboard.writeText('nothing yet'));
    await page.keyboard.press('Alt+Meta+c'); await page.waitForTimeout(300);
    got = await clip();
    const sel = () => page.evaluate(() => { const e = window.monaco?.editor.getEditors?.().find((x) => x.hasTextFocus()); const s = e?.getSelection(); return s ? e.getModel().getValueInRange(s) : null; });
    console.log('raw ⌥⌘C copies the path:', same(got), '| selection:', JSON.stringify(await sel()));
    await page.keyboard.press('Control+l'); await page.waitForTimeout(300);
    console.log('raw ⌃L selects the line:', JSON.stringify(await sel()));
    // In a terminal ⌘L is not this command.
    await page.click('.cmd-input'); await page.waitForTimeout(300);
    await app.evaluate(({ clipboard }) => clipboard.writeText('nothing yet'));
    await page.keyboard.press('Alt+Meta+c'); await page.waitForTimeout(300);
    console.log('terminal ⌥⌘C leaves the clipboard:', (await clip()) === 'nothing yet');
  } finally {
    await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), before);
  }
}
