// Nothing scrolls sideways: the navigator, a terminal, the raw editor (lines wrap) and a rendered note (code wraps).
import fs from 'node:fs';
import path from 'node:path';
export const settings = { zoom: 1 };
export default async function ({ page, shot, run, work }) {
  const ok = (name, pass, detail = '') => console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  const at = (ms) => page.waitForTimeout(ms);
  const long = 'word '.repeat(120).trim();
  fs.writeFileSync(path.join(work, `a-file-with-a-very-long-name-${'x'.repeat(90)}.txt`), 'x');
  fs.writeFileSync(path.join(work, 'notes', 'wide.md'), `# Wide\n\n\`\`\`sh\necho ${'long-argument-'.repeat(30)}\n\`\`\`\n\n| a | b |\n|---|---|\n| ${long} | https://example.com/${'path/'.repeat(60)} |\n`);
  await run(`cd ${work}`);
  await page.keyboard.press('Meta+l'); await at(800);
  const scrolls = (sel) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) return null; el.scrollLeft = 500; const moved = el.scrollLeft; el.scrollLeft = 0; return { moved, over: getComputedStyle(el).overflowX, wider: el.scrollWidth - el.clientWidth }; }, sel);
  let r = await scrolls('.tree-scroll');
  ok('the navigator does not scroll sideways', r && r.moved === 0, JSON.stringify(r));
  await run(`printf '%s\\n' ${'y'.repeat(400)}`);
  r = await scrolls('.term-host .xterm-viewport');
  const host = await scrolls('.term-host');
  ok('a terminal does not scroll sideways', r && r.moved === 0 && host.moved === 0, JSON.stringify({ viewport: r, host }));

  await page.evaluate((f) => window.__store.getState().openFile(f, { line: 1 }, { keep: true }), path.join(work, 'main.py')); await at(1200);
  const raw = await page.evaluate(() => { const ed = window.__monaco.editor.getEditors().find((e) => e.getModel()?.uri.path.endsWith('main.py')); ed.setScrollLeft(400); return { left: ed.getScrollLeft(), wrap: ed.getOption(window.__monaco.editor.EditorOption.wordWrap), lines: ed.getModel().getLineCount(), bar: !!ed.getDomNode().querySelector('.scrollbar.horizontal:not(.invisible)') && getComputedStyle(ed.getDomNode().querySelector('.scrollbar.horizontal')).height }; });
  ok('the raw editor wraps and does not scroll sideways', raw.left === 0 && raw.wrap === 'on', JSON.stringify(raw));
  await shot('nosideways-1-raw');

  await page.evaluate((f) => window.__store.getState().openFile(f, null, { keep: true }), path.join(work, 'notes', 'wide.md'));
  await page.waitForSelector('.rich pre'); await at(900);
  r = await scrolls('.markdown');
  const pre = await scrolls('.rich pre');
  ok('a rendered note does not scroll sideways, and its code wraps', r && r.moved === 0 && pre.moved === 0 && pre.wider <= 0, JSON.stringify({ note: r, pre }));
  await shot('nosideways-2-note');
}
