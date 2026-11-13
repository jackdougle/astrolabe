// The window has two areas that know nothing of each other: terminal tabs (⌘1–9) and editors (⌥⌘1–9). The row along
// the top is cut where the window is: terminal tabs over the terminals, each editor's files over that editor.
// A terminal tab's block keeps one length however it is split. Tabs are dragged by hand and slide out of each
// other's way. A file with unsaved changes has a glowing page instead of a dot. The last terminal closes
// like any other, and ⌃⌘F brings one back on half the window.
export default async function ({ page, run, type, work, shot }) {
  const at = (ms) => page.waitForTimeout(ms);
  const px = (v) => Math.round(v);
  // The row: each stretch as kind@left+width, then its tabs. A block as [width: segments ⌘n]; a file as name(⌥⌘n).
  const row = () => page.evaluate(() => [...document.querySelectorAll('.zone')].map((z) => {
    const r = z.getBoundingClientRect();
    const state = (t) => [...t.classList].filter((c) => /^is-(active|shown|leaving)$/.test(c)).map((c) => c.slice(3)).join(',');
    const blocks = [...z.querySelectorAll('.tab-group')].map((g) => `[${Math.round(g.getBoundingClientRect().width)}: ${[...g.querySelectorAll('.toptab')].map((t) => `${t.querySelector('.top-app').textContent}(${Math.round(t.getBoundingClientRect().width)})${state(t) ? `[${state(t)}]` : ''}`).join(' ')} ${g.querySelector('.tab-num')?.dataset.key ?? ''}]`);
    const files = [...z.querySelectorAll('.file-row')].map((f) => `{${[...f.querySelectorAll('.filetab')].map((t) => `${t.querySelector('.filetab-name').textContent}${t.querySelector('.tab-file.is-dirty') ? '•' : ''}(${t.querySelector('.toptab-key')?.dataset.key ?? ''})${state(t) ? `[${state(t)}]` : ''}`).join(' ')}}`);
    return `${z.classList.contains('is-tabs') ? 'tabs' : 'files'}@${Math.round(r.left)}+${Math.round(r.width)} ${[...blocks, ...files].join(' ')}`;
  }).join('\n           '));
  // Each pane on screen as what it shows @left+width in px (and @top when it is not at the top), * for the keyboard.
  const panes = () => page.evaluate(() => {
    const s = window.__store.getState();
    const top = document.querySelector('.stack').getBoundingClientRect().top;
    return [...document.querySelectorAll('.tab-area.is-active .pane')].filter((p) => getComputedStyle(p).visibility !== 'hidden' && !p.classList.contains('is-leaving')).map((p) => {
      const r = p.getBoundingClientRect(); const st = s.panes[p.dataset.pane];
      const name = st?.kind === 'editor' ? `${(st.active ?? '').split('/').pop()}${st.files.length > 1 ? `(+${st.files.length - 1})` : ''}` : 'term';
      return { x: r.x, y: r.y, text: `${name}@${Math.round(r.x)}+${Math.round(r.width)}${r.y - top > 2 ? `,y${Math.round(r.y - top)}` : ''}${p.classList.contains('is-active') ? '*' : ''}` };
    }).sort((a, b) => a.x - b.x || a.y - b.y).map((p) => p.text).join('  ');
  });
  const look = async (label) => { await at(650); console.log(`${label}\n    row:   ${await row()}\n    panes: ${await panes()}`); };
  const open = async (name, key = 'Enter') => { await page.keyboard.press('Meta+o'); await at(350); await type(name); await page.keyboard.press(key); await at(900); };
  const editorOf = (name) => page.evaluate((name) => { const s = window.__store.getState(); return Object.values(s.panes).find((p) => p.kind === 'editor' && (p.active ?? '').endsWith(name))?.id; }, name);
  // Drags one thing to a point by hand, slowly enough to watch, and says what the row looked like on the way.
  const drag = async (from, to, { steps = 12, mid } = {}) => {
    const a = await page.locator(from).first().boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await at(80);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 8, a.y + a.height / 2, { steps: 2 });
    await page.mouse.move(to.x, to.y, { steps }); await at(260);
    const seen = mid ? await mid() : undefined;
    await page.mouse.up(); await at(600);
    return seen;
  };
  const outline = () => page.evaluate(() => { const d = document.querySelector('.pane-drop'); return d ? `${Math.round(parseFloat(d.style.left))},${Math.round(parseFloat(d.style.top))}+${Math.round(parseFloat(d.style.width))}x${Math.round(parseFloat(d.style.height))}` : 'none'; });
  const inPane = async (id, fx, fy) => { const b = await page.locator(`.pane[data-pane="${id}"]`).boundingBox(); return { x: b.x + b.width * fx, y: b.y + b.height * fy }; };

  await run(`cd ${work}`);
  await look('one terminal');
  await page.keyboard.press('Meta+d'); await at(1500); await run(`cd ${work}`);
  await page.keyboard.press('Meta+Shift+d'); await at(1500); await run(`cd ${work}`);
  await look('⌘D, ⇧⌘D: three terminals in one tab, one block of the same length');
  await open('plan'); await look('⌘O plan: the editors open beside the terminals; the row is cut at the same place');
  await shot('areas-1-split');
  await open('main.py'); await open('data.json'); await look('⌘O main, ⌘O data: three files over the editor');
  await page.keyboard.press('Meta+Shift+t'); await at(1500); await run(`cd ${work}`);
  await look('⇧⌘T: a second terminal tab; the files stay as they were');
  await shot('areas-2-two-tabs');
  await page.keyboard.press('Meta+1'); await look('⌘1: the first tab; the files stay');
  await page.keyboard.press('Meta+Alt+1'); await look('⌥⌘1: the first file, from a terminal');
  await page.keyboard.press('Meta+2'); await look('⌘2 from the editor: the second tab');

  // Dragging tabs by hand.
  let seen = await drag('.tab-group >> nth=1', await page.locator('.tab-group >> nth=0').boundingBox().then((b) => ({ x: b.x + 20, y: b.y + 13 })), { mid: () => page.evaluate(() => `dragging: ${document.querySelectorAll('.tab-group.is-dragging').length}, sliding: ${[...document.querySelectorAll('.tab-group')].filter((g) => g.getAnimations().some((a) => a.id === 'flip')).length}`) });
  await look(`dragged the second block onto the first (${seen})`);
  seen = await drag('.filetab:has-text("data.json")', await page.locator('.filetab:has-text("plan.md")').boundingBox().then((b) => ({ x: b.x + 10, y: b.y + 13 })));
  await look('dragged data.json to the front of its row');
  await shot('areas-3-reordered');

  // Unsaved changes: the page glows, no dot.
  await page.keyboard.press('Meta+Alt+2'); await at(400);
  await page.keyboard.press('Meta+Shift+r'); await at(500); await type('x'); await at(300);
  await look('typed in plan.md (raw)');
  console.log('    unsaved dots:', await page.evaluate(() => document.querySelectorAll('.toptab-dirty').length), '| glowing page:', await page.evaluate(() => { const i = document.querySelector('.tab-file.is-dirty'); return i ? `${getComputedStyle(i).animationName}, ${getComputedStyle(i).color}` : 'none'; }));
  await shot('areas-4-unsaved');
  await page.keyboard.press('Meta+z'); await at(300);

  // Two editors.
  await page.keyboard.press('Meta+Backslash'); await look('⌘\\: plan.md again in a second editor; it has its own stretch of the row');
  await open('main.py'); await look('⌘O main in the second editor: it opens there');
  await shot('areas-5-two-editors');
  const second = await editorOf('main.py');
  seen = await drag('.file-row >> nth=0 >> .filetab:has-text("data.json")', await inPane(second, 0.5, 0.9), { mid: outline });
  await look(`dragged data.json from the row to the bottom of the second editor (outline ${seen})`);
  const firstRow = await page.locator('.zone.is-files >> nth=0').boundingBox();
  seen = await drag('.zone.is-files >> nth=1 >> .filetab:has-text("data.json")', { x: firstRow.x + firstRow.width - 30, y: firstRow.y + 13 }, { mid: () => page.evaluate(() => document.querySelectorAll('.zone.is-target').length) });
  await look(`dragged data.json onto the first editor's stretch (marked: ${seen})`);

  await page.keyboard.press('Control+Meta+f'); await look('⌃⌘F in an editor: the editors fill the window, the row keeps its two sides');
  await page.keyboard.press('Control+Backquote'); await look('⌃`: the terminals fill it instead');
  await page.keyboard.press('Control+Meta+f'); await look('⌃⌘F: both again');
  await page.keyboard.press('Control+Meta+s'); await look('⌃⌘S: sides switched');
  await shot('areas-6-switched');
  await page.keyboard.press('Control+Meta+s'); await at(400);

  // The navigator shows the open file.
  await page.keyboard.press('Meta+Alt+1'); await at(300);
  await page.keyboard.press('Meta+b'); await at(700);
  await open('notes/plan');
  console.log('navigator:', await page.evaluate(() => [...document.querySelectorAll('.treerow')].map((r) => `${r.textContent}${r.classList.contains('is-active') ? `*(${getComputedStyle(r.querySelector('.tree-name')).color})` : ''}`).join(' | ')));
  await shot('areas-7-navigator');
  await page.keyboard.press('Meta+b'); await at(500);

  // The last terminal closes like any other and leaves the editors the window; ⌃⌘F brings one back on half of it.
  await page.keyboard.press('Control+Backquote'); await at(300);
  for (let i = 0; i < 8 && await page.evaluate(() => { const s = window.__store.getState(); return s.focus === 'terminal' && s.tabs.some((t) => !s.leaving[t.id]); }); i++) { await page.keyboard.press('Meta+w'); await at(500); }
  await look('⌘W in every terminal: the editors have the window');
  await page.keyboard.press('Control+Meta+f'); await at(1200);
  await look('⌃⌘F: a terminal on half the window');
  await page.keyboard.press('Meta+Shift+t'); await at(1200);
  await look('⇧⌘T still makes a terminal tab');
  await page.keyboard.press('Meta+Shift+w'); await at(900);
  await look('⇧⌘W: one terminal left');
  await run('echo alive-$((6*7))', 600);
  console.log('    the terminal ran a command (blocks):', await page.evaluate(() => document.querySelectorAll('.tab-area.is-active .blk').length));
  await page.keyboard.press('Control+Backquote'); await at(300);
  for (let i = 0; i < 8; i++) { await page.keyboard.press('Meta+w'); await at(450); if (await page.evaluate(() => !window.__store.getState().editors.root)) break; }
  await look('⌘W on every file: the editors are gone, the terminal has the window');
}
