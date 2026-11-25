// ⌘F: one bar for a rendered note, a file shown as text and a terminal. It marks every match of the words typed,
// says how many there are and which is the current one, steps with Enter and ⇧Enter, and closes when ⌘F is pressed again.
import fs from 'node:fs';
import path from 'node:path';
export const settings = { zoom: 1, previewTabs: false };
export default async function ({ page, shot, run, work }) {
  const ok = (name, pass, detail = '') => console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  const at = (ms) => page.waitForTimeout(ms);
  const file = path.join(work, 'notes', 'find.md');
  const filler = Array.from({ length: 40 }, (_, i) => `Filler paragraph number ${i + 1}, with nothing to look for in it.`).join('\n\n');
  fs.writeFileSync(file, `# Alpha plan\n\nThe first alpha is here, and ALPHA again in capitals.\n\n- a bullet with alpha in it\n- a bullet without\n\n<details>\n<summary>A closed toggle</summary>\n\nHidden alpha inside the toggle.\n\n</details>\n\n${filler}\n\nThe last alpha is far down, after **al**pha split by bold.\n`);
  const bar = () => page.evaluate(() => {
    const el = document.querySelector('.tab-area.is-active .pane.is-focused .findbar') ?? document.querySelector('.findbar');
    const input = el?.querySelector('input');
    return { bars: document.querySelectorAll('.findbar').length, value: input?.value ?? null, focused: !!input && document.activeElement === input, count: el?.querySelector('.find-count')?.textContent ?? '' };
  });
  const rich = () => page.evaluate(() => {
    const now = document.querySelector('.rich .find-hit.is-now');
    const box = document.querySelector('.markdown').getBoundingClientRect();
    const r = now?.getBoundingClientRect();
    return { hits: document.querySelectorAll('.rich .find-hit').length, now: now?.textContent ?? null, seen: !!r && r.top >= box.top && r.bottom <= box.bottom && r.height > 0, toggle: document.querySelector('.rich .toggle')?.dataset.open, picked: String(getSelection()), inNote: !!document.activeElement?.closest('.rich') };
  });
  const rendered = (on) => page.evaluate(({ file, on }) => { const s = window.__store.getState(); const p = Object.values(s.panes).find((x) => x.kind === 'editor'); const f = p.files.find((x) => x.path === file); if (f.rendered !== on) s.toggleRendered(p.id, file); }, { file, on });
  const raw = () => page.evaluate(() => {
    const ed = window.__monaco.editor.getEditors().find((e) => e.getDomNode()?.closest('.editor-host'));
    const sel = ed.getSelection();
    return { hits: document.querySelectorAll('.editor-host .find-hit').length, now: document.querySelectorAll('.editor-host .find-hit.is-now').length, picked: ed.getModel().getValueInRange(sel), line: sel.startLineNumber, focused: ed.hasTextFocus(), widget: !!document.querySelector('.editor-host .find-widget.visible') };
  });

  await run(`cd ${work}`);
  await page.evaluate((p) => window.__store.getState().openFile(p, null, { keep: true }), file);
  await at(1400);

  // ----- a rendered note -----
  await page.click('.rich h1'); await page.keyboard.press('Meta+ArrowUp'); await at(200);
  await page.keyboard.press('Meta+f'); await at(300);
  let b = await bar();
  ok('⌘F in a rendered note opens the bar, with the keyboard in it', b.bars === 1 && b.focused && b.value === '', JSON.stringify(b));
  await page.keyboard.type('alpha', { delay: 20 }); await at(300);
  b = await bar(); let r = await rich();
  ok('every match is marked and counted, whatever its capitals (one is across bold text)', b.count === '1 of 7' && r.hits >= 7 && r.now?.toLowerCase() === 'alpha', JSON.stringify({ b, r }));
  await shot('find-1-note');
  await page.keyboard.press('Enter'); await at(150);
  await page.keyboard.press('Enter'); await at(150);
  b = await bar();
  ok('Enter goes to the next match', b.count === '3 of 7', b.count);
  await page.keyboard.press('Shift+Enter'); await at(150);
  ok('⇧Enter goes back', (await bar()).count === '2 of 7');
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await at(400);
  b = await bar(); r = await rich();
  ok('a match inside a closed toggle opens the toggle', b.count === '5 of 7' && r.toggle === 'true' && r.seen, JSON.stringify({ b, r }));
  await page.keyboard.press('Enter'); await at(400);
  r = await rich();
  ok('a match far down is scrolled into view', (await bar()).count === '6 of 7' && r.seen, JSON.stringify(r));
  await shot('find-2-far');
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await at(300);
  ok('after the last match comes the first again', (await bar()).count === '1 of 7' && (await rich()).seen);
  await page.keyboard.press('Enter'); await at(200);
  await page.keyboard.press('Meta+f'); await at(400);
  b = await bar(); r = await rich();
  ok('⌘F again closes the bar: marks gone, keyboard back in the note, on the match', b.bars === 0 && r.hits === 0 && r.inNote && r.picked.toLowerCase() === 'alpha', JSON.stringify({ b, r }));
  await page.keyboard.press('Meta+f'); await at(300);
  b = await bar();
  ok('opened again, it starts from the word that is selected', b.bars === 1 && b.focused && b.value.toLowerCase() === 'alpha' && /of 7/.test(b.count), JSON.stringify(b));
  await page.keyboard.type('zzzz', { delay: 15 }); await at(250);
  b = await bar(); r = await rich();
  ok('nothing found says so', b.count === 'No matches' && r.hits === 0, JSON.stringify(b));
  await page.keyboard.press('Meta+a'); await page.keyboard.type('bullet', { delay: 15 }); await at(250);
  ok('other words are looked for as they are typed', (await bar()).count === '1 of 2');
  // Typing in the note with the bar open: the count follows.
  await page.click('.rich li p >> nth=1'); await page.keyboard.press('End'); await page.keyboard.type(' bullet bullet', { delay: 10 }); await at(400);
  b = await bar();
  ok('the count follows the note as it is typed in', /of 4$/.test(b.count) && b.bars === 1, JSON.stringify(b));
  await page.keyboard.press('Meta+f'); await at(300);
  ok('⌘F closes it from the note too', (await bar()).bars === 0 && (await rich()).hits === 0);

  // ----- the same note as text -----
  await rendered(false); await at(700);
  await page.click('.editor-host .view-lines'); await at(150);
  await page.keyboard.press('Meta+ArrowUp'); await at(100);
  await page.keyboard.press('Meta+f'); await at(300);
  b = await bar();
  ok('⌘F in a file shown as text opens the same bar, with the last words in it', b.bars === 1 && b.focused && b.value === 'bullet' && /of 4$/.test(b.count) && !(await raw()).widget, JSON.stringify(b));
  await page.keyboard.type('alpha', { delay: 20 }); await at(300);
  b = await bar(); let m = await raw();
  ok('matches are marked and counted there, from where the last match was (the one split by ** is not one here)', b.count === '4 of 6' && m.hits >= 3 && m.now === 1, JSON.stringify({ b, m }));
  await shot('find-3-raw');
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await at(300);
  ok('Enter past the last comes round to the first', (await bar()).count === '1 of 6', (await bar()).count);
  await page.keyboard.press('Shift+Enter'); await at(400);
  b = await bar(); m = await raw();
  ok('⇧Enter from the first goes round to the last, scrolled into view', b.count === '6 of 6' && m.now === 1, JSON.stringify({ b, m }));
  await page.keyboard.press('Escape'); await at(300);
  b = await bar(); m = await raw();
  ok('Esc closes it too, leaving the match selected', b.bars === 0 && m.hits === 0 && m.focused && m.picked === 'alpha' && m.line > 40, JSON.stringify({ b, m }));

  // ----- code, and going from file to file with the bar open -----
  await page.evaluate((p) => window.__store.getState().openFile(p, null, { keep: true }), path.join(work, 'main.py')); await at(900);
  await page.keyboard.press('Meta+f'); await at(250);
  await page.keyboard.press('Meta+a'); await page.keyboard.type('name', { delay: 20 }); await at(300);
  ok('code is searched the same way', (await bar()).count === '1 of 2', (await bar()).count);
  await page.evaluate((p) => window.__store.getState().openFile(p, null, { keep: true }), path.join(work, 'data.json')); await at(700);
  b = await bar();
  ok('on another file the bar stays and looks there', b.bars === 1 && b.count === 'No matches', JSON.stringify(b));
  await page.evaluate((p) => window.__store.getState().openFile(p, null, { keep: true }), file); await at(700);
  await rendered(true); await at(900);
  b = await bar(); r = await rich();
  ok('and in a note turned back to its rendered view', b.bars === 1 && b.count === 'No matches' && r.hits === 0, JSON.stringify({ b, r }));
  await page.click('.findbar input'); await page.keyboard.press('Meta+a'); await page.keyboard.type('toggle', { delay: 20 }); await at(300);
  ok('where the words are found as the note reads', /of 2$/.test((await bar()).count), (await bar()).count);
  await page.keyboard.press('Meta+f'); await at(300);

  // ----- terminals: each has its own -----
  await page.evaluate(() => { const s = window.__store.getState(); s.focusArea('terminal'); }); await at(300);
  await page.click('.cmd-editor'); await at(200);
  await run(`printf 'needle %s\\n' one two three`, 800);
  await page.keyboard.press('Meta+f'); await at(300);
  b = await bar();
  ok('⌘F in a terminal opens its bar', b.bars === 1 && b.focused, JSON.stringify(b));
  await page.keyboard.type('needle', { delay: 20 }); await at(500);
  b = await bar();
  ok('the terminal counts every match, starting from the newest', b.count === '4 of 4', b.count);
  await shot('find-4-terminal');
  await page.keyboard.press('Enter'); await at(300);
  ok('Enter goes up to the one before', (await bar()).count === '3 of 4', (await bar()).count);
  await page.keyboard.press('Meta+d'); await at(900);
  await run(`echo needle in the second`, 800);
  await page.keyboard.press('Meta+f'); await at(300);
  await page.keyboard.type('needle', { delay: 20 }); await at(500);
  const two = await page.evaluate(() => [...document.querySelectorAll('.findbar')].map((el) => el.querySelector('.find-count')?.textContent));
  ok('a second terminal has a bar of its own, counting its own text', two.length === 2 && two.some((t) => /of 4$/.test(t)) && two.includes('2 of 2'), JSON.stringify(two));
  await page.keyboard.press('Meta+f'); await at(300);
  const after = await page.evaluate(() => ({ bars: document.querySelectorAll('.findbar').length, inInput: !!document.activeElement?.closest('.pane.is-focused .cmd-editor, .pane.is-focused .term-host') || !!document.activeElement?.closest('.cmd-editor, .term-host') }));
  ok('⌘F closes the one in the terminal you are in, and the keyboard goes back to it', after.bars === 1 && after.inInput, JSON.stringify(after));
}
