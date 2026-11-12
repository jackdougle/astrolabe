export default async function ({ page, shot, run, type, state, work }) {
  await run(`cd ${work}`);
  await run('echo plain; printf "\\e[1mbold\\e[0m\\n"');
  const bold = await page.evaluate(() => {
    const t = [...window.__sessions.values()][0].term; const b = t.buffer.active; const out = [];
    for (let y = 0; y < b.length; y++) { const l = b.getLine(y); const s = l.translateToString(true); if (s) out.push([s.slice(0, 30), !!l.getCell(0).isBold()]); }
    return out;
  });
  console.log('bold', JSON.stringify(bold));
  await type('cat ma');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(600);
  await shot('20-complete');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+c');
  // quick open
  await page.keyboard.press('Meta+p');
  await page.waitForTimeout(500);
  await type('main');
  await shot('21-quickopen');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  await shot('22-editor');
  console.log('editor', JSON.stringify(await state()));
  // Cmd+X with nothing selected cuts the whole line
  await page.keyboard.press('Meta+ArrowUp');
  await page.keyboard.press('Meta+x');
  await page.waitForTimeout(300);
  const first = await page.evaluate(() => document.querySelector('.editor-host .view-line')?.textContent);
  console.log('first line after cut:', JSON.stringify(first));
  // files panel, open markdown
  await page.keyboard.press('Meta+Shift+e');
  await page.waitForTimeout(600);
  await page.click('.treerow:has-text("notes")');
  await page.waitForTimeout(400);
  await page.click('.treerow:has-text("plan.md")');
  await page.waitForTimeout(1200);
  await shot('23-markdown');
  await page.keyboard.press('Meta+e');
  await page.waitForTimeout(600);
  await shot('24-raw');
  // project search
  await page.keyboard.press('Meta+Shift+f');
  await page.waitForTimeout(300);
  await type('greet');
  await page.waitForTimeout(1200);
  await shot('25-search');
  console.log('end', JSON.stringify(await state()));
}
