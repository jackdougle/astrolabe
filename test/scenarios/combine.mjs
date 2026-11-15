// Terminals move between tabs, and tabs between windows, without their shells stopping. Right-clicking a tab
// combines it with the tab in front, or gives one of its terminals a tab of its own; a tab let go on the middle
// of another joins it (past the middle it only changes places); a terminal carried by its grip up to the row
// joins the tab it is let go on. A tab dragged out of its window and over another window lands there: on a
// terminal, against its nearest edge; on the row, as a tab. A window left with nothing closes.
export const settings = { zoom: 1 };
export default async function ({ app, page, shot, run, work }) {
  const ok = (name, pass, detail = '') => console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  const at = (ms) => page.waitForTimeout(ms);
  const text = (p, id) => p.evaluate((id) => {
    const t = window.__sessions.get(id).term;
    const rows = [];
    for (let y = 0; y < t.buffer.active.length; y++) rows.push(t.buffer.active.getLine(y)?.translateToString(true) ?? '');
    return rows.join('\n');
  }, id);
  const tabs = (p) => p.evaluate(() => {
    const s = window.__store.getState();
    const ids = (n, out = []) => { if (n.type === 'leaf') out.push(n.pane); else { ids(n.a, out); ids(n.b, out); } return out; };
    return { front: s.activeTab, focus: s.focus, tabs: s.tabs.map((t) => ({ id: t.id, panes: ids(t.root), active: t.activePane })), sessions: [...window.__sessions.keys()].sort(), blocks: document.querySelectorAll('.tab-group:not(.is-leaving)').length, files: Object.values(s.panes).flatMap((x) => (x.kind === 'editor' ? x.files.map((f) => f.path.split('/').pop()) : [])), dirty: Object.keys(s.dirty).filter((k) => s.dirty[k]).map((k) => k.split('/').pop()) };
  });
  const shape = (l) => l.tabs.map((t) => t.panes.length).join('+');
  const ticks = async (p, id) => [...(await text(p, id)).matchAll(/^tick-(\d+)$/gm)].map((m) => +m[1]);
  const unbroken = (list) => list.length > 3 && list.every((n, i) => i === 0 || n === list[i - 1] + 1);
  const menu = async (p, sel, choice) => { await p.evaluate((c) => window.astrolabe.fs.testMenuChoice(c), choice); await p.locator(sel).first().click({ button: 'right' }); await p.waitForTimeout(700); };
  const block = (id) => `.tab-group[data-tab="${id}"]`;
  // Takes hold of a tab's block and carries it to a point of the page (outside the window is fine).
  const drag = async (p, sel, to, { hold = null } = {}) => {
    const b = await p.locator(sel).first().boundingBox();
    const x = b.x + Math.min(40, b.width / 2); const y = b.y + b.height / 2;
    await p.mouse.move(x, y); await p.waitForTimeout(120); await p.mouse.down();
    await p.mouse.move(x + 12, y + 1, { steps: 3 });
    await p.mouse.move(to.x, to.y, { steps: 12 }); await p.waitForTimeout(350);
    const seen = hold ? await hold() : null;
    await p.mouse.up(); await p.waitForTimeout(500);
    return seen;
  };

  // ----- two tabs: one with a command printing, one in front -----
  await run(`cd ${work}`);
  await run('echo PID-$$');
  const a = await page.evaluate(() => window.__store.getState().tabs[0]);
  const A = a.activePane;
  const pid = /PID-(\d+)/.exec(await text(page, A))?.[1];
  await run('for i in $(seq 1 2000); do echo tick-$i; sleep 0.2; done', 500);
  await page.keyboard.press('Meta+t'); await at(1500);
  await run('echo second-$$');
  let l = await tabs(page);
  const b = l.tabs[1];
  const B = b.active;
  ok('two tabs, the second in front', shape(l) === '1+1' && l.front === b.id);

  // Right-click the other tab: it combines with the one in front.
  await menu(page, block(a.id), 'join');
  l = await tabs(page);
  ok('right-click, Combine: one tab with both terminals, the keyboard where it was', shape(l) === '2' && l.tabs[0].id === b.id && l.tabs[0].panes.join() === `${B},${A}` && l.tabs[0].active === B && l.blocks === 1, JSON.stringify(l.tabs));
  ok('both terminals are drawn side by side', (await page.locator('.tab-area.is-active .pane:visible').count()) === 2);
  await at(1200);
  ok('the command never stopped, and lost nothing', unbroken(await ticks(page, A)) && l.sessions.join() === [A, B].sort().join(), `${(await ticks(page, A)).length} lines`);
  await shot('combine-1-joined');
  await page.locator(`.pane[data-pane="${B}"] .term-host`).click(); await at(200);
  await run('echo joined-$$');
  ok('the terminal it joined still takes commands', /joined-\d+/.test(await text(page, B)));

  // Right-click a terminal of the tab: it gets a tab of its own.
  await menu(page, `${block(b.id)} .toptab[data-flip="${A}"]`, 'part');
  l = await tabs(page);
  ok('right-click, Move Terminal to Its Own Tab', shape(l) === '1+1' && l.tabs[0].panes.join() === B && l.tabs[1].panes.join() === A && l.front === l.tabs[1].id, JSON.stringify(l.tabs));
  await at(900);
  ok('still the same command, still unbroken', unbroken(await ticks(page, A)));
  const a2 = l.tabs[1].id;

  // Dragged past the other tab, it only changes places with it.
  let r = await page.locator(block(b.id)).boundingBox();
  await drag(page, block(a2), { x: r.x + r.width * 0.1, y: r.y + r.height / 2 });
  l = await tabs(page);
  ok('dragged past a tab, it changes places', shape(l) === '1+1' && l.tabs[0].id === a2, JSON.stringify(l.tabs.map((t) => t.id)));

  // Let go on the middle of the other tab, it joins it.
  r = await page.locator(block(b.id)).boundingBox();
  const aimed = await drag(page, block(a2), { x: r.x + r.width * 0.5, y: r.y + r.height / 2 }, { hold: async () => { await shot('combine-2-over-a-tab'); return page.evaluate(() => [...document.querySelectorAll('.tab-group.is-target')].map((n) => n.dataset.tab).join()); } });
  l = await tabs(page);
  ok('let go on the middle of a tab, it joins it', aimed === b.id && shape(l) === '2' && l.tabs[0].id === b.id && l.tabs[0].active === A && l.blocks === 1, `aimed at ${aimed}; ${JSON.stringify(l.tabs)}`);
  await at(900);
  ok('unbroken through that too', unbroken(await ticks(page, A)));
  ok('no mark is left on the row', (await page.locator('.is-target, .is-joining').count()) === 0);

  // A terminal carried by its grip up to the row: beside the tabs, a tab of its own; onto a tab, into it.
  const grip = async (id, to) => {
    const g = await page.locator(`.pane[data-pane="${id}"] > .pane-grip`).boundingBox();
    const x = g.x + g.width / 2; const y = g.y + g.height / 2;
    await page.mouse.move(x, y); await at(150); await page.mouse.down();
    await page.mouse.move(x + 8, y - 6, { steps: 3 });
    await page.mouse.move(to.x, to.y, { steps: 8 }); await at(300);
    const mark = await page.evaluate(() => [...document.querySelectorAll('.is-target')].map((n) => n.className.split(' ')[0]).join());
    await page.mouse.up(); await at(700);
    return mark;
  };
  r = await page.locator(block(b.id)).boundingBox();
  let mark = await grip(A, { x: r.x + r.width + 120, y: r.y + r.height / 2 });
  l = await tabs(page);
  ok('its grip let go on the row beside the tabs: a tab of its own', mark === 'zone' && shape(l) === '1+1' && l.tabs[1].panes.join() === A, `${mark}; ${JSON.stringify(l.tabs)}`);
  await page.keyboard.press('Meta+d'); await at(1700);
  await run('echo third-$$');
  l = await tabs(page);
  const C = l.tabs[1].active;
  r = await page.locator(block(b.id)).boundingBox();
  mark = await grip(C, { x: r.x + r.width / 2, y: r.y + r.height / 2 });
  l = await tabs(page);
  ok('its grip let go on another tab: into that tab', mark === 'tab-group' && shape(l) === '2+1' && l.tabs[0].panes.join() === `${B},${C}` && l.tabs[1].panes.join() === A && l.front === b.id, `${mark}; ${JSON.stringify(l.tabs)}`);
  await page.locator(`.pane[data-pane="${C}"] .term-host`).click(); await at(200);
  await run('echo moved-$$');
  ok('and it is the same shell', (() => { const t = /third-(\d+)/.exec(''); return true; })() && /third-(\d+)[\s\S]*moved-\1/.test(await text(page, C)));
  ok('unbroken still', unbroken(await ticks(page, A)));

  // ----- another window -----
  const had = new Set(app.windows());
  await page.evaluate(() => window.astrolabe.app.newWindow());
  let two = null;
  for (let i = 0; i < 80 && !two; i++) { await at(150); for (const w of app.windows()) { try { if (!had.has(w) && w.url().startsWith('astrolabe:') && (await w.evaluate(() => window.__store?.getState().ready))) two = w; } catch {} } }
  if (!two) { ok('a second window opened', false); return; }
  await two.waitForSelector('.term-host .xterm', { timeout: 15000 }); await at(1500);
  // Side by side, so that a point right of the first window is over the second.
  const ids = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL().startsWith('astrolabe:')).map((w) => ({ id: w.webContents.id, title: w.webContents.getTitle() })));
  const firstId = await page.evaluate(() => 0).then(async () => { for (const w of ids) { if ((await app.evaluate(({ webContents }, id) => webContents.fromId(id).executeJavaScript('window.__store.getState().tabs.length'), w.id)) === 2) return w.id; } return null; });
  const secondId = ids.find((w) => w.id !== firstId)?.id;
  await app.evaluate(({ BrowserWindow, webContents }, [one, other]) => {
    BrowserWindow.fromWebContents(webContents.fromId(one)).setBounds({ x: 40, y: 60, width: 900, height: 620 });
    BrowserWindow.fromWebContents(webContents.fromId(other)).setBounds({ x: 960, y: 80, width: 900, height: 620 });
  }, [firstId, secondId]);
  await at(900);
  const place = () => app.evaluate(({ BrowserWindow, webContents }, [one, other]) => [one, other].map((id) => { const w = webContents.fromId(id); return w && !w.isDestroyed() ? BrowserWindow.fromWebContents(w)?.getContentBounds() ?? null : null; }), [firstId, secondId]);
  let [c1, c2] = await place();
  // A point of the second window's page, in the first page's own px.
  const over = (x, y) => ({ x: c2.x - c1.x + x, y: c2.y - c1.y + y });
  const l2 = await tabs(two);
  const T2 = l2.tabs[0].active;
  await two.locator('.term-host').first().click(); await at(200);
  await two.keyboard.type('echo other-window', { delay: 8 }); await two.keyboard.press('Enter'); await at(900);

  // The tab with the printing command, onto the right half of the other window's terminal.
  l = await tabs(page);
  const tabA = l.tabs.find((t) => t.panes.join() === A).id;
  const box2 = await two.locator(`.pane[data-pane="${T2}"]`).boundingBox();
  const seen = await drag(page, block(tabA), over(box2.x + box2.width * 0.85, box2.y + box2.height * 0.5), { hold: async () => {
    await two.screenshot({ path: `${process.env.SHOTS || 'test/shots'}/combine-3-over-window.png` }).catch(() => {});
    return { incoming: await two.evaluate(() => { const b = document.querySelector('.incoming-box')?.getBoundingClientRect(); return { chip: document.querySelector('.incoming-chip')?.textContent ?? null, box: b ? [Math.round(b.left), Math.round(b.width)] : null }; }), outline: await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().startsWith('data:'))) };
  } });
  ok('over the other window it shows where the tab would land, and no new-window outline', !!seen.incoming.chip && !!seen.incoming.box && seen.incoming.box[0] > box2.x + box2.width * 0.4 && !seen.outline, JSON.stringify(seen));
  await at(2200);
  l = await tabs(page);
  let m = await tabs(two);
  ok('let go there, it joined that window\'s tab, to the right', shape(l) === '2' && !l.sessions.includes(A) && shape(m) === '2' && m.tabs[0].panes.join() === `${T2},${A}` && m.sessions.includes(A), `${JSON.stringify(l.tabs)} / ${JSON.stringify(m.tabs)}`);
  ok('the landing mark has gone', (await two.locator('.incoming').count()) === 0);
  const got = await text(two, A);
  ok('its screen came along', got.includes(`PID-${pid}`) && /tick-1\b/.test(got));
  await at(1500);
  const list = await ticks(two, A);
  ok('the command kept running there, nothing lost', unbroken(list) && list[list.length - 1] > 60, `${list.length} lines, last tick-${list[list.length - 1]}`);
  await two.locator(`.pane[data-pane="${A}"] .term-host`).click(); await two.keyboard.press('Control+c'); await at(900);
  await two.keyboard.type('echo SAME-$$', { delay: 8 }); await two.keyboard.press('Enter'); await at(1200);
  ok('it is the same shell', (await text(two, A)).includes(`SAME-${pid}`), `pid ${pid}`);
  await two.screenshot({ path: `${process.env.SHOTS || 'test/shots'}/combine-4-joined-window.png` }).catch(() => {});
  ok('the first window still works', await (async () => { await page.locator(`.pane[data-pane="${B}"] .term-host`).click(); await run('echo still-here'); return (await text(page, B)).includes('still-here'); })());

  // A file with unsaved typing, onto the other window: it opens there with the typing.
  await page.evaluate((w) => window.__store.getState().openFile(`${w}/main.py`, { line: 1 }), work); await at(1500);
  await page.keyboard.type('# typed and not saved\n', { delay: 6 }); await at(400);
  [c1, c2] = await place();
  await drag(page, '.filetab:has-text("main.py")', over(400, 300));
  await at(2000);
  l = await tabs(page); m = await tabs(two);
  ok('a file let go on the other window opens there, unsaved typing and all', l.files.length === 0 && l.dirty.length === 0 && m.files.join() === 'main.py' && m.dirty.join() === 'main.py' && (await two.evaluate(() => window.__monaco.editor.getModels().some((x) => x.getValue().startsWith('# typed and not saved')))), `${JSON.stringify(l.files)} / ${JSON.stringify(m.files)} dirty ${m.dirty}`);

  // The first window's one remaining tab, onto the other window's row: it becomes a tab there and the window closes.
  await page.evaluate(() => window.__store.getState().focusArea('terminal')); await at(400);
  l = await tabs(page);
  const last = l.tabs[0];
  [c1, c2] = await place();
  const rowEnd = await two.evaluate(() => { const all = [...document.querySelectorAll('.tab-group')]; const r = all[all.length - 1].getBoundingClientRect(); return { x: r.right + 40, y: r.top + r.height / 2 }; });
  const b0 = await page.locator(block(last.id)).first().boundingBox();
  await page.mouse.move(b0.x + 30, b0.y + b0.height / 2); await at(120); await page.mouse.down();
  await page.mouse.move(b0.x + 42, b0.y + b0.height / 2 + 1, { steps: 3 });
  const dest = over(rowEnd.x, rowEnd.y);
  await page.mouse.move(dest.x, dest.y, { steps: 12 }).catch(() => {}); await two.waitForTimeout(400);
  const bar = await two.evaluate(() => !!document.querySelector('.incoming-bar'));
  await page.mouse.up().catch(() => {});
  await two.waitForTimeout(2500);
  m = await tabs(two);
  const left = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL().startsWith('astrolabe:')).length);
  ok('a tab that is all its window holds goes to the other window\'s row, whole', bar && shape(m) === '2+2' && m.tabs[1].panes.join() === last.panes.join() && m.front === m.tabs[1].id, `bar ${bar}; ${JSON.stringify(m.tabs)}`);
  ok('and the window it left has closed', left === 1, `${left} windows`);
  await two.locator(`.pane[data-pane="${B}"] .term-host`).click(); await two.waitForTimeout(200);
  await two.keyboard.type('echo arrived-$$', { delay: 8 }); await two.keyboard.press('Enter'); await two.waitForTimeout(1200);
  ok('its terminals are the same shells', /second-(\d+)[\s\S]*arrived-\1/.test(await text(two, B)));
  await two.screenshot({ path: `${process.env.SHOTS || 'test/shots'}/combine-5-all-in-one.png` }).catch(() => {});
}
