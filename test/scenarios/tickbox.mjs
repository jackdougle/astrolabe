// A task's box: its size and border, and the quick fill when it is ticked and drain when it is unticked.
import fs from 'node:fs';
export default async function ({ page, run, type, work, shot }) {
  fs.writeFileSync(`${work}/notes/todo.md`, 'Things\n\n- [ ] open task\n- [x] done task\n  - [ ] nested task\n- plain item\n');
  await run(`cd ${work}`);
  await page.keyboard.press('Meta+p'); await page.waitForTimeout(350); await type('todo'); await page.keyboard.press('Enter'); await page.waitForTimeout(1300);
  const box = (text) => page.evaluate((t) => {
    const el = [...document.querySelectorAll('.rich li[data-item-type="task"]')].find((x) => x.firstElementChild.textContent === t);
    const r = el.getBoundingClientRect(), b = getComputedStyle(el, '::before');
    return { x: r.left + parseFloat(b.left), y: r.top + parseFloat(b.top), inner: b.width, border: b.borderLeftWidth, outer: parseFloat(b.width) + 2 * parseFloat(b.borderLeftWidth), tick: b.backgroundSize, checked: el.dataset.checked, cls: el.className, anim: b.animationName, ms: b.animationDuration };
  }, text);
  const moving = () => page.evaluate(() => document.getAnimations().filter((a) => a.animationName?.startsWith('task-')).map((a) => a.animationName));
  /** Stops the running fill halfway so a screenshot can show it. */
  const freeze = () => page.evaluate(() => { for (const a of document.getAnimations()) if (a.animationName?.startsWith('task-')) { a.pause(); a.currentTime = 70; } });
  let b = await box('open task');
  console.log('open box:', JSON.stringify({ inner: b.inner, border: b.border, outer: b.outer }), '| done box tick size:', (await box('done task')).tick);
  console.log('on load, nothing moves:', JSON.stringify(await moving()));
  const mid = { x: b.x + b.outer / 2, y: b.y + b.outer / 2 };
  await page.mouse.click(mid.x, mid.y); await freeze();
  b = await box('open task'); console.log('just ticked:', b.checked, b.cls, b.anim, b.ms, JSON.stringify(await moving()));
  await page.screenshot({ path: `${process.env.SHOTS || 'test/shots'}/tickbox-filling.png` });
  await page.waitForTimeout(400);
  b = await box('open task'); console.log('settled:', b.checked, JSON.stringify(b.cls), b.anim, '| file:', JSON.stringify(await page.evaluate(() => window.__monaco.editor.getModels().find((m) => m.uri.path.endsWith('todo.md'))?.getValue().split('\n')[2])));
  await page.mouse.click(mid.x, mid.y); await freeze();
  b = await box('open task'); console.log('just unticked:', b.checked, b.cls, b.anim, JSON.stringify(await moving()));
  await page.screenshot({ path: `${process.env.SHOTS || 'test/shots'}/tickbox-draining.png` });
  await page.waitForTimeout(400);
  b = await box('open task'); console.log('settled:', b.checked, JSON.stringify(b.cls), b.anim);
  // ⌘Enter on the line does the same
  await page.mouse.click(mid.x + 60, mid.y); await page.waitForTimeout(250);
  await page.keyboard.press('Meta+Enter');
  b = await box('open task'); console.log('⌘↩:', b.checked, b.cls, b.anim);
  await page.waitForTimeout(400);
  // two quick ticks: the second box still gets its full motion
  const n = await box('nested task');
  await page.mouse.click(n.x + n.outer / 2, n.y + n.outer / 2);
  console.log('second box right after:', (await box('nested task')).cls, '| first:', JSON.stringify((await box('open task')).cls));
  await page.waitForTimeout(400);
  console.log('after:', JSON.stringify((await box('nested task')).cls), '| undo works:', await (async () => { await page.keyboard.press('Meta+z'); await page.waitForTimeout(300); return (await box('nested task')).checked; })());
  await shot('tickbox');
}
