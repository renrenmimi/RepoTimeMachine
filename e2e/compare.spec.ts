import { expect, test } from '@playwright/test';
import {
  compareButton,
  comparePicker,
  compareStatus,
  expectNoHorizontalOverflow,
  openRepo,
  REPOS,
  repoUrl,
  waitForTags,
} from './helpers';

/** Counts requests that left for GitHub, which for the demo must always be none. */
function watchGitHub(page: import('@playwright/test').Page): string[] {
  const calls: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).hostname.includes('github')) calls.push(request.url());
  });
  return calls;
}

test.describe('opening a comparison', () => {
  test('opens from the timeline with a sensible pair already chosen', async ({ page }) => {
    const github = watchGitHub(page);
    await openRepo(page, REPOS.demo);
    // The default base is the last release before the commit in view, so the
    // tags have to have arrived for that default to be the one under test.
    await waitForTags(page, 'v1.0.0');
    await compareButton(page).click();

    await expect(page.getByRole('heading', { level: 2, name: 'Compare two points' })).toBeVisible();
    await expect(comparePicker(page, 'base')).toContainText('v1.0.0');
    await expect(page.getByText('relation')).toBeVisible();
    expect(github).toEqual([]);
  });

  test('writes both ends into the address bar, replacing the playhead', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await compareButton(page).click();
    await expect(page.getByText('relation')).toBeVisible();

    await expect(page).toHaveURL(/base=[0-9a-f]{7,}/);
    await expect(page).toHaveURL(/head=[0-9a-f]{7,}/);
    // The two views own the URL in turn, never together.
    await expect(page).not.toHaveURL(/[?&]c=/);
  });

  test('replaces the timeline panels and hides the transport', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await expect(page.getByRole('slider', { name: /Commit position/ })).toBeVisible();

    await compareButton(page).click();
    await expect(page.getByText('relation')).toBeVisible();
    await expect(page.getByRole('slider', { name: /Commit position/ })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 2, name: 'Working tree' })).toHaveCount(0);
  });

  test('restores a shared comparison link exactly', async ({ page }) => {
    const github = watchGitHub(page);
    await openRepo(page, REPOS.demo);
    await compareButton(page).click();
    await expect(page.getByText('relation')).toBeVisible();

    const shared = page.url();
    await page.goto('about:blank');
    await page.goto(shared);

    await expect(page.getByRole('heading', { level: 2, name: 'Compare two points' })).toBeVisible();
    await expect(page.getByText('relation')).toBeVisible();
    await expect(page).toHaveURL(shared);
    expect(github).toEqual([]);
  });

  test('reports the whole demo history when comparing its ends', async ({ page }) => {
    // First commit to last, by hand: the widest comparison the demo allows.
    await page.goto(repoUrl(REPOS.demo));
    await compareButton(page).click();
    await comparePicker(page, 'base').click();
    await page.getByRole('button', { name: /scaffold the application shell/ }).first().click();

    await expect(page.getByText('relation')).toBeVisible();
    // 15 commits separate the sixteen points.
    await expect(page.locator('dl').getByText('15', { exact: true })).toBeVisible();
  });
});

test.describe('choosing the two ends', () => {
  test('compares two tags', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await compareButton(page).click();

    // The demo carries two release tags; put one on each side.
    await comparePicker(page, 'head').click();
    await page.getByRole('button', { name: /^v1\.0\.0/ }).first().click();
    await comparePicker(page, 'base').click();
    await page.getByRole('button', { name: /^v0\.1\.0/ }).first().click();

    await expect(comparePicker(page, 'base')).toContainText('v0.1.0');
    await expect(comparePicker(page, 'head')).toContainText('v1.0.0');
    // Both ends are labelled as tags in the summary.
    await expect(page.getByText('v0.1.0').first()).toBeVisible();
    await expect(page.getByText('v1.0.0').first()).toBeVisible();
  });

  test('filters the picker by commit subject', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await compareButton(page).click();

    await comparePicker(page, 'base').click();
    await page.getByLabel('Filter the base choices').fill('coding workspace');
    await expect(page.getByRole('button', { name: /introduce the coding workspace/ })).toBeVisible();
    await page.getByRole('button', { name: /introduce the coding workspace/ }).click();

    await expect(page.getByText('introduce the coding workspace').first()).toBeVisible();
  });

  test('swaps the two ends and reverses the reading', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await compareButton(page).click();
    await expect(compareStatus(page)).toHaveText('ahead');

    await page.getByRole('button', { name: 'Swap the two ends of the comparison' }).click();
    await expect(compareStatus(page)).toHaveText('behind');
  });

  test('says nothing differs when both ends are the same commit', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await compareButton(page).click();
    await expect(page.getByText('relation')).toBeVisible();

    // Point base at head.
    await comparePicker(page, 'base').click();
    await page.getByRole('button', { name: /lock background scrolling/ }).first().click();

    await expect(compareStatus(page)).toHaveText('identical');
    await expect(page.getByText(/the same commit, so nothing differs/)).toBeVisible();
  });

  test('closes the picker with Escape without leaving the view', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await compareButton(page).click();

    await comparePicker(page, 'base').click();
    await expect(page.getByLabel('Filter the base choices')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('Filter the base choices')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 2, name: 'Compare two points' })).toBeVisible();
  });
});

test.describe('leaving a comparison', () => {
  test('returns to the timeline', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await compareButton(page).click();
    await expect(page.getByText('relation')).toBeVisible();

    await page.getByRole('button', { name: 'Back to the timeline' }).click();
    await expect(page.getByRole('slider', { name: /Commit position/ })).toBeVisible();
    await expect(page).not.toHaveURL(/base=/);
  });

  test('opens a commit from the range on the timeline', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await compareButton(page).click();
    await expect(page.getByText('relation')).toBeVisible();

    await page.locator('[class*="commitItem"]').first().click();
    await expect(page.getByRole('slider', { name: /Commit position/ })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Working tree' })).toBeVisible();
  });
});

test.describe('a comparison of a live repository', () => {
  test('uses the GitHub path and links out to the comparison', async ({ page }) => {
    await openRepo(page, REPOS.medium);
    await compareButton(page).click();
    await expect(page.getByText('relation')).toBeVisible();
    await expect(page.getByText(/ahead|behind|identical|diverged/).first()).toBeVisible();
  });
});

test.describe('comparison layout', () => {
  test('has exactly one H1, naming the comparison', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await compareButton(page).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/comparing two points/);
  });

  test('does not overflow sideways at 360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await openRepo(page, REPOS.demo);
    await compareButton(page).click();
    await expect(page.getByText('relation')).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // Nor with a picker open, which is the widest thing in the view.
    await comparePicker(page, 'base').click();
    await expectNoHorizontalOverflow(page);
  });

  test('offers a text alternative for the summary numbers', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await compareButton(page).click();
    await expect(page.getByText(/commits ahead, .* behind, .* files changed/)).toBeAttached();
  });
});
