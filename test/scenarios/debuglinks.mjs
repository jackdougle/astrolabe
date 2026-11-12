export default async function ({ page, run, work }) {
  await run(`cd ${work}`);
  await run(`echo "see main.py:8 for more"; echo "${work}/main.py#L3 hash"; python3 -c "print('x'*150 + ' ${work}/main.py')"`, 900);
  console.log(await page.evaluate(async () => {
    const s = [...window.__sessions.values()][0];
    const b = s.term.buffer.active; const out = [];
    for (let y = 0; y < b.length; y++) {
      const t = b.getLine(y).translateToString(true);
      if (!/see main|hash|xxxx|^\S*main\.py$/.test(t) || t.includes('echo')) continue;
      const links = await s.provideLinks(y + 1);
      out.push(`${y} wrapped=${b.getLine(y).isWrapped} ${JSON.stringify(t.slice(-40))} -> ${JSON.stringify((links || []).map((l) => [l.text, l.range]))}`);
    }
    return out.join('\n');
  }));
}
