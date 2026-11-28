// Rendered headings: each level is larger than the text. A heading's #s show only while it is being made, from
// "### " typed until the caret leaves the line; for that time they are text, and adding or deleting one changes
// the level there and then. After that the heading shows only its words, with the caret in it or not, and #s
// typed in front of its words set its level without being kept.
import fs from 'node:fs';
import path from 'node:path';
export const settings = { zoom: 1 };
export default async function ({ page, shot, run, type, work }) {
  const file = path.join(work, 'notes', 'levels.md');
  const text = 'Opening line.\n\n# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six\n\nBody text for comparison.\n';
  fs.writeFileSync(file, text);
  await run(`cd ${work}`);
  await page.evaluate((f) => window.__store.getState().openFile(f, null, { keep: true }), file);
  await page.waitForSelector('.rich h6'); await page.waitForTimeout(900);
  let fails = 0;
  const ok = (name, pass, extra = '') => { if (!pass) fails += 1; console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };
  // Each block: its tag, the #s on show, its words.
  const blocks = () => page.evaluate(() => [...document.querySelectorAll('.rich > *')].map((e) => {
    const hashes = [...e.querySelectorAll('.rich-hash')].map((h) => h.textContent).join('');
    return `${e.tagName} [${hashes}]${e.textContent.slice(hashes.length)}`;
  }));
  const last = async () => (await blocks()).at(-1);
  const shown = async () => (await blocks()).filter((b) => !b.includes('[]'));
  const sizes = () => page.evaluate(() => [...document.querySelectorAll('.rich > *')].map((e) => parseFloat(getComputedStyle(e).fontSize)));
  const caret = () => page.evaluate(() => {
    const sel = getSelection();
    let block = sel.focusNode; while (block && block.parentElement && !block.parentElement.classList.contains('rich')) block = block.parentElement;
    const r = document.createRange(); r.selectNodeContents(block); r.setEnd(sel.focusNode, sel.focusOffset);
    return r.toString();
  });
  const dirty = () => page.evaluate(() => !!document.querySelector('.tab-file.is-dirty'));
  const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(240); } };
  const into = async (sel, dx) => { const b = await page.locator(sel).boundingBox(); await page.mouse.click(b.x + (dx ?? b.width / 2), b.y + b.height / 2); await page.waitForTimeout(400); };
  const saved = async () => { await key('Meta+s'); await page.waitForTimeout(300); return fs.readFileSync(file, 'utf8'); };

  // 1. Headings that are already there.
  const s = await sizes();
  ok('1 six levels, each larger than the next and all larger than the text', s[1] > s[2] && s[2] > s[3] && s[3] > s[4] && s[4] > s[5] && s[5] > s[6] && s[6] > s[7], JSON.stringify(s));
  await into('.rich h3', 40);
  ok('1 the caret in a heading shows no #s', (await shown()).length === 0 && (await caret()) === 'Thr', `${JSON.stringify(await shown())} ${JSON.stringify(await caret())}`);
  await key('Meta+ArrowLeft'); await key('ArrowUp', 2); await key('ArrowDown', 4); await key('ArrowRight', 3);
  ok('1 nor does moving through them', (await shown()).length === 0 && !(await dirty()) && fs.readFileSync(file, 'utf8') === text, JSON.stringify(await shown()));
  await shot('hashes-none');

  // 2. A heading being made shows its #s, and they are text until the caret leaves.
  await key('Meta+ArrowDown'); await key('Enter');
  await type('### '); await page.waitForTimeout(300);
  ok('2 "### " typed: a heading, its #s on show, the caret after them', (await last()) === 'H3 [### ]' && (await caret()) === '### ', `${await last()} ${JSON.stringify(await caret())}`);
  await type('Made'); await key('Meta+ArrowLeft'); await key('ArrowRight', 2);
  ok('2 the caret runs through them', (await caret()) === '##', JSON.stringify(await caret()));
  await type('#'); await page.waitForTimeout(300);
  ok('2 a # typed among them: a level down, at once', (await last()) === 'H4 [#### ]Made', await last());
  await key('Backspace', 2);
  ok('2 Backspace among them: up again', (await last()) === 'H2 [## ]Made', await last());
  await key('ArrowRight', 2); await key('Backspace');
  ok('2 Backspace where the words begin takes the space, not a #', (await last()) === 'P []##Made' && (await caret()) === '##', `${await last()} ${JSON.stringify(await caret())}`);
  await type(' '); await page.waitForTimeout(300);
  ok('2 and the space typed again makes the same heading', (await last()) === 'H2 [## ]Made' && (await caret()) === '## ', `${await last()} ${JSON.stringify(await caret())}`);
  await key('Backspace'); await key('Backspace'); await type(' '); await page.waitForTimeout(300);
  ok('2 a second Backspace takes a #', (await last()) === 'H1 [# ]Made', await last());
  await key('Meta+ArrowLeft'); await type('##'); await page.waitForTimeout(300);
  ok('2 #s typed in front', (await last()) === 'H3 [### ]Made', await last());
  await key('ArrowRight'); await key('Delete'); await page.waitForTimeout(200);
  ok('2 without its space the line is no heading', (await last()) === 'P []###Made', await last());
  await type(' '); await page.waitForTimeout(300);
  ok('2 with it back, it is one again', (await last()) === 'H3 [### ]Made', await last());
  await shot('hashes-making');
  await key('ArrowUp');
  ok('2 the caret leaves: the #s go', (await shown()).length === 0 && (await last()) === 'H3 []Made', JSON.stringify(await shown()));
  ok('2 in the file', (await saved()).endsWith('\n### Made\n'), JSON.stringify((await saved()).slice(-20)));
  await key('ArrowDown'); await key('Meta+ArrowLeft');
  ok('2 and do not come back with the caret', (await shown()).length === 0 && (await caret()) === '', `${JSON.stringify(await shown())} ${JSON.stringify(await caret())}`);

  // 3. #s typed in front of a finished heading's words set its level and are not kept.
  await type('##'); await page.waitForTimeout(250);
  ok('3 #s being typed are just characters', (await last()) === 'H3 []##Made', await last());
  await type(' '); await page.waitForTimeout(300);
  ok('3 with the space: the level changes, the #s are not kept', (await last()) === 'H2 []Made' && (await caret()) === '', `${await last()} ${JSON.stringify(await caret())}`);
  await type('## '); await page.waitForTimeout(300);
  ok('3 the same number: as it was', (await last()) === 'H2 []Made' && (await caret()) === '', `${await last()} ${JSON.stringify(await caret())}`);
  await type('##### '); await page.waitForTimeout(300);
  ok('3 a different one: changed', (await last()) === 'H5 []Made' && (await saved()).endsWith('\n##### Made\n'), await last());
  await key('Meta+z'); await page.waitForTimeout(300);
  ok('3 undo takes the change back (with what was typed just before it)', /^H[23] \[\]#*Made$/.test(await last()), await last());
  await key('Meta+Shift+z'); await page.waitForTimeout(300);
  await key('Enter');
  ok('3 Enter where the words begin opens a line above', (await blocks()).slice(-2).join(' ') === 'P [] H5 []Made', (await blocks()).slice(-2).join(' '));
  await key('Meta+z');
  await key('Backspace');
  ok('3 Backspace there takes a level away', (await last()) === 'H4 []Made', await last());

  // 3b. The #s alone, then their space: Backspace takes the space back and leaves every #.
  await into('.rich h2', 40); await key('Meta+ArrowDown'); await key('Enter'); await type('### '); await page.waitForTimeout(300);
  await key('Backspace');
  ok('3b "### " then Backspace leaves "###"', (await last()) === 'P []###' && (await caret()) === '###', `${await last()} ${JSON.stringify(await caret())}`);
  await key('Backspace', 3);

  // 4. Out of the note, and the file.
  await into('.rich h2', 40);
  await key('Meta+ArrowDown'); await key('Enter'); await type('# Again'); await page.waitForTimeout(300);
  ok('4 another being made', (await last()) === 'H1 [# ]Again', await last());
  await page.click('.cmd-input'); await page.waitForTimeout(500);
  ok('4 with the keyboard in the terminal its #s are folded away', await page.evaluate(() => [...document.querySelectorAll('.rich .rich-hash')].every((h) => parseFloat(getComputedStyle(h).fontSize) < 1)));
  console.log('file:', JSON.stringify(fs.readFileSync(file, 'utf8')));
  console.log(fails ? `${fails} FAILED` : 'all ok');
}
