// Tasks tick only from a click on the box itself or ⌘Enter on their line; an emptied heading leaves no line behind.
import fs from 'node:fs';
export default async function ({ page, run, type, work, shot }) {
  const dir = `${work}/notes`;
  fs.writeFileSync(`${dir}/todo.md`, 'Things\n\n- [ ] open task\n- [x] done task\n  - [ ] nested task\n- plain item\n\n## Heading two\n\nBody text\n\n---\n\nEnd\n');
  await run(`cd ${work}`);
  await page.keyboard.press('Meta+p'); await page.waitForTimeout(350); await type('todo'); await page.keyboard.press('Enter'); await page.waitForTimeout(1300);
  const ticks = () => page.evaluate(() => [...document.querySelectorAll('.rich li[data-item-type="task"]')].map((li) => `${li.dataset.checked === 'true' ? '[x]' : '[ ]'} ${li.firstElementChild.textContent}`).join(', '));
  const li = (text) => page.evaluate((t) => {
    const el = [...document.querySelectorAll('.rich li[data-item-type="task"]')].find((x) => x.firstElementChild.textContent === t);
    const r = el.getBoundingClientRect(), b = getComputedStyle(el, '::before'), range = document.createRange();
    range.selectNodeContents(el.firstElementChild);
    const tr = range.getBoundingClientRect();
    const box = { x: r.left + parseFloat(b.left), y: r.top + parseFloat(b.top), w: parseFloat(b.width), h: parseFloat(b.height) };
    return { box, textLeft: tr.left, textMid: tr.top + tr.height / 2, textRight: tr.right };
  }, text);
  const click = async (x, y) => { await page.mouse.click(x, y); await page.waitForTimeout(250); };
  console.log('start:', await ticks());
  let t = await li('open task');
  console.log('gap between box and text (px):', (t.textLeft - (t.box.x + t.box.w)).toFixed(1));
  await click(t.textLeft + 2, t.textMid); console.log('click on first letter:', await ticks());
  await click(t.textLeft + 12, t.textMid); console.log('click a little into the text:', await ticks());
  await click(t.textRight + 60, t.textMid); console.log('click right of the text:', await ticks());
  await click(t.box.x + t.box.w + 5, t.textMid); console.log('click in the gap:', await ticks());
  await click(t.box.x + t.box.w / 2, t.box.y + t.box.h / 2); console.log('click on the box:', await ticks());
  await click(t.box.x + t.box.w / 2, t.box.y + t.box.h / 2); console.log('click on the box again:', await ticks());
  t = await li('nested task');
  await click(t.textLeft + 2, t.textMid); console.log('click nested text:', await ticks());
  await click(t.box.x + t.box.w / 2, t.box.y + t.box.h / 2); console.log('click nested box:', await ticks());
  await click(t.textLeft + 20, t.textMid); await page.keyboard.press('Meta+Enter'); await page.waitForTimeout(250); console.log('cmd+enter on nested line:', await ticks());
  await type('!'); await page.keyboard.press('Enter'); await page.waitForTimeout(250); console.log('typing and Enter:', await ticks(), '| items:', await page.evaluate(() => document.querySelectorAll('.rich li').length));
  await page.keyboard.press('Backspace'); await page.waitForTimeout(200);
  await page.click('.rich li:has-text("plain item")'); await page.waitForTimeout(250); await page.keyboard.press('Meta+Enter'); await page.waitForTimeout(250);
  console.log('cmd+enter on a plain item:', await ticks(), '| items:', await page.evaluate(() => document.querySelectorAll('.rich li').length));
  await shot('tasks');

  // Headings: no underline, and an emptied one is gone with one Backspace.
  const blocks = () => page.evaluate(() => [...document.querySelector('.rich').children].map((e) => `${e.tagName}${e.textContent ? '' : '(empty)'}`).join(' '));
  console.log('h2 underline:', await page.evaluate(() => getComputedStyle(document.querySelector('.rich h2')).borderBottomWidth), '| rules:', await page.evaluate(() => document.querySelectorAll('.rich hr').length));
  await page.click('.rich h2'); await page.waitForTimeout(250); await page.keyboard.press('Meta+ArrowRight'); await page.keyboard.press('Meta+Shift+ArrowLeft'); await page.keyboard.press('Backspace'); await page.waitForTimeout(250);
  console.log('heading text deleted:', await blocks()); await shot('tasks-heading');
  await page.keyboard.press('Backspace'); await page.waitForTimeout(250); console.log('one Backspace:', await blocks());
  await page.keyboard.press('Backspace'); await page.waitForTimeout(250); console.log('another Backspace:', await blocks());
  await page.waitForTimeout(400); console.log('ticks before saving:', await ticks());
  await page.keyboard.press('Meta+s'); await page.waitForTimeout(500); console.log('file:', JSON.stringify(fs.readFileSync(`${dir}/todo.md`, 'utf8')));

  // Raw view: ⌘Enter ticks the task on the caret's line.
  await page.keyboard.press('Meta+r'); await page.waitForTimeout(700);
  await page.keyboard.press('Meta+ArrowUp'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Meta+ArrowRight');
  await page.keyboard.press('Meta+Enter'); await page.waitForTimeout(250); await page.keyboard.press('Meta+s'); await page.waitForTimeout(500);
  console.log('raw cmd+enter:', JSON.stringify(fs.readFileSync(`${dir}/todo.md`, 'utf8').split('\n').slice(0, 4)));
  await page.keyboard.press('Meta+Enter'); await type('Z'); await page.waitForTimeout(250); await page.keyboard.press('Meta+s'); await page.waitForTimeout(500);
  console.log('raw cmd+enter again, then typed Z:', JSON.stringify(fs.readFileSync(`${dir}/todo.md`, 'utf8').split('\n').slice(0, 4)));
}
