import { randomUUID } from 'node:crypto';
import { test, expect, fixtureRound } from '../support/browser-fixtures.js';
import { browserArtifact } from '../support/browser-artifacts.js';
import { listReferences } from '../../src/server/references/index.js';

for (const width of [1280, 390]) test(`first visit has a clear keyboard journey and no mode downloads at ${width}px`, async ({ page, app }, info) => {
  await page.setViewportSize({ width, height: 1000 }); const scripts: string[] = [];
  page.on('request', request => { if (request.resourceType() === 'script') scripts.push(request.url()); });
  await page.goto('/'); await expect(page.getByRole('heading', { name: 'A tiny silent scene.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open directing demo', exact: true })).toBeVisible();
  await expect(page.getByText('No API key is needed.', { exact: false })).toBeVisible();
  expect(scripts.some(url => /\/(Rehearsal|PrivatePlay|CreatorCapture|Study)-/.test(url))).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Tab'); await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter'); await expect(page.locator('#main-content')).toBeFocused();
  await page.getByText('Accessibility and motion controls', { exact: true }).click();
  await expect(page.getByText('This is a visual task about movement.', { exact: false })).toBeVisible();
  await page.screenshot({ path: browserArtifact(`${info.project.name}-quality-home-${width}.png`), fullPage: true });
});

test('unlock returns to the requested capture room without exposing its secret in a URL', async ({ page, app }) => {
  await page.goto('/creator/capture'); await page.getByRole('link', { name: 'Unlock operator tools', exact: true }).click();
  await page.getByLabel('Launch secret', { exact: true }).fill(app.secret()); await page.getByRole('button', { name: 'Unlock operator tools', exact: true }).click();
  await expect(page).toHaveURL('http://127.0.0.1:4317/creator/capture');
  await expect(page.getByRole('heading', { name: 'Keep the whole performance.' })).toBeVisible();
  expect(page.url()).not.toContain(app.secret());
});

test('an unavailable protected chunk offers a recoverable room reload', async ({ page, app, operator }) => {
  await page.route('**/assets/Rehearsal-*.js', route => route.fulfill({ status: 503, body: 'Temporarily unavailable', headers: { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' } })); await page.goto('/rehearsal');
  await expect(page.getByRole('heading', { name: 'This room could not open.' })).toBeVisible();
  await page.unroute('**/assets/Rehearsal-*.js'); await page.getByRole('button', { name: 'Reload the room', exact: true }).click();
  await expect(page.locator('svg.stage')).toBeVisible();
});

test('every comparison key is reachable and each selected preview width is honored', async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/rehearsal');
  await page.getByText('Rehearsal settings', { exact: true }).click();
  for (const reference of listReferences()) {
    await page.getByRole('combobox', { name: 'Comparison', exact: true }).selectOption(reference.id);
    await page.getByText('Frame and key controls', { exact: true }).click();
    const times = [...new Set(reference.variants.flatMap(v => v.score.actors.flatMap(a => a.keyframes.map(k => k.tMs))))].sort((a, b) => a - b);
    for (const time of times.slice(1)) { await page.getByRole('button', { name: 'Next keyframe', exact: true }).click(); await expect(page.getByRole('slider')).toHaveValue(String(time)); }
    for (const width of [358, 288]) {
      await page.getByRole('combobox', { name: 'Stage preview' }).selectOption(String(width));
      await expect.poll(() => page.locator('svg.stage').evaluateAll(nodes => nodes.map(node => Math.round(node.getBoundingClientRect().width)))).toEqual([width, width]);
    }
  }
  await expect(page.getByRole('slider')).toHaveAttribute('aria-valuetext', /seconds$/);
});

test('late validation cannot replace a newly selected scene and busy imports do not duplicate', async ({ page, app, operator }) => {
  await page.goto('/rehearsal'); await expect(page.locator('svg.stage')).toBeVisible();
  const first = await (await page.request.get('/api/operator/scenes/TM01/score')).json();
  const second = await (await page.request.get('/api/operator/scenes/TM09/score')).json();
  await page.getByText('Import a score for local validation', { exact: true }).click(); await page.getByRole('textbox', { name: 'MotionScoreV1 JSON' }).fill(JSON.stringify(first.score));
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let calls = 0;
  await page.route('**/api/operator/scores/validate', async route => { calls++; const response = await route.fetch(); await gate; await route.fulfill({ response }); });
  try {
    await page.getByRole('button', { name: 'Validate score', exact: true }).click(); await expect(page.getByRole('button', { name: 'Validating score…', exact: true })).toBeDisabled();
    let prompt = ''; page.once('dialog', async dialog => { prompt = dialog.message(); await dialog.accept(); });
    const scene = page.getByRole('combobox', { name: 'Scene', exact: true }); await scene.selectOption('TM09');
    expect(prompt).toContain('Discard unsaved rehearsal edits, import text and notes?'); await expect(scene).toHaveValue('TM09');
    await page.getByRole('button', { name: 'Show validator details', exact: true }).click();
    await expect(page.getByText(second.scoreHash, { exact: true })).toBeVisible();
    await expect(page.locator('main.rehearsal')).toHaveAttribute('data-score-hash', second.scoreHash);
    const completed = page.waitForResponse(response => response.url().endsWith('/api/operator/scores/validate'));
    release(); await (await completed).finished();
    await expect(scene).toHaveValue('TM09'); await expect(page.getByText(second.scoreHash, { exact: true })).toBeVisible();
    await expect(page.locator('main.rehearsal')).toHaveAttribute('data-score-hash', second.scoreHash);
    await expect(page.getByText('Imported score · local validation', { exact: false })).toHaveCount(0); expect(calls).toBe(1);
  } finally { release(); }
});

test('draft loading retries retain the intended scene and invalid imports explain the correction', async ({ page, app, operator }) => {
  await page.goto('/rehearsal'); await expect(page.locator('svg.stage')).toBeVisible();
  await page.route('**/api/operator/scenes/TM09/score', route => route.abort(), { times: 1 });
  await page.getByRole('combobox', { name: 'Scene', exact: true }).selectOption('TM09'); await page.getByRole('button', { name: 'Retry rehearsal', exact: true }).click();
  await expect(page.locator('svg.stage')).toBeVisible(); await expect(page.getByRole('combobox', { name: 'Scene', exact: true })).toHaveValue('TM09');
  const record = await (await page.request.get('/api/operator/scenes/TM09/score')).json(); record.score.actors[0].color = 'teal';
  await page.getByText('Import a score for local validation', { exact: true }).click(); await page.getByRole('textbox', { name: 'MotionScoreV1 JSON' }).fill(JSON.stringify(record.score)); await page.getByRole('button', { name: 'Validate score', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Keep the selected scene’s actor IDs'); await expect(page.getByRole('textbox', { name: 'MotionScoreV1 JSON' })).toHaveAttribute('aria-describedby', 'import-errors');
});

test('manual rehearsal mode switching preserves its paused frame', async ({ page, app, operator }) => {
  await page.goto('/rehearsal'); await expect(page.locator('svg.stage')).toBeVisible(); await page.getByText('Frame and key controls', { exact: true }).click(); await page.getByRole('button', { name: 'Next keyframe', exact: true }).click(); const frame = await page.getByRole('slider').inputValue();
  await page.getByRole('button', { name: 'Frame by frame', exact: true }).click(); await expect(page.getByRole('slider')).toHaveValue(frame);
  await page.getByRole('button', { name: 'Play animation', exact: true }).click(); await expect(page.getByRole('slider')).toHaveValue(frame);
});

test('capture preserves a pending mutation and offers its actual recovery journey', async ({ page, app, operator }) => {
  await fixtureRound(page);
  const saved = await page.evaluate(() => { const r = JSON.parse(sessionStorage.getItem('tm_recovery')!); const wall = Date.now(); const m = { version: 1, roundId: r.roundId, requestId: crypto.randomUUID(), kind: 'guess1', revision: 0, submittedWallMs: wall, deadlineWallMs: wall + 15000, lastObservedWallMs: wall, clockUncertain: false }; sessionStorage.setItem('tm_mutation', JSON.stringify(m)); return { m: JSON.stringify(m), r: JSON.stringify(r) }; });
  await page.goto('/creator/capture'); await expect(page.getByRole('link', { name: 'Resume the pending round', exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'Start creator demonstration', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => ({ m: sessionStorage.getItem('tm_mutation'), r: sessionStorage.getItem('tm_recovery') }))).toEqual(saved);
  await page.getByRole('link', { name: 'Resume the pending round', exact: true }).click(); await expect(page.getByRole('button', { name: 'Check for a completed take', exact: true })).toBeVisible();
});

test('capture retains a pending study creation and returns to its original session', async ({ page, app, operator }) => {
  await page.goto('/study'); await page.getByRole('button', { name: 'Start short synthetic study', exact: true }).click(); await expect(page).toHaveURL(/\/study\?session=[0-9a-f-]{36}$/); const session = new URL(page.url()).searchParams.get('session')!;
  const saved = JSON.stringify({ version: 1, requestId: randomUUID(), mode: 'study', executionMode: 'fixture', studySessionId: session, createdWallMs: Date.now() });
  await page.evaluate(value => sessionStorage.setItem('tm_creation', value), saved); await page.goto('/creator/capture');
  await expect(page.getByRole('link', { name: 'Return to your study page', exact: true })).toHaveAttribute('href', '/study?session=' + session); expect(await page.evaluate(() => sessionStorage.getItem('tm_creation'))).toBe(saved);
  await expect(page.getByRole('button', { name: 'Start creator demonstration', exact: true })).toBeDisabled();
});

test('capture reconnect updates controls without sending a creation automatically', async ({ page, context, app, operator }) => {
  await page.goto('/creator/capture'); await page.getByRole('checkbox', { name: 'My own demonstration text' }).check(); const start = page.getByRole('button', { name: 'Start creator demonstration', exact: true }); await expect(start).toBeEnabled();
  let creates = 0; page.on('request', request => { if (request.url().endsWith('/api/operator/creator-rounds')) creates++; });
  await context.setOffline(true); await page.evaluate(() => dispatchEvent(new Event('offline'))); await expect(start).toBeDisabled(); await expect(page.getByText('The local server cannot be reached.', { exact: false })).toBeVisible();
  await context.setOffline(false); await page.evaluate(() => dispatchEvent(new Event('online'))); await expect(start).toBeEnabled(); expect(creates).toBe(0);
});

test('an incomplete owned capture provides a working route back to its round', async ({ page, app, operator }) => {
  await fixtureRound(page); const id = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId); await page.goto('/creator/capture?round=' + id);
  await page.getByRole('link', { name: 'Resume this round in Play', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Take 1 of 2.' })).toBeVisible();
});


test('expired creator access unlocks and reconciles before an explicit new demonstration', async ({ page, app, operator }) => {
  await page.goto('/creator/capture?scene=TM01');
  await page.getByRole('combobox', { name: 'Authored scene', exact: true }).selectOption('TM09');
  const own = page.getByRole('checkbox', { name: 'My own demonstration text', exact: true });
  const start = page.getByRole('button', { name: 'Start creator demonstration', exact: true });
  await own.check(); await expect(start).toBeEnabled();
  const responses: number[] = []; page.on('response', response => { if (response.url().endsWith('/api/operator/creator-rounds')) responses.push(response.status()); });
  app.advance(1800001); await start.click();
  await expect(page.getByRole('heading', { name: 'Operator access has expired or is locked.', exact: true })).toBeVisible();
  await expect(own).toBeChecked(); await expect(page.getByRole('combobox', { name: 'Authored scene', exact: true })).toHaveValue('TM09');
  await expect(start).toBeDisabled(); expect(responses).toEqual([403]);
  const saved = await page.evaluate(() => sessionStorage.getItem('tm_creation'));
  expect(saved).not.toBeNull();
  const unlock = page.getByRole('link', { name: 'Unlock operator tools', exact: true });
  await expect(unlock).toHaveAttribute('href', '/operator-unlock?next=%2Fcreator%2Fcapture%3Fscene%3DTM09');
  await unlock.click(); expect(await page.evaluate(() => sessionStorage.getItem('tm_creation'))).toBe(saved);
  await page.getByLabel('Launch secret', { exact: true }).fill(app.secret());
  const reconciliation = page.waitForResponse(response => response.url().includes('/api/round-requests/'));
  await page.getByRole('button', { name: 'Unlock operator tools', exact: true }).click();
  expect((await reconciliation).status()).toBe(404);
  await expect(page).toHaveURL('http://127.0.0.1:4317/creator/capture?scene=TM09');
  await expect(page.getByRole('status')).toContainText('The creation was not accepted.');
  expect(await page.evaluate(() => sessionStorage.getItem('tm_creation'))).toBeNull();
  expect(responses).toEqual([403]); expect((app.services.rounds as any).rounds.size).toBe(0);
  await own.check(); await start.click();
  await expect(page.getByRole('heading', { name: 'Take 1 of 2.', exact: true })).toBeVisible();
  expect(responses).toEqual([403, 201]); expect((app.services.rounds as any).rounds.size).toBe(1);
});


test('a creator refusal with valid operator access keeps uncertain recovery without an expiry claim', async ({ page, app, operator }) => {
  await page.goto('/creator/capture'); await page.getByRole('checkbox', { name: 'My own demonstration text', exact: true }).check();
  await page.route('**/api/operator/creator-rounds', route => route.fulfill({ status: 403, json: { error: { code: 'FORBIDDEN', retryable: false, requestId: null } } }));
  await page.getByRole('button', { name: 'Start creator demonstration', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('The demonstration result is uncertain.');
  await expect(page.getByRole('heading', { name: 'Operator access has expired or is locked.', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Check creation result', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => sessionStorage.getItem('tm_creation'))).not.toBeNull();
});

test('catalogue authorization expiry preserves its original capture unlock destination', async ({ page, app, operator }) => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/operator/scenes', async route => { await gate; await route.continue(); });
  try {
    const status = page.waitForResponse(response => response.url().endsWith('/api/operator/status') && response.status() === 200);
    await page.goto('/creator/capture?scene=TM09'); await status;
    await expect(page.getByRole('combobox', { name: 'Authored scene', exact: true }).locator('option')).toHaveCount(0);
    app.advance(1800001); release();
    await expect(page.getByRole('heading', { name: 'Operator access has expired or is locked.', exact: true })).toBeVisible();
    const unlock = page.getByRole('link', { name: 'Unlock operator tools', exact: true });
    await expect(unlock).toHaveAttribute('href', '/operator-unlock?next=%2Fcreator%2Fcapture%3Fscene%3DTM09');
    await unlock.click(); await page.getByLabel('Launch secret', { exact: true }).fill(app.secret());
    await page.getByRole('button', { name: 'Unlock operator tools', exact: true }).click();
    await expect(page).toHaveURL('http://127.0.0.1:4317/creator/capture?scene=TM09');
    await expect(page.getByRole('combobox', { name: 'Authored scene', exact: true })).toHaveValue('TM09');
    await expect(page.getByRole('button', { name: 'Start creator demonstration', exact: true })).toBeDisabled();
    expect((app.services.rounds as any).rounds.size).toBe(0);
  } finally { release(); }
});

test('study entry introduces available setup before withdrawal and keeps withdrawal usable', async ({ page, app, operator }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/study');
  const setup = page.getByRole('heading', { name: 'Human study collection is locked.', exact: true });
  const withdrawal = page.getByText('Withdraw local study records', { exact: true });
  await expect(setup).toBeVisible(); await expect(withdrawal).toBeVisible();
  expect((await setup.boundingBox())!.y).toBeLessThan((await withdrawal.boundingBox())!.y);
  await withdrawal.click(); await expect(page.getByRole('textbox', { name: 'Withdrawal code' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete my linked study records', exact: true })).toBeDisabled();
});
