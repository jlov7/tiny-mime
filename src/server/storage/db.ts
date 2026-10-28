import Database from 'better-sqlite3';
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const defaultDataDir = () => path.join(os.homedir(), 'Library', 'Application Support', 'TinyMime');
export function prepareDataDir(raw?: string) {
  const dir = raw || defaultDataDir();
  if (!path.isAbsolute(dir) || dir === process.cwd() || dir.startsWith(process.cwd() + path.sep)) throw new Error('DATA_DIR');
  mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700); return dir;
}
export function lockDataDir(dir: string): () => void {
  const file = path.join(dir, '.tiny-mime.lock');
  if (existsSync(file)) {
    const contents = readFileSync(file, 'utf8'); const pid = Number(contents.trim());
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('DATA_LOCK');
    try { process.kill(pid, 0); throw new Error('DATA_LOCK'); } catch (e: any) { if (e.code !== 'ESRCH') throw new Error('DATA_LOCK'); }
    unlinkSync(file);
  }
  const fd = openSync(file, 'wx', 0o600); writeFileSync(fd, String(process.pid)); closeSync(fd);
  return () => { if (existsSync(file) && readFileSync(file, 'utf8').trim() === String(process.pid)) unlinkSync(file); };
}
export function openPrivateDb(dir: string, name: 'ledger.sqlite' | 'research.sqlite' | 'fixture-rehearsals.sqlite' | 'rehearsal-workspace.sqlite') {
  const file = path.join(dir, name); const db = new Database(file); chmodSync(file, 0o600); db.pragma('journal_mode = DELETE'); db.pragma('foreign_keys = ON'); db.pragma('secure_delete = ON'); return db;
}
