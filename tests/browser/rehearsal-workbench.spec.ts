import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';
import { test, expect } from '../support/browser-fixtures.js';

async function openSave(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
}

test('candidate versions preserve exact-score notes, compare, reload and download a private-safe inspection', async ({ page, app, operator }, info) => {
  await page.goto('/rehearsal'); await expect(page.locator('svg.stage')).toBeVisible();
  const authored = await (await page.request.get('/api/operator/scenes/TM01/score')).json();
  await openSave(page);
  await page.getByLabel('Candidate title', { exact: true }).fill('First private version');
  await page.getByRole('slider').fill('1200'); await page.getByLabel('Rehearsal note', { exact: true }).fill('Private timing observation');
  await page.getByRole('button', { name: /Add captured note/ }).click();
  await page.getByRole('button', { name: 'Save new candidate version' }).click();
  await expect(page.getByRole('status')).toContainText('Saved a new immutable candidate version.');
  const first = (await (await page.request.get('/api/operator/candidates')).json()).candidates[0];
  const firstRecord = (await (await page.request.get(`/api/operator/candidates/${first.candidateId}`)).json()).candidate;
  expect(firstRecord.notes).toEqual([{ atMs: 1200, text: 'Private timing observation' }]); expect(firstRecord.scoreHash).toBe(authored.scoreHash);
  await page.getByLabel('Candidate title', { exact: true }).fill('Second private version'); await page.getByRole('button', { name: 'Save new candidate version' }).click();
  await expect.poll(async () => (await (await page.request.get('/api/operator/candidates')).json()).candidates.length).toBe(2);
  const summaries = (await (await page.request.get('/api/operator/candidates')).json()).candidates;
  const second = summaries.find((c: any) => c.candidateId !== first.candidateId); expect(second.parentCandidateId).toBe(first.candidateId);
  expect((await (await page.request.get(`/api/operator/candidates/${first.candidateId}`)).json()).candidate).toEqual(firstRecord);
  await page.screenshot({ path: info.outputPath('workbench-current.png'), fullPage: true });
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download candidate inspection ZIP' }).click();
  const file = await (await download).path(); const zip = unzipSync(readFileSync(file!)); const texts = Object.values(zip).map(value => strFromU8(value)).join('\n');
  expect(texts).not.toContain('Private timing observation'); expect(texts).not.toContain('Second private version'); expect(zip['inspection.html']).toBeDefined();
  const offlineFile = info.outputPath('inspection.html'); writeFileSync(offlineFile, zip['inspection.html']);
  const offline = await page.context().newPage(); const requests: string[] = [], errors: string[] = [];
  await offline.route(/^https?:\/\//, route => { requests.push(route.request().url()); return route.abort(); });
  offline.on('pageerror', error => errors.push(error.message)); await offline.emulateMedia({ reducedMotion: 'reduce' });
  await offline.goto(pathToFileURL(offlineFile).href);
  await expect(offline.locator('#stage > *')).toHaveCount(authored.score.actors.length);
  await expect(offline.getByLabel('Frame by frame')).toBeChecked(); await expect(offline.getByRole('slider')).toHaveValue('0');
  await offline.getByRole('button', { name: 'Next keyframe', exact: true }).click(); await expect(offline.getByRole('slider')).toHaveValue('900');
  expect(requests).toEqual([]); expect(errors).toEqual([]); await offline.close();
  await page.getByRole('button', { name: 'Compare', exact: true }).click(); await page.getByLabel('Compare with', { exact: true }).selectOption('authored');
  await expect(page.locator('.score-comparison')).toBeVisible();
  await page.reload(); await expect(page.locator('.provenance')).toContainText('Saved candidate score'); await expect(page.locator('main.rehearsal')).toHaveAttribute('data-score-hash', second.scoreHash);
  await page.getByRole('button', { name: 'Versions', exact: true }).click(); await page.getByRole('button', { name: `Load First private version (${first.candidateId.slice(0, 8)})` }).click();
  await expect(page.locator('.provenance')).toContainText('Saved candidate score'); await openSave(page);
  await expect(page.getByText('Private timing observation', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Go to 1200 ms', exact: true }).click(); await expect(page.getByRole('slider')).toHaveValue('1200');
  expect(await (await page.request.get('/api/operator/scenes/TM01/score')).json()).toEqual(authored);
});

test('numeric forks validate before activation and expose clickable raw error locations', async ({ page, app, operator }) => {
  await page.goto('/rehearsal'); await expect(page.locator('svg.stage')).toBeVisible();
  await page.getByRole('button', { name: 'Revise', exact: true }).click(); await page.getByRole('button', { name: 'Start edit fork' }).click();
  const original = await page.getByLabel('Keyframe Horizontal position (x)', { exact: true }).inputValue();
  await page.getByLabel('Keyframe Horizontal position (x)', { exact: true }).fill('-1');
  await expect(page.getByRole('button', { name: 'Validate and rehearse fork' })).toBeDisabled();
  await page.getByRole('button', { name: /Inspect BOUNDS/ }).first().click();
  const raw = page.getByRole('textbox', { name: 'MotionScoreV1 JSON' }); await expect(raw).toBeFocused();
  expect(await raw.evaluate((element: HTMLTextAreaElement) => element.value.slice(element.selectionStart, element.selectionEnd))).toBe('-1');
  await expect(page.locator('.validation-location')).toContainText('Actor a');
  await page.getByRole('button', { name: /Undo edit/ }).click(); await expect(page.getByLabel('Keyframe Horizontal position (x)', { exact: true })).toHaveValue(original);
  await page.getByLabel('Keyframe Rotation (degrees)', { exact: true }).fill('1'); await page.getByRole('button', { name: 'Validate and rehearse fork' }).click();
  await expect(page.locator('.provenance')).toContainText('Edited score');
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Restore authored draft' }).click(); await expect(page.locator('.provenance')).toContainText('Authored first take');
});

test('dirty notes block an unconfirmed scene switch and looping stays within the selected interval', async ({ page, app, operator }) => {
  await page.goto('/rehearsal'); await expect(page.locator('svg.stage')).toBeVisible(); await openSave(page);
  await page.getByLabel('Rehearsal note', { exact: true }).fill('Keep this unsaved note');
  let prompted = false; page.once('dialog', dialog => { prompted = true; return dialog.dismiss(); }); await page.getByLabel('Scene', { exact: true }).selectOption('TM09');
  expect(prompted).toBe(true);
  await expect(page.getByLabel('Scene', { exact: true })).toHaveValue('TM01'); await expect(page.getByLabel('Rehearsal note', { exact: true })).toHaveValue('Keep this unsaved note');
  page.once('dialog', dialog => dialog.accept()); await page.getByLabel('Scene', { exact: true }).selectOption('TM09'); await expect(page.getByLabel('Scene', { exact: true })).toHaveValue('TM09');
  await page.getByText('Loop a rehearsal interval', { exact: true }).click();
  await page.getByLabel('Loop start (ms)', { exact: true }).fill('1000'); await page.getByLabel('Loop end (ms)', { exact: true }).fill('1500'); await page.getByLabel('Loop selected interval', { exact: true }).check();
  await expect(page.getByRole('slider')).toHaveValue('0'); await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(async () => Number(await page.getByRole('slider').inputValue())).toBeGreaterThanOrEqual(1000);
  await page.waitForTimeout(750); const time = Number(await page.getByRole('slider').inputValue()); expect(time).toBeGreaterThanOrEqual(1000); expect(time).toBeLessThan(1500);
  await page.getByRole('button', { name: 'Pause', exact: true }).click(); const paused = await page.getByRole('slider').inputValue(); await page.waitForTimeout(100); await expect(page.getByRole('slider')).toHaveValue(paused);
});

test('reduced motion stays manual when an interval is enabled', async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/rehearsal'); await expect(page.locator('svg.stage')).toBeVisible();
  await page.getByText('Loop a rehearsal interval', { exact: true }).click(); await page.getByLabel('Loop selected interval', { exact: true }).check();
  await page.getByRole('button', { name: 'Next frame', exact: true }).click(); await page.waitForTimeout(100); await expect(page.getByRole('slider')).toHaveValue('900'); await expect(page.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0);
});

test('numeric editing preserves independent import text and inspection asks before replacing it', async ({ page, app, operator }) => {
  await page.goto('/rehearsal'); await expect(page.locator('svg.stage')).toBeVisible();
  await page.getByText('Import a score for local validation', { exact: true }).click();
  const raw = page.getByRole('textbox', { name: 'MotionScoreV1 JSON' }), draft = '{"unfinished":'; await raw.fill(draft);
  await page.getByRole('button', { name: 'Revise', exact: true }).click(); await page.getByRole('button', { name: 'Start edit fork' }).click();
  await page.getByLabel('Keyframe Rotation (degrees)', { exact: true }).fill('1'); await page.getByRole('button', { name: 'Validate and rehearse fork' }).click();
  await expect(page.locator('.provenance')).toContainText('Edited score'); await expect(raw).toHaveValue(draft);
  await expect(page.getByText('Valid score. Ready for rehearsal.', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Revise', exact: true }).click(); await page.getByRole('button', { name: 'Start edit fork' }).click(); await page.getByLabel('Keyframe Horizontal position (x)', { exact: true }).fill('-1');
  page.once('dialog', dialog => dialog.dismiss()); await page.getByRole('button', { name: /Inspect BOUNDS/ }).first().click(); await expect(raw).toHaveValue(draft);
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: /Inspect BOUNDS/ }).first().click(); await expect(raw).not.toHaveValue(draft); await expect(raw).toBeFocused();
});

test('a lost save acknowledgement retries the same immutable version', async ({ page, app, operator }) => {
  await page.goto('/rehearsal'); await expect(page.locator('svg.stage')).toBeVisible(); await openSave(page); await page.getByLabel('Candidate title', { exact: true }).fill('Recover one save');
  await page.route('**/api/operator/candidates', async route => { if (route.request().method() === 'POST') { await route.fetch(); await route.abort(); } else await route.continue(); }, { times: 1 });
  await page.getByRole('button', { name: 'Save new candidate version' }).click(); await expect(page.getByRole('alert')).toContainText('Save could not complete');
  await page.getByRole('button', { name: 'Save new candidate version' }).click(); await expect(page.getByRole('status')).toContainText('Saved a new immutable candidate version.');
  expect((await (await page.request.get('/api/operator/candidates')).json()).candidates).toHaveLength(1);
});

test('an old candidate list cannot overwrite a refresh after saving', async ({ page, app, operator }) => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let held = false;
  await page.route('**/api/operator/candidates', async route => {
    if (!held && route.request().method() === 'GET') { held = true; const response = await route.fetch(); await gate; await route.fulfill({ response }); }
    else await route.continue();
  });
  try {
    await page.goto('/rehearsal'); await expect(page.locator('svg.stage')).toBeVisible(); await expect.poll(() => held).toBe(true);
    await openSave(page); await page.getByLabel('Candidate title', { exact: true }).fill('Newest list'); await page.getByRole('button', { name: 'Save new candidate version' }).click();
    await page.getByRole('button', { name: 'Versions', exact: true }).click(); await expect(page.getByText('Saved candidates and version history (1)', { exact: true })).toBeVisible(); release(); await expect(page.getByRole('button', { name: /^Load Newest list/ })).toBeVisible();
  } finally { release(); }
});

for (const width of [390, 320]) test(`numeric editing and review notes fit a ${width}px viewport`, async ({ page, app, operator }) => {
  await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/rehearsal'); await expect(page.locator('svg.stage')).toBeVisible();
  await openSave(page); await page.getByLabel('Candidate title', { exact: true }).fill('A narrow review'); await page.getByLabel('Rehearsal note', { exact: true }).fill('A review note that remains attached to this score.');
  await page.getByRole('button', { name: /Add captured note/ }).click();
  await page.getByRole('button', { name: 'Revise', exact: true }).click(); await page.getByRole('button', { name: 'Start edit fork' }).click();
  await page.getByLabel('Edit actor', { exact: true }).selectOption('1'); await page.getByLabel('Edit keyframe', { exact: true }).selectOption('2');
  await page.getByLabel('Keyframe Rotation (degrees)', { exact: true }).fill('1'); await page.getByLabel('Keyframe Rotation (degrees)', { exact: true }).focus(); await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('INPUT');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Validate and rehearse fork' })).toBeDisabled();
  await page.getByRole('button', { name: 'Save source notes and keep fork', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Validate and rehearse fork' })).toBeEnabled();
});

test('entering a note pauses and keeps its chosen frame while typing', async ({ page, app, operator }, info) => {
  await page.goto('/rehearsal'); await expect(page.locator('svg.stage')).toBeVisible();
  await openSave(page); await page.getByRole('slider').fill('1200');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(async () => Number(await page.getByRole('slider').inputValue())).toBeGreaterThan(1400);
  await page.getByLabel('Rehearsal note', { exact: true }).focus();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  const chosen = await page.getByRole('slider').inputValue();
  await page.getByLabel('Rehearsal note', { exact: true }).pressSequentially('A beat noticed before typing.', { delay: 30 });
  await page.screenshot({ path: info.outputPath('note-editor.png'), fullPage: true });
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await expect(page.getByRole('slider')).toHaveValue(chosen);
});


for (const width of [1280, 320]) test(`capture a playing frame and preserve its note through save and load at ${width}px`, async ({ page, app, operator }, info) => {
  await page.setViewportSize({ width, height: 1000 });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text()); });
  await page.goto('/rehearsal'); await expect(page).toHaveTitle(/Tiny Mime/); await expect(page.locator('svg.stage')).toBeVisible(); await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await page.getByRole('slider').fill('1200'); await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(async () => Number(await page.getByRole('slider').inputValue())).toBeGreaterThan(1400);
  await page.getByRole('button', { name: 'Note this frame', exact: true }).click();
  const input = page.getByLabel('Rehearsal note', { exact: true }); await expect(input).toBeFocused();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  const chosen = await page.getByRole('slider').inputValue(); expect(Number(chosen)).toBeGreaterThan(1400); expect(Number(chosen)).toBeLessThan(8000);
  const frame = page.locator('.note-frame'); await expect(frame).toContainText(`Note frame: ${chosen} ms`);
  const scoreHash = (await page.locator('.candidate-workbench .hash').last().textContent())!.replace('Score hash: ', '');
  await input.pressSequentially('The reply starts on this beat.', { delay: 30 });
  await expect(input).toBeFocused(); await expect(page.getByRole('slider')).toHaveValue(chosen);
  await page.getByLabel('Candidate title', { exact: true }).fill('Captured playing beat');
  await expect(page.getByRole('button', { name: 'Save new candidate version', exact: true })).toBeDisabled();
  await input.focus(); await expect(frame).toContainText(`Note frame: ${chosen} ms`);
  await page.screenshot({ path: info.outputPath('captured-note.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('slider').fill('4200'); await expect(frame).toContainText(`Note frame: ${chosen} ms`);
  await page.getByRole('button', { name: 'Return to note frame', exact: true }).click(); await expect(page.getByRole('slider')).toHaveValue(chosen);
  page.once('dialog', dialog => dialog.dismiss()); await page.getByLabel('Scene', { exact: true }).selectOption('TM09');
  await expect(input).toHaveValue('The reply starts on this beat.'); await expect(frame).toContainText(`Note frame: ${chosen} ms`);
  await page.getByRole('button', { name: /Add captured note/ }).click(); await page.getByRole('button', { name: 'Save new candidate version', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Saved a new immutable candidate version.');
  const first = (await (await page.request.get('/api/operator/candidates')).json()).candidates[0];
  const saved = (await (await page.request.get(`/api/operator/candidates/${first.candidateId}`)).json()).candidate;
  expect(saved.scoreHash).toBe(scoreHash); expect(saved.notes).toEqual([{ atMs: Number(chosen), text: 'The reply starts on this beat.' }]);
  await page.reload(); await page.getByRole('button', { name: 'Versions', exact: true }).click();
  await page.getByRole('button', { name: `Load Captured playing beat (${first.candidateId.slice(0, 8)})`, exact: true }).click(); await openSave(page);
  await expect(page.getByText('The reply starts on this beat.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: `Go to ${chosen} ms`, exact: true }).click(); await expect(page.getByRole('slider')).toHaveValue(chosen);
  expect((await (await page.request.get(`/api/operator/candidates/${first.candidateId}`)).json()).candidate).toEqual(saved);
  expect(errors).toEqual([]);
});

test('draft frame changes only on explicit capture and survives rejected score replacements', async ({ page, app, operator }) => {
  await page.goto('/rehearsal'); await expect(page.locator('svg.stage')).toBeVisible(); await page.getByRole('slider').fill('1200');
  await page.getByRole('button', { name: 'Note this frame', exact: true }).click();
  const input = page.getByLabel('Rehearsal note', { exact: true }), frame = page.locator('.note-frame');
  await expect(input).toBeFocused(); await input.fill('Keep the captured observation.');
  await page.getByRole('slider').fill('2300'); await input.focus(); await expect(frame).toContainText('Note frame: 1200 ms');
  await input.fill(''); await input.pressSequentially('Keep the captured observation.'); await expect(frame).toContainText('Note frame: 1200 ms');
  await page.getByRole('button', { name: 'Revise', exact: true }).click(); await page.getByRole('button', { name: 'Start edit fork' }).click();
  await page.getByLabel('Keyframe Rotation (degrees)', { exact: true }).fill('1');
  await expect(page.getByRole('button', { name: 'Validate and rehearse fork' })).toBeDisabled(); await expect(input).toHaveValue('Keep the captured observation.'); await expect(frame).toContainText('Note frame: 1200 ms');
  await page.getByRole('button', { name: 'Discard edit fork' }).click();
  const authored = await (await page.request.get('/api/operator/scenes/TM01/score')).json();
  await page.getByText('Import a score for local validation', { exact: true }).click(); await page.getByRole('textbox', { name: 'MotionScoreV1 JSON' }).fill(JSON.stringify(authored.score));
  page.once('dialog', dialog => dialog.dismiss()); await page.getByRole('button', { name: 'Validate score', exact: true }).click();
  await expect(input).toHaveValue('Keep the captured observation.'); await expect(frame).toContainText('Note frame: 1200 ms');
  await page.getByRole('slider').fill('3400'); await page.getByRole('button', { name: 'Note this frame', exact: true }).click();
  await expect(input).toBeFocused(); await expect(frame).toContainText('Note frame: 3400 ms'); await expect(input).toHaveValue('Keep the captured observation.');
  await page.getByRole('button', { name: /Add captured note/ }).click(); await expect(page.getByRole('button', { name: 'Go to 3400 ms', exact: true })).toBeVisible();
});
