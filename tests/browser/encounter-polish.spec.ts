import { test, expect } from '../support/browser-fixtures.js';

for (const width of [1280, 390, 320]) test('the authored encounter explains the task and keeps the controls together at ' + width + 'px', async ({ page, app, operator }, info) => {
  await page.setViewportSize({ width, height: width > 780 ? 720 : 844 }); await page.goto('/showcase');
  const encounter = page.getByRole('region', { name: 'Authored scene encounter', exact: true });
  await expect(page.getByText('Watch the first take. Think, then see the second.', { exact: true })).toBeInViewport({ ratio: 1 });
  await expect(encounter.locator('svg.stage')).toHaveCount(1);
  await expect(encounter.locator('svg.stage')).toBeInViewport({ ratio: 1 });
  for (const name of ['Play take', 'Reflect on first take', 'Skip to written reveal']) await expect(encounter.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
  if (width <= 780) expect((await encounter.locator('svg.stage').boundingBox())!.width).toBeCloseTo(width - 32);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('encounter-' + width + '.png'), fullPage: true });
});

test('comparison completion offers an honest replay in both motion and manual mode', async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/showcase'); await page.getByRole('button', { name: 'Inspect both takes together', exact: true }).click();
  const timeline = page.getByRole('slider'); const end = Number(await timeline.getAttribute('max'));
  await expect(page.getByRole('button', { name: 'Next comparison keyframe', exact: true })).toBeEnabled();
  await timeline.fill(String(end)); await expect(page.getByRole('status')).toContainText('Finished');
  await page.getByRole('button', { name: 'Replay comparison frames', exact: true }).click(); await expect(timeline).toHaveValue('0');
  await page.getByRole('button', { name: 'Next comparison keyframe', exact: true }).click(); expect(Number(await timeline.inputValue())).toBeGreaterThan(0);
  await page.getByText('Frame and key controls', { exact: true }).click(); await page.getByRole('button', { name: 'Enable comparison animation', exact: true }).click();
  await timeline.fill(String(end - 60)); await page.getByRole('button', { name: 'Play comparison', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Replay comparison', exact: true })).toBeVisible(); await expect(page.getByRole('status')).toContainText('Finished');
  await page.getByRole('button', { name: 'Replay comparison', exact: true }).click(); await expect(page.getByRole('button', { name: 'Pause comparison', exact: true })).toBeVisible();
  await page.getByText('Intention and directing notes', { exact: true }).click(); await expect(page.getByRole('button', { name: 'Play comparison', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Paused');
});
