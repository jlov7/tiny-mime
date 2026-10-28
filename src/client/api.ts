import type { PublicRound } from '../shared/api.js';
import { validateScore } from '../shared/validateScore.js';
import { z } from 'zod';
import { normalizeGuess } from '../shared/normalizeGuess.js';
z.config({ jitless: true });

export { HttpFailure, request } from './request.js';
const id = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const date = z.iso.datetime(); const attempt = z.union([z.literal(1), z.literal(2)]);
const key = z.strictObject({ tMs: z.number(), x: z.number(), y: z.number(), rotationDeg: z.number(), scaleX: z.number(), scaleY: z.number(), easing: z.enum(['linear', 'easeInOut']) });
const score = z.strictObject({ version: z.literal(1), durationMs: z.number(), stage: z.strictObject({ width: z.literal(1000), height: z.literal(700) }), actors: z.array(z.strictObject({ id: z.enum(['a', 'b', 'c']), shape: z.enum(['circle', 'square', 'triangle']), color: z.enum(['violet', 'amber', 'teal']), keyframes: z.array(key).min(2).max(24) })).min(2).max(3) });
const act = z.strictObject({ attempt, scoreHash: z.string().regex(/^[0-9a-f]{64}$/), source: z.enum(['runtime_generated', 'authored_fixture', 'mock_fixture']), authorship: z.strictObject({ authoringMethod: z.enum(['spec_transcribed', 'agent_assisted', 'human_authored']), humanReview: z.enum(['not_run', 'reviewed']) }).nullable(), score });
const publicRound = z.strictObject({
  roundId: id, revision: z.number().int().min(0).max(2147483647), expiresAt: date, mode: z.enum(['private_play', 'study']), executionMode: z.enum(['fixture', 'live']), phase: z.enum(['play', 'formative', 'bank_calibration', 'practice', 'comparative', 'optional_extra']), state: z.enum(['awaiting_guess1', 'generating_act2', 'awaiting_guess2', 'unavailable', 'revealed', 'abandoned']),
  acts: z.array(act).max(2), guesses: z.array(z.strictObject({ attempt, text: z.string().min(1).max(480) })).max(2), actions: z.array(z.enum(['guess', 'skip', 'abandon', 'restart'])).min(1).max(3),
  generation: z.strictObject({ acceptedAt: date, deadlineAt: date, status: z.enum(['pending', 'ready', 'failed', 'cancelled']), failure: z.enum(['provider_disabled', 'limited', 'invalid_output', 'provider_error', 'refusal', 'deadline', 'cancelled']).nullable() }).nullable(), reveal: z.strictObject({ target: z.string().min(1).max(1000) }).nullable(),
});
export function checkedRound(round: PublicRound): PublicRound {
  const parsed = publicRound.safeParse(round); if (!parsed.success) throw new Error('INVALID_SNAPSHOT');
  const valid = parsed.data; const roster = valid.acts[0]?.score.actors.map(({ id, shape, color }) => ({ id, shape, color }));
  for (const [index, act] of valid.acts.entries()) {
    if (act.attempt !== index + 1 || (act.source === 'authored_fixture') !== (act.authorship !== null) || (index === 0 && act.source !== 'authored_fixture') || (index === 1 && act.source !== (valid.executionMode === 'fixture' ? 'mock_fixture' : 'runtime_generated'))) throw new Error('INVALID_SNAPSHOT');
    const result = validateScore(JSON.stringify(act.score), roster!); if (!result.ok || result.scoreHash !== act.scoreHash) throw new Error('INVALID_SCORE');
  }
  if ((valid.state !== 'abandoned' && !valid.acts.length) || (valid.state === 'abandoned' && (valid.acts.length || valid.guesses.length || valid.reveal)) || (valid.state === 'awaiting_guess2' && valid.acts.length !== 2) || (valid.state === 'revealed' && !valid.reveal) || (valid.state !== 'revealed' && valid.reveal) || valid.guesses.some((g, i) => g.attempt !== i + 1 || normalizeGuess(g.text) !== g.text)) throw new Error('INVALID_SNAPSHOT');
  return valid as PublicRound;
}

const requestStatus = z.strictObject({ accepted: z.boolean() });
export function checkedRequestStatus(value: unknown): { accepted: boolean } { return requestStatus.parse(value); }

const sessionReceipt = z.strictObject({ sessionReady: z.literal(true), activeRoundId: id.nullable(), recoveryOwnerId: id });
export function checkedSession(value: unknown) { return sessionReceipt.parse(value); }
export const feedbackStatus = z.strictObject({ saved: z.boolean(), secondActCompletionRecorded: z.boolean() });

const eventReceipt = z.strictObject({ acceptedEventIds: z.array(id), duplicateEventIds: z.array(id) });
export function checkedEventReceipt(value: unknown) { return eventReceipt.parse(value); }
