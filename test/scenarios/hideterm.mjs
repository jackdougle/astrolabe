// ⌘U takes the terminal you are looking at off screen and leaves it running; the chip in the bottom right corner
// of the terminals lists what is hidden, a click there brings one back, and ⇧⌘U brings them all back. A hidden
// terminal keeps its place in its tab, survives its tab's other terminals closing and a reload of the window, and
// never lets the window close under it. Also: the keyboard button at the foot of the navigator lists every hotkey.
// The reload step only touches a source file's timestamp, so this is safe to run in the real folder.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

export default async function ({ page, shot, type, run, work }) {
  const at = (ms) => page.waitForTimeout(ms);
  const ok = (name, pass, detail = '') => console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  const st = () => page.evaluate(() => {
    const s = window.__store.getState();
    const terms = Object.values(s.panes).filter((p) => p.kind === 'terminal');
    const seen = [...document.querySelectorAll('.tab-area.is-active .pane')].filter((p) => getComputedStyle(p).visibility !== 'hidden' && !p.classList.contains('is-leaving'));
    return {
      terms: terms.length, hidden: terms.filter((p) => p.hidden).length, shells: window.__sessions.size,
      tabs: document.querySelectorAll('.tab-group:not(.is-leaving)').length, segs: document.querySelectorAll('.tab-group:not(.is-leaving) > .toptab:not(.is-leaving)').length,
      onScreen: seen.map((p) => (p.querySelector('.editor-pane') ? 'editor' : 'term')).join('+'),
      chip: document.querySelector('.hidden-chip')?.textContent ?? null, apart: !!document.querySelector('.hidden-terms.is-apart'),
      focus: s.focus, front: s.activeTab ? 'a tab' : 'none', windowOpen: true,
    };
  });
  const ticks = () => { try { return fs.readFileSync(`${work}/ticks.txt`, 'utf8').trim().split('\n').length; } catch { return 0; } };
  const hide = async () => { await page.keyboard.press('Meta+u'); await at(500); };

  await run(`cd ${work}`);
  await run(`for i in $(seq 1 400); do echo tick >> ticks.txt; sleep 0.1; done`, 600);
  const loop = await page.evaluate(() => Object.values(window.__store.getState().panes).find((p) => p.kind === 'terminal' && p.running)?.id);
  ok('a command is running in the first terminal', !!loop);

  // The only terminal, with no file open: hiding it leaves a new terminal in its place.
  await hide();
  let s = await st();
  ok('⌘U hides it and a new terminal takes its place', s.hidden === 1 && s.terms === 2 && s.tabs === 1 && s.onScreen === 'term', JSON.stringify(s));
  ok('the chip says so', s.chip === '1 hidden' && !s.apart, String(s.chip));
  const note = () => page.evaluate(() => { const el = document.querySelector('.toast.is-top'); return el ? `${el.textContent} @${Math.round(el.getBoundingClientRect().top)}` : null; });
  const noted = () => page.evaluate(() => window.__store.getState().toast?.n ?? 0);
  const first = await noted();
  ok('the first hide puts a note at the top naming the key', /^Terminal hidden, ⇧⌘U to unhide @\d\d$/.test(await note() ?? ''), String(await note()));
  ok('its shell is still there', s.shells === 2);
  const before = ticks(); await at(1200); const after = ticks();
  ok('its command keeps running while hidden', after > before + 5, `${before} → ${after} lines`);
  const pulsing = (sel) => page.evaluate((sel) => { const el = document.querySelector(sel); return !!el?.querySelector('svg') && getComputedStyle(el).animationIterationCount === 'infinite'; }, sel);
  ok('the chip has the terminal mark, which pulses while a hidden command runs', await pulsing('.hidden-chip .hidden-mark'));
  await shot('hide-1-chip');

  // One of two terminals in a tab: the other takes its room, and it comes back where it was.
  await page.waitForFunction(() => { const s = window.__store.getState(); const t = s.tabs.find((x) => x.id === s.activeTab); return t && s.panes[t.activePane]?.atPrompt; }, null, { timeout: 15000 }).catch(() => {});
  await page.keyboard.press('Meta+d'); await at(1500);
  const width = () => page.evaluate(() => [...document.querySelectorAll('.tab-area.is-active .pane')].filter((p) => getComputedStyle(p).visibility !== 'hidden' && !p.classList.contains('is-leaving')).map((p) => Math.round(p.getBoundingClientRect().width)).join(','));
  const split = await width();
  await hide();
  s = await st();
  ok('the second hide says nothing', (await noted()) === first || (await noted()) === 0);
  ok('hiding one of two leaves the other the whole tab', s.hidden === 2 && s.tabs === 1 && s.segs === 1 && s.onScreen === 'term', `${JSON.stringify(s)}; widths ${split} → ${await width()}`);
  await page.click('.hidden-chip'); await at(250);
  const rows = await page.evaluate(() => [...document.querySelectorAll('.hidden-pop .hidden-row:not(.hidden-all)')].map((r) => r.textContent.trim()));
  ok('in the list only the one at work pulses', !(await pulsing('.hidden-pop .hidden-row:nth-of-type(1) .hidden-mark')) && await pulsing('.hidden-pop .hidden-row:nth-of-type(2) .hidden-mark'));
  ok('the list names both, the one hidden last first', rows.length === 2 && /terminal$/.test(rows[0]) && !/terminal$/.test(rows[1]), JSON.stringify(rows));
  await shot('hide-2-list');
  await page.click('.hidden-pop .hidden-row'); await at(700);
  s = await st();
  ok('a click on one brings it back beside the other', s.hidden === 1 && s.segs === 2 && s.onScreen === 'term+term' && (await width()) === split, `${JSON.stringify(s)}; widths ${await width()}`);
  ok('and it has the keyboard', await page.evaluate(() => { const s = window.__store.getState(); return s.focus === 'terminal' && !!document.activeElement?.closest(`.pane[data-pane="${s.tabs.find((t) => t.id === s.activeTab).activePane}"]`); }));

  // A window reloaded in place keeps what is hidden hidden, and running.
  await hide();
  await page.evaluate(() => { window.__old = true; });
  const f = path.join(root, 'src', 'main.tsx'); const now = new Date(); fs.utimesSync(f, now, now);
  const call = page.evaluate(async () => { await window.astrolabe.app.checkUpdate(); return window.astrolabe.app.installUpdate(0); }).catch((e) => ({ gone: e.message.split('\n')[0] }));
  const up = await page.waitForFunction(() => !window.__old && window.__store?.getState().ready && document.querySelector('.term-host .xterm'), null, { timeout: 40000 }).then(() => true, () => false);
  await page.waitForFunction(() => !document.querySelector('html > img'), null, { timeout: 8000 }).catch(() => {});
  await at(600);
  if (!up) console.log('!! the window did not reload:', JSON.stringify(await Promise.race([call, at(200)])));
  s = await st();
  ok('after a reload both are still hidden, with their shells', up && s.hidden === 2 && s.shells === 3 && s.chip === '2 hidden' && s.onScreen === 'term', JSON.stringify(s));
  const mid = ticks(); await at(1000);
  ok('and the hidden command is still running', ticks() > mid + 4, `${mid} → ${ticks()} lines`);
  // The note is for the first hide since the window opened, not the first since a reload.
  await page.keyboard.press('Meta+d'); await at(1300);
  const extra = await page.evaluate(() => { const s = window.__store.getState(); return s.tabs.find((t) => t.id === s.activeTab).activePane; });
  await hide();
  ok('a hide after the reload says nothing', (await noted()) === 0 && (await st()).hidden === 3, String(await note()));
  await page.evaluate((id) => window.__store.getState().showTerm(id), extra); await at(500);
  await page.keyboard.press('Meta+w'); await at(700);

  // The last terminal on show closes: the window stays, since hidden ones are running.
  await page.keyboard.press('Meta+w'); await at(900);
  s = await st();
  ok('⌘W on the last terminal on show leaves the window, with a new terminal', s.hidden === 2 && s.tabs === 1 && s.onScreen === 'term', JSON.stringify(s));

  // With a file open, the last terminal hides and the editors have the window; the chip waits in the other corner.
  fs.writeFileSync(`${work}/one.md`, 'one\n');
  await page.evaluate((p) => window.__store.getState().openFile(p, null, { stay: true }), `${work}/one.md`); await at(900);
  const lastHidden = await page.evaluate(() => { const s = window.__store.getState(); return s.tabs.find((t) => t.id === s.activeTab).activePane; });
  await hide();
  s = await st();
  ok('with a file open, hiding the last terminal leaves the editor the window', s.hidden === 3 && s.tabs === 0 && s.onScreen === 'editor' && s.focus === 'editor' && s.front === 'none', JSON.stringify(s));
  ok('the chip moves to the bottom left, clear of the word count', s.chip === '3 hidden' && s.apart);
  await shot('hide-3-editor');
  await page.keyboard.press('Meta+d'); await at(1300);
  s = await st();
  ok('⌘D then makes a new terminal, not a split of a hidden one', s.hidden === 3 && s.tabs === 1 && s.segs === 1 && s.onScreen === 'term+editor', JSON.stringify(s));

  // ⇧⌘U brings every one back.
  await page.keyboard.press('Shift+Meta+u'); await at(900);
  s = await st();
  ok('⇧⌘U brings them all back', s.hidden === 0 && s.chip === null && s.terms === s.shells && s.focus === 'terminal', JSON.stringify(s));
  const stillRunning = await page.evaluate((id) => { const p = window.__store.getState().panes[id]; return !!p && p.running; }, loop);
  const last = ticks(); await at(700);
  ok('the first terminal is back with its command still going', stillRunning && ticks() > last, `${last} → ${ticks()} lines`);
  ok('the one hidden last is in front', await page.evaluate((id) => { const s = window.__store.getState(); return s.tabs.find((t) => t.id === s.activeTab)?.activePane === id; }, lastHidden));
  await page.evaluate((id) => window.__store.getState().focusPane(id), loop); await at(500);
  const drawn = await page.evaluate((id) => { const el = document.querySelector(`.pane[data-pane="${id}"]`); const r = el?.getBoundingClientRect(); return !!r && r.width > 100 && getComputedStyle(el).visibility !== 'hidden'; }, loop);
  ok('and is drawn', drawn);
  await shot('hide-4-back');
  await page.keyboard.press('Shift+Meta+u'); await at(300);
  ok('with nothing hidden, ⇧⌘U says so', (await page.evaluate(() => document.querySelector('.toast')?.textContent)) === 'No terminal is hidden');

  // A hidden terminal whose shell ends goes quietly.
  await page.evaluate((id) => window.__sessions.get(id).send('\x03'), loop); await at(700);
  const quiet = await page.evaluate(() => { const s = window.__store.getState(); const id = s.tabs.find((t) => t.id === s.activeTab).activePane; s.hideTerm(id); return id; });
  await at(400);
  ok('a hidden terminal with nothing running leaves the mark still', (await page.evaluate(() => document.querySelector('.hidden-chip')?.textContent)) === '1 hidden' && !(await pulsing('.hidden-chip .hidden-mark')) && await page.evaluate(() => !!document.querySelector('.hidden-chip .hidden-mark svg')));
  await page.evaluate((id) => window.astrolabe.pty.kill(id), quiet).catch(() => {});
  await page.evaluate((id) => window.__store.getState().closePane(id), quiet); await at(500);
  s = await st();
  ok('closing a hidden terminal changes nothing on screen', s.hidden === 0 && s.chip === null && s.terms === s.shells && s.tabs >= 1, JSON.stringify(s));

  // The keyboard button at the foot of the navigator lists every hotkey.
  await page.keyboard.press('Meta+l'); await at(600);
  await page.click('.side-foot .side-keys'); await at(400);
  const keys = await page.evaluate(() => [...document.querySelectorAll('.palette-row')].map((r) => `${r.querySelector('.palette-label').textContent} = ${r.querySelector('kbd')?.textContent}`));
  ok('the hotkeys button lists them', keys.length > 60 && keys.some((k) => k.endsWith('= ⌘U')) && keys.some((k) => k.endsWith('= ⇧⌘U')) && keys.some((k) => k.endsWith('= ⌘1–9')), `${keys.length} rows`);
  await shot('hide-5-hotkeys');
  await type('hidden'); await at(250);
  ok('and searches them', (await page.evaluate(() => document.querySelector('.palette-row.is-selected kbd')?.textContent)) === '⇧⌘U');
  await page.keyboard.press('Escape'); await at(200);
}
