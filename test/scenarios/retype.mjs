// Notes change kind: a bullet, a to-do, a numbered item and a toggle each become another when that kind's mark and
// a space are typed where their words begin. The note, everything nested under it, and every note after it on its
// layer (up to the next thing that is not a note) change together; what comes before stays. [] needs its space.
import fs from 'node:fs';
export default async function ({ page, run, type, work, shot }) {
  const file = `${work}/notes/kinds.md`;
  const SRC = 'Start\n\n- alpha\n- beta\n  - beta child\n    1. deep one\n- gamma\n\n1. first\n2. second\n\n<details open>\n<summary>A toggle</summary>\n\nheld text\n\n- inside bullet\n\n</details>\n\nBreak\n\n- [x] done\n- [ ] open\n\nEnd\n';
  fs.writeFileSync(file, SRC);
  await run(`cd ${work}`);
  await page.keyboard.press('Meta+p'); await page.waitForTimeout(350); await type('kinds.md'); await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
  await page.keyboard.press('Control+Meta+f'); await page.waitForTimeout(500);
  const text = () => page.evaluate((f) => window.__monaco.editor.getModels().find((m) => m.uri.path === f)?.getValue(), file);
  const at = () => page.evaluate(() => { const s = document.getSelection(); const n = s.anchorNode; const el = n?.nodeType === 3 ? n.parentElement : n; return `${el?.tagName}:${JSON.stringify(el?.textContent)}@${s.anchorOffset}`; });
  const key = async (k, wait = 250) => { await page.keyboard.press(k); await page.waitForTimeout(wait); };
  const li = (t) => `.rich li:has(> p:text-is("${t}")) > p`;
  const startOf = async (sel) => { await page.click(sel); await page.waitForTimeout(250); await key('Meta+ArrowLeft'); };
  // Types `mark` at the start of the note, reports the file between two landmarks, and takes it back.
  const tryIt = async (name, sel, mark, from = 'Start\n\n', to = '\nEnd') => {
    await startOf(sel); await type(mark); await page.waitForTimeout(450);
    const now = await text();
    console.log(`${name}:\n   ${JSON.stringify(now.split(from)[1]?.split(to)[0])}\n   caret in ${await at()}`);
    for (let i = 0; i < 4 && (await text()) !== SRC; i++) await key('Meta+z', 300);
    if ((await text()) !== SRC) console.log('   !! undo did not bring the note back:', JSON.stringify(await text()));
  };
  await tryIt('"[] " on beta (a bullet): beta, what is under it, and every note after it down to Break', li('beta'), '[] ', 'Start\n\n', '\nBreak');
  await shot('retype-todo');
  await tryIt('"[]" with no space: just the characters', li('alpha'), '[]', 'Start\n\n', '\n- beta');
  await tryIt('"[x] " on alpha: ticked, the rest unticked', li('alpha'), '[x] ', 'Start\n\n', '\n1. ');
  await tryIt('"1. " on beta: numbers from 1', li('beta'), '1. ', 'Start\n\n', '\nBreak');
  await tryIt('"- " on second (numbered): first stays a number', li('second'), '- ', 'gamma\n\n', '\nBreak');
  await tryIt('"> " on gamma: toggles from there on', li('gamma'), '> ', 'Start\n\n', '\nBreak');
  await tryIt('"- " on the toggle: its title is the bullet, what it held goes under', '.rich .toggle-summary:text-is("A toggle")', '- ', 'second\n\n', '\nBreak');
  await tryIt('"3. " on open (a to-do): done stays, the count starts at 3', li('open'), '3. ', 'Break\n\n', '\nEnd');
  await tryIt('"- " on done: both lose their boxes', li('done'), '- ', 'Break\n\n', '\nEnd');
  await tryIt('"1. " on beta child: its own layer only', li('beta child'), '1. ', 'Start\n\n', '\n1. first');
  await tryIt('"- " on alpha, already a bullet: just the characters', li('alpha'), '- ', 'Start\n\n', '\n- beta');
  await tryIt('"1. " on first, already numbered: just the characters', li('first'), '1. ', 'gamma\n\n', '\n2. ');
  await tryIt('"[] " on open, already a to-do: just the characters', li('open'), '[] ', 'Break\n\n', '\nEnd');
  // A numbered list made straight under a numbered list carries on its count; and back again.
  await startOf(li('gamma')); await type('1. '); await page.waitForTimeout(450);
  await startOf(li('alpha')); await type('1. '); await page.waitForTimeout(450);
  console.log('gamma then alpha made numbers: one list\n  ', JSON.stringify((await text()).split('Start\n\n')[1].split('\nBreak')[0]));
  await startOf(li('first')); await type('- '); await page.waitForTimeout(450);
  console.log('then "- " on first: bullets from there\n  ', JSON.stringify((await text()).split('Start\n\n')[1].split('\nBreak')[0]));
  // A new line at the end of a list, turned into another kind, leaves the list above as it was.
  await page.click(li('open')); await key('Meta+ArrowRight'); await key('Enter'); await page.waitForTimeout(700);
  await type('1. '); await page.waitForTimeout(300); await type('counted'); await page.waitForTimeout(450);
  console.log('new last line made a number:\n  ', JSON.stringify((await text()).split('Break\n\n')[1].split('\nEnd')[0]));
  // On an ordinary line: [] and a space makes a to-do; [] alone does not.
  await page.click('.rich > p:has-text("End")'); await key('Meta+ArrowLeft'); await type('[]'); await page.waitForTimeout(300);
  const before = (await text()).split('\n').filter((l) => /End/.test(l));
  await type(' '); await page.waitForTimeout(400);
  console.log('ordinary line: "[]"', JSON.stringify(before), 'then the space', JSON.stringify((await text()).split('\n').filter((l) => /End/.test(l))));
}
