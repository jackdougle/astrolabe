// Notion habits in the rendered view: [] makes a to-do, > a toggle (kept in the file as <details>), " a quote.
// Also: ⌃⌘S switches displays, and a note sits in the middle when the editor fills the tab.
import fs from 'node:fs';
export default async function ({ page, run, type, work, shot }) {
  const file = `${work}/notes/n.md`;
  const SRC = 'Start\n\n- bullet one\n\nPara\n\n<details>\n<summary>Old toggle</summary>\n\nHidden text\n\n- item\n- [ ] task inside\n- [x] done inside\n\n</details>\n\nAfter\n';
  fs.writeFileSync(file, SRC);
  await run(`cd ${work}`);
  await page.keyboard.press('Meta+p'); await page.waitForTimeout(350); await type('n.md'); await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
  const text = () => page.evaluate((f) => window.__monaco.editor.getModels().find((m) => m.uri.path === f)?.getValue(), file);
  const blocks = () => page.evaluate(() => [...document.querySelector('.rich').children].map((e) => `${e.tagName}${e.classList.contains('toggle') ? `.toggle[${e.dataset.open}]` : ''}`).join(' '));
  const at = () => page.evaluate(() => { const n = document.getSelection().anchorNode; const el = n?.nodeType === 3 ? n.parentElement : n; return `${el?.tagName}.${el?.className}:${JSON.stringify(el?.textContent)}`; });
  const endOf = async (sel) => { await page.click(sel); await page.waitForTimeout(250); await page.keyboard.press('Meta+ArrowRight'); await page.waitForTimeout(250); };
  const key = async (k, wait = 220) => { await page.keyboard.press(k); await page.waitForTimeout(wait); };
  console.log('opened:', await blocks(), '| unchanged:', (await text()) === SRC, '| hidden text shown:', await page.evaluate(() => [...document.querySelectorAll('.rich .toggle p')].some((p) => p.offsetParent !== null)));
  await shot('notion-1-open');

  // [] on a line of its own, then on a bullet.
  await endOf('.rich > p:first-child'); await key('Enter'); await type('[]'); await page.waitForTimeout(250);
  console.log('[] on a new line:', await blocks(), '| tasks:', await page.evaluate(() => [...document.querySelectorAll('.rich li[data-item-type="task"]')].length));
  await type('todo one'); await key('Enter'); await type('two'); await page.waitForTimeout(400);
  await page.click('.rich li:has-text("bullet one")'); await page.waitForTimeout(250); await key('Meta+ArrowLeft'); await type('[]'); await page.waitForTimeout(400);
  console.log('after to-dos:', JSON.stringify((await text()).split('\n').slice(0, 8)));
  await key('Meta+ArrowRight'); await key('Enter'); await type('[['); await type('Wiki'); await page.waitForTimeout(300);
  console.log('[[ still a link:', JSON.stringify((await text()).split('\n').filter((l) => l.includes('Wiki'))));

  // > makes a toggle; Enter goes inside; Enter on an empty line leaves it.
  await endOf('.rich > p:has-text("Para")'); await key('Enter'); await type('> '); await page.waitForTimeout(250);
  console.log('> on a new line:', await blocks(), '| caret in:', await at());
  await type('My toggle'); await key('Enter'); await type('inside'); await key('Enter'); await key('Enter'); await type('outside'); await page.waitForTimeout(500);
  console.log('toggle written:', JSON.stringify((await text()).split('Para\n')[1].split('<details>\n<summary>Old')[0]));
  console.log('blocks:', await blocks());

  // The arrow and ⌘Enter open and close; the caret steps past a closed toggle.
  const arrow = (title) => page.evaluate((t) => { const el = [...document.querySelectorAll('.rich .toggle')].find((x) => x.firstElementChild.textContent === t); const r = el.getBoundingClientRect(); const s = el.firstElementChild.getBoundingClientRect(); return { x: r.left + 9, y: s.top + s.height / 2 }; }, title);
  let a = await arrow('Old toggle'); await page.mouse.click(a.x, a.y); await page.waitForTimeout(350);
  console.log('arrow click:', await blocks(), '| file says open:', /<details open>\n<summary>Old toggle/.test(await text()), '| hidden text shown:', await page.evaluate(() => [...document.querySelectorAll('.rich .toggle p')].filter((p) => p.textContent === 'Hidden text').some((p) => p.offsetParent !== null)));
  await shot('notion-2-toggles');
  await endOf('.rich .toggle-summary:has-text("Old toggle")'); await key('Meta+Enter');
  console.log('cmd+enter in title:', await blocks(), '| caret in:', await at());
  await key('ArrowDown'); console.log('arrow down from a closed title:', await at());
  await key('ArrowUp'); console.log('arrow up again:', await at());
  // Enter in a closed title: a new toggle below; Enter in it empty: a plain line.
  await endOf('.rich .toggle-summary:has-text("Old toggle")'); await key('Enter'); console.log('enter in closed title:', await blocks(), '| caret in:', await at());
  await key('Enter'); console.log('enter in the empty toggle:', await blocks(), '| caret in:', await at());
  // Backspace at the start of a title takes the toggle away.
  await page.click('.rich .toggle-summary:has-text("My toggle")'); await page.waitForTimeout(250); await key('Meta+ArrowLeft'); await key('Backspace');
  console.log('backspace at title start:', await blocks());
  await key('Meta+z'); console.log('undo:', await blocks());
  // Line keys: ⌥↓ on a title moves the whole toggle.
  await page.click('.rich .toggle-summary:has-text("My toggle")'); await page.waitForTimeout(250); await key('Alt+ArrowDown'); console.log('alt+down on title:', await blocks());
  await key('Alt+ArrowUp');

  // " makes a quote.
  await endOf('.rich > p:has-text("After")'); await key('Enter'); await type('" quoted'); await page.waitForTimeout(500);
  console.log('quote:', await blocks(), '|', JSON.stringify((await text()).split('\n').filter((l) => l.startsWith('>'))));
  console.log('whole file:\n' + (await text()));
  // What was written reads back the same.
  await page.keyboard.press('Meta+s'); await page.waitForTimeout(500);
  const before = await blocks();
  await key('Meta+r', 900); await key('Meta+r', 1200);
  console.log('raw and back:', before, '->', await blocks(), '| file as saved equals buffer:', fs.readFileSync(file, 'utf8') === (await text()));

  // Switch displays, and the middle column.
  const rects = () => page.evaluate(() => [...document.querySelectorAll('.tab-area.is-active .pane')].map((p) => { const r = p.getBoundingClientRect(); return `${p.querySelector('.editor-pane') ? 'editor' : 'term'}@${Math.round(r.x)}`; }).join(' '));
  const tipOf = () => page.evaluate(() => { const b = document.querySelector('.view-tools [data-tip="Switch displays"]'); return `${b.dataset.tip} [${b.dataset.keys}]`; });
  console.log('button:', await tipOf(), '| panes:', await rects());
  await key('Control+Meta+s', 600); console.log('after ⌃⌘S:', await rects());
  await key('Control+Meta+s', 600); console.log('after ⌃⌘S again:', await rects());
  const column = () => page.evaluate(() => {
    const pane = document.querySelector('.tab-area.is-active .editor-pane').getBoundingClientRect();
    const el = document.querySelector('.tab-area.is-active .markdown').style.display === 'none' ? document.querySelector('.tab-area.is-active .editor-host') : document.querySelector('.tab-area.is-active .milkdown');
    const r = el.getBoundingClientRect();
    return `left gap ${Math.round(r.left - pane.left)} right gap ${Math.round(pane.right - r.right)} width ${Math.round(r.width)} of ${Math.round(pane.width)}`;
  });
  console.log('beside, rendered:', await column());
  await key('Control+Meta+f', 800); console.log('full, rendered:', await column());
  await shot('notion-3-centred');
  await key('Meta+r', 1000); console.log('full, raw:', await column());
  await shot('notion-4-centred-raw');
  await key('Meta+r', 1000);
  await key('Control+Meta+f', 800); console.log('beside again:', await column());
}
