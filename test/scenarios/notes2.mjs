// Rendered notes, round of 2026-11-25: tight lists in the file, empty lines as blank lines, Backspace on an empty
// line, Tab/Shift+Tab moving only the chosen notes, numbering 1. a. i. ■, visible heading #s and their sizes,
// toggles holding bullets (or the numbering they sit in), and links by ⌘K, ⇧⌘V and [words](address).
import fs from 'node:fs';
import path from 'node:path';

export const settings = { zoom: 1, previewTabs: false };
export default async function ({ app, page, work, logs, shot }) {
  let fails = 0;
  const ok = (name, pass, detail = '') => { if (!pass) fails += 1; console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail && !pass ? `: ${detail}` : ''}`); };
  const at = (ms) => page.waitForTimeout(ms);
  const open = async (file) => { await page.evaluate((file) => window.__store.getState().openFile(file, null, { keep: true }), file); await at(1300); };
  const text = (file) => page.evaluate((file) => window.__monaco.editor.getModels().find((m) => m.uri.path === file).getValue(), file);
  const k = async (key, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(key); await at(150); } };
  const t = async (s) => { await page.keyboard.type(s, { delay: 15 }); await at(220); };
  const fresh = async (name, body) => { const f = path.join(work, 'notes', name); fs.writeFileSync(f, body); await open(f); return f; };
  // Selects `word` in the note's text, as a mouse would.
  const pick = async (word) => { await page.evaluate((word) => { const w = document.createTreeWalker(document.querySelector('.rich'), NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const i = n.textContent.indexOf(word); if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + word.length); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return; } } }, word); await at(250); };
  const endOf = async (sel) => { await page.click(sel); await at(200); await k('End'); };

  // 1. typed numbered list nests 1. a. i. ■ and is written tight
  let f = await fresh('a.md', 'Start\n');
  await endOf('.rich p >> nth=0'); await k('Enter');
  await t('1. one'); await k('Enter'); await k('Tab'); await t('sub a'); await k('Enter'); await k('Tab'); await t('sub i'); await k('Enter'); await k('Tab'); await t('sub sq');
  await k('Enter'); await k('Shift+Tab'); await k('Shift+Tab'); await k('Shift+Tab'); await t('two'); await at(500);
  ok('typed list is tight in the file', (await text(f)) === 'Start\n\n1. one\n   1. sub a\n      1. sub i\n         1. sub sq\n2. two\n', JSON.stringify(await text(f)));
  const styles = await page.evaluate(() => [...document.querySelectorAll('.rich ol')].map((o) => getComputedStyle(o).listStyleType));
  ok('numbering runs 1. a. i. square', styles.join() === 'decimal,lower-alpha,lower-roman,square', styles.join());

  // 2. empty lines
  f = await fresh('b.md', 'Alpha\n');
  await endOf('.rich p >> nth=0'); await k('Enter'); await k('Enter'); await k('Enter'); await t('Beta'); await at(500);
  ok('two empty lines are two blank lines, no <br />', (await text(f)) === 'Alpha\n\n\n\nBeta\n', JSON.stringify(await text(f)));
  fs.writeFileSync(path.join(work, 'notes', 'b2.md'), 'Alpha\n\n\n\nBeta\n'); await open(path.join(work, 'notes', 'b2.md'));
  ok('and read back as two empty lines', (await page.evaluate(() => [...document.querySelectorAll('.rich > p')].map((p) => p.textContent).join('|'))) === 'Alpha|||Beta');

  f = await fresh('b3.md', 'Alpha\n');
  await endOf('.rich p >> nth=0'); await k('Enter'); await t('Beta'); await at(400);
  await endOf('.rich p:text-is("Alpha")'); await k('Enter'); await at(500);
  ok('an empty line beside a block typed earlier is one blank line', (await text(f)) === 'Alpha\n\n\nBeta\n', JSON.stringify(await text(f)));

  // 3. Backspace on an empty new note removes it
  f = await fresh('c.md', '1. one\n2. two\n3. three\n');
  await endOf('.rich li p:text-is("two")'); await k('Enter'); await at(300); await k('Backspace'); await at(300); await t('X'); await at(400);
  ok('Backspace on an empty note deletes it, caret to the line above', (await text(f)) === '1. one\n2. twoX\n3. three\n', JSON.stringify(await text(f)));
  f = await fresh('c2.md', 'para\n\n- a\n- b\n');
  await endOf('.rich p:text-is("para")'); await k('Enter'); await k('Backspace'); await t('Y'); await at(400);
  ok('Backspace on an empty line deletes it', (await text(f)) === 'paraY\n\n- a\n- b\n', JSON.stringify(await text(f)));

  // 4. Tab and Shift+Tab move only the chosen notes
  f = await fresh('d.md', '- a\n- b\n  - b1\n  - b2\n- c\n');
  await endOf('.rich li p:text-is("b")'); await k('Tab'); await at(400);
  ok('Tab moves only b', (await text(f)) === '- a\n  - b\n  - b1\n  - b2\n- c\n', JSON.stringify(await text(f)));
  await k('Shift+Tab'); await at(400);
  ok('Shift+Tab moves only b', (await text(f)) === '- a\n- b\n  - b1\n  - b2\n- c\n', JSON.stringify(await text(f)));
  await endOf('.rich li p:text-is("b1")'); await k('Shift+Tab'); await at(400);
  ok('Shift+Tab on b1 takes b2 under it', (await text(f)) === '- a\n- b\n- b1\n  - b2\n- c\n', JSON.stringify(await text(f)));
  await t('!'); await at(300);
  ok('caret stays in its line', (await text(f)).includes('- b1!\n'), JSON.stringify(await text(f)));
  await endOf('.rich li p:text-is("a")'); await k('ArrowDown'); await k('Shift+ArrowDown'); await k('Tab'); await at(400);
  ok('Tab on two selected notes moves both, and not the note under them', (await text(f)) === '- a\n  - b\n  - b1!\n  - b2\n- c\n', JSON.stringify(await text(f)));
  f = await fresh('d2.md', '1. one\n2. two\n');
  await endOf('.rich li p:text-is("two")'); await k('Enter'); await t('- mixed'); await k('Tab'); await at(400);
  ok('a bullet nests under a numbered note', /^1\. one\n2\. two\n {3}- mixed\n$/.test(await text(f)), JSON.stringify(await text(f)));

  // 5. headings: #s only on the caret's heading line, none hidden elsewhere; sizes
  f = await fresh('e.md', '# One\n\n###### Six\n\ntext\n');
  const heads = () => page.evaluate(() => [...document.querySelectorAll('.rich h1, .rich h6')].map((h) => ({ t: h.textContent, size: parseFloat(getComputedStyle(h).fontSize), hash: h.querySelector('.rich-hash') ? parseFloat(getComputedStyle(h.querySelector('.rich-hash')).fontSize) : 0 })));
  await page.click('.rich p:text-is("text")'); await at(300);
  let hs = await heads();
  ok('away from headings, no #s at all', hs.length === 2 && hs[0].t === 'One' && hs[1].t === 'Six', JSON.stringify(hs));
  await page.click('.rich h6'); await at(400);
  hs = await heads();
  ok('the caret on a heading shows its #s', hs[0].t === 'One' && hs[1].t === '###### Six' && hs[1].hash > 0, JSON.stringify(hs));
  await page.evaluate(() => document.activeElement.blur()); await at(300);
  ok('and they stay visible, never folded away', (await heads())[1].hash > 0);
  await page.click('.rich p:text-is("text")'); await at(400);
  ok('leaving takes them away', (await heads()).every((h) => !h.t.includes('#')), JSON.stringify(await heads()));
  const base = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.rich p')).fontSize));
  hs = await heads();
  ok('h1 2.2x text, h6 text + 1px', Math.abs(hs[0].size - base * 2.2) < 0.2 && Math.abs(hs[1].size - (base + 1)) < 0.2, `${base} ${JSON.stringify(hs)}`);
  ok('the file has no stray #s', (await text(f)) === '# One\n\n###### Six\n\ntext\n', JSON.stringify(await text(f)));
  await page.click('.rich h6'); await at(300); await k('Home'); await k('Delete'); await at(400);
  ok('deleting a # makes the heading a level bigger', (await text(f)) === '# One\n\n##### Six\n\ntext\n', JSON.stringify(await text(f)));
  await k('End'); await k('Home'); await at(200); await k('ArrowRight', 6); await t('### '); await at(300);
  ok('"### " typed after the #s sets the level', (await text(f)) === '# One\n\n### Six\n\ntext\n', JSON.stringify(await text(f)));

  // 6. toggles hold bullets; in a numbered list, the next numbering
  f = await fresh('g.md', 'Top\n');
  await endOf('.rich p >> nth=0'); await k('Enter'); await t('> tog'); await k('Enter'); await t('first'); await k('Enter'); await t('second'); await at(500);
  ok('a toggle holds bullets', (await text(f)) === 'Top\n\n<details open>\n<summary>tog</summary>\n\n- first\n- second\n\n</details>\n', JSON.stringify(await text(f)));
  f = await fresh('g2.md', '1. one\n   1. sub\n2. two\n');
  await endOf('.rich li li p'); await k('Home'); await t('> '); await at(300); await k('End'); await k('Enter'); await t('inner'); await at(500);
  const tg = await page.evaluate(() => { const ol = document.querySelector('.rich li .toggle ol'); return ol ? getComputedStyle(ol).listStyleType : 'none'; });
  ok('a toggle under a numbered note holds numbered notes one step on (i.)', tg === 'lower-roman', `${tg} ${JSON.stringify(await text(f))}`);
  f = await fresh('g3.md', '- a\n- b\n- c\n');
  await endOf('.rich li p:text-is("b")'); await k('Home'); await t('> '); await at(400);
  ok('> on one bullet makes only it a toggle', (await text(f)) === '- a\n\n<details open>\n<summary>b</summary>\n\n</details>\n\n- c\n', JSON.stringify(await text(f)));

  // 7. links
  f = await fresh('h.md', 'go to the site now\n');
  await page.click('.rich p'); await pick('site');
  await page.keyboard.press('Meta+k'); await at(300);
  ok('⌘K opens the link box', await page.isVisible('.link-box .link-input'));
  await page.keyboard.type('https://example.com', { delay: 5 }); await page.keyboard.press('Enter'); await at(500);
  ok('the box links the words', (await text(f)) === 'go to the [site](https://example.com) now\n', JSON.stringify(await text(f)));
  // (The real clipboard: what was on it is put back straight after.)
  const was = await app.evaluate(({ clipboard }) => clipboard.readText());
  await app.evaluate(({ clipboard }) => clipboard.writeText('https://anthropic.com'));
  await pick('now');
  await page.keyboard.press('Meta+Shift+v'); await at(600);
  await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), was);
  ok('⇧⌘V links the words to the copied address', (await text(f)) === 'go to the [site](https://example.com) [now](https://anthropic.com)\n', JSON.stringify(await text(f)));
  ok('and the note stayed rendered', await page.isVisible('.rich'));
  await fresh('h2.md', 'go\n'); await endOf('.rich p'); await t(' [more](https://x.org)'); await at(400);
  ok('[words](address) typed becomes a link', (await page.evaluate(() => [...document.querySelectorAll('.rich a')].map((a) => a.textContent).join('|'))) === 'more');
  await shot('notes2');
  ok('the bridge never fell back to writing the whole text', !logs.some((l) => l.includes('bridge:')), logs.filter((l) => l.includes('bridge:')).join(' | '));
  console.log(fails ? `${fails} FAILED` : 'all passed');
}
