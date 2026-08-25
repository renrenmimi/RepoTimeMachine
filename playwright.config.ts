import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.RTM_E2E_PORT ?? 3211);
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * End-to-end tests run against a real production build.
 *
 * `RTM_FIXTURE_MODE=1` makes the route handlers serve recorded payloads from
 * `fixtures/` instead of calling GitHub, so the suite exercises the whole stack
 * — routing, caching headers, hydration, client behaviour — without depending on
 * GitHub's availability or spending rate limit. No token is provided, which also
 * proves the application works without one.
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  timeout: 45_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    colorScheme: 'dark',
  },

  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
      testIgnore: /motion\.spec\.ts/,
    },
    {
      // The narrow layout is what needs re-checking on a phone; the API and
      // reduced-motion suites are viewport-independent.
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      testMatch: /shell\.spec\.ts/,
    },
    {
      name: 'reduced-motion',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        contextOptions: { reducedMotion: 'reduce' },
      },
      testMatch: /motion\.spec\.ts/,
    },
  ],

  webServer: {
    command: `npx next start -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      RTM_FIXTURE_MODE: '1',
      // Deliberately no GITHUB_TOKEN: the suite runs the anonymous code path.
      NODE_ENV: 'production',
    },
  },
});
