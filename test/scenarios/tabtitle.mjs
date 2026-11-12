import fs from 'node:fs';
import path from 'node:path';
// A note's top tab: folder and name when both fit, otherwise the name alone (cut short only if it is itself too long).
export default async function ({ page, shot, work }) {
  const deep = path.join(work, 'notes', 'a-folder-with-quite-a-long-name');
  fs.mkdirSync(deep, { recursive: true });
  const files = [path.join(work, 'notes', 'plan.md'), path.join(deep, 'ideas.md'), path.join(deep, 'a note whose own title is far too long for any tab.md')];
  for (const f of files.slice(1)) fs.writeFileSync(f, '# x\n');
  const read = () => page.evaluate(() => {
    const t = document.querySelector('.toptab.is-active .toptab-text');
    const box = t.getBoundingClientRect();
    const seen = (el) => { const r = el.getBoundingClientRect(); return r.bottom > box.top + 1 && r.top < box.bottom - 1 ? Math.round(Math.min(r.right, box.right) - Math.max(r.left, box.left)) : 0; };
    const dir = t.querySelector('.top-dir'), app = t.querySelector('.top-app');
    return { text: t.textContent, box: Math.round(box.width), dirShown: seen(dir), dirFull: Math.round(dir.scrollWidth), appShown: seen(app), appFull: app.scrollWidth, appLeft: Math.round(app.getBoundingClientRect().left - box.left) };
  });
  console.log('terminal tab:', JSON.stringify(await read()));
  for (const [i, f] of files.entries()) {
    await page.evaluate((p) => window.__store.getState().openFile(p), f);
    await page.waitForTimeout(900);
    console.log(path.basename(f), JSON.stringify(await read()));
    await shot(`tabtitle-${i}`);
  }
}
