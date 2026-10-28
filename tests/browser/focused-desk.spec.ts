import { test, expect } from '../support/browser-fixtures.js';

for (const capture of ['edit', 'note']) test(`opening ${capture} controls cannot steal a subsequent focus choice`, async ({ page, app, operator }) => {
  await page.goto('/rehearsal'); await expect(page.locator('svg.stage')).toBeVisible();
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.getByRole('button', { name: capture === 'edit' ? 'Edit this moment' : 'Note this frame', exact: true }).click();
  const selected = page.getByLabel(capture === 'edit' ? 'Keyframe Rotation (degrees)' : 'Candidate title', { exact: true });
  await selected.focus();
  await page.clock.runFor(32);
  await expect(selected).toBeFocused();
  await selected.fill(capture === 'edit' ? '1' : 'A deliberately selected title');
  await expect(selected).toHaveValue(capture === 'edit' ? '1' : 'A deliberately selected title');
  if (capture === 'edit') await expect(page.getByLabel('Keyframe Horizontal position (x)', { exact: true })).toHaveValue('250');
  else await expect(page.getByLabel('Rehearsal note', { exact: true })).toHaveValue('');
});

const task = (page: import('@playwright/test').Page, name: string) => page.getByRole('button', { name, exact: true });

test('recovering the prepared take catalogue preserves the active fork, title, notes and time', async ({ page, app, operator }) => {
  let attempts = 0;
  await page.route('**/api/operator/showcases', route => ++attempts === 1 ? route.abort() : route.continue());
  await page.goto('/rehearsal?scene=TM09'); await expect(page.locator('svg.stage')).toBeVisible();
  const sourceHash = await page.locator('main.rehearsal').getAttribute('data-score-hash');
  await page.getByRole('slider').fill('2400'); await task(page, 'Edit this moment').click();
  const key = await page.getByLabel('Edit keyframe', { exact: true }).inputValue();
  await page.getByLabel('Keyframe Rotation (degrees)', { exact: true }).fill('1');
  await task(page, 'Notes').click(); await page.getByLabel('Candidate title', { exact: true }).fill('Keep this directing draft');
  await page.getByLabel('Rehearsal note', { exact: true }).fill('Keep this note at the inspected frame.');
  await task(page, 'Retry prepared takes').click();
  await expect(task(page, 'Prepared second take')).toBeEnabled(); expect(attempts).toBe(2);
  await expect(page.locator('main.rehearsal')).toHaveAttribute('data-score-hash', sourceHash!);
  await expect(page.getByRole('slider')).toHaveValue('2400');
  await expect(page.getByLabel('Candidate title', { exact: true })).toHaveValue('Keep this directing draft');
  await expect(page.getByLabel('Rehearsal note', { exact: true })).toHaveValue('Keep this note at the inspected frame.');
  await expect(page.locator('.note-frame')).toContainText('2400 ms');
  await task(page, 'Compare').click(); await page.getByLabel('Compare with', { exact: true }).selectOption('prepared');
  await expect(page.getByRole('region', { name: 'Score comparison', exact: true })).toBeVisible();
  await task(page, 'Revise').click(); await expect(page.getByLabel('Edit keyframe', { exact: true })).toHaveValue(key);
  await expect(page.getByLabel('Keyframe Rotation (degrees)', { exact: true })).toHaveValue('1');
});

test('the complete key timestamp fits the narrow-phone selector', async ({ page, app, operator }, info) => {
  await page.setViewportSize({ width: 320, height: 844 }); await page.goto('/rehearsal?scene=TM09&take=second');
  await expect(page.locator('svg.stage')).toBeVisible(); await page.getByRole('slider').fill('2400');
  await task(page, 'Edit this moment').click(); await page.evaluate(async () => { await document.fonts.ready; });
  await expect(page.getByText('Editing actor a: violet square.', { exact: true })).toBeVisible();
  const fit = await page.getByLabel('Edit keyframe', { exact: true }).evaluate(element => {
    const select = element as HTMLSelectElement;
    const style = getComputedStyle(select), canvas = document.createElement('canvas'), context = canvas.getContext('2d')!;
    context.font = style.font;
    const text = select.selectedOptions[0].textContent!;
    return { text, required: context.measureText(text).width, available: select.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 24 };
  });
  expect(fit.text).toBe('Key 4 · 2150 ms'); expect(fit.available).toBeGreaterThanOrEqual(fit.required);
  await page.screenshot({ path: info.outputPath('complete-narrow-key-label.png') });
  await page.getByLabel('Edit actor', { exact: true }).selectOption('1');
  await expect(page.getByText('Editing actor b: amber triangle.', { exact: true })).toBeVisible();
});

test('switching tasks keeps the selected edit, title, note and inspected time', async ({ page, app, operator }) => {
  await page.goto('/rehearsal?scene=TM09&take=second'); await expect(page.locator('svg.stage')).toBeVisible();
  await page.getByRole('slider').fill('2400'); await task(page, 'Edit this moment').click();
  const selected = await page.getByLabel('Edit keyframe', { exact: true }).inputValue();
  await page.getByLabel('Keyframe Rotation (degrees)', { exact: true }).fill('1');
  await task(page, 'Notes').click(); await page.getByLabel('Candidate title', { exact: true }).fill('A retained directing decision');
  await page.getByLabel('Rehearsal note', { exact: true }).fill('Keep this unfinished note at its captured moment.');
  await task(page, 'Versions').click(); await expect(page.getByLabel('Rehearsal note', { exact: true })).toBeHidden();
  await task(page, 'Compare').focus(); await page.keyboard.press('Enter');
  await expect(task(page, 'Compare')).toBeFocused(); await expect(task(page, 'Compare')).toHaveAttribute('aria-pressed', 'true');
  await task(page, 'Revise').click(); await expect(page.getByLabel('Edit keyframe', { exact: true })).toHaveValue(selected);
  await expect(page.getByLabel('Keyframe Rotation (degrees)', { exact: true })).toHaveValue('1');
  await expect(task(page, 'Validate and rehearse fork')).toBeDisabled();
  await expect(page.getByRole('slider')).toHaveValue('2400');
  await task(page, 'Notes').click(); await expect(page.getByLabel('Candidate title', { exact: true })).toHaveValue('A retained directing decision');
  await expect(page.getByLabel('Rehearsal note', { exact: true })).toHaveValue('Keep this unfinished note at its captured moment.');
  await expect(page.locator('.note-frame')).toContainText('2400 ms');
});

test('main-stage comparison pauses its source and a valid fork cannot keep an invalid preview', async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.goto('/rehearsal?scene=TM09&take=second');
  const source = page.locator('.active-rehearsal > div:first-child'); const sourceTime = source.locator('input[type="range"]');
  await expect(source.locator('svg.stage')).toBeVisible(); const sourceWidth = (await source.locator('svg.stage').boundingBox())!.width;
  await sourceTime.fill('1200'); await task(page, 'Play').click();
  await expect.poll(async () => Number(await sourceTime.inputValue())).toBeGreaterThan(1300);
  await task(page, 'Compare').click(); await page.getByLabel('Compare with', { exact: true }).selectOption('authored');
  const host = page.locator('.directing-stage-host'); await expect(host.locator('svg.stage:visible')).toHaveCount(1);
  expect(Math.round((await host.locator('svg.stage:visible').boundingBox())!.width)).toBe(Math.round(sourceWidth));
  await expect(source).toBeHidden(); await expect(page.locator('.candidate-workbench svg.stage')).toHaveCount(0);
  const stopped = await sourceTime.inputValue(); await page.waitForTimeout(150); await expect(sourceTime).toHaveValue(stopped);
  await task(page, 'Show second take').click(); await expect(host.locator('figcaption:visible')).toContainText('Active revision');
  await task(page, 'Return to stage').click(); await expect(source).toBeVisible(); await expect(task(page, 'Play')).toBeVisible();
  await page.waitForTimeout(100); await expect(sourceTime).toHaveValue(stopped);
  await task(page, 'Edit this moment').click(); await page.getByLabel('Keyframe Rotation (degrees)', { exact: true }).fill('1');
  await task(page, 'Preview valid fork').click(); await expect(host.locator('svg.stage:visible')).toHaveCount(1);
  await task(page, 'Show second take').click(); await expect(host.locator('figcaption:visible')).toContainText('Unsaved numeric fork');
  await page.getByLabel('Keyframe Horizontal position (x)', { exact: true }).fill('-1');
  await expect(source).toBeVisible(); await expect(host).toBeHidden(); await expect(task(page, 'Validate and rehearse fork')).toBeDisabled();
  await expect(page.locator('.desk-current')).toContainText('Invalid fork'); await expect(task(page, 'Play')).toBeVisible();
});

for (const zoom of [2, 4]) test(`the focused desk reflows at ${zoom * 100}% zoom with keyboard task access`, async ({ page, app, operator }) => {
  await page.setViewportSize({ width: 1280, height: 1000 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/rehearsal'); await expect(page.locator('svg.stage')).toBeVisible();
  await page.evaluate(value => { document.documentElement.style.zoom = String(value); }, zoom);
  await task(page, 'Notes').focus(); await page.keyboard.press('Enter'); await expect(task(page, 'Notes')).toBeFocused();
  await page.getByLabel('Candidate title', { exact: true }).fill('W'.repeat(80));
  await task(page, 'Revise').focus(); await page.keyboard.press('Enter'); await expect(task(page, 'Revise')).toBeFocused();
  await task(page, 'Start edit fork').click(); await page.getByLabel('Keyframe Rotation (degrees)', { exact: true }).fill('1');

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('.desk-current')).toContainText('W'.repeat(80));
});


test('a scene with no prepared take is held and offers an explicit return to its first take', async ({ page, app, operator }) => {
  await page.goto('/rehearsal?scene=TM02&take=second');
  await expect(page.getByRole('alert')).toContainText('prepared second take could not load'); await expect(page.locator('svg.stage')).toHaveCount(0);
  await task(page, 'Authored first take').click(); await expect(page.locator('svg.stage')).toBeVisible();
  await expect(page.locator('.provenance')).toContainText('Authored first take');
});

test('notes after comparison and fork preview keep the visible moment and active score hash', async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/rehearsal?scene=TM09&take=second');
  await expect(page.locator('svg.stage')).toBeVisible(); const activeHash = await page.locator('main.rehearsal').getAttribute('data-score-hash');
  await task(page, 'Compare').click(); await page.getByLabel('Compare with', { exact: true }).selectOption('authored');
  await page.getByRole('slider').fill('2250'); await task(page, 'Notes').focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('slider')).toHaveValue('2250');
  await page.getByLabel('Rehearsal note', { exact: true }).fill('Observed at the comparison moment.');
  await expect(page.locator('.note-frame')).toContainText('2250 ms'); await task(page, 'Add captured note (0/12)').click();
  await page.getByLabel('Candidate title', { exact: true }).fill('Visible comparison moment'); await task(page, 'Save new candidate version').click();
  await expect(page.getByRole('status')).toContainText('Saved a new immutable candidate version.');
  const first = (await (await page.request.get('/api/operator/candidates')).json()).candidates[0];
  const saved = (await (await page.request.get(`/api/operator/candidates/${first.candidateId}`)).json()).candidate;
  expect(saved.scoreHash).toBe(activeHash); expect(saved.notes).toEqual([{ atMs: 2250, text: 'Observed at the comparison moment.' }]);
  await task(page, 'Edit this moment').click(); await page.getByLabel('Keyframe Rotation (degrees)', { exact: true }).fill('1');
  await task(page, 'Preview valid fork').click(); await page.getByRole('slider').fill('3100');
  await task(page, 'Notes').focus(); await page.keyboard.press('Enter'); await expect(page.getByRole('slider')).toHaveValue('3100');
  await page.getByLabel('Rehearsal note', { exact: true }).fill('Observed while previewing the unsaved fork.');
  await expect(page.locator('.note-frame')).toContainText('3100 ms'); await task(page, 'Add captured note (1/12)').click();
  await expect(task(page, 'Save new candidate version')).toBeDisabled();
  await expect(page.locator('main.rehearsal')).toHaveAttribute('data-score-hash', activeHash!);
  await task(page, 'Revise').click(); await expect(page.getByRole('slider')).toHaveValue('3100'); await task(page, 'Discard edit fork').click();
  await task(page, 'Notes').click(); await task(page, 'Save new candidate version').click();
  await expect(page.getByRole('status')).toContainText('Saved a new immutable candidate version.');
  const second = (await (await page.request.get('/api/operator/candidates')).json()).candidates[0];
  const result = (await (await page.request.get(`/api/operator/candidates/${second.candidateId}`)).json()).candidate;
  expect(result.scoreHash).toBe(activeHash); expect(result.notes).toEqual([...saved.notes, { atMs: 3100, text: 'Observed while previewing the unsaved fork.' }]);
});

test('a comparison moment beyond the active clip is clamped before a source note is captured', async ({ page, app, operator }) => {
  const authored = await (await page.request.get('/api/operator/scenes/TM01/score')).json();
  const longer = structuredClone(authored.score); longer.durationMs = 10000;
  longer.actors.forEach((actor: any) => { actor.keyframes.at(-1).tMs = 10000; });
  const response = await page.request.post('/api/operator/candidates', { data: { requestId: crypto.randomUUID(), sceneId: 'TM01', title: 'Longer numeric baseline', score: longer, parentCandidateId: null, notes: [] }, headers: { Origin: 'http://127.0.0.1:4317' } }); expect(response.ok()).toBe(true);
  const baseline = (await response.json()).candidate;
  await page.goto('/rehearsal?scene=TM01'); await expect(page.locator('svg.stage')).toBeVisible();
  await task(page, 'Compare').click(); await page.getByLabel('Compare with', { exact: true }).selectOption(baseline.candidateId);
  const comparison = page.getByRole('region', { name: 'Score comparison', exact: true }); await expect(comparison).toBeVisible();
  await comparison.getByRole('slider').fill('9500'); await task(page, 'Notes').click();
  await expect(page.getByRole('slider')).toHaveValue(String(authored.score.durationMs));
  await page.getByLabel('Rehearsal note', { exact: true }).fill('The active take holds its end frame.');
  await expect(page.locator('.note-frame')).toContainText(`${authored.score.durationMs} ms`);
  await task(page, 'Add captured note (0/12)').click(); await page.getByLabel('Candidate title', { exact: true }).fill('Clamped source observation');
  await task(page, 'Save new candidate version').click(); await expect(page.getByRole('status')).toContainText('Saved a new immutable candidate version.');
  const versions = (await (await page.request.get('/api/operator/candidates')).json()).candidates;
  const saved = (await (await page.request.get(`/api/operator/candidates/${versions[0].candidateId}`)).json()).candidate;
  expect(saved.scoreHash).toBe(authored.scoreHash); expect(saved.notes).toEqual([{ atMs: authored.score.durationMs, text: 'The active take holds its end frame.' }]);
});
