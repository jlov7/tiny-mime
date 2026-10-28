import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';
import { test, expect } from '../support/browser-fixtures.js';
import { buildPairInspection } from '../../src/client/inspection/pairInspection.js';
import { scoreHash } from '../../src/shared/hash.js';
import type { MotionScoreV1 } from '../../src/shared/score.js';
import { sampleScore } from '../../src/shared/sampleScore.js';
import rawScore from '../../src/server/scores/TM01.json' with { type: 'json' };

test('pair inspection ZIP downloads through the app and reopens offline without private metadata', async ({ page, app, operator }, info) => {
  await page.goto('/rehearsal'); await expect(page.locator('svg.stage')).toBeVisible();
  const authored = await (await page.request.get('/api/operator/scenes/TM01/score')).json();
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  await page.getByLabel('Candidate title', { exact: true }).fill('PRIVATE_PAIR_TITLE');
  await page.getByLabel('Rehearsal note', { exact: true }).fill('PRIVATE_PAIR_NOTE');
  await page.getByRole('button', { name: /Add captured note/ }).click();
  await page.getByRole('button', { name: 'Save new candidate version' }).click();
  await expect(page.getByRole('status')).toContainText('Saved a new immutable candidate version.');
  const candidate = (await (await page.request.get('/api/operator/candidates')).json()).candidates[0];
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await page.getByLabel('Compare with', { exact: true }).selectOption('authored');
  const comparison = page.getByRole('region', { name: 'Score comparison' });
  await expect(comparison).toBeVisible();
  const download = page.waitForEvent('download');
  await comparison.getByRole('button', { name: 'Download pair inspection ZIP', exact: true }).click();
  const result = await download; expect(result.suggestedFilename()).toBe('tiny-mime-pair-inspection.zip');
  const files = unzipSync(readFileSync((await result.path())!));
  const text = Object.values(files).map(value => strFromU8(value)).join('\n');
  for (const secret of ['PRIVATE_PAIR_TITLE', 'PRIVATE_PAIR_NOTE', candidate.candidateId]) expect(text).not.toContain(secret);
  const manifest = JSON.parse(strFromU8(files['pair-inspection-manifest.json']));
  expect(manifest.kind).toBe('rehearsal_pair_inspection');
  expect(manifest.baseline.scoreHash).toBe(authored.scoreHash); expect(manifest.revision.scoreHash).toBe(authored.scoreHash);
  const file = info.outputPath('downloaded-pair-inspection.html'); writeFileSync(file, files['pair-inspection.html']);
  const offline = await page.context().newPage(), requests: string[] = [], errors: string[] = [];
  await offline.route(/^https?:\/\//, route => { requests.push(route.request().url()); return route.abort(); });
  offline.on('pageerror', error => errors.push(error.message));
  await offline.goto(pathToFileURL(file).href); await expect(offline.locator('#stage-0 > *')).toHaveCount(authored.score.actors.length);
  await expect(offline.locator('#timeline')).toHaveValue('0'); await expect(offline.locator('#status')).toHaveText('Paused');
  await offline.locator('#next').click(); await expect(offline.locator('#timeline')).toHaveValue('900');
  expect(requests).toEqual([]); expect(errors).toEqual([]); await offline.close();
});

test('offline pair shares exact geometry and time with end holds, phone switching and manual motion preferences', async ({ page }, info) => {
  const baseline = structuredClone(rawScore) as MotionScoreV1, revision = structuredClone(baseline);
  revision.durationMs += 1000; revision.actors.forEach(actor => { actor.keyframes.at(-1)!.tMs = revision.durationMs; });
  const files = unzipSync(buildPairInspection({ score: baseline, scoreHash: scoreHash(baseline), source: 'authored_fixture' }, { score: revision, scoreHash: scoreHash(revision), source: 'imported_score' }));
  const file = info.outputPath('pair-inspection.html'); writeFileSync(file, files['pair-inspection.html']);
  const requests: string[] = [], errors: string[] = [];
  await page.route(/^https?:\/\//, route => { requests.push(route.request().url()); return route.abort(); });
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto(pathToFileURL(file).href);
  await expect(page.getByLabel('Frame by frame')).toBeChecked(); await expect(page.locator('#status')).toHaveText('Paused');
  await page.locator('#play').click(); await expect(page.locator('#timeline')).toHaveValue('900');
  for (const time of [0, 1800, baseline.durationMs, baseline.durationMs + 500, revision.durationMs]) {
    await page.locator('#timeline').fill(String(time));
    for (const [index, score] of [baseline, revision].entries()) {
      const expected = sampleScore(score, time).map(f => `translate(${f.x} ${f.y}) rotate(${f.rotationDeg}) scale(${f.scaleX} ${f.scaleY})`);
      expect(await page.locator(`#stage-${index} > *`).evaluateAll(nodes => nodes.map(node => node.getAttribute('transform')))).toEqual(expected);
    }
  }
  await expect(page.locator('#position-0')).toContainText('End frame'); await page.locator('#play').click(); await expect(page.locator('#timeline')).toHaveValue('0');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('#stage-0')).toBeVisible(); await expect(page.locator('#stage-1')).toBeHidden();
    expect((await page.locator('#stage-0').boundingBox())!.width).toBe(width - 32);
    await page.locator('#take-1').click(); await expect(page.locator('#stage-1')).toBeVisible(); await expect(page.locator('#stage-0')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const selector of ['#take-1', '#play', '#next', '#timeline']) expect((await page.locator(selector).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: info.outputPath(`pair-${width}.png`), fullPage: true }); await page.locator('#take-0').click();
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await expect(page.getByLabel('Frame by frame')).not.toBeChecked();
  await page.locator('#play').focus(); await page.keyboard.press('Enter');
  await expect.poll(async () => Number(await page.locator('#timeline').inputValue())).toBeGreaterThan(100);
  await page.setViewportSize({ width: 1280, height: 900 }); await expect(page.locator('#stage-0')).toBeVisible(); await expect(page.locator('#stage-1')).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' }); await expect(page.locator('#status')).toHaveText('Paused');
  const reduced = await page.locator('#timeline').inputValue(); await page.waitForTimeout(100); await expect(page.locator('#timeline')).toHaveValue(reduced);
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.locator('#play').click();
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.locator('#status')).toHaveText('Paused'); const hidden = await page.locator('#timeline').inputValue();
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(100); await expect(page.locator('#timeline')).toHaveValue(hidden);
  expect(requests).toEqual([]); expect(errors).toEqual([]);
});

test('offline pair completes full motion, keeps focus and can replay unequal-duration scores', async ({ page, context }, info) => {
  const baseline = structuredClone(rawScore) as MotionScoreV1, revision = structuredClone(baseline);
  revision.durationMs += 500; revision.actors.forEach(actor => { actor.keyframes.at(-1)!.tMs = revision.durationMs; });
  const files = unzipSync(buildPairInspection({ score: baseline, scoreHash: scoreHash(baseline), source: 'authored_fixture' }, { score: revision, scoreHash: scoreHash(revision), source: 'imported_score' }));
  const file = info.outputPath('full-motion-pair.html'); writeFileSync(file, files['pair-inspection.html']);
  await context.setOffline(true); await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.goto(pathToFileURL(file).href);
  const play = page.locator('#play'); await expect(page.locator('#timeline')).toHaveValue('0'); await expect(page.locator('#status')).toHaveText('Paused');
  await play.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#status')).toHaveText('Playing');
  await expect(page.locator('#timeline')).toHaveValue(String(revision.durationMs), { timeout: 12000 });
  await expect(page.locator('#status')).toHaveText('Finished'); await expect(play).toHaveText('Replay pair'); await expect(play).toBeFocused();
  for (const [index, score] of [baseline, revision].entries()) expect(await page.locator(`#stage-${index} > *`).evaluateAll(nodes => nodes.map(node => node.getAttribute('transform')))).toEqual(sampleScore(score, score.durationMs).map(frame => `translate(${frame.x} ${frame.y}) rotate(${frame.rotationDeg}) scale(${frame.scaleX} ${frame.scaleY})`));
  await page.keyboard.press('Enter'); await expect(page.locator('#status')).toHaveText('Playing');
  await expect.poll(async () => Number(await page.locator('#timeline').inputValue())).toBeLessThan(revision.durationMs);
  await page.keyboard.press('Enter'); await expect(page.locator('#status')).toHaveText('Paused');
});
