import { expect, test } from '@playwright/test';
import { builtinBadge, commitSubject, currentIndex, openRepo, REPOS, repoUrl, transport } from './helpers';

test.describe('playback', () => {
  test('plays forward from the beginning and can be paused at any point', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    const t = transport(page);

    // Pressing play at the newest commit rewinds to the start of the range.
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

  test('changing speed does not reset the timeline', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    const t = transport(page);

    await t.slider.fill('9');
    expect(await currentIndex(page)).toBe(9);

    await page.getByRole('button', { name: /^4/ }).click();
    expect(await currentIndex(page)).toBe(9);
    await expect(page.getByRole('button', { name: /^4/ })).toHaveAttribute('aria-pressed', 'true');

    // And it does not start playback either.
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

  test('stops at the end instead of looping', async ({ page }) => {
    await openRepo(page, REPOS.tiny);
    const t = transport(page);

    await page.getByRole('button', { name: /^8/ }).click();
    await t.play.click();
    await expect.poll(() => currentIndex(page), { timeout: 8000 }).toBe(4);
    await expect(t.play).toBeVisible();
    await page.waitForTimeout(800);
    expect(await currentIndex(page)).toBe(4);
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
});

test.describe('keyboard control', () => {
  test('space toggles playback', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await page.locator('body').click({ position: { x: 5, y: 200 } });

    await page.keyboard.press('Space');
    await expect(transport(page).pause).toBeVisible();
    await page.keyboard.press('Space');
    await expect(transport(page).play).toBeVisible();
  });

  test('arrows step, shift-arrows jump, Home and End go to the ends', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await transport(page).slider.fill('12');
    await page.locator('body').click({ position: { x: 5, y: 200 } });

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
    await page.locator('body').click({ position: { x: 5, y: 200 } });

    await page.keyboard.press(']');
    await expect(page.getByRole('button', { name: /^2/ })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('[');
    await expect(page.getByRole('button', { name: /^1/ })).toHaveAttribute('aria-pressed', 'true');
  });

  test('slash focuses the path filter', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await page.locator('body').click({ position: { x: 5, y: 200 } });
    await page.keyboard.press('/');
    await expect(page.getByLabel('Filter file paths in the tree')).toBeFocused();
  });

  test('shortcuts stay out of the way while typing', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    const filter = page.getByLabel('Filter file paths in the tree');
    await filter.click();
    await filter.type('page k');
    await expect(filter).toHaveValue('page k');
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

  test('Back and Forward move between repositories', async ({ page }) => {
    await openRepo(page, REPOS.tiny);
    await expect(page.getByText('full history — 5 commits')).toBeVisible();

    await page.getByRole('button', { name: /Built-in demo/ }).first().click();
    await expect(page.getByText('full history — 16 commits')).toBeVisible();

    await page.goBack();
    await expect(page.getByText('full history — 5 commits')).toBeVisible();

    await page.goForward();
    await expect(page.getByText('full history — 16 commits')).toBeVisible();
  });

  test('Back returns to the commit a jump started from', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await transport(page).slider.fill('11');
    await page.waitForTimeout(400);

    await page.getByRole('tab', { name: 'Milestones' }).click();
    await page.getByRole('button', { name: /Initial commit/ }).first().click();
    await expect(page.getByRole('slider', { name: /Commit position/ })).toHaveValue('0');

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
    await expect(page.getByRole('slider', { name: /Commit position/ })).toHaveValue('15');
  });
});

test.describe('switching repositories', () => {
  test('replaces the timeline rather than mixing two histories', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await expect(page.getByText('full history — 16 commits')).toBeVisible();
    await expect(page.getByText('scroll-lock.ts').first()).toBeVisible();
    await expect(builtinBadge(page)).toBeVisible();

    await openRepo(page, REPOS.tiny);
    await expect(page.getByText('full history — 5 commits')).toBeVisible();
    await expect(page.getByText('scroll-lock.ts')).toHaveCount(0);
    await expect(builtinBadge(page)).toHaveCount(0);
    await expect(page.getByRole('slider', { name: /Commit position/ })).toHaveValue('4');
  });

  test('switching mid-playback stops the old timeline', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await transport(page).play.click();
    await expect(transport(page).pause).toBeVisible();

    await openRepo(page, REPOS.tiny);
    await expect(page.getByText('full history — 5 commits')).toBeVisible();

    const index = await currentIndex(page);
    expect(index).toBeLessThanOrEqual(4);
  });
});
