// Records where this build came from and when, so an installed copy can tell when its source has moved on
// (it then shows a notice in the corner that offers to reload or relaunch).
import fs from 'node:fs';
fs.writeFileSync('dist-electron/source.json', JSON.stringify({ source: process.cwd(), builtAt: Date.now() }) + '\n');
