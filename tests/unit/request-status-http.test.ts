import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApplication, ORIGIN } from '../../src/server/http.js';
import type { InternalRound } from '../../src/server/rounds.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); vi.restoreAllMocks(); });
async function server() {
  let wall = Date.now(); let mono = 0; let cookie = ''; let operatorCookie = ''; let launchSecret = ''; const tasks: (() => void)[] = [];
  const app = await createApplication({ memory: true, nowWall: () => wall, nowMono: () => mono, onLaunchSecret: value => { launchSecret = value; } });
  app.services.rounds.options.schedule = fn => tasks.push(fn);
  const director = vi.spyOn(app.services.rounds.options, 'director');
  const host = http.createServer(app.handler);
  await new Promise<void>(resolve => host.listen(0, '127.0.0.1', resolve));
  cleanup.push(async () => { await new Promise<void>(resolve => host.close(() => resolve())); await app.close(); });
  const port = (host.address() as { port: number }).port;
  async function call(route: string, body?: unknown, headers: Record<string, string> = {}, method = body === undefined ? 'GET' : 'POST') {
    const response = await new Promise<{ status: number; headers: http.IncomingHttpHeaders; value: any }>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: route, method, headers: { Host: '127.0.0.1:4317', Origin: ORIGIN, 'Content-Type': 'application/json', ...(cookie ? { Cookie: operatorCookie ? cookie + '; ' + operatorCookie : cookie } : {}), ...headers } }, res => {
        const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); resolve({ status: res.statusCode!, headers: res.headers, value: text ? JSON.parse(text) : null }); });
      });
      req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
    });
    const next = response.headers['set-cookie']?.[0]; if (next?.startsWith('tm_operator=')) operatorCookie = next.split(';')[0]; else if (next) cookie = next.split(';')[0];
    return response;
  }
  const establish = () => call('/api/session', {});
  const owner = () => app.services.sessions.lookup(cookie.slice('tm_session='.length))!;
  const create = async (requestId = randomUUID()) => (await call('/api/rounds', { requestId, mode: 'private_play', executionMode: 'fixture', studySessionId: null })).value;
  return { app, call, establish, owner, create, tasks, director, unlock: () => call('/api/operator/bootstrap', { launchSecret }), advance(ms: number) { wall += ms; mono += ms; } };
}
const statusPath = (id: string, requestId: string) => `/api/rounds/${id}/requests/${requestId}/status`;

describe('owner-only HTTP mutation acceptance status', () => {
  it.each(['guesses', 'skip', 'abandon'] as const)('returns exactly the %s acceptance bit through active and expired technical ownership', async action => {
    const s = await server(); await s.establish(); const round = await s.create(); const requestId = randomUUID();
    const payload = { requestId, revision: 0, ...(action === 'guesses' ? { attempt: 1, guess: 'private guess text' } : {}) };
    expect((await s.call(`/api/rounds/${round.roundId}/${action}`, payload)).status).toBe(action === 'guesses' ? 202 : 200);
    for (const expired of [false, true]) {
      if (expired) s.advance(1800000);
      const accepted = await s.call(statusPath(round.roundId, requestId));
      expect(accepted.status).toBe(200); expect(accepted.value).toEqual({ accepted: true });
      expect(accepted.headers['cache-control']).toBe('no-store');
      expect((await s.call(statusPath(round.roundId, randomUUID()))).value).toEqual({ accepted: false });
    }
    expect((await s.call(`/api/rounds/${round.roundId}`)).status).toBe(410);
    expect((await s.call(`/api/rounds/${round.roundId}/requests/${requestId}`)).status).toBe(410);
    expect(s.director).not.toHaveBeenCalled();
  });
  it('preserves authentication, Host, Origin, cross-site, method and query controls', async () => {
    const s = await server(); const path = statusPath(randomUUID(), randomUUID());
    expect((await s.call(path)).status).toBe(401);
    expect((await s.call('/api/rounds/bad/requests/bad/status')).status).toBe(401);
    await s.establish(); const round = await s.create(); const owned = statusPath(round.roundId, randomUUID());
    for (const headers of [{ Host: 'localhost:4317' }, { Origin: 'https://example.invalid' }, { 'Sec-Fetch-Site': 'cross-site' }] as Record<string, string>[]) expect((await s.call(owned, undefined, headers)).status).toBe(403);
    expect((await s.call(owned + '?accepted=true')).status).toBe(400);
    expect((await s.call(owned, {}, {}, 'POST')).status).toBe(404);
    expect((await s.call(owned, undefined, {}, 'HEAD')).status).toBe(400);
  });
  it('conceals foreign and unknown rounds, rejects malformed UUIDs and rejects wrong request/round combinations', async () => {
    const s = await server(); await s.establish(); const createId = randomUUID(); const round = await s.create(createId); const requestId = randomUUID();
    await s.call(`/api/rounds/${round.roundId}/skip`, { requestId, revision: 0 });
    const next = await s.create();
    expect((await s.call(statusPath(next.roundId, requestId))).value).toEqual({ accepted: false });
    expect((await s.call(statusPath(round.roundId, createId))).value).toEqual({ accepted: false });
    const foreign = s.app.services.sessions.establish();
    expect((await s.call(statusPath(round.roundId, requestId), undefined, { Cookie: 'tm_session=' + foreign.token })).status).toBe(404);
    expect((await s.call(statusPath(randomUUID(), requestId))).status).toBe(404);
    for (const [id, req] of [[round.roundId.toUpperCase(), requestId], [round.roundId, requestId.toUpperCase()], ['11111111-1111-1111-8111-111111111111', requestId], [round.roundId, '11111111-1111-1111-8111-111111111111'], ['bad', requestId], [round.roundId, 'bad']]) {
      const result = await s.call(statusPath(id, req)); expect(result.status).toBe(404); expect(result.value.error.code).toBe('NOT_FOUND');
    }
  });
  it('keeps rejected guesses unaccepted without touching deadlines, dispatching work or changing request bindings', async () => {
    const s = await server(); await s.establish(); const round = await s.create(); const requestId = randomUUID(); const rejectedId = randomUUID();
    expect((await s.call(`/api/rounds/${round.roundId}/guesses`, { requestId: rejectedId, revision: 99, attempt: 1, guess: 'rejected text' })).status).toBe(409);
    const accepted = await s.call(`/api/rounds/${round.roundId}/guesses`, { requestId, revision: 0, attempt: 1, guess: 'private text' }); expect(accepted.status).toBe(202);
    const internal = s.app.services.rounds.internal(s.owner(), round.roundId) as InternalRound;
    const before = { revision: internal.public.revision, expiresAt: internal.public.expiresAt, expiresMono: internal.expiresMono, deadlineMono: internal.deadlineMono, epoch: internal.epoch };
    s.advance(1000);
    expect((await s.call(statusPath(round.roundId, requestId))).value).toEqual({ accepted: true });
    expect((await s.call(statusPath(round.roundId, rejectedId))).value).toEqual({ accepted: false });
    expect({ revision: internal.public.revision, expiresAt: internal.public.expiresAt, expiresMono: internal.expiresMono, deadlineMono: internal.deadlineMono, epoch: internal.epoch }).toEqual(before);
    expect(s.tasks).toHaveLength(1); expect(s.director).not.toHaveBeenCalled();
    s.advance(1799000); expect((await s.call(statusPath(round.roundId, rejectedId))).value).toEqual({ accepted: false });
    expect((await s.call(statusPath(round.roundId, requestId))).value).toEqual({ accepted: true });
    expect(internal.expiresMono).toBe(before.expiresMono); expect(internal.deadlineMono).toBe(before.deadlineMono);
  });
  it('returns NOT_FOUND at technical retention cutoff before maintenance sweeps the binding', async () => {
    const s = await server(); await s.establish(); const round = await s.create(); const requestId = randomUUID(); const owner = s.owner();
    await s.call(`/api/rounds/${round.roundId}/abandon`, { requestId, revision: 0 }); s.advance(1800000);
    expect((await s.call(statusPath(round.roundId, requestId))).value).toEqual({ accepted: true });
    s.advance(86400000 - 1); owner.createdAt += 86400000;
    expect((await s.call(statusPath(round.roundId, requestId))).value).toEqual({ accepted: true });
    s.advance(1); const result = await s.call(statusPath(round.roundId, requestId));
    expect(result.status).toBe(404); expect(result.value.error.code).toBe('NOT_FOUND');
  });
});

const identityPath=(study:string,id:string,request:string)=>`/api/study-sessions/${study}/rounds/${id}/creation-requests/${request}/status`;
async function studyRound(s:Awaited<ReturnType<typeof server>>,fixtureScheduleId:'synthetic_short_v1'|'synthetic_full_v1'='synthetic_short_v1'){
  const study=(await s.call('/api/operator/study-rehearsals',{requestId:randomUUID(),fixtureScheduleId})).value,requestId=randomUUID();
  const round=(await s.call('/api/rounds',{requestId,mode:'study',executionMode:'fixture',studySessionId:study.studySessionId})).value;
  expect(round).toHaveProperty('roundId');return {study:study.studySessionId,round,requestId};
}
describe('minimal expired Study creation identity receipt',()=>{
  it('proves only the exact owned Study, round and creation request before and after expiry without touching it',async()=>{
    const s=await server();await s.establish();await s.unlock();const a=await studyRound(s),internal=s.app.services.rounds.internal(s.owner(),a.round.roundId) as InternalRound;
    const expires=internal.expiresMono;
    for(const expired of [false,true]){
      if(expired)s.advance(1800000);
      const result=await s.call(identityPath(a.study,a.round.roundId,a.requestId));expect(result.status).toBe(200);expect(result.value).toEqual({accepted:true});expect(result.headers['cache-control']).toBe('no-store');
      expect((await s.call(identityPath(a.study,a.round.roundId,randomUUID()))).value).toEqual({accepted:false});expect(internal.expiresMono).toBe(expires);expect(s.director).not.toHaveBeenCalled();expect(s.tasks).toHaveLength(0);
    }
    expect((await s.call('/api/round-requests/'+a.requestId)).status).toBe(410);expect((await s.call('/api/rounds/'+a.round.roundId)).status).toBe(410);
  });
  it('refuses same-owner cross-Study and private round mixtures, wrong creation or mutation bindings, and foreign access',async()=>{
    const s=await server();await s.establish();await s.unlock();const a=await studyRound(s),skipId=randomUUID();await s.call('/api/rounds/'+a.round.roundId+'/skip',{requestId:skipId,revision:0});for(let i=0;i<2;i++){const r=(await s.call('/api/rounds',{requestId:randomUUID(),mode:'study',executionMode:'fixture',studySessionId:a.study})).value;expect((await s.call('/api/rounds/'+r.roundId+'/skip',{requestId:randomUUID(),revision:0})).status).toBe(200);}const b=await studyRound(s,'synthetic_full_v1');
    expect((await s.call(identityPath(a.study,b.round.roundId,a.requestId))).status).toBe(404);
    expect((await s.call(identityPath(b.study,b.round.roundId,a.requestId))).value).toEqual({accepted:false});expect((await s.call(identityPath(a.study,a.round.roundId,skipId))).value).toEqual({accepted:false});
    await s.call('/api/rounds/'+b.round.roundId+'/skip',{requestId:randomUUID(),revision:0});const privateRound=await s.create();expect((await s.call(identityPath(a.study,privateRound.roundId,a.requestId))).status).toBe(404);
    const foreign=s.app.services.sessions.establish();expect((await s.call(identityPath(a.study,a.round.roundId,a.requestId),undefined,{Cookie:'tm_session='+foreign.token})).status).toBe(404);
    s.advance(1800000);expect((await s.call(identityPath(a.study,b.round.roundId,a.requestId))).status).toBe(404);expect((await s.call(identityPath(b.study,b.round.roundId,a.requestId))).value).toEqual({accepted:false});
  });
  it('preserves authentication, exact identifiers, security controls, methods and technical retention',async()=>{
    const s=await server();expect((await s.call(identityPath('bad','bad','bad'))).status).toBe(401);await s.establish();await s.unlock();const a=await studyRound(s),path=identityPath(a.study,a.round.roundId,a.requestId);
    for(const values of [[a.study.toUpperCase(),a.round.roundId,a.requestId],[a.study,a.round.roundId.toUpperCase(),a.requestId],[a.study,a.round.roundId,a.requestId.toUpperCase()],['bad',a.round.roundId,a.requestId],[a.study,'bad',a.requestId],[a.study,a.round.roundId,'bad'],[randomUUID(),a.round.roundId,a.requestId]])expect((await s.call(identityPath(...values as [string,string,string]))).status).toBe(404);
    for(const headers of [{Host:'localhost:4317'},{Origin:'https://example.invalid'},{'Sec-Fetch-Site':'cross-site'}] as Record<string,string>[])expect((await s.call(path,undefined,headers)).status).toBe(403);
    expect((await s.call(path+'?accepted=true')).status).toBe(400);expect((await s.call(path,{}, {},'POST')).status).toBe(404);expect((await s.call(path,undefined,{},'HEAD')).status).toBe(400);
    s.advance(1800000);expect((await s.call(path)).value).toEqual({accepted:true});s.owner().createdAt+=86400000;s.advance(86400000);expect((await s.call(path)).status).toBe(404);
  });
});
