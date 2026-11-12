// Launches the built app against a throwaway config folder and runs a scenario,
// saving screenshots. Usage: SHOTS=/dir node test/drive.mjs <scenario>
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const shots = process.env.SHOTS || path.join(root, 'test', 'shots');
const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'astrolabe-test-'));
const work = path.join(cfg, 'work');
fs.mkdirSync(shots, { recursive: true });
fs.mkdirSync(path.join(work, 'notes'), { recursive: true });
fs.writeFileSync(path.join(cfg, 'hist'), '');
if (process.env.SETTINGS) fs.writeFileSync(path.join(cfg, 'settings.json'), process.env.SETTINGS);
fs.writeFileSync(path.join(work, 'notes', 'plan.md'), '# Plan\n\nA paragraph with **bold** text and a [link](https://example.com).\n\n- first item\n- second item\n\nSee [[Some Note]] and ![[diagram.png]] for more.\n\n- [ ] open task\n- [x] done task\n\n1. one\n2. two\n\n```sh\necho hi\n```\n');
fs.writeFileSync(path.join(work, 'main.py'), 'import sys\n\n\ndef greet(name):\n    return f"hello {name}, this is a deliberately long line that should wrap when the editor pane is narrow enough to need it"\n\n\nprint(greet(sys.argv[1] if len(sys.argv) > 1 else "world"))\n');
fs.writeFileSync(path.join(work, 'data.json'), '{\n  "a": 1,\n  "b": [1, 2, 3]\n}\n');

const app = await electron.launch({
  ...(process.env.APP ? { executablePath: process.env.APP, args: [] } : { args: ['.'] }), cwd: root,
  env: { ...process.env, ASTROLABE_CONFIG_DIR: cfg, ASTROLABE_TEST: process.env.FOCUSED ? 'focused' : 'background', HISTFILE: path.join(cfg, 'hist'), ASTROLABE_START_DIR: work },
});
const page = await app.firstWindow();
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message.slice(0, 400)}`));
const shot = async (name) => { await page.waitForTimeout(350); await page.screenshot({ path: path.join(shots, `${name}.png`) }); console.log('shot', name); };
const type = async (text) => { await page.keyboard.type(text, { delay: 8 }); };
const run = async (cmd, wait = 900) => { await type(cmd); await page.keyboard.press('Enter'); await page.waitForTimeout(wait); };
const state = () => page.evaluate(() => {
  const el = document.activeElement;
  return { active: el ? `${el.tagName}.${String(el.className).slice(0, 60)}` : null, blocks: document.querySelectorAll('.blk').length, inputHidden: [...document.querySelectorAll('.cmd-input')].map((e) => e.classList.contains('is-hidden')), panes: document.querySelectorAll('.pane').length, tabs: document.querySelectorAll('.toptab').length };
});
const ctx = { app, page, shot, type, run, state, work, cfg, logs };

try {
  await page.waitForSelector('.term-host .xterm', { timeout: 20000 });
  await page.waitForFunction(() => document.querySelector('.cmd-input') && !document.querySelector('.cmd-input').classList.contains('is-hidden'), null, { timeout: 15000 }).catch(() => console.log('!! prompt never appeared'));
  const scenario = process.argv[2] || 'boot';
  const mod = await import(`./scenarios/${scenario}.mjs`);
  await mod.default(ctx);
} catch (e) {
  console.log('!! scenario error:', e.message.split('\n')[0]);
  await page.screenshot({ path: path.join(shots, 'error.png') }).catch(() => {});
} finally {
  console.log('state', JSON.stringify(await state().catch(() => null)));
  if (logs.length) console.log(logs.slice(0, 25).join('\n'));
  await app.close().catch(() => {});
  fs.rmSync(cfg, { recursive: true, force: true });
}
