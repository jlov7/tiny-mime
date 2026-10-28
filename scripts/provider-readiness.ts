import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseJsonStrict } from '../src/shared/parseJson.js';
import { activationEvidenceSchema, disabledProviderConfig, validateProviderConfig } from '../src/server/providerConfig.js';

const maxBytes = 256 * 1024;
type Check = 'VALID' | 'MISSING' | 'MISMATCH' | 'INVALID' | 'NOT APPLICABLE' | 'NOT CHECKED';
export type ReadinessReport = {
  version: 1;
  status: 'DISABLED_DEFAULT' | 'VALID_DISABLED' | 'OFFLINE_PREREQUISITES_INCOMPLETE' | 'OFFLINE_PREREQUISITES_VALID' | 'INVALID_INPUT';
  code: string;
  checks: { config: Check; model: Check; price: Check; disclosure: Check; budget: Check; approval: Check; activationEvidence: Check };
  credentialPresence: 'NOT CHECKED';
  authentication: 'NOT CHECKED';
  credits: 'NOT CHECKED';
  liveProviderQualification: 'NOT RUN';
  nextSteps: string[];
};
const steps = [
  'Create a nonsecret disabled configuration with --template, then review the provider runbook.',
  'Obtain explicit approval for the exact model, current official prices, disclosure, purpose and bounded workload. Record only nonsecret configuration and activation evidence.',
  'Keep credentials in the existing secure environment. This command never checks credentials, authentication, credits or live support.',
  'Run an authorized bounded quality probe separately before claiming live-provider qualification. Live qualification remains NOT RUN here.',
];
export function invalidReadiness(code = 'INPUT_INVALID'): ReadinessReport {
  return { version: 1, status: 'INVALID_INPUT', code, checks: { config: code === 'CONFIG_INVALID' ? 'INVALID' : 'NOT CHECKED', model: 'NOT CHECKED', price: 'NOT CHECKED', disclosure: 'NOT CHECKED', budget: 'NOT CHECKED', approval: 'NOT CHECKED', activationEvidence: 'NOT CHECKED' }, credentialPresence: 'NOT CHECKED', authentication: 'NOT CHECKED', credits: 'NOT CHECKED', liveProviderQualification: 'NOT RUN', nextSteps: steps };
}

// Read only explicit nonsecret JSON files. Reject symlinks, including parent directories.
export function readNonsecretJson(file: string): unknown {
  if (!isAbsolute(file) || file.length > 4096 || !file.endsWith('.json') || /[\x00-\x1f]/.test(file) || file.split(/[\\/]/).some(part => part === '..' || /(?:^\.env|secret|credential|auth|token|api[-_]?key|^\.ssh$|^\.aws$)/i.test(part))) throw new Error('INPUT_PATH_REJECTED');
  const normalized = resolve(file);
  let parent = normalized;
  for (;;) {
    if (lstatSync(parent).isSymbolicLink()) throw new Error('INPUT_PATH_REJECTED');
    const next = resolve(parent, '..');
    if (next === parent) break;
    parent = next;
  }
  const fd = openSync(normalized, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes) throw new Error('INPUT_INVALID');
    const buffer = Buffer.alloc(maxBytes + 1);
    let size = 0, read = 0;
    while (size < buffer.length && (read = readSync(fd, buffer, size, buffer.length - size, null)) > 0) size += read;
    if (size > maxBytes) throw new Error('INPUT_INVALID');
    return parseJsonStrict(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size)), { maxBytes, maxDepth: 20 });
  } finally { closeSync(fd); }
}

export function buildReadinessReport(input: unknown = disabledProviderConfig(), evidence?: unknown, nowMs = Date.now(), isDefault = false): ReadinessReport {
  let config;
  try { config = validateProviderConfig(input, nowMs); } catch { return invalidReadiness('CONFIG_INVALID'); }
  const report: ReadinessReport = { version: 1, status: 'OFFLINE_PREREQUISITES_INCOMPLETE', code: 'EVIDENCE_MISSING', checks: { config: 'VALID', model: 'VALID', price: 'VALID', disclosure: 'VALID', budget: 'VALID', approval: 'VALID', activationEvidence: 'MISSING' }, credentialPresence: 'NOT CHECKED', authentication: 'NOT CHECKED', credits: 'NOT CHECKED', liveProviderQualification: 'NOT RUN', nextSteps: steps };
  if (config.provider === 'disabled') {
    report.status = isDefault ? 'DISABLED_DEFAULT' : 'VALID_DISABLED';
    report.code = 'PROVIDER_DISABLED';
    report.checks = { config: 'VALID', model: 'NOT APPLICABLE', price: 'NOT APPLICABLE', disclosure: 'NOT APPLICABLE', budget: 'NOT APPLICABLE', approval: 'NOT APPLICABLE', activationEvidence: 'NOT APPLICABLE' };
    if (evidence !== undefined && !activationEvidenceSchema.safeParse(evidence).success) { report.status = 'INVALID_INPUT'; report.code = 'EVIDENCE_INVALID'; report.checks.activationEvidence = 'INVALID'; }
    return report;
  }
  if (evidence === undefined) return report;
  const parsed = activationEvidenceSchema.safeParse(evidence);
  if (!parsed.success) { report.status = 'INVALID_INPUT'; report.code = 'EVIDENCE_INVALID'; report.checks.activationEvidence = 'INVALID'; return report; }
  // These are the same noncredential bindings checked by requireActivation.
  const data = parsed.data;
  if (data.modelId !== config.modelId) { report.checks.model = 'MISMATCH'; report.code = 'EVIDENCE_MODEL_MISMATCH'; }
  else if (data.approvalId !== config.approval!.approvalId) { report.checks.approval = 'MISMATCH'; report.code = 'EVIDENCE_APPROVAL_MISMATCH'; }
  else if (data.providerDisclosureVersion !== config.approval!.providerDisclosureVersion) { report.checks.disclosure = 'MISMATCH'; report.code = 'EVIDENCE_DISCLOSURE_MISMATCH'; }
  else if (Date.parse(data.checkedAt) > nowMs || Date.parse(data.checkedAt) < Date.parse(config.approval!.approvedAt)) report.code = 'EVIDENCE_TIME_INVALID';
  else { report.status = 'OFFLINE_PREREQUISITES_VALID'; report.code = 'OFFLINE_RECORDS_VALID'; report.checks.activationEvidence = 'VALID'; return report; }
  report.checks.activationEvidence = 'MISMATCH';
  return report;
}

export function runProviderReadiness(args: string[], nowMs = Date.now()): { output: unknown; exitCode: number } {
  if (args.length === 1 && args[0] === '--template') return { output: disabledProviderConfig(), exitCode: 0 };
  try {
    const options = new Map<string, string>();
    for (let i = 0; i < args.length; i += 2) {
      if (!['--config', '--evidence'].includes(args[i]) || !args[i + 1] || options.has(args[i])) return { output: invalidReadiness('ARGUMENTS_INVALID'), exitCode: 1 };
      options.set(args[i], args[i + 1]);
    }
    if (options.has('--evidence') && !options.has('--config')) return { output: invalidReadiness('CONFIG_REQUIRED'), exitCode: 1 };
    const output = buildReadinessReport(options.has('--config') ? readNonsecretJson(options.get('--config')!) : disabledProviderConfig(), options.has('--evidence') ? readNonsecretJson(options.get('--evidence')!) : undefined, nowMs, !options.has('--config'));
    return { output, exitCode: ['INVALID_INPUT', 'OFFLINE_PREREQUISITES_INCOMPLETE'].includes(output.status) ? 1 : 0 };
  } catch { return { output: invalidReadiness(), exitCode: 1 }; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = runProviderReadiness(process.argv.slice(2));
  process.stdout.write(JSON.stringify(result.output, null, 2) + '\n');
  process.exitCode = result.exitCode;
}
