import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { unzipSync } from 'fflate';
import { test, expect } from '@playwright/test';
import { buildInspection } from '../../src/server/operator/inspection.js';
import { getScene } from '../../src/server/operator/sceneBank.js';
import { buildCapture, type CaptureRecord } from '../../src/server/operator/capture.js';

test('offline inspection keeps the complete stage and transport together', async ({ page }, info) => {
  const scene = getScene('TM01')!;
  const files = unzipSync(buildInspection({ candidateId: randomUUID(), sceneId: scene.id, title: 'Private label', scoreHash: scene.scoreHash, parentCandidateId: null, createdAt: '2026-10-26T12:00:00.000Z', noteCount: 0, score: scene.score, notes: [] }));
  const file = info.outputPath('inspection.html'); writeFileSync(file, files['inspection.html']);
  const requests: string[] = [], errors: string[] = [];
  await page.route(/^https?:\/\//, route => { requests.push(route.request().url()); return route.abort(); });
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(pathToFileURL(file).href);
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 844 }]) {
    await page.setViewportSize(viewport); await page.evaluate(() => window.scrollTo(0, 0));
    const stage = await page.locator('#stage').boundingBox(); expect(stage).not.toBeNull();
    expect(stage!.y).toBeGreaterThanOrEqual(0); expect(stage!.y + stage!.height).toBeLessThanOrEqual(viewport.height);
    if (viewport.width < 700) expect(stage!.width).toBe(viewport.width - 32);
    for (const selector of ['#play', '#next', '#timeline', '#frames']) {
      const box = await page.locator(selector).boundingBox(); expect(box).not.toBeNull();
      expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
    await page.locator('#reset').click(); await page.locator('#next').click();
    await expect(page.locator('#timeline')).toHaveValue('900');
    await page.screenshot({ path: info.outputPath(`inspection-${viewport.width}-${viewport.height}.png`), fullPage: true });
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.getByLabel('Frame by frame')).not.toBeChecked();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(async () => Number(await page.locator('#timeline').inputValue())).toBeGreaterThan(900);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.getByRole('button', { name: 'Next frame', exact: true })).toBeVisible();
  const beforeStep = Number(await page.locator('#timeline').inputValue());
  await page.getByRole('button', { name: 'Next frame', exact: true }).click();
  await expect.poll(async () => Number(await page.locator('#timeline').inputValue())).toBeGreaterThan(beforeStep);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  expect(requests).toEqual([]); expect(errors).toEqual([]);
});

test('creator replay keeps its complete stage and primary controls together', async ({ page }, info) => {
  const scene = getScene('TM01')!, roundId = randomUUID();
  const record: CaptureRecord = {
    round: { roundId, revision: 3, expiresAt: '2026-10-26T21:00:00Z', mode: 'private_play', executionMode: 'fixture', phase: 'play', state: 'revealed', actions: [],
      acts: [1, 2].map(attempt => ({ attempt: attempt as 1 | 2, score: scene.score, scoreHash: scene.scoreHash, source: attempt === 1 ? 'authored_fixture' : 'mock_fixture', authorship: attempt === 1 ? scene.authorship : null })),
      guesses: [{ attempt: 1, text: 'First interpretation.' }, { attempt: 2, text: 'Second interpretation.' }], reveal: { target: scene.meaning.target }, generation: { acceptedAt: '2026-10-26T20:00:00Z', deadlineAt: '2026-10-26T20:00:15Z', status: 'ready', failure: null } },
    creatorOwned: true, publicationPermission: null, actualWaitMs: 3000, selectedExample: true, createdAt: '2026-10-26T20:02:00Z', versions: { engine: 'svg-shapes-v1', contact: 'noncontact-v1', meaning: 'TM01-v1', prompt: null, model: null },
    timeline: [{ kind: 'act', attempt: 1, durationMs: scene.score.durationMs, playbackSpeed: 1, replay: false }, { kind: 'guess', attempt: 1, durationMs: 500 }, { kind: 'wait', durationMs: 3000 }, { kind: 'act', attempt: 2, durationMs: scene.score.durationMs, playbackSpeed: 1, replay: false }, { kind: 'guess', attempt: 2, durationMs: 500 }, { kind: 'reveal', durationMs: 1000 }],
  };
  const bundle = buildCapture(record, { requestId: randomUUID(), roundId, includeGuessText: false, timing: 'original', shortenedWaitMs: null });
  if ('error' in bundle) throw new Error(bundle.error.code);
  const file = info.outputPath('replay.html'); writeFileSync(file, unzipSync(bundle.bytes)['replay.html']);
  const requests: string[] = [], errors: string[] = [];
  await page.route(/^https?:\/\//, route => { requests.push(route.request().url()); return route.abort(); });
  page.on('pageerror', error => errors.push(error.message)); await page.goto(pathToFileURL(file).href);
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 844 }]) {
    await page.setViewportSize(viewport); await page.evaluate(() => window.scrollTo(0, 0));
    for (const selector of ['#stage', '#play', '#step', '#motion']) {
      const box = await page.locator(selector).boundingBox(); expect(box).not.toBeNull();
      expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
      if (selector === '#stage' && viewport.width < 700) expect(box!.width).toBe(viewport.width - 32);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
    await page.screenshot({ path: info.outputPath(`replay-${viewport.width}-${viewport.height}.png`), fullPage: true });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.getByRole('button', { name: 'Next frame or segment', exact: true })).toBeVisible();
  await expect(page.locator('#step')).toBeHidden();
  for (let count = 0; count < 80 && await page.locator('#play').textContent() !== 'Restart frames'; count++) await page.locator('#play').click();
  await expect(page.getByRole('button', { name: 'Restart frames', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Restart frames', exact: true }).click();
  await expect(page.locator('#position')).toContainText('0.0 /');
  await expect(page.getByRole('button', { name: 'Next frame or segment', exact: true })).toBeVisible();
  expect(requests).toEqual([]); expect(errors).toEqual([]);
});
