import Database from 'better-sqlite3';
import { randomUUID, createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, writeFileSync: vi.fn(actual.writeFileSync) };
});
import { CandidateStore } from '../../src/server/operator/workspace.js';
import { canonicalHash } from '../../src/shared/hash.js';
import { runWorkspaceBackup } from '../../scripts/workspace-backup.js';
import { runWorkspaceRestore } from '../../scripts/workspace-restore.js';
import { getScene } from '../../src/server/operator/sceneBank.js';
import { backupWorkspace, restoreWorkspace } from '../../src/server/operator/workspaceBackup.js';

const directories: string[] = [], dbs: Database.Database[] = [];
afterEach(() => { for (const db of dbs.splice(0)) if (db.open) db.close(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true }); });
function privateDir(parent?: string) { mkdirSync('.scratch', { recursive: true }); const dir = mkdtempSync(join(parent ?? resolve('.scratch'), 'workspace-backup-')); chmodSync(dir, 0o700); if (!parent) directories.push(dir); return dir; }
function setup() {
  const root = privateDir(), source = privateDir(root), output = privateDir(root), destination = privateDir(root);
  const db = new Database(join(source, 'rehearsal-workspace.sqlite')); dbs.push(db); chmodSync(db.name, 0o600);
  db.pragma('journal_mode = WAL'); db.pragma('wal_autocheckpoint = 0');
  const store = new CandidateStore(db, () => 1800000000000);
  return { root, source, output, destination, db, store, backup: join(output, 'private.sqlite') };
}
const input = () => ({ requestId: randomUUID(), sceneId: 'TM01', title: 'PRIVATE_TITLE', score: getScene('TM01')!.score, parentCandidateId: null as string | null, notes: [{ atMs: 900, text: 'PRIVATE_NOTE' }] });

it('snapshots committed WAL and restores exact versions, ordering, identities and removal receipts after restart', async () => {
  const s = setup(), parentInput = input(), parent = s.store.save(parentInput);
  const childInput = { ...input(), parentCandidateId: parent.candidateId }, child = s.store.save(childInput);
  const removedInput = input(), removed = s.store.save(removedInput), removal = { requestId: randomUUID() };
  s.store.remove(removed.candidateId, removal); expect(statSync(s.db.name + '-wal').size).toBeGreaterThan(0);
  writeFileSync(join(s.source, 'research.sqlite'), 'PARTICIPANT_MARKER', { mode: 0o600 });
  const result = await backupWorkspace(s.source, s.backup);
  expect(result).toMatchObject({ status: 'OK', path: s.backup, counts: { candidates: 2, tombstones: 1, removals: 1 } });
  expect(result.sha256).toBe(createHash('sha256').update(readFileSync(s.backup)).digest('hex'));
  expect(JSON.stringify(result)).not.toContain('PRIVATE_'); expect(statSync(s.backup).mode & 0o777).toBe(0o600);
  expect(readdirSync(s.output)).toEqual(['private.sqlite']); expect(readFileSync(s.backup).includes(Buffer.from('PARTICIPANT_MARKER'))).toBe(false);
  const restored = restoreWorkspace(s.backup, s.destination); expect(restored.counts).toEqual(result.counts);
  expect(restored.sha256).toBe(createHash('sha256').update(readFileSync(restored.path)).digest('hex'));
  expect(readdirSync(s.destination)).toEqual(['rehearsal-workspace.sqlite']);
  let db = new Database(join(s.destination, 'rehearsal-workspace.sqlite')); dbs.push(db);
  let store = new CandidateStore(db); expect(store.list()).toEqual(s.store.list()); expect(store.read(parent.candidateId)).toEqual(parent); expect(store.read(child.candidateId)).toEqual(child);
  expect(store.save(parentInput)).toEqual(parent); expect(store.save(childInput)).toEqual(child);
  expect(store.remove(removed.candidateId, removal)).toEqual({ removed: true }); expect(() => store.save(removedInput)).toThrow('NOT_FOUND');
  expect(() => store.save({ ...input(), requestId: removal.requestId })).toThrow('IDEMPOTENCY_CONFLICT');
  db.close(); db = new Database(join(s.destination, 'rehearsal-workspace.sqlite')); dbs.push(db); store = new CandidateStore(db);
  expect(store.read(child.candidateId)).toEqual(child); expect(() => store.save(removedInput)).toThrow('NOT_FOUND');
});

it.each(['score', 'hash', 'notes', 'identity', 'parent', 'cycle', 'extra', 'receipt', 'request', 'schema', 'trigger', 'corrupt'])('rejects %s tampering before changing the empty destination', async kind => {
  const s = setup(), a = s.store.save(input()), b = s.store.save({ ...input(), parentCandidateId: a.candidateId });
  await backupWorkspace(s.source, s.backup);
  if (kind === 'corrupt') writeFileSync(s.backup, 'invalid sqlite');
  else {
    const db = new Database(s.backup);
    try {
      const row = db.prepare('SELECT request_id,payload FROM rehearsal_candidates WHERE id=?').get(a.candidateId) as { request_id: string; payload: string }, value = JSON.parse(row.payload);
      if (kind === 'score') value.score.actors[0].keyframes[0].x = value.score.actors[1].keyframes[0].x;
      if (kind === 'hash') value.scoreHash = 'a'.repeat(64);
      if (kind === 'notes') value.notes[0].atMs = 99999;
      if (kind === 'identity') value.candidateId = randomUUID();
      if (kind === 'parent') value.parentCandidateId = randomUUID();
      if (kind === 'cycle') value.parentCandidateId = b.candidateId;
      if (kind === 'extra') value.extra = true;
      const inputHash = canonicalHash({ requestId: row.request_id, sceneId: value.sceneId, title: value.title, score: value.score, parentCandidateId: value.parentCandidateId, notes: value.notes });
      db.prepare('UPDATE rehearsal_candidates SET input_hash=?,payload=? WHERE id=?').run(inputHash, JSON.stringify(value), a.candidateId);
      if (kind === 'receipt') db.prepare('INSERT INTO rehearsal_candidate_removals VALUES (?,?)').run(randomUUID(), a.candidateId);
      if (kind === 'request') db.prepare('UPDATE rehearsal_candidates SET request_id=? WHERE id=?').run(randomUUID(), a.candidateId);
      if (kind === 'schema') db.exec('CREATE TABLE participant_data(secret TEXT)');
      if (kind === 'trigger') db.exec('CREATE TRIGGER unsafe AFTER INSERT ON rehearsal_candidates BEGIN DELETE FROM rehearsal_candidates; END');
    } finally { db.close(); }
  }
  const bytes = readFileSync(s.backup); expect(() => restoreWorkspace(s.backup, s.destination)).toThrow();
  expect(readdirSync(s.destination)).toEqual([]); expect(readFileSync(s.backup)).toEqual(bytes);
});

it('refuses symlink paths, nonprivate paths, existing outputs and nonempty destinations without overwriting', async () => {
  const s = setup(); s.store.save(input()); await backupWorkspace(s.source, s.backup); const original = readFileSync(s.backup);
  await expect(backupWorkspace(s.source, s.backup)).rejects.toThrow(); expect(readFileSync(s.backup)).toEqual(original);
  writeFileSync(join(s.destination, 'retain.txt'), 'retained'); expect(() => restoreWorkspace(s.backup, s.destination)).toThrow(); expect(readdirSync(s.destination)).toEqual(['retain.txt']);
  const empty = privateDir(s.root), linked = join(s.root, 'linked'); symlinkSync(empty, linked);
  expect(() => restoreWorkspace(s.backup, linked)).toThrow(); await expect(backupWorkspace(s.source, join(linked, 'out.sqlite'))).rejects.toThrow(); expect(readdirSync(empty)).toEqual([]);
  const linkedFile = join(s.output, 'linked.sqlite'); symlinkSync(s.backup, linkedFile); expect(() => restoreWorkspace(linkedFile, empty)).toThrow();
  chmodSync(empty, 0o755); expect(() => restoreWorkspace(s.backup, empty)).toThrow(); expect(readdirSync(empty)).toEqual([]);
  const dbLink = join(privateDir(s.root), 'rehearsal-workspace.sqlite'); symlinkSync(s.db.name, dbLink); await expect(backupWorkspace(resolve(dbLink, '..'), join(s.output, 'other.sqlite'))).rejects.toThrow();
  expect(existsSync(join(s.output, 'other.sqlite'))).toBe(false); expect(readFileSync(s.backup)).toEqual(original);
});

it('keeps CLI receipts and errors structured without returning private payloads or raw errors', async () => {
  const s = setup(); s.store.save(input());
  expect(await runWorkspaceBackup([])).toEqual({ output: { status: 'ERROR', code: 'ARGUMENTS_INVALID' }, exitCode: 1 });
  expect(runWorkspaceRestore(['--backup', s.backup, '--data-dir', s.destination])).toEqual({ output: { status: 'ERROR', code: 'WORKSPACE_REJECTED' }, exitCode: 1 });
  const result = await runWorkspaceBackup(['--data-dir', s.source, '--out', s.backup]); expect(result.exitCode).toBe(0);
  expect(Object.keys(result.output).sort()).toEqual(['counts', 'path', 'sha256', 'status']); expect(JSON.stringify(result.output)).not.toContain('PRIVATE_');
  const restored = runWorkspaceRestore(['--backup', s.backup, '--data-dir', s.destination]); expect(restored.exitCode).toBe(0);
  const bytes = readFileSync(join(s.destination, 'rehearsal-workspace.sqlite'));
  expect(runWorkspaceRestore(['--backup', s.backup, '--data-dir', s.destination]).exitCode).toBe(1);
  expect(readFileSync(join(s.destination, 'rehearsal-workspace.sqlite'))).toEqual(bytes);
});

it('rejects self-consistent inputs above the active cap and tombstones missing their receipts', async () => {
  const s = setup(), body = input(), candidate = s.store.save(body); await backupWorkspace(s.source, s.backup);
  const db = new Database(s.backup);
  try {
    const insert = db.prepare('INSERT INTO rehearsal_candidates (id,request_id,input_hash,payload) VALUES (?,?,?,?)');
    for (let index = 1; index <= 64; index++) {
      const next = { ...body, requestId: randomUUID() }, value = { ...candidate, candidateId: randomUUID() };
      insert.run(value.candidateId, next.requestId, canonicalHash(next), JSON.stringify(value));
    }
  } finally { db.close(); }
  expect(() => restoreWorkspace(s.backup, s.destination)).toThrow(); expect(readdirSync(s.destination)).toEqual([]);
  const broken = new Database(s.backup); broken.prepare("UPDATE rehearsal_candidates SET payload='' ").run(); broken.close();
  expect(() => restoreWorkspace(s.backup, s.destination)).toThrow(); expect(readdirSync(s.destination)).toEqual([]);
});

it('rejects orphan output and input journals and oversized files without publishing or restoring', async () => {
  const s = setup(); s.store.save(input()); writeFileSync(s.backup + '-wal', 'retain', { mode: 0o600 });
  await expect(backupWorkspace(s.source, s.backup)).rejects.toThrow(); expect(existsSync(s.backup)).toBe(false); expect(readFileSync(s.backup + '-wal', 'utf8')).toBe('retain');
  const clean = join(s.output, 'clean.sqlite'); await backupWorkspace(s.source, clean);
  writeFileSync(clean + '-journal', 'retain', { mode: 0o600 }); expect(() => restoreWorkspace(clean, s.destination)).toThrow(); expect(readdirSync(s.destination)).toEqual([]);
  const oversized = join(s.output, 'oversized.sqlite'); writeFileSync(oversized, Buffer.alloc(32 * 1024 * 1024 + 1), { mode: 0o600 });
  expect(() => restoreWorkspace(oversized, s.destination)).toThrow(); expect(readdirSync(s.destination)).toEqual([]);
});

it('cleans only its owned restore lock when writing its PID fails, allowing a later retry', async () => {
  const s = setup(); s.store.save(input()); await backupWorkspace(s.source, s.backup);
  vi.mocked(writeFileSync).mockImplementationOnce(() => { throw Object.assign(new Error('synthetic disk full'), { code: 'ENOSPC' }); });
  expect(() => restoreWorkspace(s.backup, s.destination)).toThrow(); expect(readdirSync(s.destination)).toEqual([]);
  expect(restoreWorkspace(s.backup, s.destination).status).toBe('OK');
});

it('retains main, WAL and SHM bytes and refuses existing application locks without opening source SQLite', async () => {
  const s = setup(); s.store.save(input());
  const names = readdirSync(s.source).sort(), before = names.map(name => readFileSync(join(s.source, name)));
  await backupWorkspace(s.source, s.backup);
  expect(readdirSync(s.source).sort()).toEqual(names); expect(names.map(name => readFileSync(join(s.source, name)))).toEqual(before);
  const lock = join(s.source, '.tiny-mime.lock'); writeFileSync(lock, 'preexisting owner', { mode: 0o600 });
  await expect(backupWorkspace(s.source, join(s.output, 'blocked.sqlite'))).rejects.toThrow(); expect(readFileSync(lock, 'utf8')).toBe('preexisting owner');
  expect(names.map(name => readFileSync(join(s.source, name)))).toEqual(before);
});

it('backs up stopped committed WAL with no SHM without creating or changing any original sidecar', async () => {
  const s = setup(), body = input(), candidate = s.store.save(body), stopped = privateDir(s.root);
  const database = readFileSync(s.db.name), wal = readFileSync(s.db.name + '-wal'); s.db.close();
  writeFileSync(join(stopped, 'rehearsal-workspace.sqlite'), database, { mode: 0o600 });
  writeFileSync(join(stopped, 'rehearsal-workspace.sqlite-wal'), wal, { mode: 0o600 });
  const before = readdirSync(stopped).sort(); await backupWorkspace(stopped, s.backup);
  expect(readdirSync(stopped).sort()).toEqual(before); expect(readFileSync(join(stopped, 'rehearsal-workspace.sqlite'))).toEqual(database); expect(readFileSync(join(stopped, 'rehearsal-workspace.sqlite-wal'))).toEqual(wal);
  restoreWorkspace(s.backup, s.destination); const db = new Database(join(s.destination, 'rehearsal-workspace.sqlite')); dbs.push(db);
  expect(new CandidateStore(db).read(candidate.candidateId)).toEqual(candidate); expect(new CandidateStore(db).save(body)).toEqual(candidate);
});

it('cleans backup PID-write and staged partial-write failures without touching original bytes or unrelated files', async () => {
  const s = setup(); s.store.save(input()); const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  const names = readdirSync(s.source).sort(), before = names.map(name => readFileSync(join(s.source, name)));
  vi.mocked(writeFileSync).mockImplementationOnce(() => { throw Object.assign(new Error('synthetic disk full'), { code: 'ENOSPC' }); });
  await expect(backupWorkspace(s.source, s.backup)).rejects.toThrow(); expect(readdirSync(s.source).sort()).toEqual(names); expect(readdirSync(s.output)).toEqual([]);
  vi.mocked(writeFileSync).mockImplementationOnce(actual.writeFileSync).mockImplementationOnce((file) => { actual.writeFileSync(file, 'partial'); throw Object.assign(new Error('synthetic disk full'), { code: 'ENOSPC' }); });
  await expect(backupWorkspace(s.source, s.backup)).rejects.toThrow(); expect(readdirSync(s.source).sort()).toEqual(names); expect(readdirSync(s.output)).toEqual([]);
  expect(names.map(name => readFileSync(join(s.source, name)))).toEqual(before); expect((await backupWorkspace(s.source, s.backup)).status).toBe('OK');
});

it('rejects a workspace changed by an external SQLite writer during staged backup and releases its owned lock', async () => {
  const s = setup(); s.store.save(input()); const original = Database.prototype.backup;
  const changed = vi.spyOn(Database.prototype, 'backup').mockImplementationOnce(function (this: Database.Database, ...args) {
    s.store.save(input()); return original.apply(this, args);
  });
  try { await expect(backupWorkspace(s.source, s.backup)).rejects.toThrow(); }
  finally { changed.mockRestore(); }
  expect(existsSync(s.backup)).toBe(false); expect(existsSync(join(s.source, '.tiny-mime.lock'))).toBe(false); expect(readdirSync(s.output)).toEqual([]);
  expect(s.store.list()).toHaveLength(2); expect((await backupWorkspace(s.source, s.backup)).status).toBe('OK');
});
