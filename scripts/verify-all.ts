import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, openSync, closeSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadAcceptanceRegistry, verifyAcceptanceReports } from './verify-acceptance.js';
import { assertUnchanged, inputHashes, sealEvidence, verifySourcePack } from './evidence.js';
import { sourceIdentity } from './source-distribution.js';

const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID();
const directory = resolve('artifacts/verification', runId); mkdirSync(directory, { recursive: true });
const receipt = { runId, startedAt: new Date().toISOString(), finishedAt: '', environment: { node: process.version, platform: process.platform, arch: process.arch, ...sourceIdentity(), providerCalls: 'NOT AUTHORIZED' }, status: 'RUNNING', stages: [] as unknown[] };
const save = () => writeFileSync(resolve(directory, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
const before = inputHashes();
writeFileSync(resolve(directory, 'inputs-before.json'), JSON.stringify(before, null, 2) + '\n'); save();
try {
  const pack = verifySourcePack(); writeFileSync(resolve(directory, 'source-pack.json'), JSON.stringify(pack, null, 2) + '\n'); receipt.stages.push({ stage: 'source-pack', ...pack });
  for (const [index, stage] of ['typecheck', 'test', 'verify:fixtures', 'test:browser', 'build', 'smoke:production', 'verify:release'].entries()) {
    const startedAt = new Date().toISOString(), prefix = String(index + 1).padStart(2, '0') + '-' + stage.replace(':', '-');
    const stdoutPath = resolve(directory, prefix + '.stdout.txt'), stderrPath = resolve(directory, prefix + '.stderr.txt');
    const stdout = openSync(stdoutPath, 'w'), stderr = openSync(stderrPath, 'w');
    const environment = { ...Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM', 'CI'].flatMap(name => process.env[name] === undefined ? [] : [[name, process.env[name]]])), npm_config_userconfig: '/dev/null', npm_config_globalconfig: resolve('scripts/npm-global.npmrc'), npm_config_registry: 'https://registry.npmjs.org' };
    const args = stage === 'test' ? ['test', '--', '--reporter=default', '--reporter=json', '--outputFile=' + resolve(directory, 'unit.json')] : ['run', stage];
    const child = spawnSync('npm', args, { stdio: ['ignore', stdout, stderr], timeout: stage === 'test:browser' ? 3600000 : 900000, env: { ...environment, TM_PROVIDER_MODE: 'disabled', TINY_MIME_EVIDENCE_ROOT: directory } });
    closeSync(stdout); closeSync(stderr);
    receipt.stages.push({ stage, argv: ['npm', ...args], startedAt, finishedAt: new Date().toISOString(), exitCode: child.status, signal: child.signal, error: child.error?.message ?? null, stdout: prefix + '.stdout.txt', stderr: prefix + '.stderr.txt' }); save();
    if (stage === 'build') writeFileSync(resolve(directory, 'build.json'), JSON.stringify({ command: 'npm run build', exitCode: child.status }) + '\n');
    process.stdout.write(readFileSync(stdoutPath)); process.stderr.write(readFileSync(stderrPath));
    if (child.error || child.status !== 0) throw new Error('FAILED_STAGE ' + stage);
  }
  const read = (name: string) => JSON.parse(readFileSync(resolve(directory, name + '.json'), 'utf8'));
  const browser = JSON.parse(readFileSync(resolve(directory, 'browser/results.json'), 'utf8'));
  writeFileSync(resolve(directory, 'browser.json'), JSON.stringify(browser, null, 2) + '\n');
  const acceptance = verifyAcceptanceReports(loadAcceptanceRegistry(), { unit: read('unit'), browser, build: read('build') });
  writeFileSync(resolve(directory, 'acceptance.json'), JSON.stringify(acceptance, null, 2) + '\n');
  receipt.stages.push({ stage: 'acceptance', ...acceptance }); receipt.status = 'PASS';
} catch (error) { receipt.status = 'FAIL'; receipt.stages.push({ stage: 'verification', status: 'FAIL', error: String(error) }); process.exitCode = 1; }
finally {
  try {
    const after = inputHashes(); writeFileSync(resolve(directory, 'inputs-after.json'), JSON.stringify(after, null, 2) + '\n');
    assertUnchanged(before, after); verifySourcePack(); receipt.stages.push({ stage: 'input-integrity', status: 'PASS', files: after.length });
  } catch (error) { receipt.status = 'FAIL'; receipt.stages.push({ stage: 'input-integrity', status: 'FAIL', error: String(error) }); process.exitCode = 1; }
  receipt.finishedAt = new Date().toISOString(); save();
  sealEvidence(directory);
  process.stdout.write(JSON.stringify({ status: receipt.status, receipt: resolve(directory, 'receipt.json'), manifest: resolve(directory, 'MANIFEST.sha256') }) + '\n');
}
