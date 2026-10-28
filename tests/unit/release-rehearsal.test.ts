import { afterEach, expect, it } from 'vitest';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { zipSync, type Zippable } from 'fflate';
import { buildPublicFiles, publicZip } from '../../scripts/public-release.js';
import { inspectReleaseArchive, rehearsalEnvironment, runRehearsalCommand, runReleaseRehearsal, trustedArchiveFiles, type RehearsalCommand } from '../../scripts/release-rehearsal.js';
import { sha256, verifySourcePack } from '../../scripts/evidence.js';

const roots: string[] = [];
function fixture() { mkdirSync('.scratch', { recursive: true }); const root = mkdtempSync(resolve('.scratch/release-rehearsal-test-')); roots.push(root); return root; }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function zip(entries: [string, string, number?][]) {
  const files: Zippable = {};
  for (const [name, text, mode = 0o100644] of entries) files[name] = [Buffer.from(text), { attrs: mode << 16 }];
  return Buffer.from(zipSync(files, { level: 9 }));
}
const prefix = 'tiny-mime-0.2.0/';
function miniature(version = '0.2.0') { const root = 'tiny-mime-' + version + '/'; return zip([[root + 'README.md', 'local source'], [root + 'RELEASE_MANIFEST.json', '{}']]); }
function distribution() {
  const root = fixture(), trusted = buildPublicFiles();
  for (const [path, bytes] of trusted.files) { const target = resolve(root, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes); }
  const archive = resolve(root, 'source.zip'); writeFileSync(archive, publicZip(trusted.files, trusted.version));
  return { root, archive, trusted };
}
const passed = (stdout = '') => ({ exitCode: 0, signal: null, timedOut: false, stdout });
const npmVersion = JSON.parse(readFileSync('toolchain-manifest.json', 'utf8')).npm as string;

it('rejects traversal, ambiguous paths, wrong prefix, links, duplicates and inconsistent local headers before decompression', () => {
  expect(inspectReleaseArchive(miniature(), '0.2.0').entryCount).toBe(2);
  for (const name of ['../escape', 'src/../../escape', 'src//escape', 'src\\escape', '/escape', 'a\0b', '.env', 'credentials.json']) {
    expect(() => inspectReleaseArchive(zip([[prefix + name, 'x'], [prefix + 'RELEASE_MANIFEST.json', '{}']]), '0.2.0')).toThrow('ARCHIVE_PATH');
  }
  expect(() => inspectReleaseArchive(zip([['tiny-mime-9.0.0/README.md', 'x']]), '0.2.0')).toThrow('ARCHIVE_PREFIX');
  expect(() => inspectReleaseArchive(zip([[prefix + 'README.md', 'x', 0o120777], [prefix + 'RELEASE_MANIFEST.json', '{}']]), '0.2.0')).toThrow('ARCHIVE_FILE_TYPE');
  const duplicate = zip([[prefix + 'aa', 'x'], [prefix + 'bb', 'y'], [prefix + 'RELEASE_MANIFEST.json', '{}']]);
  for (let cursor = 0; cursor < duplicate.length - 4; cursor++) if (duplicate.readUInt32LE(cursor) === 0x02014b50) {
    const length = duplicate.readUInt16LE(cursor + 28), name = duplicate.subarray(cursor + 46, cursor + 46 + length).toString();
    if (name === prefix + 'bb') { const local = duplicate.readUInt32LE(cursor + 42); duplicate.write(prefix + 'aa', cursor + 46); duplicate.write(prefix + 'aa', local + 30); }
  }
  expect(() => inspectReleaseArchive(duplicate, '0.2.0')).toThrow('ARCHIVE_DUPLICATE');
  const mismatch = miniature(); mismatch[30] ^= 1;
  expect(() => inspectReleaseArchive(mismatch, '0.2.0')).toThrow('ARCHIVE_LOCAL_HEADER');
});

it('bounds archive size, declared expansion, compression ratio and extra records', () => {
  expect(() => inspectReleaseArchive(Buffer.alloc(32 * 1024 * 1024 + 1), '0.2.0')).toThrow('ARCHIVE_SIZE');
  expect(() => inspectReleaseArchive(zip([[prefix + 'README.md', 'x'.repeat(400000)], [prefix + 'RELEASE_MANIFEST.json', '{}']]), '0.2.0')).toThrow('ARCHIVE_EXPANSION_LIMIT');
  const inflated = miniature(), central = inflated.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); inflated.writeUInt32LE(0xffffffff, central + 24);
  expect(() => inspectReleaseArchive(inflated, '0.2.0')).toThrow('ARCHIVE_EXPANSION_LIMIT');
  expect(() => inspectReleaseArchive(Buffer.concat([miniature(), Buffer.from('extra')]), '0.2.0')).toThrow('ARCHIVE_FORMAT');
});

it('binds the exact source bytes to current reviewed public files, including their manifest', () => {
  const trusted = buildPublicFiles(), archive = publicZip(trusted.files, trusted.version);
  expect(trustedArchiveFiles(archive, trusted).files.size).toBe(trusted.files.size);
  for (const path of ['package.json', 'RELEASE_MANIFEST.json']) {
    const changed = new Map(trusted.files); changed.set(path, Buffer.from('{}\n'));
    expect(() => trustedArchiveFiles(publicZip(changed, trusted.version), trusted)).toThrow('ARCHIVE_NOT_CURRENT_PUBLIC_SOURCE');
  }
});

it('constructs an isolated environment without inherited credentials or npm settings', () => {
  const env = rehearsalEnvironment('/checkout', '/scratch', '/pinned/bin/node');
  expect(env.PATH).toBe('/pinned/bin:/usr/bin:/bin');
  expect(env.HOME).toBe('/scratch/home'); expect(env.TMPDIR).toBe('/scratch/tmp');
  expect(env.npm_config_userconfig).toBe('/dev/null'); expect(env.npm_config_globalconfig).toBe('/checkout/scripts/npm-global.npmrc');
  expect(env.TM_PROVIDER_MODE).toBe('disabled'); expect(env.TM_STUDY_ENABLED).toBe('false');
  for (const name of ['OPENAI_API_KEY', 'NODE_ENV', 'NODE_OPTIONS', 'npm_config_token', 'HTTP_PROXY', 'TM_MODEL_ID', 'TM_PROVIDER_CONFIG_PATH']) expect(env[name]).toBeUndefined();
});

it('runs the successful miniature stage transport, seals evidence and removes only its owned scratch and cache', async () => {
  const { root, archive } = distribution(), calls: RehearsalCommand[] = [];
  mkdirSync(resolve(root, '.scratch')); writeFileSync(resolve(root, '.scratch/keep.txt'), 'preserve');
  const result = await runReleaseRehearsal({ root, archive, runner: async spec => {
    calls.push(spec); expect(spec.timeoutMs).toBeGreaterThan(0); expect(spec.timeoutMs).toBeLessThanOrEqual(300000);
    expect(spec.cwd.startsWith(resolve(root, '.scratch/release-rehearsal-'))).toBe(true);
    expect(existsSync(spec.env.npm_config_cache!)).toBe(true);
    if (spec.stage === 'fresh-install') expect(existsSync(resolve(spec.cwd, 'node_modules'))).toBe(false);
    writeFileSync(spec.logPath, 'local mock transport\n', { mode: 0o600 }); return passed(spec.stage === 'npm-version' ? npmVersion : '');
  } });
  expect(result).toMatchObject({ status: 'PASS', cleanup: 'PASS', sourceIntegrity: 'PASS' });
  const receipt = JSON.parse(readFileSync(result.receipt, 'utf8'));
  expect(receipt.execution).toBe('mock_fixture');
  expect(receipt.sourceArchive).toMatchObject({ status: 'PASS', sha256: sha256(readFileSync(archive)) });
  expect(receipt.byteIdenticalRepackage).toBe('PASS'); expect(receipt.stages.every((stage: { stage: string; status: string }) => stage.status === 'PASS' || stage.stage === 'offline-preview' && stage.status === 'NOT RUN')).toBe(true);
  expect(receipt.qualifications.liveProvider).toBe('NOT RUN'); expect(receipt.qualifications.publication).toBe('NOT RUN');
  expect(calls.map(call => call.stage)).toContain('production-smoke'); expect(calls.find(call => call.stage === 'typecheck')!.env.npm_config_offline).toBe('true');
  expect(readdirSync(resolve(root, '.scratch'))).toEqual(['keep.txt']);
  const evidence = dirname(result.receipt), index = JSON.parse(readFileSync(resolve(evidence, 'evidence-index.json'), 'utf8'));
  for (const artifact of index.artifacts) expect(sha256(readFileSync(resolve(evidence, artifact.path)))).toBe(artifact.sha256);
});

it.each(['failure', 'timeout', 'tamper'] as const)('preserves %s evidence, skips dependent stages and cleans its copy', async kind => {
  const { root, archive } = distribution();
  const result = await runReleaseRehearsal({ root, archive, runner: async spec => {
    if (spec.stage === 'typecheck') {
      if (kind === 'tamper') writeFileSync(resolve(spec.cwd, 'README.md'), 'changed');
      return { ...passed(), exitCode: kind === 'failure' ? 7 : 0, timedOut: kind === 'timeout' };
    }
    return passed(spec.stage === 'npm-version' ? npmVersion : '');
  } });
  expect(result.status).toBe('FAIL'); expect(result.cleanup).toBe('PASS');
  const receipt = JSON.parse(readFileSync(result.receipt, 'utf8'));
  expect(receipt.failureCode).toBe(kind === 'timeout' ? 'STAGE_TIMEOUT' : kind === 'failure' ? 'STAGE_FAILED' : 'REHEARSAL_CHECK_FAILED');
  expect(receipt.sourceIntegrity).toBe(kind === 'tamper' ? 'FAIL' : 'PASS');
  expect(receipt.stages.find((stage: { stage: string }) => stage.stage === 'repackage').status).not.toBe('PASS');
  expect(readdirSync(resolve(root, '.scratch'))).toEqual([]);
  expect(existsSync(resolve(dirname(result.receipt), 'MANIFEST.sha256'))).toBe(true);
});

it('never invokes a child command for an untrusted archive and retains its archive hash', async () => {
  const { root, archive, trusted } = distribution(); writeFileSync(archive, miniature(trusted.version)); let called = false;
  const result = await runReleaseRehearsal({ root, archive, runner: async () => { called = true; return passed(); } });
  expect(called).toBe(false); expect(result).toMatchObject({ status: 'FAIL', failureCode: 'ARCHIVE_NOT_CURRENT_PUBLIC_SOURCE', cleanup: 'PASS' });
  const receipt = JSON.parse(readFileSync(result.receipt, 'utf8')); expect(receipt.sourceArchive.sha256).toBe(sha256(readFileSync(archive)));
  expect(receipt.stages.slice(1).every((stage: { status: string }) => stage.status === 'SKIPPED')).toBe(true);
});

it('runs source verification with a long isolated temporary directory', async () => {
  const root = fixture(), scratch = resolve(root, 'nested-checkout-'.repeat(12));
  for (const directory of ['home', 'tmp', 'npm-cache']) mkdirSync(resolve(scratch, directory), { recursive: true });
  const result = await runRehearsalCommand({ stage: 'long-temp-source-pack', command: resolve(dirname(process.execPath), 'npm'), args: ['run', 'verify:source-pack'], cwd: resolve('.'), env: { ...rehearsalEnvironment(resolve('.'), scratch), npm_config_offline: 'true' }, timeoutMs: 15000, logPath: resolve(root, 'long-temp.log') });
  expect(result).toMatchObject({ exitCode: 0, signal: null, timedOut: false });
  expect(JSON.parse(result.stdout.slice(result.stdout.indexOf('{')))).toEqual(verifySourcePack());
}, 20000);

it('times out an owned child process without printing its private output', async () => {
  const root = fixture(), logPath = resolve(root, 'child.log');
  const result = await runRehearsalCommand({ stage: 'timeout-test', command: process.execPath, args: ['-e', 'process.stdout.write("private child value"); setTimeout(() => {}, 10000)'], cwd: root, env: rehearsalEnvironment(root, root), timeoutMs: 300, logPath });
  expect(result.timedOut).toBe(true); expect(result.exitCode).toBeNull();
  expect(readFileSync(logPath, 'utf8')).toBe('private child value'); expect(lstatSync(logPath).mode & 0o077).toBe(0);
});

it('rejects a mock command runner outside the unit-test environment before creating evidence', async () => {
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    await expect(runReleaseRehearsal({ archive: 'unused.zip', runner: async () => passed() })).rejects.toThrow('MOCK_RUNNER_TEST_ONLY');
  } finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
});
