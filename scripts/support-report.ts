import { spawnSync } from 'node:child_process';
import { constants, closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseJsonStrict } from '../src/shared/parseJson.js';

type PublicStatus = 'PASS' | 'MISSING' | 'UNAVAILABLE' | 'NOT CHECKED';
type SupportInput = { appVersion?: unknown; nodeDeclared?: unknown; npmDeclared?: unknown; nodeObserved?: unknown; npmObserved?: unknown; platform?: unknown; arch?: unknown; dependencies?: unknown; nativeSQLite?: unknown; productionBuild?: unknown };
const unavailable = 'UNAVAILABLE';
function version(value: unknown): string { return typeof value === 'string' && value.length <= 40 && /^v?\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(value) ? value : unavailable; }
function status(value: unknown): PublicStatus { return ['PASS', 'MISSING', 'UNAVAILABLE'].includes(value as string) ? value as PublicStatus : unavailable; }
export function buildSupportReport(input: SupportInput = {}) {
  return {
    version: 1,
    kind: 'sanitized_environment_report',
    application: { name: 'tiny-mime', version: version(input.appVersion) },
    toolchain: {
      node: { declared: version(input.nodeDeclared), observed: version(input.nodeObserved) },
      npm: { declared: version(input.npmDeclared), observed: version(input.npmObserved) },
    },
    platform: ['darwin', 'linux', 'win32', 'freebsd', 'openbsd', 'aix', 'sunos', 'android'].includes(input.platform as string) ? input.platform as string : unavailable,
    arch: ['arm', 'arm64', 'ia32', 'x64', 'ppc64', 's390x', 'riscv64', 'loong64'].includes(input.arch as string) ? input.arch as string : unavailable,
    checks: { dependencies: status(input.dependencies), nativeSQLite: status(input.nativeSQLite), productionBuild: status(input.productionBuild), port4317: 'NOT CHECKED' as const },
    coverage: 'Local environment only. Port availability is not checked because this command opens no listener. No runtime logs, configuration, databases, credentials or operator data are inspected.',
    qualifications: { liveProvider: 'NOT RUN', physicalDevice: 'NOT RUN', humanComprehension: 'NOT RUN', enjoyment: 'NOT RUN', sceneCalibration: 'NOT RUN', semanticFidelity: 'NOT RUN', comparativeEffect: 'NOT RUN', publicRelease: 'NOT RUN' },
  };
}
export type SupportReport = ReturnType<typeof buildSupportReport>;
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function manifest(file: string): Record<string, unknown> {
  const raw = readFileSync(file);
  if (raw.length > 256 * 1024) throw new Error('METADATA_UNAVAILABLE');
  const value = parseJsonStrict(raw.toString('utf8'), { maxBytes: 256 * 1024, maxDepth: 20 });
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('METADATA_UNAVAILABLE');
  return value as Record<string, unknown>;
}
export function collectSupportReport(root = projectRoot): SupportReport {
  const input: SupportInput = { nodeObserved: process.version, platform: process.platform, arch: process.arch };
  try { input.appVersion = manifest(join(root, 'package.json')).version; } catch { /* Only allowlisted fields leave this command. */ }
  try { const declared = manifest(join(root, 'toolchain-manifest.json')); input.nodeDeclared = declared.node; input.npmDeclared = declared.npm; } catch { /* Missing metadata remains unavailable. */ }
  try {
    const npm = spawnSync('npm', ['--version'], { encoding: 'utf8', timeout: 3000, maxBuffer: 128, env: { PATH: process.env.PATH, npm_config_userconfig: '/dev/null', npm_config_globalconfig: join(projectRoot, 'scripts/npm-global.npmrc'), npm_config_offline: 'true', npm_config_update_notifier: 'false', npm_config_ignore_scripts: 'true' } });
    if (!npm.error && npm.status === 0) input.npmObserved = npm.stdout.trim();
  } catch { /* Never include child-process errors or output. */ }
  try {
    const runtime = createRequire(import.meta.url)('./local-runtime.mjs') as { dependencies: (root: string) => boolean; sqlite: (root: string) => string };
    try { input.dependencies = runtime.dependencies(root) ? 'PASS' : 'MISSING'; } catch { input.dependencies = unavailable; }
    try { input.nativeSQLite = runtime.sqlite(root); } catch { input.nativeSQLite = unavailable; }
  } catch { /* These checks are optional diagnostics, not startup gates. */ }
  input.productionBuild = existsSync(join(root, 'dist/server/server/http.js')) && existsSync(join(root, 'dist/client/index.html')) ? 'PASS' : 'MISSING';
  return buildSupportReport(input);
}

export function writeSupportReport(report: SupportReport, outputPath: string, root = projectRoot): void {
  const resolvedRoot = resolve(root);
  // Resolve the trusted repository first; every directory we create or traverse below it must be real.
  if (realpathSync(resolvedRoot) !== resolvedRoot) throw new Error('OUTPUT_REJECTED');
  const allowed = join(resolvedRoot, 'artifacts', 'support');
  const destination = isAbsolute(outputPath) ? resolve(outputPath) : resolve(resolvedRoot, outputPath);
  if (outputPath.split(/[\\/]/).includes('..') || dirname(destination) !== allowed || relative(allowed, destination) !== basename(destination) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}\.json$/.test(basename(destination))) throw new Error('OUTPUT_REJECTED');
  for (const directory of [join(resolvedRoot, 'artifacts'), allowed]) {
    try { mkdirSync(directory, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new Error('OUTPUT_REJECTED'); }
    const info = lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(directory) !== directory || directory === allowed && (info.mode & 0o077) !== 0) throw new Error('OUTPUT_REJECTED');
  }
  const fd = openSync(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    if (!fstatSync(fd).isFile()) throw new Error('OUTPUT_REJECTED');
    // Re-project before writing so callers cannot attach raw fields to an otherwise valid report.
    const safe = buildSupportReport({ appVersion: report.application.version, nodeDeclared: report.toolchain.node.declared, nodeObserved: report.toolchain.node.observed, npmDeclared: report.toolchain.npm.declared, npmObserved: report.toolchain.npm.observed, platform: report.platform, arch: report.arch, ...report.checks });
    writeFileSync(fd, JSON.stringify(safe, null, 2) + '\n');
  } finally { closeSync(fd); }
}

export function runSupportReport(args: string[], root = projectRoot): { output: SupportReport | { version: 1; status: 'ERROR'; code: string }; exitCode: number } {
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--out' || !args[1])) return { output: { version: 1, status: 'ERROR', code: 'ARGUMENTS_INVALID' }, exitCode: 1 };
  try {
    const output = collectSupportReport(root);
    if (args.length) writeSupportReport(output, args[1], root);
    return { output, exitCode: 0 };
  } catch { return { output: { version: 1, status: 'ERROR', code: 'REPORT_UNAVAILABLE' }, exitCode: 1 }; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = runSupportReport(process.argv.slice(2));
  process.stdout.write(JSON.stringify(result.output, null, 2) + '\n');
  process.exitCode = result.exitCode;
}
