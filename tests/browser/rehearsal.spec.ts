import { browserArtifact } from '../support/browser-artifacts.js';
import { writeFileSync } from 'node:fs';
import { test, expect } from '../support/browser-fixtures.js';

test.use({ video: { mode: 'on', size: { width: 1280, height: 1000 } } });
test.afterEach(async ({ page }, info) => { if (!info.title.startsWith('initial three scenes')) return; const video = page.video(); await page.close(); if (video) await video.saveAs(browserArtifact(`${info.project.name}-initial-scenes-${info.title.includes('phone') ? 'phone' : 'desktop'}.webm`)); });
for (const viewport of [{ name: 'desktop', width: 1280, height: 1000, stage: 820 }, { name: 'phone', width: 390, height: 844, stage: 358 }]) {
  test(`initial three scenes play in full motion at ${viewport.name} size`, async ({ page, app, operator }, info) => {
    test.setTimeout(90000);
    await page.setViewportSize(viewport); await page.goto('/rehearsal');
    const receipts = [];
    for (const sceneId of ['TM01', 'TM09', 'TM04']) {
      await page.getByRole('combobox', { name: 'Scene', exact: true }).selectOption(sceneId);
      const record = await (await page.request.get(`/api/operator/scenes/${sceneId}/score`)).json();
      const stage = page.locator('svg.stage'); await expect(stage).toBeVisible();
      await expect.poll(async () => Math.round((await stage.boundingBox())!.width)).toBe(viewport.stage);
      await expect(page.locator('input[type=range]')).toHaveValue('0');
      const before = await stage.locator('[data-actor]').evaluateAll(nodes => nodes.map(node => node.getAttribute('transform')));
      await page.getByRole('button', { name: 'Play', exact: true }).click();
      await expect.poll(() => stage.locator('[data-actor]').evaluateAll(nodes => nodes.map(node => node.getAttribute('transform'))), { timeout: 5000 }).not.toEqual(before);
      const moving = await stage.locator('[data-actor]').evaluateAll(nodes => nodes.map(node => node.getAttribute('transform')));
      await page.screenshot({ path: browserArtifact(`${info.project.name}-${sceneId}-${viewport.name}-motion.png`), fullPage: true });
      await expect(page.locator('input[type=range]')).toHaveValue(String(record.score.durationMs), { timeout: 12000 });
      const ended = await stage.locator('[data-actor]').evaluateAll(nodes => nodes.map(node => node.getAttribute('transform')));
      receipts.push({ sceneId, scoreHash: record.scoreHash, source: record.source, authorship: record.authorship, viewport, before, moving, ended, completedMs: record.score.durationMs, humanMeaningReview: 'NOT RUN' });
    }
    await expect(page.getByRole('combobox', { name: 'Scene', exact: true }).locator('option[value=TM07]')).toHaveJSProperty('disabled', true);
    writeFileSync(browserArtifact(`${info.project.name}-${viewport.name}-motion.json`), JSON.stringify(receipts, null, 2));
  });
}

test('matched references, import validation, key stepping and actual preview widths', async ({ page, app, operator }) => {
  await page.goto('/rehearsal'); await expect(page.locator('svg.stage')).toBeVisible();
  const record = await (await page.request.get('/api/operator/scenes/TM01/score')).json();
  await page.getByText('Import a score for local validation', { exact: true }).click();
  await page.getByRole('textbox', { name: 'MotionScoreV1 JSON' }).fill(JSON.stringify(record.score)); await page.getByRole('button', { name: 'Validate score' }).click();
  await expect(page.getByRole('status')).toHaveText('Imported score is now in rehearsal.');
  await page.getByRole('button', { name: 'Show validator details' }).click(); await expect(page.getByText(record.scoreHash, { exact: true })).toBeVisible();
  await page.getByText('Rehearsal settings', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Stage preview' }).selectOption('358'); await expect.poll(async () => Math.round((await page.locator('svg.stage').boundingBox())!.width)).toBe(358);
  await page.getByRole('combobox', { name: 'Stage preview' }).selectOption('288'); await expect.poll(async () => Math.round((await page.locator('svg.stage').boundingBox())!.width)).toBe(288);
  const ids = await page.getByRole('combobox', { name: 'Comparison', exact: true }).locator('option').evaluateAll(nodes => nodes.map(node => (node as HTMLOptionElement).value).filter(Boolean)); expect(ids).toHaveLength(5);
  for (const id of ids) {
    await page.getByRole('combobox', { name: 'Comparison', exact: true }).selectOption(id); await expect(page.locator('svg.stage')).toHaveCount(2);
    await page.getByText('Frame and key controls', { exact: true }).click();
    await page.getByRole('button', { name: 'Next keyframe' }).click(); expect(Number(await page.locator('input[type=range]').inputValue())).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Reset', exact: true }).click(); await expect(page.locator('input[type=range]')).toHaveValue('0');
  }
});

test('[P03 P04] reduced motion steps union keys and hidden pages pause without restarting', async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/rehearsal'); await expect(page.getByRole('button', { name: 'Next frame', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next frame', exact: true }).click(); await expect(page.locator('input[type=range]')).toHaveValue('900');
  await page.getByText('Frame and key controls', { exact: true }).click();
  await page.getByRole('button', { name: 'Next keyframe' }).click(); expect(Number(await page.locator('input[type=range]').inputValue())).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Play animation', exact: true }).click(); await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(async () => Number(await page.locator('input[type=range]').inputValue())).toBeGreaterThan(150);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible(); const paused = await page.locator('input[type=range]').inputValue();
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.locator('input[type=range]')).toHaveValue(paused);
  await page.getByRole('button', { name: 'Play', exact: true }).click(); await expect.poll(async () => Number(await page.locator('input[type=range]').inputValue())).toBeGreaterThan(Number(paused));
});

test('390 and 320 layouts, keyboard focus and 200/400 percent reflow stay usable', async ({ page, app, operator }, info) => {
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 }); await page.goto('/rehearsal');
    await expect(page.locator('svg.stage')).toBeVisible(); await expect.poll(async () => Math.round((await page.locator('svg.stage').boundingBox())!.width)).toBe(width - 32);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: browserArtifact(`${info.project.name}-rehearsal-${width}.png`), fullPage: true });
  }
  for (const zoom of [2, 4]) {
    await page.setViewportSize({ width: 1280, height: 1000 }); await page.goto('/rehearsal'); await page.evaluate(value => { document.documentElement.style.zoom = String(value); }, zoom);
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Play', exact: true }).focus();
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.keyboard.press('Enter'); await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeFocused();
    await page.keyboard.press('Enter'); await page.screenshot({ path: browserArtifact(`${info.project.name}-zoom-${zoom * 100}.png`), fullPage: true });
  }
});
