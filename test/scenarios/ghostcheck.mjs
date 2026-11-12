// Grey suggestions never point at folders or files that are not there, and cd only completes folders.
import fs from 'node:fs';
import path from 'node:path';
export default async function ({ page, run, type, work }) {
  const input = () => page.evaluate(() => [...document.querySelectorAll('.cmd-input')].map((e) => e.querySelector('.view-lines')?.textContent).at(-1));
  const tryTab = async (text) => {
    await page.keyboard.press('Control+u');
    await type(text);
    await page.waitForTimeout(500);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(400);
    const got = await input();
    await page.keyboard.press('Control+u');
    return got;
  };
  await run(`cd ${work}`);
  fs.mkdirSync(path.join(work, 'gone-dir'));
  fs.mkdirSync(path.join(work, 'kept-dir'));
  fs.writeFileSync(path.join(work, 'gone.txt'), 'x');
  fs.writeFileSync(path.join(work, 'kfile.txt'), 'x');
  await run('cd kept-dir && cd ..', 600);
  await run('cd gone-dir && cd ..', 600);
  await run('cat gone.txt', 600);
  fs.rmSync(path.join(work, 'gone-dir'), { recursive: true });
  fs.rmSync(path.join(work, 'gone.txt'));
  console.log('"cd " history (newest is gone-dir):', JSON.stringify(await tryTab('cd ')));
  console.log('"cd g" →', JSON.stringify(await tryTab('cd g')));
  console.log('"cat g" →', JSON.stringify(await tryTab('cat g')));
  console.log('"cd k" (kept-dir and kfile.txt exist) →', JSON.stringify(await tryTab('cd k')));
  console.log('"cat k" →', JSON.stringify(await tryTab('cat k')));
}
