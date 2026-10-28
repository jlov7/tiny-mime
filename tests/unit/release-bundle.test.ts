import { afterEach, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { buildPublicFiles } from '../../scripts/public-release.js';
import { sha256 } from '../../scripts/evidence.js';
import { prepareReleaseBundle, releaseBundleFiles } from '../../scripts/release-bundle.js';

const roots: string[] = [];
function fixture() {
  mkdirSync('.scratch', { recursive: true });
  const root = mkdtempSync(resolve('.scratch/release-bundle-test-')); roots.push(root);
  for (const [path, bytes] of buildPublicFiles().files) { const target = join(root, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes); }
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it('pairs deterministic source and offline preview with an exact checksum list and honest unrun status', () => {
  const result = releaseBundleFiles(), again = releaseBundleFiles();
  expect(result.directory).toBe(again.directory); expect(result.manifest.status).toBe('PREPARED');
  expect(result.manifest.verification).toBe('NOT_RUN_BY_BUNDLE_COMMAND');
  expect(result.manifest.qualifications.liveInteractiveApi).toBe('NOT RUN');
  expect([...result.files.keys()]).toEqual([...again.files.keys()]);
  for (const [path, bytes] of result.files) expect(bytes.equals(again.files.get(path)!), path).toBe(true);
  expect(result.files.size).toBe(6);
  for (const row of result.manifest.files) expect(sha256(result.files.get(row.path)!)).toBe(row.sha256);
  const checksums = result.files.get('SHA256SUMS')!.toString().trim().split('\n'); expect(checksums).toHaveLength(5);
  for (const line of checksums) { const [hash, name] = line.split('  '); expect(sha256(result.files.get(name)!)).toBe(hash); }
  expect(result.files.get('README_FIRST.md')!.toString()).toContain('do not adapt to a guess');
});

it('writes a content-addressed bundle and permits identical repeats without replacing files', () => {
  const root = fixture(), first = prepareReleaseBundle(root), second = prepareReleaseBundle(root);
  expect(second).toEqual(first); expect(first.status).toBe('PREPARED');
  expect(sha256(readFileSync(join(root, first.directory, first.archive)))).toBe(first.archiveSha256);
});

it('rejects a changed existing output without overwriting it', () => {
  const root = fixture(), first = prepareReleaseBundle(root), path = join(root, first.directory, 'README_FIRST.md');
  writeFileSync(path, 'Keep this existing content');
  expect(() => prepareReleaseBundle(root)).toThrow('BUNDLE_OUTPUT_CONFLICT');
  expect(readFileSync(path, 'utf8')).toBe('Keep this existing content');
});

it('rejects output parent and file links, including a dangling link', () => {
  const root = fixture(); symlinkSync('/nonexistent/external-output', join(root, 'artifacts'));
  expect(() => prepareReleaseBundle(root)).toThrow(); rmSync(join(root, 'artifacts'));
  const result = prepareReleaseBundle(root), path = join(root, result.directory, 'tiny-mime-preview.html');
  rmSync(path); symlinkSync('/nonexistent/private-output', path);
  expect(() => prepareReleaseBundle(root)).toThrow('BUNDLE_OUTPUT_CONFLICT');
});
