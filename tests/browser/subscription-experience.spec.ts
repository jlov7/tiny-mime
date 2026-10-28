import { test, expect, fixtureRound, firstGuess, secondGuess } from '../support/browser-fixtures.js';
import { unlockDestination } from '../../src/client/routes.js';

test('restore authored draft cancels a stale import and restores its exact hash', async ({ page, app, operator }) => {
  await page.goto('/rehearsal'); await expect(page.locator('svg.stage')).toBeVisible();
  const record = await (await page.request.get('/api/operator/scenes/TM01/score')).json();
  const score = structuredClone(record.score); score.actors.forEach((actor: any) => actor.keyframes.forEach((key: any) => { key.rotationDeg += 5; }));
  await page.getByText('Import a score for local validation', { exact: true }).click();
  await page.getByRole('textbox', { name: 'MotionScoreV1 JSON' }).fill(JSON.stringify(score));
  await page.getByRole('button', { name: 'Validate score', exact: true }).click();
  await expect(page.locator('.provenance')).toContainText('Imported score');
  await expect(page.getByRole('link', { name: 'Use authored scene in creator capture' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Show validator details' }).click();
  await expect(page.locator('dd.hash')).not.toHaveText(record.scoreHash);
  let prompt = ''; page.once('dialog', async dialog => { prompt = dialog.message(); await dialog.accept(); });
  await page.getByRole('button', { name: 'Restore authored draft' }).click();
  expect(prompt).toContain('Discard unsaved rehearsal edits, import text and notes?');
  await expect(page.locator('dd.hash')).toHaveText(record.scoreHash); await expect(page.locator('.provenance')).toContainText('Authored first take');
  const raw = page.getByRole('textbox', { name: 'MotionScoreV1 JSON' });
  if (!await raw.isVisible()) await page.getByText('Import a score for local validation', { exact: true }).click();
  await expect(raw).toHaveValue(''); await raw.fill(JSON.stringify(score));
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  await page.route('**/api/operator/scores/validate', async route => { calls++; const response = await route.fetch(); await gate; await route.fulfill({ response }); });
  try {
    await page.getByRole('button', { name: 'Validate score', exact: true }).click(); await expect(page.getByRole('button', { name: 'Validating score…' })).toBeVisible();
    const response = page.waitForResponse('**/api/operator/scores/validate');
    prompt = ''; page.once('dialog', async dialog => { prompt = dialog.message(); await dialog.accept(); });
    await page.getByRole('button', { name: 'Restore authored draft' }).click();
    expect(prompt).toContain('Discard unsaved rehearsal edits, import text and notes?');
    await expect(page.locator('dd.hash')).toHaveText(record.scoreHash);
    await expect(page.locator('main.rehearsal')).toHaveAttribute('data-score-hash', record.scoreHash);
    release(); await (await response).finished();
    if (!await raw.isVisible()) await page.getByText('Import a score for local validation', { exact: true }).click();
    await expect(raw).toHaveValue(''); await expect(page.getByRole('button', { name: 'Validate score', exact: true })).toBeDisabled();
    await raw.fill(JSON.stringify(score)); await expect(page.getByRole('button', { name: 'Validate score', exact: true })).toBeEnabled();
    await expect(page.locator('dd.hash')).toHaveText(record.scoreHash); await expect(page.locator('.provenance')).toContainText('Authored first take');
    await expect(page.locator('main.rehearsal')).toHaveAttribute('data-score-hash', record.scoreHash); expect(calls).toBe(1);
    expect(await (await page.request.get('/api/operator/scenes/TM01/score')).json()).toEqual(record);
  } finally { release(); }
});

test('matched references clear unrelated target and exclude authored handoff', async ({ page, app, operator }) => {
  await page.goto('/rehearsal'); await expect(page.locator('svg.stage')).toBeVisible();
  await page.getByRole('button', { name: 'View target' }).click(); await expect(page.locator('.annotation')).toBeVisible();
  const comparison = page.getByRole('combobox', { name: 'Comparison', exact: true }); const id = await comparison.locator('option').nth(1).getAttribute('value');
  await comparison.selectOption(id!); await expect(page.locator('svg.stage')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'View target' })).toBeDisabled(); await expect(page.locator('.annotation')).toHaveCount(0);
  await expect(page.locator('.provenance')).toContainText(id!); await expect(page.getByRole('link', { name: 'Use authored scene in creator capture' })).toHaveCount(0);
  await comparison.selectOption(''); await expect(page.getByRole('button', { name: 'View target' })).toHaveAttribute('aria-expanded', 'false');
});

for (const guesses of [0, 1]) test(`early reveal with ${guesses} guesses explains capture and preserves recovery`, async ({ page, app, operator }) => {
  await fixtureRound(page); if (guesses) await firstGuess(page);
  await page.getByRole('button', { name: 'Reveal now' }).click(); await page.getByRole('link', { name: 'Creator capture', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create local replay bundle' })).toBeDisabled();
  await expect(page.getByText('Replay export requires both takes and two complete guesses. This round was revealed early.')).toBeVisible();
  const before = await page.evaluate(() => sessionStorage.getItem('tm_recovery')); let creations = 0; page.on('request', r => { if (r.url().endsWith('/api/operator/creator-rounds')) creations++; });
  await page.getByRole('link', { name: 'Set up a new creator demonstration' }).click(); await expect(page.getByRole('heading', { name: 'Start a permitted example' })).toBeVisible();
  expect(creations).toBe(0); expect(await page.evaluate(() => sessionStorage.getItem('tm_recovery'))).toBe(before);
});

test('authored handoff survives unlock and requires explicit confirmation', async ({ page, app, operator }) => {
  await page.goto('/rehearsal'); await page.getByRole('combobox', { name: 'Scene', exact: true }).selectOption('TM09');
  const link = page.getByRole('link', { name: 'Use authored scene in creator capture' }); await expect(link).toHaveAttribute('href', '/creator/capture?scene=TM09');
  app.advance(60001); await page.request.post('/api/operator/lock', { data: {}, headers: { Origin: 'http://127.0.0.1:4317' } }); await link.click();
  await page.getByRole('link', { name: 'Unlock operator tools', exact: true }).click(); await page.getByLabel('Launch secret', { exact: true }).fill(app.secret());
  await page.getByRole('button', { name: 'Unlock operator tools', exact: true }).click(); await expect(page.getByRole('combobox', { name: 'Authored scene' })).toHaveValue('TM09');
  const start = page.getByRole('button', { name: 'Start creator demonstration' }); await expect(start).toBeDisabled();
  await page.getByRole('checkbox', { name: 'My own demonstration text' }).check(); await expect(start).toBeEnabled();
  expect((await (await page.request.post('/api/session', { data: {}, headers: { Origin: 'http://127.0.0.1:4317' } })).json()).activeRoundId).toBeNull();
  await start.click(); await expect(page.getByRole('heading', { name: 'Take 1 of 2.' })).toBeVisible();
  const roundId = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId);
  expect((await (await page.request.get('/api/rounds/' + roundId)).json()).acts[0].scoreHash).toBe((await (await page.request.get('/api/operator/scenes/TM09/score')).json()).scoreHash);
});

test('scene queries admit only an available catalogue scene', async ({ page, app, operator }) => {
  for (const scene of ['TM07', 'TM99', 'https://example.invalid']) { await page.goto('/creator/capture?scene=' + encodeURIComponent(scene)); await expect(page.getByRole('combobox', { name: 'Authored scene' })).toHaveValue('TM01'); }
  expect(unlockDestination('?next=' + encodeURIComponent('/creator/capture?scene=TM09'))).toBe('/creator/capture?scene=TM09');
  for (const path of ['/creator/capture?scene=TM07', '/creator/capture?scene=TM99', '/creator/capture?scene=TM09&round=61b4a321-b438-436e-a81d-c1c5b5017379', '/creator/capture?scene=TM09&other=x', '//example.invalid/creator/capture?scene=TM09']) expect(unlockDestination('?next=' + encodeURIComponent(path))).toBe('/rehearsal');
});

test('complete creator demonstration still exports a local replay', async ({ page, app, operator }) => {
  await page.goto('/creator/capture?scene=TM09'); await page.getByRole('checkbox', { name: 'My own demonstration text' }).check(); await page.getByRole('button', { name: 'Start creator demonstration' }).click();
  await firstGuess(page); await secondGuess(page); await page.getByRole('link', { name: 'Creator capture', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Set up a new creator demonstration' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Create local replay bundle' }).click(); await expect(page.getByRole('link', { name: 'Save tiny-mime-replay.zip' })).toBeVisible();
});
