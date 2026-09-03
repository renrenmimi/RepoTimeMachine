import { expect, test } from '@playwright/test';
import {
  compareRelation,
  comparePicker,
  compareRun,
  expectNoHorizontalOverflow,
  openCompare,
  openRepo,
  REPOS,
  repoUrl,
  viewTab,
  watchApi,
  watchGitHub,
} from './helpers';

test.describe('opening a comparison', () => {
  test('opens with the step before the current commit already chosen', async ({ page }) => {
    const github = watchGitHub(page);
    await openRepo(page, REPOS.demo);
    await page.getByRole('slider', { name: /Commit position/ }).fill('9');
    await page.waitForTimeout(500);

    await openCompare(page);

    // The comparison somebody stepping through a history most likely wants.
    await expect(comparePicker(page, 'base')).toContainText('#9');
    await expect(comparePicker(page, 'head')).toContainText('#10');
    await expect(compareRelation(page)).toContainText(/is 1 commit ahead of/);
    expect(github).toEqual([]);
  });

  test('opens on the whole loaded range when there is no step before', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    // Arrival is the first commit, which has no predecessor to compare against.
    await openCompare(page);

    await expect(comparePicker(page, 'base')).toContainText('#1');
    await expect(comparePicker(page, 'head')).toContainText('#16');
    // Never a commit compared with itself, which would answer nothing.
    await expect(page.getByText('These are the same commit.')).toHaveCount(0);
    await expect(compareRelation(page)).toContainText(/is 15 commits ahead of/);
  });

  test('names both ends in plain language, with the Git terms as hints', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await openCompare(page);

    await expect(comparePicker(page, 'base')).toContainText('From');
    await expect(comparePicker(page, 'base')).toContainText('base');
    await expect(comparePicker(page, 'head')).toContainText('To');
    await expect(comparePicker(page, 'head')).toContainText('head');
  });

  test('writes both ends into the address bar, replacing the playhead', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await openCompare(page);
    await expect(compareRelation(page)).toBeVisible();

    await expect(page).toHaveURL(/base=[0-9a-f]{7,}/);
    await expect(page).toHaveURL(/head=[0-9a-f]{7,}/);
    // The two views own the URL in turn, never together.
    await expect(page).not.toHaveURL(/[?&]c=/);
  });

  test('replaces the replay and hides the player', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await expect(page.getByRole('slider', { name: /Commit position/ })).toBeVisible();

    await openCompare(page);
    await expect(page.getByRole('slider', { name: /Commit position/ })).toHaveCount(0);
    await expect(page.locator('[aria-label="Repository files at this commit"]')).toHaveCount(0);
  });

  test('restores a shared comparison link exactly, from the cache', async ({ page }) => {
    const github = watchGitHub(page);
    await openRepo(page, REPOS.demo);
    await openCompare(page);
    await expect(compareRelation(page)).toBeVisible();

    const shared = page.url();
    const sentence = await compareRelation(page).textContent();

    await page.goto('about:blank');
    await page.goto(shared);

    await expect(page.getByRole('heading', { level: 2, name: 'Compare two points' })).toBeVisible();
    await expect(compareRelation(page)).toHaveText(sentence ?? '');
    await expect(page).toHaveURL(shared);
    expect(github).toEqual([]);
  });

  test('compares any two points chosen by hand', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await openCompare(page);

    await comparePicker(page, 'base').click();
    await page
      .getByRole('dialog', { name: /Choose the base/ })
      .getByRole('button', { name: /establish design tokens/ })
      .click();
    await comparePicker(page, 'head').click();
    await page
      .getByRole('dialog', { name: /Choose the head/ })
      .getByRole('button', { name: /expand the learning library/ })
      .click();
    await compareRun(page).click();

    // Commits 2 to 6: four commits apart.
    await expect(compareRelation(page)).toContainText(/is 4 commits ahead of/);
  });
});

test.describe('choosing the two ends', () => {
  test('costs no request until the comparison is submitted', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await openCompare(page);
    await expect(compareRelation(page)).toBeVisible();

    // Only from here on, so the default pair's own request is not counted.
    const api = watchApi(page);

    await comparePicker(page, 'head').click();
    await page
      .getByRole('dialog', { name: /Choose the head/ })
      .getByRole('button', { name: /expand the learning library/ })
      .click();
    await comparePicker(page, 'base').click();
    await page
      .getByRole('dialog', { name: /Choose the base/ })
      .getByRole('button', { name: /establish design tokens/ })
      .click();
    await page.getByRole('button', { name: 'Swap the two ends of the comparison' }).click();
    await page.waitForTimeout(500);

    expect(
      api.filter((url) => url.includes('/api/gh/compare')),
      'moving a selector must not request a comparison',
    ).toEqual([]);
  });

  test('puts a stale result away instead of relabelling it', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await openCompare(page);
    const before = await compareRelation(page).textContent();

    await comparePicker(page, 'base').click();
    await page
      .getByRole('dialog', { name: /Choose the base/ })
      .getByRole('button', { name: /publish the first guided lesson/ })
      .click();

    // The old sentence is gone, not sitting under the new endpoints.
    await expect(page.getByText('Selection changed')).toBeVisible();
    await expect(compareRelation(page)).toHaveCount(0);

    await compareRun(page).click();
    await expect(compareRelation(page)).toBeVisible();
    expect(await compareRelation(page).textContent()).not.toBe(before);
  });

  test('compares two tags', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await openCompare(page);

    // The demo carries two release tags; put one on each side.
    await comparePicker(page, 'head').click();
    await page.getByRole('dialog', { name: /Choose the head/ }).getByRole('button', { name: /^v1\.0\.0/ }).click();
    await comparePicker(page, 'base').click();
    await page.getByRole('dialog', { name: /Choose the base/ }).getByRole('button', { name: /^v0\.1\.0/ }).click();
    await compareRun(page).click();

    await expect(comparePicker(page, 'base')).toContainText('v0.1.0');
    await expect(comparePicker(page, 'head')).toContainText('v1.0.0');
    await expect(compareRelation(page)).toContainText(/commits ahead of/);
  });

  test('calls a tag a tag, not a release', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await openCompare(page);
    await comparePicker(page, 'base').click();

    const menu = page.getByRole('dialog', { name: /Choose the base/ });
    await expect(menu.getByRole('button', { name: /^v1\.0\.0/ })).toContainText('tag');
    await expect(menu.getByText(/release/i)).toHaveCount(0);
  });

  test('filters the picker by commit subject', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await openCompare(page);

    await comparePicker(page, 'base').click();
    const menu = page.getByRole('dialog', { name: /Choose the base/ });
    await page.getByLabel('Filter the base choices').fill('coding workspace');

    // Scoped to the menu: the same subject may also be in the result below.
    await expect(menu.getByRole('button', { name: /introduce the coding workspace/ })).toBeVisible();
    await menu.getByRole('button', { name: /introduce the coding workspace/ }).click();
    await expect(comparePicker(page, 'base')).toContainText('introduce the coding workspace');
  });

  test('swaps the two ends and reverses the reading, once confirmed', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await openCompare(page);
    await expect(compareRelation(page)).toContainText(/ahead of/);

    await page.getByRole('button', { name: 'Swap the two ends of the comparison' }).click();
    // A swap is a change of selection, so it waits to be run.
    await expect(page.getByText('Selection changed')).toBeVisible();

    await compareRun(page).click();
    await expect(compareRelation(page)).toContainText(/behind/);
  });

  test('says two identical points are the same commit, without a request', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await openCompare(page);
    await expect(compareRelation(page)).toBeVisible();

    const api = watchApi(page);

    await comparePicker(page, 'head').click();
    await page
      .getByRole('dialog', { name: /Choose the head/ })
      .getByRole('button', { name: /lock background scrolling/ })
      .click();
    await comparePicker(page, 'base').click();
    await page
      .getByRole('dialog', { name: /Choose the base/ })
      .getByRole('button', { name: /lock background scrolling/ })
      .click();

    await expect(page.getByText('These are the same commit.')).toBeVisible();
    // No round trip needed to answer it, and nothing to run.
    await expect(compareRun(page)).toBeDisabled();
    expect(api.filter((url) => url.includes('/compare'))).toEqual([]);
  });

  test('closes the picker with Escape without leaving the view', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await openCompare(page);

    await comparePicker(page, 'base').click();
    await expect(page.getByLabel('Filter the base choices')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('Filter the base choices')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 2, name: 'Compare two points' })).toBeVisible();
  });
});

test.describe('reading a comparison', () => {
  test('gives one row of figures and three reachable sub-views', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await page.getByRole('slider', { name: /Commit position/ }).fill('12');
    await page.waitForTimeout(400);
    await openCompare(page);
    await expect(compareRelation(page)).toBeVisible();

    const metrics = page.locator('[class*="metrics"]');
    await expect(metrics).toContainText('Files changed');
    await expect(metrics).toContainText('Lines added');
    await expect(metrics).toContainText('Lines removed');
    // Three figures, not a wall of them.
    await expect(metrics.locator('dd')).toHaveCount(3);

    await expect(page.getByRole('tab', { name: /File changes/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[class*="fileItem"]').first()).toBeVisible();

    await page.getByRole('tab', { name: /^Commits/ }).click();
    await expect(page.getByRole('tabpanel')).toContainText(/Open in Replay/);

    await page.getByRole('tab', { name: 'Repository stats' }).click();
    await expect(page.getByRole('rowheader', { name: 'Files tracked' })).toBeVisible();
  });

  test('states the relation in words, from the moving end’s point of view', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await openCompare(page);

    const base = (await comparePicker(page, 'base').textContent())!.match(/[0-9a-f]{7}/)![0];
    const head = (await comparePicker(page, 'head').textContent())!.match(/[0-9a-f]{7}/)![0];

    // Head is the subject: it is what moved relative to base.
    await expect(compareRelation(page)).toHaveText(
      new RegExp(`^${head} is \\d+ commits? ahead of ${base}\\.$`),
    );

    await page.getByRole('button', { name: 'Swap the two ends of the comparison' }).click();
    await compareRun(page).click();
    await expect(compareRelation(page)).toHaveText(
      new RegExp(`^${base} is \\d+ commits? behind ${head}\\.$`),
    );

    // The ungrammatical shapes an earlier template produced.
    await expect(page.getByText(/is identical of/)).toHaveCount(0);
    await expect(page.getByText(/is behind of/)).toHaveCount(0);
  });

  test('appends the file and line totals to the relation', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await openCompare(page);
    await expect(
      page.getByText(/\d+ files? changed, [\d,]+ lines? added and [\d,]+ removed\./),
    ).toBeVisible();
  });

  test('computes a real net diff for a file touched by several commits', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    // Arriving at the first commit compares the whole range, so a file touched
    // more than once across it is exactly the case this is about.
    await openCompare(page);
    await expect(compareRelation(page)).toContainText(/is 15 commits ahead of/);

    // app-shell.tsx is modified by three of the fifteen commits in between.
    const item = page.locator('[class*="fileItem"][data-path="components/layout/app-shell.tsx"]');
    await item.locator('[class*="fileButton"]').click();

    const diff = page.getByLabel('Diff for components/layout/app-shell.tsx');
    await expect(diff).toBeVisible();
    await expect(diff).toContainText('@@');

    // The line counts on the row come from that diff, not from summing commits.
    const plus = (await diff.innerText()).split('\n').filter((line) => line.startsWith('+')).length;
    await expect(item.locator('[class*="plus"]')).toHaveText(`+${plus}`);
  });

  test('never falls back to an aggregated total anywhere in the demo', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await openCompare(page);
    await expect(compareRelation(page)).toBeVisible();

    // The demo ships its file content, so a net diff can always be computed.
    // "Changed more than once" remains the honest answer for a live repository.
    await expect(page.getByText('Changed more than once in this range')).toHaveCount(0);
    await expect(page.getByText('No diff was provided')).toHaveCount(0);
  });

  test('withholds only the generated files, and says so before they are opened', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    // Commit 1 to 2: a short list, so the lockfile is on the first page of it.
    await page.getByRole('slider', { name: /Commit position/ }).fill('1');
    await page.waitForTimeout(500);
    await openCompare(page);
    await expect(compareRelation(page)).toContainText(/is 1 commit ahead of/);

    const lockfile = page.locator('[class*="fileItem"][data-path="package-lock.json"]');
    // Marked from the path, so nothing looks readable and then is not.
    await expect(lockfile.locator('[class*="fileKind"]')).toHaveText('generated');

    await lockfile.locator('[class*="fileButton"]').click();
    await expect(page.getByText('Generated file — diff deliberately not shown')).toBeVisible();
    await expect(page.getByText(/declared to be, not a count taken from a diff/)).toBeVisible();
  });

  test('says the file-type mix is estimated from extensions', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await openCompare(page);
    await expect(compareRelation(page)).toBeVisible();
    await page.getByRole('tab', { name: 'Repository stats' }).click();

    await expect(page.getByText('estimate from extensions')).toBeVisible();
    await expect(page.getByText(/not from reading file contents/)).toBeVisible();
  });
});

test.describe('leaving a comparison', () => {
  test('returns to the replay at the same commit', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await page.getByRole('slider', { name: /Commit position/ }).fill('7');
    await page.waitForTimeout(500);

    await openCompare(page);
    await expect(compareRelation(page)).toBeVisible();

    await viewTab(page, 'Replay').click();
    // Choosing endpoints must not have moved the playhead.
    await expect(page.getByRole('slider', { name: /Commit position/ })).toHaveValue('7');
    await expect(page).not.toHaveURL(/base=/);
  });

  test('moves the replay only through an explicit action', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await page.getByRole('slider', { name: /Commit position/ }).fill('7');
    await page.waitForTimeout(500);
    await openCompare(page);

    // Changing an endpoint is not a request to move the replay.
    await comparePicker(page, 'base').click();
    await page
      .getByRole('dialog', { name: /Choose the base/ })
      .getByRole('button', { name: /scaffold the application shell/ })
      .click();
    await compareRun(page).click();
    await expect(compareRelation(page)).toBeVisible();

    await viewTab(page, 'Replay').click();
    await expect(page.getByRole('slider', { name: /Commit position/ })).toHaveValue('7');
  });

  test('opens a commit from the range in the replay, when asked to', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await openCompare(page);
    await expect(compareRelation(page)).toBeVisible();

    await page.getByRole('tab', { name: /^Commits/ }).click();
    await page.getByRole('button', { name: 'Open in Replay' }).first().click();

    await expect(page.getByRole('slider', { name: /Commit position/ })).toBeVisible();
    await expect(page.locator('[aria-label="Repository files at this commit"]')).toBeVisible();
  });

  test('keeps the comparison when returning to it', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await openCompare(page);
    const sentence = await compareRelation(page).textContent();

    await viewTab(page, 'Replay').click();
    const api = watchApi(page);
    await viewTab(page, 'Compare').click();

    await expect(compareRelation(page)).toHaveText(sentence ?? '');
    expect(api.filter((url) => url.includes('/compare')), 'returning must not refetch').toEqual([]);
  });
});

test.describe('a comparison of a live repository', () => {
  test('uses the GitHub path and states the relation', async ({ page }) => {
    await openRepo(page, REPOS.medium);
    await openCompare(page);
    await expect(compareRelation(page)).toContainText(/ahead of|behind|identify the same commit/);
  });
});

test.describe('comparison layout', () => {
  test('has exactly one H1, naming what is open', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await openCompare(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Learning Platform');
  });

  test('stacks the two ends on a narrow screen, with the direction still clear', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await openRepo(page, REPOS.demo);
    await openCompare(page);
    await expect(compareRelation(page)).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const from = (await comparePicker(page, 'base').boundingBox())!;
    const to = (await comparePicker(page, 'head').boundingBox())!;
    // Stacked, and From is still before To.
    expect(to.y).toBeGreaterThan(from.y);

    // Nor with a picker open, which is the widest thing in the view.
    await comparePicker(page, 'base').click();
    await expectNoHorizontalOverflow(page);
  });

  test('a shared link opens the compare view directly', async ({ page }) => {
    await page.goto(repoUrl(REPOS.demo));
    await openCompare(page);
    // Only a comparison that has actually run is in the URL, so wait for it.
    await expect(compareRelation(page)).toBeVisible();
    const shared = page.url();
    expect(shared).toMatch(/base=/);

    await page.goto(shared);
    await expect(page.getByRole('tab', { name: 'Compare', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});
