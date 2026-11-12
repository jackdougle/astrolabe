import fs from 'node:fs';
import path from 'node:path';
export default async function ({ page, shot, run, type, work }) {
  fs.writeFileSync(path.join(work, 'notes', 'levels.md'), '# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six\n\nBody text for comparison.\n');
  await run(`cd ${work}`);
  await page.keyboard.press('Meta+p'); await page.waitForTimeout(350); await type('levels'); await page.keyboard.press('Enter'); await page.waitForTimeout(1300);
  console.log(JSON.stringify(await page.evaluate(() => Object.fromEntries(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p'].map((t) => [t, getComputedStyle(document.querySelector(`.rich ${t}`)).fontSize])))));
  await shot('90-headings');
}
