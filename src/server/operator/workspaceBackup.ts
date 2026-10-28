import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { constants, closeSync, fstatSync, linkSync, lstatSync, mkdtempSync, openSync, readdirSync, readSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { CandidateStore } from './workspace.js';
import { workspaceRowSchema, workspaceRemovalSchema, validateWorkspaceRecords } from './workspaceRecords.js';

const filename = 'rehearsal-workspace.sqlite';
const maxBytes = 32 * 1024 * 1024, maxRows = 10000, timeoutMs = 10000;
const rowid = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const rowSchema = workspaceRowSchema.extend({ rowid });
const removalSchema = workspaceRemovalSchema.extend({ rowid });
type Row = z.infer<typeof rowSchema>;
type Removal = z.infer<typeof removalSchema>;
type Counts = { candidates: number; tombstones: number; removals: number };
export type WorkspaceReceipt = { status: 'OK'; path: string; counts: Counts; sha256: string };
class WorkspaceBackupError extends Error { constructor() { super('WORKSPACE_REJECTED'); } }
const reject = (): never => { throw new WorkspaceBackupError(); };

function absolute(raw: string): string {
  if (!isAbsolute(raw) || raw !== raw.trim() || raw.split(/[\\/]/).includes('..') || raw.includes('\0')) reject();
  return resolve(raw);
}
function privateDirectory(raw: string): string {
  const path = absolute(raw), info = lstatSync(path);
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(path) !== path || (info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()) reject();
  return path;
}
function privateFile(path: string) {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || (info.mode & 0o077) !== 0 || info.uid !== process.getuid?.() || info.size > maxBytes) reject();
  return info;
}
function absent(path: string) {
  try { lstatSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  reject();
}
function checkSidecars(path: string, allowWal: boolean) {
  for (const suffix of ['-wal', '-shm', '-journal']) {
    try { if (allowWal && suffix !== '-journal') privateFile(path + suffix); else { absent(path + suffix); } }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}
function sameFile(a: ReturnType<typeof fstatSync>, b: ReturnType<typeof fstatSync>) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}
function readStableFile(path: string) {
  const before = privateFile(path), fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!sameFile(before, fstatSync(fd))) reject();
    const bytes = Buffer.alloc(before.size); let offset = 0;
    while (offset < bytes.length) { const read = readSync(fd, bytes, offset, bytes.length - offset, offset); if (read === 0) reject(); offset += read; }
    if (readSync(fd, Buffer.alloc(1), 0, 1, offset) !== 0) reject();
    if (!sameFile(before, fstatSync(fd)) || !sameFile(before, lstatSync(path))) reject();
    return { bytes, identity: before };
  } finally { closeSync(fd); }
}
function readPrivateFile(path: string): Buffer {
  privateDirectory(dirname(path)); checkSidecars(path, false); return readStableFile(path).bytes;
}
function sourceFiles(source: string) {
  checkSidecars(source, true);
  const main = readStableFile(source);
  let wal: ReturnType<typeof readStableFile> | undefined;
  try { wal = readStableFile(source + '-wal'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return { main, wal };
}
function unchangedSource(before: ReturnType<typeof sourceFiles>, source: string) {
  const after = sourceFiles(source);
  if (!sameFile(before.main.identity, after.main.identity) || !before.main.bytes.equals(after.main.bytes) || Boolean(before.wal) !== Boolean(after.wal)) reject();
  if (before.wal && after.wal && (!sameFile(before.wal.identity, after.wal.identity) || !before.wal.bytes.equals(after.wal.bytes))) reject();
}
function lockDirectory(directory: string): () => void {
  const file = join(directory, '.tiny-mime.lock');
  let fd: number | undefined, identity: ReturnType<typeof fstatSync> | undefined;
  const release = () => {
    if (fd === undefined) return;
    const ownedFd = fd; fd = undefined;
    try {
      const current = lstatSync(file);
      if (identity && current.dev === identity.dev && current.ino === identity.ino) rmSync(file);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    finally { closeSync(ownedFd); }
  };
  try {
    fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    identity = fstatSync(fd); writeFileSync(fd, String(process.pid)); return release;
  } catch (error) { release(); throw error; }
}
function writeStagedFile(path: string, bytes: Buffer) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, bytes); } finally { closeSync(fd); }
}
function schema(db: Database.Database) {
  return db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all();
}
function expectedSchema() {
  const db = new Database(':memory:');
  try { new CandidateStore(db); return JSON.stringify(schema(db)); } finally { db.close(); }
}
const trustedSchema = expectedSchema();
function validate(bytes: Buffer): { rows: Row[]; removals: Removal[]; counts: Counts } {
  if (!bytes.length || bytes.length > maxBytes) reject();
  const deadline = Date.now() + timeoutMs;
  const checkTime = () => { if (Date.now() > deadline) reject(); };
  // Deserializing a bounded copy keeps untrusted bytes and journals off the destination filesystem.
  const db = new Database(bytes, { readonly: true, timeout: 1000 });
  try {
    db.pragma('trusted_schema = OFF'); db.pragma('query_only = ON');
    if (JSON.stringify(schema(db)) !== trustedSchema || db.pragma('integrity_check', { simple: true }) !== 'ok') reject();
    const rows = db.prepare('SELECT rowid,id,request_id,input_hash,payload FROM rehearsal_candidates ORDER BY rowid LIMIT ?').all(maxRows + 1).map(row => rowSchema.parse(row));
    const removals = db.prepare('SELECT rowid,request_id,candidate_id FROM rehearsal_candidate_removals ORDER BY rowid LIMIT ?').all(maxRows + 1).map(row => removalSchema.parse(row));
    if (rows.length > maxRows || removals.length > maxRows) reject();
    checkTime();
    return { rows, removals, counts: validateWorkspaceRecords(rows, removals) };
  } finally { db.close(); }
}
function receipt(path: string, bytes: Buffer, counts: Counts): WorkspaceReceipt { return { status: 'OK', path, counts, sha256: createHash('sha256').update(bytes).digest('hex') }; }
function reserve(path: string) { const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); closeSync(fd); }

export async function backupWorkspace(dataDir: string, outputPath: string): Promise<WorkspaceReceipt> {
  const directory = privateDirectory(dataDir), source = join(directory, filename), output = absolute(outputPath), parent = privateDirectory(dirname(output));
  absent(output); checkSidecars(output, false);
  const release = lockDirectory(directory);
  let staging: string | undefined, db: Database.Database | undefined;
  try {
    // The app must be stopped. Only copies are opened by SQLite, so source SHM is never touched.
    const original = sourceFiles(source);
    staging = mkdtempSync(join(parent, '.workspace-backup-'));
    const copied = join(staging, 'source.sqlite'), snapshot = join(staging, filename);
    writeStagedFile(copied, original.main.bytes);
    if (original.wal) writeStagedFile(copied + '-wal', original.wal.bytes);
    unchangedSource(original, source); reserve(snapshot);
    db = new Database(copied, { readonly: true, fileMustExist: true, timeout: 1000 });
    const deadline = Date.now() + timeoutMs, pageSize = db.pragma('page_size', { simple: true });
    if (typeof pageSize !== 'number' || pageSize < 512 || pageSize > 65536) reject();
    await db.backup(snapshot, { progress: ({ totalPages }) => { if (Date.now() > deadline || totalPages * Number(pageSize) > maxBytes) reject(); return 100; } });
    db.close(); db = undefined;
    const snapshotDb = new Database(snapshot, { timeout: 1000 });
    try { snapshotDb.pragma('journal_mode = DELETE'); } finally { snapshotDb.close(); }
    const bytes = readPrivateFile(snapshot), checked = validate(bytes);
    unchangedSource(original, source); privateDirectory(parent); absent(output); checkSidecars(output, false); linkSync(snapshot, output);
    return receipt(output, bytes, checked.counts);
  } finally { try { if (db?.open) db.close(); } finally { try { if (staging) rmSync(staging, { recursive: true }); } finally { release(); } } }
}

export function restoreWorkspace(backupPath: string, dataDir: string): WorkspaceReceipt {
  const backup = absolute(backupPath), destination = privateDirectory(dataDir), bytes = readPrivateFile(backup), checked = validate(bytes);
  if (readdirSync(destination).length !== 0) reject();
  const lock = join(destination, '.tiny-mime.lock'), release = lockDirectory(destination);
  let staging: string | undefined, db: Database.Database | undefined;
  try {
    if (readdirSync(destination).some(name => name !== basename(lock))) reject();
    staging = mkdtempSync(join(destination, '.workspace-restore-')); const restored = join(staging, filename); reserve(restored);
    db = new Database(restored, { timeout: 1000 }); db.pragma('journal_mode = DELETE'); db.pragma('secure_delete = ON');
    new CandidateStore(db);
    db.transaction(() => {
      const save = db!.prepare('INSERT INTO rehearsal_candidates (rowid,id,request_id,input_hash,payload) VALUES (?,?,?,?,?)');
      const remove = db!.prepare('INSERT INTO rehearsal_candidate_removals (rowid,request_id,candidate_id) VALUES (?,?,?)');
      for (const row of checked.rows) save.run(row.rowid, row.id, row.request_id, row.input_hash, row.payload);
      for (const row of checked.removals) remove.run(row.rowid, row.request_id, row.candidate_id);
    })();
    db.close(); db = undefined;
    const restoredBytes = readPrivateFile(restored); validate(restoredBytes); privateDirectory(destination);
    if (readdirSync(destination).some(name => name !== basename(lock) && name !== basename(staging!))) reject();
    const output = join(destination, filename); linkSync(restored, output);
    return receipt(output, restoredBytes, checked.counts);
  } finally { try { if (db?.open) db.close(); } finally { try { if (staging) rmSync(staging, { recursive: true }); } finally { release(); } } }
}
