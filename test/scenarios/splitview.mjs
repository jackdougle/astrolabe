import assert from 'node:assert/strict';

export default async function ({ page, work }) {
  const menu = async (tab) => {
    await page.evaluate(() => window.astrolabe.fs.testMenuChoice('split'));
    await tab.click({ button: 'right' });
  };
  const a = `${work}/main.py`;
  const b = `${work}/data.json`;
  const file = (path) => page.locator(`.filetab[data-flip="${path}"]`);
  const fileOrder = () => page.locator('.filetab:not(.is-leaving)').evaluateAll((els) => els.map((el) => el.dataset.flip));
  const editor = (pane) => page.locator(`.area.is-editors .pane[data-pane="${pane}"]`);
  const editorLayout = () => page.evaluate(() => {
    const s = window.__store.getState();
    return { root: s.editors.root, active: s.editors.active };
  });

  await page.evaluate(([a, b]) => {
    const s = window.__store.getState();
    s.openFile(a);
    s.openFile(b);
  }, [a, b]);
  const before = await editorLayout();
  await menu(file(a));
  await page.waitForFunction(() => window.__store.getState().editors.root?.type === 'split');
  let { root, active } = await editorLayout();
  assert.equal(root.dir, 'row');
  assert.equal(root.ratio, 0.5);
  assert.equal(root.b.pane, before.active);
  assert.equal(active, before.active);
  assert.deepEqual(await fileOrder(), [a, b]);
  const left = root.a.pane;
  const right = root.b.pane;
  const from = await editor(right).locator('.pane-grip').boundingBox();
  const to = await editor(left).boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height * 0.16, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction(() => window.__store.getState().editors.root?.dir === 'col');
  assert.deepEqual(await fileOrder(), [b, a]);
  assert.equal((await editorLayout()).root.a.pane, right);
  await menu(file(a));
  await page.waitForFunction(() => window.__store.getState().editors.root?.dir === 'row');
  assert.deepEqual(await fileOrder(), [b, a]);
  assert.equal((await editorLayout()).root.a.pane, right);
  console.log('ok  editor headers follow horizontal and stacked layouts, and Split view keeps header order');

  const [first, second] = await page.evaluate((work) => {
    const s = window.__store.getState();
    s.focusArea('terminal');
    s.split('col');
    const first = window.__store.getState().tabs[0];
    s.setRatio(first.id, first.root.id, 0.65);
    const id = s.newTab(work);
    s.split('row');
    const second = window.__store.getState().tabs.find((t) => t.id === id);
    s.setRatio(id, second.root.id, 0.35);
    return window.__store.getState().tabs;
  }, work);
  const ids = [first.root.a.pane, first.root.b.pane, second.root.a.pane, second.root.b.pane];
  await page.waitForFunction((ids) => ids.every((id) => window.__sessions.has(id)), ids);
  await page.evaluate(() => { window.__splitSessions = new Map(window.__sessions); });
  const block = (id) => page.locator(`.tab-group[data-tab="${id}"]`);
  await menu(block(first.id).locator('.toptab').first());
  await page.waitForFunction(() => window.__store.getState().tabs.length === 1);
  const after = await page.evaluate(() => window.__store.getState().tabs[0]);
  assert.equal(after.id, second.id);
  assert.equal(after.activePane, second.activePane);
  assert.equal(after.root.dir, 'row');
  assert.equal(after.root.ratio, 0.5);
  assert.deepEqual(after.root.a, first.root);
  assert.deepEqual(after.root.b, second.root);
  await page.waitForFunction((ids) => ids.every((id) => window.__sessions.get(id) === window.__splitSessions.get(id)), ids);
  assert.deepEqual(await block(second.id).locator('.toptab').evaluateAll((tabs) => tabs.map((t) => t.dataset.flip)), ids);
  console.log('ok  terminal groups take equal halves in header order without changing inner splits or shell sessions');
}
