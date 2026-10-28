import { test, expect } from '../support/browser-fixtures.js';
import { writeFileSync } from 'node:fs';

for (const viewport of [{ width: 1280, height: 1000 }, { width: 1280, height: 720 }, { width: 390, height: 844 }, { width: 320, height: 844 }]) {
  test(`the stage and moment tools stay together at ${viewport.width} by ${viewport.height}`, async ({ page, app, operator }, info) => {
    await page.setViewportSize(viewport); await page.goto('/rehearsal?scene=TM09&take=second');
    const stage = page.locator('.active-rehearsal svg.stage'); await expect(stage).toBeVisible();
    await page.evaluate(async () => { await document.fonts.ready; });
    await page.getByRole('slider').fill('2400');
    await page.getByRole('heading', { name: 'Rehearsal room.', exact: true }).click(); await page.evaluate(() => window.scrollTo(0, 0));
    expect(await page.evaluate(() => scrollY)).toBe(0);
    writeFileSync(info.outputPath('geometry-' + viewport.width + '.json'), JSON.stringify({ viewport, stage: await stage.boundingBox(), edit: await page.getByRole('button', { name: 'Edit this moment', exact: true }).boundingBox(), timeline: await page.locator('.active-rehearsal input[type="range"]').boundingBox(), scrollY: await page.evaluate(() => scrollY) }, null, 2) + '\n');
    await page.screenshot({ path: info.outputPath('rehearsal-stage-' + viewport.width + '.png'), fullPage: true });
    await page.screenshot({ path: info.outputPath('rehearsal-viewport-' + viewport.width + '.png') });
    await expect.soft(stage).toBeInViewport({ ratio: 1, timeout: 1500 });
    await expect.soft(page.getByRole('button', { name: 'Edit this moment', exact: true })).toBeInViewport({ ratio: 1, timeout: 1500 });
    await expect.soft(page.locator('.active-rehearsal input[type="range"]')).toBeInViewport({ ratio: 1, timeout: 1500 });
    if (viewport.width === 1280 && viewport.height === 1000) expect.soft(Math.round((await stage.boundingBox())!.width)).toBe(820);
    if (viewport.width < 700) expect.soft(Math.round((await stage.boundingBox())!.width)).toBe(viewport.width - 32);
    expect.soft(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Edit this moment', exact: true }).click();
    await expect(page.getByLabel('Keyframe Time (ms)', { exact: true })).toBeFocused();
    await page.getByLabel('Keyframe Rotation (degrees)', { exact: true }).fill('1');
    const editor = page.locator('.desk-panel:visible');
    const editGeometry = await page.evaluate(() => { const box = (selector: string) => { const rect = document.querySelector(selector)!.getBoundingClientRect(); return { top: rect.top + scrollY, bottom: rect.bottom + scrollY, height: rect.height }; }; return { stage: box('.active-rehearsal svg.stage'), editor: box('.numeric-key-selector'), fields: box('.numeric-fields'), scrollY }; });
    const applyBox = (await page.getByRole('button', { name: 'Validate and rehearse fork', exact: true }).boundingBox())!;
    writeFileSync(info.outputPath('editing-geometry-' + viewport.width + '.json'), JSON.stringify({ viewport, ...editGeometry, applyBottom: applyBox.y + applyBox.height + await page.evaluate(() => scrollY), editorHeight: (await editor.boundingBox())!.height }, null, 2) + '\n');
    if (viewport.width < 700) {
      expect((await editor.boundingBox())!.height).toBeLessThanOrEqual(560);
      expect(applyBox.y + applyBox.height + await page.evaluate(() => scrollY) - editGeometry.stage.bottom).toBeLessThanOrEqual(viewport.height);
      for (const input of await page.locator('.numeric-fields input').all()) {
        await expect(input).toBeInViewport({ ratio: 1 });
        await expect(input).toHaveCSS('min-height', '48px');
        // Firefox may report a 48px box as 47.999969482421875 after scrolling.
        expect(Math.round((await input.boundingBox())!.height * 1000) / 1000).toBeGreaterThanOrEqual(48);
      }
      await expect(page.getByRole('button', { name: 'Preview valid fork', exact: true })).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('button', { name: 'Validate and rehearse fork', exact: true })).toBeInViewport({ ratio: 1 });
    }
    await page.screenshot({ path: info.outputPath('moment-editor-' + viewport.width + '.png') });
    await page.getByRole('button', { name: 'Preview valid fork', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Score comparison', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'View comparison stage', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Active rehearsal stage', exact: true })).toBeFocused();
    await expect(page.locator('.directing-stage-host svg.stage:visible')).toBeInViewport({ ratio: 1 });
    expect.soft(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('fork-preview-' + viewport.width + '.png') });
  });
}

test('maximum-length version titles stay inside the tray and comparison', async ({ page, app, operator }, info) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const authored = await (await page.request.get('/api/operator/scenes/TM01/score')).json();
  const longTitle = 'Synthetic_' + 'W'.repeat(70);
  const baseline = (await (await page.request.post('/api/operator/candidates', { data: { requestId: crypto.randomUUID(), sceneId: 'TM01', title: longTitle, score: authored.score, parentCandidateId: null, notes: [] }, headers: { Origin: 'http://127.0.0.1:4317' } })).json()).candidate;
  const revision = (await (await page.request.post('/api/operator/candidates', { data: { requestId: crypto.randomUUID(), sceneId: 'TM01', title: 'Synthetic revision', score: authored.score, parentCandidateId: baseline.candidateId, notes: [] }, headers: { Origin: 'http://127.0.0.1:4317' } })).json()).candidate;
  await page.goto('/rehearsal?candidate=' + revision.candidateId); await expect(page.locator('svg.stage')).toBeVisible();
  await page.getByRole('button', { name: 'Versions', exact: true }).click();
  expect.soft(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Compare with parent', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Score comparison', exact: true })).toBeVisible();
  expect.soft(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('maximum-title-layout.png'), fullPage: true });
});
