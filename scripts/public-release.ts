import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { zipSync, type Zippable } from 'fflate';
import { z } from 'zod';
import { publicSourcePackPolicy, sha256, sourcePackManifest, verifySourcePack } from './evidence.js';
import { safeSourcePath, sourceBytes, verifyDistribution } from './source-distribution.js';

const pack = 'Tiny_Mime_Review_Source_Pack/';
const policySchema = z.strictObject({ version: z.literal(1), files: z.array(z.strictObject({ path: z.string(), source: z.string().optional() })).min(1).max(1000) });
export type PublicFiles = Map<string, Buffer>;
const encoded = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + '\n');

export function publicFindings(files: PublicFiles) {
  const findings: { path: string; rule: string; line: number }[] = [];
  const rules: [string, RegExp][] = [
    ['personal_home_path', /(?:\/Users\/|\/home\/)[A-Za-z0-9._-]+\//g],
    ['macos_temp_path', /(?:\/private\/var\/|\/var\/folders\/)/g],
    ['windows_home_path', /[A-Za-z]:\\Users\\[^\\\s]+\\/g],
    ['file_uri', /file:\/\/\//g],
    ['provider_credential', /\b(?:sk-proj-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[0-9A-Z]{16})\b/g],
    ['private_key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
    ['credential_assignment', /\b(?:api_key|secret_key|access_token)\s*[:=]\s*["'][A-Za-z0-9_+/=-]{20,}["']/gi],
  ];
  for (const [path, bytes] of files) {
    safeSourcePath(path);
    if (bytes.includes(0)) continue;
    const text = bytes.toString('utf8');
    for (const [rule, pattern] of rules) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) findings.push({ path, rule, line: text.slice(0, match.index).split('\n').length });
    }
  }
  return findings;
}
export function checkPublicLinks(files: PublicFiles) {
  for (const [path, bytes] of files) if (path.endsWith('.md')) {
    const text = bytes.toString('utf8').replace(/```[^]*?```/g, '');
    for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
      const link = match[1].trim().replace(/^<([^>]+)>$/, '$1');
      if (/^(?:https?:|mailto:|#)/.test(link)) continue;
      const file = decodeURIComponent(link.split('#')[0]);
      const target = posix.normalize(posix.join(posix.dirname(path), file));
      if (!files.has(target)) throw new Error('BROKEN_PUBLIC_LINK ' + path + ' -> ' + target);
    }
  }
}
export function checkPublicImages(files: PublicFiles) {
  const bytes = files.get('docs/images/PROVENANCE.json');
  const schema = z.object({ version: z.literal(2), images: z.array(z.object({ file: z.string().regex(/^[A-Za-z0-9_-]+\.png$/), applicationVersion: z.string().regex(/^\d+\.\d+\.\d+$/), sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().positive() })).min(1).max(100) });
  let value: unknown; try { value = bytes && JSON.parse(bytes.toString('utf8')); } catch { throw new Error('PUBLIC_IMAGE_PROVENANCE_INVALID'); }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error('PUBLIC_IMAGE_PROVENANCE_INVALID');
  const records = parsed.data.images, expected = records.map(record => 'docs/images/' + record.file).sort();
  const actual = [...files.keys()].filter(path => path.startsWith('docs/images/') && path.endsWith('.png')).sort();
  if (new Set(expected).size !== expected.length || JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error('PUBLIC_IMAGE_FILE_SET');
  for (const record of records) {
    const image = files.get('docs/images/' + record.file)!;
    if (image.length !== record.bytes || sha256(image) !== record.sha256) throw new Error('PUBLIC_IMAGE_HASH_MISMATCH');
  }
}
function publicSpecification(files: PublicFiles, root: string) {
  const policy = publicSourcePackPolicy(root);
  const actual = [...files.keys()].filter(path => path.startsWith(pack)).sort();
  const expected = [pack + 'MANIFEST.sha256', ...policy.retained.map(entry => pack + entry.path)].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('SPECIFICATION_FILE_SET');
  for (const entry of policy.retained) if (sha256(files.get(pack + entry.path)!) !== entry.sha256) throw new Error('SPECIFICATION_HASH_MISMATCH');
  verifySourcePack(root);
  files.set(pack + 'MANIFEST.sha256', Buffer.from(sourcePackManifest(policy.retained)));
  files.set('SOURCE_PROVENANCE.json', encoded({ version: 2, scope: 'public-specification-subset; retained files are byte-identical to the original v0.2 source pack', originalEntries: 56, distributedEntries: 36, originalManifestSha256: policy.originalManifestSha256, distributedManifestSha256: policy.subsetManifestSha256, retained: policy.retained.map(({ path, sha256 }) => ({ path: pack + path, sha256 })), omitted: policy.entries.filter(entry => entry.disposition === 'omit').map(({ path, sha256, reason }) => ({ path: pack + path, sha256, reason })) }));
}
export function buildPublicFiles(root = process.cwd()) {
  const policy = policySchema.parse(JSON.parse(sourceBytes(root, 'release/public-files.json').toString('utf8')));
  const files: PublicFiles = new Map();
  const denied = /(?:^|\/)(?:\.npmrc|START_HERE_CODEX\.(?:md|txt)|Tiny_Mime_Complete_Plan\.md|Tiny_Mime_Build_Review_Pack\.docx|dependency-audit-preinstall\.json|0[0456]_[A-Za-z0-9_-]+\.md|phase-a-coding-brief\.md)$/;
  const privateDocument = /^docs\/(?:[A-Za-z0-9_-]+_(?:PLAN|PROPOSALS?|LEDGER|BACKLOG|REPORT|REVIEW|AUDIT)|QUALITY_(?:EVALUATION|IMPROVEMENT_DESIGN|RELEASE))\.md$|^docs\/[A-Za-z0-9_-]+-receipt\.json$/;
  const omitted = new Set(publicSourcePackPolicy(root).entries.filter(entry => entry.disposition === 'omit').map(entry => pack + entry.path));
  for (const entry of policy.files) {
    const path = safeSourcePath(entry.path), source = safeSourcePath(entry.source ?? entry.path);
    if (files.has(path) || omitted.has(path) || privateDocument.test(path) || ['SOURCE_PROVENANCE.json', 'RELEASE_MANIFEST.json'].includes(path) || /\.(?:sqlite3?|db)(?:-(?:wal|shm|journal))?$|\.(?:jsonl|log|pem|key|p12|pfx|zip|tar|gz|docx)$/i.test(path) || (denied.test(path) && !(path === '.npmrc' && source === 'release/public/npmrc.txt'))) throw new Error('DISALLOWED_PUBLIC_FILE');
    if (entry.source && !source.startsWith('release/public/')) throw new Error('DISALLOWED_PUBLIC_OVERRIDE');
    files.set(path, sourceBytes(root, source));
  }
  for (const path of ['README.md', 'LICENSE', 'SECURITY.md', 'CONTRIBUTING.md', 'package.json', 'package-lock.json', 'AGENTS.md', 'release/public-files.json']) if (!files.has(path)) throw new Error('PUBLIC_FILE_REQUIRED ' + path);
  publicSpecification(files, root);
  const findings = publicFindings(files);
  if (findings.length) throw new Error('PUBLIC_CONTENT_FINDINGS ' + JSON.stringify(findings));
  checkPublicLinks(files);
  checkPublicImages(files);
  const pkg = z.object({ name: z.literal('tiny-mime'), version: z.string().regex(/^\d+\.\d+\.\d+$/), private: z.literal(true), license: z.literal('MIT') }).parse(JSON.parse(files.get('package.json')!.toString('utf8')));
  const manifest = { version: 1, name: pkg.name, releaseVersion: pkg.version, surface: 'local-source', files: [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, bytes]) => ({ path, sha256: sha256(bytes), bytes: bytes.length })) };
  files.set('RELEASE_MANIFEST.json', encoded(manifest));
  return { files, manifestSha256: sha256(files.get('RELEASE_MANIFEST.json')!), version: pkg.version };
}
export function publicZip(files: PublicFiles, version: string) {
  const contents: Zippable = {};
  for (const [path, bytes] of [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) contents['tiny-mime-' + version + '/' + safeSourcePath(path)] = [bytes, { mtime: new Date(2000, 0, 1), attrs: 0o100644 << 16 }];
  return Buffer.from(zipSync(contents, { level: 9 }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [command, ...extra] = process.argv.slice(2);
    if (extra.length || !['check', 'prepare', 'distribution'].includes(command)) throw new Error('RELEASE_COMMAND_REQUIRED');
    if (command === 'distribution') {
      const { paths: _paths, ...result } = verifyDistribution(); process.stdout.write(JSON.stringify(result) + '\n');
    } else {
      const result = buildPublicFiles();
      if (command === 'check') process.stdout.write(JSON.stringify({ status: 'PASS', files: result.files.size, manifestSha256: result.manifestSha256 }) + '\n');
      else {
        const bytes = publicZip(result.files, result.version), hash = sha256(bytes);
        const path = 'artifacts/releases/tiny-mime-' + result.version + '-source-' + hash.slice(0, 12) + '.zip';
        mkdirSync(dirname(path), { recursive: true });
        if (existsSync(path)) { if (sha256(readFileSync(path)) !== hash) throw new Error('RELEASE_PATH_COLLISION'); }
        else writeFileSync(path, bytes, { flag: 'wx' });
        process.stdout.write(JSON.stringify({ status: 'PASS', path, sha256: hash, bytes: bytes.length, files: result.files.size, manifestSha256: result.manifestSha256 }) + '\n');
      }
    }
  } catch (error) { process.stderr.write(JSON.stringify({ status: 'FAIL', error: error instanceof Error ? error.message : 'RELEASE_FAILED' }) + '\n'); process.exitCode = 1; }
}
