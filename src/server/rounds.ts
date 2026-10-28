import { randomUUID } from 'node:crypto';
import { apiError, isApiError, type ApiError, type Authorship, type CreateRound, type GenerationFailure, type GuessInput, type Phase, type PublicRound, type RoundMutation, type SessionContext } from '../shared/api.js';
import type { MotionScoreV1 } from '../shared/score.js';
import { canonicalHash } from '../shared/hash.js';
import { normalizeGuess } from '../shared/normalizeGuess.js';
import { validateScore } from '../shared/validateScore.js';
import type { Session, SessionManager } from './sessions.js';
import { uuidPattern } from './contracts.js';

export type RoundScene = { id: string; meaning: Record<string, any>; score: MotionScoreV1; scoreHash: string; authorship: Authorship };
export type DirectorResult = { ok: true; score: MotionScoreV1; scoreHash: string } | { ok: false; failure: GenerationFailure };
export type InternalRound = {
  public: PublicRound; ownerId: string; scene: RoundScene; creatorOwned: boolean;
  epoch: string | null; abort: AbortController | null; deadlineMono: number | null;
  expiresMono: number; expiredAt: number | null; submissionRequestId: string | null;
  actualWaitMs: number | null; finalSubmissionRequestId: string | null; acceptedMono: number | null; studySessionId: string | null;
  generationProfile: string; condition: string | null; timeline: any[];
  technicalActs?: { attempt: 1 | 2; scoreHash: string; durationMs: number }[];
};
type Binding = { digest: string; roundId: string; method: string; path: string };
export type StudyBridge = {
  nextRound(ownerId: string, id: string): any;
  attachRound(ownerId: string, id: string, roundId: string, plan: any): void;
  assignAfterFirstGuess(ownerId: string, id: string, roundId: string): any;
  recordRound(roundId: string, patch: any): void;
  finishRound(roundId: string): void;
};
type Options = {
  sessions: SessionManager; scene: (id: string | null, session: Session) => RoundScene;
  director: (round: InternalRound, signal: AbortSignal) => Promise<DirectorResult>;
  liveEnabled: (mode: CreateRound['mode']) => boolean; onDispose?: (roundId: string) => void; disclosureVersion?: () => string | null;
  nowWall?: () => number; nowMono?: () => number; schedule?: (fn: () => void) => void; study?: StudyBridge;
};

export class RoundService {
  private rounds = new Map<string, InternalRound>();
  private requests = new Map<string, Binding>();
  private jobs = new Map<string, string>();
  private wall: () => number; private mono: () => number;
  constructor(readonly options: Options) {
    this.wall = options.nowWall ?? Date.now; this.mono = options.nowMono ?? (() => performance.now());
  }
  internal(s: SessionContext, id: string): InternalRound | ApiError {
    if (!this.options.sessions.owner(s.sessionId)) return apiError('UNAUTHENTICATED');
    const r = this.rounds.get(id);
    if (!r || r.ownerId !== s.sessionId) return apiError('NOT_FOUND');
    this.expire(r);
    if (r.expiredAt !== null) return apiError('EXPIRED');
    return r;
  }
  private expire(r: InternalRound) {
    if (r.expiredAt === null && this.mono() >= r.expiresMono) {
      r.technicalActs = r.public.acts.map(a => ({ attempt: a.attempt, scoreHash: a.scoreHash, durationMs: a.score.durationMs }));
      this.cancel(r); this.options.onDispose?.(r.public.roundId); r.expiredAt = this.wall(); r.public.acts = []; r.public.guesses = []; r.public.reveal = null;
      r.scene = null!; r.timeline = []; r.actualWaitMs = null; r.condition = null; r.generationProfile = '';
      const owner = this.options.sessions.owner(r.ownerId); if (owner?.activeRoundId === r.public.roundId) owner.activeRoundId = null;
      if (r.studySessionId) { this.options.study?.recordRound(r.public.roundId, { row: { failure_category: 'other' }, terminal: true }); this.options.study?.finishRound(r.public.roundId); }
    }
  }
  technical(s: SessionContext, id: string): InternalRound | ApiError {
    if (!this.options.sessions.owner(s.sessionId)) return apiError('UNAUTHENTICATED');
    const r = this.rounds.get(id);
    if (!r || r.ownerId !== s.sessionId || (r.expiredAt !== null && this.wall() - r.expiredAt >= 86400000)) return apiError('NOT_FOUND');
    this.expire(r); return r;
  }
  invalidateStudy(studySessionId: string) {
    const ids: string[] = [];
    for (const [id, r] of this.rounds) if (r.studySessionId === studySessionId) {
      this.cancel(r); const owner = this.options.sessions.owner(r.ownerId);
      if (owner?.activeRoundId === id) owner.activeRoundId = null;
      this.rounds.delete(id); this.options.onDispose?.(id); ids.push(id);
      for (const [key, value] of this.requests) if (value.roundId === id) this.requests.delete(key);
    }
    return ids;
  }
  sweep() {
    for (const [id, r] of this.rounds) {
      this.expire(r);
      if (r.expiredAt !== null && this.wall() - r.expiredAt >= 86400000) {
        this.rounds.delete(id);
        for (const [key, binding] of this.requests) if (binding.roundId === id) this.requests.delete(key);
      }
    }
  }
  private snapshot(r: InternalRound): PublicRound { return structuredClone(r.public); }
  private digest(method: string, path: string, input: unknown) { return canonicalHash({ method, path, input }); }
  private replay(s: SessionContext, method: string, path: string, input: { requestId: string }) {
    const binding = this.requests.get(s.sessionId + ':' + input.requestId);
    if (!binding) return null;
    if (binding.digest !== this.digest(method, path, input)) return apiError('IDEMPOTENCY_CONFLICT', input.requestId);
    const r = this.internal(s, binding.roundId);
    return isApiError(r) ? { error: { ...r.error, requestId: input.requestId } } : this.snapshot(r);
  }
  private bind(s: SessionContext, method: string, path: string, input: { requestId: string }, r: InternalRound) {
    this.requests.set(s.sessionId + ':' + input.requestId, { digest: this.digest(method, path, input), roundId: r.public.roundId, method, path });
  }
  private touch(r: InternalRound) {
    r.public.revision++; r.public.expiresAt = new Date(this.wall() + 1800000).toISOString(); r.expiresMono = this.mono() + 1800000;
  }
  private cancel(r: InternalRound) {
    r.epoch = null; r.abort?.abort(); r.abort = null;
    if (r.public.generation?.status === 'pending') { r.public.generation.status = 'cancelled'; r.public.generation.failure = 'cancelled'; }
  }
  async create(s: SessionContext, i: CreateRound): Promise<PublicRound | ApiError> {
    return this.createAt(s, i, '/api/rounds', i, null, false);
  }
  async createCreator(s: SessionContext, i: { requestId: string; sceneId: string; creatorOwned: true; executionMode: 'fixture' | 'live' }): Promise<PublicRound | ApiError> {
    return this.createAt(s, { requestId: i.requestId, mode: 'private_play', executionMode: i.executionMode, studySessionId: null }, '/api/operator/creator-rounds', i, i.sceneId, true);
  }
  private createAt(s: SessionContext, i: CreateRound, path: string, payload: { requestId: string }, chosen: string | null, creatorOwned: boolean): PublicRound | ApiError {
    const session = this.options.sessions.owner(s.sessionId); if (!session) return apiError('UNAUTHENTICATED', i.requestId);
    const prior = this.replay(s, 'POST', path, payload); if (prior) return prior;
    this.sweep();
    if (session.activeRoundId) { const active = this.rounds.get(session.activeRoundId); if (active && active.expiredAt === null && !['revealed', 'abandoned'].includes(active.public.state)) return apiError('ACTIVE_ROUND', i.requestId); }
    if (i.executionMode === 'live' && !this.options.liveEnabled(i.mode)) return apiError('UNAVAILABLE', i.requestId);
    if (i.mode === 'private_play' && i.studySessionId !== null) return apiError('INVALID_INPUT', i.requestId);
    if (i.mode === 'private_play' && i.executionMode === 'live' && session.providerConsent !== this.options.disclosureVersion?.()) return apiError('FORBIDDEN', i.requestId);
    const activeCount = [...this.rounds.values()].filter(r => r.expiredAt === null && !['revealed', 'abandoned'].includes(r.public.state)).length;
    if (activeCount >= 100) return apiError('LIMITED', i.requestId);
    session.creates = session.creates.filter(t => this.wall() - t < 3600000);
    if (session.creates.length >= 10) return apiError('LIMITED', i.requestId);
    let plan: any = null;
    if (i.mode === 'study') {
      if (!i.studySessionId || !this.options.study) return apiError('FORBIDDEN', i.requestId);
      try { plan = this.options.study.nextRound(s.sessionId, i.studySessionId); } catch { return apiError('FORBIDDEN', i.requestId); }
      if (isApiError(plan)) return plan;
      if (plan.executionMode !== i.executionMode) return apiError('FORBIDDEN', i.requestId);
      chosen = plan.sceneId;
    }
    let scene: RoundScene;
    try { scene = this.options.scene(chosen, session); } catch { return apiError('UNAVAILABLE', i.requestId); }
    const validated = validateScore(JSON.stringify(scene.score), scene.score.actors.map(({ id, shape, color }) => ({ id, shape, color })));
    if (!validated.ok || validated.scoreHash !== scene.scoreHash) return apiError('UNAVAILABLE', i.requestId);
    const roundId = randomUUID(); const now = this.wall();
    const r: InternalRound = { ownerId: s.sessionId, scene, creatorOwned, epoch: null, abort: null, deadlineMono: null, expiresMono: this.mono() + 1800000, expiredAt: null, submissionRequestId: null, actualWaitMs: null, finalSubmissionRequestId: null, acceptedMono: null, studySessionId: i.studySessionId, generationProfile: plan?.generationProfile ?? 'runtime_informed_v1', condition: null, timeline: [], public: {
      roundId, revision: 0, expiresAt: new Date(now + 1800000).toISOString(), mode: i.mode, executionMode: i.executionMode, phase: plan?.phase ?? 'play', state: 'awaiting_guess1',
      acts: [{ attempt: 1, scoreHash: validated.scoreHash, score: validated.score, source: 'authored_fixture', authorship: scene.authorship }], guesses: [], actions: ['guess', 'skip', 'abandon'], generation: null, reveal: null,
    } };
    if (plan) {
      try { this.options.study!.attachRound(s.sessionId, i.studySessionId!, roundId, plan); this.options.study!.recordRound(roundId, { firstAct: r.public.acts[0], row: { first_animation_hash: validated.scoreHash } }); }
      catch { return apiError('UNAVAILABLE', i.requestId); }
    }
    this.rounds.set(roundId, r); this.bind(s, 'POST', path, payload, r); session.activeRoundId = roundId; session.creates.push(now);
    return this.snapshot(r);
  }
  async submitGuess(s: SessionContext, id: string, i: GuessInput): Promise<PublicRound | ApiError> {
    const guess = normalizeGuess(i.guess); if (typeof guess !== 'string') return { error: { ...guess.error, requestId: i.requestId } };
    const normalized = { ...i, guess }; const path = `/api/rounds/${id}/guesses`;
    const owner = this.internal(s, id); if (isApiError(owner)) return { error: { ...owner.error, requestId: i.requestId } };
    const prior = this.replay(s, 'POST', path, normalized); if (prior) return prior;
    const r = owner;
    if (r.public.revision !== i.revision) return apiError('STALE', i.requestId);
    const validState = i.attempt === 1 ? 'awaiting_guess1' : 'awaiting_guess2';
    if (r.public.state !== validState || r.public.guesses.length !== i.attempt - 1) return apiError('INVALID_INPUT', i.requestId);
    if (i.attempt === 2) r.finalSubmissionRequestId = i.requestId;
    r.public.guesses.push({ attempt: i.attempt, text: guess }); this.touch(r);
    if (r.studySessionId) this.options.study?.recordRound(id, { [i.attempt === 1 ? 'guess1' : 'guess2']: guess });
    if (r.studySessionId && i.attempt === 1) {
      const allocation = this.options.study?.assignAfterFirstGuess(s.sessionId, r.studySessionId, id);
      r.condition = allocation?.condition ?? null; r.generationProfile = allocation?.generationProfile ?? r.generationProfile;
    }
    this.bind(s, 'POST', path, normalized, r);
    if (i.attempt === 2) { this.reveal(r, true); return this.snapshot(r); }
    r.submissionRequestId = i.requestId;
    if (this.jobs.has(s.sessionId) || this.jobs.size >= 2) {
      r.public.state = 'unavailable'; r.public.actions = ['skip', 'abandon'];
      r.public.generation = { acceptedAt: new Date(this.wall()).toISOString(), deadlineAt: new Date(this.wall() + 15000).toISOString(), status: 'failed', failure: 'limited' };
      if (r.studySessionId) this.options.study?.recordRound(id, { row: { second_generation_status: 'provider_error', failure_category: 'provider' } });
      return this.snapshot(r);
    }
    r.public.state = 'generating_act2'; r.public.actions = ['skip', 'abandon']; r.epoch = randomUUID(); r.abort = new AbortController();
    r.deadlineMono = this.mono() + 15000; r.acceptedMono = this.mono();
    r.public.generation = { acceptedAt: new Date(this.wall()).toISOString(), deadlineAt: new Date(this.wall() + 15000).toISOString(), status: 'pending', failure: null };
    if (r.studySessionId) this.options.study?.recordRound(id, { row: { second_generation_status: 'pending' } });
    this.jobs.set(s.sessionId, r.epoch);
    const epoch = r.epoch; const signal = r.abort.signal;
    (this.options.schedule ?? (fn => { setImmediate(fn); }))(() => { void this.run(r, epoch, signal); });
    return this.snapshot(r);
  }
  private async run(r: InternalRound, epoch: string, signal: AbortSignal) {
    this.expire(r);
    if (signal.aborted || r.epoch !== epoch || r.public.state !== 'generating_act2' || r.expiredAt !== null || !this.options.sessions.owner(r.ownerId)) { if (r.epoch === epoch) this.cancel(r); if (this.jobs.get(r.ownerId) === epoch) this.jobs.delete(r.ownerId); return; }
    if (this.mono() >= r.deadlineMono!) { this.fail(r, 'deadline'); this.jobs.delete(r.ownerId); return; }
    const timeout = setTimeout(() => { if (r.epoch === epoch && r.public.state === 'generating_act2') { r.abort?.abort(); this.fail(r, 'deadline'); } }, Math.max(0, r.deadlineMono! - this.mono())); timeout.unref();
    try {
      const result = await this.options.director(r, signal);
      this.expire(r);
      if (!this.options.sessions.owner(r.ownerId)) { this.cancel(r); return; }
      if (r.epoch !== epoch || r.public.state !== 'generating_act2' || r.expiredAt !== null) return;
      if (this.mono() >= r.deadlineMono!) { this.fail(r, 'deadline'); return; }
      if (!result.ok) { this.fail(r, result.failure); return; }
      const v = validateScore(JSON.stringify(result.score), r.scene.score.actors.map(({ id, shape, color }) => ({ id, shape, color })));
      if (!v.ok || v.scoreHash !== result.scoreHash) { this.fail(r, 'invalid_output'); return; }
      r.actualWaitMs = Math.max(0, Math.round(this.mono() - r.acceptedMono!));
      r.public.acts.push({ attempt: 2, score: v.score, scoreHash: v.scoreHash, source: r.public.executionMode === 'fixture' ? 'mock_fixture' : 'runtime_generated', authorship: null });
      r.public.state = 'awaiting_guess2'; r.public.actions = ['guess', 'skip', 'abandon']; r.public.generation!.status = 'ready'; r.public.revision++;
      if (r.studySessionId) this.options.study?.recordRound(r.public.roundId, { secondAct: r.public.acts[1], row: { second_animation_hash: v.scoreHash, second_generation_status: 'ready' } });
    } catch { if (r.epoch === epoch && r.public.state === 'generating_act2') this.fail(r, signal.aborted ? 'cancelled' : 'provider_error'); }
    finally { clearTimeout(timeout); if (this.jobs.get(r.ownerId) === epoch) this.jobs.delete(r.ownerId); }
  }
  private fail(r: InternalRound, failure: GenerationFailure) {
    r.public.state = 'unavailable'; r.public.actions = ['skip', 'abandon']; r.public.generation!.status = 'failed'; r.public.generation!.failure = failure; r.public.revision++; r.epoch = null;
    if (r.studySessionId) this.options.study?.recordRound(r.public.roundId, { row: { second_generation_status: failure === 'deadline' ? 'timeout' : failure === 'invalid_output' ? 'invalid_output' : failure === 'cancelled' ? 'cancelled' : 'provider_error', failure_category: failure === 'deadline' ? 'timeout' : failure === 'invalid_output' ? 'validation' : 'provider', timeout_stage: failure === 'deadline' ? 'provider' : null, second_full_operational: false } });
  }
  private reveal(r: InternalRound, normal: boolean) {
    this.cancel(r); r.public.state = 'revealed'; r.public.actions = ['restart']; r.public.reveal = { target: r.scene.meaning.target };
    const s = this.options.sessions.owner(r.ownerId); if (s?.activeRoundId === r.public.roundId) s.activeRoundId = null;
    if (r.studySessionId) { this.options.study?.recordRound(r.public.roundId, { terminal: true, normalCompletion: normal }); this.options.study?.finishRound(r.public.roundId); }
  }
  async skip(s: SessionContext, id: string, i: RoundMutation): Promise<PublicRound | ApiError> { return this.terminal(s, id, i, 'skip'); }
  async abandon(s: SessionContext, id: string, i: RoundMutation): Promise<PublicRound | ApiError> { return this.terminal(s, id, i, 'abandon'); }
  private terminal(s: SessionContext, id: string, i: RoundMutation, kind: 'skip' | 'abandon'): PublicRound | ApiError {
    const r = this.internal(s, id); if (isApiError(r)) return { error: { ...r.error, requestId: i.requestId } };
    const path = `/api/rounds/${id}/${kind}`; const prior = this.replay(s, 'POST', path, i); if (prior) return prior;
    if (r.public.revision !== i.revision) return apiError('STALE', i.requestId);
    if (['revealed', 'abandoned'].includes(r.public.state)) return apiError('INVALID_INPUT', i.requestId);
    this.touch(r); this.bind(s, 'POST', path, i, r);
    if (r.studySessionId && kind === 'skip') this.options.study?.recordRound(id, { row: { skip_stage: r.public.guesses.length === 0 ? 'before_first_guess' : r.public.state === 'generating_act2' || r.public.state === 'unavailable' ? 'waiting_second' : 'before_second_guess' } });
    if (kind === 'skip') this.reveal(r, false);
    else { this.cancel(r); r.public.state = 'abandoned'; r.public.acts = []; r.public.guesses = []; r.public.reveal = null; r.public.actions = ['restart']; const session = this.options.sessions.owner(s.sessionId); if (session?.activeRoundId === id) session.activeRoundId = null; if (r.studySessionId) { this.options.study?.recordRound(id, { terminal: true, normalCompletion: false }); this.options.study?.finishRound(id); } }
    return this.snapshot(r);
  }
  async read(s: SessionContext, id: string): Promise<PublicRound | ApiError> { const r = this.internal(s, id); return isApiError(r) ? r : this.snapshot(r); }
  async readCreateRequest(s: SessionContext, requestId: string): Promise<PublicRound | ApiError> {
    const b = this.requests.get(s.sessionId + ':' + requestId);
    if (!b || !['/api/rounds', '/api/operator/creator-rounds'].includes(b.path)) return this.options.sessions.owner(s.sessionId) ? apiError('NOT_FOUND', requestId) : apiError('UNAUTHENTICATED', requestId);
    return this.read(s, b.roundId);
  }
  async readMutationRequest(s: SessionContext, id: string, requestId: string): Promise<{ accepted: true; round: PublicRound } | ApiError> {
    const r = this.internal(s, id); if (isApiError(r)) return r;
    const b = this.requests.get(s.sessionId + ':' + requestId);
    if (!b || b.roundId !== id || !/\/(guesses|skip|abandon)$/.test(b.path)) return apiError('NOT_FOUND', requestId);
    return { accepted: true, round: this.snapshot(r) };
  }
  async readMutationRequestStatus(s: SessionContext, id: string, requestId: string): Promise<{ accepted: boolean } | ApiError> {
    if (!this.options.sessions.owner(s.sessionId)) return apiError('UNAUTHENTICATED');
    if (!uuidPattern.test(id) || !uuidPattern.test(requestId)) return apiError('NOT_FOUND');
    const r = this.technical(s, id); if (isApiError(r)) return r;
    const b = this.requests.get(s.sessionId + ':' + requestId);
    return { accepted: !!b && b.roundId === id && b.method === 'POST' && ['/guesses', '/skip', '/abandon'].some(action => b.path === `/api/rounds/${id}${action}`) };
  }
  async readStudyCreationStatus(s: SessionContext, studySessionId: string, id: string, requestId: string): Promise<{ accepted: boolean } | ApiError> {
    if (!this.options.sessions.owner(s.sessionId)) return apiError('UNAUTHENTICATED');
    if (![studySessionId, id, requestId].every(value => uuidPattern.test(value))) return apiError('NOT_FOUND');
    const r = this.technical(s, id); if (isApiError(r)) return r;
    if (r.studySessionId !== studySessionId) return apiError('NOT_FOUND');
    const b = this.requests.get(s.sessionId + ':' + requestId);
    return { accepted: !!b && b.roundId === id && b.method === 'POST' && b.path === '/api/rounds' };
  }
  hasRequest(s: SessionContext, requestId: string) { return this.requests.has(s.sessionId + ':' + requestId); }
  shutdown() { for (const r of this.rounds.values()) { this.cancel(r); this.options.onDispose?.(r.public.roundId); } this.jobs.clear(); }
}
