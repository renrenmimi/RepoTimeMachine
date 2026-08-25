import { chromium } from '@playwright/test';
const [url, out, w, h, waitMs, action] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 2 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(Number(waitMs ?? 3000));
if (action) {
  for (const step of action.split('|')) {
    const [kind, arg] = step.split('::');
    if (kind === 'click') await page.getByRole('tab', { name: arg }).click();
    if (kind === 'clickText') await page.getByText(arg, { exact: false }).first().click();
    if (kind === 'key') await page.keyboard.press(arg);
    if (kind === 'wait') await page.waitForTimeout(Number(arg));
    if (kind === 'scroll') await page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView(), arg);
  }
}
const overflow = await page.evaluate(() => {
  const wide = [...document.querySelectorAll('*')].filter((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1).slice(0, 6).map((el) => `${el.tagName}.${el.className}`.slice(0, 90));
  return { scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth, wide };
});
await page.screenshot({ path: out, fullPage: false });
console.log(JSON.stringify({ overflow, errors: errors.slice(0, 15) }, null, 1));
await browser.close();
