import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildReadinessReport, readNonsecretJson, runProviderReadiness } from '../../scripts/provider-readiness.js';
import { disabledProviderConfig } from '../../src/server/providerConfig.js';

let directory: string;
const now = Date.parse('2026-10-18T12:00:00Z');
beforeEach(() => { mkdirSync('.scratch', { recursive: true }); directory = mkdtempSync(resolve('.scratch/readiness-')); vi.stubGlobal('fetch', vi.fn(() => { throw new Error('NETWORK_FORBIDDEN private-sensitive-value'); })); });
afterEach(() => { vi.unstubAllGlobals(); rmSync(directory, { recursive: true, force: true }); });
function fixture() {
  const config = disabledProviderConfig();
  config.provider = 'openai_responses'; config.modelId = 'fixture-model-never-live';
  config.priceSnapshot = { sourceUrl: 'https://openai.com/api/pricing/', checkedAt: '2026-10-18T11:00:00Z', inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.1, otherChargeMicroUsd: 0, tokenAccountingVerified: true };
  config.approval = { approvalId: '00000000-0000-4000-8000-000000000001', approvedAt: '2026-10-18T10:00:00Z', expiresAt: '2026-10-19T10:00:00Z', purpose: 'quality_probe', providerDisclosureVersion: 'fixture-disclosure', budgetAcknowledged: true };
  Object.assign(config.qualityProbe, { enabled: true, callCapUsd: 0.5, unitCapUsd: 1, dayCapUsd: 3, jobCapUsd: 3, approvedCaseCount: 3 });
  const evidence = { version: 1, modelId: config.modelId, officialSourceUrl: 'https://openai.com/api/', checkedAt: '2026-10-18T11:00:00Z', responsesSupported: true, strictStructuredOutputsSupported: true, inputBytesPlus1024Verified: true, boundedOutputBillingVerified: true, explicitSpendingApproved: true, approvalId: config.approval.approvalId, providerDisclosureVersion: config.approval.providerDisclosureVersion };
  return { config, evidence };
}
function file(name: string, value: unknown) { const path = join(directory, name); writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value)); return path; }

test('default and template preserve disabled configuration and never imply live readiness', () => {
  expect(runProviderReadiness([])).toMatchObject({ exitCode: 0, output: { status: 'DISABLED_DEFAULT', credentialPresence: 'NOT CHECKED', liveProviderQualification: 'NOT RUN' } });
  expect(runProviderReadiness(['--template'])).toEqual({ exitCode: 0, output: disabledProviderConfig() });
  expect(runProviderReadiness(['--config', file('disabled.json', disabledProviderConfig())]).output).toMatchObject({ status: 'VALID_DISABLED', checks: { model: 'NOT APPLICABLE' } });
  expect(fetch).not.toHaveBeenCalled();
});
test('valid nonsecret records establish only offline prerequisites', () => {
  const { config, evidence } = fixture();
  expect(buildReadinessReport(config, undefined, now)).toMatchObject({ status: 'OFFLINE_PREREQUISITES_INCOMPLETE', code: 'EVIDENCE_MISSING' });
  const report = buildReadinessReport(config, evidence, now);
  expect(report).toMatchObject({ status: 'OFFLINE_PREREQUISITES_VALID', checks: { config: 'VALID', model: 'VALID', price: 'VALID', disclosure: 'VALID', budget: 'VALID', approval: 'VALID', activationEvidence: 'VALID' }, credentialPresence: 'NOT CHECKED', authentication: 'NOT CHECKED', credits: 'NOT CHECKED', liveProviderQualification: 'NOT RUN' });
  const text = JSON.stringify(report); for (const value of [config.modelId!, config.approval!.approvalId, config.approval!.providerDisclosureVersion]) expect(text).not.toContain(value);
  expect(fetch).not.toHaveBeenCalled();
});
test.each([
  ['modelId', 'different', 'EVIDENCE_MODEL_MISMATCH'],
  ['approvalId', '00000000-0000-4000-8000-000000000002', 'EVIDENCE_APPROVAL_MISMATCH'],
  ['providerDisclosureVersion', 'different', 'EVIDENCE_DISCLOSURE_MISMATCH'],
  ['checkedAt', '2026-10-18T13:00:00Z', 'EVIDENCE_TIME_INVALID'],
  ['checkedAt', '2026-10-18T09:00:00Z', 'EVIDENCE_TIME_INVALID'],
])('matches activation binding %s', (field, value, code) => {
  const { config, evidence } = fixture();
  expect(buildReadinessReport(config, { ...evidence, [field]: value }, now)).toMatchObject({ status: 'OFFLINE_PREREQUISITES_INCOMPLETE', code });
});
test('closed schemas and cross-field config semantics remain enforced', () => {
  const { config, evidence } = fixture();
  expect(buildReadinessReport({ ...config, unknown: 'private-sensitive-value' }, evidence, now)).toMatchObject({ status: 'INVALID_INPUT', code: 'CONFIG_INVALID' });
  expect(buildReadinessReport(config, { ...evidence, unknown: 'private-sensitive-value' }, now)).toMatchObject({ status: 'INVALID_INPUT', code: 'EVIDENCE_INVALID' });
  config.qualityProbe.jobCapUsd = 1;
  expect(buildReadinessReport(config, evidence, now)).toMatchObject({ code: 'CONFIG_INVALID' });
  const expired = fixture(); expired.config.approval!.expiresAt = '2026-10-18T11:00:00Z';
  expect(buildReadinessReport(expired.config, expired.evidence, now)).toMatchObject({ code: 'CONFIG_INVALID' });
});
test('input boundary rejects credential names, symlinks, depth, size, duplicate keys and unknown fields', () => {
  for (const name of ['.env.json', 'credentials.json', 'auth.json', 'token.json', 'api-key.json']) expect(() => readNonsecretJson(join(directory, name))).toThrow();
  const target = file('safe.json', disabledProviderConfig()); symlinkSync(target, join(directory, 'link.json'));
  expect(() => readNonsecretJson(join(directory, 'link.json'))).toThrow();
  symlinkSync(directory, join(directory, 'alias'));
  expect(() => readNonsecretJson(join(directory, 'alias/safe.json'))).toThrow();
  expect(() => readNonsecretJson('safe.json')).toThrow();
  expect(() => readNonsecretJson(file('large.json', ' '.repeat(256 * 1024 + 1)))).toThrow();
  expect(() => readNonsecretJson(file('deep.json', '['.repeat(21) + '0' + ']'.repeat(21)))).toThrow();
  expect(() => readNonsecretJson(file('duplicate.json', '{"version":1,"version":1}'))).toThrow();
  expect(() => readNonsecretJson(file('comments.json', '/* comment */{}'))).toThrow();
  const invalidUtf8 = join(directory, 'invalid-encoding.json'); writeFileSync(invalidUtf8, Buffer.from([123, 34, 120, 34, 58, 34, 192, 34, 125]));
  expect(() => readNonsecretJson(invalidUtf8)).toThrow();
  expect(readNonsecretJson(file('boundary.json', ' '.repeat(256 * 1024 - 2) + '{}'))).toEqual({});
});
test('invalid CLI input returns only generic codes and never private paths, contents or exception text', () => {
  for (const args of [['--config', join(directory, 'private-sensitive-value.json')], ['--evidence', '/private-sensitive-value.json'], ['--config', file('invalid.json', '{private-sensitive-value')], ['--template', '--config', '/private-sensitive-value.json'], ['--config', '/x', '--config', '/y']]) {
    const result = runProviderReadiness(args, now); expect(result.exitCode).toBe(1); const text = JSON.stringify(result.output); expect(text).not.toContain(directory); expect(text).not.toContain('private-sensitive-value');
  }
});
test('real CLI is offline with network APIs blocked and preserves NOT RUN qualification', () => {
  const guard = file('network-guard.mjs', `import http from 'node:http'; import https from 'node:https'; import net from 'node:net'; import {syncBuiltinESMExports} from 'node:module'; const fail=()=>{throw new Error('NETWORK_FORBIDDEN private-sensitive-value')}; globalThis.fetch=fail; http.request=fail; http.get=fail; https.request=fail; https.get=fail; net.connect=fail; net.createConnection=fail; net.Server.prototype.listen=fail; syncBuiltinESMExports();`);
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--import', guard, 'scripts/provider-readiness.ts'], { encoding: 'utf8', timeout: 10000 });
  expect(result.status).toBe(0); expect(result.stderr).toBe(''); expect(JSON.parse(result.stdout)).toMatchObject({ status: 'DISABLED_DEFAULT', liveProviderQualification: 'NOT RUN' });
  expect(readFileSync('scripts/provider-readiness.ts', 'utf8')).not.toContain('process.env');
});
