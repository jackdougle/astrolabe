export default async function ({ page, shot, run, type, state, work }) {
  const panes = () => page.evaluate(() => [...document.querySelectorAll('.pane')].map((p) => `${p.dataset.pane}:${p.firstElementChild.className}`));
  await run(`cd ${work}`);
  console.log('after cd', JSON.stringify(await panes()));
  await run('echo hello from astrolabe && ls -la');
  console.log('after ls', JSON.stringify(await panes()));
  await run('false');
  console.log('after false', JSON.stringify(await panes()));
  await type('printf "no');
  console.log('typing', JSON.stringify(await panes()), JSON.stringify((await state()).active));
  await shot('debug-extra-pane');
}
