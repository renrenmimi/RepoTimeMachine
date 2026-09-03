import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  builtinBadge,
  commitSubject,
  currentIndex,
  openCompare,
  openRepo,
  REPOS,
  repoUrl,
  subTab,
  globalAction,
  playableRange,
  transport,
  viewTab,
} from './helpers';

/** Moves focus off every control without clicking anything. */
async function focusDocument(page: Page): Promise<void> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    document.body.setAttribute('tabindex', '-1');
    document.body.focus();
    document.body.removeAttribute('tabindex');
  });
}

test.describe('playback', () => {
  test('plays forward from the beginning and can be paused at any point', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    const t = transport(page);

    await t.play.click();
    await expect(t.pause).toBeVisible();
    await expect.poll(() => currentIndex(page), { timeout: 8000 }).toBeGreaterThan(1);

    await t.pause.click();
    await expect(t.play).toBeVisible();
    const stopped = await currentIndex(page);
    await page.waitForTimeout(1200);
    expect(await currentIndex(page)).toBe(stopped);
  });

  test('resumes from where it paused', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    const t = transport(page);

    await t.slider.fill('10');
    await t.play.click();
    await expect.poll(() => currentIndex(page), { timeout: 8000 }).toBeGreaterThan(11);
    await t.pause.click();

    const paused = await currentIndex(page);
    await t.play.click();
    await expect.poll(() => currentIndex(page), { timeout: 8000 }).toBeGreaterThan(paused);
  });

  test('changing speed does not reset the position or start playing', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    const t = transport(page);

    await t.slider.fill('9');
    expect(await currentIndex(page)).toBe(9);

    await page.getByRole('button', { name: /^4/ }).click();
    expect(await currentIndex(page)).toBe(9);
    await expect(page.getByRole('button', { name: /^4/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(t.play).toBeVisible();
  });

  test('changing speed while playing keeps playing from the same place', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    const t = transport(page);

    await t.slider.fill('5');
    await t.play.click();
    await expect(t.pause).toBeVisible();
    const before = await currentIndex(page);

    await page.getByRole('button', { name: /^8/ }).click();
    await expect(t.pause).toBeVisible();
    expect(await currentIndex(page)).toBeGreaterThanOrEqual(before);
    await expect.poll(() => currentIndex(page), { timeout: 6000 }).toBeGreaterThan(before + 2);
  });

  test('stops at the end and offers a replay rather than a dead button', async ({ page }) => {
    await openRepo(page, REPOS.tiny);
    const t = transport(page);

    await page.getByRole('button', { name: /^8/ }).click();
    await t.play.click();
    await expect.poll(() => currentIndex(page), { timeout: 8000 }).toBe(4);
    await page.waitForTimeout(800);
    expect(await currentIndex(page)).toBe(4);

    // Explained rather than disabled: pressing it starts again from the top.
    await expect(t.replay).toBeEnabled();
    await t.replay.click();
    await expect.poll(() => currentIndex(page), { timeout: 4000 }).toBeLessThan(3);
  });

  test('steps one commit at a time', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    const t = transport(page);

    await t.slider.fill('9');
    await t.next.click();
    expect(await currentIndex(page)).toBe(10);
    await t.previous.click();
    expect(await currentIndex(page)).toBe(9);
  });

  test('keeps the selected commit readable while playing', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await page.getByRole('button', { name: /^2/ }).click();
    await transport(page).play.click();

    // The subject must always be present and non-empty, not blanked between frames.
    for (let i = 0; i < 6; i += 1) {
      await expect(commitSubject(page)).not.toHaveText('');
      await page.waitForTimeout(200);
    }
  });

  test('the history list follows the playhead', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await transport(page).slider.fill('13');
    await page.waitForTimeout(600);

    const current = page.locator('[aria-current="true"]');
    await expect(current).toHaveCount(1);
    await expect(current).toContainText(await commitSubject(page).innerText());
  });
});

test.describe('pausing to read', () => {
  test('opening a diff stops the clock', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await page.waitForTimeout(1500);
    await subTab(page, 'Changes').click();

    await transport(page).play.click();
    await expect(transport(page).pause).toBeVisible();

    await page.locator('[class*="fileButton"]').first().click();
    // Evidence must not move out from under the reader.
    await expect(transport(page).play).toBeVisible();
    const at = await currentIndex(page);
    await page.waitForTimeout(1200);
    expect(await currentIndex(page)).toBe(at);
  });

  test('returning to the replay finds everything the visitor chose', async ({ page }) => {
    /*
     * The replay unmounts on a view change, so anything it held locally was
     * gone on the way back: the sub-view reset to Repository, the path filter
     * emptied, folders the visitor had opened closed again.
     */
    await openRepo(page, REPOS.demo);
    await transport(page).slider.fill('7');
    await page.waitForTimeout(700);

    // Open a folder, filter the tree, then switch to the diff.
    await page.getByLabel('Filter file paths in the tree').fill('lib');
    await page.waitForTimeout(300);
    await subTab(page, 'Changes').click();
    const firstFile = await page.locator('[class*="fileItem"]').first().getAttribute('data-path');

    await viewTab(page, 'Insights').click();
    await page.waitForTimeout(900);
    await viewTab(page, 'Compare').click();
    await page.waitForTimeout(1400);
    await viewTab(page, 'Replay').click();
    await page.waitForTimeout(600);

    // The commit, the sub-view and the filter all survived.
    await expect(page.getByRole('slider', { name: /Commit position/ })).toHaveValue('7');
    await expect(subTab(page, 'Changes')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[class*="fileItem"]').first()).toHaveAttribute('data-path', firstFile!);

    await subTab(page, 'Repository').click();
    await expect(page.getByLabel('Filter file paths in the tree')).toHaveValue('lib');
  });

  test('an expanded diff collapses, which is a place to read rather than to be', async ({ page }) => {
    // Deliberate, and stated so it is a decision rather than an oversight: the
    // sub-view and the filter are where you are, an open patch is what you were
    // reading, and a list of collapsed files is the right thing to come back to.
    await openRepo(page, REPOS.demo);
    await subTab(page, 'Changes').click();
    await page.locator('[class*="fileButton"]').first().click();
    const path = await page.locator('[class*="fileItem"]').first().getAttribute('data-path');
    await expect(page.getByLabel(`Diff for ${path}`)).toBeVisible();

    await viewTab(page, 'Insights').click();
    await page.waitForTimeout(700);
    await viewTab(page, 'Replay').click();

    await expect(subTab(page, 'Changes')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel(`Diff for ${path}`)).toHaveCount(0);
  });

  test('a different repository starts with a clean tree', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await page.getByLabel('Filter file paths in the tree').fill('lib');
    await subTab(page, 'Changes').click();

    await openRepo(page, REPOS.tiny);
    // Another repository has another tree, so none of that carries over.
    await expect(subTab(page, 'Repository')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel('Filter file paths in the tree')).toHaveValue('');
  });

  test('leaving the replay stops the clock and keeps the place', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await transport(page).slider.fill('6');
    await page.getByRole('button', { name: /^4/ }).click();
    await transport(page).play.click();
    await expect(transport(page).pause).toBeVisible();

    await viewTab(page, 'Insights').click();
    await page.waitForTimeout(1200);
    await viewTab(page, 'Replay').click();

    // Paused, at the commit it was on, at the speed it was set to.
    await expect(transport(page).play).toBeVisible();
    expect(await currentIndex(page)).toBeGreaterThanOrEqual(6);
    expect(await currentIndex(page)).toBeLessThan(10);
    await expect(page.getByRole('button', { name: /^4/ })).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('keyboard control', () => {
  test('space toggles playback', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await focusDocument(page);

    await page.keyboard.press('Space');
    await expect(transport(page).pause).toBeVisible();
    await page.keyboard.press('Space');
    await expect(transport(page).play).toBeVisible();
  });

  test('arrows step, shift-arrows jump, Home and End go to the ends', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await transport(page).slider.fill('12');
    await focusDocument(page);

    await page.keyboard.press('ArrowLeft');
    expect(await currentIndex(page)).toBe(11);
    await page.keyboard.press('ArrowRight');
    expect(await currentIndex(page)).toBe(12);

    await page.keyboard.press('Shift+ArrowLeft');
    expect(await currentIndex(page)).toBe(2);
    await page.keyboard.press('Shift+ArrowRight');
    expect(await currentIndex(page)).toBe(12);

    await page.keyboard.press('Home');
    expect(await currentIndex(page)).toBe(0);
    await page.keyboard.press('End');
    expect(await currentIndex(page)).toBe(15);
  });

  test('brackets change the speed', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await focusDocument(page);

    await page.keyboard.press(']');
    await expect(page.getByRole('button', { name: /^2/ })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('[');
    await expect(page.getByRole('button', { name: /^1/ })).toHaveAttribute('aria-pressed', 'true');
  });

  test('slash focuses the path filter', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await focusDocument(page);
    await page.keyboard.press('/');
    await expect(page.getByLabel('Filter file paths in the tree')).toBeFocused();
  });

  test('shortcuts stay out of the way while typing', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    const filter = page.getByLabel('Filter file paths in the tree');
    await filter.click();
    await filter.fill('page k');
    await expect(filter).toHaveValue('page k');
    await expect(transport(page).play).toBeVisible();
  });

  test('shortcuts belong to the replay and to nothing on top of it', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await openCompare(page);
    await focusDocument(page);

    // Space here must not start a player that is not on screen.
    await page.keyboard.press('Space');
    await viewTab(page, 'Replay').click();
    await expect(transport(page).play).toBeVisible();
  });

  test('a modal swallows the shortcuts underneath it', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await globalAction(page, 'How it works');
    await expect(page.getByRole('dialog', { name: 'How it works' })).toBeVisible();

    await page.keyboard.press('Space');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(transport(page).play).toBeVisible();
  });

  test('the scrubber responds to arrow keys', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    const slider = transport(page).slider;
    await slider.fill('8');
    await slider.focus();
    await page.keyboard.press('ArrowRight');
    expect(await currentIndex(page)).toBe(9);
  });
});

test.describe('URL and history', () => {
  test('a shared URL reconstructs the same view', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await transport(page).slider.fill('7');
    await page.waitForTimeout(400);

    const shared = page.url();
    const subject = await commitSubject(page).textContent();
    expect(shared).toMatch(/[?&]c=[0-9a-f]{7,}/);

    await page.goto(shared);
    await expect(page.getByRole('slider', { name: /Commit position/ })).toHaveValue('7');
    await expect(commitSubject(page)).toHaveText(subject ?? '');
  });

  test('an abbreviated sha in the URL selects the right commit', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await transport(page).slider.fill('4');
    await page.waitForTimeout(400);
    const sha = new URL(page.url()).searchParams.get('c')!;

    await page.goto(repoUrl(REPOS.demo, sha.slice(0, 7)));
    await expect(page.getByRole('slider', { name: /Commit position/ })).toHaveValue('4');
  });

  test('the view is part of the shared state', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await viewTab(page, 'Insights').click();
    await expect(page).toHaveURL(/view=insights/);

    const shared = page.url();
    await page.goto(shared);
    await expect(viewTab(page, 'Insights')).toHaveAttribute('aria-selected', 'true');
  });

  test('an unknown view falls back to the replay', async ({ page }) => {
    await page.goto(`/?repo=${encodeURIComponent(REPOS.demo)}&view=dashboard`);
    await expect(page.getByRole('slider', { name: /Commit position/ })).toBeVisible();
    await expect(viewTab(page, 'Replay')).toHaveAttribute('aria-selected', 'true');
  });

  test('Back and Forward move between views', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await viewTab(page, 'Insights').click();
    await expect(page).toHaveURL(/view=insights/);

    await page.goBack();
    await expect(viewTab(page, 'Replay')).toHaveAttribute('aria-selected', 'true');
    await page.goForward();
    await expect(viewTab(page, 'Insights')).toHaveAttribute('aria-selected', 'true');
  });

  test('Back and Forward move between repositories', async ({ page }) => {
    await openRepo(page, REPOS.tiny);
    await expect(playableRange(page)).toHaveText('the whole history, 5 commits');

    await globalAction(page, 'Change repository');
    await page.getByRole('button', { name: /Explore the built-in demo instead/ }).click();
    await expect(playableRange(page)).toHaveText('the whole history, 16 commits');

    await page.goBack();
    await expect(playableRange(page)).toHaveText('the whole history, 5 commits');

    await page.goForward();
    await expect(playableRange(page)).toHaveText('the whole history, 16 commits');
  });

  test('Back returns to the commit a jump started from', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await transport(page).slider.fill('11');
    await page.waitForTimeout(400);

    await viewTab(page, 'Insights').click();
    await page.getByRole('button', { name: 'Inspect commit' }).first().click();
    await expect(page.getByRole('slider', { name: /Commit position/ })).toHaveValue('0');

    await page.goBack();
    await expect(viewTab(page, 'Insights')).toHaveAttribute('aria-selected', 'true');
    await page.goBack();
    await expect(page.getByRole('slider', { name: /Commit position/ })).toHaveValue('11');
  });

  test('playback does not flood the history stack', async ({ page }) => {
    // A long range, so playback is still running when the count is taken.
    await openRepo(page, REPOS.big);
    const before = await page.evaluate(() => history.length);

    await page.getByRole('button', { name: /^8/ }).click();
    await transport(page).play.click();
    await page.waitForTimeout(2000);

    const after = await page.evaluate(() => history.length);
    expect(await currentIndex(page)).toBeGreaterThan(5);
    expect(after - before).toBeLessThanOrEqual(2);
  });

  test('an invalid commit in the URL still loads the repository', async ({ page }) => {
    await page.goto(`/?repo=${encodeURIComponent(REPOS.demo)}&c=zzzz`);
    await expect(page.getByRole('slider', { name: /Commit position/ })).toBeVisible();
    await expect(page.getByRole('slider', { name: /Commit position/ })).toHaveValue('0');
  });
});

test.describe('switching repositories', () => {
  test('replaces the history rather than mixing two', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await expect(playableRange(page)).toHaveText('the whole history, 16 commits');
    await page.getByRole('button', { name: 'Latest' }).click();
    await page.waitForTimeout(800);
    // Through the filter: the tree is virtualised, so a path further down the
    // list is genuinely not rendered until it is asked for.
    await page.getByLabel('Filter file paths in the tree').fill('scroll-lock');
    await expect(page.getByText('scroll-lock.ts').first()).toBeVisible();
    await expect(builtinBadge(page)).toBeVisible();

    await openRepo(page, REPOS.tiny);
    await expect(playableRange(page)).toHaveText('the whole history, 5 commits');
    await page.getByLabel('Filter file paths in the tree').fill('scroll-lock');
    await expect(page.getByText('scroll-lock.ts')).toHaveCount(0);
    await expect(builtinBadge(page)).toHaveCount(0);
    await expect(page.getByRole('slider', { name: /Commit position/ })).toHaveValue('0');
  });

  test('switching mid-playback stops the old history', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await transport(page).play.click();
    await expect(transport(page).pause).toBeVisible();

    await openRepo(page, REPOS.tiny);
    await expect(playableRange(page)).toHaveText('the whole history, 5 commits');

    const index = await currentIndex(page);
    expect(index).toBeLessThanOrEqual(4);
  });
});
