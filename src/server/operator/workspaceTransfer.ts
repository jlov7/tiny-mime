import type Database from 'better-sqlite3';
import { z } from 'zod';
import { canonicalHash } from '../../shared/hash.js';
import { parseJsonStrict } from '../../shared/parseJson.js';
import { validateWorkspaceRecords, workspaceDigest, workspaceMaxBytes, workspaceMaxRows, workspaceRemovalSchema, workspaceRowSchema, type WorkspaceCounts, type WorkspaceRemoval, type WorkspaceRow } from './workspaceRecords.js';

const contentSchema = z.strictObject({ rows: z.array(workspaceRowSchema).max(workspaceMaxRows), removals: z.array(workspaceRemovalSchema).max(workspaceMaxRows) });
const snapshotSchema = z.strictObject({ format: z.literal('tiny-mime-private-workspace'), version: z.literal(1), content: contentSchema, contentHash: workspaceDigest });
export const workspaceRestoreSchema = z.strictObject({ snapshot: snapshotSchema, expectedWorkspaceHash: workspaceDigest });
export type WorkspaceSnapshot = z.infer<typeof snapshotSchema>;
type Content = WorkspaceSnapshot['content'];
export type WorkspacePreview = { artifactHash: string; workspaceHash: string; incoming: WorkspaceCounts; additions: WorkspaceCounts; alreadyPresent: WorkspaceCounts; resulting: WorkspaceCounts };
export class WorkspaceTransferError extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'IDEMPOTENCY_CONFLICT' | 'STALE' | 'LIMITED') { super(code); }
}
const invalid = (): never => { throw new WorkspaceTransferError('INVALID_INPUT'); };
function checked(value: unknown): WorkspaceSnapshot {
  const parsed = snapshotSchema.safeParse(value);
  if (!parsed.success) invalid();
  const snapshot = parsed.data!;
  if (Buffer.byteLength(JSON.stringify(snapshot)) > workspaceMaxBytes || canonicalHash(snapshot.content) !== snapshot.contentHash) invalid();
  try { validateWorkspaceRecords(snapshot.content.rows, snapshot.content.removals); } catch { invalid(); }
  return snapshot;
}
export function parseWorkspaceSnapshot(raw: string): WorkspaceSnapshot {
  try { return checked(parseJsonStrict(raw, { maxBytes: workspaceMaxBytes, maxDepth: 14 })); } catch { return invalid(); }
}
function content(db: Database.Database): Content {
  return {
    rows: (db.prepare('SELECT id,request_id,input_hash,payload FROM rehearsal_candidates ORDER BY rowid LIMIT ?').all(workspaceMaxRows + 1) as WorkspaceRow[]).map(row => workspaceRowSchema.parse(row)),
    removals: (db.prepare('SELECT request_id,candidate_id FROM rehearsal_candidate_removals ORDER BY rowid LIMIT ?').all(workspaceMaxRows + 1) as WorkspaceRemoval[]).map(row => workspaceRemovalSchema.parse(row)),
  };
}
function stateHash(value: Content): string {
  // SQLite insertion order is local. Hash record meaning and identities for stale-preview checks.
  return canonicalHash({ rows: value.rows.map(row => ({ ...row, payload: row.payload ? JSON.parse(row.payload) : '' })).sort((a, b) => a.id.localeCompare(b.id)), removals: [...value.removals].sort((a, b) => a.request_id.localeCompare(b.request_id)) });
}
const count = (value: Content): WorkspaceCounts => ({ candidates: value.rows.filter(row => row.payload !== '').length, tombstones: value.rows.filter(row => row.payload === '').length, removals: value.removals.length });
function plan(current: Content, snapshot: WorkspaceSnapshot) {
  const rows = new Map(current.rows.map(row => [row.id, row])), removals = new Map(current.removals.map(row => [row.request_id, row]));
  const additions: Content = { rows: [], removals: [] }, existing: Content = { rows: [], removals: [] };
  for (const incoming of snapshot.content.rows) {
    const prior = rows.get(incoming.id);
    if (!prior) additions.rows.push(incoming);
    else {
      if (prior.request_id !== incoming.request_id || prior.input_hash !== incoming.input_hash || Boolean(prior.payload) !== Boolean(incoming.payload) || (prior.payload && canonicalHash(JSON.parse(prior.payload)) !== canonicalHash(JSON.parse(incoming.payload)))) throw new WorkspaceTransferError('IDEMPOTENCY_CONFLICT');
      existing.rows.push(incoming);
    }
  }
  for (const incoming of snapshot.content.removals) {
    const prior = removals.get(incoming.request_id);
    if (!prior) additions.removals.push(incoming);
    else { if (prior.candidate_id !== incoming.candidate_id) throw new WorkspaceTransferError('IDEMPOTENCY_CONFLICT'); existing.removals.push(incoming); }
  }
  const combined = { rows: [...current.rows, ...additions.rows], removals: [...current.removals, ...additions.removals] };
  if (combined.rows.length > workspaceMaxRows || combined.removals.length > workspaceMaxRows || count(combined).candidates > 64 || Buffer.byteLength(JSON.stringify(combined)) > workspaceMaxBytes - 256) throw new WorkspaceTransferError('LIMITED');
  try { validateWorkspaceRecords(combined.rows, combined.removals); } catch { throw new WorkspaceTransferError('IDEMPOTENCY_CONFLICT'); }
  const preview: WorkspacePreview = { artifactHash: snapshot.contentHash, workspaceHash: stateHash(current), incoming: count(snapshot.content), additions: count(additions), alreadyPresent: count(existing), resulting: count(combined) };
  return { additions, preview };
}
export function backupWorkspaceSnapshot(db: Database.Database): WorkspaceSnapshot {
  return db.transaction(() => {
    const saved = content(db);
    return checked({ format: 'tiny-mime-private-workspace', version: 1, content: saved, contentHash: canonicalHash(saved) });
  })();
}
export function previewWorkspaceRestore(db: Database.Database, value: unknown): WorkspacePreview {
  const snapshot = checked(value);
  return db.transaction(() => plan(content(db), snapshot).preview)();
}
export function restoreWorkspaceSnapshot(db: Database.Database, value: unknown): WorkspacePreview & { status: 'restored' | 'already_present' } {
  const input = workspaceRestoreSchema.safeParse(value);
  if (!input.success) invalid();
  const snapshot = checked(input.data!.snapshot);
  return db.transaction(() => {
    const { additions, preview } = plan(content(db), snapshot);
    if (!additions.rows.length && !additions.removals.length) return { ...preview, status: 'already_present' as const };
    if (preview.workspaceHash !== input.data!.expectedWorkspaceHash) throw new WorkspaceTransferError('STALE');
    const save = db.prepare('INSERT INTO rehearsal_candidates (id,request_id,input_hash,payload) VALUES (?,?,?,?)');
    const remove = db.prepare('INSERT INTO rehearsal_candidate_removals (request_id,candidate_id) VALUES (?,?)');
    for (const row of additions.rows) save.run(row.id, row.request_id, row.input_hash, row.payload);
    for (const row of additions.removals) remove.run(row.request_id, row.candidate_id);
    return { ...preview, status: 'restored' as const };
  }).immediate();
}
