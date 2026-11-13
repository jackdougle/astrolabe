// The raw view's editing in the rendered Markdown view: line keys, wrapping a selection, bracket pairs, the drawn caret.
import fs from 'node:fs';
import path from 'node:path';
const NOTE = ['# Plan', '', 'Intro paragraph here.', '', '- first item', '- second item', '  - nested one', '  - nested two', '- third item', '', 'After the list.', '',
  '1. one', '2. two', '3. three', '', '> quoted line', '', '```sh', 'echo one', 'echo two', 'echo three', '```', '', 'Last words here.', ''].join('\n');
export default async function ({ app, page, type, run, work, shot }) {
  fs.writeFileSync(path.join(work, 'notes', 'keys.md'), NOTE);
  const text = () => page.evaluate(() => window.__monaco.editor.getModels().find((m) => m.uri.path.endsWith('keys.md'))?.getValue());
  const lines = async (re) => (await text()).split('\n').filter((l) => re.test(l));
  // Click inside some text of the note (the note learns the caret a frame later).
  const at = (needle, off = 2) => page.evaluate(([n, o]) => {
    const w = document.createTreeWalker(document.querySelector('.rich'), NodeFilter.SHOW_TEXT);
    for (let t = w.nextNode(); t; t = w.nextNode()) {
      const i = t.nodeValue.indexOf(n);
      if (i < 0) continue;
      const r = document.createRange(); r.setStart(t, i + o); r.setEnd(t, i + o + 1);
      const b = r.getBoundingClientRect();
      return { x: b.left + 1, y: b.top + b.height / 2 };
    }
    return null;
  }, [needle, off]);
  const click = async (needle, count = 1) => { const p = await at(needle); await page.mouse.click(p.x, p.y, { clickCount: count }); await page.waitForTimeout(220); };
  const press = async (key, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(key); await page.waitForTimeout(120); } await page.waitForTimeout(260); };
  const undo = (n = 1) => press('Meta+z', n);
  const edit = async (what) => {
    await page.keyboard.down('Meta');
    await app.evaluate(({ webContents }, w) => { const wc = webContents.getAllWebContents().find((c) => c.getType() === 'window'); wc[w](); }, what);
    await page.keyboard.up('Meta');
    await page.waitForTimeout(400);
  };
  await app.evaluate(async ({ clipboard }) => { globalThis.__clip = await clipboard.read().catch(() => null); globalThis.__clipText = await clipboard.readText(); });
  try {
    await run(`cd ${work}`);
    await page.keyboard.press('Meta+p');
    await page.waitForTimeout(400);
    await type('keys');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);
    await page.keyboard.press('Control+Meta+f');
    await page.waitForTimeout(300);

    // ⌥↑ / ⌥↓: a paragraph passes through a list one item at a time, and the list closes up behind it.
    await click('After the list');
    await press('Alt+ArrowUp');
    console.log('paragraph above the last item:', JSON.stringify(await lines(/item|After/)));
    await press('Alt+ArrowUp');
    console.log('…above the item with nested ones:', JSON.stringify(await lines(/item|After|nested/)));
    await press('Alt+ArrowDown', 2);
    const base = await text();
    console.log('and back:', base === NOTE, base === NOTE ? '' : JSON.stringify(base));
    await press('Alt+ArrowDown');
    console.log('into the numbered list, which counts on:', JSON.stringify(await lines(/^\d|After/)));
    await press('Alt+ArrowUp');
    console.log('back:', (await text()) === base);

    // An item leaves its list past the paragraph above; a nested item steps out of the item it is under.
    await click('first item');
    await press('Alt+ArrowUp');
    console.log('first item above the intro:', JSON.stringify((await text()).split('\n').slice(0, 8)));
    await press('Alt+ArrowDown');
    console.log('back:', (await text()) === base);
    await click('nested one');
    await press('Alt+ArrowUp');
    console.log('nested item steps out:', JSON.stringify(await lines(/item|nested/)));
    await undo();
    await click('nested two');
    await press('Alt+ArrowDown');
    console.log('nested item steps out below:', JSON.stringify(await lines(/item|nested/)));
    await undo();
    await click('three');
    await press('Alt+ArrowUp');
    console.log('numbered items swap and renumber:', JSON.stringify(await lines(/^\d/)));
    await press('Alt+ArrowDown');
    console.log('back:', (await text()) === base);

    // Code lines move inside their block; at its edge the block moves.
    await click('echo two');
    await press('Alt+ArrowUp');
    let now = await text();
    console.log('code line up:', JSON.stringify(now.slice(now.indexOf('```'), now.lastIndexOf('```'))));
    await press('Alt+ArrowUp');
    now = await text();
    console.log('then the block, above the quote:', now.indexOf('```sh') < now.indexOf('> quoted'));
    await undo(2);
    console.log('undone:', (await text()) === base);
    await click('quoted line');
    await press('Alt+ArrowUp');
    console.log('quote moves as a line:', JSON.stringify(await lines(/^\d|quoted/)));
    await undo();

    // ⇧⌥↓ copies the line, ⇧⌘K deletes it, ⌃L selects it, ⌘↩ opens a line below.
    await click('third item');
    await press('Shift+Alt+ArrowDown');
    await type('X');
    await page.waitForTimeout(400);
    console.log('copied down, caret in the copy:', JSON.stringify(await lines(/thi/)));
    await undo(2);
    await click('second item');
    await press('Shift+Meta+k');
    console.log('line deleted (with what is nested in it):', JSON.stringify(await lines(/item|nested/)));
    await undo();
    await click('quoted line');
    await press('Shift+Meta+k');
    console.log('quote deleted:', !(await text()).includes('quoted'));
    await undo();
    await click('Intro paragraph');
    await press('Control+l');
    console.log('⌃L selects:', JSON.stringify(await page.evaluate(() => getSelection().toString())));
    await press('Control+l');
    console.log('⌃L again takes the next line:', JSON.stringify(await page.evaluate(() => getSelection().toString())));
    await press('Alt+ArrowDown');
    console.log('both selected lines move together:', JSON.stringify(await lines(/item|Intro/)));
    await undo();
    await click('second item');
    await press('Meta+Enter');
    await type('new');
    await page.waitForTimeout(400);
    console.log('⌘↩ new item below:', JSON.stringify(await lines(/item|nested|new/)));
    await undo(2);
    console.log('undone:', (await text()) === base, (await text()) === base ? '' : JSON.stringify(await text()));

    // ⌘C with nothing selected copies the line.
    await click('After the list');
    await edit('copy');
    console.log('line copied:', JSON.stringify(await app.evaluate(async ({ clipboard }) => clipboard.readText())), '| note unchanged:', (await text()) === base);

    // Typing a bracket or a Markdown mark over a selection goes around it.
    const word = async (key, n = 1) => { await click('Intro', 2); for (let i = 0; i < n; i++) { await type(key); await page.waitForTimeout(150); } await page.waitForTimeout(350); const l = (await lines(/paragraph here/))[0]; await undo(n); return l; };
    console.log('( :', await word('('), '| [[ :', await word('[', 2), '| ` :', await word('`'));
    console.log('" :', await word('"'), "| ' :", await word("'"), '| { :', await word('{'), '| < :', await word('<'), '| "" :', await word('"', 2));
    console.log('* :', await word('*'), '| ** :', await word('*', 2), '| *** :', await word('*', 3), '| _ :', await word('_'), '| ~ :', await word('~'));
    console.log('undone:', (await text()) === base);
    await click('echo two', 2);
    await type('*');
    await page.waitForTimeout(350);
    now = await text();
    console.log('in code the characters themselves:', JSON.stringify(now.slice(now.indexOf('```'), now.lastIndexOf('```'))));
    await undo();

    // Pairs: the closing half comes with the opening one, is typed over, and goes with Backspace.
    await click('Last words');
    await press('Meta+ArrowRight');
    await type(' (ok');
    await page.waitForTimeout(300);
    console.log('auto-closed:', JSON.stringify((await lines(/Last words/))[0]));
    await type(')!');
    await page.waitForTimeout(300);
    console.log('typed over:', JSON.stringify((await lines(/Last words/))[0]));
    await type(' [');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(300);
    console.log('pair deleted together:', JSON.stringify((await lines(/Last words/))[0]));
    await type('a(b');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(250);
    await type('(');
    await page.waitForTimeout(300);
    console.log('no closing half before a letter:', JSON.stringify((await lines(/Last words/))[0]));

    // The caret is drawn where the browser's would be, and glides.
    await click('Intro paragraph');
    const c = await page.evaluate(() => {
      const el = document.querySelector('.rich-caret');
      const a = el.getBoundingClientRect();
      const r = getSelection().getRangeAt(0).getBoundingClientRect();
      return { on: el.classList.contains('is-on'), dx: Math.round(a.left - r.left), dy: Math.round(a.top - r.top), dh: Math.round(a.height - r.height), w: a.width,
        native: getComputedStyle(document.querySelector('.rich')).caretColor, glide: getComputedStyle(el).transitionProperty + ' ' + getComputedStyle(el).transitionDuration };
    });
    console.log('caret:', JSON.stringify(c));
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(40);
    const mid = await page.evaluate(() => { const a = document.querySelector('.rich-caret').getBoundingClientRect(); const r = getSelection().getRangeAt(0).getBoundingClientRect(); return Math.round(r.top - a.top); });
    await page.waitForTimeout(200);
    const end = await page.evaluate(() => { const a = document.querySelector('.rich-caret').getBoundingClientRect(); const r = getSelection().getRangeAt(0).getBoundingClientRect(); return Math.round(r.top - a.top); });
    console.log('mid-glide it is still on its way:', mid > 0, `(${mid}px to go)`, '| then arrives:', end === 0);
    await shot('richkeys');
    await page.evaluate(() => document.activeElement.blur());
    await page.waitForTimeout(150);
    console.log('hidden without focus:', await page.evaluate(() => !document.querySelector('.rich-caret').classList.contains('is-on')));
  } finally {
    await app.evaluate(async ({ clipboard }) => { try { await clipboard.write(globalThis.__clip); } catch { await clipboard.writeText(globalThis.__clipText); } });
  }
}
