import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildSupportReport, collectSupportReport, runSupportReport, writeSupportReport } from '../../scripts/support-report.js';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));
let directory: string;
beforeEach(() => {
  mkdirSync('.scratch', { recursive: true }); directory = mkdtempSync(resolve('.scratch/support-'));
  vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: '12.0.0\n', stderr: '', pid: 1, output: [], signal: null });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('NETWORK_FORBIDDEN private-sensitive-value'); }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); rmSync(directory, { recursive: true, force: true }); });

test('allowlists public fields, statuses and bounded numeric versions', () => {
  const malicious = { appVersion: '/Users/private-sensitive-value', nodeObserved: 'v24.15.0\n/private-sensitive-value', nodeDeclared: '24.15.0', npmObserved: '12.0.0', npmDeclared: 'private-sensitive-value', platform: 'private-sensitive-value', arch: 'private-sensitive-value', dependencies: 'PASS', nativeSQLite: 'ERROR /private-sensitive-value', productionBuild: 'MISSING', unknown: 'private-sensitive-value', logs: 'private-sensitive-value', env: { KEY: 'private-sensitive-value' } };
  const report = buildSupportReport(malicious);
  expect(report).toMatchObject({ application: { name: 'tiny-mime', version: 'UNAVAILABLE' }, toolchain: { node: { declared: '24.15.0', observed: 'UNAVAILABLE' }, npm: { declared: 'UNAVAILABLE', observed: '12.0.0' } }, platform: 'UNAVAILABLE', arch: 'UNAVAILABLE', checks: { dependencies: 'PASS', nativeSQLite: 'UNAVAILABLE', productionBuild: 'MISSING', port4317: 'NOT CHECKED' } });
  expect(new Set(Object.values(report.qualifications))).toEqual(new Set(['NOT RUN']));
  expect(JSON.stringify(report)).not.toContain('private-sensitive-value'); expect(report).not.toHaveProperty('unknown');
  for (const value of ['1.0.0-/private-sensitive-value', '1.0.0-private-sensitive-value', '1'.repeat(200), {}, null]) expect(buildSupportReport({ appVersion: value }).application.version).toBe('UNAVAILABLE');
});
test('collection sanitizes malformed local metadata, child output and exception messages', () => {
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ version: '0.2.0', unknown: 'private-sensitive-value' }));
  writeFileSync(join(directory, 'toolchain-manifest.json'), JSON.stringify({ node: 'v24.15.0', npm: '12.0.0', unknown: 'private-sensitive-value' }));
  vi.mocked(spawnSync).mockImplementation(() => { throw new Error('private-sensitive-value ' + directory); });
  const report = collectSupportReport(directory);
  expect(report.application.version).toBe('0.2.0'); expect(report.toolchain.npm.observed).toBe('UNAVAILABLE');
  expect(JSON.stringify(report)).not.toContain('private-sensitive-value'); expect(JSON.stringify(report)).not.toContain(directory);
  vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: '12.0.0 /private-sensitive-value', stderr: 'private-sensitive-value', pid: 1, output: [], signal: null });
  expect(collectSupportReport(directory).toolchain.npm.observed).toBe('UNAVAILABLE');
  expect(vi.mocked(spawnSync).mock.calls[0][1]).toEqual(['--version']);
  const options = vi.mocked(spawnSync).mock.calls[0][2]; expect(options).toMatchObject({ timeout: 3000, maxBuffer: 128, env: { npm_config_offline: 'true', npm_config_userconfig: '/dev/null', npm_config_globalconfig: resolve('scripts/npm-global.npmrc') } });
  expect(options?.env).not.toHaveProperty('HOME'); expect(options?.env).not.toHaveProperty('OPENAI_API_KEY'); expect(fetch).not.toHaveBeenCalled();
});
test('preview writes nothing and --out creates only a new private allowlisted JSON file', () => {
  const preview = runSupportReport([], directory); expect(preview.exitCode).toBe(0); expect(existsSync(join(directory, 'artifacts'))).toBe(false);
  const output = join(directory, 'artifacts/support/report.json');
  const result = runSupportReport(['--out', 'artifacts/support/report.json'], directory); expect(result.exitCode).toBe(0);
  expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual(result.output);
  expect(statSync(output).mode & 0o777).toBe(0o600); expect(statSync(join(directory, 'artifacts/support')).mode & 0o777).toBe(0o700);
  const original = readFileSync(output, 'utf8');
  expect(runSupportReport(['--out', output], directory)).toMatchObject({ exitCode: 1, output: { code: 'REPORT_UNAVAILABLE' } }); expect(readFileSync(output, 'utf8')).toBe(original);
});
test('export reprojects its report and refuses path escapes, traversal, symlinks and loose report directories', () => {
  const report = Object.assign(buildSupportReport({ appVersion: '0.2.0' }), { rawLog: 'private-sensitive-value' });
  for (const path of ['/private-sensitive-value.json', '../outside.json', 'artifacts/support/../elsewhere.json', 'artifacts/support/nested/report.json', 'artifacts/support/report.txt']) expect(() => writeSupportReport(report, path, directory)).toThrow();
  writeSupportReport(report, 'artifacts/support/safe.json', directory); expect(readFileSync(join(directory, 'artifacts/support/safe.json'), 'utf8')).not.toContain('private-sensitive-value');
  symlinkSync(join(directory, 'outside.json'), join(directory, 'artifacts/support/link.json')); expect(() => writeSupportReport(report, 'artifacts/support/link.json', directory)).toThrow(); expect(existsSync(join(directory, 'outside.json'))).toBe(false);
  chmodSync(join(directory, 'artifacts/support'), 0o755); expect(() => writeSupportReport(report, 'artifacts/support/loose.json', directory)).toThrow();
  rmSync(join(directory, 'artifacts/support'), { recursive: true }); symlinkSync(directory, join(directory, 'artifacts/support')); expect(() => writeSupportReport(report, 'artifacts/support/redirect.json', directory)).toThrow();
});
test('a symlinked artifacts directory is rejected without writing through it', () => {
  mkdirSync(join(directory, 'outside')); symlinkSync(join(directory, 'outside'), join(directory, 'artifacts'));
  expect(() => writeSupportReport(buildSupportReport(), 'artifacts/support/report.json', directory)).toThrow(); expect(existsSync(join(directory, 'outside/support'))).toBe(false);
});
test('CLI failures never echo paths, supplied fields or errors', () => {
  for (const args of [['--raw', 'private-sensitive-value'], ['--out', '/private-sensitive-value.json'], ['--out']]) {
    const result = runSupportReport(args, directory); expect(result.exitCode).toBe(1); expect(JSON.stringify(result.output)).not.toContain('private-sensitive-value'); expect(JSON.stringify(result.output)).not.toContain(directory);
  }
});
test('real CLI is offline with fetch, HTTP, sockets and listener APIs blocked', async () => {
  const { spawnSync: actualSpawn } = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  const guard = join(directory, 'network-guard.mjs');
  writeFileSync(guard, `import http from 'node:http'; import https from 'node:https'; import net from 'node:net'; import {syncBuiltinESMExports} from 'node:module'; const fail=()=>{throw new Error('NETWORK_FORBIDDEN private-sensitive-value')}; globalThis.fetch=fail; http.request=fail; http.get=fail; https.request=fail; https.get=fail; net.connect=fail; net.createConnection=fail; net.Server.prototype.listen=fail; syncBuiltinESMExports();`);
  const result = actualSpawn(process.execPath, ['--import', 'tsx', '--import', guard, 'scripts/support-report.ts'], { encoding: 'utf8', timeout: 10000 });
  expect(result.status).toBe(0); expect(result.stderr).toBe(''); const report = JSON.parse(result.stdout);
  expect(report).toMatchObject({ kind: 'sanitized_environment_report', application: { version: JSON.parse(readFileSync('package.json', 'utf8')).version }, toolchain: { npm: { observed: '12.0.0' } }, checks: { port4317: 'NOT CHECKED' }, qualifications: { liveProvider: 'NOT RUN' } });
  for (const value of [directory, '/Users/', 'private-sensitive-value', 'OPENAI_API_KEY']) expect(result.stdout).not.toContain(value);
});
