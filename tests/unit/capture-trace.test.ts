import { describe, expect, it } from 'vitest';
import specimen from '../../Tiny_Mime_Review_Source_Pack/supplements/contract-fixtures/TM01.first-score.json';
import { scoreHash } from '../../src/shared/hash.js';
import type { MotionScoreV1 } from '../../src/shared/score.js';
import { buildCapture, captureTiming, type CaptureRecord } from '../../src/server/operator/capture.js';
import { CaptureTraceStore, traceTimeline, validCaptureTrace, type CaptureTrace, type CaptureTraceState } from '../../src/server/operator/captureTrace.js';
import type { InternalRound } from '../../src/server/rounds.js';

const id = '11111111-1111-4111-8111-111111111111', requestId = '22222222-2222-4222-8222-222222222222';
const finalSubmissionRequestId = '33333333-3333-4333-8333-333333333333';
const score = specimen as MotionScoreV1;
function record(): CaptureRecord {
  return { round: { roundId: id, revision: 3, expiresAt: '2026-10-21T18:00:00Z', mode: 'private_play', executionMode: 'fixture', phase: 'play', state: 'revealed', actions: [], acts: [1, 2].map(attempt => ({ attempt: attempt as 1 | 2, score, scoreHash: scoreHash(score), source: 'mock_fixture', authorship: null })), guesses: [{ attempt: 1, text: 'first' }, { attempt: 2, text: 'second' }], reveal: { target: 'Scene' }, generation: { acceptedAt: '2026-10-21T17:00:00Z', deadlineAt: '2026-10-21T17:00:15Z', status: 'ready', failure: null } }, creatorOwned: true, publicationPermission: null, actualWaitMs: 1200, serverGenerationMs: 1200, timeline: [], selectedExample: true, createdAt: '2026-10-21T17:02:00Z', versions: { engine: 'test', contact: 'test', meaning: 'test', prompt: null, model: null } };
}
function trace(): CaptureTrace {
  const initial: CaptureTraceState = { seq: 0, atMs: 0, reason: 'initial', phase: 'awaiting_guess1', waiting: false, hidden: false, attempt: 1, scoreHash: scoreHash(score), positionMs: 0, playing: false, mode: 'motion', replay: false, submissionRequestId: null };
  const states = [initial];
  const append = (atMs: number, change: Partial<CaptureTraceState>) => states.push({ ...states.at(-1)!, ...change, atMs, seq: states.length });
  append(100, { reason: 'play', playing: true });
  append(1100, { reason: 'pause', playing: false, positionMs: 1000 });
  append(4100, { reason: 'play', playing: true });
  append(11100, { reason: 'complete', playing: false, positionMs: 8000 });
  append(11500, { reason: 'submission', phase: 'generating_act2', waiting: true, submissionRequestId: requestId });
  append(13500, { reason: 'phase', phase: 'awaiting_guess2', waiting: false });
  append(14000, { reason: 'play', attempt: 2, positionMs: 0, playing: true });
  append(22000, { reason: 'complete', positionMs: 8000, playing: false });
  append(23000, { reason: 'submission', submissionRequestId: finalSubmissionRequestId });
  append(23100, { reason: 'reveal', phase: 'revealed' });
  return { requestId, documentId: id, states };
}
const input = { requestId, roundId: id, includeGuessText: false, timing: 'original' as const, shortenedWaitMs: null };
function bundle(r: CaptureRecord) { const result = buildCapture(r, input); if ('error' in result) throw Error(result.error.code); return result; }

describe('creator capture timing', () => {
  it('keeps observed pause duration separate from generation duration', () => {
    const r = record(); r.trace = trace(); const m = bundle(r).manifest;
    expect(m.timelineBasis).toBe('observed_creator_trace'); expect(m.actualWaitMs).toBe(2000); expect(m.serverGenerationMs).toBe(1200);
    expect(m.actualTimeline?.[2]).toMatchObject({ playing: false, positionMs: 1000, durationMs: 3000 });
    expect(m.exportedTimeline).toEqual(m.actualTimeline);
  });
  it('preserves unequal frame holds and backwards steps', () => {
    const r = record(); r.trace = trace();
    Object.assign(r.trace.states[1], { mode: 'frame_step', reason: 'step', playing: false, positionMs: 900 });
    Object.assign(r.trace.states[2], { mode: 'frame_step', reason: 'step', playing: false, positionMs: 1650 });
    Object.assign(r.trace.states[3], { mode: 'frame_step', reason: 'step', playing: false, positionMs: 900 });
    const t = bundle(r).manifest.exportedTimeline;
    expect(t.slice(1, 4).map(s => [s.durationMs, s.kind === 'observed' && s.positionMs])).toEqual([[1000, 900], [3000, 1650], [7000, 900]]);
  });
  it('preserves first-act replay concurrent with waiting and refuses a destructive wait cut', () => {
    const r = record(); r.trace = trace(); Object.assign(r.trace.states[5], { playing: true, positionMs: 0, replay: true });
    const t = bundle(r).manifest.exportedTimeline[5]; expect(t).toMatchObject({ waiting: true, playing: true, attempt: 1, replay: true, durationMs: 2000 });
    expect(captureTiming(r).canShortenWait).toBe(false);
    expect(buildCapture(r, { ...input, timing: 'shortened_wait', shortenedWaitMs: 0 })).toMatchObject({ error: { code: 'INVALID_INPUT' } });
  });
  it('shortens only an unoccupied observed wait and records exact cuts', () => {
    const r = record(); r.trace = trace(); const result = buildCapture(r, { ...input, timing: 'shortened_wait', shortenedWaitMs: 250 });
    expect(result).toHaveProperty('manifest.editRanges', [{ segment: 5, actualDurationMs: 2000, exportedDurationMs: 250 }]);
  });
  it('missing, refreshed and truncated traces explicitly reconstruct scores without actual timing', () => {
    for (const t of [undefined, { ...trace(), states: trace().states.slice(1) }, { ...trace(), states: trace().states.slice(0, -1) }]) {
      const r = record(); r.trace = t; const m = bundle(r).manifest;
      expect(m.timelineBasis).toBe('score_reconstruction'); expect(m.actualTimeline).toBeNull(); expect(m.actualWaitMs).toBeNull(); expect(m.serverGenerationMs).toBe(1200); expect(m.presentationDwellMs).toEqual({ guess: 1500, reveal: 1500 });
      expect(captureTiming(r).canShortenWait).toBe(false);
    }
  });
  it('rejects noncontiguous, backwards, wrong-score, excess and unknown-field traces', () => {
    const mutations = [(t: CaptureTrace) => { t.states[1].seq++; }, (t: CaptureTrace) => { t.states[2].atMs = 0; }, (t: CaptureTrace) => { t.states[1].scoreHash = 'a'.repeat(64); }, (t: CaptureTrace) => { Object.assign(t.states[0], { target: 'secret' }); }, (t: CaptureTrace) => { t.states.push(...Array(256).fill(t.states[0])); }];
    for (const mutate of mutations) { const t = trace(); mutate(t); expect(validCaptureTrace(t, record().round)).toBe(false); }
  });
  it.each(['AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', '11111111-1111-7111-8111-111111111111'])('rejects a non-lowercase-v4 trace UUID: %s', documentId => {
    const t = trace(); t.documentId = documentId; expect(validCaptureTrace(t, record().round)).toBe(false);
  });
  it('rejects phase regressions and waiting outside generation before storing a trace', () => {
    const mutations = [(t: CaptureTrace) => { t.states[7].phase = 'generating_act2'; }, (t: CaptureTrace) => { t.states[6].waiting = true; }, (t: CaptureTrace) => { t.states[6].phase = 'awaiting_guess1'; }];
    for (const mutate of mutations) {
      const t = trace(); mutate(t); const store = new CaptureTraceStore();
      const r = { public: record().round, ownerId: 'owner', creatorOwned: true, studySessionId: null, submissionRequestId: requestId } as InternalRound;
      expect(validCaptureTrace(t, r.public)).toBe(false);
      expect(store.submit(r, 'owner', t, finalSubmissionRequestId)).toMatchObject({ error: { code: 'INVALID_INPUT' } }); expect(store.read(id)).toBeNull();
    }
  });
  it('binds the final submission marker to the accepted final-guess request', () => {
    const store = new CaptureTraceStore(); const r = { public: record().round, ownerId: 'owner', creatorOwned: true, studySessionId: null, submissionRequestId: requestId } as InternalRound;
    expect(store.submit(r, 'owner', trace(), null)).toMatchObject({ error: { code: 'INVALID_INPUT' } }); expect(store.read(id)).toBeNull();
    expect(store.submit(r, 'owner', trace(), id)).toMatchObject({ error: { code: 'INVALID_INPUT' } }); expect(store.read(id)).toBeNull();
    const wrong = trace(); wrong.states[9].submissionRequestId = requestId;
    expect(store.submit(r, 'owner', wrong, finalSubmissionRequestId)).toMatchObject({ error: { code: 'INVALID_INPUT' } }); expect(store.read(id)).toBeNull();
    expect(store.submit(r, 'owner', trace(), finalSubmissionRequestId)).toEqual({ accepted: true });
  });
  it('accepts one sealed trace only for its creator-owned nonstudy round and submission', () => {
    const store = new CaptureTraceStore(); const r = { public: record().round, ownerId: 'owner', creatorOwned: true, studySessionId: null, submissionRequestId: requestId } as InternalRound;
    expect(store.submit(r, 'foreign', trace(), finalSubmissionRequestId)).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(store.submit({ ...r, studySessionId: 'study' }, 'owner', trace(), finalSubmissionRequestId)).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(store.submit({ ...r, creatorOwned: false }, 'owner', trace(), finalSubmissionRequestId)).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(store.submit({ ...r, submissionRequestId: id }, 'owner', trace(), finalSubmissionRequestId)).toMatchObject({ error: { code: 'INVALID_INPUT' } });
    expect(store.submit(r, 'owner', trace(), finalSubmissionRequestId)).toEqual({ accepted: true }); expect(store.submit(r, 'owner', trace(), finalSubmissionRequestId)).toEqual({ accepted: true });
    const changed = trace(); changed.states[1].atMs++; expect(store.submit(r, 'owner', changed, finalSubmissionRequestId)).toMatchObject({ error: { code: 'IDEMPOTENCY_CONFLICT' } });
    expect(traceTimeline(store.read(id)!)).toHaveLength(trace().states.length); store.clear([id]); expect(store.read(id)).toBeNull();
  });
});
