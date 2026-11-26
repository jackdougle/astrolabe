// Clicking a web link in a rendered note shows the page's title, with its icon on the left, above the address.
// A local server stands in for the web page; a link to a file gets no title row.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
export default async function ({ page, shot, work }) {
  const ok = (name, pass, detail = '') => console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  const server = http.createServer((req, res) => {
    if (req.url === '/icon.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(PNG); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head><title>The Sky &amp; Its Instruments</title><link rel="icon" href="/icon.png"></head><body>hi</body></html>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/page`;
  const note = path.join(work, 'notes', 'preview.md');
  fs.writeFileSync(note, `# Preview\n\nRead [the page](${url}) or [the script](../main.py).\n`);
  await page.evaluate((f) => window.__store.getState().openFile(f), note);
  await page.waitForSelector(`.ProseMirror a[href="${url}"]`);
  await page.waitForTimeout(400);

  await page.click(`.ProseMirror a[href="${url}"]`);
  await page.waitForSelector('.link-box .link-head:not([hidden])', { timeout: 8000 }).catch(() => {});
  const got = await page.evaluate(() => {
    const b = document.querySelector('.link-box');
    const h = b?.querySelector('.link-head');
    const go = b?.querySelector('.link-go');
    return h && go && { shown: !h.hidden, title: h.querySelector('span').textContent, icon: !h.querySelector('img').hidden && h.querySelector('img').src.startsWith('data:image/png'), above: h.getBoundingClientRect().bottom <= go.getBoundingClientRect().top + 1, iconLeft: h.querySelector('img').getBoundingClientRect().right <= h.querySelector('span').getBoundingClientRect().left, address: go.textContent };
  });
  ok('the title shows', got?.shown && got.title === 'The Sky & Its Instruments', JSON.stringify(got));
  ok('the icon shows, left of the title', got?.icon && got.iconLeft, JSON.stringify(got));
  ok('the title sits above the address', got?.above && got.address === url, JSON.stringify(got));
  await shot('linkpreview-1');

  await page.click('.ProseMirror h1');
  await page.click('.ProseMirror a[href="../main.py"]');
  await page.waitForTimeout(500);
  ok('a file link has no title row', await page.evaluate(() => document.querySelector('.link-box .link-head')?.hidden === true));
  server.close();
}
