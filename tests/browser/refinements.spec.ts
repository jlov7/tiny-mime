import { browserArtifact } from '../support/browser-artifacts.js';
import type { Page } from '@playwright/test';
import { test, expect, fixtureRound } from '../support/browser-fixtures.js';

async function startStudy(page: Page, kind = 'short') {
  await page.goto('/study'); await page.getByRole('button', { name: `Start ${kind} synthetic study` }).click();
  await expect(page.getByRole('button', { name: 'Start next round', exact: true })).toBeEnabled();
}
async function completeMain(page: Page, count = 3) {
  for (let i = 0; i < count; i++) {
    await page.getByRole('button', { name: 'Start next round', exact: true }).click();
    await page.getByRole('button', { name: 'Reveal now', exact: true }).click();
    const save = page.getByRole('button', { name: 'Save feedback and continue', exact: true });
    await expect(save).toBeEnabled(); await save.click();
  }
  await expect(page.getByRole('heading', { name: 'One last optional question' })).toBeVisible();
}
async function frameGuess(page: Page, attempt: 1 | 2, text: string) {
  if (attempt === 2) await page.getByRole('button', { name: 'View next take', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Next frame', exact: true })).toBeVisible();
  const id = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId);
  const round = await (await page.request.get('/api/rounds/' + id)).json();
  const times = new Set(round.acts[attempt - 1].score.actors.flatMap((actor: any) => actor.keyframes.map((key: any) => key.tMs)));
  for (let i = 1; i < times.size; i++) await page.getByRole('button', { name: 'Next frame', exact: true }).click();
  const field = page.getByRole('textbox', { name: attempt === 1 ? 'What’s happening?' : 'What do you think now?' });
  await expect(field).toBeEnabled(); await field.fill(text);
  await page.getByRole('button', { name: attempt === 1 ? 'Send guess' : 'Send final guess', exact: true }).click();
}

test('returning to a completed study preserves another study’s saved round', async ({ page, app, operator }) => {
  await startStudy(page); const completedUrl = page.url(); await completeMain(page);
  await page.getByRole('button', { name: 'Finish and save choices', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Thanks for taking part.', exact: true })).toBeVisible();
  await startStudy(page); const activeUrl = page.url();
  await page.getByRole('button', { name: 'Start next round', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Take 1 of 2.', exact: true })).toBeVisible();
  const saved = await page.evaluate(() => sessionStorage.getItem('tm_recovery'));
  await page.goto(completedUrl);
  await expect(page.getByRole('heading', { name: 'Thanks for taking part.', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Take 1 of 2.', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('tm_recovery'))).toBe(saved);
  await page.getByRole('link', { name: 'Return to the saved study', exact: true }).click();
  await expect(page).toHaveURL(activeUrl); await expect(page.getByRole('heading', { name: 'Take 1 of 2.', exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('tm_recovery'))).toBe(saved);
  expect((app.services.rounds as any).rounds.size).toBe(4);
});

test('study recovery refuses missing or unresolved association without recreating the round', async ({ page, app, operator }) => {
  await startStudy(page); await page.getByRole('button', { name: 'Start next round', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Take 1 of 2.', exact: true })).toBeVisible();
  const creation = await page.evaluate(() => sessionStorage.getItem('tm_creation'));
  await page.evaluate(() => sessionStorage.removeItem('tm_creation')); await page.reload();
  await expect(page.getByText('The saved round belongs to another session. Return to Play or its original study to finish or check it.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Check result', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Take 1 of 2.', exact: true })).toHaveCount(0);
  await page.evaluate(value => sessionStorage.setItem('tm_creation', value!), creation);
  (app.services.rounds as any).requests.clear(); await page.reload();
  await expect(page.getByText('The saved round belongs to another session. Return to Play or its original study to finish or check it.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry round creation', exact: true })).toHaveCount(0);
  expect((app.services.rounds as any).rounds.size).toBe(1);
});

test('study creation binding preserves interrupted first-guess recovery and its deadline', async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await startStudy(page);
  await page.route('**/api/rounds', async route => { await route.fetch(); await route.abort(); }, { times: 1 });
  await page.getByRole('button', { name: 'Start next round', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check result', exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByRole('heading', { name: 'Take 1 of 2.', exact: true })).toBeVisible();
  await page.route('**/api/rounds/*/guesses', async route => { await route.fetch(); await route.abort(); }, { times: 1 });
  await frameGuess(page, 1, 'A synthetic interpretation before the response was lost.');
  await expect(page.getByText('The local server could not be reached. Check the connection, then try again.', { exact: true })).toBeVisible();
  const deadline = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_mutation')!).deadlineWallMs);
  await page.reload(); await expect(page.getByText('Timing was interrupted. Check the result explicitly.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_mutation')!).deadlineWallMs)).toBe(deadline);
  await expect(page.getByRole('button', { name: 'View next take', exact: true })).toHaveCount(0);
  await expect.poll(() => (app.services.rounds as any).rounds.values().next().value.public.generation.status).toBe('ready');
  await page.getByRole('button', { name: 'Check for a completed take', exact: true }).click();
  await expect(page.getByRole('button', { name: 'View next take', exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).clockUncertain)).toBe(true);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_creation')!).studySessionId)).toBe(new URL(page.url()).searchParams.get('session'));
  expect((app.services.rounds as any).rounds.size).toBe(1);
});

test('local preview explains the mock second take and leads into a fixture round', async ({ page, app, operator }, info) => {
  const errors: string[] = []; const external: string[] = [];
  page.on('pageerror', error => errors.push(error.message)); page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:4317')) external.push(request.url()); });
  await page.goto('/play'); await expect(page.getByRole('button', { name: 'Try a fixture round', exact: true })).toHaveClass(/primary/); await expect(page.getByRole('link', { name: 'Open rehearsal' })).not.toHaveClass(/primary/);
  await expect(page.getByText(/does not adapt to your guess/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start a round', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Try a fixture round', exact: true }).click();
  await expect(page.getByText('Watch this take to the end, then describe what you see.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send guess', exact: true })).not.toHaveClass(/primary/);
  expect(errors).toEqual([]); expect(external).toEqual([]);
  await page.screenshot({ path: browserArtifact(`${info.project.name}-refined-ready.png`), fullPage: true });
});

test('phone rehearsal shows the canonical stage and Play in the first viewport', async ({ page, app, operator }, info) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/rehearsal');
  await page.keyboard.press('Tab'); await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.getByRole('link', { name: 'Tiny Mime', exact: true })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.getByRole('button', { name: 'Enter participant mode', exact: true })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.getByRole('link', { name: 'Play', exact: true })).toBeFocused();
  const stage = page.locator('svg.stage'); await expect(stage).toBeVisible();
  const box = (await stage.boundingBox())!; const play = (await page.getByRole('button', { name: 'Play', exact: true }).boundingBox())!;
  expect(Math.round(box.width)).toBe(358); expect(Math.round(box.height)).toBe(251);
  expect(play.y + play.height).toBeLessThan(844); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: browserArtifact(`${info.project.name}-refined-rehearsal-phone.png`), fullPage: true });
  await page.getByRole('button', { name: 'Play', exact: true }).click(); await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
});

test('study keeps the first interpretation, full reveal, focus and both-take replay', async ({ page, app, operator }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await startStudy(page); const url = page.url();
  await page.getByRole('link', { name: 'Study', exact: true }).click(); await expect(page).toHaveURL(url);
  await page.getByRole('button', { name: 'Start next round', exact: true }).click();
  await frameGuess(page, 1, 'A synthetic first interpretation.');
  await expect(page.getByText('A synthetic first interpretation.', { exact: true })).toBeVisible();
  await frameGuess(page, 2, 'A synthetic second interpretation.');
  await expect(page.getByRole('heading', { name: 'The scene was meant to show…' })).toBeFocused();
  await expect(page.getByText('A synthetic first interpretation.', { exact: true })).toBeVisible(); await expect(page.getByText('A synthetic second interpretation.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play both takes', exact: true })).toBeVisible(); await expect(page.locator('svg.stage')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'How enjoyable was this round?' })).toBeVisible();
  await page.screenshot({ path: browserArtifact(`${info.project.name}-refined-study-reveal.png`), fullPage: true });
  await page.getByRole('button', { name: 'Watch take 1 again', exact: true }).click(); await expect(page.locator('svg.stage')).toBeVisible();
  expect((app.services.rounds as any).rounds.size).toBe(1);
});

test('saved round feedback survives a lost response and refresh without another submission', async ({ page, app, operator }) => {
  await startStudy(page); await page.getByRole('button', { name: 'Start next round', exact: true }).click(); await page.getByRole('button', { name: 'Reveal now', exact: true }).click();
  await page.getByRole('combobox', { name: 'How enjoyable was this round?' }).selectOption('4');
  let posts = 0;
  await page.route('**/api/rounds/*/feedback', async route => { if (route.request().method() === 'POST') { posts++; await route.fetch(); await route.abort(); } else await route.continue(); });
  await page.getByRole('button', { name: 'Save feedback and continue', exact: true }).click();
  await expect(page.getByText('Your feedback is saved.', { exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByText('Your feedback is saved.', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'How enjoyable was this round?' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue study', exact: true }).click(); await expect(page.getByRole('button', { name: 'Start next round', exact: true })).toBeVisible();
  expect(posts).toBe(1); const row = JSON.parse((app.services.fixtureStudy.db.prepare('SELECT data FROM fixture_rounds').get() as any).data).row;
  expect(row.delight_1_to_5).toBe(4); expect(row.perceived_helpfulness_1_to_5).toBeNull();
});

test('an unsaved round rating retries the original request and original answer', async ({ page, app, operator }) => {
  await startStudy(page); await page.getByRole('button', { name: 'Start next round', exact: true }).click(); await page.getByRole('button', { name: 'Reveal now', exact: true }).click();
  const rating = page.getByRole('combobox', { name: 'How enjoyable was this round?' }); await rating.selectOption('5');
  const bodies: unknown[] = [];
  await page.route('**/api/rounds/*/feedback', async route => { if (route.request().method() !== 'POST') return route.continue(); bodies.push(route.request().postDataJSON()); if (bodies.length === 1) await route.abort(); else await route.continue(); });
  await page.getByRole('button', { name: 'Save feedback and continue', exact: true }).click();
  await expect(page.getByText('Feedback could not be confirmed. Check saved feedback or retry the same answer.')).toBeVisible(); await expect(rating).toBeDisabled();
  await page.getByRole('button', { name: 'Save feedback and continue', exact: true }).click(); await expect(page.getByRole('button', { name: 'Start next round', exact: true })).toBeVisible();
  expect(bodies).toHaveLength(2); expect(bodies[0]).toEqual(bodies[1]);
  expect(JSON.parse((app.services.fixtureStudy.db.prepare('SELECT data FROM fixture_rounds').get() as any).data).row.delight_1_to_5).toBe(5);
});

test('saved final choices restore after a lost response and refresh', async ({ page, app, operator }) => {
  await startStudy(page); await completeMain(page);
  await page.getByRole('combobox', { name: 'Would you voluntarily play another round?' }).selectOption('yes'); await page.getByRole('combobox', { name: 'Optional extra round' }).selectOption('no');
  let posts = 0; await page.route('**/api/study-sessions/*/feedback', async route => { posts++; await route.fetch(); await route.abort(); });
  await page.getByRole('button', { name: 'Finish and save choices', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Thanks for taking part.' })).toBeVisible();
  await page.reload(); await expect(page.getByRole('heading', { name: 'Thanks for taking part.' })).toBeVisible(); await expect(page.getByRole('heading', { name: 'One last optional question' })).toHaveCount(0);
  await expect(page.getByText('Planned rounds complete', { exact: true })).toBeVisible();
  const row = JSON.parse((app.services.fixtureStudy.db.prepare('SELECT data FROM fixture_rounds ORDER BY rowid DESC LIMIT 1').get() as any).data).row;
  expect(posts).toBe(1); expect(row.would_play_again).toBe(true); expect(row.optional_extra_accepted).toBe(false);
});

test('accepted optional extra can finish after the preserved hourly cap blocks creation', async ({ page, app, operator }, info) => {
  test.setTimeout(60000); await startStudy(page, 'full'); await completeMain(page, 10);
  await page.getByRole('combobox', { name: 'Optional extra round' }).selectOption('yes'); await page.getByRole('button', { name: 'Finish and save choices', exact: true }).click();
  const start = page.getByRole('button', { name: 'Start next round', exact: true }); const finish = page.getByRole('button', { name: 'Finish', exact: true });
  await expect(start).toBeEnabled(); await expect(finish).toBeEnabled(); await start.click();
  await expect(page.getByText('Local round capacity has been reached. This session allows 10 round starts per hour across all modes. Finish here or try again later.')).toBeVisible(); await finish.click();
  await expect(page.getByRole('heading', { name: 'Thanks for taking part.' })).toBeVisible(); await page.reload(); await expect(page.getByRole('heading', { name: 'Thanks for taking part.' })).toBeVisible();
  await expect(start).toHaveCount(0); expect((app.services.rounds as any).rounds.size).toBe(10);
  const row = JSON.parse((app.services.fixtureStudy.db.prepare('SELECT data FROM fixture_rounds ORDER BY rowid DESC LIMIT 1').get() as any).data).row;
  expect(row.optional_extra_accepted).toBe(true); expect(row.optional_extra_started).toBe(false); expect(row.optional_extra_completed).toBe(false);
  await page.screenshot({ path: browserArtifact(`${info.project.name}-refined-study-finish.png`), fullPage: true });
});

test('expired terminal feedback continues without rating or repeating the old encounter', async ({ page, app, operator }) => {
  await startStudy(page); await page.getByRole('button', { name: 'Start next round', exact: true }).click(); await page.getByRole('button', { name: 'Reveal now', exact: true }).click();
  const oldId = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId);
  const save = page.getByRole('button', { name: 'Save feedback and continue', exact: true }); await expect(save).toBeEnabled();
  await page.getByRole('combobox', { name: 'How enjoyable was this round?' }).selectOption('4'); app.advance(31 * 60000);
  await save.click(); await expect(page.getByRole('heading', { name: 'The round expired.' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue study', exact: true }).click(); await page.getByRole('button', { name: 'Start next round', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Take 1 of 2.' })).toBeVisible();
  const newId = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId); expect(newId).not.toBe(oldId);
  await page.getByRole('button', { name: 'Reveal now', exact: true }).click(); await expect(save).toBeEnabled(); await save.click(); await expect(page.getByRole('button', { name: 'Start next round', exact: true })).toBeVisible();
  const rows = app.services.fixtureStudy.db.prepare('SELECT id,data FROM fixture_rounds ORDER BY rowid').all() as { id: string; data: string }[];
  expect(rows).toHaveLength(2); expect(JSON.parse(rows[0]!.data).row.delight_1_to_5).toBeNull(); expect(JSON.parse(rows[1]!.data).row.delight_1_to_5).toBeNull();
});

test('a delayed old progress response cannot reopen saved final choices', async ({ page, app, operator }) => {
  await startStudy(page);
  for (let i = 0; i < 2; i++) { await page.getByRole('button', { name: 'Start next round', exact: true }).click(); await page.getByRole('button', { name: 'Reveal now', exact: true }).click(); const save = page.getByRole('button', { name: 'Save feedback and continue', exact: true }); await expect(save).toBeEnabled(); await save.click(); }
  await page.getByRole('button', { name: 'Start next round', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Take 1 of 2.' })).toBeVisible();
  const id = new URL(page.url()).searchParams.get('session')!; let held = false; let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/study-sessions/${id}`, async route => { const response = await route.fetch(); expect((await response.json()).feedbackSaved).toBe(false); held = true; await gate; await route.fulfill({ response }); }, { times: 1 });
  try {
    await page.getByRole('button', { name: 'Reveal now', exact: true }).click(); await expect.poll(() => held).toBe(true);
    await page.getByRole('button', { name: 'Save feedback and continue', exact: true }).click(); await expect(page.getByRole('heading', { name: 'One last optional question' })).toBeVisible();
    await page.getByRole('combobox', { name: 'Optional extra round' }).selectOption('no'); await page.getByRole('button', { name: 'Finish and save choices', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Thanks for taking part.' })).toBeVisible();
    const stale = page.waitForResponse(response => response.url().endsWith(`/api/study-sessions/${id}`)); release(); await (await stale).finished();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    await expect(page.getByRole('heading', { name: 'Thanks for taking part.' })).toBeVisible(); await expect(page.getByRole('heading', { name: 'One last optional question' })).toHaveCount(0);
  } finally { release(); }
});


test('a completed creator round hands off through capture to a synthetic study', async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/creator/capture');
  await page.getByRole('checkbox', { name: 'My own demonstration text', exact: true }).check();
  await page.getByRole('button', { name: 'Start creator demonstration', exact: true }).click();
  await frameGuess(page, 1, 'An owned private first guess.'); await frameGuess(page, 2, 'An owned private final guess.');
  await expect(page.getByRole('heading', { name: 'The scene was meant to show…', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('tm_mutation'))).toBeNull();
  expect(await page.evaluate(() => sessionStorage.getItem('tm_creation'))).toBeNull();
  expect(await page.evaluate(() => sessionStorage.getItem('tm_recovery'))).not.toBeNull();
  await page.getByRole('link', { name: 'Creator capture', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Keep the whole performance.', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Study', exact: true }).click();
  await page.getByRole('button', { name: 'Start short synthetic study', exact: true }).click();
  const start = page.getByRole('button', { name: 'Start next round', exact: true }); await expect(start).toBeEnabled();
  expect(await page.evaluate(() => sessionStorage.getItem('tm_recovery'))).toBeNull();
  await page.reload(); await expect(start).toBeEnabled(); expect((app.services.rounds as any).rounds.size).toBe(1);
  await start.click(); await frameGuess(page, 1, 'A synthetic study first guess.'); await frameGuess(page, 2, 'A synthetic study final guess.');
  await page.getByRole('combobox', { name: 'How enjoyable was this round?', exact: true }).selectOption('4');
  await page.getByRole('button', { name: 'Save feedback and continue', exact: true }).click();
  await expect(start).toBeEnabled(); expect((app.services.rounds as any).rounds.size).toBe(2);
  expect((app.services.fixtureStudy.db.prepare('SELECT count(*) n FROM fixture_rounds').get() as any).n).toBe(1);
});

test('an active private round stays protected when entering a new synthetic study', async ({ page, app, operator }) => {
  await fixtureRound(page); const saved = await page.evaluate(() => sessionStorage.getItem('tm_recovery'));
  await page.getByRole('link', { name: 'Study', exact: true }).click(); await page.getByRole('button', { name: 'Start short synthetic study', exact: true }).click();
  await expect(page.getByText('The saved round belongs to another session. Return to Play or its original study to finish or check it.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start next round', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => sessionStorage.getItem('tm_recovery'))).toBe(saved); expect((app.services.rounds as any).rounds.size).toBe(1);
});


for (const action of ['Reveal now', 'Exit round']) test(`a terminal private round from ${action} does not block a new study`, async ({ page, app, operator }) => {
  await fixtureRound(page); await page.getByRole('button', { name: action, exact: true }).click();
  await expect(page.getByRole('heading', { name: action === 'Reveal now' ? 'The scene was meant to show…' : 'Thanks for playing.', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('tm_mutation'))).toBeNull();
  await startStudy(page); expect(await page.evaluate(() => sessionStorage.getItem('tm_recovery'))).toBeNull();
  expect((app.services.rounds as any).rounds.size).toBe(1);
});

test('a failed preceding-round lookup keeps recovery and an explicit check can reconcile it', async ({ page, app, operator }) => {
  await fixtureRound(page); await page.getByRole('button', { name: 'Reveal now', exact: true }).click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('tm_mutation'))).toBeNull();
  const saved = await page.evaluate(() => sessionStorage.getItem('tm_recovery')); const id = JSON.parse(saved!).roundId;
  await page.route('**/api/rounds/' + id, route => route.abort(), { times: 1 });
  let creates = 0; page.on('request', request => { if (new URL(request.url()).pathname === '/api/rounds' && request.method() === 'POST') creates++; });
  await page.goto('/study'); await page.getByRole('button', { name: 'Start short synthetic study', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('The preceding round could not be checked.');
  await expect(page.getByRole('button', { name: 'Start next round', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => sessionStorage.getItem('tm_recovery'))).toBe(saved); expect(creates).toBe(0);
  await page.getByRole('button', { name: 'Check result', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start next round', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => sessionStorage.getItem('tm_recovery'))).toBeNull(); expect(creates).toBe(0);
});

test('a lost private final-guess acknowledgement stays protected on entry to study', async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await fixtureRound(page); await frameGuess(page, 1, 'A first private guess.');
  await page.route('**/api/rounds/*/guesses', async route => { await route.fetch(); await route.abort(); }, { times: 1 });
  await frameGuess(page, 2, 'A final private guess with a lost acknowledgement.');
  await expect(page.getByRole('heading', { name: 'Your final guess needs checking.', exact: true })).toBeVisible();
  const saved = await page.evaluate(() => ({ recovery: sessionStorage.getItem('tm_recovery'), mutation: sessionStorage.getItem('tm_mutation') }));
  await page.goto('/study'); await page.getByRole('button', { name: 'Start short synthetic study', exact: true }).click();
  await expect(page.getByText('The saved round belongs to another session. Return to Play or its original study to finish or check it.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start next round', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => ({ recovery: sessionStorage.getItem('tm_recovery'), mutation: sessionStorage.getItem('tm_mutation') }))).toEqual(saved);
  expect((app.services.rounds as any).rounds.size).toBe(1);
});
