// A file that is open in the editor is changed from outside (an agent, a script). The change goes into the text on
// screen and is marked there: added lines green, the lines they replaced red above them, each with Keep and Undo,
// and a bar at the foot with Keep all / Undo all. Unsaved typing is never lost: the outside change is merged around
// it, and where both fall on the same lines yours stay and the other version is offered beside them.
import fs from 'node:fs';
import path from 'node:path';

export const settings = { zoom: 1, previewTabs: false };
export default async function ({ page, shot, work }) {
  const ok = (name, pass, detail = '') => console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  const at = (ms) => page.waitForTimeout(ms);
  const file = path.join(work, 'notes', 'review.md');
  const START = ['# Trip', '', 'First paragraph, which stays.', '', 'Second paragraph, to be rewritten.', '', '- pack bags', '- book train', '  - window seat', '  - quiet coach', '- water plants', '', 'Last paragraph, to be removed.', '', 'The end.', ''];
  const write = async (lines) => { fs.writeFileSync(file, lines.join('\n')); await at(900); };
  const disk = () => fs.readFileSync(file, 'utf8').split('\n');
  const st = () => page.evaluate((file) => {
    const model = window.__monaco.editor.getModels().find((m) => m.uri.path === file);
    const s = window.__store.getState();
    return {
      text: model.getLinesContent(), dirty: !!s.dirty[file], spans: window.__review.spans(model).map((x) => ({ start: x.start, end: x.end, old: x.old, offer: x.offer ?? null })),
      bar: document.querySelector('.changes-bar .changes-n')?.textContent ?? null,
      rich: { add: [...document.querySelectorAll('.rich .rv-add')].map((e) => `${e.tagName.toLowerCase()}:${e.textContent.trim().slice(0, 24)}`), old: [...document.querySelectorAll('.rich .rv-old')].map((e) => e.textContent), boxes: document.querySelectorAll('.rich .rv-box').length, offers: [...document.querySelectorAll('.rich .rv-new')].map((e) => e.textContent) },
      raw: { add: document.querySelectorAll('.editor-host .rv-add').length, zones: [...document.querySelectorAll('.editor-host .rv-zone')].map((e) => `${e.classList.contains('rv-old') ? 'old' : 'new'}:${e.textContent}`), pills: document.querySelectorAll('.editor-host .rv-pill').length },
      tab: !!document.querySelector('.tab-file.has-changes'),
    };
  }, file);
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const rendered = (on) => page.evaluate(({ file, on }) => { const s = window.__store.getState(); const p = Object.values(s.panes).find((x) => x.kind === 'editor'); const f = p.files.find((x) => x.path === file); if (f.rendered !== on) s.toggleRendered(p.id, file); }, { file, on });

  fs.writeFileSync(file, START.join('\n'));
  await page.evaluate((file) => window.__store.getState().openFile(file, null, { keep: true }), file);
  await at(1500);
  let s = await st();
  ok('nothing is marked in a file nobody changed', s.spans.length === 0 && s.bar === null && !s.tab);

  // ----- a clean file: three changes at once -----
  const A = START.slice();
  A[4] = 'Second paragraph, rewritten by the agent.';
  A.splice(9, 0, '  - near the dining car');      // a nested item added
  A.splice(13, 2);                                // the last paragraph and its blank line removed
  await write(A);
  s = await st();
  ok('the text on screen is the file', eq(s.text, A) && !s.dirty, JSON.stringify(s.text.slice(3, 8)));
  ok('three changes are waiting', s.spans.length === 3 && s.bar === '3 changes' && s.tab, `${s.bar} ${JSON.stringify(s.spans)}`);
  ok('each knows what was there before', eq(s.spans.map((x) => x.old), [['Second paragraph, to be rewritten.'], [], ['Last paragraph, to be removed.', '']]), JSON.stringify(s.spans.map((x) => x.old)));
  ok('rendered: the changed paragraph and the one new list item are green, not the whole list', s.rich.add.length === 2 && s.rich.add[0].startsWith('p:Second') && s.rich.add[1].startsWith('li:near'), JSON.stringify(s.rich.add));
  ok('rendered: the old paragraph and the removed one are shown in red', s.rich.old.length === 2 && s.rich.old[0] === 'Second paragraph, to be rewritten.' && s.rich.old[1].startsWith('Last paragraph'), JSON.stringify(s.rich.old));
  await shot('review-1-rendered');
  await rendered(false); await at(700);
  s = await st();
  ok('raw: added lines are tinted, removed ones stand above in red, each change has its buttons', s.raw.add >= 2 && s.raw.zones.length === 2 && s.raw.zones[0] === 'old:Second paragraph, to be rewritten.' && s.raw.pills === 3, JSON.stringify(s.raw));
  await shot('review-2-raw');

  // Keep one, undo one.
  await page.click('.editor-host .rv-pill >> nth=1 >> .rv-keep'); await at(300);
  s = await st();
  ok('Keep leaves the text and takes the mark away', s.spans.length === 2 && eq(s.text, A), s.bar);
  await page.click('.editor-host .rv-pill >> nth=0 >> .rv-undo'); await at(900);
  s = await st();
  const B = A.slice(); B[4] = START[4];
  ok('Undo puts the old lines back, in the text and in the file', eq(s.text, B) && eq(disk(), B) && !s.dirty && s.spans.length === 1, `${JSON.stringify(s.text[4])} disk ${JSON.stringify(disk()[4])} dirty ${s.dirty}`);
  await rendered(true); await at(800);
  await page.click('.rich .rv-box .rv-undo'); await at(900);
  s = await st();
  const C = B.slice(); C.splice(13, 0, 'Last paragraph, to be removed.', '');
  ok('rendered: Undo on a removal brings the lines back', eq(s.text, C) && eq(disk(), C) && s.spans.length === 0 && s.bar === null && !s.tab, JSON.stringify(s.text.slice(11)));

  // ----- unsaved typing, and a change elsewhere: both stay -----
  await page.click('.rich p >> nth=0'); await page.keyboard.press('End'); await page.keyboard.type(' I am still typing', { delay: 5 });
  const D = C.slice(); D[15] = 'The end, says the agent.';
  fs.writeFileSync(file, D.join('\n')); // lands while the typing is still on its way to the file's text
  await at(1000);
  s = await st();
  const mine = 'First paragraph, which stays. I am still typing';
  ok('typing and the outside change are both in the text', s.text[2] === mine && s.text[15] === D[15] && s.dirty, JSON.stringify([s.text[2], s.text[15], s.dirty]));
  ok('only the outside change is marked', s.spans.length === 1 && eq(s.spans[0].old, ['The end.']) && s.spans[0].offer === null, JSON.stringify(s.spans));
  await page.keyboard.type(', and on', { delay: 5 }); await at(500);
  s = await st();
  if (process.env.DEBUG) console.log(JSON.stringify(await page.evaluate(() => ({ active: document.activeElement?.className, sel: String(document.getSelection()?.anchorNode?.textContent).slice(0, 60), doc: document.querySelector('.rich').innerText.slice(0, 300) }))), JSON.stringify(s.text));
  ok('typing goes on, the mark stays', s.text[2] === `${mine}, and on` && s.spans.length === 1, JSON.stringify(s.text[2]));
  await page.keyboard.press('Meta+s'); await at(700);
  ok('saving writes both', disk()[2] === `${mine}, and on` && disk()[15] === D[15], JSON.stringify([disk()[2], disk()[15]]));
  await page.keyboard.press('Alt+Meta+y'); await at(300);
  s = await st();
  ok('⌥⌘Y keeps every change', s.spans.length === 0 && s.bar === null, JSON.stringify(s.spans));

  // ----- unsaved typing on the very lines the outside change touches -----
  await page.keyboard.type(' more', { delay: 5 }); await at(450);
  const E = disk(); E[2] = 'First paragraph, as the agent wants it.'; E[6] = '- pack two bags';
  await write(E);
  s = await st();
  ok('your line stays, the other change goes in', s.text[2] === `${mine}, and on more` && s.text[6] === '- pack two bags' && s.dirty, JSON.stringify([s.text[2], s.text[6]]));
  ok('the other version of your line is offered', s.spans.length === 2 && eq(s.spans[0].offer, [E[2]]) && s.rich.offers[0] === E[2] && /1 change, 1 on your unsaved lines/.test(s.bar ?? ''), `${s.bar} ${JSON.stringify(s.spans)}`);
  await shot('review-3-offer');
  await page.click('.rich .rv-box.is-offer .rv-undo'); await at(500);
  s = await st();
  ok('taking it puts the other version in place of yours', s.text[2] === E[2] && s.spans.length === 1, JSON.stringify(s.text[2]));

  // ----- a second change before the first was looked at -----
  await page.keyboard.press('Meta+s'); await at(700);
  const F = disk(); F[6] = '- pack three bags'; F.push('A line at the very end.', '');
  await write(F);
  s = await st();
  ok('changes add up: the line changed twice shows what it was at the start', s.spans.length === 2 && eq(s.spans[0].old, ['- pack bags']) && s.text[6] === '- pack three bags', JSON.stringify(s.spans));
  await page.click('.changes-bar .rv-undo'); await at(900);
  s = await st();
  ok('Undo all puts everything back and saves', s.spans.length === 0 && s.text[6] === '- pack bags' && !s.text.includes('A line at the very end.') && eq(disk(), s.text) && !s.dirty, JSON.stringify(s.text.slice(5, 8)));

  // ----- ⌘Z after a change takes the change and its mark away -----
  await rendered(false); await at(600);
  const G = disk(); G[0] = '# Trip to the coast';
  await write(G);
  await page.click('.editor-host .view-lines'); await page.keyboard.press('Meta+z'); await at(600);
  s = await st();
  ok('⌘Z undoes the outside change and nothing is left marked', s.text[0] === '# Trip' && s.spans.length === 0, JSON.stringify([s.text[0], s.spans]));

  // ----- switched off: changes just appear, as before -----
  await page.keyboard.press('Meta+s'); await at(600);
  await page.evaluate(() => window.__store.getState().updateSettings({ reviewChanges: false }));
  const H = disk(); H[0] = '# Off';
  await write(H);
  s = await st();
  ok('with the setting off the change appears unmarked', s.text[0] === '# Off' && s.spans.length === 0 && !s.dirty);
}
