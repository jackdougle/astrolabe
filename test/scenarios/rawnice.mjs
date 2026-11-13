// The raw Markdown view: quotes and brackets typed over a selection go around it; a web address pasted over
// selected words makes a link (rendered view too); headings are the outline (⇧⌘O) and fold as sections;
// ⌘-click on a link to a file opens it. Paste events are made by hand, so the real clipboard is left alone.
import fs from 'node:fs';
import path from 'node:path';
export default async function ({ page, shot, run, type, work }) {
  const file = path.join(work, 'notes', 'raw.md');
  const text = '# Title\n\nAlpha bravo charlie.\n\n## First part\n\nSee [the plan](plan.md) and https://example.com here.\n\n```sh\n# not a heading\necho hi\n```\n\n### Deeper\n\nDelta echo.\n\n## Second part\n\nFoxtrot.\n';
  fs.writeFileSync(file, text);
  await run(`cd ${work}`);
  await page.keyboard.press('Meta+p'); await page.waitForTimeout(350); await type('raw.md'); await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
  await page.keyboard.press('Meta+Shift+r'); await page.waitForTimeout(900);
  const value = () => page.evaluate(() => window.__monaco.editor.getModels().find((m) => m.uri.path.endsWith('/raw.md')).getValue());
  const line = async (n) => (await value()).split('\n')[n - 1];
  const ed = () => page.evaluate(() => !!window.__monaco);
  if (!(await ed())) { console.log('!! no window.__monaco'); return; }
  // Select a word on a line by double-clicking it.
  const pick = async (word) => { await page.locator(`.editor-pane .view-line:has-text("${word}")`).first().getByText(word, { exact: false }).first().dblclick({ position: { x: 4, y: 6 } }).catch(() => {}); await page.waitForTimeout(200); };
  const select = (ln, from, to) => page.evaluate(({ ln, from, to }) => { const e = window.__monaco.editor.getEditors().find((x) => x.getModel()?.uri.path.endsWith('/raw.md')); e.setSelection({ startLineNumber: ln, startColumn: from, endLineNumber: ln, endColumn: to }); e.focus(); }, { ln, from, to });
  const undo = async (n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press('Meta+z'); await page.waitForTimeout(150); } };
  const wrapped = async (key, n = 1) => { await select(3, 7, 12); for (let i = 0; i < n; i++) { await page.keyboard.type(key); await page.waitForTimeout(120); } const l = await line(3); await undo(n); return l; };
  console.log('raw, typed over "bravo":', JSON.stringify({ dq: await wrapped('"'), sq: await wrapped("'"), brace: await wrapped('{'), angle: await wrapped('<'), paren: await wrapped('('), tick: await wrapped('`'), star2: await wrapped('*', 2) }));
  console.log('file as it began:', (await value()) === text);

  const paste = (clip) => page.evaluate((clip) => { const dt = new DataTransfer(); dt.setData('text/plain', clip); const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }); document.activeElement.dispatchEvent(ev); return ev.defaultPrevented; }, clip);
  await select(3, 7, 12);
  console.log('raw, web address pasted over "bravo": taken', await paste('https://example.org/x'), JSON.stringify(await line(3)));
  await undo();
  await select(7, 29, 48);
  await paste('https://example.org/y'); await page.waitForTimeout(200);
  console.log('raw, one address pasted over another replaces it:', JSON.stringify(await line(7)));
  await undo();

  // ⌥⌘↓ puts a second caret on the line below; typing goes to both.
  await select(3, 1, 1); await page.keyboard.press('Alt+Meta+ArrowDown'); await page.waitForTimeout(200); await page.keyboard.press('Alt+Meta+ArrowDown'); await page.waitForTimeout(200);
  await page.keyboard.type('>'); await page.waitForTimeout(200);
  console.log('⌥⌘↓ twice, then ">":', JSON.stringify((await value()).split('\n').slice(2, 5)), '| keyboard still in the editor:', await page.evaluate(() => !!document.activeElement?.closest('.editor-pane')));
  await undo(); await page.keyboard.press('Escape');
  // Prose does not bring up word suggestions; ⌘F opens the editor's find.
  await select(3, 21, 21); await page.keyboard.type(' Alp'); await page.waitForTimeout(700);
  console.log('suggestions while typing prose:', await page.evaluate(() => !!document.querySelector('.suggest-widget.visible')));
  await undo(2);
  await page.keyboard.press('Meta+f'); await page.waitForTimeout(500);
  console.log('⌘F find box:', await page.evaluate(() => !!document.querySelector('.editor-pane .find-widget.visible, .monaco-editor .find-widget.visible')));
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  console.log('file as it began:', (await value()) === text);

  // Outline and folding.
  const symbols = await page.evaluate(async () => {
    const m = window.__monaco; const model = m.editor.getModels().find((x) => x.uri.path.endsWith('/raw.md'));
    const e = m.editor.getEditors().find((x) => x.getModel() === model);
    await e.getAction('editor.foldAll')?.run();
    await new Promise((r) => setTimeout(r, 500));
    const shown = e.getVisibleRanges().map((r) => [r.startLineNumber, r.endLineNumber]);
    await e.getAction('editor.unfoldAll')?.run();
    return { shown };
  });
  console.log('all folded, lines still on show:', JSON.stringify(symbols.shown));
  await page.keyboard.press('Meta+Shift+o'); await page.waitForTimeout(700);
  console.log('⇧⌘O lists:', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.quick-input-widget .monaco-list-row .label-name, .quick-input-widget .monaco-list-row .monaco-highlighted-label')].map((x) => x.textContent).filter((t, i, a) => t && a.indexOf(t) === i))));
  await shot('rawnice-outline');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);

  // ⌘-click the link to plan.md.
  const tabs = () => page.evaluate(() => [...document.querySelectorAll('.filetab')].map((f) => f.textContent));
  const link = page.locator('.editor-pane .view-line:has-text("the plan")').first();
  const box = await link.boundingBox();
  const cell = await page.evaluate(() => { const e = window.__monaco.editor.getEditors().find((x) => x.getModel()?.uri.path.endsWith('/raw.md')); const p = e.getScrolledVisiblePosition({ lineNumber: 7, column: 18 }); const r = e.getDomNode().getBoundingClientRect(); return { x: r.left + p.left + 3, y: r.top + p.top + p.height / 2 }; });
  await page.mouse.move(cell.x, cell.y); await page.keyboard.down('Meta'); await page.waitForTimeout(250); await page.mouse.click(cell.x, cell.y); await page.keyboard.up('Meta'); await page.waitForTimeout(1200);
  console.log('⌘-click on (plan.md):', JSON.stringify(await tabs()));

  // Rendered: the same paste.
  await page.locator('.filetab:has-text("raw.md")').first().click().catch(() => {}); await page.waitForTimeout(600);
  await page.keyboard.press('Meta+Shift+r'); await page.waitForTimeout(900);
  await page.locator('.rich p >> nth=0').dblclick({ position: { x: 60, y: 8 } }); await page.waitForTimeout(300);
  const sel = await page.evaluate(() => getSelection().toString());
  console.log('rendered, web address pasted over', JSON.stringify(sel), ': taken', await paste('https://example.org/z'), '| links:', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.rich p a')].map((a) => `${a.textContent} -> ${a.getAttribute('href')}`))));
}
