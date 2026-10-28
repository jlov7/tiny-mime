import { existsSync, lstatSync, readdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { canonicalHash } from '../src/shared/hash.js';
import { BudgetLedger, reserveMicroUsd } from '../src/server/budget.js';
import { developmentIds, directorMeaning, getScene } from '../src/server/operator/sceneBank.js';
import { compileRequest, generateValidated, providerVersions, type GenerateContext, type ProviderTransport } from '../src/server/provider.js';
import { activationEvidenceSchema, usdMicro, validateProviderConfig, validateProviderEnvironment, requireActivation } from '../src/server/providerConfig.js';
import { ProbeLedger } from '../src/server/provider/probeLedger.js';
import probeLedgerSchema from '../src/server/provider/probe-ledger-v1.schema.json' with { type: 'json' };
import { lockDataDir, openPrivateDb, prepareDataDir } from '../src/server/storage/db.js';
import { buildReadinessReport, readNonsecretJson } from './provider-readiness.js';

export const runtimeProbeLedgerSchemaHash = canonicalHash(probeLedgerSchema);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.uuidv4().refine(value => value === value.toLowerCase());
export const runtimePlanSchema = z.object({
  version: z.literal(1), probeRunId: uuid, approvalId: uuid, priceSnapshotId: uuid,
  creatorOwnedNonpersonal: z.literal(true), configHash: hash, evidenceHash: hash, providerVersionsHash: hash, probeLedgerSchemaHash: hash,
  dataDir: z.string(), cases: z.array(z.object({ caseId: uuid, sceneId: z.enum(developmentIds),
    meaningHash: hash, rosterHash: hash, firstScoreHash: hash, context: z.unknown() }).strict()).min(3).max(9),
}).strict();
export type RuntimePlan = z.infer<typeof runtimePlanSchema>;
const limits = { callMs: 7000, caseMs: 15000, maximumCalls: 2, concurrency: 1, outputTokenCap: 6000 } as const;
type CaseOutcome = { caseId: string; status: 'unattempted' | 'valid' | 'failed'; calls: number; elapsedMs: number | null; noChange: boolean; failure: string | null };
export type RuntimeReceipt = {
  version: 1; mode: 'plan' | 'execute'; status: 'NOT RUN' | 'PREFLIGHT_VALID' | 'COMPLETE' | 'PARTIAL' | 'FAILED';
  stopReason: string | null; source: 'mock_fixture' | 'runtime_generated' | null; plannedCases: number;
  attemptedCases: number; unattemptedCases: number; validCases: number; noChangeCases: number; failedCases: number;
  calls: number; totalElapsedMs: number; completedCaseP95Ms: number | null; timingPopulation: 'completed_cases_only';
  failures: Record<string, number>; planHash: string | null; ledgerPath: string | null;
  liveProviderQualification: 'NOT RUN' | 'TIMING_EVIDENCE_ONLY'; humanUsefulness: 'NOT RUN'; semanticImprovement: 'NOT ASSESSED';
};
type Options = { signal?: AbortSignal; test?: { transport: ProviderTransport; nowMono?: () => number; nowWall?: () => number } };
export class RuntimeQualificationError extends Error {
  constructor(readonly receipt: RuntimeReceipt) { super('Runtime diagnostic stopped; inspect private accounting'); }
}
export function runtimeTerminalSummary(receipt: RuntimeReceipt) { const { ledgerPath, ...summary } = receipt; return { event: 'runtime_qualification', ...summary }; }
function privatePath(path: string) {
  if (!isAbsolute(path) || resolve(path) !== path || path === '/' || path.length > 4096 || /[\x00-\x1f]/.test(path) || path.split(/[\\/]/).some(part => part === '..' || /(?:^\.env|secret|credential|auth|token|api[-_]?key|^\.ssh$|^\.aws$)/i.test(part))) throw new Error('DATA_PATH_REJECTED');
  let parent = path;
  for (;;) {
    if (lstatSync(parent, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('DATA_PATH_REJECTED');
    const next = resolve(parent, '..'); if (next === parent) break; parent = next;
  }
  if (path === process.cwd() || path.startsWith(process.cwd() + '/')) throw new Error('DATA_PATH_REJECTED');
  for (const name of ['ledger.sqlite', 'ledger.sqlite-journal', 'ledger.sqlite-wal', 'ledger.sqlite-shm', '.tiny-mime.lock', 'probe-private']) {
    const entry = join(path, name);
    if (lstatSync(entry, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('DATA_PATH_REJECTED');
  }
  const diagnostics = join(path, 'probe-private');
  if (existsSync(diagnostics)) {
    const children = readdirSync(diagnostics); if (children.length > 10000) throw new Error('DATA_PATH_REJECTED');
    for (const name of children) if (!lstatSync(join(diagnostics, name)).isFile()) throw new Error('DATA_PATH_REJECTED');
  }
}
function argumentsFor(args: string[]) {
  let execute = false, plan = false;
  const paths = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--execute') { if (execute) throw new Error('ARGUMENTS_INVALID'); execute = true; }
    else if (arg === '--plan') { if (plan) throw new Error('ARGUMENTS_INVALID'); plan = true; }
    else {
      if (!['--config', '--evidence', '--cases', '--data-dir', '--approved-plan-sha256'].includes(arg) || paths.has(arg) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('ARGUMENTS_INVALID');
      paths.set(arg, args[++i]);
    }
  }
  if (execute && plan || !execute && paths.has('--approved-plan-sha256')) throw new Error('ARGUMENTS_INVALID');
  const inputs = ['--config', '--evidence', '--cases', '--data-dir'];
  if ((paths.size > 0 || execute) && inputs.some(key => !paths.has(key)) || execute && !paths.has('--approved-plan-sha256')) throw new Error('ARGUMENTS_INVALID');
  return { execute, paths };
}
function loadInputs(paths: Map<string, string>, nowWall: number) {
  const config = validateProviderConfig(readNonsecretJson(paths.get('--config')!), nowWall);
  const evidence = activationEvidenceSchema.parse(readNonsecretJson(paths.get('--evidence')!));
  if (buildReadinessReport(config, evidence, nowWall).status !== 'OFFLINE_PREREQUISITES_VALID') throw new Error('ACTIVATION_RECORDS_INVALID');
  const plan = runtimePlanSchema.parse(readNonsecretJson(paths.get('--cases')!));
  const dataDir = paths.get('--data-dir')!; privatePath(dataDir);
  if (!config.runtime.enabled || !['runtime_private_play', 'runtime_and_quality_probe'].includes(config.approval!.purpose) || config.runtime.approvedCaseCount !== plan.cases.length || plan.approvalId !== config.approval!.approvalId || plan.configHash !== canonicalHash(config) || plan.evidenceHash !== canonicalHash(evidence) || plan.providerVersionsHash !== canonicalHash(providerVersions) || plan.probeLedgerSchemaHash !== runtimeProbeLedgerSchemaHash || plan.dataDir !== dataDir || new Set(plan.cases.map(entry => entry.caseId)).size !== plan.cases.length) throw new Error('PLAN_BINDING_MISMATCH');
  const groups = new Map<string, GenerateContext[]>();
  for (const entry of plan.cases) {
    const scene = getScene(entry.sceneId)!;
    const context = entry.context as GenerateContext;
    if (!context || !['runtime_informed_v1', 'runtime_blind_v1'].includes(context.generationProfile) || context.repairErrors !== null) throw new Error('RUNTIME_PROFILE_REQUIRED');
    compileRequest(context, config.modelId!, 6000);
    if (entry.meaningHash !== canonicalHash(scene.meaning) || entry.rosterHash !== canonicalHash(scene.roster) || entry.firstScoreHash !== scene.scoreHash || canonicalHash(context.sceneMeaning) !== canonicalHash(directorMeaning(scene.meaning)) || canonicalHash(context.roster) !== entry.rosterHash || canonicalHash(context.previousScore) !== entry.firstScoreHash) throw new Error('FROZEN_SCENE_MISMATCH');
    groups.set(entry.sceneId, [...(groups.get(entry.sceneId) ?? []), context]);
  }
  for (const contexts of groups.values()) {
    const guesses = contexts.filter(c => c.guessData.kind === 'actual').map(c => c.guessData.kind === 'actual' ? c.guessData.text : '');
    if (contexts.length !== 3 || contexts.filter(c => c.guessData.kind === 'withheld').length !== 1 || guesses.length !== 2 || new Set(guesses).size !== 2) throw new Error('FROZEN_TRIPLET_REQUIRED');
  }
  const worstCall = reserveMicroUsd(32768, 6000, config.priceSnapshot!);
  if (worstCall > usdMicro(config.runtime.callCapUsd) || 2 * worstCall > usdMicro(config.runtime.unitCapUsd) || 2 * worstCall * plan.cases.length > Math.min(usdMicro(config.runtime.jobCapUsd), usdMicro(config.runtime.dayCapUsd))) throw new Error('WORST_CASE_BUDGET_INSUFFICIENT');
  return { config, evidence, plan, dataDir };
}
export async function runRuntimeQualification(args: string[], env?: Record<string, string | undefined>, options: Options = {}): Promise<RuntimeReceipt> {
  if (options.test && process.env.NODE_ENV !== 'test') throw new Error('Test injection is test-only');
  const { execute, paths } = argumentsFor(args);
  const nowMono = options.test?.nowMono ?? (() => performance.now());
  const nowWall = options.test?.nowWall ?? Date.now;
  const receipt: RuntimeReceipt = { version: 1, mode: execute ? 'execute' : 'plan', status: 'NOT RUN', stopReason: null, source: null,
    plannedCases: 0, attemptedCases: 0, unattemptedCases: 0, validCases: 0, noChangeCases: 0, failedCases: 0, calls: 0,
    totalElapsedMs: 0, completedCaseP95Ms: null, timingPopulation: 'completed_cases_only', failures: {}, planHash: null, ledgerPath: null,
    liveProviderQualification: 'NOT RUN', humanUsefulness: 'NOT RUN', semanticImprovement: 'NOT ASSESSED' };
  if (!paths.size) return receipt;
  const { config, evidence, plan, dataDir } = loadInputs(paths, nowWall());
  receipt.planHash = canonicalHash(plan); receipt.plannedCases = receipt.unattemptedCases = plan.cases.length;
  if (!execute) { receipt.status = 'PREFLIGHT_VALID'; return receipt; }
  if (paths.get('--approved-plan-sha256') !== receipt.planHash) throw new Error('APPROVED_PLAN_HASH_MISMATCH');
  const executionEnv = env ?? process.env;
  validateProviderEnvironment(executionEnv, config);
  if (executionEnv.TM_PROVIDER_CONFIG !== paths.get('--config') || executionEnv.TM_DATA_DIR !== dataDir || executionEnv.TM_STUDY_ENABLED === 'true' || executionEnv.TM_STUDY_MANIFEST) throw new Error('EXECUTION_ENVIRONMENT_MISMATCH');
  requireActivation(config, evidence, executionEnv.OPENAI_API_KEY, nowWall());
  receipt.source = options.test ? 'mock_fixture' : 'runtime_generated';
  const outcomes: CaseOutcome[] = plan.cases.map(entry => ({ caseId: entry.caseId, status: 'unattempted', calls: 0, elapsedMs: null, noChange: false, failure: null }));
  const signal = options.signal ?? new AbortController().signal;
  const started = nowMono();
  prepareDataDir(dataDir); privatePath(dataDir);
  const release = lockDataDir(dataDir);
  let db: Database.Database | undefined;
  let diagnostics: ProbeLedger | undefined;
  const finish = () => {
    receipt.attemptedCases = outcomes.filter(c => c.status !== 'unattempted').length;
    receipt.unattemptedCases = plan.cases.length - receipt.attemptedCases;
    receipt.validCases = outcomes.filter(c => c.status === 'valid').length;
    receipt.noChangeCases = outcomes.filter(c => c.noChange).length;
    receipt.failedCases = outcomes.filter(c => c.status === 'failed').length;
    receipt.totalElapsedMs = Math.max(0, Math.round(nowMono() - started));
    const completed = outcomes.filter(c => c.status === 'valid').map(c => c.elapsedMs!).sort((a, b) => a - b);
    receipt.completedCaseP95Ms = completed.length ? completed[Math.ceil(completed.length * .95) - 1] : null;
    receipt.failures = {};
    for (const outcome of outcomes) if (outcome.failure) receipt.failures[outcome.failure] = (receipt.failures[outcome.failure] ?? 0) + 1;
    if (receipt.calls && !options.test) receipt.liveProviderQualification = 'TIMING_EVIDENCE_ONLY';
  };
  try {
    db = openPrivateDb(dataDir, 'ledger.sqlite');
    const ledger = new BudgetLedger(db, nowWall);
    diagnostics = new ProbeLedger(join(dataDir, 'probe-private'), plan.probeRunId, { source: receipt.source, costProvenance: options.test ? 'mock_zero' : 'runtime_accounting', plan, config, evidence, versions: providerVersions, probeLedgerSchemaHash: runtimeProbeLedgerSchemaHash, limits, planHash: receipt.planHash, initialRequests: plan.cases.map(entry => ({ caseId: entry.caseId, requestBodyJson: compileRequest(entry.context as GenerateContext, config.modelId!, 6000).bodyJson })) }, nowWall);
    receipt.ledgerPath = diagnostics.ledgerPath;
    if (ledger.status().locked) { receipt.status = 'FAILED'; receipt.stopReason = 'ledger_locked'; }
    else for (let i = 0; i < plan.cases.length; i++) {
      if (signal.aborted) { receipt.stopReason = 'cancelled'; break; }
      const entry = plan.cases[i], outcome = outcomes[i], context = entry.context as GenerateContext;
      outcome.status = 'failed'; const caseStart = nowMono();
      let lastTermination: string | null = null;
      try {
        const result = await generateValidated(context, { config, ledger, jobId: plan.probeRunId, unitId: entry.caseId, deadlineMonoMs: caseStart + 15000, apiKey: executionEnv.OPENAI_API_KEY, activationEvidence: evidence, transport: options.test?.transport, nowMono, nowWall, onAttempt: record => {
          receipt.calls++; outcome.calls++; lastTermination = record.termination;
          diagnostics!.append(context, entry.caseId, record, plan.priceSnapshotId, receipt.source!);
        } }, signal);
        if (result.ok) { outcome.status = 'valid'; outcome.noChange = result.noChange; }
        else { outcome.failure = result.failure; if (result.failure !== 'invalid_output') receipt.stopReason = ledger.status().locked ? 'unknown_billing_or_ledger_locked' : lastTermination === 'incomplete' ? 'incomplete' : result.failure; }
        if (ledger.status().locked) receipt.stopReason = 'unknown_billing_or_ledger_locked';
        else if (ledger.summaryForUnit(plan.probeRunId, entry.caseId).actualMicroUsd === null) { outcome.failure = 'diagnostic_or_accounting_failure'; receipt.stopReason = outcome.failure; receipt.status = 'FAILED'; }
      } catch { outcome.failure = 'diagnostic_or_accounting_failure'; receipt.stopReason = outcome.failure; receipt.status = 'FAILED'; }
      finally { outcome.elapsedMs = Math.max(0, Math.round(nowMono() - caseStart)); }
      if (receipt.stopReason) break;
    }
    if (receipt.status !== 'FAILED') receipt.status = receipt.stopReason ? 'PARTIAL' : 'COMPLETE';
    finish();
    writeFileSync(diagnostics.ledgerPath.replace(/\.jsonl$/, '.summary.json'), JSON.stringify({ receipt, cases: outcomes }), { flag: 'wx', mode: 0o600 });
    return receipt;
  } catch {
    receipt.status = 'FAILED'; receipt.stopReason = 'diagnostic_or_accounting_failure'; finish();
    throw new RuntimeQualificationError(receipt);
  } finally { db?.close(); release(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const controller = new AbortController();
  const cancel = () => controller.abort(); process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  runRuntimeQualification(process.argv.slice(2), undefined, { signal: controller.signal }).then(receipt => {
    process.stdout.write(JSON.stringify(runtimeTerminalSummary(receipt)) + '\n');
    if (receipt.status === 'FAILED' || receipt.status === 'PARTIAL') process.exitCode = 1;
  }).catch(error => {
    process.stderr.write(JSON.stringify(error instanceof RuntimeQualificationError ? runtimeTerminalSummary(error.receipt) : { event: 'runtime_qualification', status: 'NOT RUN', reason: 'Approved exact runtime configuration, evidence, frozen manifest, private accounting and explicit execute gate are required' }) + '\n'); process.exitCode = 1;
  }).finally(() => { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); });
}
