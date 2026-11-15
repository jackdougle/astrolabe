// A tab dragged out of the window and let go there becomes a window of its own, as in a browser. A terminal tab
// keeps its shell (the same process, a running command still printing) and its screen; a file keeps its unsaved
// typing. While the tab is outside, an outline shows where the window will be. Esc, or coming back, calls it off;
// a tab that is all its window holds takes the window there instead.
export default async function ({ app, page, shot, run, work }) {
  const ok = (name, pass, detail = '') => console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  const at = (ms) => page.waitForTimeout(ms);
  const wins = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ id: w.webContents.id, ...w.getBounds(), url: w.webContents.getURL().slice(0, 24), shown: w.isVisible() })));
  const real = async () => (await wins()).filter((w) => w.url.startsWith('astrolabe:'));
  const ghost = async () => (await wins()).find((w) => w.url.startsWith('data:')) ?? null;
  const text = (p, id) => p.evaluate((id) => {
    const t = (id ? window.__sessions.get(id) : [...window.__sessions.values()][0]).term;
    const rows = [];
    for (let y = 0; y < t.buffer.active.length; y++) rows.push(t.buffer.active.getLine(y)?.translateToString(true) ?? '');
    return rows.join('\n');
  }, id);
  const layout = (p) => p.evaluate(() => {
    const s = window.__store.getState();
    return { tabs: s.tabs.map((t) => t.id), terms: [...window.__sessions.keys()], files: Object.values(s.panes).flatMap((x) => (x.kind === 'editor' ? x.files.map((f) => f.path.split('/').pop()) : [])), dirty: Object.keys(s.dirty).filter((k) => s.dirty[k]).map((k) => k.split('/').pop()), focus: s.focus };
  });
  // Takes hold of a tab, carries it to a point (in the page's px; outside the window is fine) and lets go or presses Esc.
  const drag = async (p, sel, to, { esc = false, back = false, hold = null } = {}) => {
    const b = await p.locator(sel).first().boundingBox();
    const x = b.x + Math.min(40, b.width / 2); const y = b.y + b.height / 2;
    await p.mouse.move(x, y); await p.waitForTimeout(120); await p.mouse.down();
    await p.mouse.move(x + 12, y + 2, { steps: 3 });
    await p.mouse.move(to.x, to.y, { steps: 10 }); await p.waitForTimeout(450);
    const seen = { torn: await p.evaluate(() => !!document.querySelector('.is-torn')), ghost: await ghost(), grabbed: { x, y } };
    if (hold) await hold();
    // Back inside, below the row: let go on the middle of another tab, it would join that tab (combine.mjs).
    if (back) { await p.mouse.move(x + 60, y + 200, { steps: 6 }); await p.waitForTimeout(300); seen.ghostAfterBack = await ghost(); }
    if (esc) await p.keyboard.press('Escape');
    await p.mouse.up(); await p.waitForTimeout(250);
    return seen;
  };
  const pageOf = async (id) => {
    for (let i = 0; i < 80; i++) {
      for (const w of app.windows()) { try { if (w.url().startsWith('astrolabe:') && (await w.evaluate(() => window.__store?.getState().ready)) && (await app.evaluate(({ webContents }, id) => webContents.fromId(id)?.getTitle(), id)) === (await w.title()) && w !== page && !known.has(w)) return w; } catch {} }
      await at(150);
    }
    return null;
  };
  const known = new Set();

  // ----- a terminal tab, with a command running in it -----
  await run(`cd ${work}`);
  await run('echo PID-$$');
  const first = await page.evaluate(() => window.__store.getState().tabs[0]);
  const pid = /PID-(\d+)/.exec(await text(page))?.[1];
  await run('for i in $(seq 1 400); do echo tick-$i; sleep 0.25; done', 600);
  await page.keyboard.press('Meta+t'); await at(1500);
  await run('echo second-tab');
  const before = await real();
  const size = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));

  // Out and back: the outline comes and goes, and nothing has moved.
  let seen = await drag(page, `.tab-group[data-tab="${first.id}"]`, { x: size.w + 200, y: 300 }, { back: true });
  ok('outside the window the tab is marked and an outline shows', seen.torn && !!seen.ghost, JSON.stringify(seen.ghost));
  ok('coming back takes the outline away', !seen.ghostAfterBack && (await real()).length === 1 && (await layout(page)).tabs.length === 2);

  // Out and Esc.
  seen = await drag(page, `.tab-group[data-tab="${first.id}"]`, { x: -180, y: 260 }, { esc: true });
  await at(400);
  ok('Esc calls it off', seen.torn && !(await ghost()) && (await real()).length === 1 && (await layout(page)).tabs.length === 2);

  // Out and let go.
  const drop = { x: size.w + 160, y: 240 };
  seen = await drag(page, `.tab-group[data-tab="${first.id}"]`, drop, { hold: async () => {
    await shot('tearoff-1-outside');
    const g = app.windows().find((w) => w.url().startsWith('data:'));
    await g?.screenshot({ path: `${process.env.SHOTS || 'test/shots'}/tearoff-1-outline.png`, omitBackground: true }).catch(() => {});
  } });
  const t0 = Date.now();
  const outline = seen.ghost;
  // How long the place is empty: from letting go to the new window's terminal being drawn.
  const up = await (async () => { for (let i = 0; i < 200; i++) { for (const w of app.windows()) { try { if (w !== page && w.url().startsWith('astrolabe:') && (await w.evaluate(() => !!document.querySelector('.term-host .xterm')))) return Date.now() - t0; } catch {} } await at(25); } return -1; })();
  console.log(`     the new window had its terminal ${up}ms after the tab was let go`);
  await at(2000);
  const after = await real();
  ok('a second window opened', after.length === 2, after.map((w) => `${w.x},${w.y} ${w.width}x${w.height}`).join(' | '));
  const made = after.find((w) => !before.some((b) => b.id === w.id));
  ok('where the outline was, the size of the first', !!made && !!outline && Math.abs(made.x - outline.x) < 2 && made.width === before[0].width && made.height === before[0].height, `outline ${outline?.x},${outline?.y} window ${made?.x},${made?.y}`);
  ok('the outline has gone', !(await ghost()));
  const two = await pageOf(made?.id);
  known.add(two);
  if (!two) { ok('the new window has a page', false); return; }
  await two.waitForSelector('.term-host .xterm', { timeout: 15000 });
  await at(1200);
  const there = await layout(two);
  const here = await layout(page);
  ok('the tab is there and no longer here', there.tabs.join() === first.id && there.terms.join() === first.activePane && here.tabs.length === 1 && !here.terms.includes(first.activePane), `${JSON.stringify(there)} / ${JSON.stringify(here)}`);
  const t1 = await text(two);
  ok('its screen came along', t1.includes(`PID-${pid}`) && /tick-1\b/.test(t1));
  const n1 = Math.max(...[...t1.matchAll(/tick-(\d+)/g)].map((m) => +m[1]));
  await at(1500);
  const t2 = await text(two);
  const ticks = [...t2.matchAll(/^tick-(\d+)$/gm)].map((m) => +m[1]);
  const n2 = Math.max(...ticks);
  ok('the command kept running, and nothing it printed was lost', n2 > n1 + 2 && ticks.every((n, i) => i === 0 || n === ticks[i - 1] + 1), `tick ${n1} then ${n2}, ${ticks.length} lines`);
  await two.locator('.term-host').first().click(); await two.keyboard.press('Control+c'); await at(900);
  await two.keyboard.type('echo SAME-$$', { delay: 8 }); await two.keyboard.press('Enter'); await at(1200);
  ok('it is the same shell', (await text(two)).includes(`SAME-${pid}`), `pid ${pid}`);
  ok('the first window still works', await (async () => { await page.locator('.term-host:visible').first().click(); await run('echo still-here'); return (await text(page)).includes('still-here'); })());
  await two.screenshot({ path: `${process.env.SHOTS || 'test/shots'}/tearoff-2-window.png` }).catch(() => {});
  await shot('tearoff-3-left-behind');

  // ----- a file, with unsaved typing -----
  await page.evaluate((w) => { const s = window.__store.getState(); s.openFile(`${w}/notes/plan.md`); s.openFile(`${w}/main.py`, { line: 1 }); }, work);
  await at(1500);
  await page.keyboard.type('# typed and not saved\n', { delay: 6 }); await at(400);
  ok('main.py has unsaved typing', (await layout(page)).dirty.join() === 'main.py');
  const sizeNow = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  seen = await drag(page, '.filetab:has-text("main.py")', { x: 300, y: sizeNow.h + 150 });
  await at(2500);
  const three = await (async () => { for (let i = 0; i < 60; i++) { for (const w of app.windows()) { try { if (w !== page && w !== two && w.url().startsWith('astrolabe:') && (await w.evaluate(() => window.__store?.getState().ready))) return w; } catch {} } await at(150); } return null; })();
  ok('the file got a window', seen.torn && !!three && (await real()).length === 3);
  if (!three) return;
  await three.waitForSelector('.monaco-editor', { timeout: 15000 }); await at(900);
  const f3 = await layout(three);
  const f1 = await layout(page);
  ok('it holds the file alone, typing and all', f3.files.join() === 'main.py' && f3.tabs.length === 0 && f3.dirty.join() === 'main.py' && (await three.evaluate(() => window.__monaco.editor.getModels().some((m) => m.getValue().startsWith('# typed and not saved')))), JSON.stringify(f3));
  ok('the first window keeps the other file, and nothing unsaved', f1.files.join() === 'plan.md' && f1.dirty.length === 0, JSON.stringify(f1));
  await three.screenshot({ path: `${process.env.SHOTS || 'test/shots'}/tearoff-4-file.png` }).catch(() => {});

  // ----- a tab that is all its window holds: the window goes there -----
  const was = (await real()).find((w) => w.id === made.id);
  seen = await drag(two, '.tab-group', { x: -120, y: 200 });
  await at(900);
  const now = (await real()).find((w) => w.id === made.id);
  ok('a lone tab takes its window along', (await real()).length === 3 && seen.torn && !!now && now.x < was.x - 100 && now.width === was.width && (await layout(two)).tabs.length === 1, `${was.x},${was.y} to ${now?.x},${now?.y}`);
  ok('under the pointer', !!now && Math.abs((now.x + seen.grabbed.x) - (was.x - 120)) < 3, `window x ${now?.x}`);

  // ----- a tab split into two terminals goes whole; a rendered note takes its unsaved typing -----
  await page.evaluate(() => window.__store.getState().focusArea('terminal')); await at(300);
  await page.keyboard.press('Meta+t'); await at(1500);
  await run('echo left-$$');
  await page.keyboard.press('Meta+d'); await at(1700);
  await run('echo right-$$');
  const pair = await page.evaluate(() => { const s = window.__store.getState(); const t = s.tabs.find((x) => x.id === s.activeTab); return { id: t.id, panes: Object.keys(s.panes).filter((k) => s.panes[k].kind === 'terminal' && JSON.stringify(t.root).includes(k)) }; });
  const pids = await Promise.all(pair.panes.map(async (id) => /(?:left|right)-(\d+)/.exec(await text(page, id))?.[1]));
  const sizeP = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const had = new Set(app.windows());
  seen = await drag(page, `.tab-group[data-tab="${pair.id}"]`, { x: sizeP.w / 2, y: -90 });
  await at(2500);
  const five = app.windows().find((w) => !had.has(w) && w.url().startsWith('astrolabe:'));
  ok('a split tab got a window', seen.torn && !!five);
  if (five) {
    await five.waitForSelector('.term-host .xterm', { timeout: 15000 }); await at(1000);
    const l5 = await layout(five);
    const alive = [];
    for (const id of pair.panes) {
      await five.locator(`.pane[data-pane="${id}"] .term-host`).click(); await at(200);
      await five.keyboard.type('echo again-$$', { delay: 8 }); await five.keyboard.press('Enter'); await at(1000);
      alive.push(/again-(\d+)/.exec(await text(five, id))?.[1]);
    }
    ok('with both terminals, side by side, each the same shell', l5.tabs.join() === pair.id && l5.terms.slice().sort().join() === pair.panes.slice().sort().join() && alive.join() === pids.join() && (await five.locator('.pane').count()) === 2, `${pids} -> ${alive}`);
    await five.screenshot({ path: `${process.env.SHOTS || 'test/shots'}/tearoff-5-split.png` }).catch(() => {});
  }
  await page.evaluate((w) => { const s = window.__store.getState(); s.openFile(`${w}/data.json`); s.openFile(`${w}/notes/plan.md`); }, work); await at(1200);
  await page.locator('.rich p').first().click(); await at(300);
  await page.keyboard.press('End'); await page.keyboard.type(' Added and unsaved.', { delay: 6 }); await at(500);
  const had2 = new Set(app.windows());
  const sizeQ = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  seen = await drag(page, '.filetab:has-text("plan.md")', { x: sizeQ.w + 120, y: 500 });
  await at(2500);
  const six = app.windows().find((w) => !had2.has(w) && w.url().startsWith('astrolabe:'));
  if (six) { await six.waitForSelector('.rich', { timeout: 15000 }); await at(900); }
  const l6 = six ? await layout(six) : null;
  ok('a rendered note arrives rendered, with what was typed', !!six && l6.files.join() === 'plan.md' && l6.dirty.join() === 'plan.md' && (await six.locator('.rich').innerText()).includes('Added and unsaved.'), JSON.stringify(l6));
  ok('and the file on disk is as it was', !(await import('node:fs')).readFileSync(`${work}/notes/plan.md`, 'utf8').includes('Added and unsaved'));
  if (six) await six.screenshot({ path: `${process.env.SHOTS || 'test/shots'}/tearoff-6-note.png` }).catch(() => {});

  // ----- a new window (⇧⌘N) starts empty: it must not reopen the session under the first window's terminals -----
  const mine = (await layout(page)).terms;
  const had3 = new Set(app.windows());
  await page.evaluate(() => 0);
  const four = await (async () => { await page.evaluate(() => window.astrolabe.app.newWindow()); await at(3500); return app.windows().find((w) => !had3.has(w) && w.url().startsWith('astrolabe:')); })();
  const theirs = four ? (await layout(four)).terms : [];
  await page.evaluate(() => window.__store.getState().focusArea('terminal')); await at(300);
  await page.locator('.term-host:visible').first().click();
  await run('echo alive-$((6*7))');
  ok('a new window has terminals of its own and ends none', theirs.length === 1 && !mine.includes(theirs[0]) && (await text(page, mine[0])).includes('alive-42'), `${mine} / ${theirs}`);
}
