import { expect, test } from '@playwright/test';
import {
  appAlert,
  collectProblems,
  expectNoHorizontalOverflow,
  landingInput,
  landingLoadButton,
  openRepo,
  REPOS,
  repoUrl,
} from './helpers';

test.describe('initial shell', () => {
  test('renders the landing screen before any GitHub request', async ({ page }) => {
    const problems = collectProblems(page);

    // No API traffic may be needed to paint the shell.
    let apiCalls = 0;
    page.on('request', (request) => {
      if (request.url().includes('/api/gh/')) apiCalls += 1;
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Watch a repository grow');
    await expect(landingLoadButton(page)).toBeVisible();
    expect(apiCalls, 'the landing screen must not need GitHub').toBe(0);
    expect(problems).toEqual([]);
  });

  test('offers one-click demos', async ({ page }) => {
    await page.goto('/');
    for (const label of ['renren-across-tabs', 'DataData', 'DrillLab', 'PetNote']) {
      await expect(page.getByRole('button', { name: new RegExp(label) }).first()).toBeVisible();
    }
  });

  test('does not autoplay on arrival', async ({ page }) => {
    await openRepo(page, REPOS.medium);
    await expect(page.getByRole('button', { name: 'Play history' })).toBeVisible();
    const before = await page.getByRole('slider', { name: /Commit position/ }).inputValue();
    await page.waitForTimeout(1500);
    expect(await page.getByRole('slider', { name: /Commit position/ }).inputValue()).toBe(before);
  });

  test('starts on the newest commit of the loaded range', async ({ page }) => {
    await openRepo(page, REPOS.medium);
    const slider = page.getByRole('slider', { name: /Commit position/ });
    expect(await slider.inputValue()).toBe('63');
    await expect(page.getByText('full history — 64 commits')).toBeVisible();
  });

  test('has a working skip link and does not trap focus', async ({ page }) => {
    await openRepo(page, REPOS.tiny);
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      document.body.setAttribute('tabindex', '-1');
      document.body.focus();
      document.body.removeAttribute('tabindex');
    });
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: /Skip to the timeline/ })).toBeFocused();

    // Tab through a good number of controls; focus must keep moving.
    const seen = new Set<string>();
    for (let i = 0; i < 30; i += 1) {
      await page.keyboard.press('Tab');
      seen.add(await page.evaluate(() => document.activeElement?.outerHTML?.slice(0, 60) ?? 'none'));
    }
    expect(seen.size).toBeGreaterThan(6);
  });

  test('exposes complete metadata and a favicon', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Repo Time Machine');
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /playable timeline/i);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'Repo Time Machine');
    await expect(page.locator('meta[property="og:image"]')).toHaveCount(1);
    await expect(page.locator('link[rel="icon"]')).toHaveCount(1);

    const icon = await page.request.get('/icon.svg');
    expect(icon.ok()).toBe(true);
  });
});

test.describe('repository input', () => {
  test('rejects a non-GitHub host without making a request', async ({ page }) => {
    let apiCalls = 0;
    page.on('request', (request) => {
      if (request.url().includes('/api/gh/')) apiCalls += 1;
    });

    await page.goto('/');
    await landingInput(page).fill('https://gitlab.com/owner/repo');
    await landingLoadButton(page).click();

    await expect(appAlert(page)).toContainText(/Only github.com repositories/);
    expect(apiCalls).toBe(0);
  });

  test('rejects a malformed name', async ({ page }) => {
    await page.goto('/');
    await landingInput(page).fill('not-a-repo');
    await landingLoadButton(page).click();
    await expect(appAlert(page)).toContainText(/owner\/repository/);
  });

  test('accepts a full GitHub URL', async ({ page }) => {
    await page.goto('/');
    await landingInput(page).fill(`https://github.com/${REPOS.medium}/tree/main/src`);
    await landingLoadButton(page).click();
    await expect(page.getByRole('slider', { name: /Commit position/ })).toBeVisible();
    await expect(page).toHaveURL(/repo=renrenmimi%2FDrillLab/);
  });

  test('loads a demo in one click', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /renren-across-tabs/ }).first().click();
    await expect(page.getByRole('slider', { name: /Commit position/ })).toBeVisible();
    await expect(page.getByText('full history — 5 commits')).toBeVisible();
  });
});

test.describe('states', () => {
  test('explains a repository that does not exist', async ({ page }) => {
    await page.goto(repoUrl(REPOS.missing));
    await expect(appAlert(page)).toContainText(/could not be found/);
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('treats a private repository as not found, and says why', async ({ page }) => {
    await page.goto(repoUrl(REPOS.private));
    await expect(appAlert(page)).toContainText(/private/);
    await expect(page.getByText(/Private repositories are not supported/)).toBeVisible();
  });

  test('explains a rate limit and offers the token hint', async ({ page }) => {
    await page.goto(repoUrl(REPOS.rateLimited));
    await expect(appAlert(page)).toContainText(/rate limit/i);
    await expect(page.getByText(/60 requests per hour/)).toBeVisible();
    await expect(appAlert(page)).toContainText(/rate-limit window resets/);
  });

  test('explains an empty repository', async ({ page }) => {
    await page.goto(repoUrl(REPOS.empty));
    await expect(page.getByRole('heading', { name: /Nothing to play back yet/ })).toBeVisible();
    await expect(page.getByRole('slider', { name: /Commit position/ })).toHaveCount(0);
  });

  test('handles a repository with exactly one commit', async ({ page }) => {
    await openRepo(page, REPOS.one);
    await expect(page.getByText('full history — 1 commit')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Play history' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Next commit' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Previous commit' })).toBeDisabled();
    await expect(page.locator('main').getByRole('heading', { level: 3 }).first()).toContainText('Initial commit');
  });

  test('lets the visitor return to the landing screen', async ({ page }) => {
    await openRepo(page, REPOS.tiny);
    await page.getByRole('button', { name: 'clear' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe('layout', () => {
  test('does not overflow sideways at 360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await openRepo(page, REPOS.medium);
    await expectNoHorizontalOverflow(page);

    // Also with a patch open, which is the widest content in the app.
    await page.getByRole('button', { name: /CLAUDE\.md|\.tsx|\.ts/ }).first().click();
    await expectNoHorizontalOverflow(page);
  });

  test('does not overflow sideways on the landing screen at 360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto('/');
    await expectNoHorizontalOverflow(page);
  });

  test('puts the commit detail first on a narrow screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openRepo(page, REPOS.medium);

    const commitTop = await page.locator('section', { has: page.getByRole('heading', { name: 'Commit' }) }).first().evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    const treeTop = await page.locator('section', { has: page.getByRole('heading', { name: 'Working tree' }) }).first().evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    expect(commitTop).toBeLessThan(treeTop);
  });

  test('reports no console errors while browsing a repository', async ({ page }) => {
    const problems = collectProblems(page);
    await openRepo(page, REPOS.medium);
    await page.getByRole('slider', { name: /Commit position/ }).fill('20');
    await page.waitForTimeout(800);
    await page.getByRole('tab', { name: 'Milestones' }).click();
    await page.getByRole('tab', { name: 'Commits' }).click();
    await page.waitForTimeout(300);
    expect(problems).toEqual([]);
  });
});
