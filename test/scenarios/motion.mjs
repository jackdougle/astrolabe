// Opening and closing animations: tabs, panes, file tabs, the navigator and windows.
// Samples classes and sizes mid-animation, and checks new terminals still measure their size correctly.
export default async function ({ app, page, shot, run, type, work }) {
  const at = (ms) => page.waitForTimeout(ms);
  const look = (label) => page.evaluate((l) => {
    const cls = (sel) => [...document.querySelectorAll(sel)].map((e) => [...e.classList].filter((c) => c.startsWith('is-')).join(' ') || '-');
    const slot = document.querySelector('.sidebar-slot');
    return `${l}: tabs=${JSON.stringify(cls('.toptab'))} areas=${JSON.stringify(cls('.tab-area'))} panes=${JSON.stringify(cls('.tab-area.is-active .pane, .tab-area.is-leaving .pane'))} files=${JSON.stringify(cls('.filetab'))} slot=${slot ? `${Math.round(slot.getBoundingClientRect().width)}px` : 'none'}`;
  }, label).then(console.log);
  const cols = () => page.evaluate(() => [...window.__sessions.values()].map((s) => s.term.cols));
  const winOpacity = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => Math.round(w.getOpacity() * 100) / 100));

  await run(`cd ${work}`);
  console.log('cols alone', JSON.stringify(await cols()));

  await page.keyboard.press('Meta+d'); await at(60); await look('split +60ms'); await shot('m1-split-mid');
  await at(1400); await look('split settled');
  console.log('cols after split', JSON.stringify(await cols()));

  await page.keyboard.press('Meta+w'); await at(50); await look('close pane +50ms'); await shot('m2-close-mid');
  await at(400); await look('close pane settled');

  await page.keyboard.press('Meta+t'); await at(60); await look('new tab +60ms'); await shot('m3-newtab-mid');
  await at(1400); await look('new tab settled');
  console.log('cols in new tab', JSON.stringify(await cols()));
  await page.keyboard.press('Meta+Shift+w'); await at(60); await look('close tab +60ms'); await shot('m4-closetab-mid');
  await at(400); await look('close tab settled');

  await page.keyboard.press('Meta+b'); await at(80); await look('navigator open +80ms'); await shot('m5-nav-mid');
  await at(500); await look('navigator open settled'); await shot('m5-nav-open');
  await page.keyboard.press('Meta+b'); await at(80); await look('navigator close +80ms');
  await at(500); await look('navigator close settled');

  const open = async (name) => { await page.keyboard.press('Meta+p'); await at(350); await type(name); await page.keyboard.press('Enter'); };
  await open('main.py'); await at(80); await look('editor open +80ms'); await shot('m6-editor-mid');
  await at(900);
  await open('data.json'); await at(60); await look('second file +60ms');
  await at(800);
  await page.keyboard.press('Meta+w'); await at(50); await look('close file +50ms');
  await at(400); await look('close file settled');

  // A second window fades in, and out when closed. Opacity is sampled in the main process every ~16ms.
  const sample = (ms) => app.evaluate(({ BrowserWindow }, ms) => new Promise((done) => {
    const out = []; const t0 = Date.now();
    const iv = setInterval(() => {
      const w = BrowserWindow.getAllWindows().sort((a, b) => b.id - a.id)[0];
      out.push(w && !w.isDestroyed() ? `${w.id}:${w.isVisible() ? Math.round(w.getOpacity() * 100) / 100 : 'hidden'}` : 'gone');
      if (Date.now() - t0 > ms) { clearInterval(iv); done(out.filter((v, i) => v !== out[i - 1]).join(' ')); }
    }, 16);
  }), ms);
  const opening = sample(1500);
  await page.evaluate(() => window.astrolabe.app.newWindow());
  console.log('new window opacity:', await opening);
  const closing = sample(500);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().sort((a, b) => b.id - a.id)[0].close());
  console.log('closing window opacity:', await closing);
  console.log('windows left', await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length));
}
