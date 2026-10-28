import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { createApplication, ORIGIN } from '../../src/server/http.js';
import { getScene } from '../../src/server/operator/sceneBank.js';

const stops: (() => Promise<void>)[] = [];
afterEach(async () => { for (const stop of stops.splice(0)) await stop(); });
async function setup() {
  let secret = '', cookie = '';
  const app = await createApplication({ memory: true, onLaunchSecret: value => { secret = value; } });
  const listener = http.createServer(app.handler);
  try { await new Promise<void>((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); }); }
  catch (error) { await app.close(); throw error; }
  stops.push(async () => { const closed = new Promise<void>(resolve => listener.close(() => resolve())); listener.closeAllConnections(); await closed; await app.close(); });
  const port = (listener.address() as { port: number }).port;
  async function call(route: string, body?: unknown, raw?: string, headers: Record<string, string> = {}) {
    const payload = raw ?? (body === undefined ? undefined : JSON.stringify(body));
    const response = await new Promise<{ status: number; headers: http.IncomingHttpHeaders; bytes: Buffer }>((resolve, reject) => {
      const request = http.request({ host: '127.0.0.1', port, path: route, method: payload === undefined ? 'GET' : 'POST', headers: { Host: '127.0.0.1:4317', Origin: ORIGIN, 'Content-Type': 'application/json', Cookie: cookie, ...headers } }, result => {
        const chunks: Buffer[] = []; result.on('data', chunk => chunks.push(chunk)); result.on('end', () => resolve({ status: result.statusCode!, headers: result.headers, bytes: Buffer.concat(chunks) }));
      }); request.on('error', reject); request.setTimeout(5000, () => request.destroy(new Error('TEST_REQUEST_TIMEOUT'))); request.end(payload);
    });
    for (const set of response.headers['set-cookie'] ?? []) { const next = set.split(';')[0], name = next.split('=')[0]; cookie = cookie.split('; ').filter(part => !part.startsWith(name + '=')).concat(next).filter(Boolean).join('; '); }
    return { ...response, value: response.headers['content-type']?.includes('application/json') ? JSON.parse(response.bytes.toString('utf8')) : null };
  }
  return { app, call, establish: () => call('/api/session', {}), unlock: () => call('/api/operator/bootstrap', { launchSecret: secret }) };
}
const input = () => ({ requestId: randomUUID(), sceneId: 'TM01', title: 'A private candidate', score: getScene('TM01')!.score, parentCandidateId: null, notes: [] });

it('authenticates then authorizes every workspace lookup and mutation before parsing', async () => {
  const s = await setup();
  for (const route of ['/api/operator/candidates', '/api/operator/showcases', `/api/operator/candidates/${randomUUID()}/inspection`]) expect((await s.call(route)).status).toBe(401);
  expect((await s.call('/api/operator/candidates', undefined, '{bad')).status).toBe(401);
  await s.establish();
  expect((await s.call('/api/operator/candidates', undefined, '{bad')).status).toBe(403);
  expect((await s.call('/api/operator/showcases')).status).toBe(403);
  await s.unlock(); expect((await s.call('/api/operator/candidates')).value).toEqual({ candidates: [] });
  await s.call('/api/operator/lock', {});
  expect((await s.call('/api/operator/candidates')).status).toBe(403);
  expect((await s.call('/api/operator/showcases')).status).toBe(403);
});

it('enforces strict bounds, continuous validation, request identity and protected downloads', async () => {
  const s = await setup(); await s.establish(); await s.unlock(); const body = input();
  const created = await s.call('/api/operator/candidates', body); expect(created.status).toBe(201);
  const candidate = created.value.candidate;
  expect((await s.call('/api/operator/candidates', body)).status).toBe(200);
  expect((await s.call('/api/operator/candidates', { ...body, title: 'Changed' })).status).toBe(409);
  expect((await s.call('/api/rounds', { requestId: body.requestId, mode: 'private_play', executionMode: 'fixture', studySessionId: null })).status).toBe(409);
  const collision = input(); collision.score.actors[1].keyframes[0].x = collision.score.actors[0].keyframes[0].x;
  for (const invalid of [{ ...input(), unknown: true }, { ...input(), notes: [{ atMs: 99999, text: 'Bad time' }] }, collision, { ...input(), title: 'x'.repeat(100000) }]) expect((await s.call('/api/operator/candidates', invalid)).status).toBe(400);
  expect((await s.call('/api/operator/candidates', undefined, '{"requestId":"' + randomUUID() + '","sceneId":"TM01","sceneId":"TM09"}')).status).toBe(400);
  const summary = (await s.call('/api/operator/candidates')).value.candidates;
  expect(summary).toHaveLength(1); expect(Object.keys(summary[0]).sort()).toEqual(['candidateId', 'createdAt', 'noteCount', 'parentCandidateId', 'sceneId', 'scoreHash', 'title']);
  expect((await s.call(`/api/operator/candidates/${candidate.candidateId}`)).value.candidate).toEqual(candidate);
  expect((await s.call('/api/operator/candidates/not-a-uuid')).status).toBe(404);
  const packet = await s.call(`/api/operator/candidates/${candidate.candidateId}/inspection`);
  expect(packet.status).toBe(200); expect(packet.headers['content-type']).toBe('application/zip');
  const files = unzipSync(packet.bytes); expect(strFromU8(files['inspection.html'])).not.toContain(body.title);
  expect(JSON.parse(strFromU8(files['score.json']))).toEqual(body.score);
  expect((await s.call(`/api/operator/candidates/${candidate.candidateId}/inspection`, undefined, undefined, { Origin: 'https://example.invalid' })).status).toBe(403);
  await s.call('/api/operator/lock', {}); expect((await s.call(`/api/operator/candidates/${candidate.candidateId}/inspection`)).status).toBe(403);
  expect(s.app.services.ledger.status()).toEqual({ locked: false, reason: null, reservedUnknownMicroUsd: 0 });
});

it('serves only authored directing examples and never substitutes them into fixture rounds', async () => {
  const s = await setup(); await s.establish(); await s.unlock();
  const result = await s.call('/api/operator/showcases'); expect(result.status).toBe(200); expect(result.value.examples).toHaveLength(3);
  result.value.examples.forEach((example: any) => { expect(example.source).toBe('authored_fixture'); expect(example.humanReview).toBe('not_run'); expect(example.left.scoreHash).not.toBe(example.right.scoreHash); });
  const round = await s.call('/api/rounds', { requestId: randomUUID(), mode: 'private_play', executionMode: 'fixture', studySessionId: null });
  expect(round.status).toBe(201); expect(round.value.acts[0].source).toBe('authored_fixture');
  expect(JSON.stringify(round.value)).not.toContain('exampleGuess');
});
