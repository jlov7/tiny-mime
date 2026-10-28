import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { CandidateStore } from '../../src/server/operator/workspace.js';
import { getScene } from '../../src/server/operator/sceneBank.js';
import { openPrivateDb } from '../../src/server/storage/db.js';

const dbs: Database.Database[] = [];
afterEach(() => dbs.splice(0).forEach(db => { if (db.open) db.close(); }));
function setup() { const db = new Database(':memory:'); dbs.push(db); return { db, store: new CandidateStore(db) }; }
const input = () => ({ requestId: randomUUID(), sceneId: 'TM01', title: 'Synthetic saved version', score: getScene('TM01')!.score, parentCandidateId: null as string | null, notes: [{ atMs: 900, text: 'SYNTHETIC_PRIVATE_NOTE' }] });
const removal = () => ({ requestId: randomUUID() });

it('frees a full tray slot only after explicit removal and clears the removed payload', () => {
  const { db, store } = setup(); const firstInput = input(), first = store.save(firstInput);
  for (let index = 1; index < 64; index++) store.save(input());
  const survivors = store.list().filter(candidate => candidate.candidateId !== first.candidateId).map(candidate => store.read(candidate.candidateId));
  expect(store.list()).toHaveLength(64); expect(() => store.save(input())).toThrow('LIMITED');
  expect(store.remove(first.candidateId, removal())).toEqual({ removed: true });
  expect(store.read(first.candidateId)).toBeUndefined(); expect(store.list()).toHaveLength(63);
  expect(db.prepare('SELECT payload FROM rehearsal_candidates WHERE id=?').get(first.candidateId)).toEqual({ payload: '' });
  const replacement = store.save(input()); expect(store.list()).toHaveLength(64); expect(replacement.candidateId).not.toBe(first.candidateId);
  expect(survivors.map(candidate => store.read(candidate!.candidateId))).toEqual(survivors);
  expect(() => store.save(firstInput)).toThrow('NOT_FOUND'); expect(store.list()).toHaveLength(64);
});

it('preserves ancestors and unrelated versions until saved children are removed first', () => {
  const { store } = setup(); const parent = store.save(input()), child = store.save({ ...input(), parentCandidateId: parent.candidateId });
  const grandchild = store.save({ ...input(), parentCandidateId: child.candidateId }), sibling = store.save({ ...input(), parentCandidateId: parent.candidateId });
  const before = store.list().map(candidate => store.read(candidate.candidateId)), request = removal();
  expect(() => store.remove(parent.candidateId, request)).toThrow('LIMITED'); expect(() => store.remove(child.candidateId, removal())).toThrow('LIMITED');
  expect(store.list().map(candidate => store.read(candidate.candidateId))).toEqual(before);
  store.remove(grandchild.candidateId, removal()); store.remove(child.candidateId, removal());
  expect(() => store.remove(parent.candidateId, request)).toThrow('LIMITED');
  expect(store.read(sibling.candidateId)).toEqual(sibling);
  store.remove(sibling.candidateId, removal()); expect(store.remove(parent.candidateId, request)).toEqual({ removed: true }); expect(store.list()).toEqual([]);
});

it('keeps exact removal retries safe and rejects changed identity or cross-operation UUID reuse', () => {
  const { store } = setup(); const body = input(), first = store.save(body), second = store.save(input()), request = removal();
  expect(() => store.remove(first.candidateId, { requestId: body.requestId })).toThrow('IDEMPOTENCY_CONFLICT');
  expect(store.remove(first.candidateId, request)).toEqual({ removed: true }); expect(store.remove(first.candidateId, request)).toEqual({ removed: true });
  expect(() => store.remove(second.candidateId, request)).toThrow('IDEMPOTENCY_CONFLICT');
  expect(() => store.save({ ...input(), requestId: request.requestId })).toThrow('IDEMPOTENCY_CONFLICT');
  expect(() => store.save(body)).toThrow('NOT_FOUND'); expect(() => store.save({ ...body, title: 'Changed replay' })).toThrow('IDEMPOTENCY_CONFLICT');
  expect(() => store.remove(first.candidateId, removal())).toThrow('NOT_FOUND'); expect(store.read(second.candidateId)).toEqual(second);
});

it('rejects unknown removal fields and invalid UUIDs without altering saved versions', () => {
  const { store } = setup(); const saved = store.save(input());
  for (const value of [{}, { requestId: 'invalid' }, { requestId: randomUUID().toUpperCase() }, { ...removal(), extra: true }]) expect(() => store.remove(saved.candidateId, value)).toThrow('INVALID_INPUT');
  expect(() => store.remove('invalid', removal())).toThrow('NOT_FOUND'); expect(store.read(saved.candidateId)).toEqual(saved);
});

it('retains removal receipts, prevents resurrection and preserves survivors after database restart', () => {
  mkdirSync('.scratch', { recursive: true }); const directory = mkdtempSync(resolve('.scratch/candidate-removal-'));
  let db = openPrivateDb(directory, 'rehearsal-workspace.sqlite');
  try {
    let store = new CandidateStore(db); const body = input(), removed = store.save(body), survivor = store.save(input()), request = removal();
    store.remove(removed.candidateId, request); db.close(); db = openPrivateDb(directory, 'rehearsal-workspace.sqlite'); store = new CandidateStore(db);
    expect(store.read(removed.candidateId)).toBeUndefined(); expect(store.list()).toHaveLength(1); expect(store.read(survivor.candidateId)).toEqual(survivor);
    expect(store.remove(removed.candidateId, request)).toEqual({ removed: true }); expect(() => store.remove(survivor.candidateId, request)).toThrow('IDEMPOTENCY_CONFLICT');
    expect(() => store.save(body)).toThrow('NOT_FOUND'); expect(() => store.save({ ...body, notes: [] })).toThrow('IDEMPOTENCY_CONFLICT');
    expect(() => store.save({ ...input(), parentCandidateId: removed.candidateId })).toThrow('INVALID_INPUT'); expect(store.save(input())).toHaveProperty('candidateId');
    expect(db.prepare('SELECT payload FROM rehearsal_candidates WHERE id=?').get(removed.candidateId)).toEqual({ payload: '' });
  } finally { if (db.open) db.close(); rmSync(directory, { recursive: true }); }
});
