#!/usr/bin/env node
/**
 * Captures the screenshots used to review layout and hierarchy.
 *
 * Point it at a running server. The built-in demo is deterministic on its own;
 * fixture mode additionally makes the loaded-range shot reproducible:
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

/** @type {{name: string, width: number, height: number, path: string, steps?: (page: import('@playwright/test').Page) => Promise<void>}[]} */
const shots = [
  { name: '01-landing-desktop', width: 1440, height: 940, path: '/' },
  { name: '02-timeline-desktop', width: 1440, height: 940, path: `/?repo=${encodeURIComponent(REPO)}` },
  {
    name: '03-early-history-desktop',
    width: 1440,
    height: 940,
    path: `/?repo=${encodeURIComponent(REPO)}`,
    steps: async (page) => {
      await page.getByRole('slider', { name: /Commit position/ }).fill('2');
      await page.waitForTimeout(900);
    },
  },
  {
    name: '04-patch-open-desktop',
    width: 1440,
    height: 940,
    path: `/?repo=${encodeURIComponent(REPO)}`,
    steps: async (page) => {
      await page.waitForTimeout(1500);
      await page.locator('[class*="fileButton"]').first().click();
      await page.waitForTimeout(400);
    },
  },
  {
    name: '05-milestones-desktop',
    width: 1440,
    height: 940,
    path: `/?repo=${encodeURIComponent(REPO)}`,
    steps: async (page) => {
      await page.getByRole('tab', { name: /Milestones/ }).click();
      await page.waitForTimeout(600);
    },
  },
  {
    name: '06-commits-desktop',
    width: 1440,
    height: 940,
    path: `/?repo=${encodeURIComponent(REPO)}`,
    steps: async (page) => {
      await page.getByRole('tab', { name: 'Commits' }).click();
      await page.waitForTimeout(600);
    },
  },
  {
    name: '07-loaded-range-desktop',
    width: 1440,
    height: 940,
    path: `/?repo=${encodeURIComponent(BIG)}`,
    steps: async (page) => {
      await page.getByRole('tab', { name: 'Commits' }).click();
      await page.waitForTimeout(900);
    },
  },
  { name: '08-error-desktop', width: 1440, height: 940, path: '/?repo=rtm-fixtures%2Frate-limited' },
  { name: '09-live-desktop', width: 1440, height: 940, path: '/?repo=rtm-fixtures%2Fsample-app' },
  { name: '10-landing-mobile', width: 390, height: 900, path: '/' },
  { name: '11-timeline-mobile', width: 390, height: 900, path: `/?repo=${encodeURIComponent(REPO)}` },
  {
    name: '12-tree-mobile',
    width: 390,
    height: 900,
    path: `/?repo=${encodeURIComponent(REPO)}`,
    steps: async (page) => {
      await page.waitForTimeout(1500);
      await page.getByRole('heading', { name: 'Working tree' }).scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
    },
  },
  { name: '13-timeline-360', width: 360, height: 780, path: `/?repo=${encodeURIComponent(REPO)}` },
  { name: '14-live-360', width: 360, height: 780, path: '/?repo=rtm-fixtures%2Fsample-app' },
];

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  let problems = 0;

  for (const shot of shots) {
    const page = await browser.newPage({
      viewport: { width: shot.width, height: shot.height },
      deviceScaleFactor: 2,
      colorScheme: 'dark',
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
  process.stdout.write(`\n${shots.length} screenshots in docs/screenshots/${problems > 0 ? `, ${problems} with problems` : ''}\n`);
  process.exit(problems > 0 ? 1 : 0);
}

await main();
