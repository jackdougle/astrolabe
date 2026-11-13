// The graph of notes (⌘G): every note a point, every link a line, coloured by where the note lives. Also here:
// the editor toggle with its empty editor that asks for a file's name, [words](address) typed in a rendered note,
// and the file picker's order (last changed first, nothing from dot folders). REAL=/some/folder also draws that folder.
import fs from 'node:fs';
export default async function ({ page, run, type, work, shot }) {
  const at = (ms) => page.waitForTimeout(ms);
  // Forty notes in four folders: each links to the next in its folder, and every fifth to a hub at the top.
  const dirs = ['alpha', 'beta/deep', 'gamma', 'zeta'];
  fs.writeFileSync(`${work}/Hub.md`, '# Hub\n\nSee [[a0]] and [the plan](notes/plan.md).\n');
  for (const [d, dir] of dirs.entries()) {
    fs.mkdirSync(`${work}/${dir}`, { recursive: true });
    for (let i = 0; i < 10; i++) fs.writeFileSync(`${work}/${dir}/${'abgz'[d]}${i}.md`, `Next: [[${'abgz'[d]}${(i + 1) % 10}]]${i % 5 === 0 ? ' and [[Hub]]' : ''}${i === 3 ? ` and [far](../${d === 1 ? '../' : ''}zeta/z7.md)` : ''}\n\n\`[[not a link]]\`\n`);
  }
  fs.mkdirSync(`${work}/.hidden`, { recursive: true });
  fs.writeFileSync(`${work}/.hidden/secret.md`, '[[Hub]]\n');
  fs.writeFileSync(`${work}/.hidden/tool.py`, 'x = 1\n');
  await at(1200);
  fs.writeFileSync(`${work}/gamma/g4.md`, 'Changed last. [[g5]]\n');

  await run(`cd ${work}`);
  const st = () => page.evaluate(() => { const s = window.__store.getState(); return `focus ${s.focus}, full ${s.areas.full}, editors ${s.editors.root ? Object.values(s.panes).filter((p) => p.kind === 'editor').map((p) => `[${p.files.map((f) => f.path.split('/').pop()).join(',')}]`).join('') : 'none'}, on screen: ${[...document.querySelectorAll('.tab-area.is-active .pane')].filter((p) => getComputedStyle(p).visibility !== 'hidden').map((p) => (p.querySelector('.editor-pane') ? 'editor' : 'term')).join('+')}`; });

  // The file picker.
  await page.keyboard.press('Meta+o'); await at(700);
  console.log('⌘O, nothing typed:', await page.evaluate(() => [...document.querySelectorAll('.palette-row')].slice(0, 4).map((r) => r.textContent).join(' | ')));
  await type('secret'); await at(300);
  console.log('⌘O "secret":', await page.evaluate(() => [...document.querySelectorAll('.palette-row')].map((r) => r.textContent).join(' | ') || 'nothing'));
  for (let i = 0; i < 6; i++) await page.keyboard.press('Backspace');
  await type('.hidden/'); await at(300);
  console.log('⌘O ".hidden/":', await page.evaluate(() => [...document.querySelectorAll('.palette-row')].map((r) => r.textContent).join(' | ') || 'nothing'));
  await page.keyboard.press('Escape'); await at(300);

  // The editor toggle.
  await page.keyboard.press('Meta+e'); await at(700);
  console.log('⌘E, no file open:', await st(), '| prompt:', await page.evaluate(() => `${document.querySelector('.editor-empty-title')?.textContent} / focused: ${document.activeElement?.placeholder}`), '| files made:', fs.readdirSync(work).filter((f) => /Untitled/.test(f)).length);
  await shot('graph-0-empty-editor');
  await page.evaluate(() => window.__store.getState().toggleEditors()); await at(700);
  console.log('toggle again:', await st());
  await page.evaluate(() => window.__store.getState().toggleEditors()); await at(700);
  await type('Scratch'); await page.keyboard.press('Enter'); await at(1200);
  console.log('named a file "Scratch":', await st(), '| on disk:', fs.existsSync(`${work}/Scratch.md`));

  // A link typed out in a rendered note.
  await type('See [Meeting notes w/ Austin](https://google.com/a--b) then'); await at(500);
  console.log('typed a link:', await page.evaluate(() => [...document.querySelectorAll('.rich a')].map((a) => `${a.textContent} -> ${a.getAttribute('href')}`).join(' | ')), '| text:', await page.evaluate(() => document.querySelector('.rich p')?.textContent));
  await page.keyboard.press('Meta+s'); await at(500);
  console.log('file:', JSON.stringify(fs.readFileSync(`${work}/Scratch.md`, 'utf8')));
  await page.evaluate(() => window.__store.getState().toggleEditors()); await at(700);
  console.log('toggle with a file open:', await st());
  await page.evaluate(() => window.__store.getState().toggleEditors()); await at(700);
  console.log('toggle again:', await st());

  // The graph.
  await page.keyboard.press('Meta+g'); await at(2500);
  const info = () => page.evaluate(() => `${document.querySelector('.graph-count')?.textContent} | tab: ${document.querySelector('.filetab.is-active .filetab-name')?.textContent} | key: ${[...document.querySelectorAll('.graph-key div')].map((d) => d.textContent).join(', ')}`);
  console.log('⌘G:', await info());
  await shot('graph-1');
  await type('g4'); await at(500);
  console.log('typed g4:', await page.evaluate(() => document.querySelector('.graph-count')?.textContent));
  await shot('graph-2-found');
  await page.keyboard.press('Enter'); await at(1200);
  console.log('Enter opens it:', await st());
  await page.keyboard.press('Meta+Alt+2'); await at(800);
  // Click the note nearest the middle of the canvas.
  const box = await page.locator('.graph canvas').boundingBox();
  let hit = null;
  for (let r = 0; r < 220 && !hit; r += 6) for (let a = 0; a < 6.28 && !hit; a += 0.5) { const x = box.x + box.width / 2 + r * Math.cos(a), y = box.y + box.height / 2 + r * Math.sin(a); await page.mouse.move(x, y); const over = await page.evaluate(() => document.querySelector('.graph-over')?.textContent); if (over) hit = { x, y, over }; }
  console.log('hovering a note:', hit?.over);
  await shot('graph-3-hover');
  if (hit) { await page.mouse.click(hit.x, hit.y); await at(1200); console.log('clicked it:', await st()); }

  if (process.env.REAL) {
    const t0 = Date.now();
    await page.evaluate((p) => window.__store.getState().openFile(`graph:${p}`), process.env.REAL);
    await page.waitForFunction(() => /notes,/.test(document.querySelector('.graph-count')?.textContent ?? ''), null, { timeout: 60000 });
    console.log(`real folder: ${await page.evaluate(() => document.querySelector('.graph-count')?.textContent)} in ${Date.now() - t0} ms`);
    await page.keyboard.press('Control+Meta+f'); await at(4000);
    await shot('graph-4-real');
  }
}
