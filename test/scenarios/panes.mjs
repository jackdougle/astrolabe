export default async function ({ page, shot, run, type, state, work }) {
  await run(`cd ${work}`);
  await run('ls');
  // history: up arrow recalls, ghost text suggests
  await type('l');
  await shot('10-ghost');
  await page.keyboard.press('Control+c');
  // tab completion
  await type('cat ma');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(500);
  await shot('11-complete');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
  // long-running command, then split while it runs
  await run('sleep 4; echo done', 600);
  await shot('12-running');
  await page.keyboard.press('Meta+d');
  await page.waitForTimeout(1800);
  await run('echo right pane');
  await page.keyboard.press('Meta+Shift+d');
  await page.waitForTimeout(1800);
  await run('echo lower right');
  await shot('13-splits');
  console.log('splits', JSON.stringify(await state()));
  await page.keyboard.press('Meta+Alt+ArrowLeft');
  await page.waitForTimeout(3000);
  await shot('14-focus-left');
  await page.keyboard.press('Meta+t');
  await page.waitForTimeout(1800);
  await run('echo second tab');
  await shot('15-tab2');
  await page.keyboard.press('Meta+Shift+p');
  await type('theme');
  await shot('16-palette');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+1');
  await page.waitForTimeout(400);
  await page.keyboard.press('Meta+k');
  await page.waitForTimeout(400);
  await shot('17-cleared');
  console.log('end', JSON.stringify(await state()));
}
