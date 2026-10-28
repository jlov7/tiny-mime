import { randomUUID } from 'node:crypto';
import { test, expect } from '../support/browser-fixtures.js';
import type { Page } from '@playwright/test';
import { withdrawalDigest } from '../../src/client/studyWithdrawalRecovery.js';

async function start(page: Page) {
  await page.goto('/study'); await page.getByRole('button', { name: 'Start short synthetic study', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start next round', exact: true })).toBeVisible();
  const id = new URL(page.url()).searchParams.get('session')!;
  const code = (await (await page.request.get('/api/study-sessions/' + id)).json()).withdrawalCode as string;
  await page.getByText('Withdraw local study records', { exact: true }).click();
  return { id, code };
}
const input = (page: Page) => page.getByRole('textbox', { name: 'Withdrawal code', exact: true });
const dispatch = (page: Page) => page.getByRole('button', { name: 'Delete my linked study records', exact: true });

test('[Q86] initial setup cannot overwrite a newly saved withdrawal', async ({ page, app, operator }) => {
  const { id, code } = await start(page);
  const session = await (await page.request.post('/api/session', { data: {}, headers: { Origin: 'http://127.0.0.1:4317' } })).json();
  const requestId = randomUUID(), replacement = { version: 1, requestId, bodyDigest: withdrawalDigest(requestId, code), recoveryOwnerId: session.recoveryOwnerId, studySessionId: id };
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let posts = 0;
  page.on('request', request => { if (request.url().endsWith('/api/study-withdrawals')) posts++; });
  await page.route('**/api/session', async route => { await gate; await route.continue(); });
  const setup = page.waitForRequest('**/api/session');
  try {
    await dispatch(page).click(); await setup;
    await page.evaluate(value => sessionStorage.setItem('tm_withdrawal', JSON.stringify(value)), replacement);
    release();
    await expect(page.getByText('This tab cannot safely retain the withdrawal request.', { exact: false })).toBeVisible();
    expect(posts).toBe(0); expect(await page.evaluate(() => sessionStorage.getItem('tm_withdrawal'))).toBe(JSON.stringify(replacement));
    expect(app.services.fixtureStudy.db.prepare('SELECT id FROM fixture_sessions WHERE id=?').get(id)).toBeDefined();
  } finally { release(); }
});

test('[Q86] an undelivered command survives refresh, blocks a different valid code and retries without session setup', async ({ page, app, operator }) => {
  const { id, code } = await start(page); const bodies: any[] = []; let setups = 0;
  await page.route('**/api/study-withdrawals', async route => { bodies.push(route.request().postDataJSON()); if (bodies.length === 1) await route.abort(); else await route.continue(); });
  await dispatch(page).click(); await expect(page.getByText('Deletion could not be confirmed. Retry the same withdrawal to check its result.', { exact: true })).toBeVisible();
  const saved = await page.evaluate(() => sessionStorage.getItem('tm_withdrawal')); expect(saved).not.toContain(code);
  expect(app.services.fixtureStudy.db.prepare('SELECT id FROM fixture_sessions WHERE id=?').get(id)).toBeDefined();
  await page.route('**/api/session', async route => { setups++; await route.continue(); });
  await page.reload(); await page.getByText('Withdraw local study records', { exact: true }).click(); await expect(input(page)).toHaveValue('');
  const different = code === 'A'.repeat(26) ? 'B'.repeat(26) : 'A'.repeat(26); await input(page).fill(different); await dispatch(page).click();
  await expect(page.getByText('This code does not match the saved withdrawal.', { exact: false })).toBeVisible(); expect(bodies).toHaveLength(1); expect(setups).toBe(0);
  expect(await page.evaluate(() => sessionStorage.getItem('tm_withdrawal'))).toBe(saved);
  await input(page).fill(code); await dispatch(page).click(); await expect(page.getByText('Linked local study records were deleted.', { exact: false })).toBeVisible();
  expect(bodies).toHaveLength(2); expect(bodies[1]).toEqual(bodies[0]); expect(setups).toBe(0);
});

for (const failure of ['write', 'readback', 'quota'] as const) test(`[Q86] ${failure} storage failure sends no withdrawal`, async ({ page, app, operator }) => {
  const { id } = await start(page); let posts = 0; page.on('request', request => { if (request.url().endsWith('/api/study-withdrawals')) posts++; });
  await page.evaluate(failure => {
    if (failure === 'quota') sessionStorage.setItem('tm_study_start', 'é'.repeat(4000));
    else { const write = Storage.prototype.setItem; Storage.prototype.setItem = function (key, value) { if (this === sessionStorage && key === 'tm_withdrawal') { if (failure === 'write') throw new Error('storage unavailable'); return; } write.call(this, key, value); }; }
  }, failure);
  await dispatch(page).click(); await expect(page.getByText('This tab cannot safely retain the withdrawal request.', { exact: false })).toBeVisible();
  expect(posts).toBe(0); expect(app.services.fixtureStudy.db.prepare('SELECT id FROM fixture_sessions WHERE id=?').get(id)).toBeDefined();
});

test('[Q86] malformed saved metadata blocks dispatch until explicit scoped discard', async ({ page, app, operator }) => {
  const { id } = await start(page);
  await page.evaluate(() => { sessionStorage.setItem('tm_withdrawal', '{"version":2}'); sessionStorage.setItem('tm_recovery', 'unrelated-saved-value'); });
  let posts = 0, setups = 0; page.on('request', request => { if (request.url().endsWith('/api/study-withdrawals')) posts++; if (request.url().endsWith('/api/session')) setups++; });
  await page.reload(); await page.getByText('Withdraw local study records', { exact: true }).click();
  await expect(input(page)).toBeDisabled(); await expect(dispatch(page)).toBeDisabled(); expect(posts).toBe(0); expect(setups).toBe(0);
  await page.getByRole('button', { name: 'Discard saved withdrawal request', exact: true }).click();
  await expect(page.getByText('The saved withdrawal request was discarded. Deletion is not confirmed.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('tm_withdrawal'))).toBeNull(); expect(await page.evaluate(() => sessionStorage.getItem('tm_recovery'))).toBe('unrelated-saved-value');
  expect(app.services.fixtureStudy.db.prepare('SELECT id FROM fixture_sessions WHERE id=?').get(id)).toBeDefined();
});

for (const outcome of ['malformed', 'conflict', 'not_found', 'limited'] as const) test(`[Q86] ${outcome} outcome keeps the exact descriptor across refresh and discard is scoped`, async ({ page, app, operator }) => {
  const { id, code } = await start(page); const statuses = { malformed: 200, conflict: 409, not_found: 404, limited: 429 };
  await page.route('**/api/study-withdrawals', route => route.fulfill({ status: statuses[outcome], contentType: 'application/json', body: JSON.stringify(outcome === 'malformed' ? { deleted: true, extra: true } : { error: { code: outcome === 'conflict' ? 'IDEMPOTENCY_CONFLICT' : outcome === 'limited' ? 'LIMITED' : 'NOT_FOUND', retryable: false, requestId: route.request().postDataJSON().requestId } }) }));
  await dispatch(page).click();
  await expect(page.getByText(outcome === 'limited' ? 'The withdrawal attempt limit was reached. Deletion is not confirmed. Ask the facilitator before trying again.' : outcome === 'not_found' ? 'No matching local study records were found for this code. Check the code or ask the facilitator.' : 'Deletion could not be confirmed. Retry the same withdrawal to check its result.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry same withdrawal', exact: true })).toBeEnabled();
  const saved = await page.evaluate(() => sessionStorage.getItem('tm_withdrawal')); expect(saved).not.toBeNull(); expect(saved).not.toContain(code);
  await page.reload(); await page.getByText('Withdraw local study records', { exact: true }).click(); await expect(input(page)).toHaveValue('');
  expect(await page.evaluate(() => sessionStorage.getItem('tm_withdrawal'))).toBe(saved);
  await page.evaluate(() => sessionStorage.setItem('tm_recovery', 'other-recovery'));
  await page.getByRole('button', { name: 'Discard saved withdrawal request', exact: true }).click();
  await expect(page.getByText('The saved withdrawal request was discarded. Deletion is not confirmed.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('tm_recovery'))).toBe('other-recovery'); expect(app.services.fixtureStudy.db.prepare('SELECT id FROM fixture_sessions WHERE id=?').get(id)).toBeDefined();
});

test('[Q86] cookie replacement immediately before dispatch fails atomically without deletion', async ({ page, context, app, operator }) => {
  const { id } = await start(page);
  await page.route('**/api/study-withdrawals', async route => {
    await context.clearCookies({ name: 'tm_session' }); const replacement = await context.request.post('/api/session', { data: {}, headers: { Origin: 'http://127.0.0.1:4317' } }); expect(replacement.status()).toBe(200);
    const cookies = await context.cookies(); const cookie = cookies.map(value => value.name + '=' + value.value).join('; ');
    await route.continue({ headers: { ...await route.request().allHeaders(), cookie } });
  });
  const response = page.waitForResponse(response => response.url().endsWith('/api/study-withdrawals'));
  await dispatch(page).click(); expect((await response).status()).toBe(401);
  await expect(page.getByText('The local session is unavailable. Deletion is not confirmed.', { exact: false })).toBeVisible();
  expect(app.services.fixtureStudy.db.prepare('SELECT id FROM fixture_sessions WHERE id=?').get(id)).toBeDefined(); expect(await page.evaluate(() => sessionStorage.getItem('tm_withdrawal'))).not.toBeNull();
});

test('[Q86] matching Study creation never authorizes cleanup of unrelated private recovery', async ({ page, app, operator }) => {
  const { id } = await start(page); await page.getByText('Withdraw local study records', { exact: true }).click();
  await page.getByRole('button', { name: 'Start next round', exact: true }).click(); await page.getByRole('button', { name: 'Reveal now', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'How enjoyable was this round?', exact: true })).toBeVisible();
  const headers = { Origin: 'http://127.0.0.1:4317' };
  const created = await page.request.post('/api/rounds', { headers, data: { requestId: randomUUID(), mode: 'private_play', executionMode: 'fixture', studySessionId: null } }); expect(created.status()).toBe(201);
  const privateRound = await created.json(), requestId = randomUUID();
  const skipped = await page.request.post('/api/rounds/' + privateRound.roundId + '/skip', { headers, data: { requestId, revision: privateRound.revision } }); expect(skipped.status()).toBe(200);
  const recovery = { version: 1, roundId: privateRound.roundId, clientTimeout: false, clockUncertain: false, timeoutEventId: null, clockUncertainEventId: null };
  const mutation = { version: 1, roundId: privateRound.roundId, requestId, kind: 'skip', revision: privateRound.revision, submittedWallMs: Date.now(), deadlineWallMs: null, lastObservedWallMs: Date.now(), clockUncertain: false };
  await page.evaluate(({ recovery, mutation }) => { sessionStorage.setItem('tm_recovery', JSON.stringify(recovery)); sessionStorage.setItem('tm_mutation', JSON.stringify(mutation)); }, { recovery, mutation });
  const saved = await page.evaluate(() => [sessionStorage.getItem('tm_mutation'), sessionStorage.getItem('tm_recovery')]);
  await page.getByText('Withdraw local study records', { exact: true }).click(); await dispatch(page).click();
  await expect(page.getByText('Linked local study records were deleted.', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('tm_creation'))).toBeNull(); expect(await page.evaluate(() => [sessionStorage.getItem('tm_mutation'), sessionStorage.getItem('tm_recovery')])).toEqual(saved);
  expect(app.services.fixtureStudy.db.prepare('SELECT id FROM fixture_sessions WHERE id=?').get(id)).toBeUndefined();
  await page.getByRole('link', { name: 'Review the saved round request', exact: true }).click(); await expect(page.getByRole('heading', { name: 'The scene was meant to show…', exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId)).toBe(privateRound.roundId);
});

test('[Q86] tampering a restored older-withdrawal hint cannot erase active Study context', async ({ page, app, operator }) => {
  const { id: olderId, code } = await start(page); await page.getByText('Withdraw local study records', { exact: true }).click();
  for (let i = 0; i < 3; i++) { await page.getByRole('button', { name: 'Start next round', exact: true }).click(); await page.getByRole('button', { name: 'Reveal now', exact: true }).click(); await page.getByRole('button', { name: 'Save feedback and continue', exact: true }).click(); }
  await page.getByRole('button', { name: 'Finish and save choices', exact: true }).click(); await expect(page.getByText('Thanks for taking part.', { exact: true })).toBeVisible();
  const { id: activeId } = await start(page); await page.getByText('Withdraw local study records', { exact: true }).click(); await page.getByRole('button', { name: 'Start next round', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Take 1 of 2.', exact: true })).toBeVisible();
  const activeUrl = page.url(), saved = await page.evaluate(() => ['tm_creation', 'tm_mutation', 'tm_recovery'].map(key => sessionStorage.getItem(key)));
  let count = 0; await page.route('**/api/study-withdrawals', async route => { if (++count === 1) { const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort(); } else await route.continue(); });
  await page.getByText('Withdraw local study records', { exact: true }).click(); await input(page).fill(code); await dispatch(page).click();
  await expect(page.getByText('Deletion could not be confirmed. Retry the same withdrawal to check its result.', { exact: true })).toBeVisible();
  expect(app.services.fixtureStudy.db.prepare('SELECT id FROM fixture_sessions WHERE id=?').get(olderId)).toBeUndefined();
  await page.evaluate(activeId => { const descriptor = JSON.parse(sessionStorage.getItem('tm_withdrawal')!); descriptor.studySessionId = activeId; sessionStorage.setItem('tm_withdrawal', JSON.stringify(descriptor)); }, activeId);
  await page.reload(); await page.getByText('Withdraw local study records', { exact: true }).click(); await input(page).fill(code); await dispatch(page).click();
  await expect(page.getByText('Linked local study records were deleted.', { exact: false })).toBeVisible();
  expect(page.url()).toBe(activeUrl); expect(await page.evaluate(() => ['tm_creation', 'tm_mutation', 'tm_recovery'].map(key => sessionStorage.getItem(key)))).toEqual(saved);
  expect(app.services.fixtureStudy.db.prepare('SELECT id FROM fixture_sessions WHERE id=?').get(activeId)).toBeDefined(); await expect(page.getByRole('heading', { name: 'Take 1 of 2.', exact: true })).toBeVisible();
});

test('[Q86] a withdrawal descriptor replaced while awaiting acknowledgement is preserved', async ({ page, operator }) => {
  await start(page); let replacement = '';
  await page.route('**/api/study-withdrawals', async route => {
    const result = await route.fetch(); expect(result.status()).toBe(200);
    replacement = JSON.stringify({ version: 1, requestId: randomUUID(), bodyDigest: 'a'.repeat(64), recoveryOwnerId: randomUUID(), studySessionId: null });
    await page.evaluate(replacement => sessionStorage.setItem('tm_withdrawal', replacement), replacement);
    await route.fulfill({ response: result });
  });
  await dispatch(page).click(); await expect(page.getByText('Linked local study records were deleted.', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('tm_withdrawal'))).toBe(replacement); await page.getByText('Withdraw local study records', { exact: true }).click(); await expect(input(page)).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Discard saved withdrawal request', exact: true })).toBeVisible();
});

for (const metadata of ['creation', 'start'] as const) test(`[Q86] untrusted ${metadata} labels cannot authorize deletion of another Study's recovery`, async ({ page, app, operator }) => {
  const olderStart = page.waitForRequest(request => request.url().endsWith('/api/operator/study-rehearsals') && request.method() === 'POST');
  const { id: olderId } = await start(page); const olderStartId = (await olderStart).postDataJSON().requestId;
  await page.getByRole('button', { name: 'Start next round', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Take 1 of 2.', exact: true })).toBeVisible();
  const older = await page.evaluate(() => ({ creation: JSON.parse(sessionStorage.getItem('tm_creation')!), recovery: JSON.parse(sessionStorage.getItem('tm_recovery')!) }));
  for (let i = 0; i < 3; i++) { if (i) await page.getByRole('button', { name: 'Start next round', exact: true }).click(); await page.getByRole('button', { name: 'Reveal now', exact: true }).click(); await page.getByRole('button', { name: 'Save feedback and continue', exact: true }).click(); }
  await page.getByRole('button', { name: 'Finish and save choices', exact: true }).click(); await expect(page.getByText('Thanks for taking part.', { exact: true })).toBeVisible();
  const { id } = await start(page);
  if (metadata === 'creation') await page.evaluate(({ older, id }) => { sessionStorage.setItem('tm_creation', JSON.stringify({ ...older.creation, studySessionId: id })); sessionStorage.setItem('tm_recovery', JSON.stringify(older.recovery)); }, { older, id });
  else await page.evaluate(({ olderStartId, id }) => sessionStorage.setItem('tm_study_start', JSON.stringify({ version: 1, requestId: olderStartId, kind: 'rehearsal', fixtureScheduleId: 'synthetic_short_v1', createdWallMs: Date.now(), acceptedSessionId: id })), { olderStartId, id });
  const keys = metadata === 'creation' ? ['tm_creation', 'tm_recovery'] : ['tm_study_start']; const saved = await page.evaluate(keys => keys.map(key => sessionStorage.getItem(key)), keys);
  await dispatch(page).click(); await expect(page.getByText('Linked local study records were deleted.', { exact: false })).toBeVisible();
  expect(await page.evaluate(keys => keys.map(key => sessionStorage.getItem(key)), keys)).toEqual(saved);
  expect(app.services.fixtureStudy.db.prepare('SELECT id FROM fixture_sessions WHERE id=?').get(id)).toBeUndefined(); expect(app.services.fixtureStudy.db.prepare('SELECT id FROM fixture_sessions WHERE id=?').get(olderId)).toBeDefined();
  await expect(page.getByRole('link', { name: metadata === 'creation' ? 'Review the saved round request' : 'Review the saved study start', exact: true })).toBeVisible();
});

test('[Q86] coherent server-proven creation and study-start descriptors clear after confirmed withdrawal', async ({ page, operator }) => {
  const started = page.waitForRequest(request => request.url().endsWith('/api/operator/study-rehearsals') && request.method() === 'POST'); const { id } = await start(page); const requestId = (await started).postDataJSON().requestId;
  await page.getByRole('button', { name: 'Start next round', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Take 1 of 2.', exact: true })).toBeVisible();
  await page.evaluate(({ requestId, id }) => sessionStorage.setItem('tm_study_start', JSON.stringify({ version: 1, requestId, kind: 'rehearsal', fixtureScheduleId: 'synthetic_short_v1', createdWallMs: Date.now(), acceptedSessionId: id })), { requestId, id });
  const creation = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_creation')!)), roundId = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId);
  expect((await (await page.request.get(`/api/study-sessions/${id}/rounds/${roundId}/creation-requests/${creation.requestId}/status`)).json()).accepted).toBe(true); expect((await (await page.request.get('/api/study-start-requests/' + requestId)).json()).studySessionId).toBe(id);
  await dispatch(page).click(); await expect(page.getByText('Linked local study records were deleted.', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => ['tm_creation', 'tm_mutation', 'tm_recovery', 'tm_study_start', 'tm_withdrawal'].map(key => sessionStorage.getItem(key)))).toEqual([null, null, null, null, null]); expect(new URL(page.url()).search).toBe('');
});

for (const proof of ['missing', 'unavailable'] as const) test(`[Q86] ${proof} cleanup proof preserves coherent saved descriptors`, async ({ page, operator }) => {
  const started = page.waitForRequest(request => request.url().endsWith('/api/operator/study-rehearsals') && request.method() === 'POST'); const { id } = await start(page); const requestId = (await started).postDataJSON().requestId;
  await page.getByRole('button', { name: 'Start next round', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Take 1 of 2.', exact: true })).toBeVisible();
  await page.evaluate(({ requestId, id }) => sessionStorage.setItem('tm_study_start', JSON.stringify({ version: 1, requestId, kind: 'rehearsal', fixtureScheduleId: 'synthetic_short_v1', createdWallMs: Date.now(), acceptedSessionId: id })), { requestId, id });
  const saved = await page.evaluate(() => ['tm_creation', 'tm_recovery', 'tm_study_start'].map(key => sessionStorage.getItem(key)));
  const rejectProof = (route: any) => route.fulfill({ status: proof === 'missing' ? 404 : 503, contentType: 'application/json', body: JSON.stringify({ error: { code: proof === 'missing' ? 'NOT_FOUND' : 'UNAVAILABLE', retryable: proof === 'unavailable', requestId: null } }) });
  await page.route('**/api/study-sessions/*/rounds/*/creation-requests/*/status', rejectProof); await page.route('**/api/study-start-requests/*', rejectProof);
  await dispatch(page).click(); await expect(page.getByText('Linked local study records were deleted.', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => ['tm_creation', 'tm_recovery', 'tm_study_start'].map(key => sessionStorage.getItem(key)))).toEqual(saved);
  await expect(page.getByRole('link', { name: 'Review the saved round request', exact: true })).toBeVisible(); await expect(page.getByRole('link', { name: 'Review the saved study start', exact: true })).toBeVisible();
});

test('[Q86] server-proven descriptors replaced while awaiting withdrawal acknowledgement remain unchanged', async ({ page, operator }) => {
  const started = page.waitForRequest(request => request.url().endsWith('/api/operator/study-rehearsals') && request.method() === 'POST'); const { id } = await start(page); const requestId = (await started).postDataJSON().requestId;
  await page.getByRole('button', { name: 'Start next round', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Take 1 of 2.', exact: true })).toBeVisible();
  await page.evaluate(({ requestId, id }) => sessionStorage.setItem('tm_study_start', JSON.stringify({ version: 1, requestId, kind: 'rehearsal', fixtureScheduleId: 'synthetic_short_v1', createdWallMs: Date.now(), acceptedSessionId: id })), { requestId, id });
  let replacement: (string | null)[] = [];
  await page.route('**/api/study-withdrawals', async route => {
    const result = await route.fetch(); expect(result.status()).toBe(200);
    replacement = await page.evaluate(() => {
      const creation = JSON.parse(sessionStorage.getItem('tm_creation')!), recovery = JSON.parse(sessionStorage.getItem('tm_recovery')!), start = JSON.parse(sessionStorage.getItem('tm_study_start')!);
      sessionStorage.setItem('tm_creation', JSON.stringify({ ...creation, createdWallMs: creation.createdWallMs + 1 })); sessionStorage.setItem('tm_recovery', JSON.stringify({ ...recovery, clockUncertain: true })); sessionStorage.setItem('tm_study_start', JSON.stringify({ ...start, createdWallMs: start.createdWallMs + 1 }));
      sessionStorage.setItem('tm_mutation', JSON.stringify({ version: 1, roundId: recovery.roundId, requestId: crypto.randomUUID(), kind: 'skip', revision: 0, submittedWallMs: Date.now(), deadlineWallMs: null, lastObservedWallMs: Date.now(), clockUncertain: false }));
      return ['tm_creation', 'tm_mutation', 'tm_recovery', 'tm_study_start'].map(key => sessionStorage.getItem(key));
    });
    await route.fulfill({ response: result });
  });
  await dispatch(page).click(); await expect(page.getByText('Linked local study records were deleted.', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => ['tm_creation', 'tm_mutation', 'tm_recovery', 'tm_study_start'].map(key => sessionStorage.getItem(key)))).toEqual(replacement);
});
