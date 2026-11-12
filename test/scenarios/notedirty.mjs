// A fresh ⌘N note left untouched is not marked unsaved.
export default async function ({ page }) {
  await page.keyboard.press('Meta+n'); await page.waitForTimeout(2500);
  console.log('dirty files:', await page.evaluate(() => document.querySelectorAll('.filetab-close.is-dirty').length));
}
