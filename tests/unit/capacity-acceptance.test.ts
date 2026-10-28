import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { EventService, type ClientEvent } from '../../src/server/events.js';
import { getScene } from '../../src/server/operator/sceneBank.js';
import { RoundService, type InternalRound } from '../../src/server/rounds.js';
import { SessionManager } from '../../src/server/sessions.js';
import type { PublicRound } from '../../src/shared/api.js';

describe('accepted first guess when generation capacity is full', () => {
  it.each(['client_clock_uncertain', 'client_deadline'] as const)('acknowledges saved %s evidence after response loss, reload and expiry', async name => {
    let wall = 100000; let mono = 0; const tasks: (() => void)[] = [];
    const sessions = new SessionManager(() => wall);
    const director = vi.fn(async () => ({ ok: false as const, failure: 'provider_disabled' as const }));
    const rounds = new RoundService({ sessions, scene: () => getScene('TM01')!, director, liveEnabled: () => false, nowWall: () => wall, nowMono: () => mono, schedule: fn => tasks.push(fn) });
    const events = new EventService({ access: (s, id) => rounds.internal(s, id), technicalAccess: (s, id) => rounds.technical(s, id), now: () => wall });
    try {
      for (let i = 0; i < 2; i++) {
        const owner = sessions.establish();
        const round = await rounds.create(owner, { requestId: randomUUID(), mode: 'private_play', executionMode: 'fixture', studySessionId: null }) as PublicRound;
        expect((await rounds.submitGuess(owner, round.roundId, { requestId: randomUUID(), revision: 0, attempt: 1, guess: 'capacity holder' }) as PublicRound).state).toBe('generating_act2');
      }
      const owner = sessions.establish();
      const round = await rounds.create(owner, { requestId: randomUUID(), mode: 'private_play', executionMode: 'fixture', studySessionId: null }) as PublicRound;
      const input = { requestId: randomUUID(), revision: 0, attempt: 1 as const, guess: 'saved uncertain guess' };
      const base = { eventId: randomUUID(), clientSequence: 1, elapsedMs: name === 'client_deadline' ? 15000 : null, submissionRequestId: input.requestId };
      const event: ClientEvent = name === 'client_clock_uncertain' ? { ...base, name, reason: 'reload_pending' } : { ...base, name, deadlineMs: 15000 };
      const saved = JSON.stringify({ roundId: round.roundId, requestId: randomUUID(), events: [event] });
      // Discard the submission response; recovery uses only saved request and event identities.
      await rounds.submitGuess(owner, round.roundId, input);
      const internal = rounds.internal(owner, round.roundId) as InternalRound;
      expect(internal.public.state).toBe('unavailable');
      expect(internal.public.generation).toEqual({ acceptedAt: new Date(wall).toISOString(), deadlineAt: new Date(wall + 15000).toISOString(), status: 'failed', failure: 'limited' });
      expect(internal.deadlineMono).toBeNull(); expect(internal.acceptedMono).toBeNull(); expect(internal.epoch).toBeNull();
      expect(tasks).toHaveLength(2); expect(director).not.toHaveBeenCalled();
      const reloaded = JSON.parse(saved);
      expect(await rounds.readMutationRequestStatus(owner, reloaded.roundId, input.requestId)).toEqual({ accepted: true });
      wall += 1800000; mono += 1800000;
      expect((await rounds.read(owner, reloaded.roundId) as any).error.code).toBe('EXPIRED');
      expect(await rounds.readMutationRequestStatus(owner, reloaded.roundId, input.requestId)).toEqual({ accepted: true });
      const expired = rounds.technical(owner, reloaded.roundId) as InternalRound;
      const snapshot = structuredClone(expired.public); const expiresMono = expired.expiresMono;
      const batch = { requestId: reloaded.requestId, events: reloaded.events };
      const acknowledged = { acceptedEventIds: [event.eventId], duplicateEventIds: [] };
      expect(events.submit(owner, reloaded.roundId, batch)).toEqual(acknowledged);
      expect(events.submit(owner, reloaded.roundId, batch)).toEqual(acknowledged);
      expect(events.submit(owner, reloaded.roundId, { ...batch, requestId: randomUUID() })).toEqual({ acceptedEventIds: [], duplicateEventIds: [event.eventId] });
      expect(events.observations(reloaded.roundId).operationalOutcome).toEqual({ clientTimeout: name === 'client_deadline', clockUncertain: name === 'client_clock_uncertain', lateRecovery: false });
      expect((events.submit(owner, reloaded.roundId, { requestId: randomUUID(), events: [{ ...event, eventId: randomUUID(), submissionRequestId: randomUUID() }] }) as any).error.code).toBe('INVALID_INPUT');
      expect(expired.public).toEqual(snapshot); expect(expired.expiresMono).toBe(expiresMono); expect(expired.deadlineMono).toBeNull();
      expect(tasks).toHaveLength(2); expect(director).not.toHaveBeenCalled();
    } finally { rounds.shutdown(); }
  });
});
