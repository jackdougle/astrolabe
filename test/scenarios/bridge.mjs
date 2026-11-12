// The bridge between the raw text and the rendered note: every note can be edited rendered, an edit there
// rewrites only the block it touched, and Markdown the rendered view has no block for shows as editable source.
import fs from 'node:fs';
import path from 'node:path';
const NOTE = ['---', 'tags: [a, b]', '---', 'Setext Heading', '==============', '', '*   star bullet', '*   another   one', '', 'A paragraph with a [reference link][ref] and  two  spaces.',
  'It has a second line.', '', '| a | b |', '|---|:-:|', '| 1 | 2 |', '', '[ref]: https://example.com/somewhere "Title words"', '', '> [!note] Callout title', '> body of the callout', '',
  'Math $a_b$ and a footnote[^1].', '', '[^1]: The footnote text.', '', '<!-- a comment with words -->', '', '<details><summary>More</summary>', '', 'Hidden text', '', '</details>', '', 'Last paragraph.', ''].join('\n');
export default async function ({ page, type, run, work, shot }) {
  fs.writeFileSync(path.join(work, 'notes', 'bridge.md'), NOTE);
  const text = () => page.evaluate(() => window.__monaco.editor.getModels().find((m) => m.uri.path.endsWith('bridge.md'))?.getValue());
  const diff = (a, b) => { const x = a.split('\n'), y = b.split('\n'); const out = []; for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) out.push(`${i + 1}: ${JSON.stringify(x[i])} -> ${JSON.stringify(y[i])}`); return out; };
  await run(`cd ${work}`);
  await page.keyboard.press('Meta+p');
  await page.waitForTimeout(400);
  await type('bridge');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  await page.keyboard.press('Control+Meta+f');
  await page.waitForTimeout(300);
  console.log('editable:', await page.evaluate(() => document.querySelector('.rich').contentEditable), '| notice:', await page.evaluate(() => document.querySelector('.rich-note')?.textContent ?? null));
  console.log('shown as source:', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.rich pre[data-language="astrolabe:source"]')].map((p) => p.textContent))));
  console.log('opening changes nothing:', (await text()) === NOTE);
  await shot('bridge');
  // An edit rewrites the block it is in and nothing else.
  await page.click('.rich p:has-text("Last paragraph")');
  await page.waitForTimeout(250);
  await page.keyboard.press('Meta+ArrowRight');
  await type(' More.');
  await page.waitForTimeout(600);
  console.log('edit at the end:', JSON.stringify(diff(NOTE, await text())));
  await page.click('.rich li:has-text("another")');
  await page.waitForTimeout(250);
  await page.keyboard.press('Meta+ArrowRight');
  await type('!');
  await page.waitForTimeout(600);
  let now = await text();
  console.log('edit in the list:', JSON.stringify(diff(NOTE, now)));
  // Source blocks are edited as text, and what is typed is what the file gets.
  await page.click('.rich pre[data-language="astrolabe:source"]:has-text("example.com")');
  await page.waitForTimeout(250);
  await page.keyboard.press('Meta+ArrowRight');
  await type('X');
  await page.waitForTimeout(600);
  console.log('edit in a source block:', JSON.stringify(diff(now, await text())));
  // Moving a block carries its text as written.
  await page.click('.rich p:has-text("Last paragraph")');
  await page.waitForTimeout(250);
  now = await text();
  await page.keyboard.press('Alt+ArrowUp');
  await page.waitForTimeout(600);
  console.log('move up past a block:', JSON.stringify(diff(now, await text())));
  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(600);
  console.log('undone:', (await text()).trimEnd() === now.trimEnd());
  // An outside change (an agent, say) shows up, and only its block is redrawn.
  await page.keyboard.press('Meta+s');
  await page.waitForTimeout(700);
  await page.evaluate(() => { window.__h = document.querySelector('.rich table'); });
  fs.writeFileSync(path.join(work, 'notes', 'bridge.md'), (await text()).replace('Hidden text', 'Hidden words'));
  await page.waitForTimeout(1500);
  console.log('outside change, unsaved edits here:', await page.evaluate(() => document.querySelector('.rich').textContent.includes('Hidden words')), '| the table was not redrawn:', await page.evaluate(() => window.__h === document.querySelector('.rich table')));
  // Real notes: how they cut up, and what would show as source.
  const dirs = (process.env.PROBE || '').split(':').filter(Boolean);
  const files = [];
  const walk = (d, depth = 0) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name.startsWith('.') || e.name === 'node_modules') continue; const f = path.join(d, e.name); if (e.isDirectory()) { if (depth < 6) walk(f, depth + 1); } else if (e.name.endsWith('.md') && files.length < 1500) files.push(f); } };
  for (const d of dirs) walk(d);
  let shown = 0; let wasReadOnly = 0, inexact = 0, withSource = 0, blocks = 0, slow = 0;
  const kinds = {};
  for (const f of files) {
    const body = fs.readFileSync(f, 'utf8');
    if (body.length > 400000) continue;
    const t0 = Date.now();
    const r = await page.evaluate((b) => { const r = document.querySelector('.markdown > div:last-child').__probe(b); return { ...r, why: undefined, reason: r.source.length ? r.why(0, r.back[0]) : '' }; }, body);
    if (Date.now() - t0 > 400) slow += 1;
    blocks += r.parts;
    if (!r.whole) wasReadOnly += 1;
    if (!r.exact) inexact += 1;
    if (r.source.length) withSource += 1;
    if (r.source.length && shown < 12) { shown += 1; console.log('  source block:', r.reason); }
    for (const s of r.source) { const k = s.trim().slice(0, 14).replace(/[a-z0-9]+/gi, 'w'); kinds[k] = (kinds[k] || 0) + 1; }
  }
  if (files.length) console.log(`real notes: ${files.length} files, ${blocks} blocks | read-only before: ${wasReadOnly} | cut not exact: ${inexact} | with source blocks: ${withSource} | slow (>400ms): ${slow}`);
  if (files.length) console.log('source block shapes:', JSON.stringify(Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 25)));
}
