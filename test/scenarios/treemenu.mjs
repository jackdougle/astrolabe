import fs from 'node:fs';
import path from 'node:path';
export default async function ({ page, shot, run, type, work }) {
  const tree = () => page.evaluate(() => [...document.querySelectorAll('.treerow')].map((r) => r.textContent));
  const tabs = () => page.evaluate(() => ({ fileTabs: [...document.querySelectorAll('.filetab')].map((f) => f.textContent + (f.querySelector('.is-dirty') ? ' (unsaved)' : '')), top: document.querySelector('.toptab-text')?.textContent }));
  await run(`cd ${work}`);
  await page.keyboard.press('Meta+b'); await page.waitForTimeout(500);
  await page.click('.treerow:has-text("notes")'); await page.waitForTimeout(300);
  await page.click('.treerow:has-text("plan.md")'); await page.waitForTimeout(1200);
  await page.keyboard.press('Meta+Shift+r'); await page.waitForTimeout(500);
  await type('UNSAVED EDIT ');
  console.log('before:', JSON.stringify(await tree()), JSON.stringify(await tabs()));
  // rename the open, unsaved file
  await page.evaluate(() => window.astrolabe.fs.testMenuChoice('rename'));
  await page.click('.treerow:has-text("plan.md")', { button: 'right' }); await page.waitForTimeout(400);
  console.log('rename field shows:', await page.evaluate(() => { const i = document.querySelector('.tree-rename'); return i ? `${i.value} | selected "${i.value.slice(i.selectionStart, i.selectionEnd)}"` : null; }));
  await shot('95-renaming');
  await page.keyboard.type('roadmap'); await page.keyboard.press('Enter'); await page.waitForTimeout(900);
  console.log('after rename:', JSON.stringify(await tree()), JSON.stringify(await tabs()), '| on disk:', JSON.stringify(fs.readdirSync(path.join(work, 'notes'))));
  console.log('unsaved text kept:', await page.evaluate(() => window.__monaco.editor.getModels().find((m) => m.uri.path.endsWith('roadmap.md'))?.getValue().startsWith('UNSAVED EDIT ')));
  await page.keyboard.press('Meta+s'); await page.waitForTimeout(500);
  console.log('saved under new name:', fs.readFileSync(path.join(work, 'notes', 'roadmap.md'), 'utf8').startsWith('UNSAVED EDIT '), '| old name gone:', !fs.existsSync(path.join(work, 'notes', 'plan.md')));
  // rename a folder with an open file inside it
  await page.evaluate(() => window.astrolabe.fs.testMenuChoice('rename'));
  await page.click('.treerow:has-text("notes")', { button: 'right' }); await page.waitForTimeout(400);
  await page.keyboard.type('journal'); await page.keyboard.press('Enter'); await page.waitForTimeout(900);
  console.log('folder renamed:', JSON.stringify(await tree()), JSON.stringify(await tabs()), '| open file path:', await page.evaluate(() => window.__monaco.editor.getEditors().map((e) => e.getModel()?.uri.path.split('/').slice(-2).join('/')).filter(Boolean)));
  // a clash is refused
  await page.evaluate(() => window.astrolabe.fs.testMenuChoice('rename'));
  await page.click('.treerow:has-text("data.json")', { button: 'right' }); await page.waitForTimeout(400);
  await page.keyboard.press('Meta+a'); await page.keyboard.type('main.py'); await page.keyboard.press('Enter'); await page.waitForTimeout(700);
  console.log('clash:', JSON.stringify(await page.evaluate(() => document.querySelector('.toast')?.textContent)), JSON.stringify(await tree()));
  // remove a file, then the folder holding the open note
  await page.evaluate(() => window.astrolabe.fs.testMenuChoice('trash'));
  await page.click('.treerow:has-text("data.json")', { button: 'right' }); await page.waitForTimeout(700);
  await page.evaluate(() => window.astrolabe.fs.testMenuChoice('trash'));
  await page.click('.treerow:has-text("journal")', { button: 'right' }); await page.waitForTimeout(900);
  console.log('after removing:', JSON.stringify(await tree()), JSON.stringify(await tabs()), '| on disk:', JSON.stringify(fs.readdirSync(work).filter((f) => !f.startsWith('.'))));
  await shot('96-after');
}
