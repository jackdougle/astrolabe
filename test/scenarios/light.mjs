// ⌘0 switches light mode on and off: the whole window changes (terminals, notes, code, navigator, tabs), the dark
// theme you had comes back on the way out, and the choice is kept. Reset zoom moved to ⌥⌘0.
import fs from 'node:fs';
import path from 'node:path';
export const settings = { zoom: 1, previewTabs: false, theme: 'antares' };
export default async function ({ page, shot, run, work }) {
  const ok = (name, pass, detail = '') => console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  const at = (ms) => page.waitForTimeout(ms);
  const look = () => page.evaluate(() => {
    const s = window.__store.getState().settings;
    const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; };
    const css = getComputedStyle(document.documentElement);
    const hex = (v) => { const h = css.getPropertyValue(v).trim(); return `rgb(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)})`; };
    const term = [...window.__sessions.values()][0].term.options.theme;
    const fg = term.foreground; const termFg = `rgb(${parseInt(fg.slice(1, 3), 16)}, ${parseInt(fg.slice(3, 5), 16)}, ${parseInt(fg.slice(5, 7), 16)})`;
    const note = document.querySelector('.rich p'); const code = document.querySelector('.editor-host .view-line span span');
    return { theme: s.theme, mode: document.documentElement.dataset.theme, zoom: s.zoom, bg: lum(hex('--bg')), text: lum(hex('--text')), term: lum(termFg), note: note ? lum(getComputedStyle(note).color) : null, code: code ? lum(getComputedStyle(code).color) : null };
  });
  await run(`cd ${work}`);
  await run('ls -la && git init -q . && echo done', 900);
  await run(`printf '\\e[38;5;76mpale green 76\\e[0m \\e[38;5;226myellow 226\\e[0m \\e[38;5;250mgrey 250\\e[0m \\e[38;2;200;230;255mtruecolour pale blue\\e[0m \\e[97mbright white\\e[0m\\n'`, 700);
  await page.evaluate((p) => window.__store.getState().openFile(p, null, { keep: true }), path.join(work, 'notes', 'plan.md'));
  await at(1300);
  let s = await look();
  ok('starts in the dark theme that was chosen', s.theme === 'antares' && s.mode === 'dark' && s.bg < 0.2 && s.text > 0.6, JSON.stringify(s));
  await page.keyboard.press('Meta+0'); await at(700);
  s = await look();
  ok('⌘0 goes to light: light ground, dark words, in terminals and notes alike', s.mode === 'light' && s.bg > 0.85 && s.text < 0.3 && s.term < 0.3 && s.note < 0.3, JSON.stringify(s));
  await shot('light-1-note');
  await page.evaluate(() => window.__store.getState().setSidebar({ visible: true })); await at(500);
  await page.evaluate((p) => window.__store.getState().openFile(p, null, { keep: true }), path.join(work, 'main.py')); await at(900);
  fs.appendFileSync(path.join(work, 'main.py'), '\n# a line from outside\n'); await at(900);
  await shot('light-2-code');
  await page.keyboard.press('Meta+p'); await at(500);
  await shot('light-3-palette');
  await page.keyboard.press('Escape'); await at(300);
  await page.keyboard.press('Meta+='); await at(300);
  await page.keyboard.press('Alt+Meta+0'); await at(300);
  ok('⌥⌘0 resets the zoom now', (await look()).zoom === 1 && (await look()).mode === 'light');
  await page.keyboard.press('Meta+0'); await at(700);
  s = await look();
  ok('⌘0 again goes back to the dark theme that was in use', s.theme === 'antares' && s.mode === 'dark' && s.term > 0.6, JSON.stringify(s));
  await page.keyboard.press('Meta+0'); await at(500);
  ok('and to light once more', (await look()).mode === 'light');
}
