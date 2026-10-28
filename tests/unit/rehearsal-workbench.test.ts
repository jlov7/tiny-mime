import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { scoreHash } from '../../src/shared/hash.js';
import { editKeyframe, locateScoreError, undoEdit, type EditHistory } from '../../src/client/workbench/draft.js';
import { checkedCandidate, downloadInspection, getCandidate, inspectionBlob, listCandidates, removeCandidate, saveCandidate } from '../../src/client/workspaceApi.js';
import { HttpFailure } from '../../src/client/request.js';
import type { MotionScoreV1 } from '../../src/shared/score.js';
import example from '../../src/server/scores/TM01.json';

const score = example as MotionScoreV1;
const roster = score.actors;
const snapshot = () => ({ candidateId: randomUUID(), sceneId: 'TM01', title: 'Private draft', scoreHash: scoreHash(score), parentCandidateId: null, createdAt: '2026-10-18T12:00:00.000Z', noteCount: 1, score: structuredClone(score), notes: [{ atMs: 1200, text: 'Timing note' }] });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('forks numeric edits without mutating the source and caps undo at thirty snapshots', () => {
  let history: EditHistory = { score: structuredClone(score), undo: [] };
  const original = structuredClone(history.score);
  for (let i = 0; i < 35; i++) history = editKeyframe(history, 0, 0, 'rotationDeg', i, roster).history;
  expect(history.undo).toHaveLength(30); expect(original).toEqual(score);
  expect(history.score.actors[0].keyframes[0].rotationDeg).toBe(34);
  history = undoEdit(history); expect(history.score.actors[0].keyframes[0].rotationDeg).toBe(33);
  expect(undoEdit({ score, undo: [] }).score).toBe(score);
});
it('rejects unsafe numeric drafts and broken timing before accepting them', () => {
  const history = { score, undo: [] };
  expect(editKeyframe(history, 0, 0, 'x', -1, roster).result.ok).toBe(false);
  expect(editKeyframe(history, 0, 0, 'tMs', 10, roster).result.ok).toBe(false);
  expect(editKeyframe(history, 0, 0, 'scaleX', NaN, roster).result.ok).toBe(false);
  expect(scoreHash(history.score)).toBe(scoreHash(score));
});
it('maps validator paths to the exact raw scalar and meaningful actor interval', () => {
  const raw = JSON.stringify(score, null, 2);
  const location = locateScoreError(raw, { code: 'BOUNDS', path: '/actors/0/keyframes/1/x' });
  expect(raw.slice(location.start, location.end)).toBe(String(score.actors[0].keyframes[1].x));
  expect(location.context).toContain('Actor a'); expect(location.atMs).toBe(score.actors[0].keyframes[1].tMs);
  const pair = locateScoreError(raw, { code: 'CONTACT', path: '/pairs/a-b/intervals/0' });
  expect(pair.context).toContain('Actors a and b · interval 0–'); expect(pair.atMs).toBe(0);
  expect(JSON.parse(raw.slice(pair.start, pair.end))).toEqual(score.actors[0].keyframes[0]);
});
it('locates syntax failures and safely handles absent paths and oversized documents', () => {
  const broken = '{"actors": [}'; const issue = locateScoreError(broken, { code: 'PARSE', path: '/' });
  expect(issue.start).toBeGreaterThan(0); expect(issue.end).toBeGreaterThan(issue.start);
  expect(locateScoreError('{}', { code: 'SCHEMA', path: '/actors/7' })).toMatchObject({ start: 0, end: 2 });
  expect(locateScoreError('['.repeat(10000), { code: 'DEPTH', path: '/' })).toMatchObject({ start: 6, end: 7 });
  expect(locateScoreError(' '.repeat(65537), { code: 'BYTES', path: '/' })).toMatchObject({ start: 0, end: 1 });
});
it('checks saved score hashes, rosters, note counts and timestamp bounds at the API boundary', () => {
  expect(checkedCandidate(snapshot(), roster).score).toEqual(score);
  for (const mutate of [
    (s: any) => { s.scoreHash = '0'.repeat(64); },
    (s: any) => { s.score.actors[0].shape = 'triangle'; },
    (s: any) => { s.noteCount = 0; },
    (s: any) => { s.notes[0].atMs = score.durationMs + 1; },
    (s: any) => { s.notes[0].text = ''; },
    (s: any) => { s.provider = 'private'; },
  ]) { const value = snapshot(); mutate(value); expect(() => checkedCandidate(value, roster)).toThrow(); }
});
it('loads and saves snapshots through the authenticated bounded request helper', async () => {
  const value = snapshot(); const { score: ignoredScore, notes: ignoredNotes, ...summary } = value;
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ candidates: [summary] })).mockResolvedValueOnce(Response.json({ candidate: value })).mockResolvedValueOnce(Response.json({ candidate: value }));
  vi.stubGlobal('fetch', fetch);
  expect(await listCandidates()).toEqual([summary]); expect((await getCandidate(value.candidateId, roster)).candidateId).toBe(value.candidateId);
  const input = { requestId: randomUUID(), sceneId: 'TM01', title: value.title, score, notes: value.notes, parentCandidateId: null };
  expect((await saveCandidate(input, roster)).scoreHash).toBe(value.scoreHash);
  expect(fetch.mock.calls[2][1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store', method: 'POST', body: JSON.stringify(input) });
});
it('checks inspection HTTP status and media type before returning bytes', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('zip', { headers: { 'content-type': 'application/zip' } })).mockResolvedValueOnce(new Response('{}', { status: 403 })).mockResolvedValueOnce(new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } })));
  expect(await (await inspectionBlob(randomUUID())).text()).toBe('zip');
  await expect(inspectionBlob(randomUUID())).rejects.toEqual(new HttpFailure(403, 'UNAVAILABLE'));
  await expect(inspectionBlob(randomUUID())).rejects.toThrow('INVALID_INSPECTION');
});
it('terminates an inspection download at ten seconds even if transport ignores abort', async () => {
  vi.useFakeTimers(); const fetch = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => new Promise<Response>(() => {})); vi.stubGlobal('fetch', fetch);
  const pending = inspectionBlob(randomUUID()); const rejected = expect(pending).rejects.toThrow('REQUEST_TIMEOUT');
  await vi.advanceTimersByTimeAsync(10000); await rejected;
  expect((fetch.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
});

it('releases the inspection object URL after starting the browser download', async () => {
  vi.useFakeTimers(); const click = vi.fn(); const revoke = vi.fn();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('zip', { headers: { 'content-type': 'application/zip' } })));
  vi.stubGlobal('document', { createElement: () => ({ click, href: '', download: '' }) });
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:inspection', revokeObjectURL: revoke });
  await downloadInspection(randomUUID()); expect(click).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1000); expect(revoke).toHaveBeenCalledWith('blob:inspection'); expect(vi.getTimerCount()).toBe(0);
});

it('removes a saved version with a closed response and the same supplied retry identity', async () => {
  const candidateId = randomUUID(), requestId = randomUUID();
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ removed: true })).mockResolvedValueOnce(Response.json({ removed: true, unexpected: true }));
  vi.stubGlobal('fetch', fetch);
  expect(await removeCandidate(candidateId, requestId)).toEqual({ removed: true });
  expect(fetch.mock.calls[0]).toEqual([`/api/operator/candidates/${candidateId}/remove`, expect.objectContaining({ credentials: 'same-origin', method: 'POST', body: JSON.stringify({ requestId }) })]);
  await expect(removeCandidate(candidateId, requestId)).rejects.toThrow();
});
