// Rendered headings: each level is larger than the text, and the one the caret is in shows its #s. The #s are
// text: the caret runs through them, they can be selected, and adding or deleting one changes the level.
// Backspace where a heading's words begin takes one # away.
import fs from 'node:fs';
import path from 'node:path';
export default async function ({ page, shot, run, type, work }) {
  const file = path.join(work, 'notes', 'levels.md');
  const text = 'Opening line.\n\n# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six\n\nBody text for comparison.\n';
  fs.writeFileSync(file, text);
  await run(`cd ${work}`);
  await page.keyboard.press('Meta+p'); await page.waitForTimeout(350); await type('levels'); await page.keyboard.press('Enter'); await page.waitForTimeout(1300);
  // Each block: its tag, the #s on show (none when folded away), its words, its size.
  const blocks = () => page.evaluate(() => [...document.querySelectorAll('.rich > *')].map((e) => {
    const shown = [...e.querySelectorAll('.rich-hash')].filter((h) => parseFloat(getComputedStyle(h).fontSize) > 1).map((h) => h.textContent).join('');
    const hidden = [...e.querySelectorAll('.rich-hash')].map((h) => h.textContent).join('');
    return `${e.tagName} [${shown}]${e.textContent.slice(hidden.length)} ${getComputedStyle(e).fontSize}`;
  }));
  const brief = async () => (await blocks()).map((b) => b.replace(/ [\d.]+px$/, ''));
  const hashes = async () => (await brief()).filter((b) => !b.includes('[]'));
  // What lies between the start of the caret's block and the caret, and what is selected.
  const caret = () => page.evaluate(() => {
    const sel = getSelection();
    if (!sel.rangeCount) return null;
    let block = sel.focusNode; while (block && block.parentElement && !block.parentElement.classList.contains('rich')) block = block.parentElement;
    const r = document.createRange(); r.selectNodeContents(block); r.setEnd(sel.focusNode, sel.focusOffset);
    return { before: r.toString(), selected: sel.toString() };
  });
  const dirty = () => page.evaluate(() => !!document.querySelector('.tab-file.is-dirty'));
  const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(260); } };
  const into = async (sel, dx) => { const b = await page.locator(sel).boundingBox(); await page.mouse.click(b.x + (dx ?? b.width / 2), b.y + b.height / 2); await page.waitForTimeout(350); };
  const saved = async () => { await key('Meta+s'); await page.waitForTimeout(300); return fs.readFileSync(file, 'utf8'); };

  console.log('sizes:', JSON.stringify(await blocks()));
  console.log('caret in the opening line, #s shown on:', JSON.stringify(await hashes()));
  await shot('hashes-none');
  await into('.rich h3', 40);
  console.log('click in Three:', JSON.stringify(await hashes()), JSON.stringify(await caret()));
  await shot('hashes-three');

  // The caret runs through the #s and selects them.
  await key('Meta+ArrowLeft'); console.log('⌘← :', JSON.stringify(await caret()));
  await key('ArrowRight', 2); console.log('→ → :', JSON.stringify(await caret()));
  await key('Shift+ArrowRight', 2); console.log('⇧→ ⇧→ :', JSON.stringify(await caret()));
  await shot('hashes-selected');
  await key('ArrowLeft'); console.log('← (collapse):', JSON.stringify(await caret()));
  // Editing them changes the level.
  await type('#'); await page.waitForTimeout(300); console.log('typed # among them:', JSON.stringify((await brief())[3]), JSON.stringify(await caret()));
  await key('Backspace'); console.log('Backspace among them:', JSON.stringify((await brief())[3]), JSON.stringify(await caret()));
  await key('Backspace'); console.log('Backspace again:', JSON.stringify((await brief())[3]), JSON.stringify(await caret()));
  await key('Meta+ArrowLeft'); await type('#'); await page.waitForTimeout(300); console.log('# typed in front:', JSON.stringify((await brief())[3]), JSON.stringify(await caret()));
  await key('ArrowDown'); console.log('↓ leaves it:', JSON.stringify(await hashes()));
  console.log('file:', JSON.stringify((await saved()).split('\n').filter((l) => /Three/.test(l))));
  // Undo takes the edits back, one level at a time, with the caret out of the heading or in it.
  await key('Meta+z'); console.log('undo 1:', JSON.stringify((await brief())[3]));
  await key('Meta+z'); console.log('undo 2:', JSON.stringify((await brief())[3]));
  await key('Meta+z'); console.log('undo 3:', JSON.stringify((await brief())[3]));
  await key('Meta+z'); console.log('undo 4:', JSON.stringify((await brief())[3]));
  console.log('file as it began:', (await saved()) === text);
  for (const n of [1, 2, 3]) { await key('Meta+Shift+z'); console.log(`redo ${n}:`, JSON.stringify((await brief())[3]), JSON.stringify(await caret())); }
  await key('Meta+z', 4); console.log('undo x4:', JSON.stringify((await brief())[3]), '| file as it began:', (await saved()) === text);

  // Stepping in with → from the line above arrives in front of the #s.
  await into('.rich > p:first-child', 30); await key('Meta+ArrowRight'); await key('ArrowRight');
  console.log('→ from the line above:', JSON.stringify(await hashes()), JSON.stringify(await caret()));
  await key('ArrowRight', 3); console.log('→ x3:', JSON.stringify(await caret()));
  await key('ArrowLeft', 3); await key('ArrowLeft'); console.log('← back out:', JSON.stringify(await hashes()), JSON.stringify(await caret()));

  // Without its space the line is no heading, in the file or here; with it back, it is one again.
  await into('.rich h2', 40); await key('Meta+ArrowLeft'); await key('ArrowRight', 2); await key('Delete');
  console.log('space deleted:', JSON.stringify((await brief())[2]), JSON.stringify(await caret()));
  await type(' '); await page.waitForTimeout(300); console.log('space typed:', JSON.stringify((await brief())[2]), JSON.stringify(await caret()));
  // Too many #s.
  await into('.rich h6', 60); await key('Meta+ArrowLeft'); await type('#'); await page.waitForTimeout(300);
  console.log('seventh #:', JSON.stringify((await brief())[6]));
  await key('Backspace'); await page.waitForTimeout(200); console.log('taken back:', JSON.stringify((await brief())[6]), JSON.stringify(await caret()));
  await key('Meta+z', 6); console.log('undone, file as it began:', (await saved()) === text, JSON.stringify(await brief()));

  // Moving about leaves the file alone.
  await into('.rich h3', 40); await key('ArrowDown', 2); await key('ArrowUp', 4);
  console.log('after only moving the caret: unsaved', await dirty(), '| file as it began:', fs.readFileSync(file, 'utf8') === text);
  await into('.rich h3', 40);
  await page.click('.cmd-input'); await page.waitForTimeout(400); console.log('focus in the terminal:', JSON.stringify(await hashes()));

  // Enter before the words opens a line above; Backspace there takes a # at a time.
  await into('.rich h3', 40); await key('Meta+ArrowLeft'); await key('ArrowRight', 4); console.log('at the words:', JSON.stringify(await caret()));
  await key('Enter'); console.log('Enter there:', JSON.stringify((await brief()).slice(2, 5)));
  await key('Meta+z');
  for (const n of [1, 2, 3]) { await key('Backspace'); console.log(`### Three, Backspace x${n}:`, JSON.stringify((await blocks())[3]), JSON.stringify(await caret())); }
  // A heading just typed, with no text yet.
  await key('Meta+ArrowDown'); await key('Enter');
  await type('### '); await page.waitForTimeout(300);
  console.log('typed "### ":', JSON.stringify((await blocks()).at(-1)), JSON.stringify(await caret()));
  await shot('hashes-empty');
  for (const n of [1, 2, 3]) { await key('Backspace'); console.log(`Backspace x${n}:`, JSON.stringify((await blocks()).at(-1)), JSON.stringify(await caret())); }
  await type('#### Deep'); await page.waitForTimeout(300); await key('Meta+z'); console.log('typed "#### Deep", undo:', JSON.stringify((await blocks()).at(-1)));
  await key('Meta+Shift+z'); await type(' down'); await key('Meta+ArrowLeft'); await key('ArrowRight', 5); await key('Backspace');
  console.log('redo, Backspace at the words:', JSON.stringify((await blocks()).at(-1)));
  console.log('file:', JSON.stringify(await saved()));
}
