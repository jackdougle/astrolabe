// ⌘R after a change to the interface: the build goes straight into the running copy and the window reloads
// where it stands. The shell is the same process afterwards, a running command keeps printing, the blocks sit
// on the same rows, and half-typed commands and unsaved edits are still there.
// Only a source file's timestamp is touched, so this is safe to run in the real folder.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

export default async function ({ page, shot, type, run, work }) {
  const ok = (name, pass, detail = '') => console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  const blocks = () => page.evaluate(() => [...document.querySelectorAll('.blk')].map((b) => {
    const r = b.getBoundingClientRect();
    return `${b.querySelector('.blk-cmd')?.textContent}@${Math.round(r.top)}+${Math.round(r.height)}${b.classList.contains('is-running') ? ' running' : ''}`;
  }));
  const screen = () => page.evaluate(() => {
    const t = [...window.__sessions.values()][0].term;
    const buf = t.buffer.active;
    const rows = [];
    for (let y = buf.viewportY; y < buf.viewportY + t.rows; y++) rows.push(buf.getLine(y)?.translateToString(true) ?? '');
    return { rows, cursor: `${buf.cursorX},${buf.cursorY}`, length: buf.length, base: buf.baseY };
  });
  const inputText = () => page.evaluate(() => window.__monaco.editor.getModels().find((m) => m.uri.scheme === 'astrolabe-input')?.getValue());
  const touch = () => { const f = path.join(root, 'src', 'main.tsx'); const now = new Date(); fs.utimesSync(f, now, now); };
  /** Presses the update, waits for the new page to be up, and says how long the window was without one. */
  const update = async () => {
    await page.evaluate(() => { window.__old = true; });
    const t0 = Date.now();
    const call = page.evaluate(async () => {
      const status = await window.astrolabe.app.checkUpdate();
      return { status, res: await window.astrolabe.app.installUpdate(0) };
    }).catch((e) => ({ gone: e.message.split('\n')[0] }));
    await page.waitForFunction(() => !window.__old && window.__store?.getState().ready && document.querySelector('.term-host .xterm'), null, { timeout: 30000 });
    await page.waitForFunction(() => !document.querySelector('html > img'), null, { timeout: 8000 }).catch(() => console.log('!! the cover picture never went'));
    const took = Date.now() - t0;
    return { took, call: await Promise.race([call, new Promise((r) => setTimeout(() => r('pending'), 300))]) };
  };

  await run(`cd ${work}`); // the navigator then shows the scratch project
  await run('echo one');
  await run('seq 1 60');
  await run('echo shell $$');
  const pid = (await screen()).rows.join('\n').match(/shell (\d+)/)?.[1];

  // An unsaved edit in a file, then back to the terminal with a half-typed command.
  await page.evaluate((f) => window.__store.getState().openFile(f), path.join(work, 'main.py'));
  await page.waitForSelector('.editor-host .view-line');
  await page.waitForTimeout(300);
  await page.keyboard.type('# unsaved line\n');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  // The navigator, with a folder open.
  await page.evaluate(() => window.__store.getState().setSidebar({ visible: true }));
  await page.waitForSelector('.treerow');
  await page.waitForSelector('.treerow:has-text("main.py")');
  await page.click('.treerow:has-text("notes")');
  await page.waitForSelector('.treerow:has-text("plan.md")');
  const caret = () => page.evaluate(() => { const e = window.__monaco.editor.getEditors().find((x) => x.getModel()?.uri.path.endsWith('main.py')); const p = e?.getPosition(); return p ? `${p.lineNumber}:${p.column}` : null; });
  await page.click('.editor-host .view-lines', { position: { x: 200, y: 200 } }).catch(() => {});
  await page.keyboard.press('Meta+ArrowUp'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  const caretBefore = await caret();
  await page.keyboard.press('Control+`');
  await page.waitForTimeout(250);
  await type('echo half');
  await page.waitForTimeout(200);
  const before = { blocks: await blocks(), screen: await screen(), input: await inputText() };
  await shot('hotreload-1-before');

  ok('nothing to do reports current', (await page.evaluate(() => window.astrolabe.app.checkUpdate())) === 'current');
  touch();
  ok('a touched interface file asks for a reload only', (await page.evaluate(() => window.astrolabe.app.checkUpdate())) === 'reload');
  const first = await update();
  console.log('reload took', first.took, 'ms', JSON.stringify(first.call));
  await page.waitForTimeout(400);
  await shot('hotreload-2-after');
  const after = { blocks: await blocks(), screen: await screen(), input: await inputText() };
  ok('blocks are on the same rows', JSON.stringify(after.blocks) === JSON.stringify(before.blocks), `${before.blocks.join(' | ')} -> ${after.blocks.join(' | ')}`);
  ok('the screen reads the same', JSON.stringify(after.screen.rows) === JSON.stringify(before.screen.rows));
  ok('cursor and scrollback are where they were', after.screen.cursor === before.screen.cursor && after.screen.length === before.screen.length, `${before.screen.cursor}/${before.screen.length} -> ${after.screen.cursor}/${after.screen.length}`);
  ok('the half-typed command is still in the input', after.input === 'echo half', String(after.input));
  ok('the unsaved edit is kept and marked', await page.evaluate(() => window.__monaco.editor.getModels().some((m) => m.getValue().startsWith('# unsaved line')) && Object.values(window.__store.getState().dirty).some(Boolean)));
  ok('the caret in the file is where it was', (await caret()) === caretBefore && !!caretBefore, `${caretBefore} -> ${await caret()}`);
  ok('the folder in the navigator is still open', await page.evaluate(() => [...document.querySelectorAll('.treerow')].some((r) => r.textContent.includes('plan.md'))));
  ok('the file on disk is untouched', !fs.readFileSync(path.join(work, 'main.py'), 'utf8').includes('unsaved'));
  ok('the keyboard is in the command input', await page.evaluate(() => !!document.activeElement?.closest('.cmd-input')));
  ok('up to date afterwards', (await page.evaluate(() => window.astrolabe.app.checkUpdate())) === 'current');

  // The same shell answers.
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
  await run('echo shell $$');
  const rows = (await screen()).rows.join('\n');
  ok('the half-typed command ran', /^half$/m.test(rows));
  ok('it is the same shell process', !!pid && rows.match(/shell (\d+)/g)?.at(-1) === `shell ${pid}`, `${pid} -> ${rows.match(/shell (\d+)/g)?.at(-1)}`);

  // A command that is still running keeps running and keeps printing.
  await run('i=0; while true; do i=$((i+1)); echo tick $i; sleep 0.2; done', 1200);
  const lastTick = async () => Number((await screen()).rows.join('\n').match(/tick (\d+)/g)?.at(-1)?.slice(5) ?? 0);
  const t1 = await lastTick();
  touch();
  const second = await update();
  console.log('reload with a command running took', second.took, 'ms');
  await page.waitForTimeout(1200);
  const t2 = await lastTick();
  const ticks = (await screen()).rows.join('\n').match(/tick (\d+)/g)?.map((t) => Number(t.slice(5))) ?? [];
  ok('the running command kept printing', t2 > t1 + 3, `${t1} -> ${t2}`);
  ok('no output was lost or repeated', ticks.every((n, i) => i === 0 || n === ticks[i - 1] + 1), ticks.slice(-12).join(','));
  ok('its block is still marked running', (await blocks()).some((b) => b.startsWith('i=0') && b.endsWith('running')));
  ok('the tab still shows it running', await page.evaluate(() => !!document.querySelector('.toptab.is-running')));
  await shot('hotreload-3-running');
  await page.keyboard.press('Control+c');
  await page.waitForTimeout(700);
  await run('echo shell $$');
  ok('still the same shell after the second reload', (await screen()).rows.join('\n').match(/shell (\d+)/g)?.at(-1) === `shell ${pid}`);
  ok('one shell process, not two', await page.evaluate(() => window.__sessions.size) === 1);

  // Reload Window does the same without a build.
  await page.evaluate(() => { window.__old = true; });
  await page.keyboard.press('Alt+Meta+r');
  const viaMenu = await page.waitForFunction(() => !window.__old && document.querySelector('.term-host .xterm'), null, { timeout: 6000 }).then(() => true, () => false);
  console.log(viaMenu ? 'ok   Reload Window keeps the session too' : 'note the Reload Window shortcut is a menu key, which a scripted run cannot press');
}
