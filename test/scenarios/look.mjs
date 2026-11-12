export default async function ({ page, shot, run, work }) {
  await run(`cd ${work}`);
  const bg = () => page.evaluate(() => getComputedStyle(document.querySelector('.app')).backgroundColor);
  await page.evaluate(() => document.body.classList.remove('is-blurred'));
  await page.waitForTimeout(500);
  console.log('focused background:', await bg());
  await page.evaluate(() => document.body.classList.add('is-blurred'));
  await page.waitForTimeout(150);
  console.log('mid-fade:', await bg());
  await page.waitForTimeout(500);
  console.log('unfocused background:', await bg());
  console.log('weights:', JSON.stringify(await page.evaluate(() => { const s = [...window.__sessions.values()][0]; const ed = window.__monaco.editor.getEditors()[0]; return { output: s.term.options.fontWeight, bold: s.term.options.fontWeightBold, typed: ed.getOption(window.__monaco.editor.EditorOption.fontWeight), head: getComputedStyle(document.querySelector('.top-rest')).fontFamily.slice(0, 22) }; })));
}
