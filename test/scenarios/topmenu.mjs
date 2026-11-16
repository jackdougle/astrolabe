// Right-click on the top row itself (not on a tab): over the terminals it offers a new terminal, over an editor a new
// note or another editor. Also: the navigator's button says "Toggle sidebar", and the foot has no new-note button.
export default async function ({ page, run, work, shot }) {
  const st = () => page.evaluate(() => { const s = window.__store.getState(); const eds = Object.values(s.panes).filter((p) => p.kind === 'editor' && !s.leaving[p.id]); return { tabs: s.tabs.length, terms: Object.values(s.panes).filter((p) => p.kind === 'terminal').length, editors: eds.map((e) => e.files.map((f) => f.path.split('/').pop()).join(',') || '(empty)'), focus: s.focus }; });
  // A point on the row over an area, clear of its tabs: just left of the zone's right end.
  const spot = (sel) => page.evaluate((q) => { const z = document.querySelector(q); if (!z) return null; const r = z.getBoundingClientRect(); return { x: r.right - 6, y: r.top + r.height / 2, on: document.elementFromPoint(r.right - 6, r.top + r.height / 2)?.className }; }, sel);
  const menu = async (sel, choice) => {
    const at = await spot(sel);
    if (!at) { console.log('  no', sel); return; }
    await page.evaluate((c) => window.astrolabe.fs.testMenuChoice(c), choice);
    await page.mouse.click(at.x, at.y, { button: 'right' });
    await page.waitForTimeout(choice === 'note' ? 2500 : 900);
  };
  await run(`cd ${work} && git init -q`, 1200);
  console.log('0 start', JSON.stringify(await st()), '| click lands on:', (await spot('.zone.is-tabs')).on);

  // The editor steps come first: a note is made in the folder of the terminal used last, and only the first terminal
  // is in the work folder (new ones start in the home folder, where a test must not leave files).
  await menu('.zone.is-tabs', 'editor');
  console.log('1 New Editor (none open yet)', JSON.stringify(await st()));
  await shot('topmenu-1-editor');
  await menu('.zone.is-files', 'note');
  console.log('2 New Note over the editor', JSON.stringify(await st()), '| in the work folder:', await page.evaluate((w) => Object.values(window.__store.getState().panes).every((p) => p.kind !== 'editor' || p.files.every((f) => f.path.includes(w))), work));
  await menu('.zone.is-files', 'editorRight');
  console.log('3 New Editor on the Right', JSON.stringify(await st()));
  await menu('.zone.is-files', 'editorDown');
  console.log('4 New Editor Below', JSON.stringify(await st()));
  await shot('topmenu-2-editors');
  await menu('.zone.is-tabs', 'tab');
  console.log('5 New Terminal Tab', JSON.stringify(await st()));
  await menu('.zone.is-tabs', 'right');
  console.log('6 New Terminal on the Right', JSON.stringify(await st()));
  await menu('.zone.is-tabs', 'down');
  console.log('7 New Terminal Below', JSON.stringify(await st()));
  // a right-click on a terminal tab still gets that tab's own menu (its "close"), not the row's
  await page.evaluate(() => window.astrolabe.fs.testMenuChoice('close'));
  await page.locator('.tab-group').first().click({ button: 'right' }); await page.waitForTimeout(900);
  console.log('8 a tab keeps its own menu (Close Tab)', JSON.stringify(await st()));

  await page.keyboard.press('Meta+l'); await page.waitForTimeout(500);
  console.log('9 navigator button says:', await page.evaluate(() => document.querySelector('.top-btn.side-open')?.getAttribute('data-tip')),
    '| foot buttons:', await page.evaluate(() => [...document.querySelectorAll('.side-foot button')].map((b) => b.getAttribute('data-tip'))),
    '| gaps:', await page.evaluate(() => { const b = [...document.querySelectorAll('.side-foot button')].map((x) => x.getBoundingClientRect()); return b.slice(1).map((r, i) => Math.round((r.left - b[i].right) * 10) / 10); }));
  await shot('topmenu-3-side');
}
