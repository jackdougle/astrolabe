// ⌘X with nothing selected in the rendered Markdown view cuts the line under the caret.
export default async function ({ app, page, type, run, work, shot }) {
  const modelText = () => page.evaluate(() => window.__monaco.editor.getModels().find((m) => m.uri.path.endsWith('plan.md'))?.getValue());
  const clip = () => app.evaluate(async ({ clipboard }) => ({ text: await clipboard.readText() }));
  // The Edit menu's Cut and Paste, with ⌘ held as it is when they come from the keyboard (the key press is
  // what makes the note read the caret's new place after a click).
  const edit = async (what) => {
    await page.keyboard.down('Meta');
    await app.evaluate(({ webContents }, w) => { const wc = webContents.getAllWebContents().find((c) => c.getType() === 'window'); wc[w](); }, what);
    await page.keyboard.up('Meta');
  };
  // The note learns of a click's caret on the next frame, so give it one before acting.
  const click = async (sel, how = 'click') => { await page[how](sel); await page.waitForTimeout(200); };
  const cut = async () => { await edit('cut'); await page.waitForTimeout(500); };
  const paste = async () => { await edit('paste'); await page.waitForTimeout(500); };
  const caret = () => page.evaluate(() => { const s = getSelection(); const el = s.anchorNode?.nodeType === 3 ? s.anchorNode.parentElement : s.anchorNode; return `${el?.closest('li,p,h1,pre')?.textContent?.slice(0, 24)} @${s.anchorOffset}`; });
  // The test goes through the real clipboard, so what was on it is put back at the end.
  await app.evaluate(async ({ clipboard }) => { globalThis.__clip = await clipboard.read().catch(() => null); globalThis.__clipText = await clipboard.readText(); });
  try {
    await run(`cd ${work}`);
    await page.keyboard.press('Meta+p');
    await page.waitForTimeout(400);
    await type('plan');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);
    const original = await modelText();

    // A middle-of-line caret in a list item: the item goes, the caret lands on the next line.
    await click('.rich li:has-text("first item")');
    await cut();
    let now = await modelText();
    console.log('item cut:', !now.includes('first item') && now.includes('- second item'), '| clipboard:', JSON.stringify((await clip()).text), '| caret:', await caret());
    await paste();
    console.log('pasted straight back equals original:', (await modelText()) === original);

    // The last item, then the only item: the list itself goes.
    await click('.rich li:has-text("second item")');
    await cut();
    console.log('last item cut, caret:', await caret());
    await click('.rich li:has-text("first item")');
    await cut();
    now = await modelText();
    console.log('list gone:', !/first item|second item/.test(now), JSON.stringify(now.slice(0, 120)));
    await page.keyboard.press('Meta+z');
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(500);
    console.log('two undos restore:', (await modelText()) === original);

    // A paragraph keeps its Markdown on the clipboard and pastes back intact.
    await click('.rich p:has-text("A paragraph with")');
    await cut();
    now = await modelText();
    console.log('paragraph cut:', !now.includes('A paragraph'), '| clipboard:', JSON.stringify((await clip()).text), '| caret:', await caret());
    await paste();
    console.log('paragraph pasted back equals original:', (await modelText()) === original);

    // A cut line pastes as a whole line above the caret's line, taking the shape of what it lands in.
    await click('.rich p:has-text("A paragraph with")');
    await cut();
    await click('.rich li:has-text("second item")');
    await paste();
    console.log('paragraph onto a bullet:', JSON.stringify((await modelText()).split('\n').filter((l) => /item|paragraph/.test(l))), '| caret:', await caret());
    await page.keyboard.press('Meta+z');
    await page.keyboard.press('Meta+z');
    await click('.rich li:has-text("first item")');
    await cut();
    await click('.rich p:has-text("See")');
    await paste();
    console.log('bullet onto the paragraph after its list:', JSON.stringify((await modelText()).split('\n').slice(3, 8)));
    await click('.rich h1');
    await paste();
    console.log('bullet onto the heading:', JSON.stringify((await modelText()).split('\n').slice(0, 4)));
    await page.keyboard.press('Meta+z');
    await page.keyboard.press('Meta+z');
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(500);
    console.log('undone:', (await modelText()) === original);

    // Task and numbered items keep their markers as text.
    await click('.rich li:has-text("done task")');
    await cut();
    console.log('task clipboard:', JSON.stringify((await clip()).text));
    await click('.rich li:has-text("two")');
    await cut();
    console.log('numbered clipboard:', JSON.stringify((await clip()).text));
    await page.keyboard.press('Meta+z');
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(400);

    // A heading; then one line of a code block.
    await click('.rich h1');
    await cut();
    console.log('heading clipboard:', JSON.stringify((await clip()).text), '| gone:', !(await modelText()).startsWith('# Plan'));
    await page.keyboard.press('Meta+z');
    await click('.rich pre');
    await page.keyboard.press('Meta+ArrowRight');
    await page.keyboard.press('Enter');
    await type('echo two');
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(200);
    await cut();
    now = await modelText();
    console.log('code line cut:', JSON.stringify(now.slice(now.indexOf('```'))), '| clipboard:', JSON.stringify((await clip()).text));

    // An empty line is removed without touching the clipboard.
    await click('.rich p:has-text("A paragraph with")');
    await page.keyboard.press('Meta+ArrowRight');
    await page.keyboard.press('Enter');
    const blocks = await page.evaluate(() => document.querySelector('.rich').children.length);
    await cut();
    console.log('empty line removed:', (await page.evaluate(() => document.querySelector('.rich').children.length)) === blocks - 1, '| clipboard kept:', JSON.stringify((await clip()).text));

    // A real selection still cuts only the selection.
    await click('.rich p:has-text("A paragraph with") strong', 'dblclick');
    await cut();
    now = await modelText();
    console.log('selection cut:', JSON.stringify((await clip()).text), now.includes('A paragraph with') && !now.includes('bold'));
    await shot('cutline');
  } finally {
    await app.evaluate(async ({ clipboard }) => { try { await clipboard.write(globalThis.__clip); } catch { await clipboard.writeText(globalThis.__clipText); } });
  }
}
