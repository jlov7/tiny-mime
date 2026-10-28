import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { canonicalHash } from '../../shared/hash.js';
import type { MotionScoreV1 } from '../../shared/score.js';
import { validateScore } from '../../shared/validateScore.js';
import { getScene } from './sceneBank.js';
import { backupWorkspaceSnapshot, previewWorkspaceRestore, restoreWorkspaceSnapshot } from './workspaceTransfer.js';

import { candidateInputSchema, candidateRemovalSchema } from './workspaceRecords.js';
export { candidateInputSchema, candidateRemovalSchema } from './workspaceRecords.js';
export type CandidateNote = { atMs: number; text: string };
export type CandidateSummary = { candidateId: string; sceneId: string; title: string; scoreHash: string; parentCandidateId: string | null; createdAt: string; noteCount: number };
export type Candidate = CandidateSummary & { score: MotionScoreV1; notes: CandidateNote[] };
export class CandidateError extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'NOT_FOUND' | 'IDEMPOTENCY_CONFLICT' | 'LIMITED') { super(code); }
}
type Stored = { input_hash: string; payload: string };
const summarize = ({ score: _score, notes: _notes, ...summary }: Candidate): CandidateSummary => summary;

export class CandidateStore {
  constructor(private db: Database.Database, private now: () => number = Date.now) {
    db.exec('CREATE TABLE IF NOT EXISTS rehearsal_candidates (id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, input_hash TEXT NOT NULL, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS rehearsal_candidate_removals (request_id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL)');
  }
  backup() { return backupWorkspaceSnapshot(this.db); }
  previewRestore(value: unknown) { return previewWorkspaceRestore(this.db, value); }
  restore(value: unknown) { return restoreWorkspaceSnapshot(this.db, value); }
  list(): CandidateSummary[] {
    return (this.db.prepare("SELECT payload FROM rehearsal_candidates WHERE payload != '' ORDER BY rowid DESC").all() as { payload: string }[]).map(row => summarize(JSON.parse(row.payload)));
  }
  read(id: string): Candidate | undefined {
    const row = this.db.prepare('SELECT payload FROM rehearsal_candidates WHERE id=?').get(id) as { payload: string } | undefined;
    return row?.payload ? JSON.parse(row.payload) : undefined;
  }
  remove(id: string, value: unknown): { removed: true } {
    const parsed = candidateRemovalSchema.safeParse(value);
    if (!parsed.success) throw new CandidateError('INVALID_INPUT');
    if (!z.uuidv4().check(z.lowercase()).safeParse(id).success) throw new CandidateError('NOT_FOUND');
    return this.db.transaction(() => {
      const prior = this.db.prepare('SELECT candidate_id FROM rehearsal_candidate_removals WHERE request_id=?').get(parsed.data.requestId) as { candidate_id: string } | undefined;
      if (prior) { if (prior.candidate_id !== id) throw new CandidateError('IDEMPOTENCY_CONFLICT'); return { removed: true as const }; }
      if (this.db.prepare('SELECT 1 FROM rehearsal_candidates WHERE request_id=?').get(parsed.data.requestId)) throw new CandidateError('IDEMPOTENCY_CONFLICT');
      if (!this.read(id)) throw new CandidateError('NOT_FOUND');
      if (this.list().some(candidate => candidate.parentCandidateId === id)) throw new CandidateError('LIMITED');
      // Retain only save identity and its digest so an old save cannot restore removed work.
      this.db.prepare("UPDATE rehearsal_candidates SET payload='' WHERE id=?").run(id);
      this.db.prepare('INSERT INTO rehearsal_candidate_removals (request_id,candidate_id) VALUES (?,?)').run(parsed.data.requestId, id);
      return { removed: true as const };
    })();
  }
  save(value: unknown): Candidate {
    const parsed = candidateInputSchema.safeParse(value);
    if (!parsed.success) throw new CandidateError('INVALID_INPUT');
    const input = parsed.data, scene = getScene(input.sceneId);
    if (!scene) throw new CandidateError('INVALID_INPUT');
    const validated = validateScore(JSON.stringify(input.score), scene.roster);
    if (!validated.ok || input.notes.some(note => note.atMs > validated.score.durationMs)) throw new CandidateError('INVALID_INPUT');
    const digest = canonicalHash(input);
    return this.db.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM rehearsal_candidate_removals WHERE request_id=?').get(input.requestId)) throw new CandidateError('IDEMPOTENCY_CONFLICT');
      const prior = this.db.prepare('SELECT input_hash,payload FROM rehearsal_candidates WHERE request_id=?').get(input.requestId) as Stored | undefined;
      if (prior) { if (prior.input_hash !== digest) throw new CandidateError('IDEMPOTENCY_CONFLICT'); if (!prior.payload) throw new CandidateError('NOT_FOUND'); return JSON.parse(prior.payload) as Candidate; }
      if (input.parentCandidateId !== null && this.read(input.parentCandidateId)?.sceneId !== input.sceneId) throw new CandidateError('INVALID_INPUT');
      if ((this.db.prepare("SELECT count(*) n FROM rehearsal_candidates WHERE payload != ''").get() as { n: number }).n >= 64) throw new CandidateError('LIMITED');
      const candidate: Candidate = { candidateId: randomUUID(), sceneId: input.sceneId, title: input.title, scoreHash: validated.scoreHash, parentCandidateId: input.parentCandidateId, createdAt: new Date(this.now()).toISOString(), noteCount: input.notes.length, score: validated.score, notes: input.notes };
      this.db.prepare('INSERT INTO rehearsal_candidates (id,request_id,input_hash,payload) VALUES (?,?,?,?)').run(candidate.candidateId, input.requestId, digest, JSON.stringify(candidate));
      return structuredClone(candidate);
    })();
  }
}
