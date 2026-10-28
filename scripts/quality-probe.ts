import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { parseJsonStrict } from '../src/shared/parseJson.js';
import { BudgetLedger } from '../src/server/budget.js';
import { activationEvidenceSchema, requireActivation, validateProviderConfig, validateProviderEnvironment } from '../src/server/providerConfig.js';
import { compileRequest, generateValidated, providerVersions, type GenerateContext, type ProviderTransport } from '../src/server/provider.js';
import { ProbeLedger } from '../src/server/provider/probeLedger.js';
import { lockDataDir, openPrivateDb, prepareDataDir } from '../src/server/storage/db.js';

const planSchema=z.object({version:z.literal(1),probeRunId:z.uuidv4(),approvalId:z.uuidv4(),priceSnapshotId:z.uuidv4(),creatorOwnedNonpersonal:z.literal(true),cases:z.array(z.object({caseId:z.uuidv4(),context:z.unknown()}).strict()).min(3).max(1000)}).strict();
export type ProbeReceipt = {status:'COMPLETE'|'PARTIAL'|'FAILED'; stopReason:string|null; plannedCases:number; attemptedCases:number; successfulCases:number; calls:number; source:'runtime_generated'|'mock_fixture'; ledgerPath:string|null};
class ProbeRunError extends Error { constructor(readonly receipt:ProbeReceipt) {super('Probe stopped; inspect private accounting and diagnostics');} }
export function probeTerminalSummary(receipt:ProbeReceipt){const {ledgerPath,...summary}=receipt;return {event:'probe_finished',...summary};}
function nonsecretJson(path:string):unknown {
  if (!isAbsolute(path) || !path.endsWith('.json') || statSync(path).size > 1048576) throw new Error('Nonsecret JSON path required');
  return parseJsonStrict(readFileSync(path,'utf8'),{maxBytes:1048576,maxDepth:20});
}
export async function runQualityProbe(args:string[],env:Record<string,string|undefined>=process.env,testTransport?:ProviderTransport):Promise<ProbeReceipt> {
  if(testTransport && process.env.NODE_ENV!=='test')throw new Error('Mock transport is test-only');
  const source=testTransport ? 'mock_fixture' as const : 'runtime_generated' as const;
  if (args.length !== 6 || args[0] !== '--config' || args[2] !== '--cases' || args[4] !== '--data-dir') throw new Error('Approved --config, --cases and private --data-dir are required. Live quality probe NOT RUN.');
  const config=validateProviderConfig(nonsecretJson(args[1]));
  validateProviderEnvironment(env,config);
  const evidence=activationEvidenceSchema.parse(nonsecretJson(args[1]+'.evidence.json'));
  requireActivation(config,evidence,env.OPENAI_API_KEY);
  if (!config.qualityProbe.enabled) throw new Error('Quality probe disabled');
  const plan=planSchema.parse(nonsecretJson(args[3]));
  if (plan.approvalId !== config.approval!.approvalId || plan.cases.length !== config.qualityProbe.approvedCaseCount || new Set(plan.cases.map(c=>c.caseId)).size!==plan.cases.length) throw new Error('Approved case manifest mismatch');
  const groups=new Map<string,GenerateContext[]>();
  for (const entry of plan.cases) {
    const context=entry.context as GenerateContext;
    if (!context.generationProfile?.startsWith('development_probe_') || context.repairErrors !== null) throw new Error('Probe profiles only');
    compileRequest(context,config.modelId!,12000);
    const key=createHash('sha256').update(JSON.stringify({meaning:context.sceneMeaning,roster:context.roster,score:context.previousScore})).digest('hex');
    groups.set(key,[...(groups.get(key)??[]),context]);
  }
  for (const cases of groups.values()) {
    if (cases.length!==3 || cases.filter(c=>c.guessData.kind==='withheld').length!==1 || new Set(cases.filter(c=>c.guessData.kind==='actual').map(c=>c.guessData.kind==='actual' ? c.guessData.text : '')).size!==2) throw new Error('Each frozen scene requires two distinct creator misunderstandings and one withheld case');
  }
  if (!isAbsolute(args[5])) throw new Error('Absolute private data directory required');
  const dataDir=prepareDataDir(args[5]);
  const releaseLock=lockDataDir(dataDir);
  let db: Database.Database | undefined;
  let calls=0, attemptedCases=0, successfulCases=0;
  let ledgerPath:string|null=null;
  try {
    db=openPrivateDb(dataDir,'ledger.sqlite'); const ledger=new BudgetLedger(db);
    if (ledger.status().locked) return {status:'FAILED',stopReason:'ledger_locked',plannedCases:plan.cases.length,attemptedCases,calls,successfulCases,source,ledgerPath};
    const diagnostics=new ProbeLedger(resolve(dataDir,'probe-private'),plan.probeRunId,{source,costProvenance:testTransport?'mock_zero':'runtime_accounting',plan,config,evidence,versions:providerVersions,limits:{callMs:45000,caseMs:90000,maximumCalls:2,concurrency:1},initialRequests:plan.cases.map(entry=>({caseId:entry.caseId,requestBodyJson:compileRequest(entry.context as GenerateContext,config.modelId!,12000).bodyJson}))});
    ledgerPath=diagnostics.ledgerPath;
    let stopReason:string|null=null, lastTermination:string|null=null;
    for(const entry of plan.cases) {
      const context=entry.context as GenerateContext;
      attemptedCases++;
      const result=await generateValidated(context,{config,ledger,jobId:plan.probeRunId,unitId:entry.caseId,deadlineMonoMs:performance.now()+90000,apiKey:env.OPENAI_API_KEY,activationEvidence:evidence,transport:testTransport,onAttempt:record=>{calls++;lastTermination=record.termination;diagnostics.append(context,entry.caseId,record,plan.priceSnapshotId,source);}},new AbortController().signal);
      if(result.ok)successfulCases++;
      if(!result.ok&&['deadline','cancelled','provider_error','refusal','limited'].includes(result.failure)){
        stopReason=result.failure==='provider_error'?(lastTermination==='incomplete'?'incomplete':ledger.status().locked?'unknown_billing':'provider_error'):result.failure;break;
      }
      if(ledger.status().locked){stopReason='ledger_locked';break;}
    }
    return {status:stopReason?'PARTIAL':'COMPLETE',stopReason,plannedCases:plan.cases.length,attemptedCases,successfulCases,calls,source,ledgerPath};
  } catch(error) { if(calls>0) throw new ProbeRunError({status:'FAILED',stopReason:'diagnostic_or_accounting_failure',plannedCases:plan.cases.length,attemptedCases,successfulCases,calls,source,ledgerPath}); throw error; }
  finally { db?.close(); releaseLock(); }
}
if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  runQualityProbe(process.argv.slice(2)).then(receipt=>{process.stdout.write(JSON.stringify(probeTerminalSummary(receipt))+'\n');if(receipt.status!=='COMPLETE')process.exitCode=1;}).catch(error=>{process.stderr.write(JSON.stringify(error instanceof ProbeRunError ? probeTerminalSummary(error.receipt) : {event:'probe_blocked',status:'NOT RUN',reason:'Approved bounded config/evidence/cases, secure key injection and reconciled private accounting are required'})+'\n');process.exitCode=1;});
}
