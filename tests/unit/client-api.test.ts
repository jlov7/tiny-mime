import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { checkedRound, checkedRequestStatus, HttpFailure, request } from '../../src/client/api.js';
import { scoreHash } from '../../src/shared/hash.js';
import type { MotionScoreV1 } from '../../src/shared/score.js';
import type { PublicRound } from '../../src/shared/api.js';
import rawScore from '../../src/server/scores/TM01.json';

const score = rawScore as MotionScoreV1;
const round = (): PublicRound => ({ roundId: randomUUID(), revision: 0, expiresAt: '2026-10-08T12:00:00.000Z', mode: 'private_play', executionMode: 'fixture', phase: 'play', state: 'awaiting_guess1', acts: [{ attempt: 1, scoreHash: scoreHash(score), source: 'authored_fixture', authorship: { authoringMethod: 'spec_transcribed', humanReview: 'not_run' }, score: structuredClone(score) }], guesses: [], actions: ['guess', 'skip', 'abandon'], generation: null, reveal: null });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('client presentation boundary', () => {
  it('accepts an independently validated authored snapshot and an empty abandoned snapshot', () => {
    expect(checkedRound(round()).acts).toHaveLength(1);
    expect(checkedRound({ ...round(), state: 'abandoned', acts: [], actions: ['restart'] }).acts).toEqual([]);
  });
  it('rejects unknown public fields at each envelope boundary before presentation', () => {
    for (const mutate of [
      (r: any) => { r.target = 'hidden'; },
      (r: any) => { r.acts[0].sceneId = 'hidden'; },
      (r: any) => { r.acts[0].authorship.operatorData = 'hidden'; },
      (r: any) => { r.acts[0].score.actors[0].meaning = 'hidden'; },
      (r: any) => { r.guesses = [{ attempt: 1, text: 'a guess', condition: 'hidden' }]; },
      (r: any) => { r.generation = { acceptedAt: r.expiresAt, deadlineAt: r.expiresAt, status: 'pending', failure: null, model: 'hidden' }; },
      (r: any) => { r.reveal = { target: 'visible reveal', sceneId: 'hidden' }; r.state = 'revealed'; },
    ]) { const input = round(); mutate(input); expect(() => checkedRound(input)).toThrow('INVALID_SNAPSHOT'); }
  });
  it('rejects a bad second score and mismatched roster even when the first act is valid', () => {
    const input = round(); input.state = 'awaiting_guess2'; input.acts.push({ ...structuredClone(input.acts[0]), attempt: 2, source: 'mock_fixture', authorship: null });
    input.acts[1].scoreHash = '0'.repeat(64); expect(() => checkedRound(input)).toThrow('INVALID_SCORE');
    input.acts[1].score.actors[0].color = 'teal'; input.acts[1].scoreHash = scoreHash(input.acts[1].score); expect(() => checkedRound(input)).toThrow('INVALID_SCORE');
  });
  it('rejects malformed provenance, attempts, dates, and state-dependent snapshots', () => {
    for (const input of [{ ...round(), revision: -1 }, { ...round(), expiresAt: 'tomorrow' }, { ...round(), state: 'revealed' }, { ...round(), state: 'awaiting_guess2' }, { ...round(), acts: [] }, { ...round(), acts: [{ ...round().acts[0], authorship: null }] }, { ...round(), guesses: [{ attempt: 2, text: 'a guess' }] }]) expect(() => checkedRound(input as PublicRound)).toThrow();
  });
});

describe('bounded API waits', () => {
  it('uses reachable loopback even when the browser reports no Internet connection', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ sessionReady: true }))); vi.stubGlobal('fetch', fetch); vi.stubGlobal('navigator', { onLine: false });
    await expect(request('/api/session', {})).resolves.toEqual({ sessionReady: true }); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('releases an unresponsive request at the default ten-second limit', async () => {
    vi.useFakeTimers(); const fetch = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => new Promise<Response>(() => {})); vi.stubGlobal('fetch', fetch);
    const pending = request('/api/session', {}); const rejection = expect(pending).rejects.toThrow('REQUEST_TIMEOUT');
    await vi.advanceTimersByTimeAsync(10000); await rejection;
    expect((fetch.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps a first-guess request within the original fifteen-second allowance', async () => {
    vi.useFakeTimers(); vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    let settled = false; const pending = request('/api/rounds/round/guesses', {}, { timeoutMs: 15000 }); const rejection = expect(pending).rejects.toThrow('REQUEST_TIMEOUT'); void pending.catch(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(14999); expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1); await rejection; expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels on navigation and cleans its timer even if transport ignores abort', async () => {
    vi.useFakeTimers(); vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {}))); const controller = new AbortController();
    const pending = request('/api/session', {}, controller.signal); const rejection = expect(pending).rejects.toThrow('navigation'); controller.abort(new Error('navigation')); await rejection; expect(vi.getTimerCount()).toBe(0);
  });
  it('preserves structured HTTP errors and clears the timer on success', async () => {
    vi.useFakeTimers(); vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'STALE', retryable: false, requestId: null } }), { status: 409 })).mockResolvedValueOnce(new Response(JSON.stringify({ sessionReady: true }))));
    await expect(request('/api/action', {})).rejects.toEqual(new HttpFailure(409, 'STALE')); await expect(request('/api/session', {})).resolves.toEqual({ sessionReady: true }); expect(vi.getTimerCount()).toBe(0);
  });
  it('retains a valid local request reference without displaying malformed error content', async () => {
    const id = randomUUID();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'UNAVAILABLE', retryable: true, requestId: id } }), { status: 503 })).mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'private content', requestId: 'private content' } }), { status: 503 })));
    await expect(request('/api/action', {})).rejects.toEqual(new HttpFailure(503, 'UNAVAILABLE', id));
    await expect(request('/api/action', {})).rejects.toEqual(new HttpFailure(503, 'UNAVAILABLE', null));
  });
});

it('accepts only the exact boolean request-acceptance receipt before clearing any uncertain work',()=>{
  expect(checkedRequestStatus({accepted:true})).toEqual({accepted:true});expect(checkedRequestStatus({accepted:false})).toEqual({accepted:false});
  for(const value of [null,{},false,{accepted:'false'},{accepted:0},{accepted:false,roundId:randomUUID()},{accepted:true,target:'hidden'}])expect(()=>checkedRequestStatus(value)).toThrow();
});
