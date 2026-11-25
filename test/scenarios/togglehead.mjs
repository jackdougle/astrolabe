// Toggle headings in the rendered view: "> " typed in front of a heading's #s or straight after them (or where the
// words of a heading made earlier begin) makes the heading a toggle that holds its section, with the arrow in
// front of the #s. The #s show only while it is being made. Also: a note's title takes no slash.
import fs from 'node:fs';
import path from 'node:path';
export const settings = { zoom: 1 };
export default async function ({ page, shot, run, type, work }) {
  const file = path.join(work, 'notes', 'sections.md');
  const SRC = 'Intro\n\n## Alpha\n\nalpha text\n\n### Sub\n\nsub text\n\n## Beta\n\nbeta text\n\n# Top\n\nlast\n';
  fs.writeFileSync(file, SRC);
  await run(`cd ${work}`);
  await page.evaluate((f) => window.__store.getState().openFile(f, null, { keep: true }), file);
  await page.waitForSelector('.rich h2'); await page.waitForTimeout(900);
  let fails = 0;
  const ok = (name, pass, extra = '') => { if (!pass) fails += 1; console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); };
  const text = () => page.evaluate((f) => window.__monaco.editor.getModels().find((m) => m.uri.path === f)?.getValue(), file);
  // Each top-level block; a toggle with its level, whether it is open, its title and what it holds.
  const blocks = () => page.evaluate(() => {
    const words = (e) => { const hidden = [...e.querySelectorAll('.rich-hash')].map((h) => h.textContent).join(''); return e.textContent.slice(hidden.length); };
    const one = (e) => (e.classList.contains('toggle')
      ? `toggle${e.firstElementChild.dataset.level ?? ''}${e.dataset.open === 'true' ? '' : '-shut'}(${words(e.firstElementChild)}: ${[...e.children].slice(1).map(one).join(', ')})`
      : `${e.tagName.toLowerCase()}(${words(e)})`);
    return [...document.querySelector('.rich').children].map(one).join(' ');
  });
  const caret = () => page.evaluate(() => {
    const sel = getSelection();
    let block = sel.focusNode; while (block && block.parentElement && !/^(H\d|P)$/.test(block.nodeName) && !block.classList?.contains('toggle-summary')) block = block.parentElement;
    const r = document.createRange(); r.selectNodeContents(block); r.setEnd(sel.focusNode, sel.focusOffset);
    return r.toString();
  });
  const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(240); } };
  const into = async (sel, dx = 60) => { const b = await page.locator(sel).first().boundingBox(); await page.mouse.click(b.x + dx, b.y + b.height / 2); await page.waitForTimeout(400); };
  const dirty = () => page.evaluate(() => !!document.querySelector('.tab-file.is-dirty'));

  const shown = () => page.evaluate(() => [...document.querySelectorAll('.rich .rich-hash')].map((h) => h.textContent).join('|'));

  // 1. A heading made earlier shows no #s. "> " where its words begin makes it a toggle heading holding its section.
  await into('.rich h2:has-text("Alpha")'); await key('Meta+ArrowLeft');
  ok('1 a heading from the file shows no #s with the caret in it', (await shown()) === '' && (await caret()) === '', `${await shown()} ${JSON.stringify(await caret())}`);
  await type('> '); await page.waitForTimeout(500);
  ok('1 > at its start: a toggle heading holding its section', (await blocks()) === 'p(Intro) toggle2(Alpha: p(alpha text), h3(Sub), p(sub text)) h2(Beta) p(beta text) h1(Top) p(last)', await blocks());
  ok('1 still no #s, the caret at the words', (await shown()) === '' && (await caret()) === '', `${await shown()} ${JSON.stringify(await caret())}`);
  ok('1 in the file', (await text()).startsWith('Intro\n\n<details open>\n<summary><h2>Alpha</h2></summary>\n\nalpha text\n\n### Sub\n\nsub text\n\n</details>\n\n## Beta\n'), JSON.stringify((await text()).slice(0, 120)));
  await type('> '); await page.waitForTimeout(300);
  ok('1 > again changes nothing', (await blocks()).startsWith('p(Intro) toggle2(Alpha: p(alpha text), h3(Sub), p(sub text)) h2(Beta)'), await blocks());
  await shot('togglehead-1-made');

  // 2. #s typed in front of its words set the level and are not kept; the same number changes nothing.
  await type('### '); await page.waitForTimeout(400);
  ok('2 "### " in a toggle heading\'s title: its level, and no #s kept', (await blocks()).startsWith('p(Intro) toggle3(Alpha: p(alpha text), h3(Sub), p(sub text))') && (await shown()) === '' && (await caret()) === '', `${await blocks()} | ${await shown()}`);
  await type('### '); await page.waitForTimeout(400);
  ok('2 the same number again: as it was', (await blocks()).startsWith('p(Intro) toggle3(Alpha: p(alpha text), h3(Sub), p(sub text))') && (await shown()) === '', await blocks());
  await type('## '); await page.waitForTimeout(400);
  ok('2 back to two', (await blocks()).startsWith('p(Intro) toggle2(Alpha: p(alpha text), h3(Sub), p(sub text))') && (await text()).includes('<summary><h2>Alpha</h2></summary>'), await blocks());

  // 3. While a heading is being made its #s show, and > goes before or after them.
  await into('.rich > p:has-text("last")'); await key('Meta+ArrowRight'); await key('Enter');
  await type('## Gamma'); await page.waitForTimeout(400);
  ok('3 a heading being typed shows its #s', (await shown()) === '## ' && (await blocks()).endsWith('p(last) h2(Gamma)'), `${await shown()} | ${await blocks()}`);
  await key('Meta+ArrowLeft'); await type('> '); await page.waitForTimeout(500);
  ok('3 > before the #s: a toggle heading, its #s still on show', (await blocks()).endsWith('p(last) toggle2(Gamma: )') && (await shown()) === '## ' && (await caret()) === '## ', `${await blocks()} | ${await shown()} | ${JSON.stringify(await caret())}`);
  const order = await page.evaluate(() => {
    const t = [...document.querySelectorAll('.rich .toggle')].pop(); const s = t.firstElementChild; const hash = s.querySelector('.rich-hash');
    const arrow = getComputedStyle(t, '::before'); const tb = t.getBoundingClientRect(); const range = document.createRange(); range.selectNodeContents(s); const line = range.getClientRects()[0];
    return { hash: hash?.textContent, arrowRight: tb.left + parseFloat(arrow.left) + parseFloat(arrow.width), hashLeft: hash?.getBoundingClientRect().left, arrowMid: tb.top + parseFloat(arrow.top) + parseFloat(arrow.height) / 2, lineMid: line.top + line.height / 2, size: getComputedStyle(s).fontSize, h2: '23.66px', mask: arrow.maskSize || arrow.webkitMaskSize };
  });
  ok('3 the arrow is in front of the #s', order.hash === '## ' && order.arrowRight <= order.hashLeft + 1, JSON.stringify(order));
  ok('3 the title is the size of its level, the arrow a little under the middle of the line', order.size === order.h2 && order.arrowMid - order.lineMid > 1 && order.arrowMid - order.lineMid < 5, JSON.stringify(order));
  await shot('togglehead-2-live');
  await key('ArrowLeft'); await type('#'); await page.waitForTimeout(400);
  ok('3 a # typed among them changes the size there and then', (await blocks()).endsWith('toggle3(Gamma: )') && (await shown()) === '### ', `${await blocks()} | ${await shown()}`);
  await key('Backspace'); await page.waitForTimeout(300);
  ok('3 and Backspace takes it back', (await blocks()).endsWith('toggle2(Gamma: )') && (await shown()) === '## ', `${await blocks()} | ${await shown()}`);
  await into('.rich > p:has-text("last")'); await key('Meta+ArrowRight'); await key('Enter');
  ok('3 once the caret has left, the #s are gone', (await shown()) === '', await shown());
  await type('## > Delta'); await page.waitForTimeout(500);
  ok('3 "## > " typed out: the same, as far as the next heading of its level', (await blocks()).endsWith('p(last) toggle2(Delta: ) toggle2(Gamma: )') && (await shown()) === '## ', `${await blocks()} | ${await shown()}`);
  await key('Enter'); await type('inside it'); await page.waitForTimeout(400);
  ok('3 Enter goes inside', (await blocks()).endsWith('toggle2(Delta: p(inside it)) toggle2(Gamma: )') && (await shown()) === '', `${await blocks()} | ${await shown()}`);
  await into('.rich .toggle-summary:has-text("Delta")'); await key('ArrowRight'); await key('ArrowLeft', 3);
  ok('3 coming back to it, no #s', (await shown()) === '', await shown());

  // 4. The arrow and ⌘Enter fold it; Backspace at the start of its title gives the heading and its section back.
  // The arrow: one grey whatever the pointer or the caret is doing, and it turns rather than jumps.
  const arrowOf = (title) => page.evaluate((t) => { const el = [...document.querySelectorAll('.rich .toggle')].find((x) => x.firstElementChild.textContent.includes(t)); const c = getComputedStyle(el, '::before'); const m = new DOMMatrix(c.transform); return { colour: c.backgroundColor, turn: Math.round(Math.atan2(m.b, m.a) * 180 / Math.PI) }; }, title);
  await page.mouse.move(5, 5); await page.waitForTimeout(250);
  const rest = await arrowOf('Delta');
  const box = await page.locator('.rich .toggle-summary:has-text("Delta")').boundingBox();
  await page.mouse.move(box.x + 30, box.y + box.height / 2); await page.waitForTimeout(300);
  const hovered = await arrowOf('Delta');
  await into('.rich .toggle-summary:has-text("Delta")'); await page.waitForTimeout(300);
  const careted = await arrowOf('Delta');
  ok('4 the arrow is the same grey under the pointer and with the caret in the title', rest.colour === hovered.colour && rest.colour === careted.colour, JSON.stringify([rest, hovered, careted]));
  await page.evaluate(() => { window.__delta = [...document.querySelectorAll('.rich .toggle')].find((x) => x.firstElementChild.textContent.includes('Delta')); });
  await page.keyboard.press('Meta+Enter');
  const turns = [];
  for (let i = 0; i < 8; i++) { turns.push((await arrowOf('Delta')).turn); await page.waitForTimeout(25); }
  await page.waitForTimeout(250);
  ok('4 shutting: the arrow turns through the angles between, in the same box', turns.some((a) => a > 3 && a < 87) && (await arrowOf('Delta')).turn === 0 && await page.evaluate(() => window.__delta.isConnected && window.__delta.dataset.open === 'false'), JSON.stringify(turns));
  await page.keyboard.press('Meta+Enter'); await page.waitForTimeout(60);
  const easing = await page.evaluate(() => { const p = window.__delta.querySelector('p'); return { cls: window.__delta.className, opacity: parseFloat(getComputedStyle(p).opacity) }; });
  await page.waitForTimeout(400);
  ok('4 opening: what it holds eases in, then rests', easing.cls.includes('is-opening') && easing.opacity < 1 && await page.evaluate(() => window.__delta.className === 'toggle' && getComputedStyle(window.__delta.querySelector('p')).opacity === '1'), JSON.stringify(easing));
  await type('x'); await key('Backspace');
  ok('4 and typing in it still works', (await blocks()).includes('toggle2(Delta: p(inside it))'), await blocks());

  // A press on the arrow folds the toggle and leaves the caret where it was.
  const arrowAt = (title) => page.evaluate((t) => { const el = [...document.querySelectorAll('.rich .toggle')].find((x) => x.firstElementChild.textContent.includes(t)); const r = el.getBoundingClientRect(); const s = el.firstElementChild.getBoundingClientRect(); return { x: r.left + 9, y: s.top + s.height / 2 }; }, title);
  await into('.rich .toggle-summary:has-text("Delta")', 60); const inTitle = await caret();
  let a = await arrowAt('Delta'); await page.mouse.click(a.x, a.y); await page.waitForTimeout(350);
  ok('4 a press on the arrow shuts it, the caret staying in the title where it was', (await blocks()).includes('toggle2-shut(Delta: ') && (await caret()) === inTitle && inTitle.length > 0, `${await blocks()} | ${JSON.stringify([inTitle, await caret()])}`);
  await page.mouse.click(a.x, a.y); await page.waitForTimeout(350);
  await into('.rich > p:has-text("beta text")', 30); const inBeta = await caret();
  a = await arrowAt('Delta'); await page.mouse.click(a.x, a.y); await page.waitForTimeout(350);
  ok('4 with the caret elsewhere, it stays there too', (await blocks()).includes('toggle2-shut(Delta: ') && (await caret()) === inBeta && await page.evaluate(() => getSelection().focusNode.parentElement.closest('p')?.textContent === 'beta text'), JSON.stringify([inBeta, await caret()]));
  await page.mouse.dblclick(a.x, a.y); await page.waitForTimeout(350);
  ok('4 two quick presses: open, and shut again', (await blocks()).includes('toggle2-shut(Delta: '), await blocks());
  await page.mouse.click(a.x, a.y); await page.waitForTimeout(350);
  await type('!'); await page.waitForTimeout(200); await key('Backspace');
  ok('4 and typing still goes where the caret is', (await blocks()).includes('p(beta text)') && (await blocks()).includes('toggle2(Delta: p(inside it))'), await blocks());

  await into('.rich .toggle-summary:has-text("Alpha")'); await key('Meta+Enter');
  ok('4 ⌘Enter shuts it', (await blocks()).startsWith('p(Intro) toggle2-shut(Alpha: ') && (await text()).includes('<details>\n<summary><h2>Alpha</h2></summary>'), await blocks());
  await key('Meta+Enter');
  await key('Meta+ArrowLeft'); await key('Backspace'); await page.waitForTimeout(300);
  ok('4 Backspace at the start: the heading and its section, as they were', (await blocks()).startsWith('p(Intro) h2(Alpha) p(alpha text) h3(Sub) p(sub text) h2(Beta) p(beta text) h1(Top)') && (await text()).startsWith(SRC.slice(0, 60)), await blocks());
  await key('Meta+z'); await page.waitForTimeout(300);
  ok('4 undo brings the toggle heading back', (await blocks()).startsWith('p(Intro) toggle2(Alpha: p(alpha text), h3(Sub), p(sub text))'), await blocks());

  // 5. #s typed in a plain toggle's title make it a toggle heading.
  await into('.rich > p:has-text("Intro")', 20); await key('Meta+ArrowRight'); await key('Enter'); await type('> Plain'); await key('Meta+ArrowLeft'); await type('#### '); await page.waitForTimeout(400);
  ok('5 #s typed in a plain toggle\'s title', (await blocks()).startsWith('p(Intro) toggle4(Plain: ) toggle2(Alpha') && (await shown()) === '#### ', `${await blocks()} | ${await shown()}`);

  // 6. Saved and read again, it is the same note, and resting the caret in a toggle heading is not an edit.
  await key('Meta+s'); await page.waitForTimeout(500);
  const before = await blocks();
  const saved = fs.readFileSync(file, 'utf8');
  await page.evaluate((f) => { const s = window.__store.getState(); const p = Object.values(s.panes).find((x) => x.files?.some((y) => y.path === f)); s.closeFile(p.id, f); }, file);
  await page.waitForTimeout(500);
  await page.evaluate((f) => window.__store.getState().openFile(f, null, { keep: true }), file);
  await page.waitForSelector('.rich .toggle'); await page.waitForTimeout(900);
  ok('6 read back the same', (await blocks()) === before, `${await blocks()}  vs  ${before}`);
  await into('.rich .toggle-summary:has-text("Alpha")'); await key('ArrowRight', 2); await into('.rich h3:has-text("Sub")'); await into('.rich > p:has-text("Intro")', 20);
  ok('6 and shows no #s on the way', (await shown()) === '');
  await page.waitForTimeout(500);
  ok('6 the caret passing through leaves the file alone', !(await dirty()) && (await text()) === saved);
  await into('.rich .toggle-summary:has-text("Alpha")'); await key('Meta+ArrowRight'); await type('!'); await page.waitForTimeout(500);
  ok('6 an edit to the title writes only the title', (await text()) === saved.replace('<h2>Alpha</h2>', '<h2>Alpha!</h2>'), JSON.stringify((await text()).slice(0, 80)));
  await shot('togglehead-3-end');
  console.log('file:\n' + (await text()));

  // 7. A title takes no slash, typed or pasted.
  const title = () => page.evaluate(() => document.querySelector('.rich-title').textContent);
  await page.click('.rich-title'); await page.keyboard.press('Meta+a'); await type('a/b/c'); await page.waitForTimeout(200);
  ok('7 a slash typed in the title does nothing', (await title()) === 'abc', await title());
  await page.evaluate(() => { const el = document.querySelector('.rich-title'); const sel = getSelection(); sel.collapse(el.firstChild, 1); document.execCommand('insertText', false, 'x/y/'); });
  await page.waitForTimeout(200);
  ok('7 slashes that arrive another way are taken out, the caret where it was', (await title()) === 'axybc' && await page.evaluate(() => getSelection().focusOffset === 3), `${await title()} @${await page.evaluate(() => getSelection().focusOffset)}`);
  await page.keyboard.press('Enter'); await page.waitForTimeout(900);
  ok('7 the file is renamed without them', fs.existsSync(path.join(work, 'notes', 'axybc.md')) && !(await page.evaluate(() => document.querySelector('.toast')?.textContent)), fs.readdirSync(path.join(work, 'notes')).join(' '));
  console.log(fails ? `${fails} FAILED` : 'all ok');
}
