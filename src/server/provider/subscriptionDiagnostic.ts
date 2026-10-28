import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { appendFileSync, chmodSync, closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { compileRequest, providerVersions, type GenerateContext } from '../provider.js';
import { getScene, directorMeaning } from '../operator/sceneBank.js';
import { DIRECTOR_TEMPLATE } from './template.js';
import { parseJsonStrict } from '../../shared/parseJson.js';
import { canonicalJson, scoreHash } from '../../shared/hash.js';
import { validateScore } from '../../shared/validateScore.js';

export const SUBSCRIPTION_MODEL = 'gpt-6.1-sol';
export const SUBSCRIPTION_CLI_VERSION = '0.160.1';
const nativeCatalogHash='a919d1658322cec8b115f90680399101f73dd62e428316fc998448484071ecdb';
const nativeCatalogPath=()=>resolve('src/server/provider/subscription-model-catalog.json');
const disabledFeatures = ['shell_tool','apps','plugins','remote_plugin','multi_agent','multi_agent_v2','goals','memories','hooks','browser_use','computer_use','view_image','image_generation','sleep_tool','code_mode','code_mode_only','code_mode_host','unbounded_connection_retries','daemon_auto_start','chronicle','workspace_dependencies','skill_search','skill_mcp_dependency_install'] as const;
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export function readNativeFeatureProfile(output:string) {
  const rows=output.split('\n').map(line=>line.trim().split(/\s+/));
  const state=(name:string)=>{const matches=rows.filter(row=>row[0]===name);if(matches.length!==1 || !['true','false'].includes(matches[0].at(-1)!))throw new Error('required_native_feature_unavailable');return matches[0].at(-1)==='true';};
  if(disabledFeatures.some(feature=>state(feature)))throw new Error('required_native_feature_unavailable');
  // Codex 0.160.1 normalizes this backend on. ShellTool independently gates shell exposure.
  return {disabledFeatures:[...disabledFeatures],shellToolFeature:false,unifiedExecBackend:state('unified_exec'),universalToolFreeQualification:'UNAVAILABLE' as const};
}
const planSchema = z.object({ version:z.literal(1), runId:z.uuidv4(), modelId:z.literal(SUBSCRIPTION_MODEL), authorization:z.object({ approvalId:z.uuidv4(), approvedAt:z.iso.datetime(), expiresAt:z.iso.datetime(), statement:z.string().min(1).max(2000), creatorOwnedNonpersonal:z.literal(true) }).strict(), cases:z.array(z.object({ caseId:z.uuidv4(), sceneId:z.enum(['TM01','TM09','TM04']), context:z.unknown(),maximumCalls:z.number().int().min(0).max(2).optional() }).strict()).min(3).max(9) }).strict();
export type SubscriptionPlan = z.infer<typeof planSchema>;
export function validateSubscriptionPlan(value:unknown, now=Date.now()):SubscriptionPlan {
  const plan=planSchema.parse(value);
  if (Date.parse(plan.authorization.approvedAt)>now || Date.parse(plan.authorization.expiresAt)<=now || new Set(plan.cases.map(entry=>entry.caseId)).size!==plan.cases.length) throw new Error('authorization_or_case_ids');
  const groups=new Map<string,GenerateContext[]>();
  for(const entry of plan.cases) {
    const context=entry.context as GenerateContext;
    if(!context || !['development_probe_informed_v1','development_probe_blind_v1'].includes(context.generationProfile) || context.repairErrors!==null || context.sceneMeaning?.meaningId!==entry.sceneId+'.meaning.1') throw new Error('diagnostic_context');
    compileRequest(context,SUBSCRIPTION_MODEL,12000);
    const frozen=getScene(entry.sceneId)!;
    if(canonicalJson(context.sceneMeaning)!==canonicalJson(directorMeaning(frozen.meaning)) || canonicalJson(context.roster)!==canonicalJson(frozen.roster) || scoreHash(context.previousScore)!==frozen.scoreHash)throw new Error('frozen_scene_bank_mismatch');
    groups.set(entry.sceneId,[...(groups.get(entry.sceneId)??[]),context]);
  }
  for(const contexts of groups.values()) {
    const identities=contexts.map(context=>hash(canonicalJson({meaning:context.sceneMeaning,roster:context.roster,score:context.previousScore})));
    const actual=contexts.filter(context=>context.guessData.kind==='actual');
    if(contexts.length!==3 || new Set(identities).size!==1 || contexts.filter(context=>context.guessData.kind==='withheld').length!==1 || actual.length!==2 || new Set(actual.map(context=>context.guessData.kind==='actual'?context.guessData.text:'')).size!==2) throw new Error('two_distinct_misunderstandings_and_one_withheld_required');
  }
  return plan;
}
export function subscriptionPrompt(context:GenerateContext):{contextJson:string;prompt:string} {
  const compiled=compileRequest(context,SUBSCRIPTION_MODEL,12000);
  const contextJson=(compiled.body.input as {content:{text:string}[]}[])[0].content[0].text;
  return {contextJson,prompt:DIRECTOR_TEMPLATE+'\n'+contextJson};
}
export type NativeTermination='completed'|'process_error'|'invalid_event'|'tool_use'|'extra_turn'|'refusal'|'deadline'|'cancelled'|'oversize';
export type NativeResult={termination:NativeTermination;stdout:Buffer;stderrHash:string|null;rawFinal:string|null;authStatus?:'chatgpt'|'other';reportedModelId?:string|null;usage:{inputTokens:number;outputTokens:number;cachedInputTokens:number|null}|null};
export type NativeInvocation={cli:string;args:string[];cwd:string;env:Record<string,string>;stdin:string;timeoutMs:number;signal:AbortSignal;finalPath?:string};
export type NativeRunner=(invocation:NativeInvocation)=>Promise<NativeResult>;
export function subscriptionEnvironment(env:Record<string,string|undefined>):Record<string,string> {
  const clean:Record<string,string>={};
  for(const key of ['PATH','HOME','TMPDIR','LANG','LC_ALL','TERM']) if(env[key]!==undefined) clean[key]=env[key]!;
  return clean;
}
// The event stream detects observed use. It cannot prove that no tools were advertised.
export class SubscriptionEventMonitor {
  termination:NativeTermination|null=null;
  usage:NativeResult['usage']=null;
  finalMessage:string|null=null;
  reportedModelId:string|null=null;
  private turns=0;
  private completed=false;
  consume(line:string) {
    if(this.termination)return;
    try {
      const event=parseJsonStrict(line,{maxBytes:524288,maxDepth:32}) as Record<string,unknown>;
      if(typeof event.model==='string')this.reportedModelId=event.model;
      if(event.model!==undefined && event.model!==SUBSCRIPTION_MODEL) {this.termination='invalid_event';return;}
      switch(event.type) {
        case 'thread.started':break;
        case 'turn.started':if(++this.turns>1)this.termination='extra_turn';break;
        case 'item.started':case 'item.updated':case 'item.completed': {
          const item=event.item as Record<string,unknown>|undefined;
          if(item?.type==='refusal'){this.termination='refusal';break;}
          if(!item || !['reasoning','agent_message'].includes(item.type as string)) {this.termination=item && ['command_execution','tool_call','mcp_tool_call','web_search','file_change'].includes(item.type as string)?'tool_use':'invalid_event';break;}
          if(item.type==='agent_message' && event.type==='item.completed') {
            if(typeof item.text!=='string' || Buffer.byteLength(item.text)>65536 || this.finalMessage!==null) {this.termination='invalid_event';break;}
            this.finalMessage=item.text;
          }
          break;
        }
        case 'turn.completed': {
          if(this.turns!==1 || this.completed){this.termination='extra_turn';break;}
          this.completed=true;
          const usage=event.usage as Record<string,unknown>|undefined;
          const count=(value:unknown):value is number=>Number.isSafeInteger(value)&&(value as number)>=0&&(value as number)<=10000000;
          if(usage && count(usage.input_tokens) && count(usage.output_tokens) && (usage.cached_input_tokens===undefined || (count(usage.cached_input_tokens)&&usage.cached_input_tokens<=usage.input_tokens))) this.usage={inputTokens:usage.input_tokens,outputTokens:usage.output_tokens,cachedInputTokens:count(usage.cached_input_tokens)?usage.cached_input_tokens:null};
          break;
        }
        case 'refusal':this.termination='refusal';break;
        case 'error':case 'turn.failed':this.termination='process_error';break;
        default:this.termination='invalid_event';
      }
    } catch {this.termination='invalid_event';}
  }
  finish():NativeTermination {return this.termination ?? (this.completed && this.finalMessage!==null?'completed':'invalid_event');}
}
export const runNativeProcess:NativeRunner=invocation=>new Promise(resolveResult=> {
  const monitor=invocation.finalPath?new SubscriptionEventMonitor():null;
  const output:Buffer[]=[];
  const stderr=createHash('sha256');
  const decoder=new TextDecoder('utf-8',{fatal:true});
  let authOutput='';
  let size=0,pending='',termination:NativeTermination|null=null,done=false;
  const child=spawn(invocation.cli,invocation.args,{cwd:invocation.cwd,env:invocation.env,stdio:['pipe','pipe','pipe'],detached:true});
  const terminate=(reason:NativeTermination)=> {
    if(termination)return;
    termination=reason;
    if(child.pid)try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}
  };
  const abort=()=>terminate('cancelled');
  const timer=setTimeout(()=>terminate('deadline'),invocation.timeoutMs);
  invocation.signal.addEventListener('abort',abort,{once:true});
  if(invocation.signal.aborted)abort();
  child.stdout.on('data',(chunk:Buffer)=> {
    const remaining=524288-size; output.push(chunk.subarray(0,Math.max(0,remaining)));size+=chunk.length;
    if(size>524288){terminate('oversize');return;}
    if(monitor) {
      try{pending+=decoder.decode(chunk,{stream:true});}catch{terminate('invalid_event');return;}
      let end:number;
      while((end=pending.indexOf('\n'))>=0) {const line=pending.slice(0,end);pending=pending.slice(end+1);if(line)monitor.consume(line);if(monitor.termination){terminate(monitor.termination);break;}}
    }
  });
  child.stderr.on('data',(chunk:Buffer)=>{stderr.update(chunk);if(invocation.args.join(' ')==='login status' && authOutput.length<16384)authOutput+=chunk.toString('utf8');});
  child.stdin.on('error',()=>terminate('process_error'));
  const finish=(code:number|null)=> {
    if(done)return;done=true;clearTimeout(timer);invocation.signal.removeEventListener('abort',abort);
    let rawFinal:string|null=null;
    if(monitor){try{pending+=decoder.decode();}catch{termination='invalid_event';}if(pending)monitor.consume(pending);}
    let reason=termination ?? (code===0?(monitor?.finish()??'completed'):'process_error');
    if(invocation.finalPath && existsSync(invocation.finalPath)) {
      try {if(lstatSync(invocation.finalPath).isSymbolicLink() || statSync(invocation.finalPath).size>65536)reason='oversize';else{chmodSync(invocation.finalPath,0o600);rawFinal=readFileSync(invocation.finalPath,'utf8');if(reason==='completed' && rawFinal!==monitor?.finalMessage)reason='invalid_event';}}catch{reason='process_error';}
    } else if(monitor && reason==='completed')reason='invalid_event';
    resolveResult({termination:reason,stdout:Buffer.concat(output),stderrHash:stderr.digest('hex'),rawFinal,usage:monitor?.usage??null,reportedModelId:monitor?.reportedModelId??null,...(invocation.args.join(' ')==='login status'?{authStatus:authOutput.split('\n').filter(line=>line.trim().startsWith('Logged in')).map(line=>line.trim()).join('\n')==='Logged in using ChatGPT'?'chatgpt' as const:'other' as const}:{})});
  };
  child.on('error',()=>{termination='process_error';finish(null);});
  child.on('close',finish);
  child.stdin.end(invocation.stdin);
});
function safeDirectory(path:string) {
  if(!isAbsolute(path))throw new Error('absolute_private_directory_required');
  let ancestor=path;
  while(true) {if(existsSync(ancestor)&&lstatSync(ancestor).isSymbolicLink())throw new Error('symlink_directory');if(dirname(ancestor)===ancestor)break;ancestor=dirname(ancestor);}
  mkdirSync(path,{recursive:true,mode:0o700});chmodSync(path,0o700);
}
function privateFile(path:string,value:string|Buffer) {writeFileSync(path,value,{flag:'wx',mode:0o600});}
const ownership='tiny-mime-subscription-diagnostic-v1';
function purgeOwnedRuns(directory:string,now:number) {
  for(const name of readdirSync(directory)) {
    if(!/^[0-9a-f-]{36}$/.test(name))continue;
    const path=join(directory,name),manifestPath=join(path,'manifest.json');
    if(lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory() || !existsSync(manifestPath) || lstatSync(manifestPath).isSymbolicLink())continue;
    const manifest=parseJsonStrict(readFileSync(manifestPath,'utf8'),{maxBytes:1048576,maxDepth:32}) as Record<string,unknown>;
    if(manifest.owner!==ownership || manifest.runId!==name || manifest.retentionDays!==7)continue;
    const created=Date.parse(manifest.createdAt as string);
    if(!Number.isFinite(created))throw new Error('retention_timestamp');
    if(now-created>=7*86400000)rmSync(path,{recursive:true});
  }
}
export type SubscriptionReceipt={status:'COMPLETE'|'PARTIAL'|'FAILED';source:'subscription_diagnostic'|'mock_fixture';plannedCases:number;attemptedCases:number;successfulCases:number;calls:number;stopReason:string|null;ledgerPath:string|null};
export function subscriptionTerminalSummary(receipt:SubscriptionReceipt) {const {ledgerPath,...summary}=receipt;return {event:'subscription_diagnostic_finished',...summary,usdCost:'unknown',research:'NOT RUN',humanFidelity:'NOT RUN',comparativeEffect:'NOT RUN',apiInteractiveQualification:'NOT RUN',universalToolFreeQualification:'UNAVAILABLE'};}
function nativeConfigurationArgs():string[] {
  // Built-in provider IDs cannot be overridden. This isolated profile retains native ChatGPT routing.
  const provider='model_providers.tiny-mime-subscription.';
  const config=['model_catalog_json='+JSON.stringify(nativeCatalogPath()),'model_provider="tiny-mime-subscription"',provider+'name="OpenAI"',provider+'wire_api="responses"',provider+'requires_openai_auth=true',provider+'supports_websockets=true',provider+'supports_standalone_web_search=true',provider+'http_headers={version="'+SUBSCRIPTION_CLI_VERSION+'"}',provider+'request_max_retries=0',provider+'stream_max_retries=0',provider+'stream_idle_timeout_ms=45000','web_search="disabled"','project_doc_max_bytes=0','history.persistence="none"','model_reasoning_effort="low"'];
  return [...disabledFeatures.flatMap(feature=>['--disable',feature]),...config.flatMap(value=>['-c',value])];
}
export function nativeInferenceArgs(schemaPath:string,finalPath:string):string[] {
  return ['exec','--ignore-user-config','--ignore-rules','--strict-config','--ephemeral','--sandbox','read-only','--skip-git-repo-check','--model',SUBSCRIPTION_MODEL,'--json','--color','never','--output-schema',schemaPath,'--output-last-message',finalPath,...nativeConfigurationArgs(),'-'];
}
export async function runSubscriptionDiagnostic(args:string[],env:Record<string,string|undefined>=process.env,testRunner?:NativeRunner,signal:AbortSignal=new AbortController().signal):Promise<SubscriptionReceipt> {
  if(testRunner && process.env.NODE_ENV!=='test')throw new Error('test_only_process_injection');
  if(args.length!==7 || args[0]!=='--cases' || args[2]!=='--data-dir' || args[4]!=='--cli' || args[6]!=='--accept-native-agent-boundary')throw new Error('native_agent_boundary_exception_required');
  const [casesPath,dataDir,cli]=[args[1],args[3],args[5]];
  if(!isAbsolute(casesPath) || !casesPath.endsWith('.json') || statSync(casesPath).size>1048576 || !isAbsolute(cli) || !isAbsolute(dataDir))throw new Error('nonsecret_absolute_paths_required');
  const plan=validateSubscriptionPlan(parseJsonStrict(readFileSync(casesPath,'utf8'),{maxBytes:1048576,maxDepth:32}));
  const runner=testRunner??runNativeProcess,cleanEnv=subscriptionEnvironment(env);
  const schemaPath=resolve('src/server/provider/provider-motion-score-v1.schema.json');
  if(hash(readFileSync(schemaPath))!==providerVersions.schemaHash)throw new Error('frozen_schema_mismatch');
  if(hash(readFileSync(nativeCatalogPath()))!==nativeCatalogHash)throw new Error('pinned_native_catalog_mismatch');
  const scratchRoot=resolve('.scratch/subscription-diagnostic');safeDirectory(scratchRoot);
  const preflight=mkdtempSync(join(scratchRoot,'preflight-'));chmodSync(preflight,0o700);
  let nativeControls:ReturnType<typeof readNativeFeatureProfile>|null=null;
  try {
    const read=async(command:string[])=> {
      const result=await runner({cli,args:command,cwd:preflight,env:cleanEnv,stdin:'',timeoutMs:10000,signal});
      if(result.termination!=='completed')throw new Error('native_preflight_failed');
      return result.authStatus==='chatgpt'?'Logged in using ChatGPT':result.stdout.toString('utf8');
    };
    if((await read(['--version'])).trim()!=='codex-cli '+SUBSCRIPTION_CLI_VERSION)throw new Error('pinned_cli_version_required');
    if((await read(['login','status'])).trim()!=='Logged in using ChatGPT')throw new Error('chatgpt_subscription_auth_required');
    const features=await read([...nativeConfigurationArgs(),'features','list']);
    nativeControls=readNativeFeatureProfile(features);
    const help=await read(['exec','--help']);
    if(['--ignore-user-config','--strict-config','--ephemeral','--output-schema','--output-last-message','--ignore-rules'].some(flag=>!help.includes(flag)))throw new Error('required_native_control_unavailable');
  } finally {rmSync(preflight,{recursive:true});}
  safeDirectory(dataDir);
  const lockPath=join(dataDir,'.subscription-diagnostic.lock');
  const lock=openSync(lockPath,'wx',0o600);
  let calls=0,attemptedCases=0,successfulCases=0,stopReason:string|null=null,ledgerPath:string|null=null;
  const source=testRunner?'mock_fixture' as const:'subscription_diagnostic' as const;
  try {
    const privateRoot=join(dataDir,'subscription-diagnostic-private');safeDirectory(privateRoot);purgeOwnedRuns(privateRoot,Date.now());
    const runDir=join(privateRoot,plan.runId);mkdirSync(runDir,{mode:0o700});
    ledgerPath=join(runDir,'attempts.jsonl');privateFile(ledgerPath,'');
    privateFile(join(runDir,'manifest.json'),JSON.stringify({owner:ownership,runId:plan.runId,createdAt:new Date().toISOString(),retentionDays:7,source,plan,modelId:SUBSCRIPTION_MODEL,cliVersion:SUBSCRIPTION_CLI_VERSION,versions:providerVersions,nativeControls,nativeCatalog:{sha256:nativeCatalogHash,toolMode:'direct',originalToolMode:'code_mode_only',otherModelMetadataUnchanged:true},limits:{caseMs:90000,callMs:45000,maximumCases:9,maximumCalls:18,plannedMaximumCalls:plan.cases.reduce((sum,entry)=>sum+(entry.maximumCalls??2),0),maximumCallsPerCase:2,concurrency:1},usdCost:'unknown',research:'NOT RUN',humanFidelity:'NOT RUN',comparativeEffect:'NOT RUN',apiInteractiveQualification:'NOT RUN',universalToolFreeQualification:'UNAVAILABLE',fullNativeRequestHash:'UNAVAILABLE',subscriptionCreditUsage:null,nativeAgentBoundaryAccepted:true}));
    for(const entry of plan.cases) {
      const original=entry.context as GenerateContext;
      let context=original;const caseStart=performance.now();
      for(let attempt=1;attempt<=(entry.maximumCalls??2);attempt++) {
        if(signal.aborted){stopReason='cancelled';break;}
        if(Date.now()>=Date.parse(plan.authorization.expiresAt)){stopReason='authorization_expired';break;}
        const remaining=90000-(performance.now()-caseStart);if(remaining<=0){stopReason='deadline';break;}
        const {contextJson,prompt}=subscriptionPrompt(context);
        const prefix=entry.caseId+'.'+attempt;
        privateFile(join(runDir,prefix+'.context.json'),contextJson);privateFile(join(runDir,prefix+'.prompt.txt'),prompt);
        const scratch=mkdtempSync(join(scratchRoot,'call-'));chmodSync(scratch,0o700);
        const finalPath=join(scratch,'final.json'),start=performance.now(),startedAt=new Date().toISOString();
        if(Date.now()>=Date.parse(plan.authorization.expiresAt)){rmSync(scratch,{recursive:true});stopReason='authorization_expired';break;}
        privateFile(join(runDir,prefix+'.dispatch.json'),JSON.stringify({caseId:entry.caseId,attempt,startedAt,contextHash:hash(contextJson),promptHash:hash(prompt),schemaHash:providerVersions.schemaHash,requestedModelId:SUBSCRIPTION_MODEL,termination:'dispatched',usage:null,usdCost:'unknown'}));calls++;if(attempt===1)attemptedCases++;
        let result:NativeResult;
        try {result=await runner({cli,args:nativeInferenceArgs(schemaPath,finalPath),cwd:scratch,env:cleanEnv,stdin:prompt,timeoutMs:Math.min(45000,remaining),signal,finalPath});}
        catch {result={termination:signal.aborted?'cancelled':'process_error',stdout:Buffer.alloc(0),stderrHash:null,rawFinal:null,usage:null};}
        finally {rmSync(scratch,{recursive:true});}
        const elapsedMs=Math.round(performance.now()-start);
        if(signal.aborted)result.termination='cancelled';
        else if(elapsedMs>=45000 || performance.now()-caseStart>=90000)result.termination='deadline';
        if(result.stdout.length>524288 || (result.rawFinal!==null && Buffer.byteLength(result.rawFinal)>65536))result.termination='oversize';
        privateFile(join(runDir,prefix+'.stdout.jsonl'),result.stdout.subarray(0,524288));
        if(result.rawFinal!==null)privateFile(join(runDir,prefix+'.raw.json'),Buffer.from(result.rawFinal).subarray(0,65536));
        const validated=result.termination==='completed' && result.rawFinal!==null?validateScore(result.rawFinal,original.roster):null;
        const parseFailed=validated && !validated.ok && validated.errors.some(error=>['PARSE','DEPTH','DUPLICATE_KEY','BYTES'].includes(error.code));
        const termination=parseFailed?'unstructured_output':validated?(validated.ok?'validated':'invalid_output'):result.termination;
        const validationErrors=validated && !validated.ok?validated.errors.slice(0,20).map(error=>({code:error.code,path:error.path.slice(0,200)||'/'})):[];
        const validHash=validated?.ok?validated.scoreHash:null;
        appendFileSync(ledgerPath,JSON.stringify({version:1,caseId:entry.caseId,sceneId:entry.sceneId,attempt,source,requestedModelId:SUBSCRIPTION_MODEL,reportedModelId:result.reportedModelId??null,cliVersion:SUBSCRIPTION_CLI_VERSION,startedAt,elapsedMs,termination,sanitizedError:termination==='validated'?null:termination,contextHash:hash(contextJson),submittedPromptHash:hash(prompt),fullNativeRequestHash:'UNAVAILABLE',subscriptionCreditUsage:null,schemaHash:providerVersions.schemaHash,rawOutputHash:result.rawFinal===null?null:hash(result.rawFinal),rawOutputTruncated:result.rawFinal!==null&&Buffer.byteLength(result.rawFinal)>65536,stdoutTruncated:result.stdout.length>524288,stdoutHash:hash(result.stdout.subarray(0,524288)),stderrHash:result.stderrHash,usage:result.usage,usdCost:'unknown',validationErrors,scoreHash:validHash,noChange:validHash===null?null:validHash===scoreHash(original.previousScore)})+'\n',{mode:0o600});
        if(validated?.ok) {privateFile(join(runDir,entry.caseId+'.score.json'),canonicalJson(validated.score));successfulCases++;break;}
        if(termination!=='invalid_output'){stopReason=termination;break;}
        if(attempt===1)context={...original,repairErrors:validationErrors};
      }
      if(stopReason)break;
    }
    if(!stopReason && successfulCases<plan.cases.length)stopReason=successfulCases<plan.cases.filter(entry=>entry.maximumCalls!==0).length?'validation_failed':'case_budget_exhausted';
    return {status:stopReason?'PARTIAL':'COMPLETE',plannedCases:plan.cases.length,attemptedCases,successfulCases,calls,stopReason,source,ledgerPath};
  } finally {closeSync(lock);rmSync(lockPath);}
}
