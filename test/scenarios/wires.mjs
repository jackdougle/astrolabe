// A note's title has faint traces running out from its words, on a row of its own or beside the first line (the
// last number of `layout` is how many start at the words' shape; `aboveTitle` and `rightOfTitle` are how far any
// ink reaches past the title's top and right, which only short stubs do). The traces keep out of every line of the text, find their way into what the note leaves open (they are laid out
// again as the text changes shape), are the same each time a file is opened and differ between files, and fade with
// their distance from the word.
import fs from 'node:fs';
export default async function ({ page, run, type, work, shot }) {
  const dir = `${work}/notes`;
  const long = 'This opening paragraph is long enough that it runs all the way across the text column and wraps onto a second line, leaving no room for a title beside it.\n\nSecond paragraph.\n';
  fs.writeFileSync(`${dir}/field notes.md`, long);
  fs.writeFileSync(`${dir}/reactor.md`, long);
  fs.writeFileSync(`${dir}/short.md`, 'Short.\n\n- one\n- two\n\n' + long);
  await run(`cd ${work}`);
  const open = async (name) => { await page.keyboard.press('Meta+p'); await page.waitForTimeout(350); await type(name); await page.keyboard.press('Enter'); await page.waitForTimeout(1500); };
  // What is drawn: how much of the canvas has ink, how strong it is by the word and far from it, and whether any falls on the title or the text.
  const look = () => page.evaluate(() => {
    const c = document.querySelector('.title-wires'); if (!c) return null;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const k = c.width / c.getBoundingClientRect().width;
    const cr = c.getBoundingClientRect(), t = document.querySelector('.rich-title').getBoundingClientRect();
    // Every line of the text, as the boxes its letters are in.
    const lines = []; const range = document.createRange(); const walker = document.createTreeWalker(document.querySelector('.rich'), NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) { range.selectNodeContents(n); for (const r of range.getClientRects()) if (r.width > 0 && r.height > 1) lines.push(r); }
    const inBox = (x, y, b, pad) => x > (b.left - cr.left + pad) * k && x < (b.right - cr.left - pad) * k && y > (b.top - cr.top + pad) * k && y < (b.bottom - cr.top - pad) * k;
    const tx = ((t.left + t.right) / 2 - cr.left) * k, ty = ((t.top + t.bottom) / 2 - cr.top) * k;
    let inked = 0, max = 0, onTitle = 0, onText = 0, sum = 0, up = 0, right = 0; const rings = [0, 0, 0, 0]; const ringN = [0, 0, 0, 0];
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const a = d[(y * c.width + x) * 4 + 3]; if (!a) continue;
      inked++; sum += a; if (a > max) max = a;
      if (a > 12) { up = Math.max(up, (t.top - cr.top) - y / k); right = Math.max(right, x / k - (t.right - cr.left)); }
      if (inBox(x, y, t, 6)) onTitle++; if (lines.some((p) => inBox(x, y, p, 0))) onText++;
      const dist = Math.hypot(x - tx, y - ty) / k; const ring = Math.min(3, Math.floor(dist / 120)); if (a > rings[ring]) rings[ring] = a; ringN[ring]++;
    }
    return { beside: document.querySelector('.rich-head').classList.contains('is-beside'), layout: c.dataset.layout, aboveTitle: Math.round(up), rightOfTitle: Math.round(right), size: `${Math.round(cr.width)}x${Math.round(cr.height)}`, inked, strongest: +(max / 255).toFixed(2), byDistance: rings.map((v) => +(v / 255).toFixed(2)), onTitle, onText };
  });
  await open('field notes'); await page.waitForTimeout(800); const a = await look(); console.log('field notes, title above:', JSON.stringify(a)); await shot('wires-beside-terminal');
  await open('reactor'); const b = await look(); console.log('reactor:', JSON.stringify(b), '| a different pattern:', a?.layout !== b?.layout);
  await open('field notes'); await page.waitForTimeout(800); const again = await look(); console.log('field notes again: the same pattern', again?.layout === a?.layout);
  await open('short.md'); const side = await look(); await shot('wires-beside-line'); console.log('title beside the first line:', JSON.stringify(side), '| title can be clicked:', await page.evaluate(() => { const t = document.querySelector('.rich-title').getBoundingClientRect(); return document.elementFromPoint(t.left + t.width / 2, t.top + t.height / 2)?.className; }));
  // Typing reshapes the note, and the traces are laid out again around it.
  await page.click('.rich li'); await page.waitForTimeout(300); await page.keyboard.type(' and now this item runs a long way out to the right, under the title'); await page.waitForTimeout(500);
  const typed = await look(); console.log('after typing a long line under the title:', JSON.stringify(typed), '| laid out again:', typed?.layout !== side?.layout);
  await open('reactor'); await page.keyboard.press('Control+Meta+f'); await page.waitForTimeout(900);
  console.log('editor filling the window:', JSON.stringify(await look())); await shot('wires-full');
  await page.click('.rich p'); await page.waitForTimeout(300); await page.keyboard.type('x'); await page.waitForTimeout(300);
  console.log('text still takes typing and clicks:', await page.evaluate(() => document.querySelector('.rich p').textContent.includes('x')));
}
