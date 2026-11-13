// Lists in the rendered view: Enter under a ticked to-do makes an unticked one; Tab and ⇧Tab slide the line
// across; a ticked box is filled right to its edge. (Changing a note's kind: retype.mjs.)
import fs from 'node:fs';
export default async function ({ page, run, type, work, shot }) {
  const file = `${work}/notes/lt.md`;
  const SRC = 'Start\n\n- [x] done one\n- [ ] open one\n\nMiddle\n\n- alpha\n- beta\n  - nested\n- gamma\n\n1. first\n2. second\n3. third\n\n<details open>\n<summary>A toggle</summary>\n\nheld text\n\n</details>\n\nEnd\n';
  fs.writeFileSync(file, SRC);
  await run(`cd ${work}`);
  await page.keyboard.press('Meta+p'); await page.waitForTimeout(350); await type('lt.md'); await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
  await page.keyboard.press('Control+Meta+f'); await page.waitForTimeout(500);
  const text = () => page.evaluate((f) => window.__monaco.editor.getModels().find((m) => m.uri.path === f)?.getValue(), file);
  const lines = async (a, b) => JSON.stringify((await text()).split(a)[1]?.split(b)[0]);
  const at = () => page.evaluate(() => { const n = document.getSelection().anchorNode; const el = n?.nodeType === 3 ? n.parentElement : n; return `${el?.tagName}:${JSON.stringify(el?.textContent)}`; });
  const key = async (k, wait = 250) => { await page.keyboard.press(k); await page.waitForTimeout(wait); };
  const startOf = async (sel) => { await page.click(sel); await page.waitForTimeout(250); await key('Meta+ArrowLeft'); };
  const endOf = async (sel) => { await page.click(sel); await page.waitForTimeout(250); await key('Meta+ArrowRight'); };
  const li = (t) => `.rich li:has(> p:text-is("${t}")) > p`;

  // Enter under a ticked to-do.
  await endOf(li('done one')); await key('Enter'); await type('typed after'); await page.waitForTimeout(400);
  console.log('enter at the end of a ticked to-do:', await lines('Start\n\n', '\nMiddle'));
  await startOf(li('done one')); await key('Enter'); await page.waitForTimeout(300);
  console.log('enter at its start:', await lines('Start\n\n', '\nMiddle'), '| caret in:', await at());
  await key('Meta+z'); await page.waitForTimeout(300);

  // Tab slides the line: part-way through, it is still between the two places.
  await endOf(li('gamma'));
  const x = () => page.evaluate(() => Math.round([...document.querySelectorAll('.rich li')].find((l) => l.firstElementChild.textContent === 'gamma').getBoundingClientRect().left * 10) / 10);
  const x0 = await x();
  await page.keyboard.press('Tab');
  const mid = []; for (let i = 0; i < 6; i++) { mid.push(await x()); await page.waitForTimeout(25); }
  await page.waitForTimeout(300);
  console.log('Tab: from', x0, 'through', JSON.stringify(mid), 'to', await x(), '| file:', await lines('Middle\n\n', '\n1. '));
  await page.keyboard.press('Shift+Tab');
  const back = []; for (let i = 0; i < 6; i++) { back.push(await x()); await page.waitForTimeout(25); }
  await page.waitForTimeout(300);
  console.log('⇧Tab: through', JSON.stringify(back), 'to', await x(), '| caret in:', await at());

  // (Turning one kind of note into another is checked in retype.mjs.)
  await shot('listtypes-1-kinds');

  // The ticked box, enlarged: every pixel inside its border is the fill.
  const box = await page.evaluate(() => { const l = document.querySelector('.rich li[data-checked="true"]'); const s = getComputedStyle(l, '::before'); const r = l.getBoundingClientRect(); return { x: r.left + parseFloat(s.left), y: r.top + parseFloat(s.top), radius: s.borderRadius, origin: s.backgroundOrigin }; });
  console.log('ticked box:', JSON.stringify(box));
  await page.mouse.move(5, 300);
  await page.screenshot({ path: `${process.env.SHOTS}/listtypes-2-box.png`, clip: { x: Math.floor(box.x) - 3, y: Math.floor(box.y) - 3, width: 22, height: 22 } });
}
