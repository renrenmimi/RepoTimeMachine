import { expect, test } from '@playwright/test';
import { commitSubject, openRepo, REPOS, transport } from './helpers';

test.describe('evolving file tree', () => {
  test('starts nearly empty and fills in as the timeline advances', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    const t = transport(page);

    await t.slider.fill('0');
    await expect(page.getByText('6 files')).toBeVisible();

    await t.slider.fill('15');
    await expect(page.getByText(/\d{2,} files/)).toBeVisible();
  });

  test('expands and collapses folders', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    // Rows carry their full path as a title, which is the only unambiguous handle.
    const app = page.locator('[role="treeitem"] button[title="app"]');
    const arena = page.locator('[role="treeitem"] button[title="app/lessons"]');

    // Top-level folders start open.
    await expect(arena).toBeVisible();
    await app.click();
    await expect(arena).toHaveCount(0);
    await app.click();
    await expect(arena).toBeVisible();
  });

  test('marks what the selected commit changed', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await transport(page).slider.fill('15');
    await page.waitForTimeout(600);

    const changed = page.locator('[role="treeitem"][data-status]');
    await expect(changed.first()).toBeVisible();
    await expect(page.getByText(/(added|modified|deleted|renamed) in this commit/).first()).toBeAttached();
  });

  test('filters paths', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    const filter = page.getByLabel('Filter file paths in the tree');

    await filter.fill('scroll-lock');
    await expect(page.getByText('scroll-lock.ts').first()).toBeVisible();
    await expect(page.getByText('tokens.css')).toHaveCount(0);

    await filter.fill('zzzzz');
    await expect(page.getByText(/No paths match/)).toBeVisible();
  });

  test('labels generated and binary files', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await transport(page).slider.fill('15');
    await page.waitForTimeout(600);

    // The demo ships a lockfile and a generated index, both of which are labelled.
    await page.getByLabel('Filter file paths in the tree').fill('lock');
    await expect(page.getByText('generated', { exact: true }).first()).toBeVisible();
  });

  test('states how the tree was reconstructed', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    const badge = page.locator('[class*="fidelity"]').first();
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText(/exact|rebuilt|≈|no snapshot/);
  });

  test('shows the most recent change to a selected file', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await page.waitForTimeout(1500);

    await page.getByLabel('Filter file paths in the tree').fill('app-shell');
    await page.getByRole('treeitem').filter({ hasText: 'app-shell.tsx' }).first().getByRole('button').click();

    await expect(page.getByText(/last change at or before this point|No change found/)).toBeVisible();
  });

  test('keeps a large tree responsive by rendering only what is visible', async ({ page }) => {
    await openRepo(page, REPOS.big);
    await page.waitForTimeout(1200);

    const rendered = await page.locator('[role="treeitem"]').count();
    const claimed = await page.locator('[class*="count"]').first().textContent();
    expect(rendered).toBeLessThan(200);
    expect(claimed).toMatch(/\d+ files?/);
  });
});

test.describe('commit detail', () => {
  test('shows message, author, timestamp and a link to the real commit', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await expect(commitSubject(page)).not.toHaveText('');
    await expect(page.getByText(/UTC/)).toBeVisible();

    // Built-in commits have no repository to open, so the sha is plain text.
    await expect(page.locator('a[href*="/commit/"]')).toHaveCount(0);
    await expect(page.locator('[class*="shaPlain"]')).toHaveCount(1);
  });

  test('lists files changed with additions and deletions', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await page.waitForTimeout(1200);
    await expect(page.getByRole('heading', { name: 'Files changed' })).toBeVisible();
    await expect(page.locator('[class*="fileItem"]').first()).toBeVisible();
  });

  test('opens a readable patch on demand', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await page.waitForTimeout(1500);

    const firstFile = page.locator('[class*="fileButton"]').first();
    await firstFile.click();
    await expect(firstFile).toHaveAttribute('aria-expanded', 'true');

    const patch = page.locator('[aria-label^="Diff for"]').first();
    await expect(patch).toBeVisible();
    await expect(patch.locator('[data-kind="add"], [data-kind="del"], [data-kind="hunk"]').first()).toBeVisible();
  });

  test('closes the patch when the timeline moves on', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await page.waitForTimeout(1500);
    await page.locator('[class*="fileButton"]').first().click();
    await expect(page.locator('[aria-label^="Diff for"]').first()).toBeVisible();

    await transport(page).previous.click();
    await page.waitForTimeout(500);
    await expect(page.locator('[aria-label^="Diff for"]')).toHaveCount(0);
  });

  test('explains why a milestone fired', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await transport(page).slider.fill('0');
    await page.waitForTimeout(600);

    await expect(page.getByText('Initial commit').first()).toBeVisible();
    await expect(page.getByText('The commit has no parent.')).toBeVisible();
  });
});

test.describe('insights', () => {
  test('moves between the three views with the keyboard', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    const growth = page.getByRole('tab', { name: 'Growth' });
    await growth.click();
    await expect(growth).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: /Milestones/ })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Commits' })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('tab', { name: /Milestones/ })).toHaveAttribute('aria-selected', 'true');
  });

  test('offers a text alternative for the growth chart', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await page.waitForTimeout(1500);

    const chart = page.getByRole('img', { name: /Repository growth across/ });
    await expect(chart).toBeVisible();

    await page.getByText('Read this chart as a table').click();
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Files' })).toBeVisible();
  });

  test('labels the language mix an estimate and says what it excluded', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await page.waitForTimeout(1500);
    await expect(page.getByText('estimate', { exact: true })).toBeVisible();
    await expect(page.getByText(/Estimated from file extensions, not from file contents/)).toBeVisible();
  });

  test('states the milestone disclaimer', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await page.getByRole('tab', { name: /Milestones/ }).click();
    await expect(page.getByText(/pattern matches on file paths, commit metadata and tags/)).toBeVisible();
    await expect(page.getByText(/not what anyone intended/)).toBeVisible();
  });

  test('searches commit messages inside the loaded range', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await page.getByRole('tab', { name: 'Commits' }).click();

    const search = page.getByLabel(/Search commit messages/);
    await search.fill('drawer');
    await expect(page.locator('[class*="commitItem"]').first()).toBeVisible();
    const hits = await page.locator('[class*="commitItem"]').count();
    expect(hits).toBeGreaterThan(0);

    await search.fill('zzzzzzzz');
    await expect(page.getByText(/No commit in the loaded range matches/)).toBeVisible();
  });

  test('jumps to a commit from the list', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await page.getByRole('tab', { name: 'Commits' }).click();
    await page.locator('[class*="commitItem"]').nth(3).click();
    await expect(page.getByRole('slider', { name: /Commit position/ })).toHaveValue('12');
  });
});

test.describe('loaded range honesty', () => {
  test('says how much of a long history is loaded, and can load more', async ({ page }) => {
    await openRepo(page, REPOS.big);
    await expect(page.getByText('latest 300 of 640 commits')).toBeVisible();

    await page.getByRole('tab', { name: 'Commits' }).click();
    await expect(page.getByText('300 of 640 commits loaded.')).toBeVisible();

    await page.getByRole('button', { name: /Load 100 older commits/ }).click();
    await expect(page.getByText('latest 400 of 640 commits')).toBeVisible();
  });

  test('keeps the selected commit when older commits shift every index', async ({ page }) => {
    await openRepo(page, REPOS.big);
    await transport(page).slider.fill('120');
    await page.waitForTimeout(500);
    const subject = await commitSubject(page).textContent();

    await page.getByRole('tab', { name: 'Commits' }).click();
    await page.getByRole('button', { name: /Load 100 older commits/ }).click();
    await expect(page.getByText('latest 400 of 640 commits')).toBeVisible();

    await expect(page.getByRole('slider', { name: /Commit position/ })).toHaveValue('220');
    await expect(commitSubject(page)).toHaveText(subject ?? '');
  });

  test('calls a complete history full', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await expect(page.getByText('full history — 16 commits')).toBeVisible();
    await expect(page.getByText(/latest \d+ of/)).toHaveCount(0);
  });

  test('reports full coverage for the built-in demo, with no gaps', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await page.waitForTimeout(1800);

    await expect(page.getByText('diffs loaded for 16 of 16 commits')).toBeVisible();
    // Every position is read from a real tree, so nothing is carried forward.
    await expect(page.getByText('carried forward')).toHaveCount(0);

    for (const index of ['0', '5', '10', '15']) {
      await page.getByRole('slider', { name: /Commit position/ }).fill(index);
      await page.waitForTimeout(250);
      await expect(page.locator('[class*="fidelity"]').first()).toHaveText('exact');
    }
  });
});
