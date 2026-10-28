import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApplication, ORIGIN } from '../../src/server/http.js';
import { matchesContract } from '../../src/server/contracts.js';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { disabledProviderConfig, type ProviderConfigV1 } from '../../src/server/providerConfig.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function server(development = false, dataDir?: string) {
  let secret = ''; let now = Date.now(); let mono = 0;
  const app = await createApplication({ memory: !dataDir, dataDir, development, onLaunchSecret: value => { secret = value; }, nowWall: () => now, nowMono: () => mono, fixtureDelayMs: 1 });
  const host = http.createServer(app.handler);
  await new Promise<void>(resolve => host.listen(0, '127.0.0.1', resolve));
  const port = (host.address() as { port: number }).port; let cookie = '';
  let closed = false; const stop = async () => { if (closed) return; closed = true; await new Promise<void>(resolve => host.close(() => resolve())); await app.close(); }; cleanup.push(stop);
  async function call(route: string, body?: any, override: Record<string, string> = {}, raw?: string) {
    const payload = raw ?? (body === undefined ? undefined : JSON.stringify(body));
    const response = await new Promise<{ status: number; headers: http.IncomingHttpHeaders; text: string }>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: route, method: payload === undefined ? 'GET' : 'POST', headers: { Host: '127.0.0.1:4317', Origin: ORIGIN, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...override } }, res => { const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') })); });
      req.on('error', reject); req.end(payload);
    });
    const next = response.headers['set-cookie']?.[0]; if (next) { const name = next.split('=')[0]; cookie = cookie.split('; ').filter(part => !part.startsWith(name + '=')).concat(next.split(';')[0]).filter(Boolean).join('; '); }
    const value = response.headers['content-type']?.includes('application/json') ? JSON.parse(response.text) : response.text; return { status: response.status, value, response };
  }
  const establish = () => call('/api/session', {});
  const unlock = async () => { const result = await call('/api/operator/bootstrap', { launchSecret: secret }); expect(result.status).toBe(200); return result; };
  return { app, port, call, establish, unlock, stop, advance: (ms: number) => { now += ms; mono += ms; }, cookie: () => cookie };
}
const createBody = (requestId = randomUUID()) => ({ requestId, mode: 'private_play', executionMode: 'fixture', studySessionId: null });

function configureFakeProvider(purpose: NonNullable<ProviderConfigV1['approval']>['purpose']) {
  mkdirSync('.scratch', { recursive: true }); const dir = mkdtempSync(resolve('.scratch/http-provider-'));
  cleanup.push(async () => { rmSync(dir, { recursive: true }); });
  const config = disabledProviderConfig(); const now = Date.now(); config.provider = 'openai_responses'; config.modelId = 'mock-supported-model';
  config.priceSnapshot = { sourceUrl: 'https://openai.com/api/pricing/', checkedAt: new Date(now - 1000).toISOString(), inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.1, otherChargeMicroUsd: 0, tokenAccountingVerified: true };
  config.approval = { approvalId: randomUUID(), approvedAt: new Date(now - 2000).toISOString(), expiresAt: new Date(now + 86400000).toISOString(), purpose, providerDisclosureVersion: 'fixture-disclosure', budgetAcknowledged: true };
  Object.assign(config.runtime, { enabled: true, callCapUsd: 0.1, unitCapUsd: 0.2, dayCapUsd: 5, jobCapUsd: 5, approvedCaseCount: 1 });
  const file = join(dir, 'provider.json'); writeFileSync(file, JSON.stringify(config));
  writeFileSync(file + '.evidence.json', JSON.stringify({ version: 1, modelId: config.modelId, officialSourceUrl: 'https://developers.openai.com/api/docs/models/', checkedAt: new Date(now).toISOString(), responsesSupported: true, strictStructuredOutputsSupported: true, inputBytesPlus1024Verified: true, boundedOutputBillingVerified: true, explicitSpendingApproved: true, approvalId: config.approval.approvalId, providerDisclosureVersion: config.approval.providerDisclosureVersion }));
  vi.stubEnv('TM_PROVIDER_CONFIG', file); vi.stubEnv('TM_PROVIDER_MODE', config.provider); vi.stubEnv('TM_MODEL_ID', config.modelId); vi.stubEnv('OPENAI_API_KEY', 'fake-fixture-value');
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Actual network forbidden in mocks'); }));
}
async function captureCompletedRound(s: Awaited<ReturnType<typeof server>>, studySessionId: string | null = null) {
  const created = await s.call('/api/rounds', { ...createBody(), mode: studySessionId ? 'study' : 'private_play', studySessionId }); expect(created.status).toBe(201);
  const id = created.value.roundId;
  await s.call('/api/rounds/' + id + '/guesses', { requestId: randomUUID(), revision: 0, attempt: 1, guess: 'A synthetic first answer' }); await new Promise(resolve => setTimeout(resolve, 10));
  const ready = await s.call('/api/rounds/' + id); expect(ready.value.state).toBe('awaiting_guess2');
  const final = await s.call('/api/rounds/' + id + '/guesses', { requestId: randomUUID(), revision: ready.value.revision, attempt: 2, guess: 'A synthetic second answer' }); expect(final.value.state).toBe('revealed');
  const events = final.value.acts.flatMap((act: any, index: number) => {
    const reference = { attempt: act.attempt, scoreHash: act.scoreHash, playId: randomUUID(), playbackMode: 'frame_step' };
    return [{ ...reference, eventId: randomUUID(), clientSequence: index * 2 + 1, elapsedMs: null, name: 'play_started', isReplay: false }, { ...reference, eventId: randomUUID(), clientSequence: index * 2 + 2, elapsedMs: null, name: 'play_completed', playedElapsedMs: act.score.durationMs }];
  });
  expect((await s.call('/api/rounds/' + id + '/events', { requestId: randomUUID(), events })).status).toBe(200);
  const input = { requestId: randomUUID(), roundId: id, includeGuessText: false, timing: 'original', shortenedWaitMs: null };
  const captured = await s.call('/api/operator/captures', input); expect(captured.status).toBe(201);
  return { input, receipt: captured.value };
}

describe('local HTTP boundary and complete fixture loop', () => {

  it('study-only approval cannot admit private or creator live rounds or reserve provider calls', async () => {
    configureFakeProvider('runtime_study'); const s = await server(); await s.establish(); await s.unlock();
    const owner = s.app.services.sessions.lookup(s.cookie().split('tm_session=')[1].split(';')[0])!; owner.providerConsent = 'fixture-disclosure';
    const reserve = vi.spyOn(s.app.services.ledger, 'reserve');
    expect((await s.call('/api/rounds', { ...createBody(), executionMode: 'live' })).status).toBe(503);
    expect((await s.call('/api/operator/creator-rounds', { requestId: randomUUID(), sceneId: 'TM01', creatorOwned: true, executionMode: 'live' })).status).toBe(503);
    expect(owner.activeRoundId).toBeNull(); expect(reserve).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('rechecks the round purpose before provider reservation and transport dispatch', async () => {
    configureFakeProvider('runtime_private_play'); const s = await server(); await s.establish();
    expect((await s.call('/api/provider-consent', { requestId: randomUUID(), disclosureVersion: 'fixture-disclosure', accepted: true })).status).toBe(200);
    const created = await s.call('/api/rounds', { ...createBody(), executionMode: 'live' }); expect(created.status).toBe(201);
    const owner = s.app.services.sessions.lookup(s.cookie().split('tm_session=')[1].split(';')[0])!;
    const round = s.app.services.rounds.internal(owner, created.value.roundId); if ('error' in round) throw new Error(round.error.code);
    round.public.mode = 'study'; const reserve = vi.spyOn(s.app.services.ledger, 'reserve');
    await s.call('/api/rounds/' + created.value.roundId + '/guesses', { requestId: randomUUID(), revision: 0, attempt: 1, guess: 'A synthetic first answer' });
    await new Promise(resolve => setImmediate(resolve));
    expect((await s.call('/api/rounds/' + created.value.roundId)).value.state).toBe('unavailable');
    expect(reserve).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('private-play approval cannot enable real Study activation', async () => {
    configureFakeProvider('runtime_private_play'); vi.stubEnv('TM_STUDY_ENABLED', 'true'); vi.stubEnv('TM_STUDY_MANIFEST', resolve('.scratch/never-read-study-manifest.json'));
    await expect(createApplication({ memory: true })).rejects.toThrow('STUDY_CONFIGURATION'); expect(fetch).not.toHaveBeenCalled();
  });
  it('binds strict withdrawal requests to the authenticated owner before replay, conflicts and limits', async () => {
    const s = await server(); const first = await s.establish(); const owner = first.value.recoveryOwnerId;
    expect(first.value).toEqual({ sessionReady: true, activeRoundId: null, recoveryOwnerId: expect.any(String) });
    expect(s.cookie()).not.toContain(owner); await s.unlock();
    const study = await s.call('/api/operator/study-rehearsals', { requestId: randomUUID(), fixtureScheduleId: 'synthetic_short_v1' });
    const code = (await s.call('/api/study-sessions/' + study.value.studySessionId)).value.withdrawalCode;
    const body = { requestId: randomUUID(), withdrawalCode: code, expectedRecoveryOwnerId: owner };
    expect(matchesContract('StudyWithdraw', body)).toBe(true);
    for (const invalid of [{ requestId: body.requestId, withdrawalCode: code }, { ...body, extra: true }, { ...body, expectedRecoveryOwnerId: 'invalid' }]) expect((await s.call('/api/study-withdrawals', invalid)).status).toBe(400);
    expect((await s.call('/api/study-withdrawals', { ...body, expectedRecoveryOwnerId: randomUUID() })).status).toBe(401);
    expect((await s.call('/api/study-sessions/' + study.value.studySessionId)).status).toBe(200);
    expect((await s.call('/api/study-withdrawals', body)).value).toEqual({ deleted: true });
    for (let i = 0; i < 4; i++) expect((await s.call('/api/study-withdrawals', { ...body, requestId: randomUUID(), withdrawalCode: 'A'.repeat(26) })).status).toBe(404);
    expect((await s.call('/api/study-withdrawals', { ...body, requestId: randomUUID() })).status).toBe(429);
    expect((await s.call('/api/study-withdrawals', body)).value).toEqual({ deleted: true });
    expect((await s.call('/api/study-withdrawals', { ...body, expectedRecoveryOwnerId: randomUUID() })).status).toBe(401);
    expect((await s.call('/api/study-withdrawals', { ...body, withdrawalCode: 'B'.repeat(26) })).status).toBe(409);
    expect((await s.call('/api/study-withdrawals', body, { Cookie: '' })).status).toBe(401);
    const replacement = await s.call('/api/session', {}, { Cookie: '' }); expect(replacement.value.recoveryOwnerId).not.toBe(owner);
    expect((await s.call('/api/study-withdrawals', body)).status).toBe(401);
    const restarted = await server(); expect((await restarted.call('/api/study-withdrawals', body, { Cookie: s.cookie() })).status).toBe(401);
  });
  it('keeps the original eight-hour owner lifetime despite normal session receipts', async () => {
    const s = await server(), first = await s.establish(); await s.unlock();
    const study = await s.call('/api/operator/study-rehearsals', { requestId: randomUUID(), fixtureScheduleId: 'synthetic_short_v1' });
    const code = (await s.call('/api/study-sessions/' + study.value.studySessionId)).value.withdrawalCode; s.advance(7 * 3600000);
    expect((await s.establish()).value).toEqual(first.value); s.advance(3600000);
    const body = { requestId: randomUUID(), withdrawalCode: code, expectedRecoveryOwnerId: first.value.recoveryOwnerId };
    expect((await s.call('/api/study-withdrawals', body)).status).toBe(401);
    expect(s.app.services.fixtureStudy.db.prepare('SELECT id FROM fixture_sessions WHERE id=?').get(study.value.studySessionId)).toBeDefined();
    expect((await s.establish()).value.recoveryOwnerId).not.toBe(first.value.recoveryOwnerId);
  });
  for (const cached of [false, true]) it(`rejects an owner expiring during a held withdrawal body before ${cached ? 'cached replay' : 'mutation'}`, async () => {
    const s = await server(), owner = (await s.establish()).value.recoveryOwnerId; await s.unlock();
    const study = await s.call('/api/operator/study-rehearsals', { requestId: randomUUID(), fixtureScheduleId: 'synthetic_short_v1' });
    const code = (await s.call('/api/study-sessions/' + study.value.studySessionId)).value.withdrawalCode;
    const body = { requestId: randomUUID(), withdrawalCode: code, expectedRecoveryOwnerId: owner };
    if (cached) expect((await s.call('/api/study-withdrawals', body)).status).toBe(200);
    s.advance(8 * 3600000 - 1000);
    let observed: () => void = () => {}; const authenticated = new Promise<void>(resolve => { observed = resolve; }); const lookup = s.app.services.sessions.lookup.bind(s.app.services.sessions);
    vi.spyOn(s.app.services.sessions, 'lookup').mockImplementation(token => { const value = lookup(token); if (value) observed(); return value; });
    let outgoing: http.ClientRequest;
    const response = new Promise<{ status: number; value: any }>((resolve, reject) => {
      outgoing = http.request({ host: '127.0.0.1', port: s.port, path: '/api/study-withdrawals', method: 'POST', headers: { Host: '127.0.0.1:4317', Origin: ORIGIN, 'Content-Type': 'application/json', Cookie: s.cookie() } }, res => { const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode!, value: JSON.parse(Buffer.concat(chunks).toString()) })); });
      outgoing.on('error', reject); outgoing.write(JSON.stringify(body).slice(0, -1));
    });
    await authenticated; s.advance(1000); outgoing!.end('}');
    expect(await response).toEqual({ status: 401, value: { error: { code: 'UNAUTHENTICATED', retryable: false, requestId: body.requestId } } });
    if (!cached) expect(s.app.services.fixtureStudy.db.prepare('SELECT id FROM fixture_sessions WHERE id=?').get(study.value.studySessionId)).toBeDefined();
  });
  it('denies recorded completion receipts after withdrawal', async () => {
    const s = await server(); const owner = (await s.establish()).value.recoveryOwnerId; await s.unlock();
    const study = await s.call('/api/operator/study-rehearsals', { requestId: randomUUID(), fixtureScheduleId: 'synthetic_short_v1' });
    const captured = await captureCompletedRound(s, study.value.studySessionId), path = `/api/rounds/${captured.input.roundId}/feedback`;
    expect((await s.call(path)).value).toEqual({ saved: false, secondActCompletionRecorded: true });
    const code = (await s.call('/api/study-sessions/' + study.value.studySessionId)).value.withdrawalCode;
    expect((await s.call('/api/study-withdrawals', { requestId: randomUUID(), withdrawalCode: code, expectedRecoveryOwnerId: owner })).status).toBe(200);
    expect((await s.call(path)).status).toBe(404);
  });
  it('withdrawal revokes only matching capture bundles and receipts while preserving request binding', async () => {
    const s = await server(); await s.establish(); await s.unlock();
    const unrelated = await captureCompletedRound(s);
    const study = await s.call('/api/operator/study-rehearsals', { requestId: randomUUID(), fixtureScheduleId: 'synthetic_short_v1' });
    const progress = await s.call('/api/study-sessions/' + study.value.studySessionId);
    const captured = await captureCompletedRound(s, study.value.studySessionId);
    expect((await s.call('/api/operator/captures', captured.input)).value).toEqual(captured.receipt);
    const downloadedInput = { ...captured.input, requestId: randomUUID() }; const downloaded = await s.call('/api/operator/captures', downloadedInput); expect(downloaded.status).toBe(201);
    expect((await s.call('/api/operator/captures/' + downloaded.value.captureId)).status).toBe(200);
    const withdrawal = { requestId: randomUUID(), withdrawalCode: progress.value.withdrawalCode, expectedRecoveryOwnerId: (await s.establish()).value.recoveryOwnerId };
    expect((await s.call('/api/study-withdrawals', withdrawal)).value).toEqual({ deleted: true });
    expect((await s.call('/api/study-withdrawals', withdrawal)).value).toEqual({ deleted: true });
    expect((await s.call('/api/operator/captures/' + captured.receipt.captureId)).status).toBe(404);
    expect((await s.call('/api/operator/captures', captured.input)).status).toBe(404);
    expect((await s.call('/api/operator/captures', downloadedInput)).status).toBe(404);
    expect((await s.call('/api/operator/captures', { ...captured.input, includeGuessText: true })).status).toBe(409);
    expect((await s.call('/api/operator/captures', unrelated.input)).value).toEqual(unrelated.receipt);
    expect((await s.call('/api/operator/captures/' + unrelated.receipt.captureId)).status).toBe(200);
  });
  it('recovers only the exact owned accepted study-start request and clears withdrawal and expiry', async () => {
    const s = await server(); const requestId = randomUUID(); const path = '/api/study-start-requests/' + requestId;
    expect((await s.call(path)).status).toBe(401); await s.establish(); await s.unlock();
    expect((await s.call(path, undefined, { Host: 'localhost:4317' })).status).toBe(403);
    expect((await s.call('/api/study-start-requests/invalid')).status).toBe(404); expect((await s.call(path)).value).toEqual({ status: 'unknown' });
    const input = { requestId, fixtureScheduleId: 'synthetic_short_v1' }; const created = await s.call('/api/operator/study-rehearsals', input);
    expect((await s.call(path)).value).toEqual({ status: 'accepted', studySessionId: created.value.studySessionId });
    expect((await s.call('/api/operator/study-rehearsals', input)).value).toEqual(created.value);
    const foreign = s.app.services.sessions.establish(); expect((await s.call(path, undefined, { Cookie: 'tm_session=' + foreign.token })).value).toEqual({ status: 'unknown' });
    const consent = { requestId: randomUUID(), withdrawalCode: (await s.call('/api/study-sessions/' + created.value.studySessionId)).value.withdrawalCode, expectedRecoveryOwnerId: (await s.establish()).value.recoveryOwnerId };
    await s.call('/api/study-withdrawals', consent); expect((await s.call(path)).value).toEqual({ status: 'unknown' });
    expect((await s.call('/api/study-start-requests/' + consent.requestId)).value).toEqual({ status: 'unknown' });
    const secondId = randomUUID(); expect((await s.call('/api/operator/study-rehearsals', { ...input, requestId: secondId })).status).toBe(201);
    const owner = s.app.services.sessions.lookup(s.cookie().split('tm_session=')[1].split(';')[0])!;
    s.advance(86400001); owner.createdAt += 86400001; expect((await s.call('/api/study-start-requests/' + secondId)).value).toEqual({ status: 'unknown' });
  });
  it('[A03] development module aliases cannot serve hidden server or source-pack files', async () => {
    const s = await server(true);
    for (const route of ['/@id/src/server/targets/meanings.json?import', '/@id/\u0000/src/server/targets/meanings.json', '/src/server/targets/meanings.json', '/src/shared/%2e%2e/server/targets/meanings.json', '/@fs/' + process.cwd() + '/src/server/targets/meanings.json', '/Tiny_Mime_Review_Source_Pack/supplements/scene-meaning-contracts.json']) {
      expect((await s.call(route.replace('\u0000', '__x00__').replaceAll(' ', '%20'))).status, route).toBe(404);
    }
    expect((await s.call('/src/client/main.tsx')).status).toBe(200);
    expect((await s.call('/node_modules/vite/dist/client/env.mjs')).status).toBe(200);
  });
  it('rejects Host, Origin, cross-site and missing cookies before resource diagnostics', async () => {
    const s = await server(); const id = randomUUID();
    expect((await s.call('/api/rounds/' + id)).status).toBe(401);
    expect((await s.call('/api/session', {}, { Host: 'localhost:4317' })).status).toBe(403);
    expect((await s.call('/api/session', {}, { Origin: 'https://example.invalid' })).status).toBe(403);
    expect((await s.call('/api/session', {}, { Origin: '' })).status).toBe(403);
    expect((await s.call('/api/session', {}, { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
    expect((await s.call('/api/session', {}, { 'Content-Type': 'text/plain' })).status).toBe(403);
    expect((await s.call('/api/session', {}, { 'Content-Encoding': 'gzip' })).status).toBe(403);
    await s.establish(); expect((await s.call('/api/rounds/' + id)).status).toBe(404);
  });
  it('rejects duplicate, malformed and unknown fields without accepting a round', async () => {
    const s = await server(); await s.establish();
    expect((await s.call('/api/rounds', undefined, {}, '{"requestId":"' + randomUUID() + '","mode":"private_play","mode":"study"}')).status).toBe(400);
    expect((await s.call('/api/rounds', { ...createBody(), target: 'leak' })).status).toBe(400);
    expect((await s.call('/api/rounds', undefined, {}, '{')).status).toBe(400);
    expect((await s.call('/api/session', {})).value.activeRoundId).toBeNull();
    expect(matchesContract('CreateRound', createBody())).toBe(true);
  });
  it('delivers closed snapshots and NFC idempotency across endpoints, with zero live calls', async () => {
    const s = await server(); await s.establish(); const body = createBody(); const first = await s.call('/api/rounds', body);
    expect(first.status).toBe(201); expect(matchesContract('PublicRound', first.value)).toBe(true);
    expect(JSON.stringify(first.value)).not.toMatch(/TM0|target|condition|meaningId|runtime_informed|model/);
    expect((await s.call('/api/rounds', body)).status).toBe(200);
    const id = first.value.roundId; const requestId = randomUUID(); const guess = { requestId, revision: 0, attempt: 1, guess: '  cafe\u0301  ' };
    const accepted = await s.call(`/api/rounds/${id}/guesses`, guess);
    expect(accepted.status).toBe(202); expect(accepted.value.guesses[0].text).toBe('café'); expect(accepted.value.state).toBe('generating_act2');
    await new Promise(resolve => setTimeout(resolve, 10));
    const ready = await s.call(`/api/rounds/${id}`); expect(ready.value.state).toBe('awaiting_guess2'); expect(ready.value.acts[1].source).toBe('mock_fixture');
    const replay = await s.call(`/api/rounds/${id}/guesses`, { ...guess, guess: 'café' }); expect(replay.value.state).toBe('awaiting_guess2');
    expect((await s.call(`/api/rounds/${id}/skip`, { requestId, revision: ready.value.revision })).status).toBe(409);
    const final = await s.call(`/api/rounds/${id}/guesses`, { requestId: randomUUID(), revision: ready.value.revision, attempt: 2, guess: 'They are taking turns.' });
    expect(final.value.state).toBe('revealed'); expect(typeof final.value.reveal.target).toBe('string'); expect(final.value.guesses).toHaveLength(2); expect(matchesContract('PublicRound', final.value)).toBe(true);
    expect(s.app.services.ledger.status().reservedUnknownMicroUsd).toBe(0);
  });
  it('keeps source tools behind a separate capability and recovers after lock without resetting rounds', async () => {
    const s = await server(); await s.establish(); const round = await s.call('/api/rounds', createBody());
    expect((await s.call('/api/operator/scenes')).status).toBe(403); await s.unlock();
    expect((await s.call('/api/operator/scenes')).value.records).toHaveLength(12);
    expect((await s.call('/api/operator/lock', {})).status).toBe(200);
    expect((await s.call('/api/operator/scenes')).status).toBe(403);
    expect((await s.call(`/api/rounds/${round.value.roundId}`)).status).toBe(200);
    s.advance(60001); s.app.services.operator.regenerate(); await s.unlock();
    expect((await s.call('/api/operator/status')).status).toBe(200);
  });
  it('disabled live and noncontact deferred scenes cannot create rounds or budgets', async () => {
    const s = await server(); await s.establish();
    expect((await s.call('/api/rounds', { ...createBody(), executionMode: 'live' })).status).toBe(503);
    await s.unlock(); expect((await s.call('/api/operator/scenes/TM07/score')).status).toBe(404);
    expect((await s.call('/api/operator/creator-rounds', { requestId: randomUUID(), sceneId: 'TM07', creatorOwned: true, executionMode: 'fixture' })).status).toBe(400);
    expect(s.app.services.ledger.status()).toEqual({ locked: false, reason: null, reservedUnknownMicroUsd: 0 });
  });
  it('a study rehearsal is separate RAM, and participant lock retains its owned plan', async () => {
    const s = await server(); await s.establish(); await s.unlock();
    const created = await s.call('/api/operator/study-rehearsals', { requestId: randomUUID(), fixtureScheduleId: 'synthetic_short_v1' });
    expect(created.status).toBe(201); expect(created.value.executionMode).toBe('fixture');
    await s.call('/api/operator/lock', {});
    const plan = await s.call('/api/study-sessions/' + created.value.studySessionId); expect(plan.status).toBe(200); expect(plan.value.phase).toBe('practice');
    expect(JSON.stringify(plan.value)).not.toMatch(/TM0|condition|allocation|profile|studyRunId/);
    const r = await s.call('/api/rounds', { requestId: randomUUID(), mode: 'study', executionMode: 'fixture', studySessionId: created.value.studySessionId }); expect(r.status).toBe(201); expect(r.value.phase).toBe('practice');
    expect((s.app.services.realStudy.db.prepare('SELECT count(*) n FROM study_sessions').get() as any).n).toBe(0);
    expect((s.app.services.realStudy.db.prepare('SELECT count(*) n FROM fixture_sessions').get() as any).n).toBe(0);
  });
  it('finishes only an owned terminal study with strict input and session-wide retry binding', async () => {
    const s = await server(); const missing = `/api/study-sessions/${randomUUID()}/finish`; const finish = { requestId: randomUUID() };
    expect((await s.call(missing, finish)).status).toBe(401); await s.establish(); await s.unlock();
    const rehearsal = { requestId: randomUUID(), fixtureScheduleId: 'synthetic_short_v1' };
    const created = await s.call('/api/operator/study-rehearsals', rehearsal); const id = created.value.studySessionId; const path = `/api/study-sessions/${id}/finish`;
    const foreign = s.app.services.sessions.establish();
    expect((await s.call(path, finish, { Host: 'localhost:4317' })).status).toBe(403); expect((await s.call(path, finish, { Origin: 'https://example.invalid' })).status).toBe(403);
    expect((await s.call(path, finish, { Cookie: '' })).status).toBe(401); expect((await s.call(path, {}, { Cookie: `tm_session=${foreign.token}` })).status).toBe(404); expect((await s.call(missing, {})).status).toBe(404);
    for (const body of [{}, [], { ...finish, extra: true }, { requestId: finish.requestId.toUpperCase() }, { requestId: '00000000-0000-1000-8000-000000000000' }]) expect((await s.call(path, body)).status).toBe(400);
    expect((await s.call(path, undefined, {}, `{"requestId":"${finish.requestId}","requestId":"${finish.requestId}"}`)).status).toBe(400);
    expect((await s.call(path, undefined, {}, '{' + ' '.repeat(4097))).status).toBe(400);
    expect((await s.call(path, finish)).status).toBe(503);
    const service = s.app.services.fixtureStudy; const owner = s.app.services.sessions.lookup(s.cookie().split('tm_session=')[1].split(';')[0])!.sessionId;
    for (let i = 0; i < 3; i++) { const plan = service.nextRound(owner, id), round = randomUUID(); service.attachRound(owner, id, round, plan); expect((await s.call(path, finish)).value.error.code).toBe('ACTIVE_ROUND'); service.recordRound(round, { terminal: true }); service.finishRound(round); }
    expect((await s.call(`/api/study-sessions/${id}`)).value.feedbackSaved).toBe(false); expect((await s.call(path, finish)).status).toBe(503);
    const feedback = { requestId: randomUUID(), wouldPlayAgain: true, optionalExtraAccepted: true };
    expect((await s.call(`/api/study-sessions/${id}/feedback`, feedback)).status).toBe(200); expect((await s.call(`/api/study-sessions/${id}`)).value.feedbackSaved).toBe(true);
    expect((await s.call(path, { requestId: rehearsal.requestId })).status).toBe(409); expect((await s.call(path, { requestId: feedback.requestId })).status).toBe(409);
    expect((await s.call(path, finish)).value).toEqual({ saved: true }); const changes = service.db.prepare('SELECT total_changes() n').get();
    expect((await s.call(path, finish)).value).toEqual({ saved: true }); expect((await s.call(path, { requestId: randomUUID() })).value).toEqual({ saved: true }); expect(service.db.prepare('SELECT total_changes() n').get()).toEqual(changes);
    expect((await s.call(`/api/study-sessions/${id}/feedback`, { ...feedback, requestId: finish.requestId })).status).toBe(409);
    expect((await s.call('/api/rounds', { requestId: finish.requestId, mode: 'study', executionMode: 'fixture', studySessionId: id })).status).toBe(409);
    expect((await s.call('/api/rounds', { requestId: randomUUID(), mode: 'study', executionMode: 'fixture', studySessionId: id })).status).toBe(403);
    expect((await s.call(`/api/study-sessions/${id}`)).value).toMatchObject({ phase: 'complete', nextRoundAvailable: false, feedbackSaved: true });
    service.db.prepare('DELETE FROM fixture_sessions WHERE id=?').run(id); expect((await s.call(path, finish)).value.error.code).toBe('EXPIRED');
  });
  it('reads only round feedback save status after ownership checks without renewing expiry', async () => {
    const s = await server(); const unknown = `/api/rounds/${randomUUID()}/feedback`;
    expect((await s.call(unknown)).status).toBe(401); await s.establish(); expect((await s.call(unknown)).status).toBe(404);
    const created = await s.call('/api/rounds', createBody()), id = created.value.roundId, path = `/api/rounds/${id}/feedback`;
    const foreign = s.app.services.sessions.establish(); expect((await s.call(path, undefined, { Cookie: `tm_session=${foreign.token}` })).status).toBe(404);
    expect((await s.call(path)).value).toEqual({ saved: false, secondActCompletionRecorded: false }); expect((await s.call(`/api/rounds/${id}`)).value).toEqual(created.value);
    await s.call(`/api/rounds/${id}/guesses`, { requestId: randomUUID(), revision: 0, attempt: 1, guess: 'A synthetic first answer' }); await new Promise(resolve => setTimeout(resolve, 10));
    const ready = await s.call(`/api/rounds/${id}`); const final = await s.call(`/api/rounds/${id}/guesses`, { requestId: randomUUID(), revision: ready.value.revision, attempt: 2, guess: 'A synthetic second answer' });
    expect((await s.call(path)).value).toEqual({ saved: false, secondActCompletionRecorded: false }); const feedback = { requestId: randomUUID(), enjoyment: 3, helpfulness: null };
    expect((await s.call(path, feedback)).value).toEqual({ saved: true }); s.advance(1000); expect((await s.call(path)).value).toEqual({ saved: true, secondActCompletionRecorded: false }); expect((await s.call(`/api/rounds/${id}`)).value).toEqual(final.value);
    expect((await s.call(path, { ...feedback, requestId: randomUUID(), enjoyment: 4 })).status).toBe(400);
    s.advance(1800000); expect((await s.call(path)).value.error.code).toBe('EXPIRED');
  });
  it('[X02] failed periodic purge blocks dependent study collection and exports', async () => {
    const s = await server(); await s.establish(); await s.unlock();
    const created = await s.call('/api/operator/study-rehearsals', { requestId: randomUUID(), fixtureScheduleId: 'synthetic_short_v1' });
    const r = await s.call('/api/rounds', { requestId: randomUUID(), mode: 'study', executionMode: 'fixture', studySessionId: created.value.studySessionId });
    s.app.services.fixtureStudy.sweep = () => { throw new Error('PURGE_FAILED'); }; expect(s.app.services.maintain()).toBe(false);
    expect((await s.call(`/api/rounds/${r.value.roundId}/guesses`, { requestId: randomUUID(), revision: 0, attempt: 1, guess: 'A fixture answer' })).status).toBe(503);
    expect((await s.call('/api/operator/study-rehearsals', { requestId: randomUUID(), fixtureScheduleId: 'synthetic_short_v1' })).status).toBe(503);
    expect((await s.call('/api/operator/exports', { requestId: randomUUID(), studyRunId: randomUUID(), format: 'analyst_csv' })).status).toBe(503);
  });
  it('[A04] operator capability expiry and launch limits remain independent of owner rounds', async () => {
    const s = await server(); await s.establish(); await s.unlock(); s.advance(900000);
    const r = await s.call('/api/rounds', createBody()); s.advance(900001);
    expect((await s.call('/api/operator/status')).status).toBe(401); expect((await s.call('/api/operator/scenes')).status).toBe(403); expect((await s.call('/api/rounds/' + r.value.roundId)).status).toBe(200);
    s.app.services.operator.regenerate(); for (let i = 0; i < 5; i++) expect((await s.call('/api/operator/bootstrap', { launchSecret: 'X'.repeat(43) })).status).toBe(401);
    expect((await s.call('/api/operator/bootstrap', { launchSecret: 'X'.repeat(43) })).status).toBe(401); expect(s.app.services.operator.regenerate()).toBe(false);
    s.advance(60001); expect(s.app.services.operator.regenerate()).toBe(true); await s.unlock();
  });
  it('[E03] event body bounds reject before accepting any event', async () => {
    const s = await server(); await s.establish(); const r = await s.call('/api/rounds', createBody());
    expect((await s.call(`/api/rounds/${r.value.roundId}/events`, undefined, {}, '{' + ' '.repeat(16385))).status).toBe(400);
    expect(s.app.services.events.observations(r.value.roundId).playbackObservations).toEqual([]);
  });
  it('[X03] withdrawal cancels pending rounds and destroys export caches', async () => {
    const s = await server(); await s.establish(); await s.unlock(); const study = await s.call('/api/operator/study-rehearsals', { requestId: randomUUID(), fixtureScheduleId: 'synthetic_short_v1' });
    const progress = await s.call('/api/study-sessions/' + study.value.studySessionId);
    const r = await s.call('/api/rounds', { requestId: randomUUID(), mode: 'study', executionMode: 'fixture', studySessionId: study.value.studySessionId });
    await s.call(`/api/rounds/${r.value.roundId}/guesses`, { requestId: randomUUID(), revision: 0, attempt: 1, guess: 'A synthetic pending answer' });
    const run = s.app.services.fixtureStudy.listRuns()[0]!.studyRunId; const exported = await s.call('/api/operator/exports', { requestId: randomUUID(), studyRunId: run, format: 'raw_responses_json' }); expect(exported.status).toBe(201);
    expect((await s.call('/api/study-withdrawals', { requestId: randomUUID(), withdrawalCode: progress.value.withdrawalCode, expectedRecoveryOwnerId: (await s.establish()).value.recoveryOwnerId })).status).toBe(200);
    expect((await s.call('/api/rounds/' + r.value.roundId)).status).toBe(404); expect((await s.call('/api/operator/exports/' + exported.value.exportId)).status).toBe(404);
    await new Promise(resolve => setImmediate(resolve)); expect((s.app.services.rounds as any).jobs.size).toBe(0);
  });
  it('[D08 X01] restart has no private content or participant resurrection', async () => {
    const dir = join(homedir(), 'Library', 'Application Support', 'TinyMime-verification-' + randomUUID()); mkdirSync(dir, { mode: 0o700 });
    try {
      const s = await server(false, dir); await s.establish(); const r = await s.call('/api/rounds', createBody()); const sentinel = 'PRIVATE_ONLY_' + randomUUID();
      await s.call(`/api/rounds/${r.value.roundId}/guesses`, { requestId: randomUUID(), revision: 0, attempt: 1, guess: sentinel }); await new Promise(resolve => setTimeout(resolve, 10));
      const cookie = s.cookie(); s.advance(1800000); expect((await s.call('/api/rounds/' + r.value.roundId)).status).toBe(410);
      const technical = (s.app.services.rounds as any).rounds.get(r.value.roundId); expect(technical.scene).toBeNull(); expect(technical.public.guesses).toEqual([]); expect(technical.public.acts).toEqual([]);
      expect(statSync(dir).mode & 0o777).toBe(0o700); await s.stop();
      for (const file of readdirSync(dir)) { const bytes = readFileSync(join(dir, file)); expect(bytes.includes(Buffer.from(sentinel))).toBe(false); expect(bytes.includes(Buffer.from('Awkward passing'))).toBe(false); expect(statSync(join(dir, file)).mode & 0o777).toBe(0o600); }
      const restarted = await server(false, dir); expect((await restarted.call('/api/rounds/' + r.value.roundId, undefined, { Cookie: cookie })).status).toBe(401);
      await restarted.establish(); expect((await restarted.call('/api/rounds/' + r.value.roundId)).status).toBe(404); expect((restarted.app.services.rounds as any).rounds.size).toBe(0); await restarted.stop();
    } finally { rmSync(dir, { recursive: true }); }
  });
});
