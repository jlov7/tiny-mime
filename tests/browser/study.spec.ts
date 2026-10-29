import { browserArtifact } from '../support/browser-artifacts.js';
import { randomUUID } from 'node:crypto';
import { test, expect } from '../support/browser-fixtures.js';
import type { Page } from '@playwright/test';
import { ANALYST_HEADER } from '../../src/server/study/exports.js';

async function stepTake(page: Page, attempt: 1 | 2) {
  if (attempt === 2) await page.getByRole('button', { name: 'View next take', exact: true }).click();
  const id = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId);
  const round = await (await page.request.get('/api/rounds/' + id)).json();
  const score = round.acts[attempt - 1].score;
  const keys = new Set(score.actors.flatMap((a: any) => a.keyframes.map((k: any) => k.tMs)));
  for (let i = 1; i < keys.size; i++) await page.getByRole('button', { name: 'Next frame', exact: true }).click();
  const field = page.getByRole('textbox', { name: attempt === 1 ? 'What’s happening?' : 'What do you think now?' }); await expect(field).toBeEnabled();
  await field.fill(`Synthetic interpretation ${attempt}`); await page.getByRole('button', { name: attempt === 1 ? 'Send guess' : 'Send final guess', exact: true }).click();
  if (attempt === 1) await expect(page.getByRole('button', { name: 'View next take', exact: true })).toBeVisible();
}

test('withdrawing an older study preserves the active study and its refresh recovery', async ({ page, app, operator }) => {
  await page.goto('/study'); await page.getByRole('button', { name: 'Start short synthetic study', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start next round', exact: true })).toBeVisible();
  const olderId = new URL(page.url()).searchParams.get('session')!;
  const olderCode = (await (await page.request.get('/api/study-sessions/' + olderId)).json()).withdrawalCode;
  for (let i = 0; i < 3; i++) { await page.getByRole('button', { name: 'Start next round', exact: true }).click(); await page.getByRole('button', { name: 'Reveal now', exact: true }).click(); await page.getByRole('button', { name: 'Save feedback and continue', exact: true }).click(); }
  await page.getByRole('button', { name: 'Finish and save choices', exact: true }).click();
  await expect(page.getByText('Thanks for taking part.', { exact: true })).toBeVisible();
  await page.goto('/study'); await page.getByRole('button', { name: 'Start short synthetic study', exact: true }).click();
  await page.getByRole('button', { name: 'Start next round', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Take 1 of 2.' })).toBeVisible();
  const activeUrl = page.url(), activeId = new URL(activeUrl).searchParams.get('session')!;
  const saved = await page.evaluate(() => ({ creation: sessionStorage.getItem('tm_creation'), recovery: sessionStorage.getItem('tm_recovery'), mutation: sessionStorage.getItem('tm_mutation') }));
  const roundId = JSON.parse(saved.recovery!).roundId;
  let releaseRecovery!: () => void, observeRecovery!: () => void;
  const recoveryGate = new Promise<void>(resolve => { releaseRecovery = resolve; });
  const recoveryStarted = new Promise<void>(resolve => { observeRecovery = resolve; });
  await page.route('**/api/round-requests/' + JSON.parse(saved.creation!).requestId, async route => { observeRecovery(); await recoveryGate; await route.continue(); });
  let releaseWithdrawal!: () => void;
  const withdrawalGate = new Promise<void>(resolve => { releaseWithdrawal = resolve; });
  await page.route('**/api/study-withdrawals', async route => { const response = await route.fetch(); await withdrawalGate; await route.fulfill({ response }); }, { times: 1 });
  await page.getByText('Withdraw local study records', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Withdrawal code', exact: true }).fill(olderCode);
  await page.getByRole('button', { name: 'Delete my linked study records', exact: true }).click();
  await expect(page.getByText('A withdrawal request is saved in this tab. After refresh, re-enter its original code to check the same request. Deletion is not confirmed.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Take 1 of 2.' })).toHaveCount(0);
  releaseWithdrawal();
  await expect(page.getByText('Linked local study records were deleted.', { exact: false })).toBeVisible();
  expect(page.url()).toBe(activeUrl);
  expect(await page.evaluate(() => ({ creation: sessionStorage.getItem('tm_creation'), recovery: sessionStorage.getItem('tm_recovery'), mutation: sessionStorage.getItem('tm_mutation') }))).toEqual(saved);
  expect(app.services.fixtureStudy.db.prepare('SELECT id FROM fixture_sessions WHERE id=?').get(olderId)).toBeUndefined();
  expect(app.services.fixtureStudy.db.prepare('SELECT id FROM fixture_sessions WHERE id=?').get(activeId)).toBeDefined();
  await recoveryStarted;
  const codeField = page.getByRole('textbox', { name: 'Withdrawal code', exact: true });
  await codeField.fill(olderCode.slice(0, -1));
  const originalField = await codeField.elementHandle();
  await expect(codeField).toBeFocused();
  releaseRecovery();
  await expect(page.getByRole('heading', { name: 'Take 1 of 2.' })).toBeVisible();
  expect(await originalField!.evaluate(node => node.isConnected)).toBe(true);
  await expect(codeField).toBeFocused();
  await page.keyboard.insertText(olderCode.slice(-1));
  await expect(codeField).toHaveValue(olderCode);
  await page.getByRole('button', { name: 'Delete my linked study records', exact: true }).click();
  await expect(page.getByText('No matching local study records were found for this code. Check the code or ask the facilitator.', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Withdrawal code', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Discard saved withdrawal request', exact: true }).click();
  await expect(page.getByText('The saved withdrawal request was discarded. Deletion is not confirmed.', { exact: true })).toBeVisible();
  expect(page.url()).toBe(activeUrl);
  expect(await page.evaluate(() => ({ creation: sessionStorage.getItem('tm_creation'), recovery: sessionStorage.getItem('tm_recovery'), mutation: sessionStorage.getItem('tm_mutation') }))).toEqual(saved);
  await page.reload(); await expect(page.getByRole('heading', { name: 'Take 1 of 2.' })).toBeVisible();
  expect(page.url()).toBe(activeUrl);
  expect(await page.evaluate(() => sessionStorage.getItem('tm_creation'))).toBe(saved.creation);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId)).toBe(roundId);
  await page.getByRole('button', { name: 'Reveal now', exact: true }).click();
  await page.getByRole('button', { name: 'Save feedback and continue', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start next round', exact: true })).toBeVisible();
  expect(app.services.fixtureStudy.db.prepare('SELECT current_index FROM fixture_sessions WHERE id=?').get(activeId)).toEqual({ current_index: 1 });
});

test('a lost successful withdrawal acknowledgement retries the exact command and cleans up once', async ({ page, app, operator }) => {
  await page.goto('/study'); await page.getByRole('button', { name: 'Start short synthetic study', exact: true }).click();
  await page.getByRole('button', { name: 'Start next round', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Take 1 of 2.' })).toBeVisible();
  const studyId = new URL(page.url()).searchParams.get('session')!;
  const savedCreation = await page.evaluate(() => sessionStorage.getItem('tm_creation'));
  const code = (await (await page.request.get('/api/study-sessions/' + studyId)).json()).withdrawalCode;
  await page.evaluate(() => {
    const remove = Storage.prototype.removeItem; (window as any).withdrawalClears = [];
    Storage.prototype.removeItem = function (key) { if (this === sessionStorage && ['tm_creation', 'tm_mutation', 'tm_recovery'].includes(key)) (window as any).withdrawalClears.push(key); remove.call(this, key); };
  });
  const bodies: { requestId: string; withdrawalCode: string }[] = [];
  let sessionRequests = 0;
  await page.route('**/api/session', async route => { sessionRequests++; await route.continue(); });
  await page.route('**/api/study-withdrawals', async route => {
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 1) { const result = await route.fetch(); expect(result.status()).toBe(200); await route.abort(); }
    else await route.continue();
  });
  await page.getByText('Withdraw local study records', { exact: true }).click();
  await page.getByRole('button', { name: 'Delete my linked study records', exact: true }).click();
  await expect(page.getByText('Deletion could not be confirmed. Retry the same withdrawal to check its result.', { exact: true })).toBeVisible();
  expect(app.services.fixtureStudy.db.prepare('SELECT id FROM fixture_sessions WHERE id=?').get(studyId)).toBeUndefined();
  expect(await page.evaluate(() => sessionStorage.getItem('tm_creation'))).toBe(savedCreation);
  expect(await page.evaluate(() => (window as any).withdrawalClears)).toEqual([]);
  await expect(page.getByRole('textbox', { name: 'Withdrawal code', exact: true })).toBeDisabled();
  await expect(page.getByRole('textbox', { name: 'Withdrawal code', exact: true })).toHaveValue(code);
  await page.getByRole('button', { name: 'Retry same withdrawal', exact: true }).click();
  await expect(page.getByText('Linked local study records were deleted.', { exact: false })).toBeVisible();
  expect(bodies).toHaveLength(2); expect(bodies[0]).toEqual({ requestId: expect.any(String), withdrawalCode: code, expectedRecoveryOwnerId: expect.any(String) }); expect(bodies[1]).toEqual(bodies[0]);
  expect(sessionRequests).toBe(1);
  expect(new URL(page.url()).search).toBe('');
  expect(await page.evaluate(() => (window as any).withdrawalClears)).toEqual(['tm_creation', 'tm_recovery']);
  expect(await page.evaluate(() => [sessionStorage.getItem('tm_creation'), sessionStorage.getItem('tm_mutation'), sessionStorage.getItem('tm_recovery')])).toEqual([null, null, null]);
  await page.getByText('Withdraw local study records', { exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Withdrawal code', exact: true })).toBeEnabled();
  await page.reload(); await expect(page.getByRole('button', { name: 'Start short synthetic study', exact: true })).toBeVisible();
});

for (const playbackMode of ['motion', 'frame_step'] as const) test(`[Q85] acknowledged ${playbackMode} second-take completion keeps helpfulness after refresh`, async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/study');
  await page.getByRole('button', { name: 'Start short synthetic study', exact: true }).click();
  await page.getByRole('button', { name: 'Start next round', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Next frame', exact: true })).toBeVisible(); await stepTake(page, 1);
  const studyUrl = page.url(), roundId = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId);
  const round = await (await page.request.get('/api/rounds/' + roundId)).json();
  const acknowledgedCompletion = page.waitForResponse(response => response.url().endsWith(`/api/rounds/${roundId}/events`) && response.status() === 200 && response.request().postDataJSON().events.some((event: any) => event.name === 'play_completed' && event.attempt === 2));
  await page.getByRole('button', { name: 'View next take', exact: true }).click();
  if (playbackMode === 'motion') {
    await page.getByRole('button', { name: 'Play animation', exact: true }).click();
    await page.getByRole('button', { name: 'Play next take', exact: true }).click();
  } else {
    const times = new Set(round.acts[1].score.actors.flatMap((actor: any) => actor.keyframes.map((key: any) => key.tMs)));
    for (let i = 1; i < times.size; i++) await page.getByRole('button', { name: 'Next frame', exact: true }).click();
  }
  await expect(page.getByRole('textbox', { name: 'What do you think now?', exact: true })).toBeEnabled({ timeout: 12000 });
  const acknowledgement = await acknowledgedCompletion, accepted = await acknowledgement.json();
  const completion = acknowledgement.request().postDataJSON().events.find((event: any) => event.name === 'play_completed' && event.attempt === 2);
  expect(accepted.acceptedEventIds).toContain(completion.eventId);
  expect(app.services.events.observations(roundId).completedViews).toContainEqual(expect.objectContaining({ attempt: 2, scoreHash: round.acts[1].scoreHash, playId: completion.playId, playbackMode }));
  await page.getByRole('button', { name: 'Reveal now', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'How helpful was the second take?', exact: true })).toBeVisible();
  expect((await (await page.request.get('/api/rounds/' + roundId)).json()).guesses).toHaveLength(1);
  await page.reload(); await expect(page.getByRole('heading', { name: 'Thanks for this interpretation.', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'How enjoyable was this round?', exact: true })).toBeVisible();
  expect(page.url()).toBe(studyUrl); expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId)).toBe(roundId);
  await expect(page.getByRole('combobox', { name: 'How helpful was the second take?', exact: true })).toBeVisible();
});

for (const viewing of ['early reveal', 'partial traversal'] as const) test(`[Q85] ${viewing} does not acquire helpfulness after refresh`, async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/study');
  await page.getByRole('button', { name: 'Start short synthetic study', exact: true }).click();
  await page.getByRole('button', { name: 'Start next round', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Next frame', exact: true })).toBeVisible(); await stepTake(page, 1);
  const roundId = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId);
  if (viewing === 'partial traversal') {
    const started = page.waitForResponse(response => response.url().endsWith(`/api/rounds/${roundId}/events`) && response.status() === 200 && response.request().postDataJSON().events.some((event: any) => event.name === 'play_started' && event.attempt === 2));
    await page.getByRole('button', { name: 'View next take', exact: true }).click();
    await page.getByRole('button', { name: 'Next frame', exact: true }).click(); await started;
    await expect(page.getByRole('textbox', { name: 'What do you think now?', exact: true })).toBeDisabled();
  }
  await page.getByRole('button', { name: 'Reveal now', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'How enjoyable was this round?', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'How helpful was the second take?', exact: true })).toHaveCount(0);
  expect(app.services.events.observations(roundId).completedViews.filter(play => play.attempt === 2)).toEqual([]);
  await page.reload(); await expect(page.getByRole('heading', { name: 'Thanks for this interpretation.', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'How enjoyable was this round?', exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId)).toBe(roundId);
  await expect(page.getByRole('combobox', { name: 'How helpful was the second take?', exact: true })).toHaveCount(0);
});

test('[Q86] a lost successful withdrawal acknowledgement reuses the exact command after refresh and code re-entry', async ({ page, app, operator }) => {
  await page.goto('/study'); await page.getByRole('button', { name: 'Start short synthetic study', exact: true }).click();
  await page.getByRole('button', { name: 'Start next round', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Take 1 of 2.', exact: true })).toBeVisible();
  const studyId = new URL(page.url()).searchParams.get('session')!;
  const code = (await (await page.request.get('/api/study-sessions/' + studyId)).json()).withdrawalCode;
  const creation = await page.evaluate(() => sessionStorage.getItem('tm_creation'));
  const originalUrl = page.url(), savedRecovery = await page.evaluate(() => sessionStorage.getItem('tm_recovery'));
  const bodies: Record<string, unknown>[] = [];
  await page.route('**/api/study-withdrawals', async route => {
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 1) { const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort(); }
    else await route.continue();
  });
  await page.getByText('Withdraw local study records', { exact: true }).click();
  await page.getByRole('button', { name: 'Delete my linked study records', exact: true }).click();
  await expect(page.getByText('Deletion could not be confirmed. Retry the same withdrawal to check its result.', { exact: true })).toBeVisible();
  expect(app.services.fixtureStudy.db.prepare('SELECT id FROM fixture_sessions WHERE id=?').get(studyId)).toBeUndefined();
  expect(await page.evaluate(() => sessionStorage.getItem('tm_creation'))).toBe(creation);
  await page.reload(); await page.getByText('Withdraw local study records', { exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Withdrawal code', exact: true }); await expect(input).toHaveValue('');
  const storage = await page.evaluate(() => Object.values(sessionStorage)); expect(storage.every(value => !value.includes(code))).toBe(true);
  await input.fill(code);
  const retry = page.waitForRequest(request => request.url().endsWith('/api/study-withdrawals') && request.method() === 'POST');
  await page.getByRole('button', { name: 'Delete my linked study records', exact: true }).click();
  expect((await retry).postDataJSON()).toEqual(bodies[0]);
  await expect(page.getByText('Linked local study records were deleted.', { exact: false })).toBeVisible();
  expect(page.url()).toBe(originalUrl);
  await expect(page.getByRole('link', { name: 'Review the saved round request', exact: true })).toHaveAttribute('href', '/play');
  // Refresh loses the code-to-Study binding. Preserve all unproven context for explicit recovery.
  expect(await page.evaluate(() => [sessionStorage.getItem('tm_creation'), sessionStorage.getItem('tm_mutation'), sessionStorage.getItem('tm_recovery')])).toEqual([creation, null, savedRecovery]);
  await page.getByRole('link', { name: 'Review the saved round request', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Discard pending request', exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Discard pending request', exact: true }).click();
  expect(await page.evaluate(() => [sessionStorage.getItem('tm_creation'), sessionStorage.getItem('tm_mutation'), sessionStorage.getItem('tm_recovery')])).toEqual([null, null, null]);
});

for (const delivery of ['immediate false', 'delayed old false'] as const) test(`[Q85] ${delivery} receipt reconciles after completion acknowledgement`, async ({ page, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/study'); await page.getByRole('button', { name: 'Start short synthetic study', exact: true }).click();
  await page.getByRole('button', { name: 'Start next round', exact: true }).click(); await expect(page.getByRole('button', { name: 'Next frame', exact: true })).toBeVisible(); await stepTake(page, 1);
  const id = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId), round = await (await page.request.get('/api/rounds/' + id)).json();
  const feedbackBodies: any[] = []; page.on('request', request => { if (request.url().endsWith('/api/rounds/' + id + '/feedback') && request.method() === 'POST') feedbackBodies.push(request.postDataJSON()); });
  let release: () => void = () => {}; let intercepted: () => void = () => {}; const waiting = new Promise<void>(resolve => { intercepted = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/rounds/' + id + '/events', async route => { if (route.request().postDataJSON().events.some((event: any) => event.name === 'play_completed' && event.attempt === 2)) { intercepted(); await gate; } await route.continue(); });
  await page.getByRole('button', { name: 'View next take', exact: true }).click(); const times = new Set(round.acts[1].score.actors.flatMap((actor: any) => actor.keyframes.map((key: any) => key.tMs)));
  for (let i = 1; i < times.size; i++) await page.getByRole('button', { name: 'Next frame', exact: true }).click(); await waiting;
  let releaseReceipt: () => void = () => {}; let heldReceipt: () => void = () => {}; const receiptGate = new Promise<void>(resolve => { releaseReceipt = resolve; }); const receiptHeld = new Promise<void>(resolve => { heldReceipt = resolve; }); let feedbackReads = 0;
  if (delivery === 'delayed old false') await page.route('**/api/rounds/' + id + '/feedback', async route => { if (++feedbackReads === 1) { const falseReceipt = await route.fetch(); expect((await falseReceipt.json()).secondActCompletionRecorded).toBe(false); heldReceipt(); await receiptGate; await route.fulfill({ response: falseReceipt }); } else await route.continue(); });
  await page.getByRole('button', { name: 'Reveal now', exact: true }).click();
  if (delivery === 'delayed old false') await receiptHeld; else await expect(page.getByRole('combobox', { name: 'How enjoyable was this round?', exact: true })).toBeVisible();
  expect((await (await page.request.get('/api/rounds/' + id + '/feedback')).json()).secondActCompletionRecorded).toBe(false);
  await expect(page.getByRole('combobox', { name: 'How helpful was the second take?', exact: true })).toHaveCount(0);
  const save = page.getByRole('button', { name: 'Save feedback and continue', exact: true }); await expect(save).toBeDisabled(); await save.click({ force: true }); expect(feedbackBodies).toEqual([]);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId)).toBe(id);
  release(); await expect(page.getByRole('combobox', { name: 'How helpful was the second take?', exact: true })).toBeVisible();
  if (delivery === 'delayed old false') { const oldResponse = page.waitForResponse(async response => response.url().endsWith('/api/rounds/' + id + '/feedback') && (await response.json()).secondActCompletionRecorded === false); releaseReceipt(); await (await oldResponse).finished(); await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))); await expect(page.getByRole('combobox', { name: 'How helpful was the second take?', exact: true })).toBeVisible(); expect(feedbackReads).toBe(2); }
  await page.getByRole('combobox', { name: 'How helpful was the second take?', exact: true }).selectOption('5'); await save.click(); await expect(page.getByRole('button', { name: 'Start next round', exact: true })).toBeVisible(); expect(feedbackBodies).toHaveLength(1); expect(feedbackBodies[0].helpfulness).toBe(5);
});
for (const failure of ['unavailable', 'malformed'] as const) test(`[Q85] ${failure} completion receipt holds feedback until an explicit valid check`, async ({ page, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/study'); await page.getByRole('button', { name: 'Start short synthetic study', exact: true }).click();
  await page.getByRole('button', { name: 'Start next round', exact: true }).click(); await expect(page.getByRole('button', { name: 'Next frame', exact: true })).toBeVisible(); await stepTake(page, 1);
  const id = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId);
  await stepTake(page, 2);
  await page.route('**/api/rounds/' + id + '/feedback', route => route.fulfill({ status: failure === 'unavailable' ? 503 : 200, contentType: 'application/json', body: JSON.stringify(failure === 'unavailable' ? { error: { code: 'UNAVAILABLE', retryable: true, requestId: null } } : { saved: false, secondActCompletionRecorded: true, extra: true }) }));
  await page.reload(); await expect(page.getByRole('button', { name: 'Check saved feedback', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'How helpful was the second take?', exact: true })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Save feedback and continue', exact: true })).toBeDisabled();
  await page.unroute('**/api/rounds/' + id + '/feedback'); await page.getByRole('button', { name: 'Check saved feedback', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'How helpful was the second take?', exact: true })).toBeVisible();
});
test('[Q85] two accepted guesses without a recorded second completion do not acquire helpfulness', async ({ page, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/study'); await page.getByRole('button', { name: 'Start short synthetic study', exact: true }).click();
  await page.getByRole('button', { name: 'Start next round', exact: true }).click(); await expect(page.getByRole('button', { name: 'Next frame', exact: true })).toBeVisible(); await stepTake(page, 1);
  const id = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId), round = await (await page.request.get('/api/rounds/' + id)).json();
  const response = await page.request.post('/api/rounds/' + id + '/guesses', { data: { requestId: randomUUID(), revision: round.revision, attempt: 2, guess: 'Synthetic answer without completion' }, headers: { Origin: 'http://127.0.0.1:4317' } }); expect(response.status()).toBe(200);
  await page.reload(); await expect(page.getByRole('combobox', { name: 'How enjoyable was this round?', exact: true })).toBeVisible();
  expect((await (await page.request.get('/api/rounds/' + id)).json()).guesses).toHaveLength(2); expect((await (await page.request.get('/api/rounds/' + id + '/feedback')).json()).secondActCompletionRecorded).toBe(false);
  await expect(page.getByRole('combobox', { name: 'How helpful was the second take?', exact: true })).toHaveCount(0);
});

test('[Q85] unavailable completion acknowledgement offers explicit continuation without helpfulness', async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/study'); await page.getByRole('button', { name: 'Start short synthetic study', exact: true }).click();
  await page.getByRole('button', { name: 'Start next round', exact: true }).click(); await expect(page.getByRole('button', { name: 'Next frame', exact: true })).toBeVisible(); await stepTake(page, 1);
  const id = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId);
  await page.route('**/api/rounds/' + id + '/events', async route => { if (route.request().postDataJSON().events.some((event: any) => event.name === 'play_completed' && event.attempt === 2)) await route.abort(); else await route.continue(); });
  await stepTake(page, 2); await expect(page.getByRole('button', { name: 'Continue without helpfulness', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save feedback and continue', exact: true })).toBeDisabled();
  expect(app.services.events.observations(id).completedViews.filter(play => play.attempt === 2)).toEqual([]);
  await page.getByRole('button', { name: 'Continue without helpfulness', exact: true }).click();
  const feedback = page.waitForRequest(request => request.url().endsWith('/api/rounds/' + id + '/feedback') && request.method() === 'POST');
  await page.getByRole('button', { name: 'Save feedback and continue', exact: true }).click(); expect((await feedback).postDataJSON().helpfulness).toBeNull();
  await expect(page.getByRole('button', { name: 'Start next round', exact: true })).toBeVisible();
});

for (const pending of [false, true]) test(`[Q85] recorded completion survives failed replay with ${pending ? 'a pending exact feedback answer' : 'no pending feedback answer'}`, async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/study'); await page.getByRole('button', { name: 'Start short synthetic study', exact: true }).click();
  await page.getByRole('button', { name: 'Start next round', exact: true }).click(); await expect(page.getByRole('button', { name: 'Next frame', exact: true })).toBeVisible(); await stepTake(page, 1); await stepTake(page, 2);
  const id = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId), round = await (await page.request.get('/api/rounds/' + id)).json();
  const helpfulness = page.getByRole('combobox', { name: 'How helpful was the second take?', exact: true }); await expect(helpfulness).toBeVisible(); await helpfulness.selectOption('5');
  const bodies: any[] = [];
  await page.route('**/api/rounds/' + id + '/feedback', async route => { if (route.request().method() === 'POST') { bodies.push(route.request().postDataJSON()); if (pending && bodies.length === 1) { await route.abort(); return; } } await route.continue(); });
  const save = page.getByRole('button', { name: 'Save feedback and continue', exact: true });
  if (pending) { await save.click(); await expect(page.getByText('Feedback could not be confirmed. Check saved feedback or retry the same answer.', { exact: true })).toBeVisible(); expect(bodies).toHaveLength(1); expect(bodies[0].helpfulness).toBe(5); await expect(helpfulness).toBeDisabled(); }
  let rejected: () => void = () => {}; const replayRejected = new Promise<void>(resolve => { rejected = resolve; });
  await page.route('**/api/rounds/' + id + '/events', async route => { if (route.request().postDataJSON().events.some((event: any) => event.name === 'play_completed' && event.attempt === 2)) { await route.abort(); rejected(); } else await route.continue(); });
  await page.getByRole('button', { name: 'Watch take 2 again', exact: true }).click(); const times = new Set(round.acts[1].score.actors.flatMap((actor: any) => actor.keyframes.map((key: any) => key.tMs)));
  for (let i = 1; i < times.size; i++) await page.getByRole('button', { name: 'Next frame', exact: true }).click(); await replayRejected;
  await expect(page.getByText(/The second-take completion could not be confirmed\.|A second-take completion is already recorded\./)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue without helpfulness', exact: true })).toHaveCount(0);
  await expect(page.getByText('A second-take completion is already recorded. You can continue with your feedback.', { exact: true })).toBeVisible();
  if (pending) { await expect(page.getByText('A feedback answer is awaiting confirmation. Retrying keeps the original answer.', { exact: true })).toBeVisible(); await expect(helpfulness).toBeDisabled(); }
  await expect(helpfulness).toHaveValue('5'); await expect(save).toBeEnabled(); expect(app.services.events.observations(id).completedViews.some(play => play.attempt === 2)).toBe(true);
  await save.click(); await expect(page.getByRole('button', { name: 'Start next round', exact: true })).toBeVisible(); expect(bodies).toHaveLength(pending ? 2 : 1); if (pending) expect(bodies[1]).toEqual(bodies[0]); expect(bodies.at(-1).helpfulness).toBe(5);
});

for (const schedule of [{ kind: 'short', count: 3 }, { kind: 'full', count: 10 }]) {
  test(`[S02] ${schedule.kind} synthetic study completes every scheduled encounter through the app`, async ({ page, app, operator }, info) => {
    test.setTimeout(90000); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/study');
    await page.getByRole('button', { name: `Start ${schedule.kind} synthetic study` }).click(); await expect(page.getByRole('button', { name: 'Start next round' })).toBeVisible();
    const id = new URL(page.url()).searchParams.get('session')!;
    await page.getByRole('button', { name: 'Enter participant mode' }).click(); await expect(page.getByRole('link', { name: 'Rehearsal', exact: true })).toHaveCount(0); expect(new URL(page.url()).searchParams.get('session')).toBe(id);
    for (let i = 0; i < schedule.count; i++) {
      await page.getByRole('button', { name: 'Start next round', exact: true }).click(); await expect(page.getByRole('button', { name: 'Next frame' })).toBeVisible();
      if (i === 0) await page.reload();
      await stepTake(page, 1); await stepTake(page, 2); await expect(page.getByRole('heading', { name: 'Thanks for this interpretation.' })).toBeVisible();
      await page.getByRole('button', { name: 'Save feedback and continue' }).click();
    }
    await expect(page.getByRole('heading', { name: 'One last optional question' })).toBeVisible();
    await page.getByRole('combobox', { name: 'Would you voluntarily play another round?' }).selectOption('yes');
    await page.getByRole('combobox', { name: 'Optional extra round' }).selectOption('no'); await page.getByRole('button', { name: 'Finish and save choices' }).click();
    await expect(page.getByText('Thanks for taking part.', { exact: true })).toBeVisible();
    const service = app.services.fixtureStudy;
    const rows = service.db.prepare('SELECT data FROM fixture_rounds').all().map((r: any) => JSON.parse(r.data)); expect(rows).toHaveLength(schedule.count);
    expect(rows.filter(r => r.plan.phase === 'practice').every(r => r.row.condition === null && r.row.randomized === false && r.row.generation_profile === 'practice_blind_v1')).toBe(true);
    expect(rows.every(r => r.row.provider_calls === 0 && r.row.first_render_status !== 'rendered' && r.row.second_render_status !== 'rendered')).toBe(true);
    if (schedule.kind === 'full') { const measured = rows.filter(r => r.plan.phase === 'comparative'); expect(new Set(measured.map(r => r.row.scene_id)).size).toBe(8); expect(measured.filter(r => r.row.condition === 'informed')).toHaveLength(4); }
    expect((app.services.realStudy.db.prepare('SELECT count(*) n FROM study_sessions').get() as any).n).toBe(0);
    await page.screenshot({ path: browserArtifact(`${info.project.name}-study-${schedule.kind}-complete.png`), fullPage: true });
    const code = service.progress((service as any).sessions.get(id).ownerId, id).withdrawalCode;
    await page.getByText('Withdraw local study records', { exact: true }).click(); await page.getByRole('textbox', { name: 'Withdrawal code' }).fill(code); await page.getByRole('button', { name: 'Delete my linked study records' }).click();
    await expect(page.getByText('Linked local study records were deleted. Previously downloaded files must be deleted by the operator.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Return to the saved study', exact: true })).toHaveCount(0);
    expect((service.db.prepare('SELECT count(*) n FROM fixture_rounds').get() as any).n).toBe(0);
  });
}

test('[S05] optional extra records creation, full playback and normal completion separately', async ({ page, app, operator }) => {
  test.setTimeout(60000); await page.goto('/study'); await page.getByRole('button', { name: 'Start short synthetic study' }).click();
  for (let i = 0; i < 3; i++) { await page.getByRole('button', { name: 'Start next round' }).click(); await page.getByRole('button', { name: 'Reveal now' }).click(); await page.getByRole('button', { name: 'Save feedback and continue' }).click(); }
  await page.getByRole('combobox', { name: 'Optional extra round' }).selectOption('yes'); await page.getByRole('button', { name: 'Finish and save choices' }).click();
  await page.getByRole('button', { name: 'Start next round' }).click();
  await expect(page.getByRole('heading', { name: 'Take 1 of 2.' })).toBeVisible();
  const lastMain = () => JSON.parse((app.services.fixtureStudy.db.prepare('SELECT data FROM fixture_rounds ORDER BY rowid DESC LIMIT 1 OFFSET 1').get() as any).data).row;
  expect(lastMain().optional_extra_accepted).toBe(true); expect(lastMain().optional_extra_started).toBe(false); expect(lastMain().optional_extra_completed).toBeNull();
  await page.getByRole('button', { name: 'Play scene', exact: true }).click(); await expect.poll(() => lastMain().optional_extra_started).toBe(true);
  await expect(page.getByRole('textbox', { name: 'What’s happening?' })).toBeEnabled({ timeout: 12000 }); await page.getByRole('textbox', { name: 'What’s happening?' }).fill('A synthetic first answer'); await page.getByRole('button', { name: 'Send guess', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play next take' })).toBeVisible(); await page.getByRole('button', { name: 'Play next take' }).click();
  await expect(page.getByRole('textbox', { name: 'What do you think now?' })).toBeEnabled({ timeout: 12000 }); await page.getByRole('textbox', { name: 'What do you think now?' }).fill('A synthetic second answer'); await page.getByRole('button', { name: 'Send final guess' }).click();
  await expect.poll(() => lastMain().optional_extra_completed).toBe(true);
});

test('abandoned study encounter continues without inventing reveal feedback', async ({ page, app, operator }) => {
  await page.goto('/study'); await page.getByRole('button', { name: 'Start short synthetic study' }).click(); await page.getByRole('button', { name: 'Start next round' }).click();
  await page.getByRole('button', { name: 'Exit round' }).click(); await expect(page.getByText('The round was stopped.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continue study', exact: true }).click(); await expect(page.getByRole('button', { name: 'Start next round' })).toBeVisible();
  const row = JSON.parse((app.services.fixtureStudy.db.prepare('SELECT data FROM fixture_rounds').get() as any).data).row; expect(row.delight_1_to_5).toBeNull(); expect(row.perceived_helpfulness_1_to_5).toBeNull();
});

test('queued playback events drain after terminal study navigation', async ({ page, app, operator }) => {
  await page.goto('/study'); await page.getByRole('button', { name: 'Start short synthetic study' }).click(); await page.getByRole('button', { name: 'Start next round' }).click();
  await expect(page.getByRole('heading', { name: 'Take 1 of 2.' })).toBeVisible();
  let release!: () => void, held = false; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/rounds/*/events', async route => { if (!held) { held = true; await gate; } await route.continue(); });
  await page.getByRole('button', { name: 'Play scene', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'What’s happening?' })).toBeEnabled({ timeout: 12000 });
  await page.getByRole('button', { name: 'Reveal now' }).click(); await expect(page.getByRole('button', { name: 'Save feedback and continue' })).toBeVisible();
  release();
  await expect.poll(() => JSON.parse((app.services.fixtureStudy.db.prepare('SELECT data FROM fixture_rounds').get() as { data: string }).data).row.first_render_status).toBe('rendered');
});

test('restricted study downloads preserve 96 columns and independently masked coding', async ({ page, app, operator }, info) => {
  await page.goto('/study'); await page.getByRole('button', { name: 'Start short synthetic study' }).click();
  for (let i = 0; i < 3; i++) { await page.getByRole('button', { name: 'Start next round' }).click(); await page.getByRole('button', { name: 'Reveal now' }).click(); await page.getByRole('button', { name: 'Save feedback and continue' }).click(); }
  await page.getByRole('button', { name: 'Finish and save choices' }).click(); await page.goto('/study');
  const run = app.services.fixtureStudy.listRuns()[0]!.studyRunId;
  await page.getByText('Restricted study exports and local commands', { exact: true }).click(); await page.getByRole('combobox', { name: 'Study run ID' }).selectOption(run);
  await page.getByRole('combobox', { name: 'Export format' }).selectOption('analyst_csv'); const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download restricted export' }).click();
  const file = await download; await file.saveAs(browserArtifact(`${info.project.name}-synthetic-analyst.csv`));
  const first = app.services.fixtureStudy.createExport('test-owner', { requestId: randomUUID(), studyRunId: run, format: 'coder_first_csv' });
  const csv = app.services.fixtureStudy.downloadExport('test-owner', first.exportId).bytes.toString(); expect(csv.split('\r\n')[0]).toBe('rowId,rubric,guess');
  expect(() => app.services.fixtureStudy.createExport('test-owner', { requestId: randomUUID(), studyRunId: run, format: 'coder_second_csv' })).toThrow();
  app.services.fixtureStudy.lockFirst(run); expect(app.services.fixtureStudy.createExport('test-owner', { requestId: randomUUID(), studyRunId: run, format: 'coder_second_csv' })).toHaveProperty('exportId');
  const analyst = app.services.fixtureStudy.createExport('test-owner', { requestId: randomUUID(), studyRunId: run, format: 'analyst_csv' }); expect(app.services.fixtureStudy.downloadExport('test-owner', analyst.exportId).bytes.toString().split('\r\n')[0]).toBe(ANALYST_HEADER.join(','));
});
