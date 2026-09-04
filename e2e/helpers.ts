import { expect, type Page } from '@playwright/test';

/**
 * References used by the suite.
 *
 * `demo` is the built-in curated history and needs no fixture mode. Everything
 * under `rtm-fixtures/` is synthetic recorded-shaped data, served only because
 * the e2e server runs with `RTM_FIXTURE_MODE=1`, and stands in for a live
 * GitHub repository.
 */
export const REPOS = {
  /** The built-in demo: sixteen commits, no GitHub requests. */
  demo: 'demo/learning-platform',
  /** Synthetic stand-ins for live repositories. */
  tiny: 'rtm-fixtures/tiny-app',
  medium: 'rtm-fixtures/sample-app',
  one: 'rtm-fixtures/one-commit',
  empty: 'rtm-fixtures/empty-repo',
  big: 'rtm-fixtures/big-history',
  rateLimited: 'rtm-fixtures/rate-limited',
  private: 'rtm-fixtures/private-repo',
  missing: 'nobody/does-not-exist',
  unknownDemo: 'demo/not-a-real-demo',
} as const;

/**
 * The only GitHub destinations the shipped interface is allowed to link to: this
 * project, and its author's profile. Anything else would mean the interface is
 * pointing at somebody's repository again.
 */
export const ALLOWED_GITHUB_LINKS = [
  'https://github.com/renrenmimi/RepoTimeMachine',
  'https://github.com/renrenmimi',
] as const;

export function repoUrl(slug: string, commit?: string): string {
  const params = new URLSearchParams({ repo: slug });
  if (commit) params.set('c', commit);
  return `/?${params.toString()}`;
}

/** Opens a repository and waits for the replay to be usable. */
export async function openRepo(page: Page, slug: string, commit?: string): Promise<void> {
  await page.goto(repoUrl(slug, commit));
  await expect(page.getByRole('slider', { name: /Commit position/ })).toBeVisible();
}

export function transport(page: Page) {
  return {
    slider: page.getByRole('slider', { name: /Commit position/ }),
    play: page.getByRole('button', { name: 'Play history' }),
    replay: page.getByRole('button', { name: /Replay the history from the first/ }),
    pause: page.getByRole('button', { name: 'Pause playback' }),
    next: page.getByRole('button', { name: 'Next commit' }),
    previous: page.getByRole('button', { name: 'Previous commit' }),
    latest: page.getByRole('button', { name: 'Latest' }),
    /** The visible "Commit N of M", which lives in the commit heading. */
    position: page.locator('#replay-position'),
  };
}

/** Current commit index, read from the scrubber. */
export async function currentIndex(page: Page): Promise<number> {
  const value = await page.getByRole('slider', { name: /Commit position/ }).inputValue();
  return Number(value);
}

/** The three top-level views. */
export function viewTab(page: Page, name: 'Replay' | 'Compare' | 'Insights') {
  return page.getByRole('tab', { name, exact: true });
}

/** The two sub-views inside the replay. */
export function subTab(page: Page, name: 'Repository' | 'Changes') {
  return page.getByRole('tab', { name: new RegExp(`^${name}`) });
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

/** The repository field on the home screen, as opposed to the one in the overlay. */
export function landingInput(page: Page) {
  return page.locator('main').getByRole('textbox');
}

export function landingLoadButton(page: Page) {
  return page.locator('main').getByRole('button', { name: 'Load repository' });
}

/** The one-click entry point for the built-in demo. */
export function demoButton(page: Page) {
  return page.getByRole('button', { name: 'Explore the demo' });
}

/** The marker that says the current data is built in. */
export function builtinBadge(page: Page) {
  return page.locator('[data-source="builtin"]');
}

/** The line that says the data came from GitHub. */
export function liveBadge(page: Page) {
  return page.locator('[data-source="github"]');
}

/** The GitHub quota disclosure, in either the known or the not-yet-observed state. */
export function quotaMeter(page: Page) {
  return page.getByLabel('GitHub request quota');
}

/** One of the two endpoint selectors in the comparison. */
export function comparePicker(page: Page, side: 'base' | 'head') {
  return page.getByRole('button', { name: side === 'base' ? /^From/ : /^To/ });
}

/** The button that actually runs the chosen comparison. */
export function compareRun(page: Page) {
  return page.getByRole('button', { name: /^(Compare|Comparing)/ });
}

/** The sentence stating how the two points relate. */
export function compareRelation(page: Page) {
  return page.locator('[class*="relationSentence"]');
}

/** The subject line of the commit under the playhead. */
export function commitSubject(page: Page) {
  return page.locator('#selected-commit-subject');
}

/**
 * Opens the comparison from the replay and waits for the default pair to load.
 *
 * The default is the step before the current commit and the current commit, so
 * it is available without waiting for tags.
 */
export async function openCompare(page: Page): Promise<void> {
  await viewTab(page, 'Compare').click();
  await expect(page.getByRole('heading', { level: 2, name: 'Compare two points' })).toBeVisible();
}

/**
 * Waits until the repository's tags have arrived.
 *
 * They load in the background, so a test that depends on them has to wait for
 * the evidence they landed: the tag appearing in the endpoint selector.
 */
export async function waitForTags(page: Page, tagName: string): Promise<void> {
  await viewTab(page, 'Insights').click();
  await expect(page.getByText(`Tagged ${tagName}`).first()).toBeVisible();
  await viewTab(page, 'Replay').click();
}

/**
 * Clicks one of the global actions, reaching through the narrow-screen menu.
 *
 * Below 768px the three global actions move into a menu rather than shrinking
 * their labels, so a test that wants "Change repository" has to go the way a
 * visitor on a phone would.
 */
export async function globalAction(page: Page, name: string | RegExp): Promise<void> {
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name }).click();
}

/**
 * Brings the theme control on screen and hands it to the caller.
 *
 * On a narrow screen it lives in the menu, which has to stay open while the
 * radios are inspected.
 */
export async function withThemeControl(
  page: Page,
  body: () => Promise<void>,
): Promise<void> {
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  const compact = await menu.isVisible();
  if (compact) await menu.click();
  await body();
  if (compact) {
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
}

/**
 * The honest range label under the player.
 *
 * Always on screen, unlike the history list's own count, which lives in a
 * drawer on a narrow screen.
 */
export function playableRange(page: Page) {
  return page.locator('[class*="rangeLabel"]');
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

/**
 * Fails if the page links to any GitHub location other than this project.
 *
 * A live repository legitimately links to itself, so pass its slug to allow it.
 */
export async function expectNoForeignGitHubLinks(page: Page, allowSlug?: string): Promise<void> {
  const hrefs = await page.evaluate(() =>
    [...document.querySelectorAll('a[href]')].map((anchor) => (anchor as HTMLAnchorElement).href),
  );
  const allowed = [...ALLOWED_GITHUB_LINKS, ...(allowSlug ? [`https://github.com/${allowSlug}`] : [])];
  for (const href of hrefs) {
    if (!href.includes('github.com')) continue;
    expect(
      allowed.some((prefix) => href.startsWith(prefix)),
      `unexpected GitHub link: ${href}`,
    ).toBe(true);
  }
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

/**
 * On a desktop-sized window the frame is pinned and only a view scrolls, so the
 * document itself must be exactly the height of the viewport.
 *
 * Worth asserting rather than assuming: an absolutely positioned descendant is
 * only clipped by an ancestor's `overflow` when that ancestor is positioned, so
 * one static wrapper is enough to let a 1px screen-reader label extend the page
 * by however far down a list it happens to sit.
 */
export async function expectNoPageScroll(page: Page, where: string): Promise<void> {
  const box = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
  }));
  expect(box.scrollHeight, `the document must not scroll vertically (${where})`).toBeLessThanOrEqual(
    box.clientHeight + 1,
  );
}

/** The control that gives the reading area the whole stage. */
export function expandToggle(page: Page) {
  return page.getByRole('button', { name: /^(Expand|Collapse)$/ });
}

/**
 * How much of the window the file tree actually gets, as a fraction.
 *
 * The number the interface is really judged on: everything above it is chrome,
 * and chrome is not what anybody opened the application to read.
 */
export async function readingShare(page: Page): Promise<number> {
  return page.evaluate(() => {
    const body = document.querySelector('[class*="tree-panel"][class*="__body"]');
    if (!body) return 0;
    return body.getBoundingClientRect().height / document.documentElement.clientHeight;
  });
}

/** Counts requests that left for GitHub, which for the demo must always be none. */
export function watchGitHub(page: Page): string[] {
  const calls: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).hostname.includes('github')) calls.push(request.url());
  });
  return calls;
}

/** Counts requests to this application's own GitHub-proxy routes. */
export function watchApi(page: Page): string[] {
  const calls: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/gh/')) calls.push(request.url());
  });
  return calls;
}
