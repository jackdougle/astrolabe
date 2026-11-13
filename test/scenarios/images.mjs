// Pictures in notes: one dragged from the navigator, dropped from outside or pasted goes into the note where it
// lands and shows there; one from outside the project is copied into `attachments` beside the note. With an
// uploader set (`imageUpload`, here a stand-in that only prints an address) the note gets a web address instead.
// A picture dragged onto a terminal is attached by its path. The events are made by hand, so the real clipboard is left alone.
import fs from 'node:fs';
import path from 'node:path';
export default async function ({ page, shot, run, type, work }) {
  const uploading = !!process.env.UPLOAD;
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  fs.mkdirSync(path.join(work, 'pics'));
  fs.writeFileSync(path.join(work, 'pics', 'dot.png'), Buffer.from(PNG, 'base64'));
  const note = path.join(work, 'notes', 'pictures.md');
  fs.writeFileSync(note, 'First paragraph of the note.\n\nSecond paragraph, further down.\n\n![kept](../pics/dot.png)\n');
  const row = (name) => `.treerow:has(.tree-name:text-is("${name}"))`;
  const toast = () => page.evaluate(() => document.querySelector('.toast')?.textContent ?? null);
  const imgs = () => page.evaluate(() => [...document.querySelectorAll('.rich img:not(.ProseMirror-separator)')].map((i) => `${i.getAttribute('src').replace(/^astrolabe:\/\/app\/__file.*\/work\//, 'file:')}${i.complete && i.naturalWidth > 0 ? ' (shown)' : ' (not shown)'}`));
  const saved = async () => { await page.keyboard.press('Meta+s'); await page.waitForTimeout(500); return fs.readFileSync(note, 'utf8'); };
  const mid = async (sel) => { const b = await page.locator(sel).first().boundingBox(); return { x: b.x + Math.min(b.width / 2, 60), y: b.y + b.height / 2 }; };
  const drag = async (from, to) => {
    const a = await mid(from);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(a.x + 12, a.y + 9, { steps: 3 });
    await page.mouse.move(to.x, to.y, { steps: 8 }); await page.waitForTimeout(200); await page.mouse.up(); await page.waitForTimeout(1200);
  };
  // A picture with no file behind it (a screenshot), dropped or pasted.
  const fire = (kind, selector, name) => page.evaluate(({ kind, selector, name, PNG }) => {
    const dt = new DataTransfer();
    dt.items.add(new File([Uint8Array.from(atob(PNG), (c) => c.charCodeAt(0))], name, { type: 'image/png' }));
    const el = selector ? document.querySelector(selector) : document.activeElement;
    const r = el.getBoundingClientRect();
    const ev = kind === 'paste' ? new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }) : new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 30, clientY: r.top + r.height / 2 });
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
  }, { kind, selector, name, PNG });

  await run(`cd ${work}`);
  await page.keyboard.press('Meta+p'); await page.waitForTimeout(350); await type('pictures'); await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
  console.log('a picture already in the note:', JSON.stringify(await imgs()));
  await page.keyboard.press('Meta+l'); await page.waitForTimeout(700);
  await page.click(row('pics')); await page.waitForTimeout(500);

  const second = await page.locator('.rich p').nth(1).boundingBox();
  await drag(row('dot.png'), { x: second.x + 60, y: second.y + second.height / 2 });
  console.log('dot.png from the navigator onto the second paragraph:', JSON.stringify(await imgs()), '| toast:', JSON.stringify(await toast()), '\n  file:', JSON.stringify(await saved()));

  console.log('a screenshot dropped on the first paragraph: taken', await fire('drop', '.rich p', 'Screen Shot.png'));
  await page.waitForTimeout(1500);
  console.log('  ', JSON.stringify(await imgs()), '\n  file:', JSON.stringify(await saved()));
  await page.click('.rich p >> nth=0'); await page.waitForTimeout(300); await page.keyboard.press('Meta+ArrowRight'); await page.waitForTimeout(250);
  console.log('a screenshot pasted at the caret: taken', await fire('paste', null, 'image.png'));
  await page.waitForTimeout(1500);
  console.log('  ', JSON.stringify(await imgs()), '\n  file:', JSON.stringify(await saved()));
  const beside = path.join(work, 'notes', 'attachments');
  console.log('attachments beside the note:', JSON.stringify(fs.existsSync(beside) ? fs.readdirSync(beside).map((f) => f.replace(/^\d{8}-\d{6}/, 'STAMP')) : null));
  await shot(uploading ? 'images-uploaded' : 'images');

  if (uploading) {
    await page.keyboard.press('Meta+Shift+p'); await page.waitForTimeout(400); await type('Upload the pictures'); await page.waitForTimeout(300); await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
    console.log('"Upload the pictures in this note":', JSON.stringify(await toast()), '\n  file:', JSON.stringify(await saved()));
    await page.keyboard.press('Meta+z'); await page.waitForTimeout(400);
  }

  // Raw view: the same drop writes the same Markdown.
  await page.keyboard.press('Meta+Shift+r'); await page.waitForTimeout(800);
  const line = await page.locator('.editor-pane .view-line').first().boundingBox();
  await drag(row('dot.png'), { x: line.x + 5, y: line.y + line.height / 2 });
  console.log('onto the raw view, first line:', JSON.stringify((await saved()).split('\n')[0]));

  // Onto a terminal: its path.
  const term = await page.locator('.pane:has(.term-host)').first().boundingBox();
  await drag(row('dot.png'), { x: term.x + term.width / 2, y: term.y + term.height / 2 });
  console.log('onto the terminal:', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.cmd-input .view-line')].map((l) => l.textContent.replace(/ /g, ' ').replace(/^.*\/work\//, 'work/')))));
}
