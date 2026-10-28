import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { runRuntimeQualification, runtimeTerminalSummary, runtimeProbeLedgerSchemaHash, type RuntimeReceipt } from '../../scripts/runtime-qualification.js';
import { runQualityProbe } from '../../scripts/quality-probe.js';
import { canonicalHash } from '../../src/shared/hash.js';
import { BudgetLedger } from '../../src/server/budget.js';
import { directorMeaning, getScene } from '../../src/server/operator/sceneBank.js';
import { providerVersions, type GenerateContext, type ProviderTransport } from '../../src/server/provider.js';
import { disabledProviderConfig } from '../../src/server/providerConfig.js';
import { ProbeLedger } from '../../src/server/provider/probeLedger.js';
let directory: string;
beforeEach(() => { directory = mkdtempSync(join(realpathSync(tmpdir()), 'tiny-mime-runtime-')); vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Real fetch forbidden'); })); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); rmSync(directory, { recursive: true, force: true }); });
function fixture() {
  const now = Date.now(), scene = getScene('TM01')!;
  const config = disabledProviderConfig(); config.provider = 'openai_responses'; config.modelId = 'mock-supported-model';
  config.priceSnapshot = { sourceUrl: 'https://openai.com/api/pricing/', checkedAt: new Date(now - 1000).toISOString(), inputUsdPerMillion: .1, outputUsdPerMillion: .1, otherChargeMicroUsd: 0, tokenAccountingVerified: true };
  config.approval = { approvalId: randomUUID(), approvedAt: new Date(now - 2000).toISOString(), expiresAt: new Date(now + 86400000).toISOString(), purpose: 'runtime_private_play', providerDisclosureVersion: 'fixture-disclosure', budgetAcknowledged: true };
  Object.assign(config.runtime, { enabled: true, callCapUsd: .1, unitCapUsd: .2, dayCapUsd: 1, jobCapUsd: 1, approvedCaseCount: 3 });
  const evidence = { version: 1, modelId: config.modelId, officialSourceUrl: 'https://developers.openai.com/api/docs/models/', checkedAt: new Date(now).toISOString(), responsesSupported: true, strictStructuredOutputsSupported: true, inputBytesPlus1024Verified: true, boundedOutputBillingVerified: true, explicitSpendingApproved: true, approvalId: config.approval.approvalId, providerDisclosureVersion: config.approval.providerDisclosureVersion };
  const base: GenerateContext = { sceneMeaning: directorMeaning(scene.meaning), roster: scene.roster, previousScore: scene.score, attempt: 2, firstGuessOccurred: true, repairErrors: null, generationProfile: 'runtime_blind_v1', guessData: { kind: 'withheld' } };
  const contexts: GenerateContext[] = [{ ...base, generationProfile: 'runtime_informed_v1', guessData: { kind: 'actual', text: 'They are dancing' } }, { ...base, generationProfile: 'runtime_informed_v1', guessData: { kind: 'actual', text: 'One is blocking the other' } }, base];
  const dataDir = join(directory, 'private-data-' + randomUUID());
  const plan = { version: 1, probeRunId: randomUUID(), approvalId: config.approval.approvalId, priceSnapshotId: randomUUID(), creatorOwnedNonpersonal: true, configHash: canonicalHash(config), evidenceHash: canonicalHash(evidence), providerVersionsHash: canonicalHash(providerVersions), probeLedgerSchemaHash: runtimeProbeLedgerSchemaHash, dataDir, cases: contexts.map(context => ({ caseId: randomUUID(), sceneId: 'TM01', meaningHash: canonicalHash(scene.meaning), rosterHash: canonicalHash(scene.roster), firstScoreHash: scene.scoreHash, context })) };
  const configPath = join(directory, 'fixture-config.json'), evidencePath = join(directory, 'fixture-evidence.json'), casesPath = join(directory, 'fixture-cases.json');
  const save = () => { writeFileSync(configPath, JSON.stringify(config)); writeFileSync(evidencePath, JSON.stringify(evidence)); writeFileSync(casesPath, JSON.stringify(plan)); };
  save();
  const args = ['--config', configPath, '--evidence', evidencePath, '--cases', casesPath, '--data-dir', dataDir];
  const execute = () => ['--execute', ...args, '--approved-plan-sha256', canonicalHash(plan)];
  const env = { TM_PROVIDER_MODE: config.provider, TM_MODEL_ID: config.modelId, TM_PROVIDER_CONFIG: configPath, TM_DATA_DIR: dataDir, OPENAI_API_KEY: 'mock-fixture-not-a-key' };
  return { config, evidence, plan, base, configPath, evidencePath, casesPath, dataDir, save, args, execute, env };
}
function response(score: unknown, kind = 'completed') {
  return new Response(JSON.stringify({ model: 'mock-supported-model', status: kind === 'incomplete' ? kind : 'completed', ...(kind === 'unknown_billing' ? {} : { usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 } }), output: [{ type: 'message', role: 'assistant', status: 'completed', content: kind === 'refusal' ? [{ type: 'refusal', refusal: 'fixture refusal' }] : [{ type: 'output_text', text: JSON.stringify(score) }] }] }), { headers: { 'x-request-id': 'fixture-request' } });
}
function rows(receipt: RuntimeReceipt) { return readFileSync(receipt.ledgerPath!, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
function accounting(dataDir: string) {
  expect(existsSync(join(dataDir, '.tiny-mime.lock'))).toBe(false);
  const db = new Database(join(dataDir, 'ledger.sqlite'));
  try { return db.prepare('SELECT profile,output_cap,status,actual FROM provider_calls').all(); } finally { db.close(); }
}
test('default and complete plan never inspect credentials, touch accounting, or dispatch', async () => {
  const f = fixture(), env = new Proxy({}, { get() { throw new Error('Credential/environment access forbidden'); }, ownKeys() { throw new Error('Environment access forbidden'); } });
  expect(await runRuntimeQualification([], env)).toMatchObject({ status: 'NOT RUN', mode: 'plan', source: null, calls: 0, liveProviderQualification: 'NOT RUN' });
  for (const args of [f.args, ['--plan', ...f.args]]) expect(await runRuntimeQualification(args, env)).toMatchObject({ status: 'PREFLIGHT_VALID', calls: 0, planHash: canonicalHash(f.plan), plannedCases: 3, unattemptedCases: 3, humanUsefulness: 'NOT RUN' });
  expect(existsSync(f.dataDir)).toBe(false); expect(fetch).not.toHaveBeenCalled();
});
test.each(['probeRunId', 'approvalId', 'priceSnapshotId', 'caseId'])('rejects uppercase %s before a call or private ledger can be created', async field => {
  const f = fixture();
  const value = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
  if (field === 'caseId') f.plan.cases[0].caseId = value;
  else (f.plan as Record<string, unknown>)[field] = value;
  f.save();
  await expect(runRuntimeQualification(f.execute(), f.env)).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled(); expect(existsSync(f.dataDir)).toBe(false);
});
test('native CLI default and plan ignore inherited credential/environment traps and emit no private context', () => {
  const f = fixture(), guardPath = join(directory, 'offline-guard.mjs');
  writeFileSync(guardPath, `globalThis.fetch = () => { throw new Error('Offline network access forbidden'); };
const inherited = process.env; process.env = new Proxy(inherited, { get(target, key) { if (key === 'OPENAI_API_KEY' || String(key).startsWith('TM_')) throw new Error('Offline provider environment access forbidden'); return Reflect.get(target, key); } });`);
  for (const args of [[], ['--plan', ...f.args]]) {
    const result = spawnSync(process.execPath, ['--import', guardPath, '--import', 'tsx', 'scripts/runtime-qualification.ts', ...args], { cwd: resolve('.'), env: { ...process.env, OPENAI_API_KEY: 'do-not-inspect-fixture-key', TM_MODEL_ID: 'mismatched-inherited-model', TM_PROVIDER_MODE: 'openai_responses', TM_UNAPPROVED: 'reject-only-on-execute' }, encoding: 'utf8', timeout: 10000 });
    expect(result.status).toBe(0); expect(JSON.parse(result.stdout)).toMatchObject({ mode: 'plan', calls: 0, liveProviderQualification: 'NOT RUN' });
    expect(result.stdout).not.toContain('do-not-inspect-fixture-key'); expect(result.stdout).not.toContain('They are dancing'); expect(result.stdout).not.toContain(f.dataDir);
  }
  expect(existsSync(f.dataDir)).toBe(false);
});
test('runtime path uses exact output cap and a single repair with private attempts and complete all-case summaries', async () => {
  const f = fixture(), requests: any[] = [], answers = [{}, f.base.previousScore, f.base.previousScore, f.base.previousScore];
  const transport = vi.fn(async (_url: string, init: RequestInit) => { requests.push(JSON.parse(init.body as string)); return response(answers.shift()); });
  const receipt = await runRuntimeQualification(f.execute(), f.env, { test: { transport } });
  expect(receipt).toMatchObject({ status: 'COMPLETE', plannedCases: 3, attemptedCases: 3, unattemptedCases: 0, validCases: 3, noChangeCases: 3, calls: 4, failedCases: 0, source: 'mock_fixture', liveProviderQualification: 'NOT RUN', timingPopulation: 'completed_cases_only' });
  expect(requests.map(r => r.max_output_tokens)).toEqual([6000, 6000, 6000, 6000]);
  const contexts = requests.map(r => JSON.parse(r.input[0].content[0].text));
  expect(contexts.map(c => c.generationProfile)).toEqual(['runtime_informed_v1', 'runtime_informed_v1', 'runtime_informed_v1', 'runtime_blind_v1']);
  expect(contexts[0].repairErrors).toBeNull(); expect(contexts[1].repairErrors.length).toBeGreaterThan(0);
  expect(rows(receipt).map(row => row.termination)).toEqual(['invalid_output', 'validated', 'validated', 'validated']);
  for (const row of rows(receipt)) expect(row).toMatchObject({ source: 'mock_fixture', costStatus: 'mock_zero', actualMicroUsd: 0 });
  expect(accounting(f.dataDir)).toHaveLength(4); for (const row of accounting(f.dataDir)) expect(row).toMatchObject({ profile: 'runtime', output_cap: 6000, status: 'known' });
  const manifest = JSON.parse(readFileSync(receipt.ledgerPath!.replace('.jsonl', '.manifest.json'), 'utf8'));
  expect(manifest.manifest.limits).toEqual({ callMs: 7000, caseMs: 15000, maximumCalls: 2, concurrency: 1, outputTokenCap: 6000 });
  expect(manifest.manifest.planHash).toBe(canonicalHash(f.plan));
  const summaryPath = receipt.ledgerPath!.replace('.jsonl', '.summary.json'); expect(statSync(summaryPath).mode & 0o777).toBe(0o600);
  expect(JSON.parse(readFileSync(summaryPath, 'utf8')).cases).toHaveLength(3);
  const terminal = JSON.stringify(runtimeTerminalSummary(receipt)); for (const value of [f.dataDir, 'They are dancing', 'mock-fixture-not-a-key', 'previousScore']) expect(terminal).not.toContain(value);
  expect(fetch).not.toHaveBeenCalled();
});
test('additive private ledger extension retains existing development quality-probe records', async () => {
  const f = fixture(); f.config.approval!.purpose = 'runtime_and_quality_probe';
  Object.assign(f.config.qualityProbe, { enabled: true, callCapUsd: .5, unitCapUsd: 1, dayCapUsd: 3, jobCapUsd: 3, approvedCaseCount: 3 });
  f.save(); writeFileSync(f.configPath + '.evidence.json', JSON.stringify(f.evidence));
  const qualityPlanPath = join(directory, 'quality-cases.json');
  writeFileSync(qualityPlanPath, JSON.stringify({ version: 1, probeRunId: randomUUID(), approvalId: f.config.approval!.approvalId, priceSnapshotId: randomUUID(), creatorOwnedNonpersonal: true, cases: f.plan.cases.map(entry => ({ caseId: entry.caseId, context: { ...entry.context, generationProfile: entry.context.guessData.kind === 'actual' ? 'development_probe_informed_v1' : 'development_probe_blind_v1' } })) }));
  const receipt = await runQualityProbe(['--config', f.configPath, '--cases', qualityPlanPath, '--data-dir', f.dataDir], f.env, async () => response(f.base.previousScore));
  expect(receipt).toMatchObject({ status: 'COMPLETE', calls: 3, successfulCases: 3, source: 'mock_fixture' });
  expect(readFileSync(receipt.ledgerPath!, 'utf8').trim().split('\n').map(line => JSON.parse(line).generationProfile)).toEqual(['development_probe_informed_v1', 'development_probe_informed_v1', 'development_probe_blind_v1']);
});
test.each(['refusal', 'incomplete', 'unknown_billing', 'network_error'])('stops without paid retry after %s, retaining failures and unattempted cases', async kind => {
  const f = fixture(), transport = vi.fn(async () => { if (kind === 'network_error') throw new Error('fixture disconnect'); return response(f.base.previousScore, kind); });
  const receipt = await runRuntimeQualification(f.execute(), f.env, { test: { transport } });
  expect(receipt).toMatchObject({ status: 'PARTIAL', plannedCases: 3, attemptedCases: 1, failedCases: 1, unattemptedCases: 2, calls: 1, validCases: 0, completedCaseP95Ms: null });
  expect(transport).toHaveBeenCalledTimes(1); expect(rows(receipt)).toHaveLength(1);
  const records = accounting(f.dataDir); expect(records).toHaveLength(1);
  if (['unknown_billing', 'network_error'].includes(kind)) { expect(receipt.stopReason).toBe('unknown_billing_or_ledger_locked'); expect(records[0]).toMatchObject({ actual: null, status: 'reserved_unknown' }); }
});
test('real 7-second runtime timer aborts one call, keeps uncertain reservation and never retries', async () => {
  vi.useFakeTimers(); const f = fixture(), started = Date.now(); let signal: AbortSignal | undefined;
  const transport: ProviderTransport = vi.fn(async (_url, init) => { signal = init.signal as AbortSignal; return new Promise<Response>(() => {}); });
  const pending = runRuntimeQualification(f.execute(), f.env, { test: { transport, nowMono: () => Date.now() - started } });
  await vi.advanceTimersByTimeAsync(6999); expect(signal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1); const receipt = await pending;
  expect(signal?.aborted).toBe(true); expect(receipt).toMatchObject({ status: 'PARTIAL', calls: 1, unattemptedCases: 2, failures: { deadline: 1 } });
  expect(rows(receipt)[0]).toMatchObject({ termination: 'deadline', elapsedMs: 7000 }); expect(accounting(f.dataDir)[0]).toMatchObject({ actual: null });
});
test('15-second shared runtime deadline cannot restart on validation repair', async () => {
  const f = fixture(); let mono = 0, calls = 0;
  const append = ProbeLedger.prototype.append;
  vi.spyOn(ProbeLedger.prototype, 'append').mockImplementation(function(this: ProbeLedger, ...args: Parameters<ProbeLedger['append']>) { append.apply(this, args); if (calls === 1) mono = 14000; });
  const transport = vi.fn(async () => { mono = ++calls === 1 ? 6500 : 15000; return response(calls === 1 ? {} : f.base.previousScore); });
  const receipt = await runRuntimeQualification(f.execute(), f.env, { test: { transport, nowMono: () => mono } });
  expect(receipt).toMatchObject({ status: 'PARTIAL', calls: 2, validCases: 0, failures: { deadline: 1 }, unattemptedCases: 2 });
  expect(rows(receipt).map(r => r.termination)).toEqual(['invalid_output', 'deadline']); expect(accounting(f.dataDir)).toHaveLength(2);
});
test('invalid outputs exhaust exactly one repair and completed-only p95 excludes failed cases', async () => {
  const f = fixture(); let mono = 0, calls = 0;
  const transport = vi.fn(async () => { mono += ++calls <= 2 ? 50 : 10; return response(calls <= 2 ? {} : f.base.previousScore); });
  const receipt = await runRuntimeQualification(f.execute(), f.env, { test: { transport, nowMono: () => mono } });
  expect(receipt).toMatchObject({ status: 'COMPLETE', calls: 4, attemptedCases: 3, validCases: 2, noChangeCases: 2, failedCases: 1, completedCaseP95Ms: 10, totalElapsedMs: 120, failures: { invalid_output: 1 } });
  expect(rows(receipt).map(row => row.attempt)).toEqual([1, 2, 1, 1]);
});
test('cancellation stops the current request and all later cases, retaining billing uncertainty', async () => {
  const f = fixture(), controller = new AbortController();
  const transport = vi.fn(async () => { queueMicrotask(() => controller.abort()); return new Promise<Response>(() => {}); });
  const receipt = await runRuntimeQualification(f.execute(), f.env, { signal: controller.signal, test: { transport } });
  expect(receipt).toMatchObject({ calls: 1, failedCases: 1, unattemptedCases: 2, failures: { cancelled: 1 } }); expect(accounting(f.dataDir)).toHaveLength(1);
});
test('pre-cancelled execution dispatches zero cases', async () => {
  const f = fixture(), controller = new AbortController(), transport = vi.fn(async () => response(f.base.previousScore)); controller.abort();
  const receipt = await runRuntimeQualification(f.execute(), f.env, { signal: controller.signal, test: { transport } });
  expect(receipt).toMatchObject({ status: 'PARTIAL', stopReason: 'cancelled', calls: 0, attemptedCases: 0, unattemptedCases: 3 }); expect(transport).not.toHaveBeenCalled();
});
test('accounting and diagnostic failures fail closed after one attempt with private preserved reservation', async () => {
  for (const method of ['accounting', 'diagnostics'] as const) {
    const f = fixture(), transport = vi.fn(async () => response(f.base.previousScore));
    const spy = method === 'accounting' ? vi.spyOn(BudgetLedger.prototype, 'reconcile').mockImplementation(() => { throw new Error('fixture accounting failure'); }) : vi.spyOn(ProbeLedger.prototype, 'append').mockImplementation(() => { throw new Error('fixture custody failure'); });
    const receipt = await runRuntimeQualification(f.execute(), f.env, { test: { transport } });
    expect(receipt).toMatchObject({ status: 'FAILED', calls: 1, failedCases: 1, unattemptedCases: 2 }); expect(transport).toHaveBeenCalledTimes(1);
    expect(accounting(f.dataDir)).toHaveLength(1); spy.mockRestore();
  }
});
test('restart lock cannot replenish an approved run', async () => {
  const f = fixture(), transport = vi.fn(async () => response(f.base.previousScore));
  await runRuntimeQualification(f.execute(), f.env, { test: { transport } });
  f.plan.probeRunId = randomUUID(); f.save(); transport.mockClear();
  expect(await runRuntimeQualification(f.execute(), f.env, { test: { transport } })).toMatchObject({ status: 'FAILED', stopReason: 'ledger_locked', calls: 0, unattemptedCases: 3 }); expect(transport).not.toHaveBeenCalled();
});
test.each(['--execute', '--execute --plan', '--unknown', '--config', '--plan --plan', '--approved-plan-sha256 bad'])('invalid invocation %s is blocked', async invocation => {
  await expect(runRuntimeQualification(invocation.split(' '))).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
});
test.each(['manifest', 'config', 'evidence', 'versions', 'ledgerSchema', 'dataDir', 'approval', 'caseCount', 'purpose', 'budget', 'profile', 'repair', 'score', 'meaning', 'roster', 'triplet', 'duplicateId', 'studyScene', 'unknownField'])('rejects %s mismatch before credential access or dispatch', async kind => {
  const f = fixture();
  switch (kind) {
    case 'manifest': f.plan.cases.pop(); break;
    case 'config': f.plan.configHash = '0'.repeat(64); break;
    case 'evidence': f.plan.evidenceHash = '0'.repeat(64); break;
    case 'versions': f.plan.providerVersionsHash = '0'.repeat(64); break;
    case 'ledgerSchema': f.plan.probeLedgerSchemaHash = '0'.repeat(64); break;
    case 'dataDir': f.plan.dataDir = join(directory, 'another-data'); break;
    case 'approval': f.plan.approvalId = randomUUID(); break;
    case 'caseCount': f.config.runtime.approvedCaseCount = 4; f.plan.configHash = canonicalHash(f.config); break;
    case 'purpose': f.config.approval!.purpose = 'runtime_study'; f.plan.configHash = canonicalHash(f.config); break;
    case 'budget': f.config.runtime.callCapUsd = .000001; f.plan.configHash = canonicalHash(f.config); break;
    case 'profile': f.plan.cases[0].context.generationProfile = 'development_probe_informed_v1'; break;
    case 'repair': f.plan.cases[0].context.repairErrors = [{ code: 'SCHEMA', path: '/' }]; break;
    case 'score': f.plan.cases[0].firstScoreHash = '0'.repeat(64); break;
    case 'meaning': f.plan.cases[0].context.sceneMeaning.target = 'Changed meaning'; break;
    case 'roster': f.plan.cases[0].rosterHash = '0'.repeat(64); break;
    case 'triplet': f.plan.cases[1].context.guessData = f.plan.cases[0].context.guessData; break;
    case 'duplicateId': f.plan.cases[1].caseId = f.plan.cases[0].caseId; break;
    case 'studyScene': f.plan.cases[0].sceneId = 'TM02'; break;
    case 'unknownField': Object.assign(f.plan, { unauthorized: true }); break;
  }
  f.save();
  const env = new Proxy({}, { get() { throw new Error('Must not inspect credentials'); }, ownKeys() { throw new Error('Must not inspect environment'); } });
  await expect(runRuntimeQualification(f.args, env)).rejects.toThrow(); expect(existsSync(f.dataDir)).toBe(false); expect(fetch).not.toHaveBeenCalled();
});
test('execution rejects unapproved hash, key absence, environment mismatch and non-test injection', async () => {
  const f = fixture(), transport = vi.fn(async () => response(f.base.previousScore));
  await expect(runRuntimeQualification([...f.execute().slice(0, -1), '0'.repeat(64)], f.env, { test: { transport } })).rejects.toThrow('HASH');
  for (const env of [{ ...f.env, OPENAI_API_KEY: undefined }, { ...f.env, TM_MODEL_ID: 'other' }, { ...f.env, TM_DATA_DIR: join(directory, 'other') }, { ...f.env, TM_PROVIDER_CONFIG: f.casesPath }, { ...f.env, TM_STUDY_ENABLED: 'true' }, { ...f.env, TM_UNAPPROVED: 'true' }]) await expect(runRuntimeQualification(f.execute(), env, { test: { transport } })).rejects.toThrow();
  const old = process.env.NODE_ENV; process.env.NODE_ENV = 'production'; try { await expect(runRuntimeQualification(f.execute(), f.env, { test: { transport } })).rejects.toThrow('test-only'); } finally { process.env.NODE_ENV = old; }
  expect(transport).not.toHaveBeenCalled(); expect(existsSync(f.dataDir)).toBe(false);
});
test.each(['duplicate_key', 'utf8', 'oversize', 'symlink', 'parent_symlink', 'credential_path', 'data_symlink', 'dangling_data_symlink'])('strict input custody rejects %s', async kind => {
  const f = fixture(); let args = f.args;
  if (kind === 'duplicate_key') writeFileSync(f.casesPath, '{"version":1,"version":1}');
  if (kind === 'utf8') writeFileSync(f.casesPath, Buffer.from([123, 34, 0xff, 34, 58, 49, 125]));
  if (kind === 'oversize') writeFileSync(f.casesPath, ' '.repeat(256 * 1024 + 1));
  if (kind === 'symlink') { const linked = join(directory, 'linked.json'); symlinkSync(f.casesPath, linked); args = f.args.map(arg => arg === f.casesPath ? linked : arg); }
  if (kind === 'parent_symlink') { const linked = join(directory, 'linked'); symlinkSync(directory, linked); args = f.args.map(arg => arg === f.casesPath ? join(linked, 'fixture-cases.json') : arg); }
  if (kind === 'credential_path') args = f.args.map(arg => arg === f.configPath ? join(directory, '.env.json') : arg);
  if (kind === 'data_symlink') { symlinkSync(directory, f.dataDir); }
  if (kind === 'dangling_data_symlink') { symlinkSync(join(directory, 'absent-directory'), f.dataDir); }
  await expect(runRuntimeQualification(args)).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
});
