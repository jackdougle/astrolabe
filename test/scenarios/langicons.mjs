// Code file tabs show their language's logo (fileIcons.ts / logos.ts / Icons.tsx), which turns neon and pulses when
// the file is unsaved. Also checks the rendered note title colour and the rounded, slightly larger toggle chevron.
import fs from 'node:fs';
export default async function ({ page, run, type, work, shot }) {
  const files = {
    'app.ts': 'export const x: number = 1\n',
    'lib.rs': 'fn main() { println!("hi"); }\n',
    'calc.jl': 'println("hi")\n',
    'style.css': 'body { color: red; }\n',
    'index.html': '<!doctype html><title>x</title>\n',
    'app.js': 'console.log(1)\n',
    'run.sh': 'echo hi\n',
    'notes/toggle note.md': 'Intro paragraph.\n\n<details open>\n<summary>A toggle to look at</summary>\n\nHidden line.\n\n</details>\n\nAfter.\n',
  };
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(`${work}/${name}`, body);
  await run(`cd ${work}`);

  const open = async (q) => { await page.keyboard.press('Meta+o'); await page.waitForTimeout(300); await type(q); await page.keyboard.press('Enter'); await page.waitForTimeout(700); };
  // main.py and data.json already exist (drive.mjs). Open a spread of languages.
  for (const q of ['main.py', 'data.json', 'app.ts', 'lib.rs', 'calc.jl', 'style.css', 'index.html', 'app.js', 'run.sh']) await open(q);

  // The glyph each code tab resolved to, and that md/txt keep the plain page icon.
  const tabs = () => page.evaluate(() => [...document.querySelectorAll('.filetab')].map((t) => {
    const name = t.querySelector('.filetab-name')?.textContent;
    const paths = [...t.querySelectorAll('.tab-file svg *')].length;
    const dirty = t.querySelector('.tab-file')?.classList.contains('is-dirty') || false;
    return `${name}:${paths}p${dirty ? ' DIRTY' : ''}`;
  }).join('  '));
  console.log('tabs:', await tabs());
  await shot('langicons-1-tabs');

  // Make a code file dirty: its language mark should go neon-blue and pulse. A ⌘P open leaves focus in Monaco.
  await open('app.ts');
  await type('// edit'); await page.waitForTimeout(500);
  console.log('after edit:', await tabs());
  const dirtyIcon = await page.evaluate(() => { const s = document.querySelector('.filetab .tab-file.is-dirty'); return s ? getComputedStyle(s).color : null; });
  console.log('dirty icon colour:', dirtyIcon);
  await shot('langicons-2-dirty');

  // The rendered note: title colour (should be the accent blue) and the toggle chevron.
  await open('toggle note.md');
  const info = await page.evaluate(() => {
    const t = document.querySelector('.rich-title');
    const before = (() => { try { const b = getComputedStyle(document.querySelector('.rich .toggle'), '::before'); return { w: b.width, h: b.height, masked: b.maskImage !== 'none' || b.webkitMaskImage !== 'none', bg: b.backgroundColor }; } catch { return null; } })();
    return { title: t?.textContent, titleColor: t ? getComputedStyle(t).color : null, accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(), chevron: before };
  });
  console.log('note:', JSON.stringify(info));
  await shot('langicons-3-note');
}
