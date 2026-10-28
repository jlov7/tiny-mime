import { test, expect } from '../support/browser-fixtures.js';
import { listShowcases } from '../../src/server/operator/showcase.js';

test.use({ video: 'on', reducedMotion: 'no-preference' });

for (const width of [1280, 390]) test(`first-time directing journey plays all three complete pairs without autoplay at ${width}px`, async ({ page, app }, info) => {
  test.setTimeout(120000);
  const errors: string[] = [], remote: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:4317/')) remote.push(request.url()); });
  await page.setViewportSize({ width, height: width === 1280 ? 720 : 844 }); await page.goto('/');
  await page.getByRole('link', { name: 'Open directing demo', exact: true }).click();
  await page.getByLabel('Launch secret', { exact: true }).fill(app.secret());
  await page.getByRole('button', { name: 'Unlock operator tools', exact: true }).click();
  const encounter = page.getByRole('region', { name: 'Authored scene encounter', exact: true });
  for (const [index, example] of listShowcases().entries()) {
    await expect(page.getByLabel('Directing example', { exact: true })).toHaveValue(example.id);
    await expect(encounter.getByRole('timer')).toHaveText(/^0\.00 \/ /);
    await expect(encounter.getByRole('status')).toHaveText('Paused');
    await expect(page.getByRole('heading', { name: 'Intention and directing notes', exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`scene-${index + 1}-first-paused.png`), fullPage: true });
    await encounter.getByRole('button', { name: 'Play take', exact: true }).click();
    const focusAfterPlay = await page.evaluateHandle(() => document.activeElement);
    await expect(encounter.getByRole('status')).toHaveText('Finished', { timeout: example.left.score.durationMs + 5000 });
    expect(await focusAfterPlay.evaluate(node => node === document.activeElement)).toBe(true);
    await focusAfterPlay.dispose();
    await encounter.getByRole('button', { name: 'Reflect on first take', exact: true }).click();
    await expect(encounter.getByRole('heading', { name: 'A moment to think.', exact: true })).toBeVisible();
    await expect(encounter.getByRole('textbox')).toHaveCount(0);
    await encounter.getByRole('button', { name: 'Continue to second take', exact: true }).click();
    await expect(encounter.getByRole('timer')).toHaveText(/^0\.00 \/ /);
    await expect(encounter.getByRole('status')).toHaveText('Paused');
    await encounter.getByRole('button', { name: 'Play take', exact: true }).click();
    await expect(encounter.getByRole('status')).toHaveText('Finished', { timeout: example.right.score.durationMs + 5000 });
    await page.screenshot({ path: info.outputPath(`scene-${index + 1}-second-finished.png`), fullPage: true });
    await encounter.getByRole('button', { name: 'Reveal intention and notes', exact: true }).click();
    await expect(page.getByText(example.intention, { exact: false })).toBeVisible();
    if (index < 2) await encounter.getByRole('button', { name: 'Next scene', exact: true }).click();
  }
  await encounter.getByRole('button', { name: 'Finish for now', exact: true }).click();
  await expect(encounter.getByRole('heading', { name: 'Finished for now.', exact: true })).toBeVisible();
  await encounter.getByRole('button', { name: 'Return to first scene', exact: true }).click();
  await expect(page.getByLabel('Directing example', { exact: true })).toHaveValue('TM01');
  await expect(encounter.getByRole('timer')).toHaveText(/^0\.00 \/ /); await expect(encounter.getByRole('status')).toHaveText('Paused');
  expect(errors).toEqual([]); expect(remote).toEqual([]);
});
