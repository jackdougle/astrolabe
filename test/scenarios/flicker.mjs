// A program that redraws like Claude Code (synchronized frames; sometimes a full clear and reprint) must not make
// Astrolabe's own overlays (block headers, the pinned header, the input) blink on and off.
import fs from 'node:fs';
import path from 'node:path';
export default async function ({ page, run, work }) {
  fs.writeFileSync(path.join(work, 'redraw.py'), `
import sys, time
mode = sys.argv[1]
for i in range(80): print(f"history {i}")
for f in range(50):
    w = sys.stdout.write
    w("\\x1b[?2026h")
    if mode == "full":
        w("\\x1b[2J\\x1b[3J\\x1b[H")
        for i in range(80): w(f"history {i}\\n")
    else:
        w("\\x1b[6A\\r\\x1b[J")
    for j in range(6): w(f"frame {f} row {j} " + "*" * (f % 7) + "\\n")
    w("\\x1b[?2026l"); sys.stdout.flush(); time.sleep(0.06)
`);
  await page.evaluate(() => {
    window.__flips = 0;
    const mo = new MutationObserver((ms) => { for (const m of ms) if (m.type === 'childList' ? (m.addedNodes.length || m.removedNodes.length) : (m.attributeName === 'class' && m.oldValue !== m.target.className)) { window.__flips++; (window.__log ??= []).push(m.type === 'childList' ? `child +${m.addedNodes.length} -${m.removedNodes.length} on ${m.target.className}` : `${m.oldValue} -> ${m.target.className}`); } });
    mo.observe(document.querySelector('.pane.is-active .blk-layer'), { subtree: true, childList: true, attributes: true, attributeOldValue: true, attributeFilter: ['class'] });
    window.__mo = mo;
  });
  for (const mode of ['partial', 'full']) {
    await page.evaluate(() => { window.__flips = 0; window.__log = []; });
    await run(`python3 ${work}/redraw.py ${mode}`, 4500);
    console.log(mode, 'overlay changes during ~3s of redraws:', await page.evaluate(() => window.__flips));
    console.log(JSON.stringify(await page.evaluate(() => [...new Set(window.__log)].slice(0, 8))));
  }
}
