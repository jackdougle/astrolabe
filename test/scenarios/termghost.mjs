// Hidden tabs must drop their WebGL context so opening many terminals cannot exhaust Chromium's budget
// and leave ghost frames on the terminals that lost theirs.
export default async function ({ page, shot, run }) {
  let fails = 0;
  const ok = (name, pass, detail = '') => { if (!pass) fails += 1; console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail && !pass ? `: ${detail}` : ''}`); };
  const at = (ms) => page.waitForTimeout(ms);
  const gpu = () => page.evaluate(() => [...window.__sessions.values()].map((s) => ({
    id: s.id.slice(0, 8), gpu: !!s.webgl, want: !!s.wantGpu,
    visible: getComputedStyle(s.host).visibility === 'visible',
  })));
  const hasText = (visible, text) => page.evaluate(({ visible, text }) => [...window.__sessions.values()].some((s) => {
    if ((getComputedStyle(s.host).visibility === 'visible') !== visible) return false;
    const buf = s.term.buffer.active;
    return Array.from({ length: s.term.rows }, (_, i) => buf.getLine(buf.viewportY + i)?.translateToString(true)).includes(text);
  }), { visible, text });

  await at(600);
  let g = await gpu();
  ok('first terminal has GPU', g.length === 1 && g[0].gpu && g[0].want, JSON.stringify(g));
  await run("printf 'first-tab-only-0917\\n'");
  await page.evaluate(() => { window.__oldContext = [...window.__sessions.values()][0].webgl?._renderer?._gl; });
  await page.keyboard.press('Meta+t');
  await page.waitForFunction(() => window.__sessions.size === 2);
  await at(350);
  ok('old GPU context was explicitly released', await page.evaluate(() => window.__oldContext?.isContextLost()));
  ok('previous tab text stays on the hidden screen only', await hasText(false, 'first-tab-only-0917') && !await hasText(true, 'first-tab-only-0917'));

  // Open more tabs than the common eight-context limit.
  for (let i = 0; i < 8; i++) { await page.keyboard.press('Meta+t'); await at(250); }
  g = await gpu();
  const on = g.filter((x) => x.gpu);
  const want = g.filter((x) => x.want);
  ok('opened ten terminal tabs', g.length === 10, JSON.stringify(g));
  ok('only the visible tab wants GPU', want.length === 1, JSON.stringify(want));
  ok('only one WebGL context is live', on.length === 1, JSON.stringify(on));
  ok('only the front terminal is visible', g.filter((x) => x.visible).length === 1 && on[0]?.visible, JSON.stringify(g));
  await shot('termghost-many-tabs');

  // Switch back to the first tab: it should pick GPU up; the one we left should drop it.
  await page.keyboard.press('Meta+1');
  await at(500);
  g = await gpu();
  const first = g[0];
  console.log('back to first', JSON.stringify(g));
  ok('first tab has GPU again', first.gpu && first.want, JSON.stringify(first));
  ok('still exactly one live GPU', g.filter((x) => x.gpu).length === 1, JSON.stringify(g));
  ok('switching back restores the original text', await hasText(true, 'first-tab-only-0917'));

  if (fails) throw new Error(`${fails} failed`);
}
