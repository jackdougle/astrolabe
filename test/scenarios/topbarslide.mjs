// ⇧⌘B slides the top bar up out of the window (and back down) instead of snapping, like ⌘L's navigator drawer.
export const settings = { zoom: 1 };
export default async function ({ page, shot }) {
  let fails = 0;
  const ok = (name, pass, detail = '') => { if (!pass) fails += 1; console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail && !pass ? `: ${detail}` : ''}`); };
  const at = (ms) => page.waitForTimeout(ms);
  const state = () => page.evaluate(() => {
    const b = document.querySelector('.topbar'); const cs = getComputedStyle(b);
    const body = document.querySelector('.app-body').getBoundingClientRect();
    return { mt: parseFloat(cs.marginTop), vis: cs.visibility, op: parseFloat(getComputedStyle(b.firstElementChild).opacity), bodyTop: body.top, h: b.offsetHeight };
  });
  await at(800);
  const start = await state();
  ok('starts shown', start.mt === 0 && start.vis === 'visible' && start.bodyTop > 20, JSON.stringify(start));
  await page.keyboard.press('Meta+Shift+b'); await at(70);
  const mid = await state();
  ok('mid-hide: the bar is partway up', mid.mt < -2 && mid.mt > -start.h, JSON.stringify(mid));
  ok('mid-hide: still visible while it slides', mid.vis === 'visible', mid.vis);
  ok('mid-hide: contents fading', mid.op < 1 && mid.op > 0, String(mid.op));
  await shot('topbar-midhide');
  await at(400);
  const gone = await state();
  ok('hidden: out of the window', gone.mt <= -start.h && gone.vis === 'hidden' && gone.bodyTop <= 0.5, JSON.stringify(gone));
  await page.keyboard.press('Meta+Shift+b'); await at(70);
  const back = await state();
  ok('mid-show: partway down and visible', back.mt < -2 && back.mt > -start.h && back.vis === 'visible', JSON.stringify(back));
  await shot('topbar-midshow');
  await at(400);
  const end = await state();
  ok('shown again', end.mt === 0 && end.op === 1 && end.bodyTop === start.bodyTop, JSON.stringify(end));
  if (fails) throw new Error(`${fails} failed`);
}
