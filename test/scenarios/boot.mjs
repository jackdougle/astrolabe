export default async function ({ page, shot, run, state, work }) {
  await shot('01-boot');
  await run(`cd ${work}`);
  await run('echo hello from astrolabe && ls -la');
  await shot('02-after-ls');
  await run('false');
  await run('printf "no newline"');
  await shot('03-blocks');
  console.log('mid', JSON.stringify(await state()));
}
