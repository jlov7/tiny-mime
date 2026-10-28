import { test, expect, fixtureRound } from '../support/browser-fixtures.js';
import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';

async function frames(page: Page, attempt: 1 | 2) {
  if (attempt === 2) await page.getByRole('button', { name: 'View next take', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Next frame', exact: true })).toBeVisible();
  const id = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId);
  const round = await (await page.request.get(`/api/rounds/${id}`)).json();
  const times = new Set(round.acts[attempt - 1].score.actors.flatMap((actor: any) => actor.keyframes.map((key: any) => key.tMs)));
  for (let index = 1; index < times.size; index++) await page.getByRole('button', { name: 'Next frame', exact: true }).click();
}

test('the fixture entry unlock names the app and returns to fixture setup', async ({ page, app }) => {
  await page.goto('/');
  await expect(page.getByText('A fixture round rehearses the two-guess interaction', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: 'Try a fixture round', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Unlock Tiny Mime.', exact: true })).toBeVisible();
  await page.getByLabel('Launch secret', { exact: true }).fill(app.secret());
  await page.getByRole('button', { name: 'Unlock operator tools', exact: true }).click();
  await expect(page).toHaveURL('http://127.0.0.1:4317/play');
  await expect(page.getByRole('button', { name: 'Try a fixture round', exact: true })).toBeVisible();
  await expect(page.getByText('A fixture is a prepared demo.', { exact: false })).toContainText('does not adapt to your guess');
});

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) test(`first fixture stage and play control fit before its guide at ${viewport.width}px`, async ({ page, app, operator }) => {
  await page.setViewportSize(viewport); await page.emulateMedia({ reducedMotion: 'no-preference' }); await fixtureRound(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  const stage = page.locator('svg.stage'); const play = page.getByRole('button', { name: 'Play scene', exact: true });
  const guide = page.getByRole('complementary', { name: 'Round guide' });
  await expect(guide.getByRole('heading', { name: 'Fixture round guide', exact: true })).toBeVisible();
  await expect(stage).toBeInViewport({ ratio: 1 }); await expect(play).toBeInViewport({ ratio: 1 });
  const stageBox = (await stage.boundingBox())!; const playBox = (await play.boundingBox())!; const guideBox = (await guide.boundingBox())!;
  expect(stageBox.width / stageBox.height).toBeCloseTo(10 / 7, 2);
  expect(playBox.y).toBeGreaterThanOrEqual(stageBox.y + stageBox.height);
  expect(guideBox.y).toBeGreaterThanOrEqual(playBox.y + playBox.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('manual and preference playback mode changes preserve the paused frame', async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await fixtureRound(page);
  await page.getByRole('button', { name: 'Next frame', exact: true }).click();
  const frame = await page.locator('.stage').innerHTML();
  await page.getByRole('button', { name: 'Play animation', exact: true }).click();
  expect(await page.locator('.stage').innerHTML()).toBe(frame);
  await page.getByRole('button', { name: 'Frame by frame', exact: true }).click();
  expect(await page.locator('.stage').innerHTML()).toBe(frame);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  expect(await page.locator('.stage').innerHTML()).toBe(frame);
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0);
});

test('a mid-scene mode change explains the whole replay needed before guessing', async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await fixtureRound(page); await page.getByRole('button', { name: 'Next frame', exact: true }).click();
  await page.getByRole('button', { name: 'Play animation', exact: true }).click();
  await expect(page.getByText('Viewing mode changed mid-scene.', { exact: false })).toContainText('Use Replay take 1');
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play scene', exact: true })).toBeVisible({ timeout: 12000 });
  await expect(page.getByRole('textbox', { name: 'What’s happening?' })).toBeDisabled();
  const roundId = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId);
  expect(app.services.events.observations(roundId).completedPlays).toHaveLength(0);
  await page.getByRole('button', { name: 'Replay take 1', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'What’s happening?' })).toBeEnabled({ timeout: 12000 });
  expect(app.services.events.observations(roundId).completedPlays).toHaveLength(1);
});

test('a preference change mid-motion keeps the frame and requires complete frame replay', async ({ page, app, operator }) => {
  await fixtureRound(page); await page.getByRole('button', { name: 'Play scene', exact: true }).click(); await page.waitForTimeout(350); await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const frame = await page.locator('svg.stage').innerHTML(); await page.emulateMedia({ reducedMotion: 'reduce' }); expect(await page.locator('svg.stage').innerHTML()).toBe(frame);
  await frames(page, 1); await expect(page.getByRole('textbox', { name: 'What’s happening?' })).toBeDisabled();
  await expect(page.getByText('Viewing mode changed mid-scene.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Replay take 1', exact: true }).click(); await frames(page, 1); await expect(page.getByRole('textbox', { name: 'What’s happening?' })).toBeEnabled();
});

test('study progress and withdrawal stay reachable in an active round', async ({ page, app, operator }) => {
  await page.goto('/study'); await page.getByRole('button', { name: 'Start short synthetic study' }).click();
  await expect(page.getByText('Your withdrawal code:', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Start next round', exact: true }).click();
  await expect(page.getByText('Your withdrawal code:', { exact: false })).toBeVisible();
  await page.getByText('Withdraw local study records', { exact: true }).click();
  await page.getByRole('button', { name: 'Delete my linked study records', exact: true }).click();
  await expect(page.getByText('Linked local study records were deleted.', { exact: false })).toBeVisible();
  expect((app.services.fixtureStudy.db.prepare('SELECT count(*) n FROM fixture_rounds').get() as any).n).toBe(0);
  expect((app.services.rounds as any).jobs.size).toBe(0);
});

test('sticky timeout survives unavailable event delivery, ready recovery and another refresh', async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await fixtureRound(page); await frames(page, 1);
  await page.clock.install();
  let deliverEvents = false;
  await page.route('**/api/rounds/*/events', route => deliverEvents ? route.continue() : route.abort());
  await page.route('**/api/rounds/*/guesses', async route => { await route.fetch(); await page.clock.fastForward(15010); await route.abort(); }, { times: 1 });
  await page.getByRole('textbox', { name: 'What’s happening?' }).fill('A synthetic timing answer'); await page.getByRole('button', { name: 'Send guess', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check for a completed take' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).clientTimeout)).toBe(true);
  const saved = await page.evaluate(() => ({ m: JSON.parse(sessionStorage.getItem('tm_mutation')!), r: JSON.parse(sessionStorage.getItem('tm_recovery')!) }));
  await expect.poll(() => (app.services.rounds as any).rounds.values().next().value.public.generation.status).toBe('ready');
  await page.reload(); await page.getByRole('button', { name: 'Check for a completed take' }).click();
  await expect(page.getByRole('button', { name: 'View next take', exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_mutation')!).requestId)).toBe(saved.m.requestId);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).timeoutEventId)).toBe(saved.r.timeoutEventId);
  await page.getByRole('button', { name: 'Reveal the scene', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'The scene was meant to show…' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Another scene', exact: true })).toBeDisabled();
  await page.reload();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_mutation')!).deadlineWallMs)).toBe(saved.m.deadlineWallMs);
  await expect(page.getByRole('button', { name: 'Check result', exact: true })).toBeVisible(); await page.waitForLoadState('networkidle');
  deliverEvents = true; await page.getByRole('button', { name: 'Check result', exact: true }).click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('tm_mutation'))).toBeNull();
  expect(app.services.events.observations(saved.m.roundId).operationalOutcome).toMatchObject({ clientTimeout: true, clockUncertain: true, lateRecovery: true });
});

for (const mode of ['private', 'study']) test(`acknowledged ${mode} timing stays sticky after refresh without blocking a final guess`, async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  if (mode === 'private') await fixtureRound(page);
  else { await page.goto('/study'); await page.getByRole('button', { name: 'Start short synthetic study', exact: true }).click(); await page.getByRole('button', { name: 'Start next round', exact: true }).click(); }
  await frames(page, 1); await page.clock.install();
  await page.route('**/api/rounds/*/guesses', async route => { await route.fetch(); await page.clock.fastForward(15010); await route.abort(); }, { times: 1 });
  await page.getByRole('textbox', { name: 'What’s happening?' }).fill('A late synthetic first guess'); await page.getByRole('button', { name: 'Send guess', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check for a completed take', exact: true })).toBeVisible();
  await expect.poll(() => (app.services.rounds as any).rounds.values().next().value.public.generation.status).toBe('ready');
  await page.getByRole('button', { name: 'Check for a completed take', exact: true }).click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('tm_mutation'))).toBeNull();
  const proof = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!));
  expect(proof.clientTimeout).toBe(true);
  await page.reload(); await frames(page, 2);
  await page.getByRole('textbox', { name: 'What do you think now?' }).fill('A completed synthetic final guess'); await page.getByRole('button', { name: 'Send final guess', exact: true }).click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('tm_mutation'))).toBeNull();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).timeoutEventId)).toBe(proof.timeoutEventId);
  expect(app.services.events.observations(proof.roundId).operationalOutcome.clientTimeout).toBe(true);
  const next = page.getByRole('button', { name: mode === 'private' ? 'Another scene' : 'Save feedback and continue', exact: true });
  await expect(next).toBeEnabled();
});

test('stale guess reconciles its owned round and retains the draft without resubmission', async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await fixtureRound(page); await frames(page, 1);
  let submissions = 0;
  await page.route('**/api/rounds/*/guesses', async route => { submissions++; if (submissions === 1) { const r = (app.services.rounds as any).rounds.values().next().value; await app.services.rounds.submitGuess({ sessionId: r.ownerId }, r.public.roundId, { requestId: randomUUID(), revision: r.public.revision, attempt: 1, guess: 'Another accepted synthetic answer' }); } await route.continue(); });
  await page.getByRole('textbox', { name: 'What’s happening?' }).fill('Keep this unsent draft'); await page.getByRole('button', { name: 'Send guess', exact: true }).click();
  await expect(page.getByText('The round changed. Your draft was kept.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'View next take', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'What do you think now?' })).toHaveValue('Keep this unsent draft');
  expect(submissions).toBe(1);
});

for (const delayedError of [false, true]) test(`a stale first guess discards rejected timing without poisoning playback${delayedError ? ' after an in-flight error' : ''}`, async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await fixtureRound(page); await frames(page, 1); await page.clock.install();
  const id = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId);
  let held = false, release!: () => void; const gate = new Promise<void>(done => { release = done; });
  if (delayedError) await page.route('**/api/rounds/*/events', async route => {
    if (!route.request().postDataJSON().events.some((event: any) => event.name === 'client_clock_uncertain')) return route.continue();
    const response = await route.fetch(); held = true; await gate; await route.fulfill({ response });
  });
  await page.route('**/api/rounds/*/guesses', async route => {
    const r = (app.services.rounds as any).rounds.get(id);
    await app.services.rounds.submitGuess({ sessionId: r.ownerId }, id, { requestId: randomUUID(), revision: r.public.revision, attempt: 1, guess: 'An alternative accepted synthetic answer' });
    await page.clock.setSystemTime(Date.now() + 5000);
    if (delayedError) { await page.clock.runFor(550); await expect.poll(() => held).toBe(true); }
    await route.continue();
  }, { times: 1 });
  try {
    await page.getByRole('textbox', { name: 'What’s happening?' }).fill('Keep this rejected draft'); await page.getByRole('button', { name: 'Send guess', exact: true }).click();
    await expect(page.getByText('The round changed. Your draft was kept.', { exact: false })).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).clockUncertain)).toBe(false);
    expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).clockUncertainEventId)).toBeNull();
    await expect(page.getByRole('button', { name: 'View next take', exact: true })).toBeVisible();
    await frames(page, 2); release();
    await expect.poll(() => app.services.events.observations(id).completedViews.map(play => play.attempt)).toEqual([1, 2]);
    await expect(page.getByRole('textbox', { name: 'What do you think now?' })).toHaveValue('Keep this rejected draft');
    await page.getByRole('button', { name: 'Send final guess', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'The scene was meant to show…' })).toBeVisible();
    expect(app.services.events.observations(id).operationalOutcome.clockUncertain).toBe(false);
  } finally { release(); }
});

for (const action of ['Reveal now', 'Exit round']) test(`${action} interrupts an unresolved guess and ignores its late response`, async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await fixtureRound(page); await frames(page, 1);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let held = false;
  await page.route('**/api/rounds/*/guesses', async route => { const response = await route.fetch(); held = true; await gate; await route.fulfill({ response }); }, { times: 1 });
  await page.getByRole('textbox', { name: 'What’s happening?' }).fill('An interrupted synthetic guess'); await page.getByRole('button', { name: 'Send guess', exact: true }).click();
  await expect.poll(() => held).toBe(true);
  const interrupt = page.getByRole('button', { name: action, exact: true }); await expect(interrupt).toBeEnabled(); await interrupt.click();
  const terminal = page.getByRole('heading', { name: action === 'Reveal now' ? 'The scene was meant to show…' : 'Thanks for playing.' });
  await expect(terminal).toBeVisible(); release(); await expect(terminal).toBeVisible();
});

test('expiry warning resets after an accepted action and a local deadline preserves replay and draft', async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await fixtureRound(page); await frames(page, 1); await page.clock.install();
  app.advance(28 * 60000 + 1000); await page.clock.fastForward(28 * 60000 + 1000);
  await expect(page.getByText('This round will expire soon.', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'What’s happening?' }).fill('A synthetic extended round'); await page.getByRole('button', { name: 'Send guess', exact: true }).click();
  await expect(page.getByText('This round will expire soon.', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'View next take', exact: true })).toBeVisible(); await frames(page, 2);
  await page.getByRole('textbox', { name: 'What do you think now?' }).fill('Preserve this final draft');
  app.advance(30 * 60000); await page.clock.fastForward(30 * 60000);
  await expect(page.getByRole('heading', { name: 'This round expired.' })).toBeVisible();
  await expect(page.getByText('Unsent draft: Preserve this final draft', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Watch take 1 again', exact: true })).toBeEnabled();
  await expect(page.getByRole('textbox', { name: 'What do you think now?' })).toBeDisabled();
});

test('individual replay cancels the both-takes sequence', async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await fixtureRound(page); await frames(page, 1);
  await page.getByRole('textbox', { name: 'What’s happening?' }).fill('A synthetic first answer'); await page.getByRole('button', { name: 'Send guess', exact: true }).click();
  await expect(page.getByRole('button', { name: 'View next take', exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Reveal now', exact: true }).click();
  await page.clock.install(); await page.getByRole('button', { name: 'Play both takes', exact: true }).click(); await frames(page, 1);
  await page.getByRole('button', { name: 'Watch take 1 again', exact: true }).click(); await frames(page, 1); await page.clock.fastForward(1001);
  await expect(page.getByText('Authored first take', { exact: true })).toBeVisible();
});

test('helpfulness is offered only after the second take was viewed and rating endpoints are anchored', async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/study'); await page.getByRole('button', { name: 'Start short synthetic study', exact: true }).click(); await page.getByRole('button', { name: 'Start next round', exact: true }).click();
  await page.getByRole('button', { name: 'Reveal now', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'How enjoyable was this round?' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'How helpful was the second take?' })).toHaveCount(0);
  await expect(page.getByRole('option', { name: '1 · not at all', exact: true })).toHaveCount(1);
  await expect(page.getByRole('option', { name: '5 · very enjoyable', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Save feedback and continue', exact: true }).click(); await page.getByRole('button', { name: 'Start next round', exact: true }).click(); await frames(page, 1);
  await page.getByRole('textbox', { name: 'What’s happening?' }).fill('A synthetic feedback answer'); await page.getByRole('button', { name: 'Send guess', exact: true }).click();
  await expect(page.getByRole('button', { name: 'View next take', exact: true })).toBeVisible(); await frames(page, 2); await page.getByRole('button', { name: 'Reveal now', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'How helpful was the second take?' })).toBeVisible();
});

for (const action of [
  { button: 'Send final guess', endpoint: 'guesses', heading: 'Your final guess needs checking.' },
  { button: 'Reveal now', endpoint: 'skip', heading: 'Your reveal needs checking.' },
  { button: 'Exit round', endpoint: 'abandon', heading: 'Your exit needs checking.' },
]) test(`lost ${action.endpoint} acknowledgement describes the uncertain action`, async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await fixtureRound(page);
  if (action.button === 'Send final guess') { await frames(page, 1); await page.getByRole('textbox', { name: 'What’s happening?' }).fill('A synthetic first guess'); await page.getByRole('button', { name: 'Send guess', exact: true }).click(); await expect(page.getByRole('button', { name: 'View next take', exact: true })).toBeVisible(); await frames(page, 2); await page.getByRole('textbox', { name: 'What do you think now?' }).fill('A synthetic final guess'); }
  await page.route(`**/api/rounds/*/${action.endpoint}`, async route => { await route.fetch(); await route.abort(); }, { times: 1 });
  await page.getByRole('button', { name: action.button, exact: true }).click();
  await expect(page.getByRole('heading', { name: action.heading })).toBeVisible();
  await expect(page.getByText('The next take couldn’t be prepared.', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Check result', exact: true }).click();
  await expect(page.getByRole('heading', { name: action.endpoint === 'abandon' ? 'The round was stopped.' : 'The scene was meant to show…' })).toBeVisible();
});

test('study expiry preserves the current encounter and draft until authoritative continuation', async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/study'); await page.getByRole('button', { name: 'Start short synthetic study', exact: true }).click(); await page.getByRole('button', { name: 'Start next round', exact: true }).click(); await frames(page, 1);
  await page.getByRole('textbox', { name: 'What’s happening?' }).fill('Keep this expired study draft'); await page.clock.install(); app.advance(30 * 60000); await page.clock.fastForward(30 * 60000);
  await expect(page.getByRole('heading', { name: 'This round expired.' })).toBeVisible();
  await expect(page.getByText('Unsent draft: Keep this expired study draft', { exact: true })).toBeVisible();
  await expect(page.locator('.stage')).toBeVisible(); await expect(page.getByRole('button', { name: 'Continue study', exact: true })).toBeEnabled();
  expect((app.services.fixtureStudy.db.prepare('SELECT count(*) n FROM fixture_rounds').get() as any).n).toBe(1);
  await page.getByRole('button', { name: 'Continue study', exact: true }).click(); await expect(page.getByRole('button', { name: 'Start next round', exact: true })).toBeVisible();
  expect((app.services.fixtureStudy.db.prepare('SELECT count(*) n FROM fixture_rounds').get() as any).n).toBe(1);
});

test.describe('active study withdrawal', () => {
  test.use({ fixtureDelayMs: 8000 });
  test('withdrawal during preparation cancels the job and deletes linked records', async ({ page, app, operator }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/study'); await page.getByRole('button', { name: 'Start short synthetic study', exact: true }).click(); await page.getByRole('button', { name: 'Start next round', exact: true }).click(); await frames(page, 1);
    await page.getByRole('textbox', { name: 'What’s happening?' }).fill('A synthetic withdrawal answer'); await page.getByRole('button', { name: 'Send guess', exact: true }).click();
    await expect.poll(() => (app.services.rounds as any).jobs.size).toBe(1);
    await page.getByText('Withdraw local study records', { exact: true }).click(); await page.getByRole('button', { name: 'Delete my linked study records', exact: true }).click();
    await expect(page.getByText('Linked local study records were deleted.', { exact: false })).toBeVisible();
    expect((app.services.rounds as any).jobs.size).toBe(0);
    expect((app.services.fixtureStudy.db.prepare('SELECT count(*) n FROM fixture_rounds').get() as any).n).toBe(0);
    expect(await page.evaluate(() => sessionStorage.getItem('tm_mutation'))).toBeNull();
  });
});

test('unavailable study binding preserves sticky proof before explicit recovery', async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/study'); await page.getByRole('button', { name: 'Start short synthetic study', exact: true }).click(); await page.getByRole('button', { name: 'Start next round', exact: true }).click(); await frames(page, 1); await page.clock.install();
  let deliver = false; await page.route('**/api/rounds/*/events', route => deliver ? route.continue() : route.abort());
  await page.route('**/api/rounds/*/guesses', async route => { await route.fetch(); await page.clock.fastForward(15010); await route.abort(); }, { times: 1 });
  await page.getByRole('textbox', { name: 'What’s happening?' }).fill('A retained study timing answer'); await page.getByRole('button', { name: 'Send guess', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).clientTimeout)).toBe(true);
  const saved = await page.evaluate(() => ({ m: JSON.parse(sessionStorage.getItem('tm_mutation')!), r: JSON.parse(sessionStorage.getItem('tm_recovery')!) }));
  await page.route('**/api/round-requests/*', route => route.abort(), { times: 1 }); await page.reload();
  await expect(page.getByRole('button', { name: 'Check result', exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).timeoutEventId)).toBe(saved.r.timeoutEventId);
  await expect.poll(() => (app.services.rounds as any).rounds.values().next().value.public.generation.status).toBe('ready');
  await page.getByRole('button', { name: 'Check result', exact: true }).click();
  await expect(page.getByRole('button', { name: 'View next take', exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).clientTimeout)).toBe(true);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_mutation')!).deadlineWallMs)).toBe(saved.m.deadlineWallMs);
  await page.waitForLoadState('networkidle'); deliver = true; await page.getByRole('button', { name: 'Check for a completed take', exact: true }).click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('tm_mutation'))).toBeNull();
  expect(app.services.events.observations(saved.m.roundId).operationalOutcome.clientTimeout).toBe(true);
});

test('offline study expiry can be confirmed after reconnect without reloading or recreating a round', async ({ page, context, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/study'); await page.getByRole('button', { name: 'Start short synthetic study', exact: true }).click(); await page.getByRole('button', { name: 'Start next round', exact: true }).click(); await frames(page, 1);
  await page.getByRole('textbox', { name: 'What’s happening?' }).fill('A draft kept through offline expiry'); await page.clock.install(); await context.setOffline(true); app.advance(30 * 60000); await page.clock.fastForward(30 * 60000);
  await expect(page.getByRole('heading', { name: 'This round expired.' })).toBeVisible(); await expect(page.getByRole('button', { name: 'Check result', exact: true })).toBeDisabled();
  await context.setOffline(false); await page.getByRole('button', { name: 'Check result', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continue study', exact: true })).toBeEnabled();
  await expect(page.getByText('Unsent draft: A draft kept through offline expiry', { exact: true })).toBeVisible();
  expect((app.services.fixtureStudy.db.prepare('SELECT count(*) n FROM fixture_rounds').get() as any).n).toBe(1);
  await page.getByRole('button', { name: 'Continue study', exact: true }).click(); await expect(page.getByRole('button', { name: 'Start next round', exact: true })).toBeVisible();
  expect((app.services.fixtureStudy.db.prepare('SELECT count(*) n FROM fixture_rounds').get() as any).n).toBe(1);
});

test('expiry retains unavailable timing proof and separates it from invalid late playback events', async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/study'); await page.getByRole('button', { name: 'Start short synthetic study', exact: true }).click(); await page.getByRole('button', { name: 'Start next round', exact: true }).click(); await frames(page, 1); await page.clock.install();
  let deliver = false; const delivered: any[][] = [];
  await page.route('**/api/rounds/*/events', route => { if (!deliver) return route.abort(); delivered.push(route.request().postDataJSON().events); return route.continue(); });
  await page.route('**/api/rounds/*/guesses', async route => { await route.fetch(); await page.clock.fastForward(15010); await route.abort(); }, { times: 1 });
  await page.getByRole('textbox', { name: 'What’s happening?' }).fill('A timing proof kept after expiry'); await page.getByRole('button', { name: 'Send guess', exact: true }).click(); await expect(page.getByRole('button', { name: 'Check for a completed take', exact: true })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_mutation')!));
  await page.getByRole('button', { name: 'Replay take 1', exact: true }).click(); await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  app.advance(30 * 60000); await page.clock.fastForward(30 * 60000);
  await expect(page.getByRole('button', { name: 'Continue study', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_mutation')!).requestId)).toBe(saved.requestId);
  await page.waitForLoadState('networkidle'); deliver = true; await page.getByRole('button', { name: 'Check result', exact: true }).click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('tm_mutation'))).toBeNull(); await expect(page.getByRole('button', { name: 'Continue study', exact: true })).toBeEnabled();
  expect(delivered.some(events => events.some(event => event.name === 'client_deadline') && events.some(event => event.name === 'visibility_changed' || event.name === 'play_started'))).toBe(false);
  expect(app.services.events.observations(saved.roundId).operationalOutcome.clientTimeout).toBe(true);
  await page.getByRole('button', { name: 'Continue study', exact: true }).click(); await expect(page.getByRole('button', { name: 'Start next round', exact: true })).toBeVisible();
});

test('an authoritative unaccepted guess clears only its rejected proof and keeps the draft for explicit retry', async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await fixtureRound(page); await frames(page, 1); await page.clock.install();
  await page.route('**/api/rounds/*/guesses', async route => { await page.clock.fastForward(15010); await route.abort(); }, { times: 1 });
  await page.getByRole('textbox', { name: 'What’s happening?' }).fill('Keep this unaccepted draft'); await page.getByRole('button', { name: 'Send guess', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).clientTimeout)).toBe(true);
  const original = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_mutation')!));
  await page.getByRole('button', { name: 'Check for a completed take', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'What’s happening?' })).toHaveValue('Keep this unaccepted draft');
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('tm_mutation'))).toBeNull();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).timeoutEventId)).toBeNull();
  await page.getByRole('button', { name: 'Send guess', exact: true }).click(); await expect(page.getByRole('button', { name: 'View next take', exact: true })).toBeVisible();
  const r = (app.services.rounds as any).rounds.values().next().value;
  expect(r.submissionRequestId).not.toBe(original.requestId);
  expect(app.services.events.observations(original.roundId).operationalOutcome.clientTimeout).toBe(false);
});

for (const rejection of ['missing', 'stale']) test(`${rejection} final guess preserves acknowledged first-guess timing proof`, async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await fixtureRound(page); await frames(page, 1); await page.clock.install();
  await page.route('**/api/rounds/*/guesses', async route => { await route.fetch(); await page.clock.fastForward(15010); await route.abort(); }, { times: 1 });
  await page.getByRole('textbox', { name: 'What’s happening?' }).fill('A late synthetic first guess'); await page.getByRole('button', { name: 'Send guess', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check for a completed take', exact: true })).toBeVisible(); await expect.poll(() => (app.services.rounds as any).rounds.values().next().value.public.generation.status).toBe('ready');
  await page.getByRole('button', { name: 'Check for a completed take', exact: true }).click(); await expect(page.getByRole('button', { name: 'View next take', exact: true })).toBeVisible(); await expect.poll(() => page.evaluate(() => sessionStorage.getItem('tm_mutation'))).toBeNull(); await frames(page, 2);
  const proof = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!));
  await page.route('**/api/rounds/*/guesses', async route => {
    if (rejection === 'missing') return route.abort();
    const input = route.request().postDataJSON(); const response = await route.fetch({ postData: JSON.stringify({ ...input, revision: input.revision - 1 }) });
    expect(response.status()).toBe(409); await route.fulfill({ response });
  }, { times: 1 });
  await page.getByRole('textbox', { name: 'What do you think now?' }).fill('Keep this unaccepted final draft'); await page.getByRole('button', { name: 'Send final guess', exact: true }).click();
  if (rejection === 'missing') await page.getByRole('button', { name: 'Check result', exact: true }).click();
  else await expect(page.getByText('The round changed. Your draft was kept.', { exact: false })).toBeVisible();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('tm_mutation'))).toBeNull();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).timeoutEventId)).toBe(proof.timeoutEventId);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).clientTimeout)).toBe(true);
  expect(app.services.events.observations(proof.roundId).operationalOutcome.clientTimeout).toBe(true);
  await expect(page.getByRole('textbox', { name: 'What do you think now?' })).toHaveValue('Keep this unaccepted final draft');
  await expect(page.getByRole('button', { name: 'Send final guess', exact: true })).toBeEnabled();
});
