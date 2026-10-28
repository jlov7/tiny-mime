import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unzipSync } from 'fflate';
import { sha256, sealEvidence } from './evidence.js';
import { buildPublicFiles, publicZip, type PublicFiles } from './public-release.js';
import { safeSourcePath, verifyDistribution } from './source-distribution.js';

const limits = { archive: 32 * 1024 * 1024, expanded: 128 * 1024 * 1024, file: 25 * 1024 * 1024, files: 1000, ratio: 512, log: 8 * 1024 * 1024 };
class RehearsalFailure extends Error {}
function fail(code: string): never { throw new RehearsalFailure(code); }
function realDirectory(path: string) {
  if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
  const stat = lstatSync(path); if (!stat.isDirectory() || stat.isSymbolicLink()) fail('OUTPUT_DIRECTORY_UNSAFE');
}

// Inspect central and local headers before decompression. ZIP64, links, extra records and ambiguous names are unnecessary for this source format.
export function inspectReleaseArchive(bytes: Buffer, version: string) {
  if (bytes.length < 22 || bytes.length > limits.archive) fail('ARCHIVE_SIZE');
  const end = bytes.length - 22;
  if (bytes.readUInt32LE(end) !== 0x06054b50 || bytes.readUInt16LE(end + 20) !== 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) fail('ARCHIVE_FORMAT');
  const count = bytes.readUInt16LE(end + 10), directorySize = bytes.readUInt32LE(end + 12), directoryOffset = bytes.readUInt32LE(end + 16);
  if (!count || count > limits.files || count !== bytes.readUInt16LE(end + 8) || directoryOffset + directorySize !== end) fail('ARCHIVE_DIRECTORY');
  const paths = new Set<string>(), prefix = 'tiny-mime-' + version + '/';
  let cursor = directoryOffset, expanded = 0, localEnd = 0;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) fail('ARCHIVE_DIRECTORY');
    const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10), compressed = bytes.readUInt32LE(cursor + 20), size = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28), extraLength = bytes.readUInt16LE(cursor + 30), commentLength = bytes.readUInt16LE(cursor + 32), offset = bytes.readUInt32LE(cursor + 42);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > end || !nameLength || extraLength || commentLength || bytes.readUInt16LE(cursor + 34) || flags & ~0x800 || ![0, 8].includes(method)) fail('ARCHIVE_FORMAT');
    const rawName = bytes.subarray(cursor + 46, cursor + 46 + nameLength), name = rawName.toString('utf8');
    if (!Buffer.from(name).equals(rawName) || !name.startsWith(prefix)) fail('ARCHIVE_PREFIX');
    const path = name.slice(prefix.length);
    try { safeSourcePath(path); } catch { fail('ARCHIVE_PATH'); }
    if (paths.has(path)) fail('ARCHIVE_DUPLICATE'); paths.add(path);
    const mode = bytes.readUInt32LE(cursor + 38) >>> 16;
    if ((mode & 0xf000) !== 0x8000 || bytes.readUInt32LE(cursor + 38) & 0x10) fail('ARCHIVE_FILE_TYPE');
    expanded += size;
    if (size > limits.file || expanded > limits.expanded || size > Math.max(compressed, 1) * limits.ratio) fail('ARCHIVE_EXPANSION_LIMIT');
    if (offset !== localEnd || offset + 30 > directoryOffset || bytes.readUInt32LE(offset) !== 0x04034b50) fail('ARCHIVE_LOCAL_HEADER');
    const localNameLength = bytes.readUInt16LE(offset + 26), localExtraLength = bytes.readUInt16LE(offset + 28);
    localEnd = offset + 30 + localNameLength + localExtraLength + compressed;
    if (localEnd > directoryOffset || localExtraLength || localNameLength !== nameLength || !bytes.subarray(offset + 30, offset + 30 + nameLength).equals(rawName) || bytes.readUInt16LE(offset + 6) !== flags || bytes.readUInt16LE(offset + 8) !== method || !bytes.subarray(offset + 14, offset + 26).equals(bytes.subarray(cursor + 16, cursor + 28))) fail('ARCHIVE_LOCAL_HEADER');
    cursor = next;
  }
  if (cursor !== end || localEnd !== directoryOffset || !paths.has('RELEASE_MANIFEST.json')) fail('ARCHIVE_FILE_SET');
  return { entryCount: count, expandedBytes: expanded };
}

export function trustedArchiveFiles(bytes: Buffer, trusted: { files: PublicFiles; version: string }) {
  const inspected = inspectReleaseArchive(bytes, trusted.version);
  // A self-signed manifest is not authority to execute uploaded scripts. Bind to this checkout's reviewed public bytes first.
  if (!bytes.equals(publicZip(trusted.files, trusted.version))) fail('ARCHIVE_NOT_CURRENT_PUBLIC_SOURCE');
  const entries = unzipSync(bytes), files: PublicFiles = new Map(), prefix = 'tiny-mime-' + trusted.version + '/';
  for (const [name, content] of Object.entries(entries)) files.set(name.slice(prefix.length), Buffer.from(content));
  if (files.size !== trusted.files.size) fail('ARCHIVE_FILE_SET');
  for (const [path, content] of trusted.files) if (!files.get(path)?.equals(content)) fail('ARCHIVE_SOURCE_BINDING');
  return { files, ...inspected };
}

export function rehearsalEnvironment(checkout: string, scratch: string, node = process.execPath): NodeJS.ProcessEnv {
  return { PATH: dirname(node) + ':/usr/bin:/bin', HOME: resolve(scratch, 'home'), TMPDIR: resolve(scratch, 'tmp'), LANG: 'C', LC_ALL: 'C',
    npm_config_userconfig: '/dev/null', npm_config_globalconfig: resolve(checkout, 'scripts/npm-global.npmrc'), npm_config_registry: 'https://registry.npmjs.org', npm_config_cache: resolve(scratch, 'npm-cache'), npm_config_update_notifier: 'false', npm_config_audit: 'false', npm_config_fund: 'false',
    TM_PROVIDER_MODE: 'disabled', TM_STUDY_ENABLED: 'false', TM_DATA_DIR: resolve(scratch, 'data') };
}
export type RehearsalCommand = { stage: string; command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; logPath: string; signal?: AbortSignal };
export type CommandResult = { exitCode: number | null; signal: string | null; timedOut: boolean; stdout: string; outputLimit?: boolean };
export type RehearsalRunner = (command: RehearsalCommand) => Promise<CommandResult>;
export const runRehearsalCommand: RehearsalRunner = spec => new Promise((done, reject) => {
  const log = openSync(spec.logPath, 'wx', 0o600);
  const child = spawn(spec.command, spec.args, { cwd: spec.cwd, env: spec.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let cleaned = false, timedOut = false, outputLimit = false, size = 0, stdout = '', killTimer: ReturnType<typeof setTimeout> | undefined;
  const kill = (signal: NodeJS.Signals) => { if (child.pid) try { process.kill(-child.pid, signal); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') child.kill(signal); } };
  const stop = () => { kill('SIGTERM'); killTimer ??= setTimeout(() => kill('SIGKILL'), 2000); };
  const abort = () => stop(); spec.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; stop(); }, spec.timeoutMs);
  const consume = (chunk: Buffer, isStdout: boolean) => {
    size += chunk.length;
    if (size > limits.log) { outputLimit = true; stop(); return; }
    writeFileSync(log, chunk); if (isStdout && stdout.length < 256 * 1024) stdout += chunk.toString('utf8');
  };
  child.stdout.on('data', chunk => consume(chunk, true)); child.stderr.on('data', chunk => consume(chunk, false));
  const cleanup = () => { if (cleaned) return; cleaned = true; clearTimeout(timer); clearTimeout(killTimer); spec.signal?.removeEventListener('abort', abort); kill('SIGKILL'); closeSync(log); };
  child.once('error', () => { cleanup(); reject(new RehearsalFailure('CHILD_START_FAILED')); });
  child.once('close', (exitCode, signal) => { cleanup(); done({ exitCode, signal, timedOut, stdout, outputLimit }); });
  if (spec.signal?.aborted) stop();
});

function portAvailable() { return new Promise<boolean>(done => { const server = net.createServer(); server.once('error', () => done(false)); server.listen(4317, '127.0.0.1', () => server.close(() => done(true))); }); }
function archiveBytes(path: string) {
  if (!path.endsWith('.zip')) fail('ARCHIVE_ZIP_REQUIRED');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd); if (!stat.isFile() || stat.size > limits.archive) fail('ARCHIVE_SIZE');
    const bytes = Buffer.alloc(stat.size + 1); let size = 0, count = 0;
    while (size < bytes.length && (count = readSync(fd, bytes, size, bytes.length - size, null)) > 0) size += count;
    if (size !== stat.size) fail('ARCHIVE_CHANGED'); return bytes.subarray(0, size);
  } finally { closeSync(fd); }
}
const commandStages = [
  ['npm-version', ['--version'], 10000], ['fresh-install', ['ci', '--no-audit', '--no-fund'], 300000],
  ['distribution', ['run', 'verify:distribution'], 30000], ['typecheck', ['run', 'typecheck'], 120000], ['unit', ['test'], 180000],
  ['fixtures', ['run', 'verify:fixtures'], 60000], ['source-pack', ['run', 'verify:source-pack'], 30000], ['build', ['run', 'build'], 180000],
  ['production-smoke', ['run', 'smoke:production'], 45000], ['doctor', ['run', 'doctor', '--', 'setup'], 30000],
  ['provider-readiness', ['run', 'provider:readiness'], 30000], ['support-report', ['run', 'support:report'], 30000], ['offline-preview', ['run', 'preview:build'], 30000],
] as const;
export async function runReleaseRehearsal(options: { archive: string; root?: string; runner?: RehearsalRunner; signal?: AbortSignal }) {
  if (options.runner && process.env.NODE_ENV !== 'test') fail('MOCK_RUNNER_TEST_ONLY');
  const root = resolve(options.root ?? process.cwd()), runId = new Date().toISOString().replace(/[:.]/g, '-') + '-release-rehearsal-' + randomUUID();
  for (const directory of ['artifacts', 'artifacts/verification', '.scratch']) realDirectory(resolve(root, directory));
  const evidence = resolve(root, 'artifacts/verification', runId); realDirectory(evidence);
  type Stage = { stage: string; status: string; exitCode?: number | null; signal?: string | null; timedOut?: boolean; durationMs?: number };
  const stages: Stage[] = [{ stage: 'archive-trust', status: 'SKIPPED' }, ...commandStages.map(([stage]) => ({ stage, status: 'SKIPPED' })), { stage: 'repackage', status: 'SKIPPED' }];
  const receipt = { version: 1, status: 'RUNNING', startedAt: new Date().toISOString(), finishedAt: '', command: 'npm run release:rehearse -- --archive <local-source.zip>', sourceArchive: { status: 'NOT CHECKED', sha256: null as string | null, bytes: null as number | null, manifestSha256: null as string | null, files: null as number | null }, driverSha256: sha256(readFileSync(new URL(import.meta.url))), stages, sourceIntegrity: 'NOT CHECKED', byteIdenticalRepackage: 'NOT RUN', cleanup: { status: 'NOT RUN', scratchRemoved: false }, failureCode: null as string | null, qualifications: { liveProvider: 'NOT RUN', physicalDevice: 'NOT RUN', humanComprehension: 'NOT RUN', enjoyment: 'NOT RUN', sceneCalibration: 'NOT RUN', semanticFidelity: 'NOT RUN', comparativeEffect: 'NOT RUN', publication: 'NOT RUN' }, browserSuite: 'NOT RUN (separate aggregate verification)' };
  let scratch: string | undefined, checkout: string | undefined, trusted: ReturnType<typeof buildPublicFiles> | undefined, manifest: Buffer | undefined, bytes: Buffer | undefined, current = stages[0];
  const execution = options.runner ? 'mock_fixture' : 'process_commands';
  const save = () => writeFileSync(resolve(evidence, 'receipt.json'), JSON.stringify({ ...receipt, execution }, null, 2) + '\n', { mode: 0o600 }); save();
  try {
    bytes = archiveBytes(resolve(root, options.archive)); receipt.sourceArchive.sha256 = sha256(bytes); receipt.sourceArchive.bytes = bytes.length;
    trusted = buildPublicFiles(root); const checked = trustedArchiveFiles(bytes, trusted); manifest = checked.files.get('RELEASE_MANIFEST.json')!;
    receipt.sourceArchive = { ...receipt.sourceArchive, status: 'PASS', manifestSha256: sha256(manifest), files: checked.files.size };
    scratch = mkdtempSync(resolve(root, '.scratch/release-rehearsal-')); checkout = resolve(scratch, 'app'); realDirectory(checkout);
    for (const directory of ['home', 'tmp', 'npm-cache', 'data']) realDirectory(resolve(scratch, directory));
    for (const [path, content] of checked.files) { const target = resolve(checkout, path); mkdirSync(dirname(target), { recursive: true, mode: 0o700 }); writeFileSync(target, content, { flag: 'wx', mode: 0o600 }); }
    verifyDistribution(checkout); current.status = 'PASS'; save();
    const expected = JSON.parse(trusted.files.get('toolchain-manifest.json')!.toString('utf8')) as { node: string; npm: string };
    current = stages.find(entry => entry.stage === 'npm-version')!;
    if (process.version !== expected.node) fail('PINNED_NODE_REQUIRED');
    const environment = rehearsalEnvironment(checkout, scratch), runner = options.runner ?? runRehearsalCommand;
    const npm = resolve(dirname(process.execPath), 'npm');
    for (const [stage, args, timeoutMs] of commandStages) {
      current = stages.find(entry => entry.stage === stage)!;
      if (stage === 'offline-preview' && !JSON.parse(trusted.files.get('package.json')!.toString('utf8')).scripts?.['preview:build']) { current.status = 'NOT RUN'; save(); continue; }
      if (options.signal?.aborted) fail('REHEARSAL_INTERRUPTED');
      if (stage === 'production-smoke' && !await portAvailable()) fail('PORT_4317_OCCUPIED_OR_UNAVAILABLE');
      const started = Date.now();
      const result = await runner({ stage, command: npm, args: [...args], cwd: checkout, env: stage === 'fresh-install' ? environment : { ...environment, npm_config_offline: 'true', ...(stage === 'production-smoke' ? { TINY_MIME_EVIDENCE_ROOT: evidence } : {}) }, timeoutMs, logPath: resolve(evidence, stage + '.log'), signal: options.signal });
      Object.assign(current, { exitCode: result.exitCode, signal: result.signal, timedOut: result.timedOut, durationMs: Date.now() - started });
      if (options.signal?.aborted) fail('REHEARSAL_INTERRUPTED');
      if (result.timedOut) fail('STAGE_TIMEOUT');
      if (result.outputLimit) fail('STAGE_OUTPUT_LIMIT');
      if (result.exitCode !== 0 || result.signal) fail('STAGE_FAILED');
      if (stage === 'npm-version' && result.stdout.trim() !== expected.npm) fail('PINNED_NPM_REQUIRED');
      current.status = 'PASS'; save();
    }
    current = stages.find(entry => entry.stage === 'repackage')!;
    verifyDistribution(checkout);
    if (!readFileSync(resolve(checkout, 'RELEASE_MANIFEST.json')).equals(manifest)) fail('SOURCE_MANIFEST_CHANGED');
    const repackaged = publicZip(buildPublicFiles(checkout).files, trusted.version);
    if (!repackaged.equals(bytes)) fail('REPACKAGE_BYTES_CHANGED');
    receipt.byteIdenticalRepackage = 'PASS'; current.status = 'PASS'; receipt.status = 'PASS';
  } catch (error) {
    receipt.status = 'FAIL'; receipt.failureCode = error instanceof RehearsalFailure ? error.message : 'REHEARSAL_CHECK_FAILED'; current.status = 'FAIL';
    if (receipt.sourceArchive.status === 'NOT CHECKED') receipt.sourceArchive.status = 'FAIL';
  } finally {
    if (checkout && manifest) {
      try { verifyDistribution(checkout); if (!readFileSync(resolve(checkout, 'RELEASE_MANIFEST.json')).equals(manifest)) fail('SOURCE_MANIFEST_CHANGED'); receipt.sourceIntegrity = 'PASS'; }
      catch { receipt.sourceIntegrity = 'FAIL'; receipt.status = 'FAIL'; receipt.failureCode ??= 'SOURCE_INTEGRITY_FAILED'; }
    }
    try { if (scratch) rmSync(scratch, { recursive: true, force: true }); receipt.cleanup = { status: 'PASS', scratchRemoved: !scratch || !existsSync(scratch) }; }
    catch { receipt.cleanup.status = 'FAIL'; receipt.status = 'FAIL'; receipt.failureCode ??= 'CLEANUP_FAILED'; }
    receipt.finishedAt = new Date().toISOString(); save(); sealEvidence(evidence);
  }
  return { status: receipt.status, execution, failureCode: receipt.failureCode, receipt: resolve(evidence, 'receipt.json'), archiveSha256: receipt.sourceArchive.sha256, sourceIntegrity: receipt.sourceIntegrity, cleanup: receipt.cleanup.status };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--archive' || !args[1]) { process.stderr.write('Usage: npm run release:rehearse -- --archive <local-source.zip>\nUse an archive from npm run release:prepare for this exact checkout. This command installs dependencies and runs local technical checks.\n'); process.exitCode = 1; }
  else {
    const controller = new AbortController(); const interrupt = () => controller.abort();
    process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
    try { const result = await runReleaseRehearsal({ archive: args[1], signal: controller.signal }); process.stdout.write(JSON.stringify(result) + '\n'); if (result.status !== 'PASS') process.exitCode = 1; }
    catch { process.stderr.write(JSON.stringify({ status: 'FAIL', failureCode: 'REHEARSAL_OUTPUT_UNAVAILABLE' }) + '\n'); process.exitCode = 1; }
    finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); }
  }
}
