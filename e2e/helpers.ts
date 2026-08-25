import { expect, type Page } from '@playwright/test';

/** Fixture repositories served by the production build in fixture mode. */
export const REPOS = {
  tiny: 'renrenmimi/renren-across-tabs',
  medium: 'renrenmimi/DrillLab',
  one: 'rtm-fixtures/one-commit',
  empty: 'rtm-fixtures/empty-repo',
  big: 'rtm-fixtures/big-history',
  rateLimited: 'rtm-fixtures/rate-limited',
  private: 'rtm-fixtures/private-repo',
  missing: 'nobody/does-not-exist',
} as const;

export function repoUrl(slug: string, commit?: string): string {
  const params = new URLSearchParams({ repo: slug });
  if (commit) params.set('c', commit);
  return `/?${params.toString()}`;
}

/** Opens a repository and waits for the transport to be usable. */
export async function openRepo(page: Page, slug: string, commit?: string): Promise<void> {
  await page.goto(repoUrl(slug, commit));
  await expect(page.getByRole('slider', { name: /Commit position/ })).toBeVisible();
}

export function transport(page: Page) {
  return {
    slider: page.getByRole('slider', { name: /Commit position/ }),
    play: page.getByRole('button', { name: 'Play history' }),
    pause: page.getByRole('button', { name: 'Pause playback' }),
    next: page.getByRole('button', { name: 'Next commit' }),
    previous: page.getByRole('button', { name: 'Previous commit' }),
    position: page.locator('[class*="position"]').first(),
  };
}

/** Current commit index, read from the scrubber. */
export async function currentIndex(page: Page): Promise<number> {
  const value = await page.getByRole('slider', { name: /Commit position/ }).inputValue();
  return Number(value);
}

/**
 * The application's own alerts.
 *
 * Next.js adds a `role="alert"` route announcer to every page, so the bare role
 * selector is always ambiguous.
 */
export function appAlert(page: Page) {
  return page.locator('[role="alert"]:not(#__next-route-announcer__)');
}

/** The repository field on the landing screen, as opposed to the header one. */
export function landingInput(page: Page) {
  return page.locator('main').getByRole('textbox');
}

export function landingLoadButton(page: Page) {
  return page.locator('main').getByRole('button', { name: 'Load', exact: true });
}

/** The subject line of the commit under the playhead. */
export function commitSubject(page: Page) {
  return page.locator('#selected-commit-subject');
}

/** Collects console errors and page errors for an assertion at the end. */
export function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

/** Fails if the document scrolls sideways at the current viewport. */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth, 'the document must not scroll sideways').toBeLessThanOrEqual(
    overflow.clientWidth + 1,
  );
}
