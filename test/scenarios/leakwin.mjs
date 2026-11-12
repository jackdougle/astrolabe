// A real new window: type while it loads and its shell starts, by key, by paste, and by text input with no key event.
export default async function ({ app, page }) {
  const probe = (p) => p.evaluate(() => {
    const s = [...window.__sessions.values()].at(-1);
    const b = s.term.buffer.normal;
    const rows = []; for (let y = 0; y < b.length; y++) { const t = b.getLine(y).translateToString(true); if (t.trim()) rows.push(t.trim().slice(0, 70)); }
    const el = [...document.querySelectorAll('.cmd-input')].at(-1);
    return { state: s.state, booted: s.booted, rows, input: el?.querySelector('.view-lines')?.textContent, hidden: el?.classList.contains('is-hidden'), active: document.activeElement?.className?.slice?.(0, 40) };
  });
  const open = async () => {
    const [win] = await Promise.all([app.waitForEvent('window'), page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', metaKey: true, shiftKey: true, bubbles: true })))]);
    return win;
  };
  // 1. keys, from the moment the window exists
  let w = await open();
  await w.waitForSelector('.term-host .xterm', { timeout: 20000 });
  await w.keyboard.type('abcdefghijklmnopqrstuvwxyz', { delay: 40 });
  await w.waitForTimeout(3000);
  console.log('window keys:', JSON.stringify(await probe(w)));
  // 2. paste before the prompt, in a new split
  await app.evaluate(({ clipboard }) => clipboard.writeText('pasted-early'));
  await w.keyboard.press('Meta+d');
  await w.waitForTimeout(60);
  await w.keyboard.press('Meta+v');
  await w.waitForTimeout(3000);
  console.log('paste early:', JSON.stringify(await probe(w)));
  // 3. text arriving as an input event with no key (dictation, emoji picker, IME)
  await w.keyboard.press('Meta+d');
  await w.waitForTimeout(60);
  await w.keyboard.insertText('dictated early');
  await w.waitForTimeout(3000);
  console.log('insertText early:', JSON.stringify(await probe(w)));
}
