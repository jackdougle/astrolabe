// The note title sits right-aligned beside the note's first line when that line is short enough, and above the note otherwise.
import fs from 'node:fs';
export default async function ({ page, run, type, work, shot }) {
  const dir = `${work}/notes`;
  fs.writeFileSync(`${dir}/dated.md`, '*11.11.2026 - Mission St*\n\nBody text of the note goes here and runs on for a while so the second paragraph is clearly longer than the first.\n');
  fs.writeFileSync(`${dir}/wordy.md`, 'This opening paragraph is long enough that it runs all the way across the text column and wraps onto a second line, leaving no room for a title beside it.\n\nSecond paragraph.\n');
  fs.writeFileSync(`${dir}/listed.md`, '- first item\n- second item\n');
  fs.writeFileSync(`${dir}/coded.md`, '```sh\necho hi\n```\n');
  fs.writeFileSync(`${dir}/blank.md`, '');
  await run(`cd ${work}`);
  const open = async (name) => { await page.keyboard.press('Meta+p'); await page.waitForTimeout(350); await type(name); await page.keyboard.press('Enter'); await page.waitForTimeout(1300); };
  const where = () => page.evaluate(() => {
    const head = document.querySelector('.rich-head'), t = document.querySelector('.rich-title'), block = document.querySelector('.rich')?.firstElementChild;
    if (!head || !t || !block) return null;
    const h = head.getBoundingClientRect(), r = t.getBoundingClientRect(), b = block.getBoundingClientRect();
    const range = document.createRange(); range.selectNodeContents(block);
    const line = [...range.getClientRects()].filter((x) => x.width > 0 && x.height < 60)[0];
    return { title: t.textContent, beside: head.classList.contains('is-beside'), rightGap: Math.round(h.right - r.right), leftGap: Math.round(r.left - h.left), titleTop: Math.round(r.top - b.top), titleBottom: Math.round(r.bottom - b.top), lineBottom: line ? Math.round(line.bottom - b.top) : null, clearOfLine: line ? Math.round(r.left - line.right) : null, noteTop: Math.round(b.top - h.top) };
  });
  const report = async (label) => console.log(`${label}:`, JSON.stringify(await where()));

  await open('plan'); await report('heading first line'); await shot('titleside-heading');
  await open('dated'); await report('date first line'); await shot('titleside-dated');
  await open('wordy'); await report('long first line'); await shot('titleside-wordy');
  await open('listed'); await report('list first line');
  await open('coded'); await report('code block first');
  await open('blank'); await report('empty note'); await shot('titleside-blank');

  // Typing a long first line pushes the title back above; deleting it brings the title back beside.
  await open('dated');
  await page.click('.rich p'); await page.waitForTimeout(250); await page.keyboard.press('Meta+ArrowRight'); await page.waitForTimeout(250);
  await type(' and then quite a lot more text typed onto the very first line of this note'); await page.waitForTimeout(400);
  await report('after typing a long first line'); await shot('titleside-typed');
  for (let i = 0; i < 75; i++) await page.keyboard.press('Backspace');
  await page.waitForTimeout(400); await report('after deleting it again');

  // A long title no longer fits beside the line; editing keeps focus in the title while it moves.
  await page.click('.rich-title'); await page.keyboard.press('Meta+a');
  await type('A considerably longer title for this note that cannot share the row'); await page.waitForTimeout(400);
  await report('long title while editing');
  console.log('focus still in title:', await page.evaluate(() => document.activeElement?.classList.contains('rich-title')));
  await shot('titleside-longtitle');
  await page.keyboard.press('Escape'); await page.waitForTimeout(500); await report('after Escape');

  // A narrow pane leaves less room.
  await page.setViewportSize({ width: 520, height: 600 }).catch(() => {}); await page.waitForTimeout(600);
  await report('narrow window'); await shot('titleside-narrow');
}
