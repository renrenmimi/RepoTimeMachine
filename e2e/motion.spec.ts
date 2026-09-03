import { expect, test } from '@playwright/test';
import { currentIndex, openRepo, REPOS, transport } from './helpers';

/**
 * Runs in the `reduced-motion` project, where the browser reports
 * `prefers-reduced-motion: reduce`. Reduced motion must replace transitional
 * animation with immediate state changes, not disable the feature.
 */
test.describe('reduced motion', () => {
  test('the browser really is in reduced-motion mode', async ({ page }) => {
    await page.goto('/');
    const reduced = await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    expect(reduced).toBe(true);
  });

  test('transition durations collapse to nothing', async ({ page }) => {
    await openRepo(page, REPOS.demo);

    const durations = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      return {
        instant: root.getPropertyValue('--duration-instant').trim(),
        fast: root.getPropertyValue('--duration-fast').trim(),
        normal: root.getPropertyValue('--duration').trim(),
        pulse: root.getPropertyValue('--duration-pulse').trim(),
      };
    });

    for (const value of Object.values(durations)) {
      expect(value).toBe('1ms');
    }
  });

  test('the change marker settles immediately instead of pulsing', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await transport(page).slider.fill('15');
    await page.waitForTimeout(400);

    const marker = page.locator('[role="treeitem"][data-status] [class*="marker"]').first();
    await expect(marker).toBeAttached();
    const animation = await marker.evaluate((el) => getComputedStyle(el).animationName);
    // Switched off outright, not merely shortened.
    expect(animation).toBe('none');
  });

  test('the marker still says what changed, without the animation', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    await transport(page).slider.fill('15');
    await page.waitForTimeout(400);
    // Reduced motion removes the transition, not the information.
    await expect(page.getByText(/(added|modified|deleted|renamed) in this commit/).first()).toBeAttached();
  });

  test('playback still works, and still steps one commit at a time', async ({ page }) => {
    await openRepo(page, REPOS.demo);
    const t = transport(page);

    await t.slider.fill('4');
    await t.play.click();
    await expect(t.pause).toBeVisible();
    await expect.poll(() => currentIndex(page), { timeout: 8000 }).toBeGreaterThan(5);
    await t.pause.click();
    await expect(t.play).toBeVisible();
  });

  test('looping animations are switched off, not merely shortened', async ({ page, request }) => {
    await page.goto('/');

    const hrefs = await page.evaluate(() =>
      [...document.querySelectorAll('link[rel="stylesheet"]')].map((link) => (link as HTMLLinkElement).href),
    );
    expect(hrefs.length).toBeGreaterThan(0);

    const css = (await Promise.all(hrefs.map(async (href) => (await request.get(href)).text()))).join('\n');

    // A 1ms loop is still a loop, so the shimmer and blink animations are
    // switched off outright rather than merely shortened.
    const blocks = css.match(/@media\s*\(prefers-reduced-motion[^@]*/g) ?? [];
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.some((block) => /animation:\s*none/.test(block))).toBe(true);
    expect(blocks.some((block) => /--duration:\s*1ms/.test(block))).toBe(true);
  });
});
