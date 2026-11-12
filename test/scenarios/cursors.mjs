// A new tab should show one caret: the command input's, never the terminal's as well.
export default async function ({ page, shot }) {
  const probe = (label) => page.evaluate((label) => {
    const s = [...window.__sessions.values()].at(-1);
    const xtermFocused = s.host.querySelector('.xterm')?.classList.contains('focus');
    const ae = document.activeElement; const input = s.host.closest('.term-area')?.querySelector('.cmd-input');
    return `${label}: xterm focus=${xtermFocused} active=${ae?.className?.slice?.(0, 40)} input=${input?.classList.contains('is-hidden') ? 'hidden' : 'shown'} state=${s.state}`;
  }, label);
  for (const wait of [0, 150, 400, 900]) {
    await page.keyboard.press('Meta+t');
    await page.waitForTimeout(wait);
    await page.keyboard.type('abc', { delay: 30 });
    for (const t of [100, 400, 1500]) { await page.waitForTimeout(t); console.log(await probe(`typed after ${wait}ms, +${t}`)); }
    await shot(`cursors-${wait}`);
  }
}
