import { z } from 'zod';
import { apiError, type ApiError, type PublicRound } from '../../shared/api.js';
import type { InternalRound } from '../rounds.js';

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const stateSchema = z.object({
  seq: z.number().int().min(0).max(255), atMs: z.number().int().min(0).max(1800000),
  reason: z.enum(['initial', 'play', 'pause', 'replay', 'step', 'seek', 'mode', 'complete', 'select', 'visibility', 'phase', 'submission', 'reveal']),
  phase: z.enum(['awaiting_guess1', 'generating_act2', 'awaiting_guess2', 'unavailable', 'revealed']),
  waiting: z.boolean(), hidden: z.boolean(), attempt: z.union([z.literal(1), z.literal(2)]),
  scoreHash: z.string().regex(/^[a-f0-9]{64}$/), positionMs: z.number().min(0).max(10000),
  playing: z.boolean(), mode: z.enum(['motion', 'frame_step']), replay: z.boolean(),
  submissionRequestId: uuid.nullable(),
}).strict();
export const captureTraceSchema = z.object({ requestId: uuid, documentId: uuid, states: z.array(stateSchema).min(2).max(256) }).strict();
export type CaptureTrace = z.infer<typeof captureTraceSchema>;
export type CaptureTraceState = CaptureTrace['states'][number];
export type ObservedSegment = { kind: 'observed'; guessAttempt: 1 | 2 | null; durationMs: number; phase: CaptureTraceState['phase']; waiting: boolean; hidden: boolean; attempt: 1 | 2; positionMs: number; playing: boolean; mode: 'motion' | 'frame_step'; replay: boolean };

export function validCaptureTrace(trace: CaptureTrace, round: PublicRound): boolean {
  if (!captureTraceSchema.safeParse(trace).success || Buffer.byteLength(JSON.stringify(trace), 'utf8') > 65536) return false;
  const first = trace.states[0], last = trace.states.at(-1)!;
  if (first.seq !== 0 || first.atMs !== 0 || first.reason !== 'initial' || first.phase !== 'awaiting_guess1' || first.attempt !== 1 || first.positionMs !== 0 || first.playing || first.waiting || first.submissionRequestId !== null || last.reason !== 'reveal' || last.phase !== 'revealed' || last.waiting || last.playing) return false;
  let submitted = false, second = false, finalSubmitted = false, waitEnded = false;
  const phaseOrder = { awaiting_guess1: 0, generating_act2: 1, unavailable: 2, awaiting_guess2: 3, revealed: 4 };
  return trace.states.every((s, i) => {
    const act = round.acts.find(a => a.attempt === s.attempt);
    if (!act || s.scoreHash !== act.scoreHash || s.positionMs > act.score.durationMs || s.seq !== i || (i > 0 && s.atMs < trace.states[i - 1].atMs) || (s.playing && (s.hidden || s.mode === 'frame_step')) || (i < trace.states.length - 1 && s.phase === 'revealed')) return false;
    if (i > 0 && (s.reason === 'initial' || phaseOrder[s.phase] < phaseOrder[trace.states[i - 1].phase])) return false;
    if (i > 0 && trace.states[i - 1].waiting && !s.waiting) waitEnded = true;
    if (s.waiting && (s.phase !== 'generating_act2' || waitEnded)) return false;
    if (s.reason === 'submission') {
      if (!s.submissionRequestId) return false;
      if (s.phase === 'generating_act2' && !submitted) submitted = true;
      else if (s.phase === 'awaiting_guess2' && second && !finalSubmitted) finalSubmitted = true;
      else return false;
    }
    if (s.waiting && !submitted) return false;
    if (s.phase === 'awaiting_guess2') { if (!submitted) return false; second = true; }
    if (s.attempt === 2 && !second) return false;
    return i !== trace.states.length - 1 || submitted && second && finalSubmitted;
  });
}

export function traceTimeline(trace: CaptureTrace): ObservedSegment[] {
  let guessAttempt: 1 | 2 | null = null;
  return trace.states.map((s, i) => { if (s.reason === 'submission') guessAttempt = s.phase === 'generating_act2' ? 1 : 2; return ({ kind: 'observed', guessAttempt, durationMs: i + 1 < trace.states.length ? trace.states[i + 1].atMs - s.atMs : 0, phase: s.phase, waiting: s.waiting, hidden: s.hidden, attempt: s.attempt, positionMs: s.positionMs, playing: s.playing, mode: s.mode, replay: s.replay }); });
}

// Traces are ephemeral creator data. A restart loses them and forces explicit reconstruction.
export class CaptureTraceStore {
  private traces = new Map<string, { ownerId: string; trace: CaptureTrace }>();
  submit(round: InternalRound, ownerId: string, input: unknown, finalSubmissionRequestId: string | null): { accepted: true } | ApiError {
    const parsed = captureTraceSchema.safeParse(input);
    const requestId = parsed.success ? parsed.data.requestId : null;
    if (round.ownerId !== ownerId || !round.creatorOwned || round.public.mode !== 'private_play' || round.studySessionId !== null) return apiError('FORBIDDEN', requestId);
    if (!parsed.success || !validCaptureTrace(parsed.data, round.public)) return apiError('INVALID_INPUT', requestId);
    if (round.public.state !== 'revealed' || round.public.guesses.length !== 2) return apiError('UNAVAILABLE', requestId);
    const submission = parsed.data.states.find(s => s.reason === 'submission' && s.phase === 'generating_act2');
    const finalSubmission = parsed.data.states.find(s => s.reason === 'submission' && s.phase === 'awaiting_guess2');
    if (!finalSubmissionRequestId || finalSubmission?.submissionRequestId !== finalSubmissionRequestId || submission?.submissionRequestId !== round.submissionRequestId) return apiError('INVALID_INPUT', requestId);
    const previous = this.traces.get(round.public.roundId);
    if (previous) return previous.ownerId === ownerId && JSON.stringify(previous.trace) === JSON.stringify(parsed.data) ? { accepted: true } : apiError('IDEMPOTENCY_CONFLICT', requestId);
    if (this.traces.size >= 100) return apiError('LIMITED', requestId);
    this.traces.set(round.public.roundId, { ownerId, trace: parsed.data });
    return { accepted: true };
  }
  read(roundId: string) { return this.traces.get(roundId)?.trace ?? null; }
  clear(roundIds: string[]) { for (const id of roundIds) this.traces.delete(id); }
}
