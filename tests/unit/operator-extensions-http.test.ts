import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { createApplication, ORIGIN } from '../../src/server/http.js';
import { getScene } from '../../src/server/operator/sceneBank.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
async function app() {
  let secret = ''; let cookie = ''; let offset = 0;
  const application = await createApplication({ memory: true, fixtureDelayMs: 1, nowWall: () => Date.now() + offset, nowMono: () => performance.now() + offset, onLaunchSecret: value => { secret = value; } });
  const host = http.createServer(application.handler);
  await new Promise<void>(resolve => host.listen(0, '127.0.0.1', resolve));
  const port = (host.address() as {port: number}).port;
  cleanup.push(async () => { await new Promise<void>(resolve => host.close(() => resolve())); await application.close(); });
  async function call(path: string, body?: unknown) {
    const response = await new Promise<{ status: number; headers: http.IncomingHttpHeaders; text: string }>((resolve, reject) => {
      const request = http.request({host: '127.0.0.1', port, path, method: body === undefined ? 'GET' : 'POST', headers: {Host: '127.0.0.1:4317', Origin: ORIGIN, 'Content-Type': 'application/json', Cookie: cookie}}, result => {
        const chunks: Buffer[] = []; result.on('data', chunk => chunks.push(chunk)); result.on('end', () => resolve({status: result.statusCode!, headers: result.headers, text: Buffer.concat(chunks).toString('utf8')}));
      });
      request.on('error', reject); request.end(body === undefined ? undefined : JSON.stringify(body));
    });
    const next = response.headers['set-cookie']?.[0];
    if (next) { const name = next.split('=')[0]; cookie = cookie.split('; ').filter(part => !part.startsWith(name + '=')).concat(next.split(';')[0]).filter(Boolean).join('; '); }
    return {status: response.status, value: JSON.parse(response.text)};
  }
  await call('/api/session', {});
  return {call, application, advance: (ms: number) => { offset += ms; }, unlock: () => call('/api/operator/bootstrap', {launchSecret: secret})};
}
const snapshot = () => ({ requestId: randomUUID(), sceneId: 'TM01', title: 'Synthetic retained version', score: getScene('TM01')!.score, parentCandidateId: null, notes: [{atMs: 1000, text: 'Synthetic private saved note'}] });

it('operator removal frees a saved version without cached save responses revealing or restoring it', async () => {
  const s = await app(); const unknown = randomUUID();
  expect((await s.call('/api/operator/candidates/' + unknown + '/remove', {unexpected: true})).status).toBe(403);
  await s.unlock();
  const input = snapshot(); const saved = await s.call('/api/operator/candidates', input); expect(saved.status).toBe(201);
  const id = saved.value.candidate.candidateId; const remove = {requestId: randomUUID()};
  expect((await s.call('/api/operator/candidates/' + id + '/remove', remove)).value).toEqual({removed: true});
  expect((await s.call('/api/operator/candidates/' + id + '/remove', remove)).value).toEqual({removed: true});
  expect((await s.call('/api/operator/candidates/' + id)).status).toBe(404);
  const replay = await s.call('/api/operator/candidates', input);
  expect(replay.status).toBe(404); expect(replay.value.error.code).toBe('NOT_FOUND');
  expect(JSON.stringify(replay.value)).not.toContain('Synthetic private saved note');
  expect((await s.call('/api/operator/candidates', {...input, title: 'Changed retry'})).status).toBe(409);
  expect((await s.call('/api/operator/candidates', snapshot())).status).toBe(201);
});

it('operator removal validates closed input, protects saved children and binds retry identities', async () => {
  const s = await app(); await s.unlock();
  const parent = (await s.call('/api/operator/candidates', snapshot())).value.candidate;
  const child = (await s.call('/api/operator/candidates', {...snapshot(), parentCandidateId: parent.candidateId})).value.candidate;
  const path = '/api/operator/candidates/' + parent.candidateId + '/remove';
  expect((await s.call(path, {requestId: randomUUID(), extra: true})).status).toBe(400);
  expect((await s.call(path, {requestId: randomUUID()})).status).toBe(429);
  const remove = {requestId: randomUUID()};
  expect((await s.call('/api/operator/candidates/' + child.candidateId + '/remove', remove)).status).toBe(200);
  expect((await s.call(path, remove)).status).toBe(409);
  expect((await s.call('/api/operator/candidates/' + parent.candidateId)).status).toBe(200);
  expect((await s.call(path, {requestId: randomUUID()})).value).toEqual({removed: true});
});

async function completedTrace(s: Awaited<ReturnType<typeof app>>) {
  await s.unlock();
  const created = await s.call('/api/operator/creator-rounds', {requestId: randomUUID(), sceneId: 'TM01', creatorOwned: true, executionMode: 'fixture'});
  const id = created.value.roundId; const firstRequest = randomUUID(), finalRequest = randomUUID();
  await s.call('/api/rounds/' + id + '/guesses', {requestId: firstRequest, revision: 0, attempt: 1, guess: 'Synthetic first trace answer'});
  await expect.poll(async () => (await s.call('/api/rounds/' + id)).value.state).toBe('awaiting_guess2');
  const ready = (await s.call('/api/rounds/' + id)).value;
  const ended = (await s.call('/api/rounds/' + id + '/guesses', {requestId: finalRequest, revision: ready.revision, attempt: 2, guess: 'Synthetic final trace answer'})).value;
  const a = ended.acts[0], b = ended.acts[1], d = a.score.durationMs;
  const first = {seq: 0, atMs: 0, reason: 'initial', phase: 'awaiting_guess1', waiting: false, hidden: false, attempt: 1, scoreHash: a.scoreHash, positionMs: 0, playing: false, mode: 'motion', replay: false, submissionRequestId: null};
  const states: any[] = [first];
  const add = (atMs: number, next: Record<string, unknown>) => states.push({...states.at(-1), ...next, seq: states.length, atMs});
  add(100, {reason: 'play', playing: true});
  add(d + 100, {reason: 'complete', playing: false, positionMs: d});
  add(d + 200, {reason: 'submission', phase: 'generating_act2', waiting: true, submissionRequestId: firstRequest});
  add(d + 700, {reason: 'phase', phase: 'awaiting_guess2', waiting: false});
  add(d + 800, {reason: 'play', attempt: 2, scoreHash: b.scoreHash, positionMs: 0, playing: true});
  add(d + 800 + b.score.durationMs, {reason: 'complete', playing: false, positionMs: b.score.durationMs});
  add(d + 900 + b.score.durationMs, {reason: 'submission', submissionRequestId: finalRequest});
  add(d + 1000 + b.score.durationMs, {reason: 'reveal', phase: 'revealed'});
  return {id, trace: {requestId: randomUUID(), documentId: randomUUID(), states}};
}

it('admits only an owned creator trace and rejects a final marker unrelated to the accepted guess', async () => {
  const s = await app(); const {id, trace} = await completedTrace(s);
  const path = '/api/operator/creator-rounds/' + id + '/capture-trace';
  const changed = structuredClone(trace);
  changed.states.find(state => state.reason === 'submission' && state.phase === 'awaiting_guess2').submissionRequestId = randomUUID();
  expect((await s.call(path, changed)).status).toBe(400);
  expect((await s.call(path, trace)).value).toEqual({accepted: true});
  expect((await s.call(path, trace)).value).toEqual({accepted: true});
  expect((await s.call(path, {...trace, documentId: randomUUID()})).status).toBe(409);
  expect((await s.call(path, {...trace, extra: true})).status).toBe(400);
  expect((await s.call('/api/operator/creator-rounds/' + randomUUID() + '/capture-trace', trace)).status).toBe(404);
});

it('disposes creator traces when their source round expires', async () => {
  const s = await app(); const {id, trace} = await completedTrace(s);
  expect((await s.call('/api/operator/creator-rounds/' + id + '/capture-trace', trace)).status).toBe(200);
  expect((s.application.services as any).captureTraces.read(id)).not.toBeNull();
  s.advance(1800001); s.application.services.maintain();
  expect((s.application.services as any).captureTraces.read(id)).toBeNull();
});
