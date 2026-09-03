#!/usr/bin/env node
/**
 * Captures the screenshots used to review layout and hierarchy.
 *
 * Point it at a running server. The built-in demo is deterministic on its own;
 * fixture mode additionally makes the loaded-range and live shots reproducible:
 *
 *     npm run build
 *     RTM_FIXTURE_MODE=1 npx next start -p 3311 &
 *     RTM_BASE_URL=http://127.0.0.1:3311 npm run screenshots
 *
 * Output goes to `docs/screenshots/`, which is not committed.
 */

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const BASE = (process.env.RTM_BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const OUT = path.join(process.cwd(), 'docs', 'screenshots');

/** The built-in demo needs no fixture mode and no GitHub quota. */
const REPO = 'demo/learning-platform';
/** Only reachable with RTM_FIXTURE_MODE=1; skipped otherwise. */
const BIG = 'rtm-fixtures/big-history';

const demo = (params = '') => `/?repo=${encodeURIComponent(REPO)}${params}`;

/**
 * @type {{
 *   name: string, width: number, height: number, path: string,
 *   theme?: 'light' | 'dark',
 *   steps?: (page: import('@playwright/test').Page) => Promise<void>,
 * }[]}
 */
const shots = [
  { name: '01-home-desktop', width: 1440, height: 900, path: '/' },
  { name: '02-replay-first-step', width: 1440, height: 900, path: demo() },
  {
    name: '03-replay-mid-history',
    width: 1440,
    height: 900,
    path: demo(),
    steps: async (page) => {
      await page.getByRole('slider', { name: /Commit position/ }).fill('9');
      await page.waitForTimeout(900);
    },
  },
  {
    name: '04-replay-changes-diff',
    width: 1440,
    height: 900,
    path: demo(),
    steps: async (page) => {
      await page.getByRole('slider', { name: /Commit position/ }).fill('9');
      await page.waitForTimeout(1200);
      await page.getByRole('tab', { name: /Changes/ }).click();
      await page.locator('[class*="fileButton"]').first().click();
      await page.waitForTimeout(400);
    },
  },
  {
    name: '05-compare',
    width: 1440,
    height: 900,
    path: demo(),
    steps: async (page) => {
      await page.getByRole('slider', { name: /Commit position/ }).fill('12');
      await page.waitForTimeout(600);
      await page.getByRole('tab', { name: 'Compare' }).click();
      await page.waitForTimeout(1400);
    },
  },
  {
    name: '06-compare-picker',
    width: 1440,
    height: 900,
    path: demo(),
    steps: async (page) => {
      await page.getByRole('tab', { name: 'Compare' }).click();
      await page.waitForTimeout(1200);
      await page.getByRole('button', { name: /^From/ }).click();
      await page.waitForTimeout(300);
    },
  },
  {
    name: '07-insights',
    width: 1440,
    height: 900,
    path: demo(),
    steps: async (page) => {
      await page.getByRole('tab', { name: 'Insights' }).click();
      await page.waitForTimeout(1200);
    },
  },
  {
    name: '08-insights-milestones',
    width: 1440,
    height: 900,
    path: demo(),
    steps: async (page) => {
      await page.getByRole('tab', { name: 'Insights' }).click();
      await page.waitForTimeout(1200);
      await page.getByRole('heading', { name: /Milestones/ }).scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
    },
  },
  { name: '09-replay-dark', width: 1440, height: 900, path: demo(), theme: 'dark' },
  { name: '10-compare-dark', width: 1440, height: 900, path: demo(), theme: 'dark',
    steps: async (page) => {
      await page.getByRole('tab', { name: 'Compare' }).click();
      await page.waitForTimeout(1400);
    },
  },
  { name: '11-replay-1280x720', width: 1280, height: 720, path: demo() },
  { name: '12-replay-1024x768', width: 1024, height: 768, path: demo() },
  {
    name: '13-loaded-range',
    width: 1440,
    height: 900,
    path: `/?repo=${encodeURIComponent(BIG)}`,
    steps: async (page) => {
      await page.waitForTimeout(900);
    },
  },
  { name: '14-live-repository', width: 1440, height: 900, path: '/?repo=rtm-fixtures%2Fsample-app' },
  { name: '15-error-rate-limited', width: 1440, height: 900, path: '/?repo=rtm-fixtures%2Frate-limited' },
  { name: '16-home-390', width: 390, height: 844, path: '/' },
  { name: '17-replay-390', width: 390, height: 844, path: demo() },
  {
    name: '18-history-drawer-390',
    width: 390,
    height: 844,
    path: demo(),
    steps: async (page) => {
      await page.waitForTimeout(900);
      await page.getByRole('button', { name: /^History/ }).click();
      await page.waitForTimeout(400);
    },
  },
  {
    name: '19-compare-390',
    width: 390,
    height: 844,
    path: demo(),
    steps: async (page) => {
      await page.getByRole('tab', { name: 'Compare' }).click();
      await page.waitForTimeout(1400);
    },
  },
  { name: '20-replay-360', width: 360, height: 800, path: demo() },
];

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  let problems = 0;

  for (const shot of shots) {
    const page = await browser.newPage({
      viewport: { width: shot.width, height: shot.height },
      deviceScaleFactor: 2,
      colorScheme: shot.theme === 'dark' ? 'dark' : 'light',
    });

    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await page.goto(`${BASE}${shot.path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2600);
    if (shot.steps) await shot.steps(page);

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));

    const file = path.join(OUT, `${shot.name}.png`);
    await page.screenshot({ path: file });

    const overflows = overflow.scrollWidth > overflow.clientWidth + 1;
    if (overflows || errors.length > 0) problems += 1;
    process.stdout.write(
      `${shot.name.padEnd(28)} ${shot.width}x${shot.height}` +
        `${overflows ? `  OVERFLOW ${overflow.scrollWidth}>${overflow.clientWidth}` : ''}` +
        `${errors.length > 0 ? `  ERRORS ${errors.length}: ${errors[0]?.slice(0, 80)}` : ''}\n`,
    );

    await page.close();
  }

  await browser.close();
  process.stdout.write(
    `\n${shots.length} screenshots in docs/screenshots/${problems > 0 ? `, ${problems} with problems` : ''}\n`,
  );
  process.exit(problems > 0 ? 1 : 0);
}

await main();
