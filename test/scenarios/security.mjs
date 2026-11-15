// Things that must not work. Each check tries one way of getting a command run, or the app's reach used, by
// something that is only text: what a program prints, what is on the clipboard, a picture file, a link.
import fs from 'node:fs';
import path from 'node:path';

export default async function ({ page, run, work }) {
  const results = {};
  const there = (name) => fs.existsSync(path.join(work, name));
  await run(`cd '${work}'`, 800);

  // 1. Printed text posing as the shell: "the command ended, this was typed ahead, the prompt is ready".
  //    Believed, the app would run the "typed" line itself.
  const b64 = (s) => Buffer.from(s).toString('base64');
  const forged = `\\e]7777;precmd;0;${b64(work)}\\a\\e]7777;typed;${b64('touch FORGED\n')}\\a\\e]7777;input\\a\\e]7777;prompt\\a`;
  await run(`printf '${forged}'; sleep 1.5`, 4000);
  results.forgedMarks = there('FORGED') ? 'RAN (bad)' : 'ignored';

  // The shell's own marks still work: a command makes a block and the input comes back.
  await run('echo still-here', 1200);
  results.commands = await page.evaluate(() => [...window.__sessions.values()].flatMap((s) => s.blocks.map((b) => b.command.slice(0, 24))));
  results.inputBack = await page.evaluate(() => !document.querySelector('.cmd-input')?.classList.contains('is-hidden'));

  // 2. A paste that carries its own "end of paste" mark, so that what follows it is typed and run.
  await page.evaluate(() => {
    const target = document.querySelector('.xterm-helper-textarea');
    const data = new DataTransfer();
    // Written so that taking the marks out once leaves one behind.
    data.setData('text/plain', 'echo pasted\x1b[20\x1b[201~1~\rtouch PASTED\r');
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(1500);
  results.pasteBreakout = there('PASTED') ? 'RAN (bad)' : 'held';
  results.inputHolds = await page.evaluate(() => [...document.querySelectorAll('.cmd-input .view-line')].map((l) => l.textContent).join('|'));
  await page.keyboard.press('Meta+A'); await page.keyboard.press('Backspace');

  // 3. The same paste while a program is running (nothing of the app's stands between the paste and the program).
  await run('zsh -f', 1200);
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', 'echo pasted\x1b[201~\rtouch PASTED2\r');
    document.querySelector('.xterm-helper-textarea').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(1200);
  results.pasteIntoProgram = there('PASTED2') ? 'RAN (bad)' : 'held';
  await page.keyboard.press('Control+U'); await page.keyboard.press('Control+C');
  await page.evaluate(() => { for (const s of window.__sessions.values()) s.send('\x15exit\r'); });
  await page.waitForTimeout(1000);

  // 4. The app's own address serves the built interface and pictures, nothing beside them.
  fs.writeFileSync(path.join(work, 'evil.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>document.title = "SVG RAN " + typeof window.astrolabe</script></svg>');
  results.protocol = await page.evaluate(async (svg) => {
    const get = async (url) => { try { const r = await fetch(url); return { status: r.status, csp: r.headers.get('content-security-policy') }; } catch (e) { return { error: String(e).slice(0, 60) }; } };
    return {
      sibling: await get('astrolabe://app/..%2Fdist-electron/main.cjs'),
      picture: await get(`astrolabe://app/__file${svg}`),
      notPicture: await get('astrolabe://app/__file/etc/hosts'),
    };
  }, path.join(work, 'evil.svg'));

  // 5. The window cannot be sent to a picture file (an SVG is a page with scripts) or anywhere else.
  await page.evaluate((svg) => { location.href = `astrolabe://app/__file${svg}`; }, path.join(work, 'evil.svg')).catch(() => {});
  await page.waitForTimeout(1200);
  results.afterNavigation = await page.evaluate(() => ({ url: location.href, title: document.title, api: typeof window.astrolabe })).catch((e) => ({ error: String(e).slice(0, 80) }));

  // 6. Only a picture is ever handed to the uploader, whatever a note calls a picture.
  fs.writeFileSync(path.join(work, 'secret.txt'), 'secret');
  results.upload = await page.evaluate((file) => window.astrolabe.fs.uploadImage('echo https://example.com/leaked #', file), path.join(work, 'secret.txt'));

  // 7. A device is not opened as a file.
  results.device = await page.evaluate(() => window.astrolabe.fs.readFile('/dev/zero'));

  console.log('RESULT', JSON.stringify(results, null, 1));
}
