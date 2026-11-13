// Unfocused opacity: reads the resolved alphas with the app focused and blurred.
export default async function ({ page }) {
  const read = () => page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.app'));
    return ['--alpha', '--chrome-alpha'].map((k) => `${k}=${cs.getPropertyValue(k).trim()}`).join(' ');
  });
  await page.evaluate(() => document.body.classList.remove('is-blurred'));
  console.log('focused  ', await read());
  await page.evaluate(() => document.body.classList.add('is-blurred'));
  console.log('unfocused', await read());
}
