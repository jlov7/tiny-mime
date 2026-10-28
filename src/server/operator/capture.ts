import { canonicalize } from 'json-canonicalize';
import { strToU8, zipSync } from 'fflate';
import { z } from 'zod';
import { apiError, type ApiError, type PublicRound } from '../../shared/api.js';
import { validateScore } from '../../shared/validateScore.js';
import { traceTimeline, validCaptureTrace, type CaptureTrace, type ObservedSegment } from './captureTrace.js';
import { replayHtml } from './replayTemplate.js';

export type CaptureInput = { requestId: string; roundId: string; includeGuessText: boolean; timing: 'original' | 'shortened_wait'; shortenedWaitMs: number | null };
export type CaptureSegment = ObservedSegment
  | { kind: 'act'; attempt: 1 | 2; durationMs: number; playbackSpeed: number; replay: boolean }
  | { kind: 'guess'; attempt: 1 | 2; durationMs: number }
  | { kind: 'wait' | 'reveal'; durationMs: number };
export type CapturePlaybackObservation = { attempt: 1 | 2; mode: 'full_motion' | 'frame_step'; speed: number; replay: boolean };
export type CaptureOperationalOutcome = { clientTimeout: boolean; clockUncertain: boolean; lateRecovery: boolean };
export type CaptureRecord = {
  round: PublicRound;
  creatorOwned: boolean;
  publicationPermission: null | { roundId: string; verified: true; scope: 'guess_text_publication' };
  actualWaitMs: number;
  serverGenerationMs?: number | null;
  trace?: CaptureTrace | null;
  timeline: CaptureSegment[];
  selectedExample: boolean;
  versions: { engine: string; contact: string; meaning: string; prompt: string | null; model: string | null };
  createdAt: string;
  playbackObservations?: CapturePlaybackObservation[];
  operationalOutcome?: CaptureOperationalOutcome;
};
export type CaptureManifest = {
  bundleVersion: 1;
  format: 'self-contained HTML/SVG replay';
  round: { mode: PublicRound['mode']; executionMode: PublicRound['executionMode']; generationOutcome: string | null; generationFailure: string | null };
  acts: { attempt: 1 | 2; scoreHash: string; source: string; authorship: PublicRound['acts'][number]['authorship'] }[];
  timelineBasis: 'observed_creator_trace' | 'score_reconstruction';
  actualTimeline: CaptureSegment[] | null;
  serverGenerationMs: number | null;
  presentationDwellMs: { guess: number; reveal: number } | null;
  exportedTimeline: CaptureSegment[];
  actualWaitMs: number | null;
  exportedWaitMs: number;
  editRanges: { segment: number; actualDurationMs: number; exportedDurationMs: number }[];
  timingEdited: boolean;
  omittedGuessText: boolean;
  consentBasis: 'creator_owned' | 'publication_opt_in' | 'no_guess_text';
  selectedExample: boolean;
  playbackObservations: CapturePlaybackObservation[];
  replayCounts: { act1: number; act2: number };
  operationalOutcome: CaptureOperationalOutcome | null;
  versions: CaptureRecord['versions'];
  createdAt: string;
  validityLimitations: string[];
};
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const inputSchema = z.object({ requestId: uuid, roundId: uuid, includeGuessText: z.boolean(), timing: z.enum(['original', 'shortened_wait']), shortenedWaitMs: z.number().int().min(0).max(15000).nullable() }).strict();
const finiteDuration = (n: number) => Number.isFinite(n) && Number.isInteger(n) && n >= 0;
const scalarText = (text: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text);

export function captureTiming(record: CaptureRecord) {
  const trace = record.trace && validCaptureTrace(record.trace, record.round) ? record.trace : null;
  const observed = trace ? traceTimeline(trace) : null;
  const actualWaitMs = observed ? observed.reduce((sum, s) => sum + (s.waiting ? s.durationMs : 0), 0) : null;
  // Shortening any occupied wait could erase replay, frame stepping or a held frame.
  const canShortenWait = !!observed && !trace!.states.some(s => s.waiting && ['step', 'seek', 'select', 'play', 'replay', 'mode'].includes(s.reason)) && !observed.some(s => s.waiting && (s.playing || s.replay || s.positionMs > 0 && s.positionMs < record.round.acts[s.attempt - 1].score.durationMs));
  return { timelineBasis: trace ? 'observed_creator_trace' as const : 'score_reconstruction' as const, actualWaitMs, canShortenWait, serverGenerationMs: record.serverGenerationMs === undefined ? record.actualWaitMs : record.serverGenerationMs };
}

export function buildCapture(record: CaptureRecord, input: CaptureInput): { bytes: Uint8Array; manifest: CaptureManifest; filename: 'tiny-mime-replay.zip' } | ApiError {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return apiError('INVALID_INPUT', typeof input?.requestId === 'string' ? input.requestId : null);
  const fail = (code: 'INVALID_INPUT' | 'FORBIDDEN' | 'UNAVAILABLE') => apiError(code, input.requestId);
  const round = record.round;
  if (input.roundId !== round.roundId || round.state !== 'revealed' || !round.reveal || round.acts.length !== 2 || !round.guesses.some(g => g.attempt === 2) || round.generation?.status !== 'ready') return fail('UNAVAILABLE');
  if (input.includeGuessText && !record.creatorOwned && !(record.publicationPermission?.verified === true && record.publicationPermission.scope === 'guess_text_publication' && record.publicationPermission.roundId === round.roundId)) return fail('FORBIDDEN');
  const timing = captureTiming(record);
  if ((input.timing === 'original' && input.shortenedWaitMs !== null) || (input.timing === 'shortened_wait' && (input.shortenedWaitMs === null || !timing.canShortenWait || input.shortenedWaitMs > timing.actualWaitMs!))) return fail('INVALID_INPUT');
  if (!scalarText(round.reveal.target) || round.guesses.some(g => !scalarText(g.text)) || !finiteDuration(record.actualWaitMs) || !Number.isFinite(Date.parse(record.createdAt))) return fail('UNAVAILABLE');
  const roster = round.acts[0].score.actors.map(({ id, shape, color }) => ({ id, shape, color }));
  const acts = round.acts.map(act => ({ act, validated: validateScore(JSON.stringify(act.score), roster) }));
  if (acts.some(({ act, validated }, i) => act.attempt !== i + 1 || !validated.ok || validated.scoreHash !== act.scoreHash)) return fail('UNAVAILABLE');
  const actualTimeline = timing.timelineBasis === 'observed_creator_trace' ? traceTimeline(record.trace!) : null;
  const timeline: CaptureSegment[] = actualTimeline ?? [
    { kind: 'act', attempt: 1, durationMs: round.acts[0].score.durationMs, playbackSpeed: 1, replay: false },
    { kind: 'guess', attempt: 1, durationMs: 1500 },
    { kind: 'wait', durationMs: timing.serverGenerationMs ?? 0 },
    { kind: 'act', attempt: 2, durationMs: round.acts[1].score.durationMs, playbackSpeed: 1, replay: false },
    { kind: 'guess', attempt: 2, durationMs: 1500 }, { kind: 'reveal', durationMs: 1500 },
  ];
  const observations = record.playbackObservations ?? [];
  if (observations.length > 1000 || observations.some(o => ![1, 2].includes(o.attempt) || !['full_motion', 'frame_step'].includes(o.mode) || !Number.isFinite(o.speed) || o.speed <= 0 || typeof o.replay !== 'boolean' || Object.keys(o).some(k => !['attempt', 'mode', 'speed', 'replay'].includes(k)))) return fail('UNAVAILABLE');
  const playbackObservations = observations.map(({ attempt, mode, speed, replay }) => ({ attempt, mode, speed, replay }));
  const operational = record.operationalOutcome;
  if (operational && (Object.keys(operational).some(k => !['clientTimeout', 'clockUncertain', 'lateRecovery'].includes(k)) || [operational.clientTimeout, operational.clockUncertain, operational.lateRecovery].some(flag => typeof flag !== 'boolean'))) return fail('UNAVAILABLE');
  let remainingWait = input.shortenedWaitMs ?? 0;
  const exportedTimeline = timeline.map(s => {
    if (input.timing !== 'shortened_wait' || s.kind !== 'observed' || !s.waiting) return { ...s };
    const durationMs = Math.min(s.durationMs, remainingWait); remainingWait -= durationMs;
    return { ...s, durationMs };
  });
  const manifest: CaptureManifest = {
    bundleVersion: 1, format: 'self-contained HTML/SVG replay',
    round: { mode: round.mode, executionMode: round.executionMode, generationOutcome: round.generation.status, generationFailure: round.generation.failure },
    acts: round.acts.map(({ attempt, scoreHash, source, authorship }) => ({ attempt, scoreHash, source, authorship: authorship ? { authoringMethod: authorship.authoringMethod, humanReview: authorship.humanReview } : null })),
    timelineBasis: timing.timelineBasis, actualTimeline, exportedTimeline, actualWaitMs: timing.actualWaitMs, serverGenerationMs: timing.serverGenerationMs, presentationDwellMs: actualTimeline ? null : { guess: 1500, reveal: 1500 }, exportedWaitMs: input.timing === 'original' ? timing.actualWaitMs ?? timing.serverGenerationMs ?? 0 : input.shortenedWaitMs!,
    editRanges: input.timing === 'original' ? [] : timeline.flatMap((s, segment) => s.durationMs !== exportedTimeline[segment].durationMs ? [{ segment, actualDurationMs: s.durationMs, exportedDurationMs: exportedTimeline[segment].durationMs }] : []),
    timingEdited: input.timing === 'shortened_wait', omittedGuessText: !input.includeGuessText,
    consentBasis: !input.includeGuessText ? 'no_guess_text' : record.creatorOwned ? 'creator_owned' : 'publication_opt_in',
    selectedExample: record.selectedExample, versions: { engine: record.versions.engine, contact: record.versions.contact, meaning: record.versions.meaning, prompt: record.versions.prompt, model: record.versions.model }, createdAt: record.createdAt,
    playbackObservations, replayCounts: { act1: (observations.length ? observations : timeline.filter(s => s.kind === 'act')).filter(s => s.attempt === 1 && s.replay).length, act2: (observations.length ? observations : timeline.filter(s => s.kind === 'act')).filter(s => s.attempt === 2 && s.replay).length },
    operationalOutcome: operational ? { clientTimeout: operational.clientTimeout, clockUncertain: operational.clockUncertain, lateRecovery: operational.lateRecovery } : null,
    validityLimitations: [actualTimeline ? 'Timing is a creator browser observation, not independently verified viewing evidence.' : 'Original viewing timing is unavailable. This score reconstruction uses server generation duration and chosen 1500ms guess/reveal display holds; it does not reproduce the original session.', 'Local HTML replay, not a video file or a blinded participant artifact.', 'Replay reconstructs score motion. Exported motion is not evidence of original full-motion viewing.', 'Local export grants no publishing or uploading authority.', 'Human comprehension, enjoyment, semantic fidelity, comparative effect and physical-device checks: NOT RUN.', ...(input.includeGuessText ? [] : ['Guess omitted; this is not a complete example of guess-specific repair.']), ...(round.executionMode === 'fixture' ? ['Synthetic fixture round. No live provider generation.'] : [])],
  };
  const files: Record<string, Uint8Array> = {
    'replay.html': strToU8(replayHtml({ manifest, acts: acts.flatMap(({ act, validated }) => validated.ok ? [{ attempt: act.attempt, scoreHash: act.scoreHash, source: act.source, authorship: manifest.acts.find(a => a.attempt === act.attempt)!.authorship, score: validated.score }] : []), guesses: input.includeGuessText ? round.guesses.map(({ attempt, text }) => ({ attempt, text })) : [], target: round.reveal.target })),
    'capture-manifest.json': strToU8(canonicalize(manifest)),
  };
  for (const { act, validated } of acts) if (validated.ok) files[`scores/act${act.attempt}.json`] = strToU8(canonicalize(validated.score));
  const bytes = zipSync(files, { level: 6 });
  if (bytes.byteLength > 20 * 1024 * 1024) return fail('UNAVAILABLE');
  return { bytes, manifest, filename: 'tiny-mime-replay.zip' };
}
