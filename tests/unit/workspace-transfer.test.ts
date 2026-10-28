import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { canonicalHash } from '../../src/shared/hash.js';
import { CandidateStore } from '../../src/server/operator/workspace.js';
import { getScene } from '../../src/server/operator/sceneBank.js';
import { parseWorkspaceSnapshot, type WorkspaceSnapshot } from '../../src/server/operator/workspaceTransfer.js';

const databases: Database.Database[] = [], directories: string[] = [];
afterEach(() => { for (const db of databases.splice(0)) if (db.open) db.close(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true }); });
function setup(file = ':memory:') { const db = new Database(file); databases.push(db); return { db, store: new CandidateStore(db, () => 1800000000000) }; }
const input = () => ({ requestId: randomUUID(), sceneId: 'TM01', title: 'PRIVATE_TITLE', score: getScene('TM01')!.score, parentCandidateId: null as string | null, notes: [{ atMs: 1000, text: 'PRIVATE_NOTE' }] });
function rehash(snapshot: WorkspaceSnapshot) { snapshot.contentHash = canonicalHash(snapshot.content); return snapshot; }

it('preserves exact candidates, lineage, identities, notes and tombstones through additive restore and restart', () => {
  const source = setup(), parentInput = input(), parent = source.store.save(parentInput), childInput = { ...input(), parentCandidateId: parent.candidateId }, child = source.store.save(childInput);
  const removedInput = input(), removed = source.store.save(removedInput), removal = { requestId: randomUUID() }; source.store.remove(removed.candidateId, removal);
  const snapshot = parseWorkspaceSnapshot(JSON.stringify(source.store.backup()));
  mkdirSync('.scratch', { recursive: true }); const directory = mkdtempSync(resolve('.scratch/transfer-')); directories.push(directory); const file = join(directory, 'workspace.sqlite');
  const destination = setup(file), survivor = destination.store.save(input());
  const preview = destination.store.previewRestore(snapshot);
  expect(preview.additions).toEqual({ candidates: 2, tombstones: 1, removals: 1 }); expect(destination.store.list()).toHaveLength(1);
  const request = { snapshot, expectedWorkspaceHash: preview.workspaceHash };
  expect(destination.store.restore(request).status).toBe('restored'); expect(destination.store.read(survivor.candidateId)).toEqual(survivor);
  expect(destination.store.read(parent.candidateId)).toEqual(parent); expect(destination.store.read(child.candidateId)).toEqual(child);
  expect(destination.store.save(parentInput)).toEqual(parent); expect(destination.store.save(childInput)).toEqual(child); expect(() => destination.store.save(removedInput)).toThrow('NOT_FOUND'); expect(destination.store.remove(removed.candidateId, removal)).toEqual({ removed: true });
  destination.db.close(); const restarted = setup(file);
  expect(restarted.store.restore(request).status).toBe('already_present'); expect(restarted.store.read(child.candidateId)).toEqual(child); expect(restarted.store.remove(removed.candidateId, removal)).toEqual({ removed: true });
  restarted.store.save(input()); expect(restarted.store.restore(request).status).toBe('already_present');
});

it.each(['hash', 'version', 'extra', 'score', 'digest', 'notes', 'identity', 'timestamp', 'parent', 'cycle', 'save-request', 'missing-removal', 'removal-request', 'removal-target', 'duplicate-removal'])('rejects malformed %s snapshots without writing', kind => {
  const source = setup(), a = source.store.save(input()), b = source.store.save({ ...input(), parentCandidateId: a.candidateId }), removed = source.store.save(input()); source.store.remove(removed.candidateId, { requestId: randomUUID() });
  const snapshot = source.store.backup(), row = snapshot.content.rows[0], value = JSON.parse(row.payload);
  if (kind === 'hash') snapshot.contentHash = '0'.repeat(64);
  if (kind === 'version') (snapshot as any).version = 2;
  if (kind === 'extra') (snapshot as any).secret = 'rejected';
  if (kind === 'score') value.score.actors[0].keyframes[0].x = value.score.actors[1].keyframes[0].x;
  if (kind === 'digest') value.scoreHash = 'a'.repeat(64);
  if (kind === 'notes') value.notes[0].atMs = 99999;
  if (kind === 'identity') value.candidateId = randomUUID();
  if (kind === 'timestamp') value.createdAt = '2026-01-01T00:00:00Z';
  if (kind === 'parent') value.parentCandidateId = randomUUID();
  if (kind === 'cycle') value.parentCandidateId = b.candidateId;
  row.payload = JSON.stringify(value);
  if (kind === 'save-request') snapshot.content.rows[1].request_id = row.request_id;
  if (kind === 'missing-removal') snapshot.content.removals = [];
  if (kind === 'removal-request') snapshot.content.removals[0].request_id = row.request_id;
  if (kind === 'removal-target') snapshot.content.removals[0].candidate_id = a.candidateId;
  if (kind === 'duplicate-removal') snapshot.content.removals.push({ ...snapshot.content.removals[0], request_id: randomUUID() });
  if (kind !== 'hash') rehash(snapshot);
  const target = setup(), before = target.store.backup();
  expect(() => target.store.previewRestore(snapshot)).toThrow('INVALID_INPUT');
  expect(() => target.store.restore({ snapshot, expectedWorkspaceHash: '0'.repeat(64) })).toThrow('INVALID_INPUT'); expect(target.store.backup()).toEqual(before);
});

it.each(['duplicate-key', 'infinite', 'deep', 'oversize', 'sqlite'])('rejects strict JSON %s input', kind => {
  const source = setup(); source.store.save(input()); const raw = JSON.stringify(source.store.backup());
  const malformed = kind === 'duplicate-key' ? raw.replace('"version":1', '"version":1,"version":1') : kind === 'infinite' ? raw.replace('"version":1', '"version":1e400') : kind === 'deep' ? '['.repeat(20) + '0' + ']'.repeat(20) : kind === 'oversize' ? ' '.repeat(32 * 1024 * 1024 + 1) : 'SQLite format 3';
  expect(() => parseWorkspaceSnapshot(malformed)).toThrow('INVALID_INPUT');
});

it.each(['id', 'save-request', 'cross-kind', 'local-tombstone', 'incoming-tombstone'])('rejects %s collisions atomically', kind => {
  const source = setup(), destination = setup(), body = input(), candidate = source.store.save(body);
  let snapshot = source.store.backup();
  if (kind === 'id') { const row = snapshot.content.rows[0], value = JSON.parse(row.payload); value.title = 'changed'; row.payload = JSON.stringify(value); row.input_hash = canonicalHash({ ...body, title: 'changed' }); rehash(snapshot); destination.store.restore({ snapshot: source.store.backup(), expectedWorkspaceHash: destination.store.previewRestore(source.store.backup()).workspaceHash }); }
  if (kind === 'save-request') destination.store.save({ ...input(), requestId: body.requestId });
  if (kind === 'cross-kind') { const local = destination.store.save(input()); destination.store.remove(local.candidateId, { requestId: body.requestId }); }
  if (kind === 'local-tombstone' || kind === 'incoming-tombstone') { destination.store.restore({ snapshot, expectedWorkspaceHash: destination.store.previewRestore(snapshot).workspaceHash }); if (kind === 'local-tombstone') destination.store.remove(candidate.candidateId, { requestId: randomUUID() }); else { source.store.remove(candidate.candidateId, { requestId: randomUUID() }); snapshot = source.store.backup(); } }
  const before = destination.store.backup(); expect(() => destination.store.previewRestore(snapshot)).toThrow('IDEMPOTENCY_CONFLICT'); expect(destination.store.backup()).toEqual(before);
});

it('requires a fresh preview when work changes and additions remain, then accepts an exact retry', () => {
  const source = setup(), destination = setup(); source.store.save(input()); const snapshot = source.store.backup(), preview = destination.store.previewRestore(snapshot);
  destination.store.save(input()); const before = destination.store.backup(); expect(() => destination.store.restore({ snapshot, expectedWorkspaceHash: preview.workspaceHash })).toThrow('STALE'); expect(destination.store.backup()).toEqual(before);
  const fresh = destination.store.previewRestore(snapshot), result = destination.store.restore({ snapshot, expectedWorkspaceHash: fresh.workspaceHash }); expect(result.status).toBe('restored');
  expect(destination.store.restore({ snapshot, expectedWorkspaceHash: fresh.workspaceHash }).status).toBe('already_present');
});

it('enforces the combined active cap before inserts and rolls back a mid-insert failure', () => {
  const source = setup(), destination = setup(); source.store.save(input()); source.store.save(input()); const snapshot = source.store.backup(), preview = destination.store.previewRestore(snapshot);
  destination.db.exec("CREATE TRIGGER reject_second BEFORE INSERT ON rehearsal_candidates WHEN (SELECT count(*) FROM rehearsal_candidates) = 1 BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END");
  expect(() => destination.store.restore({ snapshot, expectedWorkspaceHash: preview.workspaceHash })).toThrow(); expect(destination.store.list()).toEqual([]);
  destination.db.exec('DROP TRIGGER reject_second'); expect(destination.store.restore({ snapshot, expectedWorkspaceHash: preview.workspaceHash }).status).toBe('restored');
  for (let i = 0; i < 62; i++) destination.store.save(input());
  const another = setup(); another.store.save(input()); const before = destination.store.backup(); expect(() => destination.store.previewRestore(another.store.backup())).toThrow('LIMITED'); expect(destination.store.backup()).toEqual(before);
});

it('refuses stored history above the transfer cap without inserting or discarding identities', () => {
  const target = setup(), empty = setup().store.backup();
  const save = target.db.prepare("INSERT INTO rehearsal_candidates (id,request_id,input_hash,payload) VALUES (?,?,?,'')"), remove = target.db.prepare('INSERT INTO rehearsal_candidate_removals (request_id,candidate_id) VALUES (?,?)');
  target.db.transaction(() => { for (let i = 0; i < 10001; i++) { const id = randomUUID(); save.run(id, randomUUID(), '0'.repeat(64)); remove.run(randomUUID(), id); } })();
  expect(() => target.store.backup()).toThrow('INVALID_INPUT'); expect(() => target.store.previewRestore(empty)).toThrow('LIMITED');
  expect(target.db.prepare('SELECT count(*) n FROM rehearsal_candidates').get()).toEqual({ n: 10001 }); expect(target.db.prepare('SELECT count(*) n FROM rehearsal_candidate_removals').get()).toEqual({ n: 10001 });
});
