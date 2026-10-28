import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import { test, expect, type Page } from '@playwright/test';
import specimen from '../../Tiny_Mime_Review_Source_Pack/supplements/contract-fixtures/TM01.first-score.json' with { type: 'json' };
import { buildCapture, type CaptureRecord } from '../../src/server/operator/capture.js';
import { type CaptureTraceState } from '../../src/server/operator/captureTrace.js';
import { scoreHash } from '../../src/shared/hash.js';
import type { MotionScoreV1 } from '../../src/shared/score.js';

function capture(observed: boolean) {
  const roundId = '11111111-1111-4111-8111-111111111111', requestId = '22222222-2222-4222-8222-222222222222';
  const score = structuredClone(specimen) as MotionScoreV1;
  const record: CaptureRecord = {
    round: { roundId, revision: 3, expiresAt: '2026-10-08T19:00:00Z', mode: 'private_play', executionMode: 'fixture', phase: 'play', state: 'revealed', actions: [],
      acts: [1, 2].map(attempt => ({ attempt: attempt as 1 | 2, score, scoreHash: scoreHash(score), source: attempt === 1 ? 'authored_fixture' : 'mock_fixture', authorship: attempt === 1 ? { authoringMethod: 'agent_assisted', humanReview: 'not_run' } : null })),
      guesses: [{ attempt: 1, text: 'A synthetic first guess.' }, { attempt: 2, text: 'A synthetic final guess.' }], reveal: { target: 'Awkward passing' }, generation: { acceptedAt: '2026-10-08T18:00:00Z', deadlineAt: '2026-10-08T18:00:15Z', status: 'ready', failure: null } },
    creatorOwned: true, publicationPermission: null, actualWaitMs: 0, selectedExample: false, createdAt: '2026-10-08T18:02:00Z', versions: { engine: 'svg-shapes-v1', contact: 'noncontact-v1', meaning: 'TM01-v1', prompt: null, model: null }, timeline: [],
  };
  if (observed) {
    const states: CaptureTraceState[] = [];
    const add = (atMs: number, patch: Partial<CaptureTraceState>) => states.push({ reason: 'initial', phase: 'awaiting_guess1', waiting: false, hidden: false, attempt: 1, scoreHash: scoreHash(score), positionMs: 0, playing: false, mode: 'frame_step', replay: false, submissionRequestId: null, ...states.at(-1), ...patch, seq: states.length, atMs });
    add(0, {}); add(0, { reason: 'step', positionMs: 8000 });
    add(1000, { reason: 'submission', phase: 'generating_act2', waiting: true, submissionRequestId: requestId });
    add(1000, { reason: 'phase', phase: 'awaiting_guess2', waiting: false, attempt: 2, positionMs: 0 });
    add(1000, { reason: 'play', playing: true, mode: 'motion' });
    add(2000, { reason: 'pause', playing: false, positionMs: 1000 });
    add(2000, { reason: 'submission', submissionRequestId: roundId });
    add(2000, { reason: 'reveal', phase: 'revealed' });
    record.trace = { requestId, documentId: roundId, states };
  }
  const result = buildCapture(record, { requestId, roundId, includeGuessText: true, timing: 'original', shortenedWaitMs: null });
  if ('error' in result) throw new Error(result.error.code);
  const files = unzipSync(result.bytes);
  return { html: strFromU8(files['replay.html']), manifest: result.manifest };
}

async function snapshot(page: Page) {
  return page.evaluate(() => ({ label: document.getElementById('label')!.textContent, message: document.getElementById('message')!.textContent, reveal: document.getElementById('reveal')!.textContent, position: document.getElementById('position')!.textContent, stage: document.getElementById('stage')!.innerHTML, segment: (document.getElementById('segment') as HTMLSelectElement).value }));
}

for (const observed of [false, true]) for (const width of [320, 390]) {
  test(`offline ${observed ? 'observed' : 'reconstructed'} navigation preserves equal-time order at ${width}px`, async ({ page, context }, info) => {
    const { html, manifest } = capture(observed);
    expect(manifest.timelineBasis).toBe(observed ? 'observed_creator_trace' : 'score_reconstruction');
    expect(manifest.exportedTimeline.some(s => s.durationMs === 0)).toBe(true);
    const directory = resolve(process.env.TINY_MIME_EVIDENCE_ROOT ?? 'artifacts', 'verification/replay-navigation', `${info.project.name}-${observed ? 'observed' : 'reconstructed'}-${width}`);
    mkdirSync(directory, { recursive: true }); const file = resolve(directory, 'replay.html'); writeFileSync(file, html);
    writeFileSync(resolve(directory, 'capture-manifest.json'), JSON.stringify(manifest, null, 2));
    const errors: string[] = [], remote: string[] = [];
    page.on('pageerror', error => errors.push(error.message)); page.on('request', request => { if (!request.url().startsWith('file:')) remote.push(request.url()); });
    await context.setOffline(true); await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(pathToFileURL(file).href);
    await expect(page.locator('#motion')).not.toBeChecked(); await expect(page.locator('#segment')).toHaveValue('0');
    const initial = await snapshot(page); await page.waitForTimeout(100); expect(await snapshot(page)).toEqual(initial);
    const stage = await page.locator('#stage').boundingBox(); expect(stage!.width).toBe(width - 32); expect(stage!.height).toBeCloseTo((width - 32) * .7, 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    for (const control of ['#play', '#replay', '#previous-step', '#timeline', '#segment', '#previous-segment', '#next-segment']) {
      const box = await page.locator(control).boundingBox(); expect(box!.height).toBeGreaterThanOrEqual(44); expect(box!.width).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(async () => { await document.fonts.ready; const faces = await document.fonts.load('650 32px "Bricolage Grotesque"'); return faces.length > 0 && faces.every(face => face.status === 'loaded'); })).toBe(true);
    const segments = [initial];
    for (let index = 1; index < manifest.exportedTimeline.length; index++) {
      await page.locator('#next-segment').click(); await expect(page.locator('#segment')).toHaveValue(String(index)); segments.push(await snapshot(page));
    }
    await expect(page.locator('#reveal')).toContainText('Awkward passing'); await expect(page.locator('#next-segment')).toBeDisabled();
    for (let index = segments.length - 2; index >= 0; index--) { await page.locator('#previous-segment').click(); expect(await snapshot(page)).toEqual(segments[index]); }
    await expect(page.locator('#previous-segment')).toBeDisabled();
    const frames = [await snapshot(page)];
    for (let index = 0; index < 80 && await page.locator('#play').textContent() !== 'Restart frames'; index++) { await page.locator('#play').click(); frames.push(await snapshot(page)); }
    await expect(page.locator('#play')).toHaveText('Restart frames');
    for (let index = frames.length - 2; index >= 0; index--) { await page.locator('#previous-step').click(); expect(await snapshot(page)).toEqual(frames[index]); }
    await expect(page.locator('#reveal')).toHaveText(''); await expect(page.locator('#message')).toHaveText('');
    await page.locator('#segment').selectOption(String(manifest.exportedTimeline.length - 1)); await expect(page.locator('#reveal')).toContainText('Awkward passing');
    const timeline = page.getByRole('slider', { name: 'Exported timeline (seconds)' });
    await timeline.focus(); await timeline.press('Home'); expect(await snapshot(page)).toEqual(initial); await expect(page.locator('#reveal')).toHaveText(''); await expect(page.locator('#message')).toHaveText('');
    await timeline.press('ArrowRight'); await expect(timeline).toHaveValue('0.001');
    const duration = manifest.exportedTimeline.reduce((sum, segment) => sum + segment.durationMs, 0) / 1000;
    await expect(timeline).toHaveAttribute('aria-valuetext', `0.001 of ${duration} seconds in exported timeline`);
    await page.locator('#motion').check(); await page.locator('#play').click(); await expect(page.locator('#play')).toHaveText('Pause');
    await timeline.focus(); await timeline.press('Home'); await expect(page.locator('#play')).toHaveText('Play');
    const paused = await snapshot(page); await page.waitForTimeout(100); expect(await snapshot(page)).toEqual(paused);
    const payload = await page.locator('#payload').textContent();
    expect(JSON.parse(Buffer.from(payload!, 'base64').toString('utf8')).manifest).toEqual(manifest);
    await page.screenshot({ path: resolve(directory, 'navigation.png'), fullPage: true }); expect(errors).toEqual([]); expect(remote).toEqual([]);
  });
}
