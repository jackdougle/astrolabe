// The rendered view's selection is drawn, a box for each line, with the corners that stick out slightly rounded.
import fs from 'node:fs';
export default async function ({ page, run, type, work, shot }) {
  const file = `${work}/notes/sel.md`;
  fs.writeFileSync(file, '# A heading\n\nFirst paragraph with enough words in it to run over more than one line of the note when the editor is this narrow, so that a selection across it has several lines to join up into one shape with rounded outer corners.\n\n- a bullet\n- another **bold** bullet with `code` in it\n\n```sh\necho in code\n```\n\nLast paragraph.\n');
  await run(`cd ${work}`);
  await page.keyboard.press('Meta+p'); await page.waitForTimeout(350); await type('sel.md'); await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
  const boxes = () => page.evaluate(() => ({ drawn: [...document.querySelectorAll('.rich-sel > div')].map((d) => `${Math.round(parseFloat(d.style.width))}x${Math.round(parseFloat(d.style.height))} @${Math.round(parseFloat(d.style.left))},${Math.round(parseFloat(d.style.top))} r[${d.style.borderRadius}]`), own: getComputedStyle(document.querySelector('.rich p'), '::selection').backgroundColor, selected: getSelection().toString().length }));
  const p = await page.locator('.rich p').first().boundingBox();
  // Drag from the middle of the paragraph's first line to the middle of its last.
  await page.mouse.move(p.x + 180, p.y + 10); await page.mouse.down(); await page.mouse.move(p.x + 260, p.y + p.height - 10, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(400);
  console.log('across the lines of one paragraph:', JSON.stringify(await boxes()));
  await shot('roundsel-paragraph');
  const last = await page.locator('.rich > p').last().boundingBox();
  await page.mouse.move(p.x + 120, p.y + 10); await page.mouse.down(); await page.mouse.move(last.x + 60, last.y + 10, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(400);
  const b = await boxes();
  console.log('down through the list and the code block:', b.drawn.length, 'boxes | selected', b.selected, 'characters\n  ', JSON.stringify(b.drawn));
  await shot('roundsel-blocks');
  await page.keyboard.press('Shift+ArrowLeft'); await page.waitForTimeout(300);
  console.log('⇧← shortens it:', JSON.stringify((await boxes()).drawn.at(-1)));
  await page.click('.cmd-input'); await page.waitForTimeout(400);
  console.log('keyboard in the terminal:', JSON.stringify(await boxes()));
  await page.click('.rich h1'); await page.waitForTimeout(300); await page.keyboard.press('Meta+a'); await page.waitForTimeout(400);
  const all = await boxes();
  console.log('select all:', all.drawn.length, 'boxes, selected', all.selected, '| a click clears them:', await (async () => { await page.click('.rich h1'); await page.waitForTimeout(300); return (await boxes()).drawn.length === 0; })());
}
