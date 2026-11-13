// Bullet points sit evenly: no wider gap between two of them than between any others, whichever way the list came
// about (written tight or with blank lines, two lists side by side, a line taken out of a list and put back).
import fs from 'node:fs';
export default async function ({ page, run, type, work, shot }) {
  const file = `${work}/notes/gaps.md`;
  const SRC = 'Tight:\n\n- t one\n- t two\n- t three\n\nLoose:\n\n- l one\n\n- l two\n\n- l three\n\nTwo lists, other marks:\n\n- m one\n- m two\n\n* m three\n* m four\n\nNested:\n\n- n one\n  - n child\n- n two\n\nTwo paragraphs in one:\n\n- p one\n\n  p more\n- p two\n\nMixed kinds:\n\n- k bullet\n- [ ] k todo\n\n1. k number\n2. k second\n\nEnd\n';
  fs.writeFileSync(file, SRC);
  await run(`cd ${work}`);
  await page.keyboard.press('Meta+p'); await page.waitForTimeout(350); await type('gaps.md'); await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
  await page.keyboard.press('Control+Meta+f'); await page.waitForTimeout(500);
  const text = () => page.evaluate((f) => window.__monaco.editor.getModels().find((m) => m.uri.path === f)?.getValue(), file);
  // The distance from each note's first line to the next one's, in line heights of the note's text.
  const gaps = () => page.evaluate(() => {
    const lines = [...document.querySelectorAll('.rich li > p:first-child, .rich > p')].map((p) => ({ t: p.textContent, y: p.getBoundingClientRect().top, h: p.getBoundingClientRect().height, li: p.parentElement.tagName === 'LI' }));
    const pitch = parseFloat(getComputedStyle(document.querySelector('.rich p')).lineHeight);
    const out = [];
    for (let i = 0; i + 1 < lines.length; i++) if (lines[i].li && lines[i + 1].li) out.push(`${lines[i].t} > ${lines[i + 1].t}: ${((lines[i + 1].y - lines[i].y - lines[i].h) / pitch).toFixed(2)}`);
    return out;
  });
  const lists = () => page.evaluate(() => [...document.querySelector('.rich').children].map((e) => (e.tagName === 'UL' || e.tagName === 'OL' ? `${e.tagName}(${e.children.length})` : e.tagName)).join(' '));
  console.log('gap after each bullet, in lines:\n  ' + (await gaps()).join('\n  '));
  console.log('blocks:', await lists());
  await shot('listgaps-opened');
  console.log('file untouched by opening:', (await text()) === SRC);

  // A line taken out of a list (Backspace at its start) and made a bullet again.
  const li = (t) => `.rich li:has(> p:text-is("${t}")) > p`;
  const key = async (k, wait = 250) => { await page.keyboard.press(k); await page.waitForTimeout(wait); };
  await page.click(li('t two')); await page.waitForTimeout(250); await key('Meta+ArrowLeft'); await key('Backspace');
  console.log('Backspace at the start of "t two":', (await lists()).split(' ').slice(0, 5).join(' '));
  await type('- '); await page.waitForTimeout(400);
  console.log('"- " again:', (await lists()).split(' ').slice(0, 4).join(' '), '|', (await gaps()).slice(0, 2).join(' | '), '\n  file:', JSON.stringify((await text()).split('Tight:\n\n')[1].split('\nLoose')[0]));
  // Enter twice in the middle of a list leaves the list, then a bullet typed there.
  await page.click(li('l one')); await key('Meta+ArrowRight'); await key('Enter'); await key('Enter'); await type('between'); await page.waitForTimeout(300);
  const out = (await lists()).split(' ').slice(3, 8).join(' ');
  await key('Meta+ArrowLeft'); await type('- '); await page.waitForTimeout(400);
  console.log('Enter twice after "l one", a line typed:', out, '| then "- ":', (await lists()).split(' ').slice(3, 6).join(' '), '\n  file:', JSON.stringify((await text()).split('Loose:\n\n')[1].split('\nTwo lists')[0]));
  // The paragraph between two lists deleted.
  await shot('listgaps-edited');
  console.log('gaps now:\n  ' + (await gaps()).join('\n  '));
}
