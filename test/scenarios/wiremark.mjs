// A note whose title has no characters at all shows a small round mark where the first letter would stand, and the
// traces leave it like spokes, all the way round (long ones only left and down, stubs elsewhere), instead of leaving
// an empty box. Typing a letter brings the ordinary letter traces back. Compares `layout` (traces:sum:from-a-letter;
// with the mark, every trace starts at the mark's rim, so the last number equals the first).
import fs from 'node:fs';
export default async function ({ page, run, work, shot }) {
  const dir = `${work}/notes`;
  const long = 'This opening paragraph is long enough that it runs all the way across the text column and wraps onto a second line, leaving no room for a title beside it.\n\nSecond paragraph.\n';
  fs.writeFileSync(`${dir}/field notes.md`, long);
  fs.writeFileSync(`${dir}/short.md`, 'Short.\n\n- one\n- two\n\n' + long);
  await run(`cd ${work}`);
  const open = async (name) => { await page.evaluate((p) => window.__store.getState().openFile(p, null, { keep: true }), `${dir}/${name}`); await page.waitForTimeout(1500); };
  const look = () => page.evaluate(() => {
    const c = document.querySelector('.title-wires'); const t = document.querySelector('.rich-title');
    if (!c || !t) return null;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const k = c.width / c.getBoundingClientRect().width;
    const cr = c.getBoundingClientRect(), tr = t.getBoundingClientRect();
    // Ink inside the title's own box: the mark when empty.
    let inTitle = 0, inked = 0;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const a = d[(y * c.width + x) * 4 + 3]; if (a < 8) continue; inked++;
      const px = x / k + cr.left, py = y / k + cr.top;
      if (px > tr.left && px < tr.right && py > tr.top && py < tr.bottom) inTitle++;
    }
    return { text: JSON.stringify(t.textContent), placeholder: getComputedStyle(t, '::before').content, title: `${Math.round(tr.width)}x${Math.round(tr.height)}`, layout: c.dataset.layout, inked, inTitle };
  });
  const clear = async () => {
    await page.click('.rich-title'); await page.waitForTimeout(150);
    await page.keyboard.press('Meta+a'); await page.keyboard.press('Backspace'); await page.waitForTimeout(700);
  };
  for (const name of ['field notes.md', 'short.md']) {
    await open(name);
    const before = await look();
    await clear();
    const empty = await look();
    await shot(`wiremark-${name.split(' ')[0].replace('.md', '')}`);
    const [n, , from] = (empty?.layout ?? '0::0').split(':').map(Number);
    console.log(name, '| with letters:', JSON.stringify(before), '\n  empty:', JSON.stringify(empty), '\n  traces drawn:', n, '| all from the mark:', n > 0 && n === from, '| mark inside the title box:', (empty?.inTitle ?? 0) > 40);
    await page.keyboard.type('Q'); await page.waitForTimeout(700);
    const typed = await look();
    console.log('  after typing a letter, letter traces again:', JSON.stringify(typed), typed?.layout !== empty?.layout);
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  }
  // Same mark and spokes each time the same file is emptied.
  await open('field notes.md'); await clear(); const a = await look(); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await open('short.md'); await open('field notes.md'); await clear(); const b = await look(); await page.keyboard.press('Escape');
  console.log('same pattern when emptied again:', a?.layout === b?.layout, a?.layout, b?.layout);
}
