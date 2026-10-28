import { apiError, isApiError, type ApiError, type SessionContext } from '../shared/api.js';
import { canonicalHash } from '../shared/hash.js';
import { matchesContract, uuidPattern } from './contracts.js';
import type { InternalRound } from './rounds.js';

type Attempt = 1 | 2;
type PlaybackMode = 'motion' | 'frame_step';
type BaseEvent = { eventId: string; clientSequence: number; elapsedMs: number | null };
type PlayReference = { attempt: Attempt; scoreHash: string; playId: string };
export type ClientEvent = BaseEvent & (
  | (PlayReference & { name: 'play_started'; playbackMode: PlaybackMode; isReplay: boolean })
  | (PlayReference & { name: 'play_completed'; playbackMode: PlaybackMode; playedElapsedMs: number })
  | (PlayReference & { name: 'playback_failed'; reason: 'validation' | 'renderer' | 'capture_unsupported' })
  | { name: 'playback_mode_changed'; playbackMode: PlaybackMode }
  | { name: 'motion_preference_observed'; reducedMotion: boolean }
  | { name: 'visibility_changed'; visibility: 'visible' | 'hidden' }
  | { name: 'client_ready'; attempt: Attempt; scoreHash: string; submissionRequestId: string; submissionElapsedMs: number | null; recovered: boolean }
  | { name: 'client_deadline'; submissionRequestId: string; deadlineMs: 15000 }
  | { name: 'client_clock_uncertain'; submissionRequestId: string; reason: 'reload_pending' | 'wall_clock_discontinuity' }
);
export type EventsInput = { requestId: string; events: ClientEvent[] };
export type FeedbackInput = { requestId: string; enjoyment: number | null; helpfulness: number | null };
type EventsResult = { acceptedEventIds: string[]; duplicateEventIds: string[] };
type TechnicalAct = { attempt: Attempt; scoreHash: string; durationMs: number };
type EventRound = InternalRound & { technicalActs?: TechnicalAct[] };
type Play = PlayReference & { playbackMode: PlaybackMode; completed: boolean };
type RecordState = {
  ownerId: string; updatedAt: number; events: Map<string, string>; plays: Map<string, Play>;
  clientTimeout: boolean; clockUncertain: boolean; lateRecovery: boolean; feedback: boolean;
};
type Binding = { roundId: string; digest: string; result: EventsResult | { saved: true } };
type Options = {
  access: (s: SessionContext, id: string) => EventRound | ApiError;
  technicalAccess?: (s: SessionContext, id: string) => EventRound | ApiError;
  now?: () => number;
  study?: {
    recordEvent: (roundId: string, event: Record<string, unknown>) => void;
    recordFeedback: (roundId: string, feedback: { delight: number | null; helpfulness: number | null }) => void;
    transaction?: (effect: () => void) => void;
  };
};

export class EventService {
  private records = new Map<string, RecordState>();
  private requests = new Map<string, Binding>();
  private eventOwners = new Map<string, { roundId: string; digest: string }>();
  private playOwners = new Map<string, { ownerId: string; roundId: string }>();
  private rates = new Map<string, number[]>();
  private now: () => number;
  constructor(readonly options: Options) { this.now = options.now ?? Date.now; }
  clear(roundIds: string[]) {
    for (const id of roundIds) this.records.delete(id);
    for (const [key, binding] of this.requests) if (roundIds.includes(binding.roundId)) this.requests.delete(key);
    for (const [key, event] of this.eventOwners) if (roundIds.includes(event.roundId)) this.eventOwners.delete(key);
    for (const [key, play] of this.playOwners) if (roundIds.includes(play.roundId)) this.playOwners.delete(key);
  }
  sweep() {
    const now = this.now();
    this.clear([...this.records].filter(([, record]) => now - record.updatedAt >= 86400000).map(([id]) => id));
    for (const [id, timestamps] of this.rates) {
      const recent = timestamps.filter(at => now - at < 60000);
      if (recent.length) this.rates.set(id, recent); else this.rates.delete(id);
    }
  }
  private record(ownerId: string): RecordState {
    return { ownerId, updatedAt: this.now(), events: new Map(), plays: new Map(), clientTimeout: false, clockUncertain: false, lateRecovery: false, feedback: false };
  }
  private requestId(input: unknown): string | null {
    const id = input && typeof input === 'object' && 'requestId' in input ? input.requestId : null;
    return typeof id === 'string' && uuidPattern.test(id) ? id : null;
  }
  private valid(name: string, input: unknown, maxBytes: number) {
    try { return matchesContract(name, input) && Buffer.byteLength(JSON.stringify(input), 'utf8') <= maxBytes; } catch { return false; }
  }
  private access(s: SessionContext, id: string, late: boolean) {
    const round = this.options.access(s, id);
    if (late && isApiError(round) && round.error.code === 'EXPIRED' && this.options.technicalAccess) return this.options.technicalAccess(s, id);
    return round;
  }
  private replay(s: SessionContext, id: string, requestId: string, digest: string) {
    const binding = this.requests.get(s.sessionId + ':' + requestId);
    if (!binding) return null;
    return binding.roundId === id && binding.digest === digest ? structuredClone(binding.result) : apiError('IDEMPOTENCY_CONFLICT', requestId);
  }
  submit(s: SessionContext, id: string, input: unknown): EventsResult | ApiError {
    const round = this.access(s, id, true);
    const requestId = this.requestId(input);
    if (isApiError(round)) return { error: { ...round.error, requestId } };
    if (!this.valid('EventsInput', input, 16384)) return apiError('INVALID_INPUT', requestId);
    const payload = input as EventsInput;
    const digest = canonicalHash({ method: 'POST', path: `/api/rounds/${id}/events`, input: payload });
    this.sweep();
    const prior = this.replay(s, id, payload.requestId, digest);
    if (prior) return prior as EventsResult | ApiError;
    const existing = this.records.get(id) ?? this.record(s.sessionId);
    const next = structuredClone(existing);
    const accepted: ClientEvent[] = []; const duplicateEventIds: string[] = [];
    const candidates = new Map<string, string>();
    for (const event of payload.events) {
      const eventDigest = canonicalHash(event);
      const binding = this.eventOwners.get(s.sessionId + ':' + event.eventId);
      const previous = binding?.digest ?? candidates.get(event.eventId);
      if (binding && binding.roundId !== id || previous && previous !== eventDigest) return apiError('IDEMPOTENCY_CONFLICT', requestId);
      if (previous) duplicateEventIds.push(event.eventId);
      else { candidates.set(event.eventId, eventDigest); accepted.push(event); }
    }
    const late = round.expiredAt !== null;
    const acts = late ? round.technicalActs ?? [] : round.public.acts.map(act => ({ attempt: act.attempt, scoreHash: act.scoreHash, durationMs: act.score.durationMs }));
    const actFor = (event: { attempt: Attempt; scoreHash: string }) => acts.find(act => act.attempt === event.attempt && act.scoreHash === event.scoreHash);
    // Resolve starts before completions so delivery order does not change a valid batch.
    for (const event of accepted) {
      if (late && !['client_ready', 'client_deadline', 'client_clock_uncertain'].includes(event.name)) return apiError('INVALID_INPUT', requestId);
      if ('submissionRequestId' in event && (!round.submissionRequestId || event.submissionRequestId !== round.submissionRequestId)) return apiError('INVALID_INPUT', requestId);
      if (event.name === 'client_ready' && (event.attempt !== 2 || !actFor(event))) return apiError('INVALID_INPUT', requestId);
      if ('playId' in event && !actFor(event)) return apiError('INVALID_INPUT', requestId);
      if (event.name === 'play_started') {
        const owner = this.playOwners.get(event.playId);
        if (owner && (owner.ownerId !== s.sessionId || owner.roundId !== id)) return apiError('INVALID_INPUT', requestId);
        const play = next.plays.get(event.playId);
        if (play && (play.attempt !== event.attempt || play.scoreHash !== event.scoreHash || play.playbackMode !== event.playbackMode)) return apiError('INVALID_INPUT', requestId);
        if (!play) next.plays.set(event.playId, { attempt: event.attempt, scoreHash: event.scoreHash, playId: event.playId, playbackMode: event.playbackMode, completed: false });
      }
    }
    for (const event of accepted) {
      if (event.name === 'play_completed' || event.name === 'playback_failed') {
        const play = next.plays.get(event.playId);
        if (!play || play.attempt !== event.attempt || play.scoreHash !== event.scoreHash) return apiError('INVALID_INPUT', requestId);
        if (event.name === 'play_completed') {
          if (play.playbackMode !== event.playbackMode || event.playedElapsedMs !== actFor(event)!.durationMs) return apiError('INVALID_INPUT', requestId);
          play.completed = true;
        }
      }
      if (event.name === 'client_deadline') next.clientTimeout = true;
      if (event.name === 'client_clock_uncertain') next.clockUncertain = true;
      if (event.name === 'client_ready' && event.recovered) next.lateRecovery = true;
    }
    const now = this.now(); const recent = (this.rates.get(s.sessionId) ?? []).filter(at => now - at < 60000);
    if (accepted.length && (recent.length + accepted.length > 120 || existing.events.size + accepted.length > 500 || this.eventOwners.size + accepted.length > 10000)) return apiError('LIMITED', requestId);
    if (this.requests.size >= 10000) return apiError('LIMITED', requestId);
    if (round.studySessionId && accepted.length && this.options.study) {
      const effect = () => {
        for (const event of accepted.filter(event => event.name === 'play_started')) this.options.study!.recordEvent(id, event);
        for (const event of accepted.filter(event => event.name !== 'play_started')) this.options.study!.recordEvent(id, event);
      };
      try { if (this.options.study.transaction) this.options.study.transaction(effect); else effect(); }
      catch { return apiError('UNAVAILABLE', requestId); }
    }
    for (const event of accepted) {
      const eventDigest = candidates.get(event.eventId)!;
      next.events.set(event.eventId, eventDigest);
      this.eventOwners.set(s.sessionId + ':' + event.eventId, { roundId: id, digest: eventDigest });
      if (event.name === 'play_started') this.playOwners.set(event.playId, { ownerId: s.sessionId, roundId: id });
    }
    if (accepted.length) { next.updatedAt = late ? round.expiredAt! : now; this.rates.set(s.sessionId, [...recent, ...accepted.map(() => now)]); }
    this.records.set(id, next);
    const result = { acceptedEventIds: accepted.map(event => event.eventId), duplicateEventIds };
    this.requests.set(s.sessionId + ':' + payload.requestId, { roundId: id, digest, result: structuredClone(result) });
    return result;
  }
  feedbackStatus(s: SessionContext, id: string): { saved: boolean; secondActCompletionRecorded: boolean } | ApiError {
    const round = this.access(s, id, false);
    if (isApiError(round)) return round;
    const second = round.public.acts.find(act => act.attempt === 2);
    const secondActCompletionRecorded = !!second && this.completedViews(id).some(play => play.attempt === 2 && play.scoreHash === second.scoreHash);
    return { saved: this.records.get(id)?.feedback ?? false, secondActCompletionRecorded };
  }
  feedback(s: SessionContext, id: string, input: unknown): { saved: true } | ApiError {
    const round = this.access(s, id, false); const requestId = this.requestId(input);
    if (isApiError(round)) return { error: { ...round.error, requestId } };
    if (!this.valid('FeedbackInput', input, 4096)) return apiError('INVALID_INPUT', requestId);
    const payload = input as FeedbackInput;
    const digest = canonicalHash({ method: 'POST', path: `/api/rounds/${id}/feedback`, input: payload });
    this.sweep();
    const prior = this.replay(s, id, payload.requestId, digest);
    if (prior) return prior as { saved: true } | ApiError;
    const record = this.records.get(id) ?? this.record(s.sessionId);
    if (round.public.state !== 'revealed' || record.feedback) return apiError('INVALID_INPUT', requestId);
    if (this.requests.size >= 10000) return apiError('LIMITED', requestId);
    try { if (round.studySessionId) this.options.study?.recordFeedback(id, { delight: payload.enjoyment, helpfulness: payload.helpfulness }); }
    catch { return apiError('UNAVAILABLE', requestId); }
    record.feedback = true; record.updatedAt = this.now(); this.records.set(id, record);
    const result = { saved: true as const };
    this.requests.set(s.sessionId + ':' + payload.requestId, { roundId: id, digest, result });
    return result;
  }
  private completedViews(id: string) { return [...this.records.get(id)?.plays.values() ?? []].filter(play => play.completed).map(({ completed, ...play }) => play); }
  observations(id: string) {
    this.sweep();
    const record = this.records.get(id); const counts = { 1: 0, 2: 0 };
    return {
      playbackObservations: [...record?.plays.values() ?? []].map(play => ({ attempt: play.attempt, mode: play.playbackMode === 'motion' ? 'full_motion' as const : 'frame_step' as const, speed: 1, replay: counts[play.attempt]++ > 0 })),
      operationalOutcome: { clientTimeout: record?.clientTimeout ?? false, clockUncertain: record?.clockUncertain ?? false, lateRecovery: record?.lateRecovery ?? false },
      completedPlays: [...record?.plays.values() ?? []].filter(play => play.completed && play.playbackMode === 'motion').map(({ completed, ...play }) => play),
      completedViews: this.completedViews(id),
    };
  }
}
