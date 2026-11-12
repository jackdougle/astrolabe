// Agent tab state (pulses only while working), ⌘-click file links, Tab accepts the grey suggestion.
import fs from 'node:fs';
import path from 'node:path';

export default async function ({ page, shot, run, type, work }) {
  const tabs = () => page.evaluate(() => [...document.querySelectorAll('.toptab')].map((t) => `${t.querySelector('.toptab-text').textContent} [${t.className.replace('toptab', '').trim()}] mark=[${t.querySelector('.tab-mark').className}]`));
  await run(`cd ${work}`);
  // A stand-in for Claude Code: it titles the window "✳ …" while waiting and "◐ …" while working.
  fs.writeFileSync(path.join(work, 'fake-agent.sh'), [
    'printf "FORCE_HYPERLINK=%s\\n" "$FORCE_HYPERLINK"',
    "printf '\\e]0;✳ Claude Code\\a'; sleep 1.5",
    "printf '\\e]0;◐ thinking\\a'; sleep 0.5; printf '\\e]0;◑ thinking\\a'; sleep 1.5",
    "printf '\\e]0;✳ done\\a'; sleep 1.5",
    "printf '\\e]0;◐ again\\a'; sleep 2",
    "printf '\\e]0;✳ done again\\a'; sleep 4",
  ].join('\n'));
  await run('bash fake-agent.sh', 600);
  console.log('agent waiting at start:', JSON.stringify(await tabs()));
  await page.waitForTimeout(1300);
  console.log('agent working:', JSON.stringify(await tabs()));
  await shot('agent-1-working');
  await page.waitForTimeout(1800);
  console.log('agent waiting for you:', JSON.stringify(await tabs()));
  await shot('agent-2-waiting');
  // second turn finishes while you are on another tab
  await page.keyboard.press('Meta+t');
  await page.waitForTimeout(1000);
  console.log('working, seen from tab 2:', JSON.stringify(await tabs()));
  await page.waitForTimeout(1800);
  console.log('turn ended in background:', JSON.stringify(await tabs()));
  await shot('agent-3-flash');
  await page.keyboard.press('Meta+1');
  await page.waitForTimeout(4500);

  // Links: an OSC 8 file link (what Claude Code sends) and a plain path with a line number.
  await run(`printf '\\e]8;;file://${work}/main.py#L4\\aOSC-LINK\\e]8;;\\a\\n'; echo "see main.py:8 for more"`, 900);
  const cell = (needle) => page.evaluate((needle) => {
    const s = [...window.__sessions.values()][0];
    const b = s.term.buffer.active;
    for (let y = b.length - 1; y >= 0; y--) {
      const t = b.getLine(y).translateToString(true);
      const x = t.indexOf(needle);
      if (x >= 0 && !t.includes('printf')) {
        const r = s.host.querySelector('.xterm-screen').getBoundingClientRect();
        const cw = r.width / s.term.cols; const ch = r.height / s.term.rows;
        return { x: r.left + (x + 2.5) * cw, y: r.top + (y - b.viewportY + 0.5) * ch };
      }
    }
    return null;
  }, needle);
  const openFiles = () => page.evaluate(() => [...document.querySelectorAll('.filetab-name')].map((e) => e.textContent));
  const cursorLine = () => page.evaluate(() => { const ed = window.__monaco?.editor?.getEditors?.().find((e) => e.getModel()?.uri.path.endsWith('main.py')); return ed?.getPosition()?.lineNumber ?? null; });
  for (const needle of ['OSC-LINK', 'main.py:8']) {
    const at = await cell(needle);
    if (!at) { console.log('!! could not find', needle); continue; }
    await page.mouse.move(at.x - 30, at.y - 30); await page.waitForTimeout(100); await page.mouse.move(at.x, at.y, { steps: 4 });
    await page.waitForTimeout(400);
    await page.keyboard.down('Meta');
    await page.mouse.click(at.x, at.y);
    await page.keyboard.up('Meta');
    await page.waitForTimeout(900);
    console.log(`after ⌘-click on ${needle}: files=${JSON.stringify(await openFiles())} line=${await cursorLine()}`);
    await shot(`agent-4-link-${needle.replace(/\W/g, '')}`);
    await page.keyboard.press('Meta+w');
    await page.waitForTimeout(500);
  }

  // Tab accepts the history suggestion shown in grey.
  await page.keyboard.press('Meta+1');
  await page.waitForTimeout(300);
  await run('echo hello-suggestion-world', 700);
  await type('echo hello-s');
  await page.waitForTimeout(500);
  await shot('agent-5-ghost');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  console.log('input after Tab:', JSON.stringify(await page.evaluate(() => document.querySelector('.cmd-input .view-lines')?.textContent)));
  await shot('agent-6-accepted');
}
