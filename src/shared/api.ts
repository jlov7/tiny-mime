import type { MotionScoreV1 } from './score.js';

export type Authorship = { authoringMethod: 'spec_transcribed' | 'agent_assisted' | 'human_authored'; humanReview: 'not_run' | 'reviewed' };
export type SourceKind = 'runtime_generated' | 'authored_fixture' | 'mock_fixture';
export type Mode = 'private_play' | 'study';
export type ExecutionMode = 'fixture' | 'live';
export type Phase = 'play' | 'formative' | 'bank_calibration' | 'practice' | 'comparative' | 'optional_extra';
export type RoundState = 'awaiting_guess1' | 'generating_act2' | 'awaiting_guess2' | 'unavailable' | 'revealed' | 'abandoned';
export type GenerationFailure = 'provider_disabled' | 'limited' | 'invalid_output' | 'provider_error' | 'refusal' | 'deadline' | 'cancelled';
export type PublicAct = { attempt: 1 | 2; scoreHash: string; source: SourceKind; authorship: Authorship | null; score: MotionScoreV1 };
export type PublicRound = {
  roundId: string; revision: number; expiresAt: string; mode: Mode; executionMode: ExecutionMode; phase: Phase; state: RoundState;
  acts: PublicAct[]; guesses: { attempt: 1 | 2; text: string }[]; actions: ('guess' | 'skip' | 'abandon' | 'restart')[];
  generation: null | { acceptedAt: string; deadlineAt: string; status: 'pending' | 'ready' | 'failed' | 'cancelled'; failure: GenerationFailure | null };
  reveal: null | { target: string };
};
export type ApiErrorCode = 'INVALID_INPUT' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'STALE' | 'IDEMPOTENCY_CONFLICT' | 'ACTIVE_ROUND' | 'EXPIRED' | 'LIMITED' | 'UNAVAILABLE' | 'DEADLINE';
export type ApiError = { error: { code: ApiErrorCode; retryable: boolean; requestId: string | null } };
export type SessionContext = { sessionId: string };
export type CreateRound = { requestId: string; mode: Mode; executionMode: ExecutionMode; studySessionId: string | null };
export type RoundMutation = { requestId: string; revision: number };
export type GuessInput = RoundMutation & { attempt: 1 | 2; guess: string };
export type PendingCreationV1 = { version: 1; requestId: string; mode: Mode; executionMode: ExecutionMode; studySessionId: string | null; createdWallMs: number };
export type PendingMutationV1 = { version: 1; roundId: string; requestId: string; kind: 'guess1' | 'guess2' | 'skip' | 'abandon'; revision: number; submittedWallMs: number; deadlineWallMs: number | null; lastObservedWallMs: number; clockUncertain: boolean };
export type RoundRecoveryV1 = { version: 1; roundId: string; clientTimeout: boolean; clockUncertain: boolean; timeoutEventId: string | null; clockUncertainEventId: string | null };
export const apiError = (code: ApiErrorCode, requestId: string | null = null): ApiError => ({ error: { code, retryable: code === 'LIMITED' || code === 'UNAVAILABLE', requestId } });
export const isApiError = (value: unknown): value is ApiError => !!value && typeof value === 'object' && 'error' in value;
