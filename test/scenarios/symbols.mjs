// Typing shorthand in the rendered view: -- makes an em dash, -> and its kin arrows; not in code; Backspace undoes.
import fs from 'node:fs';
export default async function ({ page, run, type, work, shot }) {
  const file = `${work}/notes/s.md`;
  fs.writeFileSync(file, 'Start\n\n```sh\necho hi\n```\n\nEnd\n');
  await run(`cd ${work}`);
  await page.keyboard.press('Meta+p'); await page.waitForTimeout(350); await type('s.md'); await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
  const text = () => page.evaluate((f) => window.__monaco.editor.getModels().find((m) => m.uri.path === f)?.getValue(), file);
  const key = async (k, wait = 220) => { await page.keyboard.press(k); await page.waitForTimeout(wait); };
  await page.click('.rich > p:first-child'); await page.waitForTimeout(250); await key('Meta+ArrowRight');
  const want = [
    ['a -- b', 'a — b'], ['a -> b', 'a → b'], ['a --> b', 'a ⟶ b'], ['a <- b', 'a ← b'], ['a <-- b', 'a ⟵ b'], ['a <-> b', 'a ↔ b'], ['a <--> b', 'a ⟷ b'],
    ['a => b', 'a ⇒ b'], ['a ==> b', 'a ⟹ b'], ['a <== b', 'a ⟸ b'], ['a <=> b', 'a ⇔ b'], ['a <==> b', 'a ⟺ b'],
    ['-- x', '— x'], ['-> x', '→ x'], ['--> x', '⟶ x'], ['<- x', '← x'], ['word--word', 'word—word'], ['x <', 'x <'], ['1 < 2 > 0', '1 < 2 > 0'],
    ['`a -> b --` c -> d', '`a -> b --` c → d'],
  ];
  for (const [typed] of want) { await key('Enter'); await type(typed); await page.waitForTimeout(200); }
  // Backspace straight after a swap puts back what was typed.
  await key('Enter'); await type('undo --'); await key('Backspace'); await type(' and ->'); await key('Backspace');
  await page.waitForTimeout(600);
  const lines = (await text()).split('\n').filter((l) => l.trim());
  let bad = 0;
  for (const [typed, becomes] of want) {
    const ok = lines.some((l) => l.replace(/\\/g, '') === becomes || l === becomes);
    if (!ok) bad += 1;
    console.log(ok ? 'ok ' : 'BAD', JSON.stringify(typed), '->', JSON.stringify(becomes));
  }
  console.log('undo line:', JSON.stringify(lines.find((l) => l.startsWith('undo'))));
  // --- opening a line still draws a line.
  await key('Enter'); await type('---'); await page.waitForTimeout(400);
  console.log('--- draws a line:', await page.evaluate(() => document.querySelectorAll('.rich hr').length), '| in the file:', (await text()).split('\n').filter((l) => l === '---').length);
  // Not in a code block.
  await page.click('.rich pre'); await page.waitForTimeout(250); await key('Meta+ArrowRight'); await type(' -> x -- y'); await page.waitForTimeout(500);
  console.log('code block:', JSON.stringify((await text()).split('\n').find((l) => l.includes('echo'))));
  console.log('failures:', bad);
  console.log('whole file:\n' + (await text()));
  await shot('symbols');
}
