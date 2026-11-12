export default async function ({ app, page, shot, run, work }) {
  const snap = (label) => page.evaluate((l) => { const s = [...window.__sessions.values()][0]; const b = s.term.buffer.active; const lines = []; for (let y = 0; y < b.length; y++) { const t = b.getLine(y).translateToString(true); lines.push(t.slice(0, 26)); } while (lines.length && !lines[lines.length - 1]) lines.pop(); return `${l}: cols=${s.term.cols} rows=${s.term.rows} cursorRow=${b.baseY + b.cursorY} lines=${JSON.stringify(lines)}`; }, label);
  await page.waitForTimeout(1200);
  console.log(await snap('fresh'));
  await shot('80-fresh');
  await page.keyboard.press('Meta+b'); await page.waitForTimeout(900);
  console.log(await snap('navigator open'));
  await page.keyboard.press('Meta+b'); await page.waitForTimeout(900);
  console.log(await snap('navigator closed'));
  await page.keyboard.press('Meta+b'); await page.waitForTimeout(900);
  await page.keyboard.press('Meta+b'); await page.waitForTimeout(900);
  console.log(await snap('toggled again'));
  await shot('81-after-toggles');
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; const b = w.getBounds(); w.setBounds({ ...b, width: 900, height: 600 }); });
  await page.waitForTimeout(1000);
  console.log(await snap('window smaller'));
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; const b = w.getBounds(); w.setBounds({ ...b, width: 1360, height: 860 }); });
  await page.waitForTimeout(1000);
  console.log(await snap('window restored'));
  await shot('82-after-window');
}
