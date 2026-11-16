// Moving things about the window by their tabs (src/lib/dock.ts). A terminal's stretch of its tab, or a file's tab,
// is carried down among the panes, and an outline shows where it would land: over another pane, the half of it on
// the pointer's side (by the pane's diagonals); close to a wall of its area, that whole side; over the other area,
// that side of the window, its own area going there. Shells keep running through all of it.
export const settings = { zoom: 1 };

export default async function ({ page, shot, run, work }) {
  const at = (ms) => page.waitForTimeout(ms);
  const name = (n) => page.evaluate((n) => { const s = window.__store.getState(); const t = s.tabs.find((x) => x.id === s.activeTab); (window.__names ??= {})[t.activePane] = n; }, n);
  const idOf = (n) => page.evaluate((n) => Object.entries(window.__names).find(([, v]) => v === n)?.[0], n);
  // Everything on screen as name@x,y+w×h in percent of the space below the row.
  const look = async (label) => {
    const out = await page.evaluate(() => {
      const all = document.querySelector('.stack').getBoundingClientRect();
      const names = window.__names ?? {};
      const s = window.__store.getState();
      const pc = (v, of) => Math.round(v / of * 100);
      const seen = [...document.querySelectorAll('.area:not(.is-hidden) .tab-area.is-active .pane')].filter((p) => getComputedStyle(p).visibility !== 'hidden' && !p.classList.contains('is-leaving')).map((p) => {
        const r = p.getBoundingClientRect();
        const pane = s.panes[p.dataset.pane];
        const what = pane?.kind === 'editor' ? `[${pane.files.map((f) => f.path.split('/').pop()).join(',')}]` : names[p.dataset.pane] ?? p.dataset.pane;
        return `${what}@${pc(r.x - all.x, all.width)},${pc(r.y - all.y, all.height)}+${pc(r.width, all.width)}x${pc(r.height, all.height)}`;
      }).sort();
      const tabs = s.tabs.map((t) => { const ids = []; const walk = (n) => (n.type === 'leaf' ? ids.push(names[n.pane] ?? n.pane) : (walk(n.a), walk(n.b))); walk(t.root); return `${t.id === s.activeTab ? '*' : ''}(${ids.join(' ')})`; }).join(' ');
      return `${seen.join('  ')}\n    tabs ${tabs}   editors on the ${s.settings.editorSide}`;
    });
    console.log(`${label}\n    ${out}`);
  };
  const outline = () => page.evaluate(() => {
    const d = document.querySelector('.dock-box'); const all = document.querySelector('.stack').getBoundingClientRect();
    const chip = document.querySelector('.dock .incoming-chip')?.textContent ?? '';
    const mark = document.querySelector('.tab-group.is-target') ? ' [tab lit]' : document.querySelector('.zone.is-tabs.is-target') ? ' [row lit]' : '';
    if (!d) return `none${mark}${chip ? ` (chip: ${chip})` : ''}`;
    const r = { x: parseFloat(d.style.left), y: parseFloat(d.style.top), w: parseFloat(d.style.width), h: parseFloat(d.style.height) };
    const pc = (v, of) => Math.round(v / of * 100);
    return `${pc(r.x - all.x, all.width)},${pc(r.y - all.y, all.height)}+${pc(r.w, all.width)}x${pc(r.h, all.height)}${chip ? ` (chip: ${chip})` : ''}`;
  });
  // Takes hold of `from` (a selector) and carries it to a point given as fractions of `to`'s box. Returns the outline seen there.
  const carry = async (from, to, fx, fy, { cancel = false, pic = null, via = null } = {}) => {
    const g = await page.locator(from).first().boundingBox();
    const t = await page.locator(to).first().boundingBox();
    const x = g.x + Math.min(40, g.width / 2); const y = g.y + g.height / 2;
    await page.mouse.move(x, y); await at(120); await page.mouse.down();
    await page.mouse.move(x + 4, y + 8, { steps: 3 });
    if (via) { const v = await page.locator(via.sel).first().boundingBox(); await page.mouse.move(v.x + v.width * via.fx, v.y + v.height * via.fy, { steps: 6 }); await at(150); }
    await page.mouse.move(t.x + t.width * fx, t.y + t.height * fy, { steps: 10 }); await at(260);
    const o = await outline();
    if (pic) await shot(pic);
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up(); await at(750);
    return o;
  };
  const seg = async (n) => `.tab-group .toptab[data-flip="${await idOf(n)}"]`;
  const pane = async (n) => `.pane[data-pane="${await idOf(n)}"]`;
  const fileTab = (f) => `.toptab.filetab[title$="${f}"]`;
  const TERMS = '.area.is-terminals'; const EDS = '.area.is-editors';

  await run(`cd ${work}`); await name('A');
  await run('sleep 600 && echo A-still-here', 300);
  await page.keyboard.press('Meta+d'); await at(1600); await name('B');
  await page.keyboard.press('Meta+Shift+d'); await at(1600); await name('C');
  await look('start: A | B over C');

  // --- a terminal, by its stretch of the tab ---
  let o = await carry(await seg('C'), await pane('A'), 0.5, 0.8, { pic: 'dock-1-c-under-a' }); await look(`C's tab carried onto the lower part of A: outline ${o}`);
  o = await carry(await seg('B'), await pane('A'), 0.3, 0.2); await look(`B onto A at 30%,20% (the top triangle): outline ${o}`);
  o = await carry(await seg('B'), await pane('A'), 0.2, 0.3); await look(`B onto A at 20%,30% (the left triangle): outline ${o}`);
  o = await carry(await seg('C'), TERMS, 0.5, 0.985, { pic: 'dock-2-c-bottom-wall' }); await look(`C to the bottom wall: outline ${o}`);
  o = await carry(await seg('A'), TERMS, 0.99, 0.5); await look(`A to the right wall: outline ${o}`);
  o = await carry(await seg('A'), TERMS, 0.5, 0.01); await look(`A to the top wall: outline ${o}`);
  o = await carry(await seg('A'), await pane('A'), 0.5, 0.6); await look(`A over itself (stays): outline ${o}`);
  o = await carry(await seg('B'), await pane('C'), 0.5, 0.7, { cancel: true }); await look(`B over C, Esc: outline was ${o}`);

  // Two panes only: the walls still take a whole side.
  await page.evaluate((id) => window.__store.getState().closePane(id), await idOf('C')); await at(900);
  await look('C closed');
  o = await carry(await seg('B'), TERMS, 0.01, 0.5); await look(`B to the left wall, two panes: outline ${o}`);
  o = await carry(await seg('B'), TERMS, 0.5, 0.99); await look(`B to the bottom wall, two panes: outline ${o}`);

  // --- between tabs ---
  await page.keyboard.press('Meta+t'); await at(1600); await name('D');
  await look('new tab D in front');
  o = await carry(await seg('A'), await pane('D'), 0.8, 0.5, { pic: 'dock-3-a-into-d' }); await look(`A, from the tab behind, onto the right of D: outline ${o}`);
  // Carried down and then back up to the row: beside the tabs it gets a tab of its own, on another tab it joins it.
  o = await carry(await seg('A'), '.zone.is-tabs', 0.97, 0.5, { via: { sel: TERMS, fx: 0.5, fy: 0.5 } }); await look(`A down, then up to the empty row: ${o}`);
  o = await carry(await seg('A'), await seg('B'), 0.5, 0.5, { via: { sel: TERMS, fx: 0.5, fy: 0.5 } }); await look(`A (alone in its tab) down, then up onto B's tab: ${o}`);
  // A tab with one terminal, dragged along the row and never below it, still just changes places.
  o = await carry(await seg('D'), '.zone.is-tabs', 0.02, 0.5); await look(`D's tab along the row to the start: ${o}`);

  // --- files ---
  await page.evaluate((w) => { const st = window.__store.getState(); st.openFile(`${w}/notes/plan.md`); st.openFile(`${w}/main.py`); st.openFile(`${w}/data.json`); }, work); await at(1500);
  await look('three files open in one editor');
  o = await carry(fileTab('main.py'), EDS, 0.75, 0.5, { pic: 'dock-4-file-right' }); await look(`main.py onto the right of the editor: outline ${o}`);
  o = await carry(fileTab('data.json'), EDS, 0.5, 0.985); await look(`data.json to the bottom wall of the editors: outline ${o}`);
  o = await carry(fileTab('main.py'), `${EDS} .pane:has(.editor-pane)`, 0.5, 0.5); await look(`main.py (its editor's only file) to the middle of the first editor's pane: outline ${o}`);
  o = await carry(fileTab('data.json'), EDS, 0.01, 0.5); await look(`data.json (alone in its editor) to the left wall: outline ${o}`);

  // --- across the two areas ---
  o = await carry(await seg('D'), EDS, 0.5, 0.85, { pic: 'dock-5-terms-below' }); await look(`D carried over the lower part of the editors: outline ${o}`);
  await shot('dock-6-stacked');
  // One above the other, the line between the areas drags up and down, and Switch displays swaps them top and bottom.
  {
    const d = await page.locator('.area-divider').boundingBox();
    await page.mouse.move(d.x + d.width / 2, d.y + d.height / 2); await page.mouse.down();
    await page.mouse.move(d.x + d.width / 2, d.y + d.height / 2 + 120, { steps: 6 }); await page.mouse.up(); await at(500);
    await look(`the line between the areas dragged down 120px (it is a ${await page.evaluate(() => document.querySelector('.area-divider').className)})`);
    await page.evaluate(() => window.__store.getState().setEditorSide('toggle')); await at(600);
    await look('Switch displays');
    await page.evaluate(() => { const st = window.__store.getState(); st.setEditorSide('toggle'); st.setAreaRatio(0.5); }); await at(600);
  }
  o = await carry(await seg('D'), EDS, 0.5, 0.2); await look(`D over the upper part of the editors: outline ${o}`);
  o = await carry(fileTab('plan.md'), TERMS, 0.15, 0.5); await look(`plan.md over the left of the terminals: outline ${o}`);
  o = await carry(await seg('D'), EDS, 0.2, 0.5); await look(`D over the left of the editors: outline ${o}`);
  await shot('dock-7-end');

  // The shell that was running in A through all of this is still the same one.
  await page.evaluate((id) => { const s = window.__store.getState(); const t = s.tabs.find((x) => JSON.stringify(x.root).includes(id)); s.setActiveTab(t.id); s.focusPane(id); }, await idOf('A')); await at(500);
  await page.click(`${await pane('A')} .term-host`, { position: { x: 60, y: 40 } }); await at(300);
  await page.keyboard.press('Control+c'); await at(600);
  await run('echo A-alive-$((6*7))', 800);
  console.log('A after the moves:', await page.evaluate((id) => { const s = window.__sessions.get(id); const b = s.term.buffer.active; const out = []; for (let i = 0; i < b.length; i++) out.push(b.getLine(i).translateToString(true)); return out.filter((l) => /sleep 600|A-alive-42/.test(l)).map((l) => l.trim()); }, await idOf('A')));
}
