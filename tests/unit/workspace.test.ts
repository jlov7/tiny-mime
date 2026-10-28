import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { CandidateStore, CandidateError } from '../../src/server/operator/workspace.js';
import { getScene } from '../../src/server/operator/sceneBank.js';
import { buildInspection } from '../../src/server/operator/inspection.js';
import { listShowcases } from '../../src/server/operator/showcase.js';
import { validateScore } from '../../src/shared/validateScore.js';
import { unzipSync, strFromU8 } from 'fflate';
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { openPrivateDb } from '../../src/server/storage/db.js';

const dbs: Database.Database[] = [];
afterEach(() => dbs.splice(0).forEach(db => db.close()));
function store() { const db = new Database(':memory:'); dbs.push(db); return new CandidateStore(db, () => 1800000000000); }
const input = () => ({ requestId: randomUUID(), sceneId: 'TM01', title: 'Candidate', score: getScene('TM01')!.score, parentCandidateId: null, notes: [{ atMs: 900, text: 'Inspect this pause.' }] });

describe('private rehearsal workspace', () => {
  it('saves immutable snapshots, summaries and exact idempotent retries', () => {
    const workspace = store(), body = input(); const a = workspace.save(body);
    expect(workspace.save(body)).toEqual(a);
    expect(workspace.read(a.candidateId)).toEqual(a);
    expect(workspace.list()).toEqual([{ candidateId: a.candidateId, sceneId: 'TM01', title: 'Candidate', scoreHash: a.scoreHash, parentCandidateId: null, createdAt: a.createdAt, noteCount: 1 }]);
    expect(() => workspace.save({ ...body, title: 'Changed' })).toThrow(CandidateError);
    const b = workspace.save({ ...input(), parentCandidateId: a.candidateId });
    expect(b.candidateId).not.toBe(a.candidateId); expect(b.parentCandidateId).toBe(a.candidateId);
    a.notes[0].text = 'Mutated outside'; expect(workspace.read(a.candidateId)!.notes[0].text).toBe('Inspect this pause.');
  });
  it('rejects invalid scores, incompatible parents, unknown scenes and note boundaries', () => {
    const workspace = store(); const parent = workspace.save(input());
    const bad = input(); bad.score.actors[1].keyframes[0].x = bad.score.actors[0].keyframes[0].x;
    for (const body of [bad, { ...input(), sceneId: 'TM07' }, { ...input(), extra: true }, { ...input(), parentCandidateId: randomUUID() }, { ...input(), notes: [{ atMs: 99999, text: 'Outside' }] }, { ...input(), notes: [{ atMs: 0, text: '\ud800' }] }, { ...input(), title: 'x'.repeat(81) }]) expect(() => workspace.save(body)).toThrow(CandidateError);
    expect(() => workspace.save({ ...input(), sceneId: 'TM09', score: getScene('TM09')!.score, parentCandidateId: parent.candidateId })).toThrow(CandidateError);
    expect(workspace.list()).toHaveLength(1);
  });
  it('retains idempotency and hashes when reopening its database, with bounded storage', () => {
    const workspace = store(), body = input(), saved = workspace.save(body);
    const reopened = new CandidateStore(dbs[0]); expect(reopened.save(body)).toEqual(saved);
    for (let i = 1; i < 64; i++) workspace.save(input());
    expect(workspace.list()).toHaveLength(64);
    expect(() => workspace.save(input())).toThrowError('LIMITED');
    expect(workspace.save(body)).toEqual(saved);
  });
  it('survives closing and reopening a private disk database', () => {
    mkdirSync('.scratch', { recursive: true }); const directory = mkdtempSync(resolve('.scratch/workspace-durable-'));
    let db = openPrivateDb(directory, 'rehearsal-workspace.sqlite');
    try {
      const body = input(), saved = new CandidateStore(db).save(body); db.close();
      db = openPrivateDb(directory, 'rehearsal-workspace.sqlite');
      const reopened = new CandidateStore(db); expect(reopened.read(saved.candidateId)).toEqual(saved); expect(reopened.save(body)).toEqual(saved);
      expect(statSync(join(directory, 'rehearsal-workspace.sqlite')).mode & 0o777).toBe(0o600);
    } finally { if (db.open) db.close(); rmSync(directory, { recursive: true }); }
  });
});

describe('authored examples and score-only inspection', () => {
  it('keeps three explicit authored examples valid and different without modifying the bank', () => {
    const originals = ['TM01', 'TM09', 'TM04'].map(id => getScene(id)!);
    const examples = listShowcases(); expect(examples).toHaveLength(3);
    examples.forEach(example => {
      expect(example.source).toBe('authored_fixture'); expect(example.humanReview).toBe('not_run');
      expect(example.left.scoreHash).not.toBe(example.right.scoreHash);
      for (const side of [example.left, example.right]) expect(validateScore(JSON.stringify(side.score), side.score.actors.map(({ id, shape, color }) => ({ id, shape, color })))).toMatchObject({ ok: true, scoreHash: side.scoreHash });
    });
    expect(['TM01', 'TM09', 'TM04'].map(id => getScene(id)!)).toEqual(originals);
  });
  it('builds a deterministic offline packet without private labels, notes or meaning', () => {
    const workspace = store(), candidate = workspace.save({ ...input(), title: 'PRIVATE_TITLE_MARKER', notes: [{ atMs: 0, text: 'PRIVATE_NOTE_MARKER' }] });
    const a = buildInspection(candidate), b = buildInspection(candidate); expect(a).toEqual(b);
    const files = unzipSync(a); expect(Object.keys(files).sort()).toEqual(['inspection-manifest.json', 'inspection.html', 'score.json']);
    const manifest = JSON.parse(strFromU8(files['inspection-manifest.json']));
    expect(manifest).toMatchObject({ kind: 'rehearsal_inspection', scoreHash: candidate.scoreHash, humanReview: 'not_run', containsGuessText: false });
    const text = Object.values(files).map(bytes => strFromU8(bytes)).join('\n');
    for (const marker of ['PRIVATE_TITLE_MARKER', 'PRIVATE_NOTE_MARKER', candidate.candidateId, getScene('TM01')!.meaning.target, process.cwd()]) expect(text).not.toContain(marker);
    expect(text).toContain("connect-src 'none'"); expect(text).toContain('Frame by frame');
    expect(JSON.parse(strFromU8(files['score.json']))).toEqual(candidate.score);
  });
});
