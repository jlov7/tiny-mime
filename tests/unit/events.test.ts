import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { EventService, type ClientEvent } from '../../src/server/events.js';
import { apiError } from '../../src/shared/api.js';
import type { InternalRound } from '../../src/server/rounds.js';
import { matchesContract } from '../../src/server/contracts.js';

const hash = 'a'.repeat(64);
const base = () => ({ eventId: randomUUID(), clientSequence: 1, elapsedMs: 10 });
const started = (playId = randomUUID(), attempt: 1 | 2 = 1, playbackMode: 'motion' | 'frame_step' = 'motion'): ClientEvent => ({ ...base(), name: 'play_started', attempt, scoreHash: hash, playId, playbackMode, isReplay: false });
const completed = (start: ClientEvent & { name: 'play_started' }): ClientEvent => ({ ...base(), name: 'play_completed', attempt: start.attempt, scoreHash: start.scoreHash, playId: start.playId, playbackMode: start.playbackMode, playedElapsedMs: 6000 });
const visibility = (): ClientEvent => ({ ...base(), name: 'visibility_changed', visibility: 'visible' });
function setup() {
  let now = 100000; const owner = { sessionId: randomUUID() }; const foreign = { sessionId: randomUUID() };
  const round = { ownerId: owner.sessionId, expiredAt: null, submissionRequestId: randomUUID(), studySessionId: randomUUID(), public: {
    roundId: randomUUID(), revision: 7, expiresAt: '2030-01-01T00:00:00.000Z', state: 'awaiting_guess2', acts: [1, 2].map(attempt => ({ attempt, scoreHash: hash, score: { durationMs: 6000 } })),
  } } as unknown as InternalRound & { technicalActs: { attempt: 1 | 2; scoreHash: string; durationMs: number }[] };
  const recordEvent = vi.fn(); const recordFeedback = vi.fn();
  const owned = (s: { sessionId: string }, id: string) => s.sessionId !== owner.sessionId && s.sessionId !== foreign.sessionId ? apiError('UNAUTHENTICATED') : s.sessionId !== owner.sessionId || id !== round.public.roundId ? apiError('NOT_FOUND') : round;
  const service = new EventService({ now: () => now, access: (s, id) => { const value = owned(s, id); return value === round && round.expiredAt !== null ? apiError('EXPIRED') : value; }, technicalAccess: (s, id) => { const value = owned(s, id); return value === round && round.expiredAt !== null && now - round.expiredAt >= 86400000 ? apiError('NOT_FOUND') : value; }, study: { recordEvent, recordFeedback } });
  const submit = (events: unknown[], requestId = randomUUID(), s = owner) => service.submit(s, round.public.roundId, { requestId, events });
  return { service, owner, foreign, round, recordEvent, recordFeedback, submit, advance: (ms: number) => { now += ms; }, expire: () => { round.expiredAt = now; round.technicalActs = round.public.acts.map(act => ({ attempt: act.attempt, scoreHash: act.scoreHash, durationMs: act.score.durationMs })); round.public.acts = []; } };
}
const error = (result: unknown) => (result as { error: { code: string } }).error.code;

describe('strict owned event batches and feedback', () => {
  it('selects named request schemas without imposing the root PublicRound schema', () => {
    expect(matchesContract('EventsInput', { requestId: randomUUID(), events: [visibility()] })).toBe(true);
    expect(matchesContract('FeedbackInput', { requestId: randomUUID(), enjoyment: null, helpfulness: 5 })).toBe(true);
    expect(matchesContract('FeedbackInput', { requestId: randomUUID(), enjoyment: null, helpfulness: 5, revision: 0 })).toBe(false);
  });
  it('authenticates ownership before malformed payload diagnostics', () => {
    const s = setup(); expect(error(s.service.submit({ sessionId: randomUUID() }, s.round.public.roundId, null))).toBe('UNAUTHENTICATED');
    expect(error(s.service.submit(s.foreign, s.round.public.roundId, null))).toBe('NOT_FOUND'); expect(s.recordEvent).not.toHaveBeenCalled();
  });
  it('rejects an entire malformed batch without events, flags or capacity effects', () => {
    const s = setup(); const deadline = { ...base(), name: 'client_deadline', submissionRequestId: s.round.submissionRequestId, deadlineMs: 15000 };
    expect(error(s.submit([deadline, { ...visibility(), extra: true }]))).toBe('INVALID_INPUT');
    expect(s.service.observations(s.round.public.roundId).operationalOutcome.clientTimeout).toBe(false); expect(s.recordEvent).not.toHaveBeenCalled();
    expect(s.submit([deadline])).toEqual({ acceptedEventIds: [deadline.eventId], duplicateEventIds: [] });
    expect(error(s.submit(Array.from({ length: 21 }, visibility)))).toBe('INVALID_INPUT');
  });
  it('rejects impossible references atomically and resolves delayed valid completion delivery', () => {
    const s = setup(); const start = started() as ClientEvent & { name: 'play_started' }; const complete = completed(start);
    expect(error(s.submit([complete]))).toBe('INVALID_INPUT');
    expect(error(s.submit([start, { ...complete, scoreHash: 'b'.repeat(64) }]))).toBe('INVALID_INPUT');
    expect(s.recordEvent).not.toHaveBeenCalled();
    expect(s.submit([complete, { ...start, clientSequence: 0 }])).toEqual({ acceptedEventIds: [complete.eventId, start.eventId], duplicateEventIds: [] });
    expect(s.recordEvent.mock.calls[0][1].name).toBe('play_started'); expect(s.service.observations(s.round.public.roundId).completedPlays).toHaveLength(1);
    expect(error(s.submit([{ ...completed(start), playedElapsedMs: 5999 }]))).toBe('INVALID_INPUT');
    expect(error(s.submit([{ ...completed(start), playbackMode: 'frame_step' }]))).toBe('INVALID_INPUT');
  });
  it('binds event and request identities, counts exact duplicates once and never reruns effects', () => {
    const s = setup(); const event = visibility(); const requestId = randomUUID(); const original = s.submit([event, event], requestId);
    expect(original).toEqual({ acceptedEventIds: [event.eventId], duplicateEventIds: [event.eventId] }); expect(s.submit([event, event], requestId)).toEqual(original); expect(s.recordEvent).toHaveBeenCalledTimes(1);
    expect(s.submit([event])).toEqual({ acceptedEventIds: [], duplicateEventIds: [event.eventId] });
    expect(error(s.submit([{ ...event, visibility: 'hidden' }]))).toBe('IDEMPOTENCY_CONFLICT');
    expect(error(s.submit([visibility()], requestId))).toBe('IDEMPOTENCY_CONFLICT');
    const changed = visibility(); expect(error(s.submit([changed, { ...changed, visibility: 'hidden' }]))).toBe('IDEMPOTENCY_CONFLICT'); expect(s.recordEvent).toHaveBeenCalledTimes(1);
  });
  it('requires committed act2 and accepted guess1 for readiness and timing flags', () => {
    const s = setup(); const ready = { ...base(), name: 'client_ready', attempt: 2, scoreHash: hash, submissionRequestId: s.round.submissionRequestId, submissionElapsedMs: 16000, recovered: true };
    expect(error(s.submit([{ ...ready, attempt: 1 }]))).toBe('INVALID_INPUT');
    expect(error(s.submit([{ ...ready, submissionRequestId: randomUUID() }]))).toBe('INVALID_INPUT');
    expect(error(s.submit([{ ...base(), name: 'client_deadline', submissionRequestId: randomUUID(), deadlineMs: 15000 }]))).toBe('INVALID_INPUT');
    s.round.public.acts.pop(); expect(error(s.submit([ready]))).toBe('INVALID_INPUT');
    s.round.public.acts.push({ attempt: 2, scoreHash: hash, score: { durationMs: 6000 } } as any);
    const deadline = { ...base(), name: 'client_deadline', submissionRequestId: s.round.submissionRequestId, deadlineMs: 15000 };
    const uncertain = { ...base(), name: 'client_clock_uncertain', submissionRequestId: s.round.submissionRequestId, reason: 'reload_pending' };
    s.submit([deadline, uncertain, ready]); s.submit([{ ...ready, ...base(), recovered: false }]);
    expect(s.service.observations(s.round.public.roundId).operationalOutcome).toEqual({ clientTimeout: true, clockUncertain: true, lateRecovery: true });
  });
  it('derives replay counts from distinct owned plays and keeps frame stepping separate', () => {
    const s = setup(); const first = { ...started(), isReplay: true } as ClientEvent & { name: 'play_started' }; const second = started() as ClientEvent & { name: 'play_started' }; const frame = started(randomUUID(), 2, 'frame_step') as ClientEvent & { name: 'play_started' };
    s.submit([first, completed(first), second, completed(second), frame, completed(frame)]);
    s.submit([{ ...first, ...base() }, completed(first)]);
    const observations = s.service.observations(s.round.public.roundId);
    expect(observations.playbackObservations.map(play => play.replay)).toEqual([false, true, false]); expect(observations.completedPlays).toHaveLength(2); expect(observations.completedViews).toHaveLength(3); expect(observations.playbackObservations[2].mode).toBe('frame_step');
    expect(error(s.submit([{ ...second, ...base(), attempt: 2 }]))).toBe('INVALID_INPUT');
  });
  it('does not admit a started-only or mismatched frame traversal as a completed capture view', () => {
    const s = setup(); const frame = started(randomUUID(), 2, 'frame_step') as ClientEvent & { name: 'play_started' }; s.submit([frame]);
    expect(s.service.observations(s.round.public.roundId).completedViews).toHaveLength(0);
    expect(error(s.submit([{ ...completed(frame), scoreHash: '0'.repeat(64) }]))).toBe('INVALID_INPUT');
    expect(s.service.observations(s.round.public.roundId).completedViews).toHaveLength(0);
    s.submit([completed(frame)]); expect(s.service.observations(s.round.public.roundId).completedViews).toHaveLength(1);
    expect(s.service.observations(s.round.public.roundId).completedPlays).toHaveLength(0);
  });
  it('applies minute and round limits after valid duplicate lookup', () => {
    const s = setup(); const event = visibility(); s.submit([event]);
    for (let i = 0; i < 5; i++) s.submit(Array.from({ length: 20 }, visibility));
    s.submit(Array.from({ length: 19 }, visibility)); expect(s.recordEvent).toHaveBeenCalledTimes(120);
    expect(error(s.submit([visibility()]))).toBe('LIMITED'); expect(s.submit([event])).toEqual({ acceptedEventIds: [], duplicateEventIds: [event.eventId] });
    for (let i = 0; i < 19; i++) { s.advance(60000); expect('error' in s.submit(Array.from({ length: 20 }, visibility))).toBe(false); }
    expect(s.recordEvent).toHaveBeenCalledTimes(500); s.advance(60000); expect(error(s.submit([visibility()]))).toBe('LIMITED'); expect(s.submit([event])).toEqual({ acceptedEventIds: [], duplicateEventIds: [event.eventId] });
  });
  it('bounds global retained events and prevents reusing a playId in another round', () => {
    const s = setup(); const start = started(); s.submit([start]); s.round.public.roundId = randomUUID();
    expect(error(s.submit([{ ...start, ...base() }]))).toBe('INVALID_INPUT');
    const bounded = setup();
    for (let round = 0; round < 20; round++) {
      bounded.round.public.roundId = randomUUID();
      for (let batch = 0; batch < 25; batch++) { if (batch % 5 === 0) bounded.advance(60000); expect('error' in bounded.submit(Array.from({ length: 20 }, visibility))).toBe(false); }
    }
    bounded.round.public.roundId = randomUUID(); bounded.advance(60000);
    expect(error(bounded.submit([visibility()]))).toBe('LIMITED'); expect(bounded.recordEvent).toHaveBeenCalledTimes(10000);
  });
  it('leaves RAM observations untouched when the research transaction fails', () => {
    const s = setup(); const events = [visibility(), visibility()]; const durable: string[] = [];
    s.service.options.study!.transaction = effect => { const before = [...durable]; try { effect(); } catch (failure) { durable.splice(0, durable.length, ...before); throw failure; } };
    s.recordEvent.mockImplementation((_id, event) => { durable.push(event.eventId); if (durable.length === 2) throw new Error('storage failed'); });
    expect(error(s.submit(events))).toBe('UNAVAILABLE'); expect(durable).toEqual([]);
    s.recordEvent.mockImplementation((_id, event) => { durable.push(event.eventId); });
    expect(s.submit(events)).toEqual({ acceptedEventIds: events.map(event => event.eventId), duplicateEventIds: [] }); expect(durable).toEqual(events.map(event => event.eventId));
  });
  it('accepts only retained technical timing observations after expiry and clears custody', () => {
    const s = setup(); s.expire(); const snapshot = structuredClone(s.round.public);
    const ready = { ...base(), name: 'client_ready', attempt: 2, scoreHash: hash, submissionRequestId: s.round.submissionRequestId, submissionElapsedMs: 16000, recovered: true };
    s.advance(86399999); expect('error' in s.submit([ready])).toBe(false); expect(s.round.public).toEqual(snapshot); expect(error(s.submit([started()]))).toBe('INVALID_INPUT'); expect(error(s.submit([visibility()]))).toBe('INVALID_INPUT');
    s.advance(1); expect(error(s.submit([ready]))).toBe('NOT_FOUND'); expect(s.service.observations(s.round.public.roundId).operationalOutcome.lateRecovery).toBe(false);
  });
  it('saves exact feedback once after reveal without changing revision or expiry', () => {
    const s = setup(); const input = { requestId: randomUUID(), enjoyment: 3, helpfulness: null }; const submit = (body: unknown) => s.service.feedback(s.owner, s.round.public.roundId, body);
    expect(error(submit(input))).toBe('INVALID_INPUT'); s.round.public.state = 'revealed'; const snapshot = structuredClone(s.round.public);
    expect(error(submit({ ...input, revision: 7 }))).toBe('INVALID_INPUT'); expect(error(submit({ ...input, enjoyment: 0 }))).toBe('INVALID_INPUT');
    expect(submit(input)).toEqual({ saved: true }); expect(submit(input)).toEqual({ saved: true }); expect(s.recordFeedback).toHaveBeenCalledExactlyOnceWith(s.round.public.roundId, { delight: 3, helpfulness: null }); expect(s.round.public).toEqual(snapshot);
    expect(error(submit({ ...input, enjoyment: 4 }))).toBe('IDEMPOTENCY_CONFLICT'); expect(error(submit({ ...input, requestId: randomUUID() }))).toBe('INVALID_INPUT');
    s.service.clear([s.round.public.roundId]); expect(s.service.observations(s.round.public.roundId).completedPlays).toHaveLength(0);
    s.expire(); expect(error(submit(input))).toBe('EXPIRED');
  });
  it('reads only the owned feedback flag without creating or renewing records', () => {
    const s = setup(); const id = s.round.public.roundId; const snapshot = structuredClone(s.round.public);
    expect(error(s.service.feedbackStatus({ sessionId: randomUUID() }, id))).toBe('UNAUTHENTICATED');
    expect(error(s.service.feedbackStatus(s.foreign, id))).toBe('NOT_FOUND');
    expect(error(s.service.feedbackStatus(s.owner, randomUUID()))).toBe('NOT_FOUND');
    expect(s.service.feedbackStatus(s.owner, id)).toEqual({ saved: false, secondActCompletionRecorded: false });
    expect((s.service as any).records.size).toBe(0); expect((s.service as any).requests.size).toBe(0);
    expect(s.round.public).toEqual(snapshot); expect(s.recordEvent).not.toHaveBeenCalled(); expect(s.recordFeedback).not.toHaveBeenCalled();
    s.round.public.state = 'revealed'; s.service.feedback(s.owner, id, { requestId: randomUUID(), enjoyment: null, helpfulness: 4 });
    const record = structuredClone((s.service as any).records.get(id)); const revealed = structuredClone(s.round.public);
    s.advance(1000); expect(s.service.feedbackStatus(s.owner, id)).toEqual({ saved: true, secondActCompletionRecorded: false });
    expect((s.service as any).records.get(id)).toEqual(record); expect(s.round.public).toEqual(revealed); expect(s.recordFeedback).toHaveBeenCalledTimes(1);
    s.expire(); expect(error(s.service.feedbackStatus(s.owner, id))).toBe('EXPIRED');
  });
  for (const mode of ['motion', 'frame_step'] as const) it(`reports only accepted matching second-act ${mode} completions without changing motion metrics`, () => {
    const s = setup(), id = s.round.public.roundId, play = started(randomUUID(), 2, mode) as ClientEvent & { name: 'play_started' };
    const status = () => s.service.feedbackStatus(s.owner, id);
    expect(status()).toEqual({ saved: false, secondActCompletionRecorded: false });
    expect(error(s.submit([completed(play)]))).toBe('INVALID_INPUT'); expect(status()).toMatchObject({ secondActCompletionRecorded: false });
    expect(error(s.submit([play, { ...completed(play), playId: randomUUID() }]))).toBe('INVALID_INPUT');
    expect(error(s.submit([play, { ...completed(play), scoreHash: 'b'.repeat(64) }]))).toBe('INVALID_INPUT');
    s.submit([play]); expect(status()).toMatchObject({ secondActCompletionRecorded: false });
    const finish = completed(play); s.submit([finish]); s.submit([finish]);
    expect(status()).toEqual({ saved: false, secondActCompletionRecorded: true });
    expect(s.service.observations(id).completedViews).toHaveLength(1); expect(s.service.observations(id).completedPlays).toHaveLength(mode === 'motion' ? 1 : 0);
    expect(error(s.service.feedbackStatus(s.foreign, id))).toBe('NOT_FOUND');
    s.round.public.acts[1].scoreHash = 'b'.repeat(64); expect(status()).toMatchObject({ secondActCompletionRecorded: false });
    s.expire(); expect(error(status())).toBe('EXPIRED');
  });

});
