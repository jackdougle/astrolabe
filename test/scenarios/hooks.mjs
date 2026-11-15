// The two settings that name a command of the user's own. `noteTemplate`: a ⌘N note starts with what the command
// prints, and is still deleted when closed with nothing added. `onFileClose`: the command is run when a file's last
// tab closes, what it prints is shown as a message, it may move the file, and a failure is reported.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const template = path.join(os.tmpdir(), `astrolabe-template-${process.pid}.sh`);
const closed = path.join(os.tmpdir(), `astrolabe-closed-${process.pid}.sh`);
// The template: a line naming the folder it was given, then a blank line.
fs.writeFileSync(template, '#!/bin/sh\nprintf "*made in %s*\\n\\n" "$(basename "$1")"\n', { mode: 0o755 });
// On close: every call is logged; a note with "journal" in its name is moved to vault/, "broken" fails, the rest pass in silence.
fs.writeFileSync(closed, '#!/bin/sh\necho "$1" >> "$(dirname "$1")/closed.log"\ncase "$(basename "$1")" in\n  *journal*) mv "$1" "$(dirname "$1")/vault/" && echo "Moved $(basename "$1" .md) to vault";;\n  *broken*) echo "no such place" >&2; exit 3;;\nesac\n', { mode: 0o755 });
export const settings = { noteTemplate: template, onFileClose: closed };
export default async function ({ page, work, shot, run, type }) {
  await run(`cd ${work} && git init -q`, 1200);
  fs.mkdirSync(path.join(work, 'vault'));
  for (const n of ['my journal.md', 'broken.md', 'other.md']) fs.writeFileSync(path.join(work, n), `# ${n}\n\nSome words.\n`);
  const open = async (n) => { await page.evaluate((f) => window.__store.getState().openFile(f), `${work}/${n}`); await page.waitForTimeout(900); };
  const close = async () => { await page.keyboard.press('Meta+w'); await page.waitForTimeout(1300); };
  const toast = () => page.evaluate(() => document.querySelector('.toast')?.textContent ?? null);
  const log = () => (fs.existsSync(path.join(work, 'closed.log')) ? fs.readFileSync(path.join(work, 'closed.log'), 'utf8').trim().split('\n').map((p) => path.basename(p)) : []);
  const has = (n) => fs.existsSync(path.join(work, n));
  const want = `*made in ${path.basename(work)}*\n\n`;

  await open('main.py'); // a second file, so closing a note never closes the editor
  await page.keyboard.press('Meta+n'); await page.waitForTimeout(2000);
  console.log('1 ⌘N starts with the template:', fs.readFileSync(`${work}/Untitled.md`, 'utf8') === want, JSON.stringify(fs.readFileSync(`${work}/Untitled.md`, 'utf8')));
  await close();
  console.log('2 closed with nothing added → deleted:', !has('Untitled.md'));
  await page.keyboard.press('Meta+n'); await page.waitForTimeout(2000);
  await type('words under it'); await page.waitForTimeout(500);
  await page.keyboard.press('Meta+s'); await page.waitForTimeout(700);
  console.log('3 typing lands under the template:', JSON.stringify(fs.readFileSync(`${work}/Untitled.md`, 'utf8')));
  await shot('hooks-1');
  await close();
  console.log('4 kept, and the close command was told of it alone (not of the deleted one):', has('Untitled.md'), log());

  await open('other.md'); await close();
  console.log('5 a silent command leaves it be:', has('other.md'), '| toast:', await toast());
  await page.keyboard.press('Meta+l'); await page.waitForTimeout(600);
  await open('my journal.md'); await close();
  console.log('6 the command moved it:', !has('my journal.md') && has('vault/my journal.md'), '| toast:', await toast());
  console.log('7 the navigator looked again:', await page.evaluate(() => ![...document.querySelectorAll('.treerow')].some((r) => r.textContent === 'my journal.md')));
  await shot('hooks-2');
  await open('broken.md'); await close();
  console.log('8 a failing command is reported:', has('broken.md'), '| toast:', await toast());
  await open('main.py'); // already open: brought to the front
  await page.evaluate((f) => { const s = window.__store.getState(); s.openFile(f); }, `${work}/data.json`); await page.waitForTimeout(700);
  await close();
  console.log('9 any file, not only notes, and once each:', log());
  await open('other.md'); await page.keyboard.press('Meta+w'); await page.waitForTimeout(120); await open('other.md'); await page.waitForTimeout(800);
  console.log('10 closed and opened again at once → not run:', log().filter((n) => n === 'other.md').length === 1);
  fs.rmSync(template, { force: true }); fs.rmSync(closed, { force: true });
}
