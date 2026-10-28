import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { sha256 } from './evidence.js';

export function safeSourcePath(path: string) {
  if (!path || path.includes('\\') || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.env') || ['.git', '.codex', '.claude', 'node_modules', 'dist', '.scratch', 'artifacts'].includes(part))) throw new Error('UNSAFE_SOURCE_PATH');
  if (!/^[A-Za-z0-9_./-]+$/.test(path) || /(?:^|\/)(?:auth|tokens?|credentials?)(?:[./]|$)/i.test(path)) throw new Error('UNSAFE_SOURCE_PATH');
  return path;
}
export function sourceBytes(root: string, path: string) {
  const file = resolve(root, safeSourcePath(path));
  for (let parent = file; parent !== resolve(root); parent = dirname(parent)) if (lstatSync(parent).isSymbolicLink()) throw new Error('SOURCE_SYMLINK');
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.size > 25 * 1024 * 1024) throw new Error('SOURCE_FILE_TYPE_OR_SIZE');
  return readFileSync(file);
}
const fileHash = z.strictObject({ path: z.string().refine(path => { try { safeSourcePath(path); return true; } catch { return false; } }), sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().nonnegative() });
const manifestSchema = z.strictObject({ version: z.literal(1), name: z.literal('tiny-mime'), releaseVersion: z.string().regex(/^\d+\.\d+\.\d+$/), surface: z.literal('local-source'), files: z.array(fileHash).min(1).max(1000) });
const generated = new Set(['.git', 'node_modules', 'dist', '.scratch', 'artifacts', 'test-results', 'playwright-report', '.DS_Store']);
export function verifyDistribution(root = process.cwd()) {
  const bytes = sourceBytes(root, 'RELEASE_MANIFEST.json');
  const manifest = manifestSchema.parse(JSON.parse(bytes.toString('utf8')));
  const expected = new Set(manifest.files.map(file => file.path));
  if (expected.size !== manifest.files.length || expected.has('RELEASE_MANIFEST.json')) throw new Error('DUPLICATE_DISTRIBUTION_FILE');
  for (const file of manifest.files) {
    const actual = sourceBytes(root, file.path);
    if (actual.length !== file.bytes || sha256(actual) !== file.sha256) throw new Error('DISTRIBUTION_HASH_MISMATCH ' + file.path);
  }
  const walk = (path: string) => {
    for (const entry of readdirSync(resolve(root, path), { withFileTypes: true })) {
      if (!path && generated.has(entry.name)) continue;
      const child = path ? path + '/' + entry.name : entry.name;
      if (entry.isSymbolicLink()) throw new Error('SOURCE_SYMLINK');
      if (entry.isDirectory()) walk(child);
      else if (child !== 'RELEASE_MANIFEST.json' && !expected.has(child)) throw new Error('UNLISTED_DISTRIBUTION_FILE');
    }
  };
  walk('');
  return { status: 'PASS', files: manifest.files.length, manifestSha256: sha256(bytes), paths: [...expected].sort() };
}
export function sourceIdentity(root = process.cwd()) {
  if (existsSync(resolve(root, '.git'))) {
    const git = (args: string[]) => {
      const child = spawnSync('git', ['-c', 'core.fsmonitor=false', ...args], { cwd: root, encoding: 'utf8', timeout: 15000 });
      if (child.status !== 0) throw new Error('SOURCE_METADATA_UNAVAILABLE');
      return child.stdout.trim();
    };
    return { sourceKind: 'git', sourceRevision: git(['rev-parse', 'HEAD']), sourceTree: git(['rev-parse', 'HEAD^{tree}']), sourceDirty: git(['status', '--porcelain']).length > 0 };
  }
  const distribution = verifyDistribution(root);
  return { sourceKind: 'source_archive', sourceRevision: null, sourceTree: distribution.manifestSha256, sourceDirty: false };
}
export function sourcePaths(root = process.cwd()) {
  if (!existsSync(resolve(root, '.git'))) return verifyDistribution(root).paths;
  const child = spawnSync('git', ['-c', 'core.fsmonitor=false', 'ls-files', '-z'], { cwd: root, encoding: 'utf8', timeout: 15000 });
  if (child.status !== 0) throw new Error('SOURCE_LIST_UNAVAILABLE');
  return child.stdout.split('\0').filter(Boolean);
}
