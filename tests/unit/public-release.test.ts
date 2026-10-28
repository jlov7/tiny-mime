import { afterEach, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { buildPublicFiles, checkPublicImages, checkPublicLinks, publicFindings, publicZip } from '../../scripts/public-release.js';
import { safeSourcePath, sourceBytes, sourceIdentity, sourcePaths, verifyDistribution } from '../../scripts/source-distribution.js';
import { publicSourcePackPolicy, sha256, verifySourcePack } from '../../scripts/evidence.js';

const roots: string[] = [];
function fixture() { mkdirSync('.scratch', { recursive: true }); const root = mkdtempSync(resolve('.scratch/public-release-test-')); roots.push(root); return root; }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function distribution() {
  const root = fixture(), result = buildPublicFiles();
  for (const [path, bytes] of result.files) { const target = resolve(root, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes); }
  return { root, ...result };
}

it('rejects stale screenshot hashes and missing or duplicate image provenance', () => {
  const { files } = buildPublicFiles();
  const path = 'docs/images/directing-workbench-desktop.png', bytes = files.get(path)!;
  files.set(path, Buffer.concat([bytes, Buffer.from('changed')]));
  expect(() => checkPublicImages(files)).toThrow('PUBLIC_IMAGE_HASH_MISMATCH'); files.set(path, bytes);
  const manifestPath = 'docs/images/PROVENANCE.json', original = files.get(manifestPath)!;
  const manifest = JSON.parse(original.toString());
  const removed = manifest.images.pop(); files.set(manifestPath, Buffer.from(JSON.stringify(manifest)));
  expect(() => checkPublicImages(files)).toThrow('PUBLIC_IMAGE_FILE_SET');
  manifest.images.push(removed, removed); files.set(manifestPath, Buffer.from(JSON.stringify(manifest)));
  expect(() => checkPublicImages(files)).toThrow('PUBLIC_IMAGE_FILE_SET');
  files.delete(manifestPath); expect(() => checkPublicImages(files)).toThrow('PUBLIC_IMAGE_PROVENANCE_INVALID');
  files.set(manifestPath, original); expect(() => checkPublicImages(files)).not.toThrow();
});

it('rejects traversal, credentials, environment paths and links before reading their targets', () => {
  for (const path of ['../escape', '/escape', 'src/../escape', 'src//file', 'src\\file', '.env', 'src/.env.local', 'auth.json', '.git/config', 'node_modules/file', 'artifacts/private', 'src/.scratch/file', 'C:/escape']) expect(() => safeSourcePath(path)).toThrow('UNSAFE_SOURCE_PATH');
  expect(safeSourcePath('src/server/http.ts')).toBe('src/server/http.ts');
  const root = fixture(); symlinkSync('/nonexistent/private-material', resolve(root, 'src'));
  expect(() => sourceBytes(root, 'src/file.ts')).toThrow();
});

it('exports an exact unchanged public specification subset without private plans or handoffs', () => {
  const before = verifySourcePack(), original = readFileSync('Tiny_Mime_Review_Source_Pack/MANIFEST.sha256');
  const result = buildPublicFiles(), policy = publicSourcePackPolicy();
  const forbidden = ['.git/config', '.env.example', 'START_HERE_CODEX.md', 'release/public/START_HERE_CODEX.txt', 'release/source-pack-redactions.json', 'Tiny_Mime_Complete_Plan.md', 'Tiny_Mime_Build_Review_Pack.docx', 'docs/SUBSCRIPTION_QUALITY_PLAN.md', 'docs/subscription-quality-receipt.json', ...policy.entries.filter(entry => entry.disposition === 'omit').map(entry => 'Tiny_Mime_Review_Source_Pack/' + entry.path)];
  const zipEntries = unzipSync(publicZip(result.files, result.version)), prefix = 'tiny-mime-' + result.version + '/';
  for (const path of forbidden) { expect(result.files.has(path), path).toBe(false); expect(zipEntries[prefix + path], path).toBeUndefined(); }
  expect(verifySourcePack()).toEqual(before); expect(readFileSync('Tiny_Mime_Review_Source_Pack/MANIFEST.sha256').equals(original)).toBe(true);
  const provenance = JSON.parse(result.files.get('SOURCE_PROVENANCE.json')!.toString());
  expect(provenance).toMatchObject({ version: 2, originalEntries: 56, distributedEntries: 36, originalManifestSha256: policy.originalManifestSha256, distributedManifestSha256: policy.subsetManifestSha256 });
  expect(provenance.omitted).toHaveLength(20); expect(provenance.retained).toHaveLength(36);
  for (const entry of provenance.retained) { expect(result.files.get(entry.path)!.equals(readFileSync(entry.path)), entry.path).toBe(true); expect(sha256(result.files.get(entry.path)!)).toBe(entry.sha256); }
  expect(sha256(result.files.get('Tiny_Mime_Review_Source_Pack/MANIFEST.sha256')!)).toBe(policy.subsetManifestSha256);
  expect(result.files.get('AGENTS.md')!.equals(readFileSync('release/public/AGENTS.txt'))).toBe(true);
  expect(publicFindings(result.files)).toEqual([]);
});

it('produces identical archive bytes and an exact safe file set independent of map insertion order', () => {
  const result = buildPublicFiles(), first = publicZip(result.files, result.version), second = publicZip(new Map([...result.files].reverse()), result.version);
  expect(first.equals(second)).toBe(true);
  const entries = unzipSync(first), prefix = 'tiny-mime-' + result.version + '/';
  expect(Object.keys(entries).sort()).toEqual([...result.files.keys()].map(path => prefix + path).sort());
  for (const [path, bytes] of result.files) expect(Buffer.from(entries[prefix + path]).equals(bytes), path).toBe(true);
  const timezone = process.env.TZ;
  try {
    process.env.TZ = 'UTC'; const utc = publicZip(result.files, result.version);
    process.env.TZ = 'America/Los_Angeles'; expect(publicZip(result.files, result.version).equals(utc)).toBe(true);
  } finally { if (timezone === undefined) delete process.env.TZ; else process.env.TZ = timezone; }
});

it('detects synthetic home paths, file URLs, provider tokens and private keys without echoing their values', () => {
  const cases = ['/' + 'Users/example/project/file', '/' + 'home/example/project/file', '/' + ['private', 'var', 'folders', 'test'].join('/'), 'C:' + '\\Users\\example\\project', 'file:' + '///example/file', 'sk-proj-' + 'x'.repeat(32), 'github_pat_' + 'x'.repeat(45), '-----BEGIN ' + 'PRIVATE KEY-----', 'api_key=' + '"' + 'x'.repeat(32) + '"'];
  for (const value of cases) {
    const findings = publicFindings(new Map([['README.md', Buffer.from('first line\n' + value)]]));
    expect(findings).toHaveLength(1); expect(findings[0]).toMatchObject({ path: 'README.md', line: 2 });
    expect(JSON.stringify(findings)).not.toContain(value);
  }
  expect(publicFindings(new Map([['README.md', Buffer.from('http://127.0.0.1:4317')]]))).toEqual([]);
});

it('rejects broken relative links and accepts existing local targets and external URLs', () => {
  const files = new Map([['README.md', Buffer.from('[usage](docs/USAGE.md#start) [external](https://example.invalid)')], ['docs/USAGE.md', Buffer.from('# start')]]);
  expect(() => checkPublicLinks(files)).not.toThrow(); files.delete('docs/USAGE.md');
  expect(() => checkPublicLinks(files)).toThrow('BROKEN_PUBLIC_LINK');
});

it('verifies an extracted source archive without inheriting parent Git identity and can package it again', () => {
  const result = distribution(), checked = verifyDistribution(result.root);
  expect(checked.status).toBe('PASS'); expect(checked.files).toBe(result.files.size - 1);
  expect(sourceIdentity(result.root)).toEqual({ sourceKind: 'source_archive', sourceRevision: null, sourceTree: checked.manifestSha256, sourceDirty: false });
  expect(sourcePaths(result.root)).toEqual(checked.paths);
  expect(verifySourcePack(result.root)).toMatchObject({ scope: 'public-specification-subset', entries: 36, originalEntries: 56, omittedEntries: 20 });
  expect(publicZip(buildPublicFiles(result.root).files, result.version).equals(publicZip(result.files, result.version))).toBe(true);
  mkdirSync(resolve(result.root, 'node_modules')); writeFileSync(resolve(result.root, 'node_modules/generated'), 'excluded installed dependency');
  expect(verifyDistribution(result.root).status).toBe('PASS');
});

it('fails distribution verification on tampering, missing source, extra source, duplicate entries and links', () => {
  const result = distribution(), readme = result.files.get('README.md')!;
  writeFileSync(resolve(result.root, 'README.md'), 'tampered'); expect(() => verifyDistribution(result.root)).toThrow('DISTRIBUTION_HASH_MISMATCH');
  rmSync(resolve(result.root, 'README.md')); expect(() => verifyDistribution(result.root)).toThrow();
  writeFileSync(resolve(result.root, 'README.md'), readme); writeFileSync(resolve(result.root, 'unexpected.txt'), 'extra'); expect(() => verifyDistribution(result.root)).toThrow('UNLISTED_DISTRIBUTION_FILE');
  rmSync(resolve(result.root, 'unexpected.txt')); rmSync(resolve(result.root, 'README.md')); symlinkSync('/nonexistent/private-material', resolve(result.root, 'README.md')); expect(() => verifyDistribution(result.root)).toThrow('SOURCE_SYMLINK');
  rmSync(resolve(result.root, 'README.md')); writeFileSync(resolve(result.root, 'README.md'), readme);
  const manifest = JSON.parse(result.files.get('RELEASE_MANIFEST.json')!.toString()); manifest.files.push(manifest.files[0]); writeFileSync(resolve(result.root, 'RELEASE_MANIFEST.json'), JSON.stringify(manifest));
  expect(() => verifyDistribution(result.root)).toThrow('DUPLICATE_DISTRIBUTION_FILE');
});

it('fails closed when release policy names forbidden or duplicate inputs and when a specification hash changes', () => {
  const result = distribution(), policyPath = resolve(result.root, 'release/public-files.json');
  const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
  policy.files.push({ path: '.env.local' }); writeFileSync(policyPath, JSON.stringify(policy)); expect(() => buildPublicFiles(result.root)).toThrow('UNSAFE_SOURCE_PATH');
  policy.files.pop();
  for (const path of ['operator.sqlite', 'operator.db-wal', 'operator.sqlite3-shm', 'operator.jsonl', 'operator.log', 'private.pem', 'backup.zip', 'RELEASE_MANIFEST.json', 'SOURCE_PROVENANCE.json', 'START_HERE_CODEX.md', 'release/public/START_HERE_CODEX.txt', 'Tiny_Mime_Complete_Plan.md', 'docs/DIRECTING_WORKFLOW_PLAN.md', 'docs/IMPLEMENTATION_LEDGER.md', 'docs/ADVERSARIAL_REVIEW.md', 'docs/BUILD_REPORT.md', 'docs/QUALITY_RELEASE.md', 'docs/QUALITY_EVALUATION.md', 'docs/QUALITY_IMPROVEMENT_DESIGN.md', 'docs/SUBSCRIPTION_QUALITY_PLAN.md', 'docs/subscription-quality-receipt.json', 'chapters/04_implementation_plan.md', 'chapters/05_independent_review_prompt.md', 'supplements/phase-a-coding-brief.md', ...publicSourcePackPolicy().entries.filter(entry => entry.disposition === 'omit').map(entry => 'Tiny_Mime_Review_Source_Pack/' + entry.path)]) {
    policy.files.push({ path }); writeFileSync(policyPath, JSON.stringify(policy)); expect(() => buildPublicFiles(result.root)).toThrow('DISALLOWED_PUBLIC_FILE'); policy.files.pop();
  }
  policy.files.push(policy.files[0]); writeFileSync(policyPath, JSON.stringify(policy)); expect(() => buildPublicFiles(result.root)).toThrow('DISALLOWED_PUBLIC_FILE');
  policy.files.pop(); writeFileSync(policyPath, JSON.stringify(policy)); writeFileSync(resolve(result.root, 'Tiny_Mime_Review_Source_Pack/supplements/motion-score-v1.schema.json'), '{}');
  expect(() => buildPublicFiles(result.root)).toThrow('SPECIFICATION_HASH_MISMATCH');
});

it('rejects subset omissions, policy relabelling, extra files and forged manifest hashes', () => {
  const result = distribution(), pack = resolve(result.root, 'Tiny_Mime_Review_Source_Pack');
  const path = 'chapters/02_technical_spec.md', original = readFileSync(resolve(pack, path));
  rmSync(resolve(pack, path)); expect(() => verifySourcePack(result.root)).toThrow('SOURCE_PACK_FILE_SET'); writeFileSync(resolve(pack, path), original);
  writeFileSync(resolve(pack, 'unexpected.md'), 'not part of the subset'); expect(() => verifySourcePack(result.root)).toThrow('SOURCE_PACK_FILE_SET'); rmSync(resolve(pack, 'unexpected.md'));
  const policyPath = resolve(result.root, 'release/source-pack-subset.json'), originalPolicy = readFileSync(policyPath), policy = JSON.parse(originalPolicy.toString());
  const retained = policy.entries.find((entry: { disposition: string }) => entry.disposition === 'retain'), omitted = policy.entries.find((entry: { disposition: string }) => entry.disposition === 'omit');
  retained.disposition = 'omit'; retained.reason = 'test'; omitted.disposition = 'retain'; writeFileSync(policyPath, JSON.stringify(policy));
  expect(() => verifySourcePack(result.root)).toThrow('SOURCE_PACK_SUBSET_POLICY'); expect(() => buildPublicFiles(result.root)).toThrow('SOURCE_PACK_SUBSET_POLICY'); writeFileSync(policyPath, originalPolicy);
  const manifestPath = resolve(pack, 'MANIFEST.sha256'), manifest = readFileSync(manifestPath, 'utf8');
  writeFileSync(manifestPath, manifest.replace(/^[a-f0-9]{64}/, '0'.repeat(64))); expect(() => verifySourcePack(result.root)).toThrow('SOURCE_PACK_MANIFEST');
  writeFileSync(manifestPath, manifest.split('\n').slice(1).join('\n')); expect(() => verifySourcePack(result.root)).toThrow('SOURCE_PACK_MANIFEST_COUNT');
});
