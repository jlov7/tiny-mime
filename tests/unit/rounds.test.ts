import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SessionManager } from '../../src/server/sessions.js';
import { RoundService } from '../../src/server/rounds.js';
import type { MotionScoreV1 } from '../../src/shared/score.js';
import { scoreHash } from '../../src/shared/hash.js';
import { isApiError } from '../../src/shared/api.js';

const score: MotionScoreV1 = { version: 1, durationMs: 6000, stage: { width: 1000, height: 700 }, actors: [
  { id: 'a', shape: 'circle', color: 'violet', keyframes: [0, 6000].map(tMs => ({ tMs, x: 250, y: 350, rotationDeg: 0, scaleX: 1, scaleY: 1, easing: 'linear' as const })) },
  { id: 'b', shape: 'square', color: 'amber', keyframes: [0, 6000].map(tMs => ({ tMs, x: 750, y: 350, rotationDeg: 0, scaleX: 1, scaleY: 1, easing: 'linear' as const })) },
] };
const scene = { id: 'test', score, scoreHash: scoreHash(score), meaning: { target: 'hidden event' }, authorship: { authoringMethod: 'agent_assisted' as const, humanReview: 'not_run' as const } };
const setup = (director?: any) => {
  let wall = 100000; let mono = 0; const tasks: (() => void)[] = [];
  const sessions = new SessionManager(() => wall); const owner = sessions.establish();
  const service = new RoundService({ sessions, scene: () => scene as any, director: director ?? (async () => ({ ok: true, score, scoreHash: scoreHash(score) })), liveEnabled: () => true, nowWall: () => wall, nowMono: () => mono, schedule: fn => tasks.push(fn) });
  return { service, owner, tasks, advance: (ms: number) => { wall += ms; mono += ms; } };
};
const create = (s: ReturnType<typeof setup>, requestId = randomUUID()) => s.service.create(s.owner, { requestId, mode: 'private_play', executionMode: 'fixture', studySessionId: null });

describe('owner-bound atomic rounds', () => {
  it('[R01 R02] creation lookup and exact replay return one round', async () => {
    const s = setup(); const id = randomUUID(); const a = await create(s, id); expect(isApiError(a)).toBe(false);
    const b = await create(s, id); expect(b).toEqual(a); expect(await s.service.readCreateRequest(s.owner, id)).toEqual(a); expect(s.tasks).toHaveLength(0);
  });
  it('[R03] different creates cannot strand a second active round', async () => {
    const s = setup(); const result = await Promise.all([create(s), create(s)]); expect(result.filter(isApiError)).toHaveLength(1); expect((result.find(isApiError) as any).error.code).toBe('ACTIVE_ROUND');
  });
  it('[R04 R05 R06] first guess returns before provider; duplicate and skip invalidate epoch', async () => {
    let resolve: any; let calls = 0; const s = setup(() => { calls++; return new Promise(r => resolve = r); });
    const round = await create(s) as any; const input = { requestId: randomUUID(), revision: 0, attempt: 1 as const, guess: 'They are dancing' };
    const accepted = await s.service.submitGuess(s.owner, round.roundId, input) as any; expect(accepted.state).toBe('generating_act2'); expect(calls).toBe(0);
    expect(await s.service.submitGuess(s.owner, round.roundId, input)).toEqual(accepted);
    s.tasks.shift()!(); expect(calls).toBe(1);
    const reveal = await s.service.skip(s.owner, round.roundId, { requestId: randomUUID(), revision: accepted.revision }) as any; expect(reveal.reveal.target).toBe('hidden event');
    resolve({ ok: true, score, scoreHash: scoreHash(score) }); await new Promise(r => setImmediate(r));
    const read = await s.service.read(s.owner, round.roundId) as any; expect(read.state).toBe('revealed'); expect(read.acts).toHaveLength(1);
  });
  it('[A01] foreign owner cannot inspect or recover round IDs', async () => {
    const s = setup(); const inputId = randomUUID(); const round = await create(s, inputId) as any; const foreign = { sessionId: randomUUID() };
    expect((await s.service.read(foreign, round.roundId) as any).error.code).toBe('UNAUTHENTICATED');
    const other = s.service.options.sessions.establish();
    expect((await s.service.read(other, round.roundId) as any).error.code).toBe('NOT_FOUND'); expect((await s.service.readCreateRequest(other, inputId) as any).error.code).toBe('NOT_FOUND');
  });
  it.each(['skip', 'abandon'] as const)('[R06] %s before the scheduled worker prevents dispatch and releases admission', async kind => {
    let calls = 0; const s = setup(async () => { calls++; return { ok: true, score, scoreHash: scoreHash(score) }; });
    const round = await create(s) as any;
    const accepted = await s.service.submitGuess(s.owner, round.roundId, { requestId: randomUUID(), revision: 0, attempt: 1, guess: 'a guess' }) as any;
    await s.service[kind](s.owner, round.roundId, { requestId: randomUUID(), revision: accepted.revision });
    s.tasks.shift()!(); await new Promise(r => setImmediate(r));
    expect(calls).toBe(0); expect((await s.service.read(s.owner, round.roundId) as any).state).toBe(kind === 'skip' ? 'revealed' : 'abandoned');
    const next = await create(s) as any;
    expect((await s.service.submitGuess(s.owner, next.roundId, { requestId: randomUUID(), revision: 0, attempt: 1, guess: 'another guess' }) as any).state).toBe('generating_act2');
    s.tasks.shift()!(); await new Promise(r => setImmediate(r)); expect(calls).toBe(1);
  });
  it('[D06] a delayed worker cannot begin a paid call after its round deadline', async () => {
    let calls = 0; const s = setup(async () => { calls++; return { ok: true, score, scoreHash: scoreHash(score) }; });
    const round = await create(s) as any;
    await s.service.submitGuess(s.owner, round.roundId, { requestId: randomUUID(), revision: 0, attempt: 1, guess: 'a guess' });
    s.advance(15001); s.tasks.shift()!(); await new Promise(r => setImmediate(r));
    expect(calls).toBe(0); expect((await s.service.read(s.owner, round.roundId) as any).generation.failure).toBe('deadline');
  });
  it('session expiry before dispatch cancels generation without invoking the director', async () => {
    let calls = 0; const s = setup(async () => { calls++; return { ok: true, score, scoreHash: scoreHash(score) }; });
    s.advance(8 * 3600000 - 1); const round = await create(s) as any;
    await s.service.submitGuess(s.owner, round.roundId, { requestId: randomUUID(), revision: 0, attempt: 1, guess: 'a guess' });
    s.advance(2); s.tasks.shift()!(); await new Promise(r => setImmediate(r)); expect(calls).toBe(0);
    expect((await s.service.read(s.owner, round.roundId) as any).error.code).toBe('UNAUTHENTICATED');
  });
  it('session expiry during generation prevents committing an in-flight score', async () => {
    let resolve: any; const s = setup(() => new Promise(r => resolve = r));
    s.advance(8 * 3600000 - 1); const round = await create(s) as any;
    await s.service.submitGuess(s.owner, round.roundId, { requestId: randomUUID(), revision: 0, attempt: 1, guess: 'a guess' });
    s.tasks.shift()!(); s.advance(2); resolve({ ok: true, score, scoreHash: scoreHash(score) }); await new Promise(r => setImmediate(r));
    const retained = (s.service as any).rounds.get(round.roundId); expect(retained.public.acts).toHaveLength(1); expect(retained.public.generation.status).toBe('cancelled');
  });
  it('[D06] deadline cannot commit a late score', async () => {
    let resolve: any; const s = setup(() => new Promise(r => resolve = r)); const round = await create(s) as any;
    await s.service.submitGuess(s.owner, round.roundId, { requestId: randomUUID(), revision: 0, attempt: 1, guess: 'a guess' }); s.tasks.shift()!(); s.advance(15001); resolve({ ok: true, score, scoreHash: scoreHash(score) }); await new Promise(r => setImmediate(r));
    const read = await s.service.read(s.owner, round.roundId) as any; expect(read.state).toBe('unavailable'); expect(read.generation.failure).toBe('deadline');
  });
  it('expires on mutations only and binds changed payload IDs', async () => {
    const s = setup(); const id = randomUUID(); const round = await create(s, id) as any;
    expect((await s.service.create(s.owner, { requestId: id, mode: 'private_play', executionMode: 'live', studySessionId: null }) as any).error.code).toBe('IDEMPOTENCY_CONFLICT');
    s.advance(1799999); expect(isApiError(await s.service.read(s.owner, round.roundId))).toBe(false); s.advance(1); expect((await s.service.read(s.owner, round.roundId) as any).error.code).toBe('EXPIRED');
  });
});
