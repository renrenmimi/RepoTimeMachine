import { expect, test } from '@playwright/test';
import {
  appAlert,
  builtinBadge,
  collectProblems,
  commitSubject,
  demoButton,
  expectNoForeignGitHubLinks,
  expectNoHorizontalOverflow,
  landingInput,
  landingLoadButton,
  liveBadge,
  globalAction,
  playableRange,
  withThemeControl,
  openRepo,
  quotaMeter,
  REPOS,
  repoUrl,
  subTab,
  viewTab,
  watchApi,
  watchGitHub,
} from './helpers';

test.describe('the home screen', () => {
  test('says what this is and offers two ways in, before any GitHub request', async ({ page }) => {
    const problems = collectProblems(page);
    const api = watchApi(page);

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('See how a repository took shape.');
    await expect(page.getByText(/Step through commits, inspect file changes, and compare two points/)).toBeVisible();

    // One button to start, one field to bring your own.
    await expect(demoButton(page)).toBeVisible();
    await expect(landingLoadButton(page)).toBeVisible();

    expect(api, 'the home screen must not need GitHub').toEqual([]);
    expect(problems).toEqual([]);
  });

  test('offers exactly one demo, and says it is synthetic', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByText('16 synthetic commits · 0 GitHub requests')).toBeVisible();
    await expect(page.getByText(/Synthetic data written for this application/)).toBeVisible();
    await expect(page.getByText(/not anybody’s repository/)).toBeVisible();

    // One H1 on the page, and the two entries are sections under it.
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(demoButton(page)).toHaveCount(1);
  });

  test('states the initial load range without listing every limit', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/latest 300 commits load first/)).toBeVisible();
    await expect(page.getByText(/Public repositories only, on the default branch/)).toBeVisible();
    // The detail is a click away rather than in the way.
    await expect(page.getByText(/60 requests an hour/)).toHaveCount(0);
  });

  test('explains the detail on request, from the home screen', async ({ page }) => {
    await page.goto('/');
    await page.locator('main').getByRole('button', { name: 'How it works' }).click();

    const dialog = page.getByRole('dialog', { name: 'How it works' });
    await expect(dialog).toBeVisible();
    // The real, configured numbers.
    await expect(dialog.getByText(/latest 300 commits load automatically/)).toBeVisible();
    await expect(dialog.getByText(/adds 100 more, up to 1,000/)).toBeVisible();
    await expect(dialog.getByText(/60 requests an hour per IP address/)).toBeVisible();
    await expect(dialog.getByText(/nowhere to paste a personal token/)).toBeVisible();
  });

  test('links to no GitHub repository other than this project', async ({ page }) => {
    await page.goto('/');
    await expectNoForeignGitHubLinks(page);

    await openRepo(page, REPOS.demo);
    await page.waitForTimeout(1200);
    await expectNoForeignGitHubLinks(page);

    // A live repository may link to itself, and to nothing else.
    await openRepo(page, REPOS.medium);
    await page.waitForTimeout(1200);
    await expectNoForeignGitHubLinks(page, REPOS.medium);
  });

  test('offers no repository as an example in the input or its errors', async ({ page }) => {
    await page.goto('/');
    // The placeholder is the generic form, not somebody's repository.
    await expect(landingInput(page)).toHaveAttribute('placeholder', 'owner/repository');

    await landingInput(page).fill('not-a-repo');
    await landingLoadButton(page).click();
    const message = await appAlert(page).innerText();
    expect(message).toContain('owner/repository');
    expect(message).not.toMatch(/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+/);
  });

  test('loads the demo in one action, with no GitHub request', async ({ page }) => {
    const github = watchGitHub(page);

    await page.goto('/');
    await demoButton(page).click();

    await expect(page.getByRole('slider', { name: /Commit position/ })).toBeVisible();
    await expect(playableRange(page)).toHaveText('the whole history, 16 commits');
    await expect(builtinBadge(page)).toContainText('Built-in demo');
    await expect(builtinBadge(page)).toContainText('0 GitHub requests');
    expect(github).toEqual([]);
  });
});

test.describe('starting position', () => {
  test('opens on the first commit of the loaded range, paused', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    const slider = page.getByRole('slider', { name: /Commit position/ });

    // The point of the tool is stepping forward from the beginning.
    expect(await slider.inputValue()).toBe('0');
    await expect(page.locator('#replay-position')).toContainText('Commit 1 of 16');
    await expect(page.getByRole('button', { name: 'Play history' })).toBeVisible();
  });

  test('does not autoplay on arrival', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    const before = await page.getByRole('slider', { name: /Commit position/ }).inputValue();
    await page.waitForTimeout(1500);
    expect(await page.getByRole('slider', { name: /Commit position/ }).inputValue()).toBe(before);
  });

  test('an explicit commit link beats the default', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await page.getByRole('slider', { name: /Commit position/ }).fill('11');
    await page.waitForTimeout(400);
    const sha = new URL(page.url()).searchParams.get('c')!;

    await page.goto(repoUrl(REPOS.demo, sha));
    await expect(page.getByRole('slider', { name: /Commit position/ })).toHaveValue('11');
  });

  test('offers one click to the newest commit', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await page.getByRole('button', { name: 'Latest' }).click();
    await expect(page.getByRole('slider', { name: /Commit position/ })).toHaveValue('15');
    await expect(page.getByRole('button', { name: 'Latest' })).toBeDisabled();
  });

  test('says the earliest loaded commit may not be the first one', async ({ page }) => {
    await openRepo(page, REPOS.big);
    // The player says the track does not start at the beginning.
    await expect(playableRange(page)).toHaveText('part of the history, 300 of 640 commits');

    await viewTab(page, 'Insights').click();
    await expect(page.getByText(/earliest of them is not the repository's first commit/)).toBeVisible();
  });
});

test.describe('source and quota', () => {
  test('does not claim a live source before one is confirmed', async ({ page }) => {
    // Recorded while the first request is still in flight.
    const seen: string[] = [];
    await page.route('**/api/gh/repo**', async (route) => {
      seen.push('repo');
      await new Promise((resolve) => setTimeout(resolve, 900));
      await route.continue();
    });

    await page.goto(repoUrl(REPOS.medium));
    // Before the answer arrives it says so, rather than announcing GitHub.
    await expect(page.getByText('Loading source…')).toBeVisible();
    await expect(liveBadge(page)).toHaveCount(0);

    await expect(page.getByRole('slider', { name: /Commit position/ })).toBeVisible();
    await expect(liveBadge(page)).toBeVisible();
    expect(seen.length).toBeGreaterThan(0);
  });

  test('shows no GitHub quota for built-in data', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await expect(builtinBadge(page)).toBeVisible();
    await expect(quotaMeter(page)).toHaveCount(0);

    // A live repository still reports its quota honestly.
    await openRepo(page, REPOS.medium);
    await expect(quotaMeter(page)).toHaveCount(1);
    await expect(builtinBadge(page)).toHaveCount(0);
  });

  test('says the quota is unknown rather than zero', async ({ page }) => {
    await openRepo(page, REPOS.medium);
    await quotaMeter(page).click();
    const panel = page.locator('[class*="usagePanel"]');
    await expect(panel).toBeVisible();
    // Either a real reading, or the word — never a bare 0.
    await expect(panel).toContainText(/Remaining|remaining quota is unknown/);
    await expect(panel).not.toContainText(/\b0 of\b/);
    // Which limit applies is stated either way.
    await expect(panel).toContainText(/no server-side token, so GitHub allows 60 requests an hour/);
  });

  test('never dates an unknown reading "just now"', async ({ page }) => {
    await openRepo(page, REPOS.medium);
    await quotaMeter(page).click();
    const panel = page.locator('[class*="usagePanel"]');
    // With no observed response there is no reading to date, and it says so.
    await expect(panel).toContainText(/unknown — not zero/);
    await expect(panel).not.toContainText(/just now|Moments ago/);
  });

  test('offers no way to paste a personal token', async ({ page }) => {
    await openRepo(page, REPOS.medium);
    await quotaMeter(page).click();
    const inputs = await page.locator('input[type="password"], input[name*="token" i]').count();
    expect(inputs).toBe(0);
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
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Learning Platform');

    await openRepo(page, REPOS.medium);
    await expect(liveBadge(page)).toContainText('Live GitHub');
    await expect(quotaMeter(page)).toBeVisible();
  });
});

test.describe('the shell', () => {
  test('keeps the chrome above the content inside its budget', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openRepo(page, REPOS.demo);

    const top = await page
      .locator('[class*="viewTabs"]')
      .evaluate((element) => element.getBoundingClientRect().bottom);
    // The bar, the title row and the view tabs. The rest belongs to the repository.
    expect(top).toBeLessThanOrEqual(160);
  });

  test('shows the player and the repository together at 1280x720', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openRepo(page, REPOS.demo);
    await page.waitForTimeout(1200);

    const slider = await page.getByRole('slider', { name: /Commit position/ }).boundingBox();
    const tree = await page.locator('[role="treeitem"]').first().boundingBox();
    expect(slider, 'the player must be on screen').not.toBeNull();
    expect(tree, 'the repository must be on screen with it').not.toBeNull();
    expect(tree!.y).toBeGreaterThan(slider!.y);
    expect(tree!.y).toBeLessThan(720);
  });

  test('names the current task in the skip link', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await expect(page.getByRole('link', { name: /Skip to the commit and its changes/ })).toBeAttached();

    await viewTab(page, 'Compare').click();
    await expect(page.getByRole('link', { name: /Skip to the comparison/ })).toBeAttached();

    await viewTab(page, 'Insights').click();
    await expect(page.getByRole('link', { name: /Skip to the insights/ })).toBeAttached();
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
    await expect(page.getByRole('link', { name: /^Skip to/ })).toBeFocused();

    // Tab through a good number of controls; focus must keep moving.
    const seen = new Set<string>();
    for (let i = 0; i < 30; i += 1) {
      await page.keyboard.press('Tab');
      seen.add(await page.evaluate(() => document.activeElement?.outerHTML?.slice(0, 60) ?? 'none'));
    }
    expect(seen.size).toBeGreaterThan(6);
  });

  test('no repository field is permanently parked in the chrome', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    // The workspace is for the repository, not for the field that opened it.
    await expect(page.getByRole('textbox', { name: /Open a public repository/ })).toHaveCount(0);

    await globalAction(page, 'Change repository');
    await expect(page.getByRole('textbox', { name: /Open a public repository/ })).toBeVisible();
  });

  test('cancelling a repository change leaves everything as it was', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await page.getByRole('slider', { name: /Commit position/ }).fill('7');
    await page.waitForTimeout(500);
    const subject = await commitSubject(page).textContent();
    const url = page.url();

    await globalAction(page, 'Change repository');
    const field = page.getByRole('textbox', { name: /Open a public repository/ });
    await field.fill('someone/else');
    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(commitSubject(page)).toHaveText(subject ?? '');
    await expect(builtinBadge(page)).toBeVisible();
    expect(page.url()).toBe(url);
  });

  test('lets the visitor start over from the home screen', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await globalAction(page, 'Change repository');
    await page.getByRole('button', { name: /Start over from the home screen/ }).click();

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('See how a repository took shape.');
    await expect(page).toHaveURL(/\/$/);
  });

  test('exposes complete metadata and a favicon', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Repo Time Machine');
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /Step through the commits/i);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'Repo Time Machine');
    await expect(page.locator('meta[property="og:image"]')).toHaveCount(1);
    await expect(page.locator('link[rel="icon"]')).toHaveCount(1);

    const icon = await page.request.get('/icon.svg');
    expect(icon.ok()).toBe(true);
  });
});

test.describe('theme', () => {
  test('defaults to light for a visitor with no stored preference', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    const background = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg-page').trim(),
    );
    expect(background.toLowerCase()).toBe('#f6f7f5');
  });

  test('follows the system when asked to, with no attribute of its own', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await withThemeControl(page, async () => {
      await expect(page.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true');
    });
    expect(await page.evaluate(() => document.documentElement.hasAttribute('data-theme'))).toBe(false);

    const background = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg-page').trim(),
    );
    expect(background.toLowerCase()).toBe('#111714');
  });

  test('remembers an explicit choice across a reload, with no flash', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    await withThemeControl(page, async () => {
      await page.getByRole('radio', { name: 'Dark' }).click();
    });
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark');

    await page.reload();
    // Set before the first paint, so the light palette never appears.
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark');
    await withThemeControl(page, async () => {
      await expect(page.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
    });
  });

  test('changing the theme loads nothing', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await page.waitForTimeout(1800);

    const api = watchApi(page);
    const subject = await commitSubject(page).textContent();
    await withThemeControl(page, async () => {
      await page.getByRole('radio', { name: 'Dark' }).click();
      await page.getByRole('radio', { name: 'Light' }).click();
    });
    await page.waitForTimeout(400);

    expect(api, 'a theme change is not a data change').toEqual([]);
    await expect(commitSubject(page)).toHaveText(subject ?? '');
  });

  test('implements dark as its own palette, not an inversion', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openRepo(page, REPOS.demo);
    const tokens = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return {
        page: style.getPropertyValue('--bg-page').trim(),
        surface: style.getPropertyValue('--bg-surface').trim(),
        text: style.getPropertyValue('--text-primary').trim(),
      };
    });
    // A hand-built dark palette: the surface is lighter than the page, which a
    // straight inversion of the light theme would get backwards.
    expect(tokens.page.toLowerCase()).toBe('#111714');
    expect(tokens.surface.toLowerCase()).toBe('#19211d');
    expect(tokens.text.toLowerCase()).toBe('#e8eee9');
  });
});

test.describe('states', () => {
  test('does not claim a repository is absent when it may be private', async ({ page }) => {
    await page.goto(repoUrl(REPOS.missing));
    await expect(page.getByRole('heading', { name: 'Repository not found, or private' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();

    await page.getByText('What exactly happened').click();
    await expect(page.getByText(/answers the same way for a repository that does not exist and one that is private/)).toBeVisible();
  });

  test('treats a private repository the same way, and says why', async ({ page }) => {
    await page.goto(repoUrl(REPOS.private));
    await expect(appAlert(page)).toContainText(/private/);
    await page.getByText('What exactly happened').click();
    await expect(page.getByText(/Private repositories are not supported/)).toBeVisible();
  });

  test('explains a rate limit and when it resets', async ({ page }) => {
    await page.goto(repoUrl(REPOS.rateLimited));
    await expect(page.getByRole('heading', { name: 'GitHub rate limit reached' })).toBeVisible();
    await expect(appAlert(page)).toContainText(/rate-limit window resets/);

    await page.getByText('What exactly happened').click();
    await expect(page.getByText(/60 requests per hour/)).toBeVisible();
  });

  test('a rate-limited repository offers the demo, and says it is a substitution', async ({ page }) => {
    await page.goto(repoUrl(REPOS.rateLimited));
    await expect(appAlert(page)).toContainText(/rate limit/i);
    await expect(page.getByText(/not the repository you asked for/)).toBeVisible();

    await page.getByRole('button', { name: 'Explore the built-in demo' }).click();
    await expect(page.getByRole('slider', { name: /Commit position/ })).toBeVisible();

    // Title, source and URL all move together; nothing is silently substituted.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Learning Platform');
    await expect(builtinBadge(page)).toContainText('Built-in demo');
    await expect(page).toHaveURL(/repo=demo%2Flearning-platform/);
    await expect(playableRange(page)).toHaveText('the whole history, 16 commits');
  });

  test('treats an unknown demo reference as an ordinary missing repository', async ({ page }) => {
    const github = watchGitHub(page);

    await page.goto(repoUrl(REPOS.unknownDemo));
    await expect(appAlert(page)).toContainText(/not a repository/);
    await expect(page.getByRole('slider', { name: /Commit position/ })).toHaveCount(0);
    // It offers the demo as a choice rather than silently becoming it.
    await expect(page.getByRole('button', { name: 'Explore the built-in demo' })).toBeVisible();
    await expect(builtinBadge(page)).toHaveCount(0);
    expect(github).toEqual([]);
  });

  test('explains an empty repository', async ({ page }) => {
    await page.goto(repoUrl(REPOS.empty));
    await expect(page.getByRole('heading', { name: /Nothing to play back yet/ })).toBeVisible();
    await expect(page.getByRole('slider', { name: /Commit position/ })).toHaveCount(0);
  });

  test('handles a repository with exactly one commit', async ({ page }) => {
    await openRepo(page, REPOS.one);
    await expect(playableRange(page)).toHaveText('the whole history, 1 commit');
    await expect(page.getByRole('button', { name: 'Play history' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Next commit' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Previous commit' })).toBeDisabled();
    // Disabled, and explained.
    await expect(page.getByText(/one commit in this range/)).toBeVisible();
    await expect(commitSubject(page)).toContainText('Initial commit');
  });
});

test.describe('layout', () => {
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
    { width: 360, height: 800 },
  ]) {
    test(`does not overflow sideways at ${size.width}px`, async ({ page }) => {
      await page.setViewportSize(size);

      await page.goto('/');
      await expectNoHorizontalOverflow(page);

      await openRepo(page, REPOS.demo);
      await page.waitForTimeout(900);
      await expectNoHorizontalOverflow(page);

      // With a patch open, which is the widest content in the application.
      await subTab(page, 'Changes').click();
      await page.locator('[class*="fileButton"]').first().click();
      await expectNoHorizontalOverflow(page);

      await viewTab(page, 'Compare').click();
      await page.waitForTimeout(1200);
      await expectNoHorizontalOverflow(page);

      await viewTab(page, 'Insights').click();
      await page.waitForTimeout(900);
      await expectNoHorizontalOverflow(page);
    });
  }

  test('scrolls a long diff line in its own box, not the page', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await page.waitForTimeout(1500);
    await subTab(page, 'Changes').click();
    await page.locator('[class*="fileButton"]').first().click();

    const box = page.locator('[aria-label^="Diff for"]').first();
    await expect(box).toBeVisible();
    const overflow = await box.evaluate((element) => getComputedStyle(element).overflow);
    expect(overflow).toContain('auto');
    await expectNoHorizontalOverflow(page);
  });

  test('opens the history in a drawer on a narrow screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openRepo(page, REPOS.demo);

    // The column is gone; a named button takes its place.
    await expect(page.locator('[aria-label="Commit history"]')).toHaveCount(0);
    await page.getByRole('button', { name: /^History/ }).click();

    const drawer = page.getByRole('dialog', { name: 'History' });
    await expect(drawer).toBeVisible();

    // Choosing a commit returns to the main content.
    await drawer.locator('[class*="itemSubject"]').nth(4).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('slider', { name: /Commit position/ })).toHaveValue('4');
    // The position is still visible after the drawer closes.
    await expect(page.locator('#replay-position')).toContainText('Commit 5 of 16');
  });

  test('the drawer closes on Escape and returns focus to its trigger', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openRepo(page, REPOS.demo);

    const trigger = page.getByRole('button', { name: /^History/ });
    await trigger.click();
    await expect(page.getByRole('dialog', { name: 'History' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  /*
   * 200% browser zoom on a 1440x900 screen leaves about 720x450 CSS pixels, and
   * 320% leaves about 640x400. Nothing may be cut off or become unreachable at
   * either — which is what makes zoom a usable accommodation rather than a
   * different, worse application.
   */
  for (const size of [
    { width: 720, height: 450, zoom: '200%' },
    { width: 640, height: 400, zoom: '320%' },
  ]) {
    test(`stays usable at the equivalent of ${size.zoom} zoom`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await openRepo(page, REPOS.demo);
      await page.waitForTimeout(900);

      // The commit, the player and the way into the history are all still there.
      await expect(page.locator('#replay-position')).toBeVisible();
      await expect(commitSubject(page)).toBeVisible();
      await expect(page.getByRole('slider', { name: /Commit position/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /^History/ })).toBeVisible();
      await expect(viewTab(page, 'Compare')).toBeVisible();
      await expectNoHorizontalOverflow(page);

      await subTab(page, 'Changes').click();
      await page.locator('[class*="fileButton"]').first().click();
      await expectNoHorizontalOverflow(page);

      await viewTab(page, 'Compare').click();
      await page.waitForTimeout(1400);
      await expectNoHorizontalOverflow(page);

      // The statistics table is the one thing allowed its own sideways scroll,
      // and it must take it without dragging the document with it.
      await page.getByRole('tab', { name: 'Repository stats' }).click();
      await expect(page.getByRole('rowheader', { name: 'Files tracked' })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });
  }

  test('reports no console errors while browsing a repository', async ({ page }) => {
    const problems = collectProblems(page);
    await openRepo(page, REPOS.demo);
    await page.getByRole('slider', { name: /Commit position/ }).fill('8');
    await page.waitForTimeout(800);
    await subTab(page, 'Changes').click();
    await viewTab(page, 'Insights').click();
    await page.waitForTimeout(400);
    await viewTab(page, 'Compare').click();
    await page.waitForTimeout(1200);
    await viewTab(page, 'Replay').click();
    await page.waitForTimeout(300);
    expect(problems).toEqual([]);
  });
});

test.describe('document structure', () => {
  test('has exactly one H1 in every state', async ({ page }) => {
    for (const path of ['/', repoUrl(REPOS.demo), repoUrl(REPOS.medium), repoUrl(REPOS.missing)]) {
      await page.goto(path);
      await page.waitForTimeout(1200);
      await expect(page.getByRole('heading', { level: 1 }), path).toHaveCount(1);
    }
  });

  test('the H1 is visible and names what is open', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText('Learning Platform');

    await openRepo(page, REPOS.medium);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('rtm-fixtures/sample-app');
  });

  test('the heading stays put across the three views', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    const box = await page.getByRole('heading', { level: 1 }).boundingBox();

    for (const view of ['Compare', 'Insights', 'Replay'] as const) {
      await viewTab(page, view).click();
      await page.waitForTimeout(600);
      const next = await page.getByRole('heading', { level: 1 }).boundingBox();
      expect(next!.y, `${view} moved the heading`).toBeCloseTo(box!.y, 0);
      expect(next!.x, `${view} moved the heading`).toBeCloseTo(box!.x, 0);
    }
  });
});
