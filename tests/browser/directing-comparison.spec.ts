import { test, expect } from '../support/browser-fixtures.js';

for (const width of [1280, 390]) test(`prepared TM09 exposes exact timing changes and paused keyboard seeks at ${width}px`, async ({ page, app, operator }, info) => {
  await page.setViewportSize({ width, height: 1000 }); await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/showcase'); await page.getByRole('combobox', { name: 'Directing example' }).selectOption('TM09');
  await page.getByRole('button', { name: 'Inspect both takes together', exact: true }).click();
  const comparison = page.getByRole('region', { name: 'Score comparison', exact: true }); const timeline = comparison.getByRole('slider');
  await expect(timeline).toHaveValue('0');
  await comparison.getByRole('button', { name: 'Play comparison', exact: true }).click();
  const summary = comparison.getByText('Numeric changes', { exact: true }); await summary.focus(); await page.keyboard.press('Enter');
  await expect(summary).toBeFocused(); await expect(comparison.getByRole('status')).toHaveText('Paused');
  const changes = comparison.getByRole('list', { name: 'Stored key changes' }); await expect(changes.getByRole('listitem')).toHaveCount(9);
  const first = changes.getByRole('listitem').first();
  await expect(first).toContainText('Actor b · key 2'); await expect(first).toContainText('Same-index timing');
  await expect(first).toContainText('2000 → 2250 ms (+250 ms)'); await expect(first).toContainText('Inspect interval: 0–3000 ms.');
  await expect(comparison).toContainText('9 actor keyframes added; 9 removed.');
  await expect(comparison).toContainText('does not establish movement identity'); await expect(comparison).toContainText('do not measure meaning, quality or improvement');
  const secondKey = first.getByRole('button', { name: 'Second key at 2250 ms', exact: true }); await secondKey.focus(); await page.keyboard.press('Enter');
  await expect(secondKey).toBeFocused(); await expect(timeline).toHaveValue('2250'); await page.waitForTimeout(100); await expect(timeline).toHaveValue('2250');
  await expect(comparison.getByRole('status')).toHaveText('Paused');
  if (width === 390) {
    const swap = comparison.getByRole('button', { name: 'Show second take', exact: true }); await swap.focus(); await page.keyboard.press('Enter');
    await expect(swap).toBeFocused(); await expect(timeline).toHaveValue('2250');
    await expect(comparison.locator('svg.stage:visible')).toHaveCount(1);
    expect(await comparison.locator('svg.stage:visible').evaluate(stage => stage.getBoundingClientRect().width)).toBeGreaterThanOrEqual(340);
  } else await expect(comparison.locator('svg.stage:visible')).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await first.getByRole('button', { name: 'Inspect from 0 ms', exact: true }).click(); await expect(timeline).toHaveValue('0');
  await first.getByRole('button', { name: 'First key at 2000 ms', exact: true }).click(); await expect(timeline).toHaveValue('2000');
  await comparison.getByText('Frame and key controls', { exact: true }).click();
  await comparison.getByRole('button', { name: 'Next comparison key', exact: true }).click(); await expect(timeline).toHaveValue('2150');
  await comparison.getByRole('button', { name: 'Next comparison key', exact: true }).click(); await expect(timeline).toHaveValue('2250');
  await page.screenshot({ path: info.outputPath('timing-detail-' + width + '.png'), fullPage: true });
  await summary.focus(); await page.keyboard.press('Enter'); await expect(summary).toBeFocused(); await expect(changes).toHaveCount(0); await expect(timeline).toHaveValue('2250');
  await expect(comparison.locator('svg.stage text')).toHaveCount(0);
});

test('a single-coordinate candidate edit shows exact values and its affected interval', async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/rehearsal'); await expect(page.locator('svg.stage')).toBeVisible();
  const authored = await (await page.request.get('/api/operator/scenes/TM01/score')).json(); const key = authored.score.actors[0].keyframes[1];
  await page.getByRole('button', { name: 'Revise', exact: true }).click(); await page.getByRole('button', { name: 'Start edit fork' }).click();
  await page.getByLabel('Edit keyframe', { exact: true }).selectOption('1'); await page.getByLabel('Keyframe Horizontal position (x)', { exact: true }).fill(String(key.x + 1));
  await page.getByRole('button', { name: 'Validate and rehearse fork', exact: true }).click(); await expect(page.locator('.provenance')).toContainText('Edited score');
  await page.getByRole('button', { name: 'Compare', exact: true }).click(); await page.getByLabel('Compare with', { exact: true }).selectOption('authored');
  const comparison = page.getByRole('region', { name: 'Score comparison', exact: true }); const timeline = comparison.getByRole('slider');
  const summary = comparison.getByText('Numeric changes', { exact: true }); await summary.focus(); await page.keyboard.press('Enter'); await expect(summary).toBeFocused();
  const changes = comparison.getByRole('list', { name: 'Stored key changes' }); await expect(changes.getByRole('listitem')).toHaveCount(1);
  const row = changes.getByRole('listitem'); await expect(row).toContainText('Actor a · key 2'); await expect(row).toContainText(`Shared time ${key.tMs} ms`);
  await expect(row.locator('dt')).toHaveText('x'); await expect(row.locator('dd')).toHaveText(`${key.x} → ${key.x + 1}`);
  await expect(comparison).toContainText('Before: Authored draft. After: Active revision · unreviewed.');
  const inspect = row.getByRole('button', { name: `First key at ${key.tMs} ms`, exact: true }); await inspect.focus(); await page.keyboard.press('Enter');
  await expect(inspect).toBeFocused(); await expect(timeline).toHaveValue(String(key.tMs)); await expect(comparison.getByRole('status')).toHaveText('Paused');
  await row.getByRole('button', { name: 'Inspect from 0 ms', exact: true }).click(); await expect(timeline).toHaveValue('0');
  await expect(comparison.getByRole('button', { name: 'Next comparison keyframe', exact: true })).toBeVisible();
  expect(await (await page.request.get('/api/operator/scenes/TM01/score')).json()).toEqual(authored);
});
