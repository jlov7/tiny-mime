import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { RoundService, type InternalRound } from '../../src/server/rounds.js';
import { SessionManager } from '../../src/server/sessions.js';
import type { PublicRound } from '../../src/shared/api.js';
import { scoreHash } from '../../src/shared/hash.js';
import type { MotionScoreV1 } from '../../src/shared/score.js';

const score: MotionScoreV1 = { version: 1, durationMs: 6000, stage: { width: 1000, height: 700 }, actors: [
  { id: 'a', shape: 'circle', color: 'violet', keyframes: [0, 6000].map(tMs => ({ tMs, x: 250, y: 350, rotationDeg: 0, scaleX: 1, scaleY: 1, easing: 'linear' as const })) },
  { id: 'b', shape: 'square', color: 'amber', keyframes: [0, 6000].map(tMs => ({ tMs, x: 750, y: 350, rotationDeg: 0, scaleX: 1, scaleY: 1, easing: 'linear' as const })) },
] };
const scene = { id: 'test', score, scoreHash: scoreHash(score), meaning: { target: 'hidden target' }, authorship: { authoringMethod: 'agent_assisted' as const, humanReview: 'not_run' as const } };
function setup() {
  let wall = 100000; let mono = 0; const tasks: (() => void)[] = [];
  const sessions = new SessionManager(() => wall); const owner = sessions.establish();
  const director = vi.fn(async () => ({ ok: true as const, score, scoreHash: scene.scoreHash }));
  const service = new RoundService({ sessions, scene: () => scene, director, liveEnabled: () => false, nowWall: () => wall, nowMono: () => mono, schedule: fn => tasks.push(fn) });
  const create = async (requestId = randomUUID()) => await service.create(owner, { requestId, mode: 'private_play', executionMode: 'fixture', studySessionId: null }) as PublicRound;
  return { sessions, owner, service, director, tasks, create, advance(ms: number) { wall += ms; mono += ms; owner.createdAt += ms; } };
}

describe('minimal mutation acceptance receipt', () => {
  it.each(['guess1', 'guess2', 'skip', 'abandon'] as const)('retains only the %s acceptance bit before and after round expiry', async kind => {
    const s = setup(); const round = await s.create(); const requestId = randomUUID();
    if (kind === 'guess1' || kind === 'guess2') {
      const first = await s.service.submitGuess(s.owner, round.roundId, { requestId: kind === 'guess1' ? requestId : randomUUID(), revision: 0, attempt: 1, guess: 'private text' }) as PublicRound;
      if (kind === 'guess2') {
        s.tasks.shift()!(); await new Promise(resolve => setImmediate(resolve));
        const ready = await s.service.read(s.owner, round.roundId) as PublicRound;
        expect(first.state).toBe('generating_act2'); expect(ready.state).toBe('awaiting_guess2');
        await s.service.submitGuess(s.owner, round.roundId, { requestId, revision: ready.revision, attempt: 2, guess: 'private second text' });
      }
    } else await s.service[kind](s.owner, round.roundId, { requestId, revision: 0 });
    expect(await s.service.readMutationRequestStatus(s.owner, round.roundId, requestId)).toEqual({ accepted: true });
    expect(await s.service.readMutationRequestStatus(s.owner, round.roundId, randomUUID())).toEqual({ accepted: false });
    s.advance(1800000);
    expect(await s.service.readMutationRequestStatus(s.owner, round.roundId, requestId)).toEqual({ accepted: true });
    expect(await s.service.readMutationRequestStatus(s.owner, round.roundId, randomUUID())).toEqual({ accepted: false });
    expect((await s.service.read(s.owner, round.roundId) as any).error.code).toBe('EXPIRED');
    expect((await s.service.readMutationRequest(s.owner, round.roundId, requestId) as any).error.code).toBe('EXPIRED');
    s.service.shutdown();
  });
  it('returns false for creation, rejected requests and mutations committed to another owned round', async () => {
    const s = setup(); const createId = randomUUID(); const round = await s.create(createId); const rejectedId = randomUUID(); const acceptedId = randomUUID();
    expect((await s.service.skip(s.owner, round.roundId, { requestId: rejectedId, revision: 9 }) as any).error.code).toBe('STALE');
    await s.service.skip(s.owner, round.roundId, { requestId: acceptedId, revision: 0 });
    const next = await s.create();
    for (const id of [createId, rejectedId, acceptedId, randomUUID()]) expect(await s.service.readMutationRequestStatus(s.owner, next.roundId, id)).toEqual({ accepted: false });
    expect(await s.service.readMutationRequestStatus(s.owner, round.roundId, createId)).toEqual({ accepted: false });
    expect(await s.service.readMutationRequestStatus(s.owner, round.roundId, rejectedId)).toEqual({ accepted: false });
    s.advance(1800000);
    expect(await s.service.readMutationRequestStatus(s.owner, round.roundId, rejectedId)).toEqual({ accepted: false });
  });
  it('authenticates before lookup, then rejects foreign, unknown and malformed round/request identifiers', async () => {
    const s = setup(); const round = await s.create(); const requestId = randomUUID(); const foreign = s.sessions.establish();
    await s.service.skip(s.owner, round.roundId, { requestId, revision: 0 });
    expect((await s.service.readMutationRequestStatus({ sessionId: randomUUID() }, 'bad', 'bad') as any).error.code).toBe('UNAUTHENTICATED');
    for (const [owner, id, req] of [
      [foreign, round.roundId, requestId], [s.owner, randomUUID(), requestId],
      [s.owner, round.roundId.toUpperCase(), requestId], [s.owner, round.roundId, requestId.toUpperCase()],
      [s.owner, '11111111-1111-1111-8111-111111111111', requestId], [s.owner, round.roundId, '11111111-1111-1111-8111-111111111111'],
      [s.owner, 'bad', requestId], [s.owner, round.roundId, 'bad'],
    ] as const) expect((await s.service.readMutationRequestStatus(owner, id, req) as any).error.code).toBe('NOT_FOUND');
  });
  it('does not touch deadlines, dispatch queued work, revive expiry or bind an unaccepted request', async () => {
    const s = setup(); const round = await s.create(); const requestId = randomUUID();
    const input = { requestId, revision: 0, attempt: 1 as const, guess: 'saved guess' };
    expect(await s.service.readMutationRequestStatus(s.owner, round.roundId, requestId)).toEqual({ accepted: false });
    const accepted = await s.service.submitGuess(s.owner, round.roundId, input) as PublicRound;
    const internal = s.service.internal(s.owner, round.roundId) as InternalRound;
    const before = { public: structuredClone(internal.public), expiresMono: internal.expiresMono, deadlineMono: internal.deadlineMono, epoch: internal.epoch, abort: internal.abort };
    s.advance(1000);
    expect(await s.service.readMutationRequestStatus(s.owner, round.roundId, requestId)).toEqual({ accepted: true });
    expect({ public: internal.public, expiresMono: internal.expiresMono, deadlineMono: internal.deadlineMono, epoch: internal.epoch, abort: internal.abort }).toEqual(before);
    expect(s.tasks).toHaveLength(1); expect(s.director).not.toHaveBeenCalled();
    expect(await s.service.submitGuess(s.owner, round.roundId, input)).toEqual(accepted);
    expect((await s.service.submitGuess(s.owner, round.roundId, { ...input, guess: 'changed' }) as any).error.code).toBe('IDEMPOTENCY_CONFLICT');
    s.advance(1799000);
    expect(await s.service.readMutationRequestStatus(s.owner, round.roundId, requestId)).toEqual({ accepted: true });
    const expiredAt = internal.expiredAt;
    expect(internal.public.acts).toEqual([]); expect(internal.public.guesses).toEqual([]);
    s.advance(1000); expect(await s.service.readMutationRequestStatus(s.owner, round.roundId, requestId)).toEqual({ accepted: true });
    expect(internal.expiredAt).toBe(expiredAt); expect(internal.expiresMono).toBe(before.expiresMono); expect(internal.deadlineMono).toBe(before.deadlineMono);
    expect(s.director).not.toHaveBeenCalled(); s.service.shutdown();
  });
  it('stops at the existing technical tombstone cutoff even before sweeping bindings', async () => {
    const s = setup(); const round = await s.create(); const requestId = randomUUID();
    await s.service.abandon(s.owner, round.roundId, { requestId, revision: 0 }); s.advance(1800000);
    expect(await s.service.readMutationRequestStatus(s.owner, round.roundId, requestId)).toEqual({ accepted: true });
    s.advance(86400000 - 1); expect(await s.service.readMutationRequestStatus(s.owner, round.roundId, requestId)).toEqual({ accepted: true });
    s.advance(1); expect((await s.service.readMutationRequestStatus(s.owner, round.roundId, requestId) as any).error.code).toBe('NOT_FOUND');
    s.service.sweep(); expect(s.service.hasRequest(s.owner, requestId)).toBe(false);
    expect((await s.service.readMutationRequestStatus(s.owner, round.roundId, requestId) as any).error.code).toBe('NOT_FOUND');
  });
});
