import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { matchesContract, parseRequest } from '../../src/server/contracts.js';
import { EventService, type ClientEvent } from '../../src/server/events.js';
import type { InternalRound } from '../../src/server/rounds.js';
import { apiError } from '../../src/shared/api.js';
import { StudyService } from '../../src/server/study/service.js';
import { ANALYST_HEADER } from '../../src/server/study/exports.js';
import { parseSyntheticAnalystCsv } from '../../src/server/study/analysis.js';
import { testCatalogue } from '../../fixtures/study/testCatalogue.js';

const databases: Database.Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
const base = () => ({ eventId: randomUUID(), clientSequence: 0, elapsedMs: 0 });
const observed = (reducedMotion: boolean) => ({ ...base(), name: 'motion_preference_observed' as const, reducedMotion });
function setup() {
  let now = Date.now();
  const db = new Database(':memory:'); databases.push(db);
  const catalogue = testCatalogue(), study = new StudyService(db, { catalogue, now: () => now });
  const owner = { sessionId: randomUUID() }, foreign = { sessionId: randomUUID() };
  const session = study.createRehearsal(owner.sessionId, { requestId: randomUUID(), fixtureScheduleId: 'synthetic_short_v1' });
  const plan = study.nextRound(owner.sessionId, session.studySessionId), id = randomUUID();
  study.attachRound(owner.sessionId, session.studySessionId, id, plan);
  const clip = catalogue.find(scene => scene.sceneId === plan.sceneId)!;
  const round = { ownerId: owner.sessionId, expiredAt: null, studySessionId: session.studySessionId, public: { roundId: id, acts: [{ attempt: 1, scoreHash: clip.scoreHash, score: clip.score }] } } as unknown as InternalRound;
  const access = (s: { sessionId: string }, roundId: string) => s.sessionId !== owner.sessionId && s.sessionId !== foreign.sessionId ? apiError('UNAUTHENTICATED') : s.sessionId !== owner.sessionId || roundId !== id ? apiError('NOT_FOUND') : round;
  const events = new EventService({ access, now: () => now, study: { recordEvent: (roundId, event) => study.recordEvent(roundId, event), recordFeedback: (roundId, feedback) => study.recordFeedback(roundId, feedback), transaction: effect => db.transaction(effect)() } });
  const submit = (values: unknown[], requestId = randomUUID()) => events.submit(owner, id, { requestId, events: values });
  const exportBytes = (format: Parameters<StudyService['createExport']>[1]['format'], exporter = owner.sessionId) => {
    const result = study.createExport(exporter, { requestId: randomUUID(), studyRunId: plan.studyRunId, format });
    return study.downloadExport(exporter, result.exportId);
  };
  const analyst = () => parseSyntheticAnalystCsv(exportBytes('analyst_csv').bytes.toString())[0]!;
  const provenance = () => JSON.parse(exportBytes('provenance_json').bytes.toString());
  const play = (playbackMode: 'motion' | 'frame_step'): ClientEvent => ({ ...base(), name: 'play_started', attempt: 1, scoreHash: clip.scoreHash, playId: randomUUID(), playbackMode, isReplay: false });
  return { db, study, events, owner, foreign, session, plan, id, round, clip, submit, exportBytes, analyst, provenance, play, advance: (ms: number) => { now += ms; } };
}

describe('actual reduced-motion observations', () => {
  it.each([true, false])('records the initial %s preference independently of selected playback', initial => {
    const s = setup(), observation = observed(initial);
    expect(s.submit([observation, s.play(initial ? 'motion' : 'frame_step')])).toEqual({ acceptedEventIds: expect.arrayContaining([observation.eventId]), duplicateEventIds: [] });
    expect(s.analyst().reduced_motion).toBe(initial);
    expect(s.provenance().rounds[0].motionPreference).toEqual({ initial, changes: 0 });
  });

  it('leaves absent observations unknown, including after manual frame viewing', () => {
    const s = setup();
    s.submit([s.play('frame_step'), { ...base(), name: 'playback_mode_changed', playbackMode: 'motion' }]);
    expect(s.analyst().reduced_motion).toBeNull();
    expect(s.provenance().rounds[0].motionPreference).toEqual({ initial: null, changes: 0 });
    expect(s.exportBytes('analyst_csv').bytes.toString().split('\r\n')[0]).toBe(ANALYST_HEADER.join(','));
    expect(ANALYST_HEADER).toHaveLength(96);
  });

  it('counts only actual value changes and preserves the first setting across duplicate and reload observations', () => {
    const s = setup(), initial = observed(false), requestId = randomUUID();
    const first = s.submit([initial, initial], requestId);
    expect(first).toEqual({ acceptedEventIds: [initial.eventId], duplicateEventIds: [initial.eventId] });
    expect(s.submit([initial, initial], requestId)).toEqual(first);
    expect(s.submit([initial])).toEqual({ acceptedEventIds: [], duplicateEventIds: [initial.eventId] });
    s.submit([observed(false), observed(true), observed(true), observed(false)]);
    const restarted = new EventService(s.events.options);
    expect(restarted.submit(s.owner, s.id, { requestId: randomUUID(), events: [initial, observed(false)] })).toMatchObject({ acceptedEventIds: [initial.eventId, expect.any(String)] });
    expect(s.analyst().reduced_motion).toBe(false);
    expect(s.provenance().rounds[0].motionPreference).toEqual({ initial: false, changes: 2 });
  });

  it('retains preference changes only in restricted provenance and keeps coder and fidelity exports masked', () => {
    const s = setup();
    s.submit([observed(true), observed(false)]);
    s.study.recordRound(s.id, { secondAct: { score: s.clip.score, scoreHash: s.clip.scoreHash, source: 'mock_fixture' }, terminal: true });
    s.study.finishRound(s.id);
    for (let i = 0; i < 2; i++) {
      const plan = s.study.nextRound(s.owner.sessionId, s.session.studySessionId), id = randomUUID();
      s.study.attachRound(s.owner.sessionId, s.session.studySessionId, id, plan);
      s.study.recordRound(id, { terminal: true }); s.study.finishRound(id);
    }
    s.study.sessionFeedback(s.owner.sessionId, s.session.studySessionId, { requestId: randomUUID(), wouldPlayAgain: null, optionalExtraAccepted: false });
    s.study.lockFirst(s.plan.studyRunId);
    const forbidden = /"(?:motionPreference|reducedMotion|reduced_motion|condition|scheduleId|studyRunId)"/;
    for (const format of ['coder_first_csv', 'coder_second_csv'] as const) {
      const csv = s.exportBytes(format).bytes.toString();
      expect(csv.split('\r\n')[0]).toBe('rowId,rubric,guess'); expect(csv).not.toMatch(forbidden);
    }
    const fidelity = unzipSync(s.exportBytes('fidelity_bundle').bytes);
    expect(Object.keys(fidelity).some(file => file.endsWith('.html'))).toBe(true);
    for (const bytes of Object.values(fidelity)) expect(strFromU8(bytes)).not.toMatch(forbidden);
    expect(s.exportBytes('raw_responses_json').bytes.toString()).not.toMatch(/motionPreference|reducedMotion|reduced_motion/);
    expect(s.events.observations(s.id)).not.toHaveProperty('motionPreference');
    const restricted = s.exportBytes('provenance_json');
    expect(JSON.parse(restricted.bytes.toString()).rounds[0].motionPreference).toEqual({ initial: true, changes: 1 });
    const exportId = restricted.filename.replace(/^synthetic-/, '').replace(/\.json$/, '');
    expect(() => s.study.downloadExport(s.foreign.sessionId, exportId)).toThrow('NOT_FOUND');
  });

  it('uses existing ownership, idempotency, rate and round-lifetime rules', () => {
    const s = setup(), event = observed(true), payload = { requestId: randomUUID(), events: [event] };
    expect(s.events.submit(s.foreign, s.id, payload)).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(s.events.submit({ sessionId: randomUUID() }, s.id, null)).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
    expect(s.events.submit(s.owner, randomUUID(), payload)).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(s.submit([event])).toEqual({ acceptedEventIds: [event.eventId], duplicateEventIds: [] });
    expect(s.submit([{ ...event, reducedMotion: false }])).toMatchObject({ error: { code: 'IDEMPOTENCY_CONFLICT' } });
    for (let i = 0; i < 5; i++) s.submit(Array.from({ length: 20 }, () => observed(true)));
    s.submit(Array.from({ length: 19 }, () => observed(true)));
    expect(s.submit([observed(false)])).toMatchObject({ error: { code: 'LIMITED' } });
    expect(s.submit([event])).toEqual({ acceptedEventIds: [], duplicateEventIds: [event.eventId] });
    s.advance(60000); s.round.expiredAt = Date.now();
    expect(s.submit([observed(false)])).toMatchObject({ error: { code: 'INVALID_INPUT' } });
    expect(s.provenance().rounds[0].motionPreference).toEqual({ initial: true, changes: 0 });
  });
});

describe('closed local event contract amendment', () => {
  it('accepts exactly the new event and existing base bounds through request parsing', () => {
    const event: ClientEvent = observed(false), payload = { requestId: randomUUID(), events: [event] };
    expect(matchesContract('ClientEventV1', event)).toBe(true);
    expect(parseRequest(JSON.stringify(payload), 'EventsInput')).toEqual(payload);
    expect(matchesContract('EventsInput', { ...payload, events: [{ ...event, clientSequence: 1000000, elapsedMs: null }] })).toBe(true);
    expect(matchesContract('EventsInput', { ...payload, events: [{ ...event, elapsedMs: 86400000 }] })).toBe(true);
  });

  it.each([
    { reducedMotion: undefined }, { reducedMotion: null }, { reducedMotion: 'false' }, { reducedMotion: 0 },
    { extra: true }, { playbackMode: 'motion' }, { name: 'motion_preference_changed' },
    { eventId: randomUUID().toUpperCase() }, { eventId: 'not-an-id' },
    { clientSequence: -1 }, { clientSequence: 0.5 }, { clientSequence: 1000001 },
    { elapsedMs: undefined }, { elapsedMs: -1 }, { elapsedMs: 0.5 }, { elapsedMs: 86400001 },
  ])('rejects malformed preference or base fields: %j', patch => {
    const value = { ...observed(true), ...patch };
    expect(matchesContract('ClientEventV1', value)).toBe(false);
    expect(() => parseRequest(JSON.stringify({ requestId: randomUUID(), events: [value] }), 'EventsInput')).toThrow('INVALID_INPUT');
  });

  it('preserves batch closure, limits and every original event branch in mixed batches', () => {
    const s = setup(), event = observed(false), payload = { requestId: randomUUID(), events: [event] };
    for (const invalid of [{ ...payload, extra: true }, { ...payload, requestId: 'invalid' }, { ...payload, events: [] }, { ...payload, events: Array.from({ length: 21 }, () => observed(false)) }]) {
      expect(matchesContract('EventsInput', invalid)).toBe(false);
    }
    const malformed = [
      { ...s.play('motion'), reducedMotion: true }, { ...s.play('motion'), scoreHash: 'bad' },
      { ...base(), name: 'visibility_changed', visibility: 'visible', reducedMotion: true },
      { ...base(), name: 'playback_mode_changed', playbackMode: 'invalid' },
      { ...base(), name: 'client_deadline', submissionRequestId: randomUUID(), deadlineMs: 15001 },
      { ...base(), name: 'client_clock_uncertain', submissionRequestId: randomUUID(), reason: 'invalid' },
    ];
    for (const oldEvent of malformed) expect(s.submit([event, oldEvent])).toMatchObject({ error: { code: 'INVALID_INPUT' } });
    expect(s.analyst().reduced_motion).toBeNull();
    expect(s.provenance().rounds[0].motionPreference).toEqual({ initial: null, changes: 0 });
    expect(s.submit([event, { ...base(), name: 'visibility_changed', visibility: 'hidden' }])).toMatchObject({ acceptedEventIds: [event.eventId, expect.any(String)] });
  });
});
