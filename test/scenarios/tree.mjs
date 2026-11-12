export default async function ({ page, shot, run, work }) {
  await run(`cd ${work}`);
  await page.keyboard.press('Meta+b');
  await page.waitForTimeout(600);
  await page.click('.treerow:has-text("notes")');
  await page.waitForTimeout(400);
  const rows = await page.evaluate(() => [...document.querySelectorAll('.treerow')].map((r) => { const first = r.firstElementChild.getBoundingClientRect(); const name = r.querySelector('.tree-name'); return { name: name.textContent, startsAt: Math.round(first.left), color: getComputedStyle(name).color }; }));
  console.log(JSON.stringify(rows));
  await shot('71-tree');
}
