import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

export const settings = { previewTabs: true };

export default async function ({ page, work }) {
  const a = path.join(work, 'a.md');
  const b = path.join(work, 'b.md');
  const c = path.join(work, 'c.md');
  const code = path.join(work, 'changes.txt');
  const dirs = ['one', 'two'].map((name) => path.join(work, name));
  for (const dir of dirs) fs.mkdirSync(dir);
  fs.writeFileSync(a, '[B](./b.md) and [C](./c.md)\n');
  fs.writeFileSync(b, '# B\n');
  fs.writeFileSync(c, '# C\n');
  fs.writeFileSync(code, 'start\nold one\nkeep one\nkeep two\nold two\nend\n');

  const open = (path) => page.evaluate((p) => window.__store.getState().openFile(p), path);
  const active = (path) => page.waitForFunction((p) => {
    const s = window.__store.getState();
    return s.focus === 'editor' && s.panes[s.editors.active]?.active === p;
  }, path);
  const files = () => page.evaluate(() => {
    const s = window.__store.getState();
    return s.panes[s.editors.active]?.files.map((f) => f.path) ?? [];
  });
  const press = (key) => page.keyboard.press(key);
  const follow = (name) => page.locator('.rich').getByRole('link', { name, exact: true }).click({ modifiers: ['Meta'] });

  await open(a);
  await follow('B');
  await active(b);
  assert.deepEqual(await files(), [b]);
  await press('Meta+ArrowLeft');
  await active(a);
  assert.deepEqual(await files(), [a]);
  await press('Meta+ArrowRight');
  await active(b);
  await press('Meta+ArrowLeft');
  await active(a);
  await follow('C');
  await active(c);
  await page.locator('.filetab').filter({ hasText: 'c.md' }).dblclick();
  await press('Meta+ArrowLeft');
  await active(a);
  assert.deepEqual(await files(), [c, a]);
  await press('Meta+ArrowRight');
  await active(c);
  await press('Meta+ArrowRight');
  await active(c);
  console.log('ok  preview link back/forward, branching, and pinned tabs');

  await page.evaluate(([one, two]) => {
    const s = window.__store.getState();
    const tab = s.newTab(one);
    s.split('row');
    const now = window.__store.getState();
    const id = now.tabs.find((t) => t.id === tab).activePane;
    now.patchPane(id, { cwd: two, startCwd: two });
  }, dirs);
  await press('Meta+Shift+w');
  await page.evaluate(() => window.__store.getState().focusArea('editor'));
  await press('Meta+w');
  await page.waitForFunction((p) => window.__store.getState().panes[window.__store.getState().editors.active]?.active !== p, c);
  await press('Meta+Shift+t');
  await active(c);
  await page.evaluate(() => window.__store.getState().focusArea('terminal'));
  await press('Meta+Shift+t');
  await page.waitForFunction(([one, two]) => {
    const s = window.__store.getState();
    const tab = s.tabs.find((t) => t.id === s.activeTab);
    const root = tab?.root;
    return s.focus === 'terminal' && root?.type === 'split' && root.dir === 'row'
      && s.panes[root.a.pane]?.startCwd === one && s.panes[root.b.pane]?.startCwd === two;
  }, dirs);
  console.log('ok  editor and terminal reopen use separate histories');

  await open(code);
  await page.waitForFunction((p) => window.__monaco.editor.getModels().some((m) => m.uri.path === p), code);
  fs.writeFileSync(code, 'start\nnew one\nkeep one\nkeep two\nnew two\nend\n');
  const prev = page.getByRole('button', { name: 'Previous change' });
  const next = page.getByRole('button', { name: 'Next change' });
  await prev.waitFor();
  assert.equal(await prev.locator('svg path').getAttribute('d'), 'M10 4l-4 4 4 4');
  assert.equal(await next.locator('svg path').getAttribute('d'), 'M6 4l4 4-4 4');
  const line = () => page.evaluate((p) => window.__monaco.editor.getEditors().find((e) => e.getModel()?.uri.path === p)?.getPosition()?.lineNumber, code);
  await next.click();
  assert.equal(await line(), 2);
  await next.click();
  assert.equal(await line(), 5);
  await prev.click();
  assert.equal(await line(), 2);
  console.log('ok  chevrons step through changes in both directions');

  await press('Meta+w');
  await active(c);
  await press('Meta+w');
  await page.waitForFunction(() => !window.__store.getState().editors.root);
  await press('Meta+Shift+t');
  await active(c);
  await press('Meta+Shift+t');
  await active(code);
  console.log('ok  the last editor tab is reachable and closed files reopen in order');
}
