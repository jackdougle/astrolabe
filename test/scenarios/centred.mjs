// A note's text sits in the middle of its editor however wide the editor is: two editors side by side, at even and
// uneven widths, rendered and raw, and one editor beside the terminals.
import fs from 'node:fs';
export default async function ({ page, run, work, shot }) {
  const at = (ms) => page.waitForTimeout(ms);
  const words = 'The quick brown fox jumps over the lazy dog and keeps going for a good while longer than you would expect. ';
  for (const n of ['One', 'Two']) fs.writeFileSync(`${work}/${n}.md`, `# ${n}\n\n${words.repeat(6)}\n\n- a point\n- another point\n\n${words.repeat(5)}\n`);
  await run(`cd ${work}`);
  const open = (name, opts) => page.evaluate(([p, o]) => window.__store.getState().openFile(p, null, o), [`${work}/${name}`, opts]);
  // For each editor showing: how far its text column is from the pane's left and right edges.
  const columns = () => page.evaluate(() => [...document.querySelectorAll('.tab-area.is-active .editor-pane')].filter((p) => p.getBoundingClientRect().width > 0).map((p) => {
    const pane = p.getBoundingClientRect();
    const raw = p.querySelector('.markdown')?.style.display === 'none' || !p.querySelector('.markdown');
    // Rendered: the column of prose. Raw: the lines themselves, to the right of the line numbers.
    const el = raw ? p.querySelector('.editor-host') : p.querySelector('.milkdown');
    const r = el.getBoundingClientRect();
    const off = Math.round((r.left - pane.left) - (pane.right - r.right));
    return `${raw ? 'raw' : 'rendered'} pane ${Math.round(pane.width)}: left ${Math.round(r.left - pane.left)} right ${Math.round(pane.right - r.right)} column ${Math.round(r.width)}${Math.abs(off) <= 2 ? ' (middle)' : ` (OFF by ${off})`}`;
  }).join(' | '));
  const ratio = (r) => page.evaluate((r) => { const s = window.__store.getState(); const root = s.editors.root; if (root?.type === 'split') s.setRatio('editors', root.id, r); return root?.type; }, r);

  await open('One.md'); await at(1200);
  console.log('one editor beside the terminals:', await columns());
  await shot('centred-1-beside-terminal');
  await page.evaluate(() => window.__store.getState().setAreaRatio(0.25)); await at(700);
  console.log('  terminals at a quarter:', await columns());
  await open('Two.md', { beside: 'right' }); await at(1200);
  await page.keyboard.press('Control+Meta+f'); await at(900);
  console.log('two editors, even:', await columns());
  for (const r of [0.7, 0.3, 0.82]) { console.log(`  split ${await ratio(r)} at ${r}:`, await at(700) ?? await columns()); }
  await shot('centred-2-uneven');
  await page.keyboard.press('Meta+Shift+r'); await at(1200);
  console.log('one of them raw:', await columns());
  await ratio(0.35); await at(700);
  console.log('  at 0.35:', await columns());
  await shot('centred-3-raw');
}
