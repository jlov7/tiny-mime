import { browserArtifact } from '../support/browser-artifacts.js';
import { writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { test, expect } from '../support/browser-fixtures.js';
import type { MotionScoreV1 } from '../../src/shared/score.js';
import { scoreHash } from '../../src/shared/hash.js';

test('worst allowed three-actor 24-key score meets warm rendering targets', async ({ page, operator }, info) => {
  await page.goto('/rehearsal'); await page.getByRole('combobox', { name: 'Scene', exact: true }).selectOption('TM04');
  const record = await (await page.request.get('/api/operator/scenes/TM04/score')).json();
  const score: MotionScoreV1 = { version: 1, durationMs: 6000, stage: { width: 1000, height: 700 }, actors: record.score.actors.map((actor: any, index: number) => ({
    id: actor.id, shape: actor.shape, color: actor.color,
    keyframes: Array.from({ length: 24 }, (_, key) => ({ tMs: Math.round(key * 6000 / 23), x: 220 + index * 280 + 30 * Math.sin(key / 2), y: 150 + index * 200, rotationDeg: 15 * Math.sin(key / 2), scaleX: 1 + .08 * Math.sin(key / 2), scaleY: 1 - .08 * Math.sin(key / 2), easing: key === 23 ? 'linear' : 'easeInOut' })),
  })) };
  await page.getByText('Import a score for local validation', { exact: true }).click();
  await page.getByRole('textbox', { name: 'MotionScoreV1 JSON' }).fill(JSON.stringify(score)); await page.getByRole('button', { name: 'Validate score' }).click();
  await expect(page.getByRole('status')).toHaveText('Imported score is now in rehearsal.');
  await page.getByRole('button', { name: 'Show validator details' }).click(); await expect(page.getByText(scoreHash(score), { exact: true })).toBeVisible();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.evaluate(() => {
    const state = { frames: [] as number[], firstFrames: [] as number[], start: 0, lastRaf: 0, first: false, measuring: false }; (window as any).__tmPerformance = state;
    const original = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => original(timestamp => { state.lastRaf = performance.now(); callback(timestamp); });
    new MutationObserver(records => {
      if (!state.measuring || !records.some(r => (r.target as Element).hasAttribute('data-actor'))) return;
      const now = performance.now(); state.frames.push(now - state.lastRaf);
      if (!state.first) { state.first = true; state.firstFrames.push(now - state.start); }
    }).observe(document.querySelector('svg.stage')!, { attributes: true, subtree: true, attributeFilter: ['transform'] });
  });
  for (let trial = 0; trial < 3; trial++) {
    await page.evaluate(() => { const state = (window as any).__tmPerformance; state.start = performance.now(); state.first = false; state.measuring = true; ([...document.querySelectorAll('button')].find(b => b.textContent === 'Play') as HTMLButtonElement).click(); });
    await expect.poll(() => page.evaluate(() => (window as any).__tmPerformance.firstFrames.length)).toBe(trial + 1);
    if (trial < 2) {
      await expect.poll(async () => Number(await page.locator('input[type=range]').inputValue())).toBeGreaterThan(300);
      await page.getByRole('button', { name: 'Pause', exact: true }).click(); await page.evaluate(() => { (window as any).__tmPerformance.measuring = false; });
      await page.getByRole('button', { name: 'Reset', exact: true }).click(); await expect(page.locator('input[type=range]')).toHaveValue('0');
    } else await expect(page.locator('input[type=range]')).toHaveValue('6000', { timeout: 10000 });
  }
  const measurements = await page.evaluate(() => { const s = (window as any).__tmPerformance; s.measuring = false; return { frameWorkMs: s.frames as number[], warmPlayToFirstFrameMs: s.firstFrames as number[], visibility: document.visibilityState }; });
  const sorted = measurements.frameWorkMs.slice().sort((a, b) => a - b), p95 = sorted[Math.ceil(sorted.length * .95) - 1];
  const receipt = { browser: info.project.name, node: process.version, hardware: { cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryBytes: totalmem(), platform: process.platform, arch: process.arch }, score, measurements, p95FrameWorkMs: p95, method: 'RAF entry to observed SVG transform commit, including React scheduling and commit. Warm click is dispatched in the page. Headless production frontend on loopback; physical devices NOT RUN.' };
  writeFileSync(browserArtifact(`${info.project.name}-performance.json`), JSON.stringify(receipt, null, 2));
  expect(measurements.visibility).toBe('visible'); expect(sorted.length).toBeGreaterThan(100);
  expect(Math.max(...measurements.warmPlayToFirstFrameMs)).toBeLessThanOrEqual(100); expect(p95).toBeLessThanOrEqual(8);
});
