import { expect, test } from '@playwright/test';
import {
  commitSubject,
  currentIndex,
  expectNoHorizontalOverflow,
  openRepo,
  REPOS,
  subTab,
  transport,
  viewTab,
  watchApi,
} from './helpers';

test.describe('the evolving file tree', () => {
  test('starts nearly empty and fills in as the replay advances', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    const t = transport(page);

    await expect(page.locator('[class*="count"]').first()).toHaveText('6 files');

    await t.slider.fill('15');
    await expect(page.locator('[class*="count"]').first()).toHaveText(/\d{2,} files/);
  });

  test('expands and collapses folders', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await transport(page).slider.fill('6');
    await page.waitForTimeout(600);

    // Rows carry their full path as a title, which is the only unambiguous handle.
    const app = page.locator('[role="treeitem"] button[title="app"]');
    const nested = page.locator('[role="treeitem"] button[title="app/lessons"]');

    // Top-level folders start open.
    await expect(nested).toBeVisible();
    await app.click();
    await expect(nested).toHaveCount(0);
    await app.click();
    await expect(nested).toBeVisible();
  });

  test('marks what the selected commit changed, in symbols as well as colour', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await transport(page).slider.fill('15');
    await page.waitForTimeout(600);

    const changed = page.locator('[role="treeitem"][data-status]');
    await expect(changed.first()).toBeVisible();
    await expect(page.getByText(/(added|modified|deleted|renamed) in this commit/).first()).toBeAttached();
  });

  test('filters paths, and distinguishes no match from no files', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await transport(page).slider.fill('15');
    await page.waitForTimeout(600);
    const filter = page.getByLabel('Filter file paths in the tree');

    await filter.fill('scroll-lock');
    await expect(page.getByText('scroll-lock.ts').first()).toBeVisible();
    await expect(page.getByText('tokens.css')).toHaveCount(0);

    await filter.fill('zzzzz');
    await expect(page.getByText(/No path matches/)).toBeVisible();
    // It says what it searched, and offers a way back.
    await expect(page.getByText(/not file contents/)).toBeVisible();
    await page.getByRole('button', { name: 'Clear the filter' }).click();
    await expect(page.getByLabel('Filter file paths in the tree')).toHaveValue('');
    await expect(page.locator('[class*="count"]').first()).toHaveText(/\d{2,} files/);
  });

  test('labels generated and binary files', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await transport(page).slider.fill('15');
    await page.waitForTimeout(600);

    // The demo ships a lockfile and a generated index, both of which are labelled.
    await page.getByLabel('Filter file paths in the tree').fill('lock');
    await expect(page.getByText('generated', { exact: true }).first()).toBeVisible();
  });

  test('states how the tree was produced, above the tree', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    const line = page.locator('[class*="fidelity"]').first();
    await expect(line).toBeVisible();
    await expect(line).toHaveText(/Snapshot|Reconstructed|Approximate|No snapshot/);

    const tree = await page.locator('[role="tree"]').boundingBox();
    const box = await line.boundingBox();
    // The caveat comes before the thing it qualifies, not after it.
    expect(box!.y).toBeLessThan(tree!.y);
  });

  test('shows the most recent change to a selected file', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await transport(page).slider.fill('12');
    await page.waitForTimeout(1500);

    await page.getByLabel('Filter file paths in the tree').fill('app-shell');
    await page.getByRole('treeitem').filter({ hasText: 'app-shell.tsx' }).first().getByRole('button').first().click();

    await expect(page.getByText(/Last change at or before this point|Open this file|No change found/)).toBeVisible();
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

test.describe('the repository and the changes together', () => {
  test('opens on the repository, with the change count on the other tab', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await page.waitForTimeout(1200);

    await expect(subTab(page, 'Repository')).toHaveAttribute('aria-selected', 'true');
    await expect(subTab(page, 'Changes')).toContainText('(6)');
  });

  test('a changed file in the tree opens its diff, on the same commit', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await transport(page).slider.fill('9');
    await page.waitForTimeout(1500);

    const subject = await commitSubject(page).textContent();
    const at = await currentIndex(page);

    const shortcut = page.getByRole('button', { name: /^Open the diff for/ }).first();
    const path = (await shortcut.getAttribute('aria-label'))!.replace('Open the diff for ', '');
    await shortcut.click();

    await expect(subTab(page, 'Changes')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel(`Diff for ${path}`)).toBeVisible();
    // Same commit throughout.
    await expect(commitSubject(page)).toHaveText(subject ?? '');
    expect(await currentIndex(page)).toBe(at);
  });

  test('an unchanged file offers no diff', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await transport(page).slider.fill('12');
    await page.waitForTimeout(1500);

    const rows = page.locator('[role="treeitem"]:not([data-status]):not([data-dir])');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < Math.min(count, 6); i += 1) {
      await expect(rows.nth(i).getByRole('button', { name: /^Open the diff for/ })).toHaveCount(0);
    }
  });

  test('switching sub-views needs no request', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await page.waitForTimeout(1800);

    const api = watchApi(page);
    await subTab(page, 'Changes').click();
    await subTab(page, 'Repository').click();
    await subTab(page, 'Changes').click();
    await page.waitForTimeout(400);

    expect(api, 'already-loaded data must not be refetched').toEqual([]);
  });

  test('shows the commit message, author, timestamp and no fake link', async ({ page }) => {
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
    await subTab(page, 'Changes').click();
    await expect(page.locator('[class*="fileItem"]').first()).toBeVisible();
    await expect(page.locator('[class*="plus"]').first()).toBeVisible();
  });

  test('shows a real unified diff for the files a visitor opens first', async ({ page }) => {
    /*
     * The exact path somebody takes on arriving: step to commit 2, open the two
     * files that were the most obvious dead ends before the fixture carried
     * content.
     */
    await openRepo(page, REPOS.demo);
    await transport(page).next.click();
    await page.waitForTimeout(1200);
    await subTab(page, 'Changes').click();

    for (const path of ['next.config.ts', 'app/layout.tsx', 'styles/tokens.css']) {
      const item = page.locator(`[class*="fileItem"][data-path="${path}"]`);
      await item.locator('[class*="fileButton"]').click();

      const diff = page.getByLabel(`Diff for ${path}`);
      await expect(diff, path).toBeVisible();
      await expect(diff).toContainText('@@');
      // Real hunks, not a placeholder.
      await expect(diff.locator('[data-kind="add"]').first()).toBeVisible();

      // And the counts on the row are the counts in the diff.
      const text = await diff.innerText();
      const plus = text.split('\n').filter((line) => line.startsWith('+')).length;
      await expect(item.locator('[class*="plus"]')).toHaveText(`+${plus}`);

      await item.locator('[class*="fileButton"]').click();
    }
  });

  test('no expandable row anywhere in the demo dead-ends', async ({ page }) => {
    await openRepo(page, REPOS.demo);

    for (const index of ['0', '4', '8', '12', '15']) {
      await transport(page).slider.fill(index);
      await page.waitForTimeout(400);
      await subTab(page, 'Changes').click();

      const items = page.locator('[class*="fileItem"]');
      const count = await items.count();
      expect(count).toBeGreaterThan(0);

      for (let i = 0; i < count; i += 1) {
        const item = items.nth(i);
        const path = await item.getAttribute('data-path');
        await item.locator('[class*="fileButton"]').click();

        // Either a diff, or a specific explanation. Never an empty panel.
        const hasDiff = await page.getByLabel(`Diff for ${path}`).count();
        const hasReason = await item.locator('[class*="patchFallbackTitle"]').count();
        expect(hasDiff + hasReason, `commit ${Number(index) + 1} ${path}`).toBeGreaterThan(0);

        await item.locator('[class*="fileButton"]').click();
      }
    }
  });

  test('marks a generated file before it is opened, then says why', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await transport(page).next.click();
    await page.waitForTimeout(1000);
    await subTab(page, 'Changes').click();

    const lockfile = page.locator('[class*="fileItem"][data-path="package-lock.json"]');
    // Said in advance, so nothing looks readable and then turns out not to be.
    await expect(lockfile.locator('[class*="fileKind"]')).toHaveText('generated');

    await lockfile.locator('[class*="fileButton"]').click();
    await expect(page.getByText('Generated file — diff deliberately not shown')).toBeVisible();
    // And it does not pretend the count came from a diff.
    await expect(page.getByText(/declared to be, not a count taken from a diff/)).toBeVisible();
    // Not the generic failure it used to fall into.
    await expect(page.getByText('No diff was provided')).toHaveCount(0);
  });

  test('offers side by side above 1280px, and never below it', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openRepo(page, REPOS.demo);
    await subTab(page, 'Changes').click();

    const unified = page.getByRole('button', { name: 'Unified' });
    const split = page.getByRole('button', { name: 'Side by side' });
    await expect(unified).toHaveAttribute('aria-pressed', 'true');

    const first = page.locator('[class*="fileItem"]').first();
    const path = await first.getAttribute('data-path');
    await first.locator('[class*="fileButton"]').click();
    await expect(page.getByLabel(`Diff for ${path}`)).toBeVisible();

    await split.click();
    await expect(split).toHaveAttribute('aria-pressed', 'true');
    // Two columns, each labelled, describing the same change.
    await expect(page.getByLabel(`Diff for ${path}, side by side`)).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Before' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'After' })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // A phone gets one column, and is not offered the choice at all.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    await expect(page.getByRole('button', { name: 'Side by side' })).toHaveCount(0);
    await expect(page.getByLabel(`Diff for ${path}`)).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('opens a readable patch on demand', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await page.waitForTimeout(1500);
    await subTab(page, 'Changes').click();

    const firstFile = page.locator('[class*="fileButton"]').first();
    await firstFile.click();
    await expect(firstFile).toHaveAttribute('aria-expanded', 'true');

    const patch = page.locator('[aria-label^="Diff for"]').first();
    await expect(patch).toBeVisible();
    await expect(patch.locator('[data-kind="add"], [data-kind="del"], [data-kind="hunk"]').first()).toBeVisible();
  });

  test('closes the patch when the replay moves on', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await transport(page).slider.fill('9');
    await page.waitForTimeout(1500);
    await subTab(page, 'Changes').click();
    await page.locator('[class*="fileButton"]').first().click();
    await expect(page.locator('[aria-label^="Diff for"]').first()).toBeVisible();

    await transport(page).previous.click();
    await page.waitForTimeout(500);
    await expect(page.locator('[aria-label^="Diff for"]')).toHaveCount(0);
  });

  test('states the milestones on one line, ahead of the changes', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await page.waitForTimeout(600);

    // A count of milestones, which is not a count of commits or of phases.
    await expect(page.getByText('4 detected milestones')).toBeVisible();
    // The evidence is a disclosure, not four cards in front of the diff.
    await expect(page.getByText('The commit has no parent.')).toHaveCount(0);

    await page.getByRole('button', { name: 'Evidence' }).click();
    await expect(page.getByText('Initial commit').first()).toBeVisible();
    await expect(page.getByText('The commit has no parent.')).toBeVisible();
  });

  test('the changes are reachable without scrolling past explanations', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openRepo(page, REPOS.demo);
    await page.waitForTimeout(1200);
    await subTab(page, 'Changes').click();

    const first = await page.locator('[class*="fileItem"]').first().boundingBox();
    expect(first, 'the first changed file must be on screen').not.toBeNull();
    expect(first!.y).toBeLessThan(720);
  });
});

test.describe('insights', () => {
  test('reads as a page, with the scope stated first', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await viewTab(page, 'Insights').click();

    const scope = page.locator('[class*="scopeTitle"]');
    await expect(scope).toHaveText('All 16 commits');
    await expect(page.getByRole('heading', { name: 'Growth' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Milestones/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^File types/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Where work happened' })).toBeVisible();
  });

  test('states what the source says about the repository itself', async ({ page }) => {
    await openRepo(page, REPOS.medium);
    await viewTab(page, 'Insights').click();

    // Repository metadata, kept apart from the figures about the loaded window,
    // and named for what it is — the repository's name is already the H1.
    await expect(page.getByRole('heading', { name: 'About this repository' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('rtm-fixtures/sample-app');
    // The branch is stated once, in the source line, and not repeated here.
    await expect(page.getByText('Commits on the default branch')).toBeVisible();
    await expect(page.getByText('Stars')).toBeVisible();
    await expect(page.getByText('Licence')).toBeVisible();
    // GitHub's guess, labelled as GitHub's.
    await expect(page.getByText(/per GitHub/)).toBeVisible();
    // And the only way to the real repository.
    await expect(page.getByRole('link', { name: /Open rtm-fixtures\/sample-app on GitHub/ })).toBeVisible();
  });

  test('offers no repository link for built-in data, and says why', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await viewTab(page, 'Insights').click();

    await expect(page.getByRole('heading', { name: 'About this repository' })).toBeVisible();
    await expect(page.getByRole('link', { name: /on GitHub/ })).toHaveCount(0);
    await expect(page.getByText(/nothing to open on GitHub: this history ships with/)).toBeVisible();
    // Star and fork counts are meaningless for invented data, so they are absent.
    await expect(page.getByText('Stars')).toHaveCount(0);

    // Said once per workspace, not once per block.
    await expect(page.getByText(/curated, synthetic history — not a live GitHub repository/)).toHaveCount(1);
  });

  test('offers a text alternative for the growth chart', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await viewTab(page, 'Insights').click();
    await page.waitForTimeout(1500);

    const chart = page.getByRole('img', { name: /Repository growth across/ });
    await expect(chart).toBeVisible();
    // The axis says what the spacing means, so the shape cannot imply time.
    await expect(page.getByText(/Evenly spaced by commit order, not by elapsed time/)).toBeVisible();

    await page.getByText('Read this chart as a table').click();
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Files' })).toBeVisible();
  });

  test('labels the file-type mix an estimate and says what it excluded', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await viewTab(page, 'Insights').click();
    await page.waitForTimeout(1500);
    await expect(page.getByText('estimate', { exact: true })).toBeVisible();
    await expect(page.getByText(/Estimated from file extensions, not from file contents/)).toBeVisible();
  });

  test('states the milestone disclaimer, and does not inflate the count', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await viewTab(page, 'Insights').click();

    await expect(page.getByText(/pattern matches on file paths, commit metadata and tags/)).toBeVisible();
    await expect(page.getByText(/not what anyone intended/)).toBeVisible();
    // Fifteen rules across nine commits, said as such.
    await expect(page.getByText(/\d+ milestones across \d+ commits/)).toBeVisible();
    await expect(page.getByText(/several rules often match the same commit/)).toBeVisible();
  });

  test('opens the milestone list at five commits, with the rest on request', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await viewTab(page, 'Insights').click();
    await page.waitForTimeout(1200);

    // Five to begin with, so Growth and the scope are still on the first screen.
    await expect(page.locator('[class*="milestoneRow"]')).toHaveCount(5);

    const more = page.getByRole('button', { name: /Show all milestones/ });
    await expect(more).toBeVisible();

    // Bring the section into view *before* measuring, so what is measured is the
    // effect of expanding and not the scroll Playwright would do to reach it.
    await more.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);

    // Expanding appends, and nothing already on screen moves — including the
    // control itself, which is why it lives in the heading rather than below
    // the list it grows.
    const firstBefore = await page.locator('[class*="milestoneCommit"]').first().innerText();
    const rowBox = await page.locator('[class*="milestoneRow"]').first().boundingBox();
    const buttonBox = await more.boundingBox();
    await more.click();

    expect(await page.locator('[class*="milestoneRow"]').count()).toBeGreaterThan(5);
    expect(await page.locator('[class*="milestoneCommit"]').first().innerText()).toBe(firstBefore);
    const rowAfter = await page.locator('[class*="milestoneRow"]').first().boundingBox();
    expect(rowAfter!.y, 'the first row moved').toBeCloseTo(rowBox!.y, 0);

    const collapse = page.getByRole('button', { name: /Show the first 5 only/ });
    await expect(collapse).toBeVisible();
    expect((await collapse.boundingBox())!.y, 'the control moved').toBeCloseTo(buttonBox!.y, 0);

    // Every entry still states the rule that produced it.
    await expect(page.getByText(/^Rule: /).first()).toBeVisible();
  });

  test('jumps from a milestone back to its commit in the replay', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await viewTab(page, 'Insights').click();
    await page.waitForTimeout(1200);

    const row = page.locator('[class*="milestoneRow"]').nth(2);
    const subject = await row.locator('[class*="milestoneCommit"]').innerText();
    await row.getByRole('button', { name: 'Inspect commit' }).click();

    await expect(page.getByRole('slider', { name: /Commit position/ })).toBeVisible();
    await expect(commitSubject(page)).toHaveText(subject);
  });

  test('searching commits happens in the history list, over loaded data', async ({ page }) => {
    await openRepo(page, REPOS.demo);

    const search = page.getByLabel(/Filter loaded commits/);
    await search.fill('drawer');
    await expect(page.getByText(/of 16 loaded commits match/)).toBeVisible();
    expect(await page.locator('[class*="itemSubject"]').count()).toBeGreaterThan(0);

    await search.fill('zzzzzzzz');
    await expect(page.getByText('No commits match')).toBeVisible();
  });

  test('jumps to a commit from the history list', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await page.locator('[class*="itemSubject"]').nth(3).click();
    await expect(page.getByRole('slider', { name: /Commit position/ })).toHaveValue('3');
  });
});

test.describe('loaded range honesty', () => {
  test('says how much of a long history is loaded, and can load more', async ({ page }) => {
    await openRepo(page, REPOS.big);
    await expect(page.getByText('Latest 300 of 640 commits')).toBeVisible();
    await expect(page.getByText('300 of 640 commits loaded.')).toBeVisible();

    await page.getByRole('button', { name: /Load 100 older commits/ }).click();
    await expect(page.getByText('Latest 400 of 640 commits')).toBeVisible();
  });

  test('keeps the selected commit when older commits shift every index', async ({ page }) => {
    await openRepo(page, REPOS.big);
    await transport(page).slider.fill('120');
    await page.waitForTimeout(500);
    const subject = await commitSubject(page).textContent();

    await page.getByRole('button', { name: /Load 100 older commits/ }).click();
    await expect(page.getByText('Latest 400 of 640 commits')).toBeVisible();

    // The index moved by a page; the commit under the playhead did not move.
    await expect(page.getByRole('slider', { name: /Commit position/ })).toHaveValue('220');
    await expect(commitSubject(page)).toHaveText(subject ?? '');
  });

  test('can load older history from the insights page too', async ({ page }) => {
    await openRepo(page, REPOS.big);
    await viewTab(page, 'Insights').click();
    await expect(page.getByText('Latest 300 of 640 commits')).toBeVisible();

    await page.getByRole('button', { name: /Load 100 older commits/ }).click();
    await expect(page.getByText('Latest 400 of 640 commits')).toBeVisible();
    await expect(page.getByText(/Everything on this page is measured over these 400 commits only/)).toBeVisible();
  });

  test('calls a complete history complete', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await expect(page.getByText('All 16 commits')).toBeVisible();
    await expect(page.getByText(/Latest \d+ of/)).toHaveCount(0);
  });

  test('reports full coverage for the built-in demo, with no gaps', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await page.waitForTimeout(1800);

    await viewTab(page, 'Insights').click();
    await expect(page.getByText('diffs loaded for 16 of 16 commits')).toBeVisible();
    // Every position is read from a real tree, so nothing is carried forward.
    await expect(page.getByText('carried forward')).toHaveCount(0);

    await viewTab(page, 'Replay').click();
    for (const index of ['0', '5', '10', '15']) {
      await page.getByRole('slider', { name: /Commit position/ }).fill(index);
      await page.waitForTimeout(250);
      await expect(page.locator('[class*="fidelityBadge"]').first()).toHaveText('Snapshot');
    }
  });
});
