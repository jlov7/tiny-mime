import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
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
  async function call(route: string, body?: unknown, raw?: string | Buffer, headers: Record<string, string> = {}) {
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

const previewPath = '/api/operator/workspace/restore-preview', restorePath = '/api/operator/workspace/restore', backupPath = '/api/operator/workspace/backup';
it('authenticates and authorizes private backup and restore before body parsing', async () => {
  const s = await setup();
  for (const route of [backupPath, previewPath, restorePath]) {
    const result = route === backupPath ? await s.call(route) : await s.call(route, undefined, '{bad');
    expect(result.status).toBe(401); expect(result.value.error.requestId).toMatch(/^[a-f0-9-]{36}$/);
  }
  await s.establish();
  for (const route of [backupPath, previewPath, restorePath]) expect((route === backupPath ? await s.call(route) : await s.call(route, undefined, '{bad')).status).toBe(403);
  await s.unlock();
  expect((await s.call(previewPath, undefined, '{bad')).status).toBe(400);
  expect((await s.call(restorePath, undefined, '{bad')).status).toBe(400);
  const snapshot = await s.call(backupPath); expect(snapshot.status).toBe(200); expect(snapshot.headers['content-disposition']).toContain('attachment;'); expect(snapshot.headers['cache-control']).toBe('no-store');
  await s.call('/api/operator/lock', {}); expect((await s.call(backupPath)).status).toBe(403);
});
it('previews an additive merge, preserves existing records, and retries an uncertain commit without duplicate inserts', async () => {
  const source = await setup(), target = await setup(); await source.establish(); await source.unlock(); await target.establish(); await target.unlock();
  const saved = (await source.call('/api/operator/candidates', input())).value.candidate;
  const existing = (await target.call('/api/operator/candidates', input())).value.candidate;
  const artifact = (await source.call(backupPath)).value;
  expect(Object.keys(artifact).sort()).toEqual(['content', 'contentHash', 'format', 'version']); expect(JSON.stringify(artifact)).not.toMatch(/meaning|targetRubric|providerConfig|launchSecret|participant/);
  const preview = await target.call(previewPath, artifact); expect(preview.status).toBe(200); expect(preview.value.additions).toEqual({ candidates: 1, tombstones: 0, removals: 0 });
  expect(target.app.services.workspace.list()).toHaveLength(1);
  const body = { snapshot: artifact, expectedWorkspaceHash: preview.value.workspaceHash };
  const restored = await target.call(restorePath, body); expect(restored.status).toBe(200); expect(restored.value.status).toBe('restored');
  expect((await target.call(restorePath, body)).value.status).toBe('already_present'); expect(target.app.services.workspace.list()).toHaveLength(2);
  expect(target.app.services.workspace.read(saved.candidateId)).toEqual(saved); expect(target.app.services.workspace.read(existing.candidateId)).toEqual(existing);
  expect(target.app.services.ledger.status()).toEqual({ locked: false, reason: null, reservedUnknownMicroUsd: 0 });
});
it('rejects duplicate keys, unknown fields, SQLite bytes, stale previews and Host/Origin violations with safe errors', async () => {
  const source = await setup(), target = await setup(); await source.establish(); await source.unlock(); await target.establish(); await target.unlock();
  source.app.services.workspace.save(input()); const snapshot = source.app.services.workspace.backup(), preview = (await target.call(previewPath, snapshot)).value;
  for (const raw of ['SQLite format 3', JSON.stringify(snapshot).replace('"version":1', '"version":1,"version":1'), JSON.stringify({ ...snapshot, extra: 'PRIVATE_SENTINEL' }), JSON.stringify(snapshot).replace('"version":1', '"version":1e400')]) {
    const result = await target.call(previewPath, undefined, raw); expect(result.status).toBe(400); expect(result.value.error.code).toBe('INVALID_INPUT'); expect(result.value.error.requestId).toMatch(/^[a-f0-9-]{36}$/); expect(JSON.stringify(result.value)).not.toContain('PRIVATE_SENTINEL');
  }
  target.app.services.workspace.save(input());
  expect((await target.call(restorePath, { snapshot, expectedWorkspaceHash: preview.workspaceHash })).value.error.code).toBe('STALE'); expect(target.app.services.workspace.list()).toHaveLength(1);
  expect((await target.call(previewPath, snapshot, undefined, { Origin: 'https://example.invalid' })).status).toBe(403);
  expect((await target.call(backupPath, undefined, undefined, { Host: 'localhost:4317' })).status).toBe(403);
});
it('rechecks operator and session authority after reading a delayed restore body', async () => {
  for (const revoke of ['operator', 'session']) {
    const s = await setup(); await s.establish(); const unlocked = await s.unlock(); expect(unlocked.status).toBe(200);
    const snapshot = s.app.services.workspace.backup(), session = s.app.services.sessions.establish();
    const { PassThrough, Writable } = await import('node:stream');
    const request = new PassThrough() as any;
    const cookies = ['tm_session=' + session.token, unlocked.headers['set-cookie']![0].split(';')[0]];
    request.url = previewPath; request.method = 'POST'; request.headers = { host: '127.0.0.1:4317', origin: ORIGIN, 'content-type': 'application/json', cookie: cookies.join('; ') }; request.rawHeaders = ['Host', '127.0.0.1:4317', 'Origin', ORIGIN];
    const chunks: Buffer[] = []; let status = 0;
    const response = new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } }) as any;
    response.setHeader = () => {}; response.writeHead = (value: number) => { status = value; }; response.headersSent = false;
    const pending = s.app.handler(request, response);
    request.write('{'); await new Promise(resolve => setImmediate(resolve));
    if (revoke === 'operator') s.app.services.operator.lock(); else session.createdAt = 0;
    request.end(JSON.stringify(snapshot).slice(1)); await pending;
    expect(status).toBe(revoke === 'operator' ? 403 : 401); expect(s.app.services.workspace.backup()).toEqual(snapshot);
  }
});

it.each([previewPath, restorePath])('rejects invalid UTF-8 and oversized upload bytes at %s without changing saved work', async route => {
  const s = await setup(); await s.establish(); await s.unlock(); s.app.services.workspace.save(input()); const before = s.app.services.workspace.backup();
  for (const bytes of [Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x7d]), Buffer.alloc(32 * 1024 * 1024 + 257, 0x20)]) {
    const result = await s.call(route, undefined, bytes); expect(result.status).toBe(400); expect(result.value.error.code).toBe('INVALID_INPUT'); expect(result.value.error.requestId).toMatch(/^[a-f0-9-]{36}$/); expect(Object.keys(result.value.error).sort()).toEqual(['code', 'requestId', 'retryable']); expect(s.app.services.workspace.backup()).toEqual(before);
  }
});
