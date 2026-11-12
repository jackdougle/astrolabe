// Typing while a command runs: what is left over must end up in the command input, not on the shell's own line.
export default async function ({ page, run, shot }) {
  const probe = () => page.evaluate(() => {
    const s = [...window.__sessions.values()].at(-1);
    const b = s.term.buffer.normal;
    const rows = []; for (let y = 0; y < b.length; y++) { const t = b.getLine(y).translateToString(true); if (t.trim()) rows.push(t.trim().slice(0, 70)); }
    const el = [...document.querySelectorAll('.cmd-input')].at(-1);
    return { state: s.state, rows: rows.slice(-4), input: el?.querySelector('.view-lines')?.textContent, hidden: el?.classList.contains('is-hidden'), active: document.activeElement?.className?.slice?.(0, 40) };
  });
  await run('sleep 2', 300);
  await page.keyboard.type('echo ahead', { delay: 30 });
  await page.waitForTimeout(3000);
  console.log('typed during sleep:', JSON.stringify(await probe()));
  await shot('ahead-1');
  await page.keyboard.type(' more', { delay: 30 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  console.log('then " more" + Enter:', JSON.stringify(await probe()));
  await run('sleep 2', 300);
  await page.keyboard.type('echo ran-ahead', { delay: 30 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3500);
  console.log('typed + Enter during sleep:', JSON.stringify(await probe()));
  await shot('ahead-2');
}
