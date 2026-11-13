// Text slides rather than jumps when Markdown's characters come and go in the rendered view: a heading's #s,
// brackets put around a selection, and the * typed around words as they turn bold or italic.
import fs from 'node:fs';
import path from 'node:path';
export default async function ({ page, shot, run, type, work }) {
  const file = path.join(work, 'notes', 'slide.md');
  fs.writeFileSync(file, 'Alpha bravo charlie delta echo foxtrot.\n\n### Heading here\n\nSecond line of words here.\n');
  await run(`cd ${work}`);
  await page.keyboard.press('Meta+p'); await page.waitForTimeout(350); await type('slide'); await page.keyboard.press('Enter'); await page.waitForTimeout(1300);
  // Samples, every frame for 240ms, where a word stands (its left edge) and where the caret is.
  const watch = async (label, word, act) => {
    await page.evaluate((word) => {
      window.__xs = []; const t0 = performance.now();
      const find = () => { const w = document.createTreeWalker(document.querySelector('.rich'), NodeFilter.SHOW_TEXT); let node; while ((node = w.nextNode())) { const i = node.nodeValue.indexOf(word); if (i >= 0 && !node.parentElement.closest('.rich-ghost')) { const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + word.length); return r.getBoundingClientRect().left; } } return null; };
      const tick = () => { const x = find(); window.__xs.push([x == null ? null : Math.round(x * 10) / 10, Math.round(document.querySelector('.rich-caret').getBoundingClientRect().left * 10) / 10]); if (performance.now() - t0 < 240) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }, word);
    await act();
    await page.waitForTimeout(420);
    const xs = await page.evaluate(() => window.__xs);
    const word_ = [...new Set(xs.map((x) => x[0]))];
    const caret = [...new Set(xs.map((x) => x[1]))];
    const left = await page.evaluate(() => ({ ghosts: document.querySelectorAll('.rich .rich-ghost').length, growing: document.querySelectorAll('.rich .is-growing').length }));
    console.log(`${label}: "${word}" passes through ${word_.length} places ${JSON.stringify([word_[0], word_.at(-1)])}, caret ${caret.length} ${JSON.stringify([caret[0], caret.at(-1)])} | left behind: ${JSON.stringify(left)}`);
  };
  const html = (sel) => page.evaluate((sel) => document.querySelector(sel).innerHTML, sel);
  const at = (word) => page.evaluate((word) => { const w = document.createTreeWalker(document.querySelector('.rich'), NodeFilter.SHOW_TEXT); let node; while ((node = w.nextNode())) { const i = node.nodeValue.indexOf(word); if (i >= 0) { const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + word.length); const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, left: b.left, right: b.right }; } } return null; }, word);
  const click = async (word, where = 'mid') => { const b = await at(word); await page.mouse.click(where === 'end' ? b.right - 1 : b.x, b.y); await page.waitForTimeout(350); };
  const dbl = async (word) => { const b = await at(word); await page.mouse.dblclick(b.x, b.y); await page.waitForTimeout(350); };

  await click('Second');
  await watch('caret enters the heading (click)', 'Heading', () => click('here'));
  await watch('caret leaves the heading (click)', 'Heading', async () => { const b = await at('Second'); await page.mouse.click(b.x, b.y); });
  await watch('caret enters the heading (ArrowUp)', 'Heading', () => page.keyboard.press('ArrowUp'));
  await watch('caret leaves the heading (ArrowDown)', 'Heading', () => page.keyboard.press('ArrowDown'));

  await dbl('bravo'); await watch('( around bravo', 'charlie', () => page.keyboard.type('('));
  console.log('  ', JSON.stringify(await html('.rich p')));
  await dbl('charlie'); await watch('[ around charlie', 'delta', () => page.keyboard.type('['));
  await watch('second [', 'delta', () => page.keyboard.type('['));
  console.log('  ', JSON.stringify(await html('.rich p')));
  await dbl('delta'); await watch('* around delta (a mark, no characters)', 'echo', () => page.keyboard.type('*'));

  await click('echo', 'end'); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(250);
  await type('*ital'); await page.waitForTimeout(300);
  await watch('closing * of *ital*', 'foxtrot', () => page.keyboard.type('*'));
  await type(' **bol*'); await page.waitForTimeout(300);
  await watch('closing * of **bol**', 'foxtrot', () => page.keyboard.type('*'));
  await type(' `cod'); await page.waitForTimeout(300);
  await watch('closing ` of `cod`', 'foxtrot', () => page.keyboard.type('`'));
  console.log('  ', JSON.stringify(await html('.rich p')));
  await shot('slide');
  await page.keyboard.press('Meta+z'); await page.waitForTimeout(300);
  console.log('one undo:', JSON.stringify((await html('.rich p')).slice(-60)));
  await page.keyboard.press('Meta+Shift+z'); await page.waitForTimeout(300);
  await page.keyboard.press('Meta+s'); await page.waitForTimeout(400);
  console.log('file:', JSON.stringify(fs.readFileSync(file, 'utf8')));
}
