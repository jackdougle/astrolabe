// Changes waiting to be looked at (review.mjs) are still marked after the window reloads in place.
// The reload step only touches a source file's timestamp, so this is safe to run in the real folder.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
export const settings = { zoom: 1, previewTabs: false };
export default async function ({ page, work }) {
  const ok = (name, pass, detail = '') => console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  const at = (ms) => page.waitForTimeout(ms);
  const file = path.join(work, 'notes', 'kept.md');
  const st = () => page.evaluate((file) => {
    const model = window.__monaco.editor.getModels().find((m) => m.uri.path === file);
    return { text: model?.getLinesContent() ?? null, spans: model ? window.__review.spans(model).map((x) => ({ start: x.start, end: x.end, old: x.old })) : [], bar: document.querySelector('.changes-bar .changes-n')?.textContent ?? null, boxes: document.querySelectorAll('.rich .rv-box').length };
  }, file);
  fs.writeFileSync(file, 'one\n\ntwo\n\nthree\n');
  await page.evaluate((file) => window.__store.getState().openFile(file, null, { keep: true }), file);
  await at(1400);
  fs.writeFileSync(file, 'one\n\ntwo, changed\n\nthree\n\nfour\n');
  await at(900);
  const before = await st();
  ok('two changes are waiting', before.spans.length === 2 && before.boxes === 2, JSON.stringify(before));

  const now = new Date(); fs.utimesSync(path.join(root, 'src', 'main.tsx'), now, now);
  await page.evaluate(() => { window.__old = true; });
  page.evaluate(async () => { await window.astrolabe.app.checkUpdate(); return window.astrolabe.app.installUpdate(0); }).catch(() => {});
  await page.waitForFunction(() => !window.__old && window.__store?.getState().ready && window.__review, null, { timeout: 40000 });
  await at(2500);
  const after = await st();
  ok('they are still marked after the reload, with what was there before', JSON.stringify(after.spans) === JSON.stringify(before.spans) && after.bar === '2 changes' && after.boxes === 2, JSON.stringify(after));
  await page.click('.changes-bar .rv-undo'); await at(900);
  ok('and can still be undone', fs.readFileSync(file, 'utf8') === 'one\n\ntwo\n\nthree\n', JSON.stringify(fs.readFileSync(file, 'utf8')));
}
