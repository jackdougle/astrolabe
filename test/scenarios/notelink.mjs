import fs from 'node:fs';
import path from 'node:path';
export default async function ({ page, shot, work }) {
  fs.writeFileSync(path.join(work, 'notes', 'links.md'), '# Links\n\nOpen [the script](../main.py) or [data](../data.json#L3).\n');
  await page.evaluate((f) => window.__store?.getState?.().openFile(f), path.join(work, 'notes', 'links.md'));
  await page.waitForTimeout(1500);
  const has = await page.$('.ProseMirror a[href="../main.py"]');
  if (!has) { console.log('!! no rendered link (store handle?)'); return; }
  await page.keyboard.down('Meta'); await has.click(); await page.keyboard.up('Meta');
  await page.waitForTimeout(900);
  console.log('files after ⌘-click:', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.filetab-name')].map((e) => e.textContent))));
  await shot('notelink');
}
