// The bar at the foot of the navigator holds the same four buttons in the same places whatever the navigator shows:
// files, search, command palette, settings. They sit centred on one line, with no box behind the lit one,
// and the bar never scrolls; a navigator too narrow for one line gets them on as few lines as hold them, evenly.
// The navigator's button is always at the left end of the top row, between the window's buttons and the first tab,
// open or closed. There is no reload button: the list of files keeps itself up to date. The graph's button is with
// the view buttons at the top right, the hotkeys are listed from Settings, and ⌘P is the command palette (⌘O opens
// a file by name).
export const settings = { zoom: 1 };
export default async function ({ page, shot, run, work }) {
  const ok = (name, pass, detail = '') => console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  const at = (ms) => page.waitForTimeout(ms);
  const foot = () => page.evaluate(() => [...document.querySelectorAll('.side-foot button')].map((b) => { const r = b.getBoundingClientRect(); return { tip: b.dataset.tip, x: Math.round(r.left), y: Math.round(r.top), on: b.classList.contains('is-on'), bg: getComputedStyle(b).backgroundColor }; }));
  const lines = (f) => [...new Set(f.map((b) => b.y))].map((y) => f.filter((b) => b.y === y).length).join('+');
  const places = (f) => f.map((b) => `${b.tip}@${b.x},${b.y}`).join(' ');
  const mode = () => page.evaluate(() => window.__store.getState().palette?.mode ?? null);
  await run(`cd ${work}`);

  ok('the navigator button is at the left end of the top row', await page.evaluate(() => { const b = document.querySelector('.topbar .side-open'); const t = document.querySelector('.top-tabs'); return !!b && b.getBoundingClientRect().right <= t.getBoundingClientRect().left + 1; }));
  ok('and not among the buttons at the right', (await page.locator('.top-actions [data-tip="File navigator"]').count()) === 0);
  await page.click('.topbar .side-open'); await at(700);
  ok('it opens the navigator, and stays where it is', (await page.evaluate(() => window.__store.getState().sidebar.visible)) && (await page.locator('.topbar .side-open.is-on').count()) === 1);

  const files = await foot();
  ok('four buttons on one line', files.length === 4 && lines(files) === '4', `${lines(files)}: ${files.map((b) => b.tip).join(', ')}`);
  const box = await page.evaluate(() => { const f = document.querySelector('.side-foot').getBoundingClientRect(); const b = [...document.querySelectorAll('.side-foot button')].map((x) => x.getBoundingClientRect()); return { left: b[0].left - f.left, right: f.right - b[b.length - 1].right, above: b[0].top - f.top, below: f.bottom - b[0].bottom, scroll: document.querySelector('.side-foot').scrollWidth - document.querySelector('.side-foot').clientWidth, over: getComputedStyle(document.querySelector('.side-foot')).overflowX }; });
  ok('centred across and down', Math.abs(box.left - box.right) <= 1 && Math.abs(box.above - box.below) <= 1.5, JSON.stringify(box));
  ok('the bar cannot scroll', box.over === 'hidden' && box.scroll <= 0, JSON.stringify(box));
  ok('the files button is lit', files.filter((b) => b.on).map((b) => b.tip).join() === 'Files');
  ok('dotfiles sits in the title row, and reload is gone', (await page.locator('.side-title [data-tip="Show dotfiles"]').count()) === 1 && (await page.locator('.side-title button').count()) === 1);
  // A file made behind the app's back shows by itself.
  const fs = await import('node:fs');
  fs.writeFileSync(`${work}/made-by-an-agent.txt`, 'x'); fs.mkdirSync(`${work}/notes/sub`);
  await at(2800);
  ok('a new file shows without a reload', (await page.locator('.treerow:has-text("made-by-an-agent.txt")').count()) === 1);
  fs.rmSync(`${work}/made-by-an-agent.txt`); await at(2800);
  ok('and goes when it is deleted', (await page.locator('.treerow:has-text("made-by-an-agent.txt")').count()) === 0);
  await shot('sidefoot-1-files');

  await page.click('.side-foot [data-tip="Search in project"]'); await at(500);
  const search = await foot();
  ok('in search, every button is where it was', places(search) === places(files), places(search));
  ok('and the search button is the lit one', search.filter((b) => b.on).map((b) => b.tip).join() === 'Search in project' && (await page.locator('.searchpanel').count()) === 1);
  await page.click('.side-foot [data-tip="Files"]'); await at(400);
  ok('back to files', (await page.locator('.filetree').count()) === 1);

  await page.click('.side-foot [data-tip="Command palette"]'); await at(400);
  ok('command palette', (await mode()) === 'commands');
  await page.keyboard.press('Escape'); await at(200);
  await page.keyboard.press('Meta+p'); await at(400);
  ok('⌘P is the command palette', (await mode()) === 'commands');
  await page.keyboard.press('Escape'); await at(200);
  await page.keyboard.press('Meta+o'); await at(400);
  ok('⌘O opens a file by name', (await mode()) === 'files');
  await page.keyboard.press('Escape'); await at(200);
  await page.click('.side-foot [data-tip="Settings"]'); await at(400);
  ok('settings', (await mode()) === 'settings');
  await page.click('.palette-row:has-text("Hotkeys")'); await at(400);
  const keys = await page.evaluate(() => document.querySelectorAll('.palette-row kbd').length);
  ok('the hotkeys are listed from settings', keys > 60, `${keys} rows with a key`);
  await page.evaluate(() => window.__store.getState().closePalette()); await at(300);
  ok('no new-note button (⌘N, or a right-click on the top row)', (await page.locator('.side-foot [data-tip="New note"]').count()) === 0);
  ok('the navigator button says what it does', (await page.locator('.topbar .side-open').getAttribute('data-tip')) === 'Toggle sidebar');

  ok('the graph button is with the view buttons at the top right', (await page.locator('.view-tools .view-graph').count()) === 1 && (await page.locator('.side-foot [data-tip="Graph of notes"]').count()) === 0);
  await page.click('.view-tools .view-graph'); await at(1500);
  ok('and opens the graph', await page.evaluate(() => Object.values(window.__store.getState().panes).some((p) => p.kind === 'editor' && p.files.some((f) => f.path.startsWith('graph:')))));
  await shot('sidefoot-2-top');

  // Narrower than one line holds: as few lines as will do, the same number on each (4 → 2 + 2), still centred.
  await page.evaluate(() => window.__store.getState().setSidebar({ width: 110 })); await at(500);
  ok('too narrow for four: two and two', lines(await foot()) === '2+2', lines(await foot()));
  await shot('sidefoot-3-two-lines');
  await page.evaluate(() => window.__store.getState().setSidebar({ width: 85 })); await at(500);
  const narrow = await foot();
  const edge = await page.evaluate(() => document.querySelector('.sidebar').getBoundingClientRect().right);
  ok('at its narrowest nothing is cut off', narrow.every((b) => b.x + 24 <= edge + 1) && lines(narrow) === '2+2', `${lines(narrow)} within ${Math.round(edge)}`);

  await page.evaluate(() => window.__store.getState().setSidebar({ width: 240 })); await at(300);
  await page.click('.topbar .side-open'); await at(700);
  ok('the same button closes the navigator', !(await page.evaluate(() => window.__store.getState().sidebar.visible)) && (await page.locator('.topbar .side-open:not(.is-on)').count()) === 1);
  await shot('sidefoot-4-closed');
}
