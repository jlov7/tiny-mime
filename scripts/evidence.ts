import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { z } from 'zod';

export const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
export type FileHash = { path: string; sha256: string; bytes: number };
const directories = ['src', 'scripts', 'tests', 'fixtures', 'chapters', 'supplements', 'Tiny_Mime_Review_Source_Pack', 'release', '.github', 'docs'];
const files = ['package.json', 'package-lock.json', '.node-version', '.gitattributes', 'toolchain-manifest.json', 'index.html', 'tsconfig.json', 'tsconfig.server.json', 'vite.config.ts', 'vitest.config.ts', 'playwright.config.ts', 'START_HERE_CODEX.md', 'README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'LICENSE', 'RELEASE_MANIFEST.json', 'SOURCE_PROVENANCE.json'];
function inventory(root: string, paths: string[]): FileHash[] {
  const entries: FileHash[] = [];
  const visit = (name: string) => {
    if (name.split('/').some(part => part.startsWith('.env') || /^(?:node_modules|artifacts|\.scratch)$/.test(part))) throw new Error('DISALLOWED_EVIDENCE_INPUT');
    const file = resolve(root, name), stat = lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error('EVIDENCE_SYMLINK ' + name);
    if (stat.isDirectory()) for (const child of readdirSync(file).sort()) visit(name + '/' + child);
    else if (stat.isFile()) { const bytes = readFileSync(file); entries.push({ path: name, sha256: sha256(bytes), bytes: bytes.length }); }
  };
  for (const path of paths) if (existsSync(resolve(root, path))) visit(path);
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}
export function inputHashes(root = process.cwd()) { return inventory(root, [...directories, ...files]); }
export function assertUnchanged(before: FileHash[], after: FileHash[]) {
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('VERIFICATION_INPUTS_CHANGED');
}
const originalPackHash = 'ddd8daf2852566765133f3ece71bef1a1e977d17a7847f339ed7b9d5d7ea2d91';
const publicPackHash = '6e9afbed3e9654252a52c8f232ae6d87ca8d5e902e1b1ed7f66559f53667888e';
const packEntry = z.strictObject({ path: z.string().regex(/^[A-Za-z0-9_-]+(?:[./][A-Za-z0-9_-]+)*$/), sha256: z.string().regex(/^[a-f0-9]{64}$/), disposition: z.enum(['retain', 'omit']), reason: z.string().min(1).optional() });
const subsetSchema = z.strictObject({ version: z.literal(1), originalManifestSha256: z.literal(originalPackHash), subsetManifestSha256: z.literal(publicPackHash), entries: z.array(packEntry).length(56) });
export const sourcePackManifest = (entries: { path: string; sha256: string }[]) => entries.map(entry => entry.sha256 + '  ' + entry.path).join('\n') + '\n';
export function publicSourcePackPolicy(root = process.cwd()) {
  const policy = subsetSchema.parse(JSON.parse(readFileSync(resolve(root, 'release/source-pack-subset.json'), 'utf8')));
  const retained = policy.entries.filter(entry => entry.disposition === 'retain');
  if (new Set(policy.entries.map(entry => entry.path)).size !== 56 || retained.length !== 36 || policy.entries.some(entry => entry.disposition === 'omit' && !entry.reason) || sha256(sourcePackManifest(policy.entries)) !== originalPackHash || sha256(sourcePackManifest(retained)) !== publicPackHash) throw new Error('SOURCE_PACK_SUBSET_POLICY');
  return { ...policy, retained };
}
export function verifySourcePack(root = process.cwd()) {
  const pack = resolve(root, 'Tiny_Mime_Review_Source_Pack');
  const manifest = readFileSync(resolve(pack, 'MANIFEST.sha256'));
  const hash = sha256(manifest), subset = hash === publicPackHash;
  const entries = manifest.toString('utf8').trim().split('\n').map(line => {
    const match = /^([a-f0-9]{64})  ([^\r\n]+)$/.exec(line);
    if (!match || match[2].startsWith('/') || match[2].split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.env')) || match[2].includes('\\')) throw new Error('SOURCE_PACK_MANIFEST_INVALID');
    return { path: match[2], sha256: match[1] };
  });
  const expectedCount = subset ? 36 : 56;
  if (entries.length !== expectedCount || new Set(entries.map(entry => entry.path)).size !== expectedCount) throw new Error('SOURCE_PACK_MANIFEST_COUNT');
  if (hash !== originalPackHash && !subset) throw new Error('SOURCE_PACK_MANIFEST_BINDING');
  if (subset) {
    const policy = publicSourcePackPolicy(root);
    if (sourcePackManifest(entries) !== sourcePackManifest(policy.retained)) throw new Error('SOURCE_PACK_SUBSET_POLICY');
  }
  const actual = inventory(pack, readdirSync(pack).filter(file => file !== 'MANIFEST.sha256'));
  if (JSON.stringify(actual.map(({ path }) => path).sort()) !== JSON.stringify(entries.map(({ path }) => path).sort())) throw new Error('SOURCE_PACK_FILE_SET');
  for (const entry of entries) if (actual.find(file => file.path === entry.path)?.sha256 !== entry.sha256) throw new Error('SOURCE_PACK_HASH ' + entry.path);
  return { status: 'PASS', scope: subset ? 'public-specification-subset' : 'full-source-pack', entries: entries.length, originalEntries: 56, omittedEntries: subset ? 20 : 0, manifestSha256: hash };
}
export function sealEvidence(directory: string) {
  const artifacts = inventory(directory, readdirSync(directory).filter(file => !['evidence-index.json', 'MANIFEST.sha256'].includes(file)));
  writeFileSync(resolve(directory, 'evidence-index.json'), JSON.stringify({ version: 1, empiricalQualifications: 'NOT RUN', scope: 'local authored/mock technical checks', artifacts }, null, 2) + '\n');
  artifacts.push({ path: 'evidence-index.json', sha256: sha256(readFileSync(resolve(directory, 'evidence-index.json'))), bytes: readFileSync(resolve(directory, 'evidence-index.json')).length });
  writeFileSync(resolve(directory, 'MANIFEST.sha256'), artifacts.map(file => `${file.sha256}  ${file.path}`).join('\n') + '\n');
  return { files: artifacts.length, manifest: relative(process.cwd(), resolve(directory, 'MANIFEST.sha256')) };
}
