import { afterEach, expect, it } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { assertUnchanged, inputHashes, sealEvidence, sha256, verifySourcePack } from '../../scripts/evidence.js';
import { auditStatus } from '../../scripts/audit-dependencies.js';
import { productionSmoke } from '../../scripts/production-smoke.js';
const directories: string[] = [];
function fixture() { const scratch = resolve('.scratch'); mkdirSync(scratch, { recursive: true }); const root = mkdtempSync(resolve(scratch, 'quality-tools-')); directories.push(root); return root; }
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

it('detects added, modified and missing verification inputs while excluding operator data and credentials', () => {
  const root = fixture(); mkdirSync(resolve(root, 'src')); writeFileSync(resolve(root, 'src/input.ts'), 'before');
  const before = inputHashes(root);
  writeFileSync(resolve(root, '.env'), 'do not include'); symlinkSync('/nonexistent/credential-file', resolve(root, '.npmrc')); mkdirSync(resolve(root, '.scratch')); writeFileSync(resolve(root, '.scratch/operator.sqlite'), 'private');
  expect(inputHashes(root)).toEqual(before);
  writeFileSync(resolve(root, 'src/input.ts'), 'changed'); expect(() => assertUnchanged(before, inputHashes(root))).toThrow('VERIFICATION_INPUTS_CHANGED');
  writeFileSync(resolve(root, 'src/input.ts'), 'before'); writeFileSync(resolve(root, 'src/added.ts'), 'new'); expect(() => assertUnchanged(before, inputHashes(root))).toThrow('VERIFICATION_INPUTS_CHANGED');
  rmSync(resolve(root, 'src/added.ts')); rmSync(resolve(root, 'src/input.ts')); expect(() => assertUnchanged(before, inputHashes(root))).toThrow('VERIFICATION_INPUTS_CHANGED');
});
it('verifies the exact source-pack profile and rejects byte tampering and manifest omissions', () => {
  const root = fixture(); const pack = resolve(root, 'Tiny_Mime_Review_Source_Pack'); cpSync('Tiny_Mime_Review_Source_Pack', pack, { recursive: true });
  if (verifySourcePack().scope === 'public-specification-subset') { mkdirSync(resolve(root, 'release')); cpSync('release/source-pack-subset.json', resolve(root, 'release/source-pack-subset.json')); }
  expect(verifySourcePack(root)).toEqual(verifySourcePack());
  const source = resolve(pack, 'chapters/02_technical_spec.md'); const original = readFileSync(source); writeFileSync(source, 'tampered'); expect(() => verifySourcePack(root)).toThrow('SOURCE_PACK_HASH'); writeFileSync(source, original);
  const manifest = resolve(pack, 'MANIFEST.sha256'); writeFileSync(manifest, readFileSync(manifest, 'utf8').split('\n').slice(1).join('\n')); expect(() => verifySourcePack(root)).toThrow('SOURCE_PACK_MANIFEST_COUNT');
});
it('seals nested test artifacts and rejects links to files outside the evidence run', () => {
  const root = fixture(); mkdirSync(resolve(root, 'capture')); writeFileSync(resolve(root, 'capture/replay.html'), 'local fixture');
  expect(sealEvidence(root).files).toBe(2);
  const index = JSON.parse(readFileSync(resolve(root, 'evidence-index.json'), 'utf8')); expect(index.artifacts).toEqual([{ path: 'capture/replay.html', sha256: sha256('local fixture'), bytes: 13 }]);
  expect(readFileSync(resolve(root, 'MANIFEST.sha256'), 'utf8')).toContain(sha256(readFileSync(resolve(root, 'evidence-index.json'))));
  symlinkSync(resolve('package.json'), resolve(root, 'outside.json')); expect(() => sealEvidence(root)).toThrow('EVIDENCE_SYMLINK');
});
it('never treats unavailable, timed out or vulnerable dependency audit results as passing', () => {
  const clean = JSON.stringify({ metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } } });
  expect(auditStatus({ stdout: clean, status: 0, signal: null }, []).status).toBe('PASS');
  for (const child of [{ stdout: '', status: 1, signal: null }, { stdout: JSON.stringify({ metadata: { vulnerabilities: {} } }), status: 0, signal: null }, { stdout: clean, status: null, signal: 'SIGTERM', error: new Error('ETIMEDOUT') }, { stdout: JSON.stringify({ error: { code: 'NETWORK' } }), status: 1, signal: null }]) expect(auditStatus(child, []).status).toBe('UNAVAILABLE');
  expect(auditStatus({ stdout: JSON.stringify({ metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 } } }), status: 1, signal: null }, []).status).toBe('FAIL');
  expect(auditStatus({ stdout: clean, status: 0, signal: null }, ['UNPINNED dependency']).status).toBe('FAIL');
});
it('doctor works without installed dependencies and fails a wrong toolchain without repairing it', () => {
  const root = fixture(); writeFileSync(resolve(root, 'toolchain-manifest.json'), JSON.stringify({ node: 'v0.0.0', npm: '0.0.0' }));
  writeFileSync(resolve(root, 'package-lock.json'), JSON.stringify({ packages: { '': { dependencies: { unavailable: '1.0.0' } } } }));
  const before = readdirSync(root); const child = spawnSync(process.execPath, [resolve('scripts/doctor.mjs'), 'test'], { cwd: root, encoding: 'utf8', timeout: 15000 });
  expect(child.status).toBe(1); const report = JSON.parse(child.stdout); expect(report.checks).toMatchObject({ node: { status: 'FAIL' }, dependencies: 'MISSING', nativeSQLite: 'UNAVAILABLE', productionBuild: 'MISSING' }); expect(readdirSync(root)).toEqual(before);
});
it('production startup failure removes only its own scratch directory', async () => {
  const root = fixture(); mkdirSync(resolve(root, '.scratch/preserve'), { recursive: true });
  await expect(productionSmoke(root)).rejects.toThrow('SMOKE_START_FAILED');
  expect(readdirSync(resolve(root, '.scratch'))).toEqual(['preserve']);
});

it('local command timeout force-stops a child that ignores SIGTERM', () => {
  const root = fixture(), marker = resolve(root, 'term-received'), ready = resolve(root, 'ready');
  const childProgram = `process.on('SIGTERM', () => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'received')); require('node:fs').writeFileSync(${JSON.stringify(ready)}, 'ready'); setInterval(() => {}, 1000);`;
  // Gate only the test's deadline on handler readiness. Keep the real SIGKILL escalation timer.
  const source = `import { runCommand } from ${JSON.stringify(pathToFileURL(resolve('scripts/local-runtime.mjs')).href)};
    import { existsSync } from 'node:fs';
    const nativeTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (callback, delay, ...args) => {
      if (delay !== 200) return nativeTimeout(callback, delay, ...args);
      const timer = nativeTimeout(() => { if (existsSync(${JSON.stringify(ready)})) callback(...args); else timer.refresh(); }, delay);
      return timer;
    };
    let abort;
    try { await runCommand(process.execPath, ['-e', ${JSON.stringify(childProgram)}], { timeoutMs: 200, killAfterMs: 100, stdio: 'ignore', onStop: stop => {
      if (stop) { abort = () => stop('SIGKILL'); process.once('SIGTERM', abort); }
      else if (abort) process.removeListener('SIGTERM', abort);
    } }); process.exitCode = 1; } catch (error) { process.stdout.write(error.message); }`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', timeout: 15000 });
  expect(child.error).toBeUndefined(); expect(child.status).toBe(0); expect(child.stdout).toBe('COMMAND_TIMEOUT'); expect(readFileSync(marker, 'utf8')).toBe('received');
}, 20000);
it('local command interruption allows a cooperative child to finish cleanup', () => {
  const root = fixture(), marker = resolve(root, 'interrupt-cleanup'), ready = resolve(root, 'ready');
  const childProgram = `process.on('SIGINT', () => { require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'clean'); process.exit(0); }); require('node:fs').writeFileSync(${JSON.stringify(ready)}, 'ready'); setInterval(() => {}, 1000);`;
  const source = `import { runCommand } from ${JSON.stringify(pathToFileURL(resolve('scripts/local-runtime.mjs')).href)};
    import { existsSync } from 'node:fs';
    let readiness, abort;
    await runCommand(process.execPath, ['-e', ${JSON.stringify(childProgram)}], { killAfterMs: 100, stdio: 'ignore', onStop: stop => {
      if (!stop) { clearInterval(readiness); if (abort) process.removeListener('SIGTERM', abort); return; }
      abort = () => stop('SIGKILL'); process.once('SIGTERM', abort);
      readiness = setInterval(() => { if (existsSync(${JSON.stringify(ready)})) { clearInterval(readiness); stop('SIGINT'); } }, 10);
    } });`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', timeout: 15000 });
  expect(child.error).toBeUndefined(); expect(child.status).toBe(0); expect(readFileSync(marker, 'utf8')).toBe('clean');
}, 20000);
