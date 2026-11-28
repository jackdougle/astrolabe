// A plain click on a link in a rendered note shows a box under it with the address. Clicking the address
// goes there; the pencil turns it into a field, and Enter writes the new address into the note; the bin takes the
// link off and leaves its words.
import fs from 'node:fs';
import path from 'node:path';
export default async function ({ page, shot, work }) {
  const ok = (name, pass, detail = '') => console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  const note = path.join(work, 'notes', 'links.md');
  fs.writeFileSync(note, '# Links\n\nOpen [the script](../main.py) or read [the site](https://example.com/a) today, or [the third](https://example.net/c).\n');
  await page.evaluate((f) => window.__store.getState().openFile(f), note);
  await page.waitForSelector('.ProseMirror a[href="../main.py"]');
  await page.waitForTimeout(400);
  const box = () => page.evaluate(() => { const b = document.querySelector('.link-box:not(.is-ghost)'); if (!b) return null; const r = b.getBoundingClientRect(); return { text: b.querySelector('.link-go span')?.textContent ?? null, top: Math.round(r.top), left: Math.round(r.left), editing: b.classList.contains('is-editing') }; });
  const text = () => page.evaluate(() => window.__monaco.editor.getModels().find((m) => m.uri.path.endsWith('links.md'))?.getValue());
  const files = () => page.evaluate(() => [...document.querySelectorAll('.filetab-name')].map((e) => e.textContent));

  ok('no box to begin with', (await box()) === null);
  const site = await page.$('.ProseMirror a[href="https://example.com/a"]');
  const at = await site.boundingBox();
  await site.click();
  await page.waitForTimeout(250);
  const shown = await box();
  ok('a click shows the address', shown?.text === 'https://example.com/a', JSON.stringify(shown));
  ok('the box sits just under the link', !!shown && shown.top >= at.y + at.height && shown.top < at.y + at.height + 14 && Math.abs(shown.left - at.x) < 3, `${JSON.stringify(at)} ${JSON.stringify(shown)}`);
  ok('the caret is still in the note', await page.evaluate(() => !!document.activeElement?.closest('.ProseMirror')));
  await shot('linkbox-1-shown');

  // The pencil: change the address.
  await page.click('.link-box .link-edit');
  await page.waitForTimeout(150);
  ok('the pencil gives a field holding the address', await page.evaluate(() => document.activeElement?.classList.contains('link-input') && document.activeElement.value === 'https://example.com/a'));
  await shot('linkbox-2-editing');
  await page.keyboard.type('https://example.org/b');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  ok('Enter writes the new address into the note', (await text())?.includes('[the site](https://example.org/b)'), JSON.stringify(await text()));
  ok('the words of the link are unchanged', (await text())?.includes('read [the site]'));
  ok('the box has gone and the note has the keyboard', (await box()) === null && await page.evaluate(() => !!document.activeElement?.closest('.ProseMirror')));

  // Escape leaves the address alone.
  await page.click('.ProseMirror a[href="https://example.org/b"]');
  await page.click('.link-box .link-edit');
  await page.keyboard.type('nothing');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  ok('Escape changes nothing', (await text())?.includes('(https://example.org/b)') && (await box()) === null);

  // Typing in the note, or a click elsewhere, puts the box away.
  await page.click('.ProseMirror a[href="https://example.org/b"]');
  await page.waitForTimeout(150);
  await page.keyboard.press('ArrowRight');
  ok('a key in the note closes the box', (await box()) === null);
  await page.click('.ProseMirror a[href="https://example.org/b"]');
  await page.waitForTimeout(150);
  await page.click('.ProseMirror h1');
  ok('a click elsewhere closes the box', (await box()) === null);

  // An emptied address removes the link and keeps its words.
  await page.click('.ProseMirror a[href="https://example.org/b"]');
  await page.click('.link-box .link-edit');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  ok('an empty address removes the link, not its words', /read the site today/.test(await text() ?? ''), JSON.stringify(await text()));

  // The bin takes the link off and keeps its words.
  await page.click('.ProseMirror a[href="https://example.net/c"]');
  await page.waitForTimeout(200);
  ok('the box has a bin', await page.evaluate(() => !!document.querySelector('.link-box .link-remove')));
  await shot('linkbox-3-bin');
  await page.click('.link-box .link-remove');
  await page.waitForTimeout(400);
  ok('the bin removes the link, not its words', /or the third\./.test(await text() ?? ''), JSON.stringify(await text()));
  ok('and the box is gone, the note has the keyboard', (await box()) === null && await page.evaluate(() => !!document.activeElement?.closest('.ProseMirror')));

  // Clicking the address goes there: a file opens in the editor.
  await page.click('.ProseMirror a[href="../main.py"]');
  await page.waitForTimeout(200);
  await page.click('.link-box .link-go');
  await page.waitForTimeout(900);
  ok('clicking the address opens the file', (await files()).includes('main.py'), JSON.stringify(await files()));
  ok('and the box is gone', (await box()) === null);
}
