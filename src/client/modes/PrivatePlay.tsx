import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { PendingCreationV1, PendingMutationV1, PublicRound, RoundRecoveryV1 } from '../../shared/api.js';
import { normalizeGuess } from '../../shared/normalizeGuess.js';
import { checkedRound, checkedRequestStatus, checkedEventReceipt, HttpFailure, request } from '../api.js';
import { RecoveryStore, inspectTiming } from '../recoveryStore.js';
import { ScoreComparison } from '../components/ScoreComparison.js';
import { Stage } from '../Stage.js';
import type { CaptureTrace, CaptureTraceState } from '../../server/operator/captureTrace.js';
import { useLocalConnection } from '../useLocalConnection.js';
import { usePlayback } from '../usePlayback.js';

type Props = { liveAvailable: boolean; disclosureVersion: string | null; operator: boolean; studySessionId?: string; executionMode?: 'fixture' | 'live'; canCreate?: boolean; onTerminal?: (round: PublicRound) => void; onExpired?: () => void; onDiscard?: () => void; onRecoveryPending?: (pending: boolean) => void; onSecondViewed?: (roundId: string) => void; onSecondViewStatus?: (roundId: string, status: 'pending' | 'unavailable') => void; terminalContent?: ReactNode; welcomeContent?: ReactNode; studyContent?: ReactNode; optionalExtra?: boolean; onFinishOptional?: () => void; finishingOptional?: boolean };
const blankRecovery = (roundId: string): RoundRecoveryV1 => ({ version: 1, roundId, clientTimeout: false, clockUncertain: false, timeoutEventId: null, clockUncertainEventId: null });
const failureText = (e: unknown) => e instanceof Error && e.message === 'STUDY_UNCONFIRMED' ? 'The expired round’s study identity still needs confirmation. Check result to verify it before continuing.' : e instanceof Error && e.message === 'PREVIOUS_ROUND_UNCONFIRMED' ? 'The preceding round could not be checked. Its saved request is unchanged. Check the result before continuing.' : e instanceof Error && e.message === 'STUDY_MISMATCH' ? 'The saved round belongs to another session. Return to Play or its original study to finish or check it.' : e instanceof Error && e.message === 'MODE_MISMATCH' ? 'A round in another mode is still active. Return to that mode and finish it before starting here.' : e instanceof HttpFailure && e.code === 'LIMITED' ? 'Local round capacity has been reached. This session allows 10 round starts per hour across all modes. Finish here or try again later.' : e instanceof HttpFailure && e.status === 410 ? 'This round expired.' : e instanceof HttpFailure && e.status === 401 ? 'The local session ended. Discard the old request before starting again.' : 'The local server could not be reached. Check the connection, then try again.';

export function PrivatePlay(props: Props) {
  const [round, setRound] = useState<PublicRound | null>(null); const roundRef = useRef<PublicRound | null>(null);
  const [error, setError] = useState(''); const [timing, setTiming] = useState<RoundRecoveryV1 | null>(null); const timingRef = useRef<RoundRecoveryV1 | null>(null);
  const [pendingRecovery, setPendingRecovery] = useState(false); const { offline, recheck } = useLocalConnection(); const [ownershipLost, setOwnershipLost] = useState(false); const [expired, setExpired] = useState(false); const [busy, setBusy] = useState(true); const [finished, setFinished] = useState(false); const [consented, setConsented] = useState(false); const [elapsedWait, setElapsedWait] = useState(0);
  const trace = useRef<CaptureTrace | null>(null); const traceOrigin = useRef(0); const [traceSaving, setTraceSaving] = useState(false); const [traceLost, setTraceLost] = useState(false);
  const traceRound = useRef<string | null>(null);
  const observeCapture = useCallback((change: Partial<CaptureTraceState> & { reason: CaptureTraceState['reason'] }) => {
    const recording = trace.current; if (!recording || recording.states.at(-1)?.reason === 'reveal') return;
    if (recording.states.length >= 255 && change.reason !== 'reveal') { trace.current = null; setTraceLost(true); return; }
    const previous = recording.states.at(-1)!; const atMs = Math.round(performance.now() - traceOrigin.current);
    const act = roundRef.current?.acts.find(a => a.attempt === previous.attempt);
    const positionMs = previous.playing ? Math.min(act?.score.durationMs ?? 10000, previous.positionMs + atMs - previous.atMs) : previous.positionMs;
    recording.states.push({ ...previous, positionMs, ...change, hidden: document.hidden, seq: recording.states.length, atMs });
    if (JSON.stringify(recording).length > 65536 || atMs > 1800000) { trace.current = null; setTraceLost(true); }
  }, []);
  const guidedRound = useRef<string | null>(null); const [guideDismissed, setGuideDismissed] = useState(false);
  const [creationMissing, setCreationMissing] = useState(false);
  const store = useRef<RecoveryStore | null>(null); const mutation = useRef<PendingMutationV1 | null>(null); const originMono = useRef<number | null>(null); const navEpoch = useRef(0); const initialized = useRef(false);
  const eventQueue = useRef<any[]>([]); const flushing = useRef(false); const sequence = useRef(0); const loadedAt = useRef(performance.now()); const notifiedTerminal = useRef<string | null>(null);
  const submissionController = useRef<AbortController | null>(null); const submissionTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const studyRoundId = useRef<string | null>(null);
  const acknowledgedEvents = useRef(new Set<string>());
  const timingObservations = useRef(new Map<string, string>());
  const rejectedSubmissions = useRef(new Set<string>());
  const reloadedTiming = useRef(false);
  const acceptedMutation = useRef<string | null>(null);
  const expiryConfirmed = useRef(false);
  function timingPending() { const r = timingRef.current; if (mutation.current?.kind !== 'guess1' || mutation.current.roundId !== r?.roundId) return false; return [r.timeoutEventId, r.clockUncertainEventId].some(id => id && !acknowledgedEvents.current.has(id)); }
  function clearAcceptedMutation() { if (mutation.current?.requestId === acceptedMutation.current && (expiryConfirmed.current || roundRef.current?.state !== 'generating_act2') && !timingPending()) { store.current!.clear('mutation'); mutation.current = null; originMono.current = null; setPendingRecovery(false); } }
  function clearRejectedMutation(m: PendingMutationV1) {
    if (trace.current) { trace.current = null; setTraceLost(true); } rejectedSubmissions.current.add(m.requestId); eventQueue.current = eventQueue.current.filter(event => event.submissionRequestId !== m.requestId);
    if (m.kind === 'guess1') { const flags = blankRecovery(m.roundId); store.current!.write('recovery', flags); timingRef.current = flags; setTiming(flags); }
    store.current!.clear('mutation'); mutation.current = null; originMono.current = null; setPendingRecovery(false);
  }
  function markExpired() { if (props.studySessionId && studyRoundId.current !== (mutation.current?.roundId ?? timingRef.current?.roundId ?? roundRef.current?.roundId)) { setPendingRecovery(true); setError(!mutation.current && !timingRef.current && !roundRef.current ? 'This round expired before it could be restored. Choose Discard pending request to refresh your study progress. The expired encounter stays recorded.' : failureText(new Error('STUDY_UNCONFIRMED'))); return; } expiryConfirmed.current = true; setExpired(true); setPendingRecovery(mutation.current !== null || timingPending()); props.onExpired?.(); clearAcceptedMutation(); }
  useEffect(() => { props.onRecoveryPending?.(pendingRecovery || timingPending()); }, [pendingRecovery, timing, props.onRecoveryPending]);
  function checkCreationStudy(c: PendingCreationV1 | null) { if (props.studySessionId && (!c || c.mode !== 'study' || c.studySessionId !== props.studySessionId)) throw new Error('STUDY_MISMATCH'); }
  const reconcileCompletedPrivateRound = useCallback(async (epoch: number) => {
    if (!props.studySessionId || store.current!.read('creation') || store.current!.read('mutation')) return false;
    const recovery = store.current!.read('recovery'); if (!recovery) return false;
    let snapshot: PublicRound;
    try { snapshot = checkedRound(await request<PublicRound>(`/api/rounds/${recovery.roundId}`)); }
    catch { throw new Error('PREVIOUS_ROUND_UNCONFIRMED'); }
    if (epoch !== navEpoch.current || snapshot.roundId !== recovery.roundId || snapshot.mode !== 'private_play' || !['revealed', 'abandoned'].includes(snapshot.state)) return false;
    if (store.current!.read('creation') || store.current!.read('mutation') || JSON.stringify(store.current!.read('recovery')) !== JSON.stringify(recovery)) return false;
    store.current!.clear('recovery'); return true;
  }, [props.studySessionId]);
  const bindStudyRecovery = useCallback(async (explicit = false) => {
    if (!props.studySessionId) return;
    const c = store.current!.read('creation'); checkCreationStudy(c);
    let snapshot: PublicRound;
    try { snapshot = checkedRound(await request(`/api/round-requests/${c!.requestId}`)); }
    catch (e) {
      if (e instanceof HttpFailure && e.status === 404) throw new Error('STUDY_MISMATCH');
      if (e instanceof HttpFailure && e.status === 410) {
        const m = store.current!.read('mutation'), r = store.current!.read('recovery'), id = m?.roundId ?? r?.roundId;
        if (!id || r && r.roundId !== id) throw new Error('STUDY_MISMATCH');
        if (!explicit) throw new Error('STUDY_UNCONFIRMED');
        let status: { accepted: boolean };
        try { status = checkedRequestStatus(await request(`/api/study-sessions/${props.studySessionId}/rounds/${id}/creation-requests/${c!.requestId}/status`)); }
        catch (failure) { if (failure instanceof HttpFailure && failure.status === 404) throw new Error('STUDY_MISMATCH'); throw failure; }
        if (!status.accepted) throw new Error('STUDY_MISMATCH');
        studyRoundId.current = id;
      }
      throw e;
    }
    for (const id of [store.current!.read('mutation')?.roundId, store.current!.read('recovery')?.roundId]) if (id && id !== snapshot.roundId) throw new Error('STUDY_MISMATCH');
    studyRoundId.current = snapshot.roundId;
  }, [props.studySessionId]);
  const apply = useCallback((snapshot: PublicRound) => {
    const valid = checkedRound(snapshot); if (!props.studySessionId && valid.executionMode === 'fixture' && guidedRound.current === null) guidedRound.current = valid.roundId; if (valid.mode !== (props.studySessionId ? 'study' : 'private_play')) throw new Error('MODE_MISMATCH'); if (props.studySessionId) { checkCreationStudy(store.current!.read('creation')); if (studyRoundId.current !== valid.roundId) throw new Error('STUDY_MISMATCH'); } roundRef.current = valid; setOwnershipLost(false);
    if (traceRound.current !== valid.roundId) {
      traceRound.current = valid.roundId; trace.current = null; setTraceLost(false);
      if (props.operator && !props.studySessionId && valid.state === 'awaiting_guess1') {
        try { if (sessionStorage.getItem('tm.creator-trace-start') === valid.roundId) {
          sessionStorage.removeItem('tm.creator-trace-start'); traceOrigin.current = performance.now();
          trace.current = { requestId: crypto.randomUUID(), documentId: crypto.randomUUID(), states: [{ seq: 0, atMs: 0, reason: 'initial', phase: 'awaiting_guess1', waiting: false, hidden: document.hidden, attempt: 1, scoreHash: valid.acts[0].scoreHash, positionMs: 0, playing: false, mode: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'frame_step' : 'motion', replay: false, submissionRequestId: null }] };
        } } catch { setTraceLost(true); }
      }
    } else if (trace.current && valid.state !== 'abandoned') {
      const reveal = valid.state === 'revealed';
      observeCapture({ reason: reveal ? 'reveal' : 'phase', phase: valid.state, waiting: valid.state === 'generating_act2' && !timingRef.current?.clientTimeout && !timingRef.current?.clockUncertain, ...(reveal ? { playing: false } : {}) });
      if (reveal) {
        const sealed = trace.current; trace.current = null; if (sealed) { setTraceSaving(true);
        void request(`/api/operator/creator-rounds/${valid.roundId}/capture-trace`, sealed).catch(() => { if (traceRound.current === valid.roundId) setTraceLost(true); }).finally(() => { if (traceRound.current === valid.roundId) setTraceSaving(false); }); }
      }
    }
    setRound(valid); setExpired(false); expiryConfirmed.current = false;
    const existing = timingRef.current?.roundId === valid.roundId ? timingRef.current : blankRecovery(valid.roundId);
    timingRef.current = existing; setTiming(existing); store.current!.write('recovery', existing);
    if (['revealed', 'abandoned'].includes(valid.state) && notifiedTerminal.current !== valid.roundId) { notifiedTerminal.current = valid.roundId; props.onTerminal?.(valid); }
  }, [props.onTerminal, props.studySessionId, props.operator, observeCapture]);
  const flushEvents = useCallback(async () => {
    const id = roundRef.current?.roundId ?? (expiryConfirmed.current ? mutation.current?.roundId : null);
    if (flushing.current || offline || !id || !eventQueue.current.length) return;
    flushing.current = true;
    try {
      for (let batches = 0; batches < 25 && !offline && (roundRef.current?.roundId ?? mutation.current?.roundId) === id && eventQueue.current.length; batches++) {
        const technical = (event: any) => ['client_deadline', 'client_clock_uncertain', 'client_ready'].includes(event.name);
        const hasTiming = eventQueue.current.some(technical);
        const batch = eventQueue.current.filter(event => technical(event) === hasTiming).slice(0, 20);
        const ids = new Set(batch.map(event => event.eventId)); eventQueue.current = eventQueue.current.filter(event => !ids.has(event.eventId));
        try { const result = checkedEventReceipt(await request(`/api/rounds/${id}/events`, { requestId: crypto.randomUUID(), events: batch })); for (const eventId of [...result.acceptedEventIds, ...result.duplicateEventIds]) { acknowledgedEvents.current.add(eventId); const original = timingObservations.current.get(eventId); if (original) acknowledgedEvents.current.add(original); } if (batch.some(event => event.name === 'play_completed' && event.attempt === 2 && acknowledgedEvents.current.has(event.eventId))) props.onSecondViewed?.(id); if (mutation.current?.kind === 'guess1') clearAcceptedMutation(); }
        catch (e) { if (batch.some(event => event.name === 'play_completed' && event.attempt === 2)) props.onSecondViewStatus?.(id, 'unavailable'); if (!hasTiming && e instanceof HttpFailure && [400, 403, 404, 409, 410].includes(e.status)) continue; const pending = batch.filter(event => !rejectedSubmissions.current.has(event.submissionRequestId)); if ((roundRef.current?.roundId ?? mutation.current?.roundId) === id) eventQueue.current = [...pending, ...eventQueue.current]; if (pending.length !== batch.length) continue; break; }
      }
    } finally { flushing.current = false; }
  }, [offline, props.onSecondViewed, props.onSecondViewStatus]);
  useEffect(() => { if (!offline) void flushEvents(); }, [offline, flushEvents]);
  const emit = useCallback((data: any) => {
    if (data.eventId && (acknowledgedEvents.current.has(data.eventId) || eventQueue.current.some(event => event.eventId === data.eventId))) return;
    if (eventQueue.current.length >= 20 && !data.eventId) { if (data.name === 'play_completed' && data.attempt === 2 && roundRef.current) props.onSecondViewStatus?.(roundRef.current.roundId, 'unavailable'); return; }
    eventQueue.current.push({ eventId: crypto.randomUUID(), clientSequence: sequence.current++, elapsedMs: Math.min(86400000, Math.max(0, Math.round(performance.now() - loadedAt.current))), ...data }); void flushEvents();
  }, [flushEvents]);
  const preferenceRoundId = round && !expired && !['revealed', 'abandoned'].includes(round.state) ? round.roundId : null;
  useEffect(() => {
    if (!preferenceRoundId) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const observe = () => emit({ name: 'motion_preference_observed', reducedMotion: media.matches });
    observe(); media.addEventListener('change', observe);
    return () => media.removeEventListener('change', observe);
  }, [preferenceRoundId, emit]);
  const emitTiming = useCallback(() => {
    const r = timingRef.current, m = mutation.current; if (!r || m?.kind !== 'guess1') return;
    const observe = (original: string, data: any) => { if (acknowledgedEvents.current.has(original) || [...timingObservations.current.values()].includes(original)) return; const eventId = reloadedTiming.current ? crypto.randomUUID() : original; timingObservations.current.set(eventId, original); emit({ ...data, eventId, submissionRequestId: m.requestId }); };
    if (r.clientTimeout) { r.timeoutEventId ??= crypto.randomUUID(); observe(r.timeoutEventId, { name: 'client_deadline', deadlineMs: 15000 }); }
    if (r.clockUncertain) { r.clockUncertainEventId ??= crypto.randomUUID(); observe(r.clockUncertainEventId, { name: 'client_clock_uncertain', reason: reloadedTiming.current ? 'reload_pending' : 'wall_clock_discontinuity' }); }
    store.current!.write('recovery', r);
  }, [emit]);
  const tickTiming = useCallback(() => {
    const m = mutation.current; const r = timingRef.current; if (!m || m.kind !== 'guess1' || !r || originMono.current === null) return r;
    const checked = inspectTiming(m, r, originMono.current, performance.now(), Date.now()); mutation.current = checked.mutation; timingRef.current = checked.recovery;
    store.current!.write('mutation', checked.mutation); store.current!.write('recovery', checked.recovery); setTiming(checked.recovery); setElapsedWait(performance.now() - originMono.current);
    if (checked.recovery.clientTimeout || checked.recovery.clockUncertain) {
      setPendingRecovery(true);
      if (trace.current?.states.at(-1)?.waiting) observeCapture({ reason: 'phase', waiting: false });
    }
    emitTiming();
    return checked.recovery;
  }, [emitTiming, observeCapture]);
  const acceptSnapshot = useCallback((snapshot: PublicRound, explicit = false, acceptedRequestId?: string) => {
    checkedRound(snapshot);
    const flags = tickTiming() ?? timingRef.current;
    if (!explicit && snapshot.state === 'awaiting_guess2' && (flags?.clientTimeout || flags?.clockUncertain)) { setPendingRecovery(true); return; }
    apply(snapshot);
    if (acceptedRequestId && mutation.current?.requestId === acceptedRequestId) acceptedMutation.current = acceptedRequestId;
    emitTiming();
    if (snapshot.state === 'generating_act2' && (flags?.clientTimeout || flags?.clockUncertain)) setPendingRecovery(true);
    if (snapshot.state !== 'generating_act2') {
      if (['awaiting_guess2', 'revealed'].includes(snapshot.state) && snapshot.acts[1] && mutation.current?.kind === 'guess1') emit({ name: 'client_ready', attempt: 2, scoreHash: snapshot.acts[1].scoreHash, submissionRequestId: mutation.current.requestId, submissionElapsedMs: originMono.current === null ? null : Math.max(0, Math.round(performance.now() - originMono.current)), recovered: explicit });
      clearAcceptedMutation(); setPendingRecovery(mutation.current !== null || timingPending());
    }
  }, [apply, emit, tickTiming, emitTiming]);
  useEffect(() => {
    if (initialized.current) return; initialized.current = true; const epoch = ++navEpoch.current;
    void (async () => {
      try {
        store.current = new RecoveryStore(sessionStorage);
        await reconcileCompletedPrivateRound(epoch); if (epoch !== navEpoch.current) return;
        if (props.studySessionId && (store.current.read('creation') || store.current.read('mutation') || store.current.read('recovery'))) checkCreationStudy(store.current.read('creation'));
        const restored = store.current.restore(Date.now()); reloadedTiming.current = true; timingRef.current = restored.recovery; setTiming(restored.recovery); mutation.current = restored.mutation;
        if (props.studySessionId && (restored.mutation || restored.recovery)) { await bindStudyRecovery(); if (epoch !== navEpoch.current) return; }
        if (restored.mutation) {
          setPendingRecovery(true);
          if (restored.mutation.kind === 'guess1') {
            const snapshot = await request<PublicRound>(`/api/rounds/${restored.mutation.roundId}`); if (epoch !== navEpoch.current) return;
            checkedRound(snapshot);
            if (snapshot.state === 'generating_act2' || snapshot.state === 'awaiting_guess2') { apply({ ...snapshot, state: 'generating_act2', acts: snapshot.acts.slice(0, 1), actions: ['skip', 'abandon'] }); setPendingRecovery(true); }
            else acceptSnapshot(snapshot, true);
            emitTiming();
            return;
          }
          const recovered = await request(`/api/rounds/${restored.mutation.roundId}/requests/${restored.mutation.requestId}`); if (epoch === navEpoch.current) acceptSnapshot(recovered.round, true, restored.mutation.requestId); return;
        }
        if (restored.creation) {
          let snapshot: PublicRound;
          try { snapshot = await request(`/api/round-requests/${restored.creation.requestId}`); }
          catch (e) { if (!(e instanceof HttpFailure) || e.status !== 404) throw e; if (epoch === navEpoch.current) { setCreationMissing(true); setPendingRecovery(true); setError('The round creation did not arrive. Retry the same private or study request, or discard it to choose a creator scene.'); } return; }
          if (epoch === navEpoch.current) { if (props.studySessionId) studyRoundId.current = checkedRound(snapshot).roundId; apply(snapshot); if (!props.studySessionId) store.current.clear('creation'); } return;
        }
        if (restored.recovery) { const snapshot = await request<PublicRound>(`/api/rounds/${restored.recovery.roundId}`); if (epoch === navEpoch.current) apply(snapshot); return; }
        const session = await request('/api/session', {}); if (epoch !== navEpoch.current) return;
        if (session.activeRoundId) { if (props.studySessionId) throw new Error('STUDY_MISMATCH'); const snapshot = await request<PublicRound>(`/api/rounds/${session.activeRoundId}`); if (epoch === navEpoch.current) apply(snapshot); }
      } catch (e) { if (epoch !== navEpoch.current) return; setPendingRecovery(true); setError(failureText(e)); if (e instanceof HttpFailure && e.status === 410) { markExpired(); emitTiming(); void flushEvents(); } }
      finally { if (epoch === navEpoch.current) setBusy(false); }
    })();
  }, [acceptSnapshot, apply, emit, bindStudyRecovery, reconcileCompletedPrivateRound]);
  // Callback changes must not invalidate a pending request. Only leaving this player does.
  useEffect(() => () => { navEpoch.current++; submissionController.current?.abort(); if (submissionTimer.current) clearInterval(submissionTimer.current); }, []);
  useEffect(() => {
    if (!round) return;
    let checked = false, cancelled = false; const epoch = navEpoch.current;
    const current = () => !cancelled && epoch === navEpoch.current && !expiryConfirmed.current && roundRef.current?.roundId === round.roundId && roundRef.current?.revision === round.revision;
    const deadline = () => {
      if (Date.now() < Date.parse(round.expiresAt) || checked) return;
      checked = true;
      void request<PublicRound>(`/api/rounds/${round.roundId}`).then(snapshot => {
        if (!current()) return;
        acceptSnapshot(snapshot);
        setError(error => error === 'Expiry could not be confirmed. Check the result when the connection is available.' ? '' : error);
      }).catch(e => {
        if (!current()) return;
        if (e instanceof HttpFailure && e.status === 410) { markExpired(); emitTiming(); void flushEvents(); }
        else if (round.state !== 'revealed' && round.state !== 'abandoned') { if (props.studySessionId) setExpired(true); setPendingRecovery(true); setError('Expiry could not be confirmed. Check the result when the connection is available.'); }
      });
    };
    deadline(); const timer = setInterval(deadline, 1000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [round?.roundId, round?.revision, round?.expiresAt, acceptSnapshot, props.studySessionId, props.onExpired]);
  useEffect(() => {
    const online = () => { void flushEvents(); }; const hidden = () => { try { tickTiming(); } catch { setError('Recovery storage is unavailable. Check the result explicitly.'); } emit({ name: 'visibility_changed', visibility: document.hidden ? 'hidden' : 'visible' }); };
    window.addEventListener('online', online); document.addEventListener('visibilitychange', hidden); window.addEventListener('pagehide', hidden);
    return () => { window.removeEventListener('online', online); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', hidden); };
  }, [flushEvents, tickTiming, emit]);
  useEffect(() => {
    if (round?.state !== 'generating_act2' || timing?.clientTimeout || timing?.clockUncertain || pendingRecovery) return;
    let cancelled = false; let inFlight = false; const epoch = navEpoch.current;
    const interval = setInterval(() => {
      if (cancelled) return;
      try { const flags = tickTiming(); if (flags?.clientTimeout || flags?.clockUncertain) { setPendingRecovery(true); return; } }
      catch { setPendingRecovery(true); setError('Recovery storage is unavailable. Check the result explicitly.'); return; }
      if (inFlight || offline) return; inFlight = true;
      void request<PublicRound>(`/api/rounds/${round.roundId}`).then(snapshot => { if (!cancelled && epoch === navEpoch.current) acceptSnapshot(snapshot); }).catch(e => { if (!cancelled && epoch === navEpoch.current && e instanceof HttpFailure && [401, 410, 404].includes(e.status)) { setError(failureText(e)); setExpired(true); if (e.status === 410) { markExpired(); emitTiming(); void flushEvents(); } } }).finally(() => { inFlight = false; });
    }, 500);
    return () => { cancelled = true; clearInterval(interval); };
  }, [round?.roundId, round?.state, timing?.clientTimeout, timing?.clockUncertain, pendingRecovery, offline, acceptSnapshot, tickTiming]);
  async function create(mode: 'fixture' | 'live') {
    if (busy || offline || props.canCreate === false) return; setBusy(true); setError(''); navEpoch.current++; const epoch = navEpoch.current;
    try {
      if (!store.current) store.current = new RecoveryStore(sessionStorage);
      if (store.current.read('creation') || store.current.read('mutation')) throw new Error('UNRESOLVED');
      const session = await request('/api/session', {});
      if (epoch !== navEpoch.current) return;
      if (session.activeRoundId) { if (props.studySessionId) throw new Error('STUDY_MISMATCH'); const snapshot = await request<PublicRound>(`/api/rounds/${session.activeRoundId}`); if (epoch === navEpoch.current) apply(snapshot); return; }
      if (mode === 'live' && !props.studySessionId) {
        if (!consented) { setError('Choose whether to send your first guess before live play.'); return; }
        await request('/api/provider-consent', { requestId: crypto.randomUUID(), disclosureVersion: props.disclosureVersion, accepted: true });
        if (epoch !== navEpoch.current) return;
      }
      const descriptor: PendingCreationV1 = { version: 1, requestId: crypto.randomUUID(), mode: props.studySessionId ? 'study' : 'private_play', executionMode: mode, studySessionId: props.studySessionId ?? null, createdWallMs: Date.now() };
      store.current.write('creation', descriptor); store.current.clear('recovery'); timingRef.current = null; setTiming(null);
      const snapshot = await request<PublicRound>('/api/rounds', { requestId: descriptor.requestId, mode: descriptor.mode, executionMode: mode, studySessionId: descriptor.studySessionId });
      if (epoch !== navEpoch.current) return; if (props.studySessionId) studyRoundId.current = checkedRound(snapshot).roundId; apply(snapshot); if (!props.studySessionId) store.current.clear('creation'); loadedAt.current = performance.now(); sequence.current = 0; setElapsedWait(0); eventQueue.current = []; rejectedSubmissions.current.clear();
    } catch (e) { if (epoch === navEpoch.current) setError(e instanceof Error && e.message === 'UNRESOLVED' ? 'Resolve or discard the pending request before starting another scene.' : failureText(e)); }
    finally { if (epoch === navEpoch.current) setBusy(false); }
  }
  async function submit(text: string) {
    const current = roundRef.current; if (!current || offline || busy || expired) return;
    const normalized = normalizeGuess(text); if (typeof normalized !== 'string') return;
    const attempt = current.state === 'awaiting_guess1' ? 1 : 2; const now = Date.now(); const descriptor: PendingMutationV1 = { version: 1, roundId: current.roundId, requestId: crypto.randomUUID(), kind: attempt === 1 ? 'guess1' : 'guess2', revision: current.revision, submittedWallMs: now, deadlineWallMs: attempt === 1 ? now + 15000 : null, lastObservedWallMs: now, clockUncertain: false };
    const epoch = navEpoch.current;
    try {
      const old = store.current!.read('mutation'); if (old) { setError('Check the pending submission before sending another guess.'); setPendingRecovery(true); return; }
      store.current!.write('mutation', descriptor); reloadedTiming.current = false; const flags = timingRef.current ?? blankRecovery(current.roundId); store.current!.write('recovery', flags); mutation.current = descriptor; timingRef.current = flags; setTiming(flags); originMono.current = performance.now(); observeCapture({ reason: 'submission', submissionRequestId: descriptor.requestId, phase: attempt === 1 ? 'generating_act2' : 'awaiting_guess2', waiting: attempt === 1 }); setBusy(true); setError('');
      const controller = new AbortController(); submissionController.current = controller;
      const timer = setInterval(() => { if (epoch !== navEpoch.current) return; try { const f = tickTiming(); if (f?.clientTimeout || f?.clockUncertain) setPendingRecovery(true); } catch { setPendingRecovery(true); } }, 500); submissionTimer.current = timer;
      try { const snapshot = await request<PublicRound>(`/api/rounds/${current.roundId}/guesses`, { requestId: descriptor.requestId, revision: descriptor.revision, attempt, guess: normalized }, { signal: controller.signal, timeoutMs: attempt === 1 ? 15000 : 10000 }); if (epoch === navEpoch.current) acceptSnapshot(snapshot, false, descriptor.requestId); }
      finally { clearInterval(timer); if (submissionTimer.current === timer) submissionTimer.current = null; if (submissionController.current === controller) submissionController.current = null; }
    } catch (e) {
      if (epoch !== navEpoch.current) return;
      try { tickTiming(); } catch { /* The pending descriptor remains available for explicit recovery. */ }
      if (e instanceof HttpFailure && [401, 404].includes(e.status)) setOwnershipLost(true);
      if (e instanceof HttpFailure && [400, 409, 429].includes(e.status)) clearRejectedMutation(descriptor);
      else setPendingRecovery(true);
      if (e instanceof HttpFailure && e.status === 410) { markExpired(); emitTiming(); void flushEvents(); }
      if (e instanceof HttpFailure && e.status === 409) { try { const snapshot = await request<PublicRound>(`/api/rounds/${current.roundId}`); if (epoch !== navEpoch.current) return; apply(snapshot); setError('The round changed. Your draft was kept. Review the current take before sending again.'); } catch (failure) { if (epoch !== navEpoch.current) return; setPendingRecovery(true); setError(failureText(failure)); } }
      else setError(failureText(e));
    } finally { if (epoch === navEpoch.current) setBusy(false); }
  }
  async function checkExpiredMutation(epoch: number) {
    const m = mutation.current;
    if (props.studySessionId && studyRoundId.current !== (m?.roundId ?? timingRef.current?.roundId)) throw new Error('STUDY_MISMATCH');
    if (!m) { setPendingRecovery(timingPending()); return; }
    const status = checkedRequestStatus(await request(`/api/rounds/${m.roundId}/requests/${m.requestId}/status`));
    if (epoch !== navEpoch.current || mutation.current?.requestId !== m.requestId) return;
    if (!status.accepted) { clearRejectedMutation(m); setError('The pending action was not accepted before this round expired.'); return; }
    acceptedMutation.current = m.requestId; emitTiming(); await flushEvents();
    if (epoch !== navEpoch.current) return;
    clearAcceptedMutation(); setPendingRecovery(mutation.current !== null || timingPending());
    if (timingPending()) setError('The action was accepted. Its timing records still need confirmation. Check result again when the connection is available.');
  }
  async function checkResult() {
    const current = roundRef.current; const epoch = navEpoch.current; setBusy(true); setError('');
    try {
      if (await reconcileCompletedPrivateRound(epoch)) { setPendingRecovery(false); setExpired(false); return; }
      if (epoch !== navEpoch.current) return;
      const m = store.current!.read('mutation'); const c = store.current!.read('creation'); const r = store.current!.read('recovery');
      if (props.studySessionId) { checkCreationStudy(c); if (m || r) { await bindStudyRecovery(true); if (epoch !== navEpoch.current) return; } }
      emitTiming(); await flushEvents();
      if (expiryConfirmed.current) { await checkExpiredMutation(epoch); return; }
      if (c && (!props.studySessionId || !m && !r)) { try { const snapshot = await request<PublicRound>(`/api/round-requests/${c.requestId}`); if (epoch !== navEpoch.current) return; if (props.studySessionId) studyRoundId.current = checkedRound(snapshot).roundId; apply(snapshot); if (!props.studySessionId) store.current!.clear('creation'); setCreationMissing(false); setPendingRecovery(false); } catch (e) { if (e instanceof HttpFailure && e.status === 404 && epoch === navEpoch.current) { setCreationMissing(true); setPendingRecovery(true); setError('The round creation did not arrive. Retry the same private or study request, or discard it to choose a creator scene.'); return; } throw e; } }
      else if (m) {
        try { const accepted = await request(`/api/rounds/${m.roundId}/requests/${m.requestId}`); if (epoch !== navEpoch.current) return; acceptSnapshot(accepted.round, true, m.requestId); }
        catch (e) { if (epoch !== navEpoch.current) return; if (!(e instanceof HttpFailure) || e.status !== 404) throw e; const snapshot = checkedRound(await request<PublicRound>(`/api/rounds/${m.roundId}`)); if (epoch !== navEpoch.current) return; apply(snapshot); clearRejectedMutation(m); setError('The guess was not accepted. Re-enter it explicitly to submit.'); }
      } else {
        let id = current?.roundId ?? store.current!.read('recovery')?.roundId;
        if (!id) { if (props.studySessionId) throw new Error('STUDY_MISMATCH'); const session = await request('/api/session', {}); if (epoch !== navEpoch.current) return; id = session.activeRoundId; }
        if (id) { const snapshot = await request<PublicRound>(`/api/rounds/${id}`); if (epoch === navEpoch.current) acceptSnapshot(snapshot, true); }
        else if (epoch === navEpoch.current) setPendingRecovery(false);
      }
    } catch (e) {
      if (epoch !== navEpoch.current) return;
      if (e instanceof HttpFailure && e.status === 410) {
        markExpired();
        if (!expiryConfirmed.current) return;
        try { await checkExpiredMutation(epoch); }
        catch { if (epoch === navEpoch.current) { setPendingRecovery(mutation.current !== null || timingPending()); setError('This round expired. The pending action could not be confirmed. Check result again when the connection is available.'); } }
      } else { setError(failureText(e)); if (e instanceof HttpFailure && [401, 404].includes(e.status)) { setOwnershipLost(true); setExpired(true); } }
    }
    finally { if (epoch === navEpoch.current) setBusy(false); }
  }
  async function retryCreation() {
    const c = store.current?.read('creation'); if (!c || !creationMissing || offline) return;
    const epoch = ++navEpoch.current; setBusy(true); setError('');
    try { checkCreationStudy(c); store.current!.write('creation', c); const snapshot = await request<PublicRound>('/api/rounds', { requestId: c.requestId, mode: c.mode, executionMode: c.executionMode, studySessionId: c.studySessionId }); if (epoch !== navEpoch.current) return; if (props.studySessionId) studyRoundId.current = checkedRound(snapshot).roundId; apply(snapshot); if (!props.studySessionId) store.current!.clear('creation'); setCreationMissing(false); setPendingRecovery(false); }
    catch (e) { if (epoch === navEpoch.current) setError(failureText(e)); }
    finally { if (epoch === navEpoch.current) setBusy(false); }
  }
  async function mutate(kind: 'skip' | 'abandon') {
    let current = roundRef.current; if (!current || offline || expired) return; const epoch = ++navEpoch.current; submissionController.current?.abort(); setBusy(true); setError('');
    try {
      for (let retry = 0; retry < 2; retry++) {
        const now = Date.now(); const m: PendingMutationV1 = { version: 1, roundId: current.roundId, requestId: crypto.randomUUID(), kind, revision: current.revision, submittedWallMs: now, deadlineWallMs: null, lastObservedWallMs: now, clockUncertain: false };
        if (!timingPending()) { store.current!.write('mutation', m); mutation.current = m; }
        try { const snapshot = await request<PublicRound>(`/api/rounds/${current.roundId}/${kind}`, { requestId: m.requestId, revision: m.revision }); if (epoch !== navEpoch.current) return; acceptSnapshot(snapshot, true, m.requestId); if (kind === 'abandon' && !props.studySessionId) setFinished(true); return; }
        catch (e) { if (epoch !== navEpoch.current) return; if (!(e instanceof HttpFailure) || e.status !== 409 || retry === 1) throw e; current = checkedRound(await request(`/api/rounds/${current.roundId}`)); if (epoch !== navEpoch.current) return; if (current.state === 'revealed') { acceptSnapshot(current, true); return; } }
      }
    } catch (e) { if (epoch !== navEpoch.current) return; setError(failureText(e)); setPendingRecovery(true); if (e instanceof HttpFailure && [401, 404].includes(e.status)) setOwnershipLost(true); if (e instanceof HttpFailure && e.status === 410) { markExpired(); emitTiming(); void flushEvents(); } }
    finally { if (epoch === navEpoch.current) setBusy(false); }
  }
  function canDiscard() { if (!props.studySessionId) return true; try { return !!store.current && !store.current.read('mutation') && !store.current.read('recovery'); } catch { return false; } }
  function discard() { if (!canDiscard()) { setPendingRecovery(true); setError('The saved round still needs to be checked. Check result before continuing.'); return; } setOwnershipLost(false); trace.current = null; traceRound.current = null; setTraceSaving(false); navEpoch.current++; submissionController.current?.abort(); if (submissionTimer.current) clearInterval(submissionTimer.current); store.current?.discard(); mutation.current = null; originMono.current = null; timingRef.current = null; eventQueue.current = []; rejectedSubmissions.current.clear(); setTiming(null); setRound(null); roundRef.current = null; setPendingRecovery(false); setCreationMissing(false); setBusy(false); setError(''); setExpired(false); props.onDiscard?.(); }
  if (finished) return <main><h1>Thanks for playing.</h1><a tabIndex={0} className="button primary" href="/">Back to start</a></main>;
  if (!round) return <main className="play-lobby"><h1>A tiny silent scene.</h1><p className="context">{props.studySessionId ? 'Study session' : 'Private play'}</p><p className="intro">Watch two takes and tell us what you think is happening.</p><p>You can replay, reveal or stop at any time.</p><p className="secondary">This visual guessing activity requires viewing motion. You can always skip to the written reveal.</p>
    {offline && <div role="status"><p>The local server cannot be reached. No action will be sent automatically.</p><button onClick={recheck}>Check local connection</button></div>}{error && <p className="error" role="alert">{error}</p>}
    {(error || pendingRecovery) && <div className="controls"><button onClick={checkResult} disabled={busy || offline}>Check result</button>{canDiscard() && <button onClick={discard}>Discard pending request</button>}</div>}
    {creationMissing && <button className="primary" onClick={retryCreation} disabled={busy || offline}>Retry round creation</button>}
    {props.studySessionId ? <>{props.optionalExtra && <p>The extra round is optional. You can finish here.</p>}<div className="controls"><button className="primary" onClick={() => create(props.executionMode ?? 'fixture')} disabled={busy || offline || pendingRecovery || props.canCreate === false || props.finishingOptional}>Start next round</button>{props.optionalExtra && <button onClick={props.onFinishOptional} disabled={busy || offline || props.finishingOptional}>Finish</button>}</div></> : props.liveAvailable ? <><p>Your guess is sent to OpenAI to prepare the second take. Please don’t include personal information.</p><p className="secondary"><a tabIndex={0} href="https://developers.openai.com/api/docs/guides/your-data" target="_blank" rel="noreferrer">Provider data policy</a>. Sending with store=false does not promise zero provider retention.</p><label className="choice"><input type="checkbox" checked={consented} onChange={e => setConsented(e.target.checked)} />I agree to send my first guess for the second take.</label><button className="primary" disabled={!consented || busy || offline || pendingRecovery} onClick={() => create('live')}>Start a round</button></> : <section className="setup"><h2>Live second takes aren’t configured on this installation.</h2>{props.operator ? <><p>Explore the authored scenes in rehearsal, or try the two-take flow with a demo round.</p><div className="controls"><button className="primary" onClick={() => create('fixture')} disabled={busy || offline || pendingRecovery}>Try a fixture round</button><a tabIndex={0} className="button" href="/rehearsal">Open rehearsal</a></div><p className="secondary">A fixture is a prepared demo. No API key is needed. Its second take repeats the first performance and does not adapt to your guess.</p></> : <><button disabled>Start a round</button><p>Ask the facilitator to set up this session.</p><a tabIndex={0} href="/">Back</a></>}<details><summary>View setup requirements</summary><p>Live mode requires an approved exact model, supported structured output, provider disclosure, verified prices, bounded budget and securely injected configuration. Rehearsal and clearly labelled fixtures work now.</p></details></section>}
    {props.welcomeContent}{props.studyContent}
    <p className="secondary">Rounds expire after 30 minutes without starting a round or sending an accepted round action.</p><p className="secondary">This session allows 10 round starts per hour across Play, Study and Creator capture.</p><details><summary>How it works</summary><p>Two or three shapes act out a short, silent scene. Describe what you see, watch another take, then discover the intended meaning. We don’t grade your guess.</p></details></main>;
  return <Player traceSaving={traceSaving} traceLost={traceLost} observeCapture={observeCapture} guided={guidedRound.current === round.roundId && !guideDismissed} onDismissGuide={() => setGuideDismissed(true)} key={round.roundId} round={round} timing={timing} waitingMs={elapsedWait} busy={busy} offline={offline} onRecheck={recheck} onDiscard={ownershipLost && !props.studySessionId ? () => { if (window.confirm("Discard the saved request and unsent draft? This does not cancel provider work or erase recorded charges.")) { discard(); location.assign("/play"); } } : undefined} expired={expired} error={error} recovery={pendingRecovery} pendingKind={mutation.current?.kind} operator={props.operator} study={!!props.studySessionId} studyContent={props.studyContent} terminalContent={props.terminalContent} onSecondViewStatus={props.onSecondViewStatus} onSubmit={submit} onMutate={mutate} onCheck={checkResult} onAnother={() => { discard(); void create(round.executionMode); }} onFinish={() => { discard(); setFinished(true); }} emit={emit} />;
}

function Player({ traceSaving, traceLost, observeCapture, guided, onDismissGuide, round, timing, waitingMs, busy, offline, onRecheck, onDiscard, expired, error, recovery, pendingKind, operator, study, studyContent, terminalContent, onSecondViewStatus, onSubmit, onMutate, onCheck, onAnother, onFinish, emit }: any) {
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [selected, setSelected] = useState(0); const [played, setPlayed] = useState([false, false]); const [draft, setDraft] = useState(''); const [fieldError, setFieldError] = useState(''); const [intent, setIntent] = useState(false); const [both, setBoth] = useState(false); const [interAct, setInterAct] = useState(false); const [warning, setWarning] = useState(false);
  const playId = useRef<string | null>(null); const seen = useRef([0, 0]); const composing = useRef(false); const heading = useRef<HTMLHeadingElement>(null); const priorState = useRef(round.state);
  const interActTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const act = round.acts[selected] ?? round.acts[0]; const score = useMemo(() => act?.score, [act?.scoreHash, act?.attempt]);
  const p = usePlayback(score, { onTransition: state => { if (act) observeCapture({ ...state, attempt: act.attempt, scoreHash: act.scoreHash, replay: seen.current[selected] > 1 }); }, onStart: (mode) => { const id = crypto.randomUUID(); playId.current = id; emit({ name: 'play_started', attempt: act.attempt, scoreHash: act.scoreHash, playId: id, playbackMode: mode, isReplay: seen.current[selected]++ > 0 }); }, onComplete: (mode) => { if (act.attempt === 2) onSecondViewStatus?.(round.roundId, offline ? 'unavailable' : 'pending'); setPlayed(prev => prev.map((v, i) => i === selected ? true : v)); if (playId.current) emit({ name: 'play_completed', attempt: act.attempt, scoreHash: act.scoreHash, playId: playId.current, playbackMode: mode, playedElapsedMs: score.durationMs }); if (both && selected === 0 && round.acts.length === 2) { setInterAct(true); interActTimer.current = setTimeout(() => { interActTimer.current = null; setSelected(1); setIntent(true); setInterAct(false); }, 1000); } else setBoth(false); } });
  useEffect(() => { if (intent) { setIntent(false); p.play(); } }, [intent, score, p.play]);
  useEffect(() => { if (round.state === 'revealed' && priorState.current !== 'revealed') heading.current?.focus(); if (round.state === 'awaiting_guess2' && priorState.current !== 'awaiting_guess2' && round.guesses[0]?.text === normalizeGuess(draft)) { setDraft(''); setFieldError(''); } priorState.current = round.state; }, [round.state]);
  useEffect(() => () => { if (interActTimer.current) clearTimeout(interActTimer.current); }, []);
  useEffect(() => { const update = () => setWarning(Date.parse(round.expiresAt) - Date.now() <= 120000); update(); const timer = setInterval(update, 1000); return () => clearInterval(timer); }, [round.expiresAt]);
  const first = round.state === 'awaiting_guess1'; const second = round.state === 'awaiting_guess2'; const directing = round.state === 'generating_act2'; const revealed = round.state === 'revealed';
  const allowedGuess = !expired && !recovery && ((first && played[0]) || (second && played[1]));
  const count = [...draft.normalize('NFC').trim()].length;
  function cancelSequence() { setBoth(false); if (interActTimer.current) clearTimeout(interActTimer.current); interActTimer.current = null; setInterAct(false); }
  function mainPlayback() { if (interAct) { cancelSequence(); p.pause(); return; } if (p.frameMode && !(second && !played[1] && selected !== 1)) { p.step(1); return; } cancelSequence(); if (p.playing) p.pause(); else if (second && !played[1] && selected !== 1) choose(1); else p.play(); }
  function choose(index: number, replay = false, sequence = false) { if (!sequence) setBoth(false); if (!round.acts[index]) return; if (interActTimer.current) clearTimeout(interActTimer.current); interActTimer.current = null; setInterAct(false); p.pause(); if (selected === index) replay ? p.replay() : p.play(); else { setSelected(index); setIntent(true); } }
  function send() {
    if (composing.current || busy || !allowedGuess || p.playing || offline) return;
    const normalized = normalizeGuess(draft);
    if (typeof normalized !== 'string') { setFieldError(!draft.trim() ? 'Add a few words about what you saw.' : count > 240 ? 'Keep your guess to 240 characters or fewer.' : 'Use one line of text without control characters.'); return; }
    setFieldError(''); void onSubmit(draft);
  }
  const failed = recovery || round.state === 'unavailable';
  const uncertainAction = recovery && pendingKind !== 'guess1';
  if (!score) return <main><h1>The round was stopped.</h1><p>You can leave this scene here.</p>{studyContent}{!study && <button onClick={onFinish}>Finish</button>}</main>;
  return <main className="play">
    <h1 ref={heading} tabIndex={-1}>{expired ? 'This round expired.' : revealed ? 'The scene was meant to show…' : uncertainAction ? pendingKind === 'guess2' ? 'Your final guess needs checking.' : pendingKind === 'skip' ? 'Your reveal needs checking.' : 'Your exit needs checking.' : failed ? 'The next take couldn’t be prepared.' : directing ? 'Thanks. Here’s another take.' : allowedGuess ? first ? 'What’s happening?' : 'What do you think now?' : second ? 'Take 2 of 2.' : 'Take 1 of 2.'}</h1>
    <p className="context">{round.executionMode === 'fixture' ? 'Fixture rehearsal · no live generation' : study ? 'Study session' : 'Private play'}</p>
    <p className="intro">{revealed ? round.reveal.target : expired ? 'Your playback and unsent draft remain here.' : directing || failed ? 'You can reveal or stop at any time.' : second ? 'Watch the next take.' : 'Watch a short scene, then describe it.'}</p>
    <div className="theatre">{score && <Stage score={score} elapsedMs={p.elapsedMs} />}
    <div className="controls playback">
      {p.frameMode ? <><button className={!allowedGuess || revealed ? 'primary' : undefined} disabled={p.elapsedMs >= score.durationMs && !interAct && !(second && !played[1] && selected !== 1)} onClick={mainPlayback}>{interAct ? 'Stop both takes' : second && !played[1] && selected !== 1 ? 'View next take' : 'Next frame'}</button><button onClick={() => p.step(-1)}>Previous frame</button><button onClick={() => { p.setFrameMode(false); emit({ name: 'playback_mode_changed', playbackMode: 'motion' }); }}>Play animation</button></> : <button className={!allowedGuess || p.playing || revealed ? 'primary' : undefined} onClick={mainPlayback}>{interAct ? 'Stop both takes' : p.playing ? 'Pause' : second && !played[1] && selected !== 1 ? 'Play next take' : p.elapsedMs > 0 && p.elapsedMs < score.durationMs ? 'Resume' : second && !played[1] ? 'Play next take' : 'Play scene'}</button>}
      {!p.frameMode && <button onClick={() => { p.setFrameMode(true); emit({ name: 'playback_mode_changed', playbackMode: 'frame_step' }); }}>Frame by frame</button>}
      <button onClick={() => choose(0, true)}>{second || revealed ? 'Watch take 1 again' : 'Replay take 1'}</button>
      {(second || revealed) && round.acts.length === 2 && <button onClick={() => choose(1, true)}>Watch take 2 again</button>}
      {revealed && round.acts.length === 2 && <button onClick={() => { setBoth(true); choose(0, true, true); }}>Play both takes</button>}
    </div>
    </div>
    {guided && !study && <aside className="annotation round-guide" aria-label="Round guide"><h2>Fixture round guide</h2><p>{expired ? 'This round expired. Use Another scene to start again, or Finish.' : recovery ? 'Use the check-result control to confirm your pending action before continuing.' : revealed ? 'The intention is above. You can replay the takes, open the comparison or choose Another scene.' : round.state === 'unavailable' ? 'The next take is unavailable. Use Reveal the scene or Exit round.' : directing ? 'Your first guess is sent. Wait for the fixture take, or use Reveal now to see the intention.' : p.playing ? 'The scene is playing. Use Pause to stop here, then Resume to continue.' : p.requiresReplay && !played[selected] ? 'Use Replay take 1 or Watch take 2 again to view a whole take before guessing.' : allowedGuess ? 'Describe what you saw, then send your guess. You can also reveal or exit.' : second && selected !== 1 && !played[1] ? p.frameMode ? 'Choose View next take, then use Next frame to reach its end before your final guess.' : 'Choose Play next take and watch to the end before your final guess.' : p.frameMode ? 'Use Next frame to reach the end of this take. Replay the take if you need to start over.' : second ? 'Choose Play next take and watch to the end before your final guess.' : 'Choose Play scene and watch to the end. Pause or replay whenever you like.'}</p><p className="secondary">This fixture repeats the first take. It does not adapt to your guess.</p><button onClick={() => { onDismissGuide(); heading.current?.focus(); }}>Dismiss round guide</button></aside>}
    <div className="status-space"><p className="provenance">{act?.source === 'mock_fixture' ? 'Test fixture' : act?.source === 'runtime_generated' ? 'Generated second take' : 'Authored first take'}</p>
      {p.requiresReplay && !played[selected] && !revealed && <p role="status">Viewing mode changed mid-scene. {selected === 0 ? 'Use Replay take 1' : 'Use Watch take 2 again'} to view the whole take in this mode before guessing.</p>}
      <p role="status">{interAct ? 'Pause between takes.' : directing && !failed ? waitingMs >= 5000 ? 'Still preparing…' : 'Preparing the next performance…' : second && !played[1] ? 'The next take is ready.' : ''}</p>
      {timing?.clientTimeout && <p>Waiting ended before the next take arrived.</p>}{timing?.clockUncertain && <p>Timing was interrupted. Check the result explicitly.</p>}
      {second && timing?.clientTimeout && <p>Recovered after timeout</p>}{second && timing?.clockUncertain && !timing?.clientTimeout && <p>Recovered after interrupted timing</p>}
      {offline && <><p>The local server could not be reached. Your next action will wait for a connection.</p><button onClick={onRecheck}>Check local connection</button></>}{traceLost && <p>Original capture timing is unavailable. Capture will use a labelled score reconstruction.</p>}{warning && !expired && <p>This round will expire soon.</p>}
      {error && <p role="alert" className="error">{onDiscard ? 'This saved round is no longer accessible. Discard the old request to return to setup.' : study && error === 'The local session ended. Discard the old request before starting again.' ? 'The local session ended. Your saved study request is kept. Use the withdrawal controls or ask the facilitator for help.' : error}</p>}
    </div>
    <section className="response-panel">
      {revealed ? <>{round.guesses.map((g: any) => <div key={g.attempt} className="submitted"><h2>Your {g.attempt === 1 ? 'first' : 'second'} guess</h2><p>{g.text}</p></div>)}{round.guesses.length < 2 && <p>You revealed before sending another guess.</p>}</> : directing || round.state === 'unavailable' ? <><h2>Your first guess</h2><p className="guess-text">{round.guesses[0]?.text ?? draft}</p></> : <><label htmlFor="guess">{first ? 'What’s happening?' : 'What do you think now?'}</label><p id="guess-help" className="secondary">{allowedGuess ? 'Describe your interpretation. We don’t grade your guess.' : 'Watch this take to the end, then describe what you see.'}</p><input id="guess" value={draft} placeholder="Describe the action or relationship…" disabled={!allowedGuess || p.playing || busy || expired} aria-describedby="guess-help guess-count guess-error" aria-invalid={!!fieldError} onChange={e => setDraft(e.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && !composing.current) { e.preventDefault(); send(); } }} />
        <div className="input-meta"><span id="guess-count">{count} / 240</span><span id="guess-error" className="error">{fieldError}</span></div>{expired && draft && <p>Unsent draft: {draft}</p>}</>}
      {!revealed && <button key="send" className={allowedGuess && !p.playing ? 'primary send' : 'send'} onClick={send} aria-disabled={!allowedGuess || p.playing || busy || offline || expired}>{directing || round.state === 'unavailable' ? 'Guess sent' : first ? 'Send guess' : 'Send final guess'}</button>}
    </section>
    {second && round.guesses[0] && <div className="accepted-first-guess secondary"><h2>Your first guess</h2><p className="guess-text">{round.guesses[0].text}</p></div>}
    <div className="controls round-actions">
      {onDiscard && <button onClick={onDiscard}>Discard old request</button>}
      {!revealed && !expired && <><button onClick={() => onMutate('skip')} disabled={offline || busy && pendingKind !== 'guess1' && pendingKind !== 'guess2'}>{failed ? 'Reveal the scene' : 'Reveal now'}</button><button onClick={() => onMutate('abandon')} disabled={offline || busy && pendingKind !== 'guess1' && pendingKind !== 'guess2'}>Exit round</button></>}
      {(failed || expired) && <button onClick={onCheck} disabled={offline || busy}>{expired || uncertainAction || revealed ? 'Check result' : 'Check for a completed take'}</button>}
      {(revealed || expired) && !study && <><button className="primary" onClick={onAnother} disabled={offline || busy || recovery}>Another scene</button><button onClick={onFinish} disabled={recovery}>Finish</button></>}
      {revealed && operator && !study && (traceSaving ? <button disabled>Saving capture timing…</button> : <a tabIndex={0} className="button" href={`/creator/capture?round=${round.roundId}`}>Creator capture</a>)}
    </div>
    {revealed && !study && round.acts.length === 2 && <details className="section" onToggle={event => { const open = event.currentTarget.open; setComparisonOpen(open); if (open) p.pause(); }}><summary>Compare your two takes</summary><p>Compare the scores in this round. {round.executionMode === 'fixture' ? 'This fixture repeats the first take without adapting to your guess.' : 'A numeric change does not establish better communication.'}</p>{comparisonOpen && <ScoreComparison left={round.acts[0].score} right={round.acts[1].score} />}</details>}
    {revealed && (recovery ? <p>Check the result to confirm pending timing records before continuing.</p> : terminalContent)}{studyContent}
  </main>;
}
