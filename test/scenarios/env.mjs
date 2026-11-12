export default async function ({ page, run, work }) {
  await run(`cd ${work}`);
  await run("env | grep -cE '^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_CODE_)' ; echo done", 900);
  const out = await page.evaluate(() => { const s = [...window.__sessions.values()][0]; const b = s.blocks.at(-1); return s.blockText(b, 'output'); });
  console.log('launcher has markers:', Object.keys(process.env).filter((k) => /^CLAUDE/.test(k)).length, '| markers inside the shell:', JSON.stringify(out));
}
