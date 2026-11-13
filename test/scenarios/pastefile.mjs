// Pasting or dropping a picture that is not a file on disk (a screenshot on the clipboard) into a terminal saves
// it under the config folder and hands its path to the command line, or to the program running there.
// The events are made by hand so the real clipboard is left alone.
import fs from 'node:fs';
export default async function ({ page, run, cfg }) {
  const ok = (name, pass, detail = '') => console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const fire = (kind, selector, name, text = '') => page.evaluate(({ kind, selector, name, text, PNG }) => {
    const dt = new DataTransfer();
    dt.items.add(new File([Uint8Array.from(atob(PNG), (c) => c.charCodeAt(0))], name, { type: 'image/png' }));
    if (text) dt.setData('text/plain', text);
    const el = selector ? document.querySelector(selector) : document.activeElement;
    const ev = kind === 'paste' ? new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }) : new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
  }, { kind, selector, name, text, PNG });
  const input = () => page.evaluate(() => window.__monaco.editor.getModels().find((m) => m.uri.scheme === 'astrolabe-input')?.getValue() ?? '');
  const screen = () => page.evaluate(() => { const t = [...window.__sessions.values()][0].term; const b = t.buffer.active; const out = []; for (let y = 0; y < b.length; y++) out.push(b.getLine(y).translateToString(true)); return out.join('\n'); });

  ok('a paste with a picture is taken', await fire('paste', null, 'image.png'));
  await page.waitForTimeout(500);
  const typed = await input();
  const file = typed.trim();
  ok('its path lands in the command input', /\/pasted\/\d{8}-\d{6}-image\.png $/.test(typed) && file.startsWith(cfg), typed);
  ok('the picture is saved there', fs.existsSync(file) && fs.readFileSync(file).toString('base64') === PNG);
  ok('the keyboard stays in the command input', await page.evaluate(() => !!document.activeElement?.closest('.cmd-input')));
  await page.keyboard.press('Control+u');

  await fire('paste', null, 'image.png', 'just text');
  await page.waitForTimeout(300);
  ok('text copied with a picture of itself pastes as text', (await input()) === 'just text', await input());
  await page.keyboard.press('Control+u');

  // With a program running, the path goes to the program, as a paste.
  await run('cat', 700);
  ok('a paste while a program runs is taken', await fire('paste', '.xterm-helper-textarea', 'shot.png'));
  await page.waitForTimeout(600);
  ok('the running program receives the path', /\/pasted\/\d{8}-\d{6}(-\d+)?-shot\.png/.test((await screen()).replace(/\n/g, '')), (await screen()).split('\n').filter((l) => l.includes('pasted')).join(' | '));
  await page.keyboard.press('Control+c');
  await page.waitForTimeout(600);

  ok('a dropped picture with no file behind it is taken too', await fire('drop', '.term-host', 'dragged.png'));
  await page.waitForTimeout(500);
  ok('and its path lands in the command input', /-dragged\.png $/.test(await input()), await input());
}
