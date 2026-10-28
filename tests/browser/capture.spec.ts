import { captureArtifact } from '../support/browser-artifacts.js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';
import { test, expect, firstGuess, secondGuess } from '../support/browser-fixtures.js';
import { canonicalJson, scoreHash } from '../../src/shared/hash.js';

test('[X05 X07 X08] creator export reopens offline with literal text and labelled original or shortened wait', async ({ page, context, app, operator }, info) => {
  test.setTimeout(65000); await page.goto('/creator/capture'); await page.getByRole('checkbox', { name: 'My own demonstration text' }).check();
  await page.getByRole('button', { name: 'Start creator demonstration' }).click(); await expect(page.getByRole('heading', { name: 'Take 1 of 2.' })).toBeVisible();
  const hostile = '</script><img src=https://example.invalid/x onerror=alert(1)>';
  await firstGuess(page, hostile); await secondGuess(page, 'A literal synthetic interpretation.'); await page.getByRole('link', { name: 'Creator capture', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Include authorized guess text' })).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'Include authorized guess text' }).check();
  const artifacts: { file: string; manifest: any }[] = [];
  for (const timing of ['original', 'shortened'] as const) {
    if (timing === 'shortened') { await page.getByRole('checkbox', { name: 'Create a labelled shortened-wait replay' }).check(); await page.getByRole('spinbutton', { name: 'Exported wait in milliseconds' }).fill('0'); }
    await page.getByRole('button', { name: 'Create local replay bundle' }).click(); const saved = page.waitForEvent('download'); await page.getByRole('link', { name: 'Save tiny-mime-replay.zip' }).click();
    const dir = resolve(captureArtifact(`${info.project.name}-${timing}`)); mkdirSync(dir, { recursive: true }); const zip = resolve(dir, 'tiny-mime-replay.zip'); await (await saved).saveAs(zip);
    const files = unzipSync(readFileSync(zip)); expect(Object.keys(files).sort()).toEqual(['capture-manifest.json', 'replay.html', 'scores/act1.json', 'scores/act2.json']);
    const manifest = JSON.parse(strFromU8(files['capture-manifest.json']!)); expect(manifest.timelineBasis).toBe('observed_creator_trace'); expect(manifest.actualTimeline).not.toBeNull(); expect(manifest.round.executionMode).toBe('fixture'); expect(manifest.consentBasis).toBe('creator_owned'); expect(manifest.timingEdited).toBe(timing === 'shortened');
    expect(manifest.exportedWaitMs).toBe(timing === 'original' ? manifest.actualWaitMs : 0); expect(manifest.operationalOutcome).toEqual({ clientTimeout: false, clockUncertain: false, lateRecovery: false });
    for (const attempt of [1, 2]) { const bytes = strFromU8(files[`scores/act${attempt}.json`]!); const score = JSON.parse(bytes); expect(bytes).toBe(canonicalJson(score)); expect(scoreHash(score)).toBe(manifest.acts[attempt - 1].scoreHash); }
    const html = strFromU8(files['replay.html']!); expect(html).not.toContain(hostile); const file = resolve(dir, 'replay.html'); writeFileSync(file, html); artifacts.push({ file, manifest });
  }
  await context.setOffline(true);
  for (const { file, manifest } of artifacts) {
    const offline = await context.newPage(); const errors: string[] = [], remote: string[] = []; offline.on('pageerror', e => errors.push(e.message)); offline.on('request', r => { if (!r.url().startsWith('file:')) remote.push(r.url()); });
    await offline.goto(pathToFileURL(file).href); await expect(offline.locator('#stage > *')).toHaveCount(2); await expect(offline.locator('#reveal')).toHaveText('');
    expect(await offline.evaluate(async () => { await document.fonts.ready; const faces = await document.fonts.load('650 40px "Bricolage Grotesque"'); return faces.length > 0 && faces.every(face => face.status === 'loaded'); })).toBe(true);
    await expect(offline.locator('#notice')).toContainText(manifest.timingEdited ? 'Waiting shortened' : 'Observed waiting');
    await offline.emulateMedia({ reducedMotion: 'no-preference' }); await offline.locator('#motion').check();
    await offline.getByRole('button', { name: 'Play', exact: true }).click(); await expect(offline.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await offline.emulateMedia({ reducedMotion: 'reduce' }); await expect(offline.locator('#motion')).not.toBeChecked();
    await expect(offline.getByRole('button', { name: 'Next frame or segment', exact: true })).toBeVisible();
    const pausedFrame = await offline.locator('#stage').innerHTML(); const pausedPosition = await offline.locator('#position').textContent();
    await offline.emulateMedia({ reducedMotion: 'no-preference' }); await offline.waitForTimeout(100);
    expect(await offline.locator('#stage').innerHTML()).toBe(pausedFrame); expect(await offline.locator('#position').textContent()).toBe(pausedPosition);
    await expect(offline.locator('#motion')).not.toBeChecked();
    for (let step = 0; step < 12 && await offline.locator('#position').textContent() === pausedPosition; step++) await offline.getByRole('button', { name: 'Next frame or segment' }).click();
    expect(await offline.locator('#position').textContent()).not.toBe(pausedPosition);
    await offline.locator('#motion').check(); await offline.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(offline.getByRole('button', { name: 'Pause', exact: true })).toBeVisible(); await offline.getByRole('button', { name: 'Pause', exact: true }).click();
    for (let i = 0; i < 40 && !(await offline.locator('#message').textContent())?.includes(hostile); i++) await offline.getByRole('button', { name: 'Next frame or segment' }).click();
    await expect(offline.locator('#message')).toContainText(hostile); await expect(offline.locator('img')).toHaveCount(0); await expect(offline.locator('#reveal')).toHaveText('');
    for (let i = 0; i < 70 && await offline.locator('#label').textContent() !== 'Reveal'; i++) await offline.getByRole('button', { name: 'Next frame or segment' }).click();
    await expect(offline.locator('#reveal')).toContainText('The scene was meant to show…'); await offline.getByRole('button', { name: 'Replay from beginning' }).click(); await expect(offline.locator('#reveal')).toHaveText('');
    expect(errors).toEqual([]); expect(remote).toEqual([]); await offline.screenshot({ path: file.replace('replay.html', 'offline-reopened.png'), fullPage: true }); await offline.close();
  }
  expect(app.services.ledger.status().reservedUnknownMicroUsd).toBe(0);
});

test('independent masked fidelity player reopens offline with only one clip', async ({ page, context, app, operator }, info) => {
  await page.goto('/study'); await page.getByRole('button', { name: 'Start short synthetic study' }).click(); await page.getByRole('button', { name: 'Start next round' }).click();
  await expect(page.getByRole('heading', { name: 'Take 1 of 2.' })).toBeVisible();
  const id = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId); const first = await (await page.request.get('/api/rounds/' + id)).json();
  const service = app.services.fixtureStudy; service.recordRound(id, { secondAct: { ...first.acts[0], attempt: 2, source: 'mock_fixture', authorship: null } });
  const run = service.listRuns()[0]!.studyRunId; const exportId = service.createExport('offline-test', { requestId: crypto.randomUUID(), studyRunId: run, format: 'fidelity_bundle' }).exportId;
  const files = unzipSync(service.downloadExport('offline-test', exportId).bytes); const index = JSON.parse(strFromU8(files['review.json']!)); const artifact = index.artifacts[0];
  const dir = resolve(captureArtifact(`${info.project.name}-fidelity`)); mkdirSync(dir, { recursive: true }); const file = resolve(dir, artifact.playerFile); writeFileSync(file, files[artifact.playerFile]!);
  await context.setOffline(true); const offline = await context.newPage(); const errors: string[] = [], remote: string[] = []; offline.on('pageerror', e => errors.push(e.message)); offline.on('request', r => { if (!r.url().startsWith('file:')) remote.push(r.url()); });
  await offline.goto(pathToFileURL(file).href); await expect(offline.locator('#stage > *')).toHaveCount(2); await expect(offline.locator('#meaning')).toContainText('target');
  await offline.getByRole('button', { name: 'Play', exact: true }).click(); await expect.poll(() => offline.locator('#stage > *').first().getAttribute('transform')).not.toBe('translate(180 350) rotate(0) scale(1 1)');
  await offline.getByRole('button', { name: 'Pause', exact: true }).click(); expect(errors).toEqual([]); expect(remote).toEqual([]); await offline.close();
});
