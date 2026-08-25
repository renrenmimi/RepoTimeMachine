import { expect, test } from '@playwright/test';
import {
  appAlert,
  builtinBadge,
  collectProblems,
  demoButton,
  expectNoHorizontalOverflow,
  landingInput,
  landingLoadButton,
  openRepo,
  quotaMeter,
  REMOVED_PERSONAL_REPOS,
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

  test('offers exactly one built-in demo, not a list of projects', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 2, name: 'Learning Platform' })).toBeVisible();
    await expect(demoButton(page)).toBeVisible();
    await expect(page.getByText(/curated, synthetic history/)).toBeVisible();
    await expect(page.getByText(/16 commits · no GitHub account · 0 API requests/)).toBeVisible();

    // One H1 on the page, and the demo is a section under it.
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  });

  test('names no personal repository anywhere in the interface', async ({ page }) => {
    for (const path of ['/', repoUrl(REPOS.demo), repoUrl(REPOS.medium)]) {
      await page.goto(path);
      await page.waitForTimeout(1200);
      const text = await page.evaluate(() => document.body.innerText);
      const html = await page.content();
      for (const name of REMOVED_PERSONAL_REPOS) {
        expect(text, `${name} in text of ${path}`).not.toContain(name);
        expect(html, `${name} in markup of ${path}`).not.toContain(name);
      }
    }
  });

  test('loads the built-in demo in one action, with no GitHub request', async ({ page }) => {
    const githubCalls: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.hostname.includes('github')) githubCalls.push(request.url());
    });

    await page.goto('/');
    await demoButton(page).click();

    await expect(page.getByRole('slider', { name: /Commit position/ })).toBeVisible();
    await expect(page.getByText('full history — 16 commits')).toBeVisible();
    await expect(builtinBadge(page)).toContainText('Built-in demo');
    await expect(builtinBadge(page)).toContainText('0 GitHub requests');
    expect(githubCalls).toEqual([]);
  });

  test('does not show a GitHub quota meter for built-in data', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await expect(builtinBadge(page)).toBeVisible();
    await expect(quotaMeter(page)).toHaveCount(0);

    // A live repository still reports its quota honestly.
    await openRepo(page, REPOS.medium);
    await expect(quotaMeter(page)).toHaveCount(1);
    await expect(builtinBadge(page)).toHaveCount(0);
  });

  test('offers no "view on GitHub" affordance for a built-in commit', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await page.waitForTimeout(1200);
    await expect(page.locator('a[href*="/commit/"]')).toHaveCount(0);
    await expect(page.locator('main a[href*="github.com"]')).toHaveCount(0);
    await expect(page.getByText(/curated, synthetic history/).first()).toBeVisible();
  });

  test('distinguishes built-in from live without relying on colour', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    // A glyph and words, not a hue.
    await expect(builtinBadge(page).locator('svg')).toHaveCount(1);
    await expect(page.getByText('Learning Platform', { exact: true }).first()).toBeVisible();

    await openRepo(page, REPOS.medium);
    await expect(page.getByText('Live repository')).toBeVisible();
    await expect(page.getByText(/Read from GitHub/)).toBeVisible();
  });

  test('does not autoplay on arrival', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await expect(page.getByRole('button', { name: 'Play history' })).toBeVisible();
    const before = await page.getByRole('slider', { name: /Commit position/ }).inputValue();
    await page.waitForTimeout(1500);
    expect(await page.getByRole('slider', { name: /Commit position/ }).inputValue()).toBe(before);
  });

  test('starts on the newest commit of the loaded range', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    const slider = page.getByRole('slider', { name: /Commit position/ });
    expect(await slider.inputValue()).toBe('15');
    await expect(page.getByText('full history — 16 commits')).toBeVisible();
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
    await expect(page).toHaveURL(/repo=rtm-fixtures%2Fsample-app/);
  });

  test('uses a neutral placeholder and a neutral validation example', async ({ page }) => {
    await page.goto('/');
    await expect(landingInput(page)).toHaveAttribute('placeholder', 'owner/repository');

    await landingInput(page).fill('not-a-repo');
    await landingLoadButton(page).click();
    const message = await appAlert(page).innerText();
    for (const name of REMOVED_PERSONAL_REPOS) {
      expect(message).not.toContain(name);
    }
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

  test('a rate-limited repository offers the built-in demo, and says it is a substitution', async ({ page }) => {
    await page.goto(repoUrl(REPOS.rateLimited));
    await expect(appAlert(page)).toContainText(/rate limit/i);
    await expect(page.getByText(/not the repository you asked for/)).toBeVisible();

    await page.getByRole('button', { name: 'Open the built-in demo' }).click();
    await expect(page.getByRole('slider', { name: /Commit position/ })).toBeVisible();
    await expect(builtinBadge(page)).toContainText('Built-in demo');
    await expect(page.getByText('full history — 16 commits')).toBeVisible();
  });

  test('treats an unknown demo reference as an ordinary missing repository', async ({ page }) => {
    await page.goto(repoUrl(REPOS.unknownDemo));
    await expect(appAlert(page)).toContainText(/could not be found/);
    await expect(page.getByRole('slider', { name: /Commit position/ })).toHaveCount(0);
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
    await openRepo(page, REPOS.demo);
    await page.getByRole('button', { name: 'Start over' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe('layout', () => {
  test('does not overflow sideways at 360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await openRepo(page, REPOS.demo);
    await expectNoHorizontalOverflow(page);

    // Also with a patch open, which is the widest content in the app.
    await page.locator('[class*="fileButton"]').first().click();
    await expectNoHorizontalOverflow(page);
  });

  test('does not overflow sideways on the landing screen at 360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto('/');
    await expectNoHorizontalOverflow(page);
  });

  test('puts the commit detail first on a narrow screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openRepo(page, REPOS.demo);

    const commitTop = await page.locator('section', { has: page.getByRole('heading', { name: 'Commit' }) }).first().evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    const treeTop = await page.locator('section', { has: page.getByRole('heading', { name: 'Working tree' }) }).first().evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    expect(commitTop).toBeLessThan(treeTop);
  });

  test('reports no console errors while browsing a repository', async ({ page }) => {
    const problems = collectProblems(page);
    await openRepo(page, REPOS.demo);
    await page.getByRole('slider', { name: /Commit position/ }).fill('8');
    await page.waitForTimeout(800);
    await page.getByRole('tab', { name: 'Milestones' }).click();
    await page.getByRole('tab', { name: 'Commits' }).click();
    await page.waitForTimeout(300);
    expect(problems).toEqual([]);
  });
});
