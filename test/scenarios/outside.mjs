// A file handed to the app from outside (`open -a Astrolabe note.md`) opens in the window: a note rendered, with
// the caret at its end, so typing goes under what is there. The event macOS would send is raised by hand here.
import fs from 'node:fs';
import path from 'node:path';
export default async function ({ app, page, type, work, shot }) {
  const hand = (file) => app.evaluate(({ app }, f) => { app.emit('open-file', { preventDefault() {} }, f); }, file);
  const fileTabs = () => page.evaluate(() => [...document.querySelectorAll('.filetab')].map((f) => f.textContent));
  const note = path.join(work, 'notes', 'Nils Justen.md');
  fs.writeFileSync(note, '*11.12.2026 - 12:30 PM*\n\n');

  await hand(note); await page.waitForTimeout(1800);
  console.log('1 note opens:', JSON.stringify(await fileTabs()), '| title:', await page.evaluate(() => document.querySelector('.rich-title')?.textContent ?? null),
    '| rendered:', await page.evaluate(() => !!document.querySelector('.rich')), '| caret in note:', await page.evaluate(() => !!document.activeElement?.closest('.rich')));
  await type('What should we build first?'); await page.waitForTimeout(300);
  await page.keyboard.press('Meta+s'); await page.waitForTimeout(700);
  console.log('1 typing lands under the stamp:', JSON.stringify(fs.readFileSync(note, 'utf8')));
  await shot('outside-note');

  // The same note again (a second meeting) does not open a second tab; a code file opens raw.
  await hand(note); await hand(path.join(work, 'main.py')); await page.waitForTimeout(1500);
  console.log('2 tabs after the note again and a code file:', JSON.stringify(await fileTabs()));

  // A folder, or a path that is not there, is left alone.
  await hand(work); await hand(path.join(work, 'nothing.md')); await page.waitForTimeout(800);
  console.log('3 tabs after a folder and a missing file:', JSON.stringify(await fileTabs()));

  // Arriving while the window reloads, the file waits for the new page.
  const late = path.join(work, 'notes', 'Peter.md');
  fs.writeFileSync(late, '*11.12.2026 - 1:00 PM*\n\n');
  // (Handed over as the new document commits: the old page is gone and the new one is not listening yet.)
  await app.evaluate(({ app, BrowserWindow }, f) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents;
    wc.once('did-navigate', () => app.emit('open-file', { preventDefault() {} }, f));
    wc.reload();
  }, late);
  await page.waitForSelector('.filetab:has-text("Peter.md")', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
  console.log('4 tabs after a file arrived during a reload:', JSON.stringify(await fileTabs()), '| title:', await page.evaluate(() => document.querySelector('.rich-title')?.textContent ?? null));
}
