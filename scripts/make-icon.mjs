// Rasterises build/icon.svg with the app's own browser engine, then builds build/icon.icns.
import { _electron as electron } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const svg = fs.readFileSync(path.join(root, 'build', 'icon.svg'), 'utf8');
const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'astrolabe-icon-'));
const app = await electron.launch({ args: ['.'], cwd: root, env: { ...process.env, ASTROLABE_CONFIG_DIR: cfg, ASTROLABE_TEST: 'background' } });
const page = await app.firstWindow();
await page.waitForSelector('.app');
const b64 = await page.evaluate(async (svgText) => {
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
  await img.decode();
  const c = document.createElement('canvas'); c.width = 1024; c.height = 1024;
  c.getContext('2d').drawImage(img, 0, 0, 1024, 1024);
  return c.toDataURL('image/png').split(',')[1];
}, svg);
await app.close();
fs.rmSync(cfg, { recursive: true, force: true });
const png = path.join(root, 'build', 'icon.png');
fs.writeFileSync(png, Buffer.from(b64, 'base64'));
const set = path.join(root, 'build', 'icon.iconset');
fs.rmSync(set, { recursive: true, force: true });
fs.mkdirSync(set);
for (const size of [16, 32, 128, 256, 512]) {
  execFileSync('sips', ['-z', String(size), String(size), png, '--out', path.join(set, `icon_${size}x${size}.png`)], { stdio: 'ignore' });
  execFileSync('sips', ['-z', String(size * 2), String(size * 2), png, '--out', path.join(set, `icon_${size}x${size}@2x.png`)], { stdio: 'ignore' });
}
execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(root, 'build', 'icon.icns')]);
fs.rmSync(set, { recursive: true, force: true });
console.log('wrote build/icon.png and build/icon.icns');
