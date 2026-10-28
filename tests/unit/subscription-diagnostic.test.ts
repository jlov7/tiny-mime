import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runSubscriptionDiagnostic, subscriptionTerminalSummary } from '../../scripts/subscription-diagnostic.js';
import { nativeInferenceArgs, readNativeFeatureProfile, runNativeProcess, SUBSCRIPTION_MODEL, SubscriptionEventMonitor, subscriptionEnvironment, subscriptionPrompt, validateSubscriptionPlan, type NativeInvocation, type NativeResult, type NativeRunner } from '../../src/server/provider/subscriptionDiagnostic.js';
import { compileRequest, type GenerateContext } from '../../src/server/provider.js';
import { getScene, directorMeaning } from '../../src/server/operator/sceneBank.js';
import { DIRECTOR_TEMPLATE } from '../../src/server/provider/template.js';
let directory:string;
beforeEach(()=>{mkdirSync(resolve('.scratch'),{recursive:true});directory=mkdtempSync(resolve('.scratch/subscription-test-'));vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('Network forbidden');}));});
afterEach(()=>{vi.unstubAllGlobals();rmSync(directory,{recursive:true});});
function fixture(sceneId='TM01') {
  const scene=getScene(sceneId)!;
  const context:GenerateContext={sceneMeaning:directorMeaning(scene.meaning),roster:scene.roster,previousScore:scene.score,attempt:2,generationProfile:'development_probe_blind_v1',firstGuessOccurred:true,repairErrors:null,guessData:{kind:'withheld'}};
  const plan={version:1,runId:randomUUID(),modelId:SUBSCRIPTION_MODEL,authorization:{approvalId:randomUUID(),approvedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),statement:'Owner approves synthetic subscription diagnostic',creatorOwnedNonpersonal:true},cases:[{caseId:randomUUID(),sceneId,context:{...context,generationProfile:'development_probe_informed_v1',guessData:{kind:'actual',text:'They are dancing'}}},{caseId:randomUUID(),sceneId,context:{...context,generationProfile:'development_probe_informed_v1',guessData:{kind:'actual',text:'One is deliberately blocking the other'}}},{caseId:randomUUID(),sceneId,context}]};
  const casesPath=join(directory,'cases.json'),dataDir=join(directory,'private');writeFileSync(casesPath,JSON.stringify(plan));
  return {plan,context,casesPath,dataDir,args:['--cases',casesPath,'--data-dir',dataDir,'--cli','/mock/codex','--accept-native-agent-boundary']};
}
const features=['shell_tool','unified_exec','apps','plugins','remote_plugin','multi_agent','multi_agent_v2','goals','memories','hooks','browser_use','computer_use','view_image','image_generation','sleep_tool','code_mode','code_mode_only','code_mode_host','unbounded_connection_retries','daemon_auto_start','chronicle','workspace_dependencies','skill_search','skill_mcp_dependency_install'];
function native(rawFinal:string|null,termination:NativeResult['termination']='completed'):NativeResult {return {rawFinal,termination,stdout:Buffer.from('{"mock":"synthetic"}\n'),stderrHash:'a'.repeat(64),usage:null};}
function mockRunner(answers:NativeResult[],override?:{version?:string;auth?:string;features?:string}):NativeRunner {
  return vi.fn(async(invocation:NativeInvocation)=> {
    if(invocation.args[0]==='--version')return {...native(null),stdout:Buffer.from(override?.version??'codex-cli 0.160.1\n')};
    if(invocation.args[0]==='login')return {...native(null),stdout:Buffer.from(override?.auth??'Logged in using ChatGPT\n')};
    if(invocation.args.includes('features')){expect(invocation.args).not.toContain('--ignore-user-config');expect(invocation.args).toContain('--disable');return {...native(null),stdout:Buffer.from(override?.features??features.map(feature=>feature+' stable '+(feature==='unified_exec'?'true':'false')).join('\n'))};}
    if(invocation.args.includes('--help'))return {...native(null),stdout:Buffer.from('--ignore-user-config --strict-config --ephemeral --output-schema --output-last-message --ignore-rules')};
    expect(readdirSync(invocation.cwd)).toEqual([]);
    return answers.shift()??native(null,'process_error');
  });
}
function attempts(ledgerPath:string|null) {return readFileSync(ledgerPath!,'utf8').trim().split('\n').map(line=>JSON.parse(line));}
function inferCalls(runner:NativeRunner) {return vi.mocked(runner).mock.calls.filter(([call])=>call.finalPath!==undefined);}
test('frozen prompt uses exact compiler allowlist and withheld context excludes actual text',()=> {
  const f=fixture(),prompt=subscriptionPrompt(f.context),compiled=compileRequest(f.context,SUBSCRIPTION_MODEL,12000);
  expect(prompt.contextJson).toBe((compiled.body.input as any)[0].content[0].text);
  expect(prompt.prompt).toBe(DIRECTOR_TEMPLATE+'\n'+prompt.contextJson);
  expect(Object.keys(JSON.parse(prompt.contextJson))).toEqual(['sceneMeaning','roster','attempt','previousScore','generationProfile','firstGuessOccurred','guessData','repairErrors']);
  expect(prompt.contextJson).not.toContain('They are dancing');expect(prompt.contextJson).not.toContain('blocking the other');
  expect(()=>subscriptionPrompt({...f.context,guessData:{kind:'withheld',text:'leak'}} as GenerateContext)).toThrow();
});
test('closed bounded plan requires consistent frozen scene, two distinct actual cases and one withheld',()=> {
  const f=fixture();expect(validateSubscriptionPlan(f.plan).cases).toHaveLength(3);
  for(const change of [(plan:any)=>plan.extra=true,(plan:any)=>plan.cases[0].sceneId='TM07',(plan:any)=>plan.cases[1].context.guessData=plan.cases[0].context.guessData,(plan:any)=>plan.cases.pop(),(plan:any)=>plan.cases[0].context.repairErrors=[],(plan:any)=>plan.cases[0].context.previousScore.durationMs=10000,(plan:any)=>plan.cases=[...plan.cases,...plan.cases,...plan.cases,...plan.cases]]) {const plan=structuredClone(f.plan);change(plan);expect(()=>validateSubscriptionPlan(plan)).toThrow();}
});
test('scene identity rejects structurally valid meaning or score substitution',()=>{
  const f=fixture();for(const modify of [(context:any)=>context.sceneMeaning.target='Substituted target',(context:any)=>context.previousScore.actors[0].keyframes.forEach((key:any)=>key.rotationDeg+=1)]){const plan=structuredClone(f.plan);for(const entry of plan.cases)modify(entry.context);expect(()=>validateSubscriptionPlan(plan)).toThrow('frozen_scene_bank_mismatch');}
});
test('nine-case maximum supports the three exact scene triplets',()=> {
  const a=fixture('TM01'),b=fixture('TM09'),c=fixture('TM04');a.plan.cases=[...a.plan.cases,...b.plan.cases,...c.plan.cases];expect(validateSubscriptionPlan(a.plan).cases).toHaveLength(9);
});
test('missing native boundary exception and wrong model never invoke any process',async()=> {
  const f=fixture(),runner=mockRunner([]);
  await expect(runSubscriptionDiagnostic(f.args.slice(0,-1),{},runner)).rejects.toThrow('boundary');
  f.plan.modelId='other';writeFileSync(f.casesPath,JSON.stringify(f.plan));await expect(runSubscriptionDiagnostic(f.args,{},runner)).rejects.toThrow();
  expect(runner).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
});
test.each([{version:'codex-cli 0.159.0'},{auth:'Logged in using an API key'},{features:'shell_tool stable true'},{features:features.map(feature=>feature+' stable true').join('\n')}])('wrong native preflight causes zero inference and releases scratch %j',async override=> {
  const f=fixture(),runner=mockRunner([],override);
  await expect(runSubscriptionDiagnostic(f.args,{},runner)).rejects.toThrow();expect(inferCalls(runner)).toHaveLength(0);
  for(const [call] of vi.mocked(runner).mock.calls)expect(existsSync(call.cwd)).toBe(false);
  expect(existsSync(f.dataDir)).toBe(false);expect(fetch).not.toHaveBeenCalled();
});
test('valid distinct and unchanged candidates export canonical import scores with private custody and unknown cost',async()=> {
  const f=fixture(),changed=structuredClone(f.context.previousScore);for(const key of changed.actors[0].keyframes)key.rotationDeg+=1;
  const runner=mockRunner([native(JSON.stringify(changed)),native(JSON.stringify(f.context.previousScore)),native(JSON.stringify(f.context.previousScore))]);
  const receipt=await runSubscriptionDiagnostic(f.args,{HOME:'/mock/home',PATH:'/mock/bin',OPENAI_API_KEY:'secret-key',CODEX_HOME:'/private/config',TM_MODEL_ID:'other'},runner);
  expect(receipt).toMatchObject({status:'COMPLETE',plannedCases:3,attemptedCases:3,successfulCases:3,calls:3,source:'mock_fixture'});
  const rows=attempts(receipt.ledgerPath);expect(rows.map(row=>row.noChange)).toEqual([false,true,true]);
  expect(rows.every(row=>row.usage===null&&row.usdCost==='unknown'&&row.reportedModelId===null&&row.requestedModelId===SUBSCRIPTION_MODEL)).toBe(true);
  const runDir=receipt.ledgerPath!.replace('/attempts.jsonl','');expect(statSync(runDir).mode&0o777).toBe(0o700);
  for(const filename of readdirSync(runDir))expect(statSync(join(runDir,filename)).mode&0o777).toBe(0o600);
  const manifest=JSON.parse(readFileSync(join(runDir,'manifest.json'),'utf8'));expect(manifest).toMatchObject({source:'mock_fixture',retentionDays:7,universalToolFreeQualification:'UNAVAILABLE',research:'NOT RUN',humanFidelity:'NOT RUN',comparativeEffect:'NOT RUN',apiInteractiveQualification:'NOT RUN'});
  for(const [call] of inferCalls(runner)) {
    expect(call.env).toEqual({HOME:'/mock/home',PATH:'/mock/bin'});expect(call.args).toContain('--output-schema');expect(call.args).not.toContain(call.stdin);expect(call.stdin.startsWith(DIRECTOR_TEMPLATE)).toBe(true);expect(existsSync(call.cwd)).toBe(false);expect(call.timeoutMs).toBeLessThanOrEqual(45000);
  }
  expect(existsSync(join(f.dataDir,'.subscription-diagnostic.lock'))).toBe(false);
  const summary=JSON.stringify(subscriptionTerminalSummary(receipt));for(const privateValue of [f.dataDir,'They are dancing','previousScore','secret-key','stderrHash'])expect(summary).not.toContain(privateValue);expect(fetch).not.toHaveBeenCalled();
});
test('one structural validation repair retains both raw attempts and original context',async()=> {
  const f=fixture(),runner=mockRunner([native('{}'),native(JSON.stringify(f.context.previousScore)),native(JSON.stringify(f.context.previousScore)),native(JSON.stringify(f.context.previousScore))]);
  const receipt=await runSubscriptionDiagnostic(f.args,{},runner);expect(receipt.calls).toBe(4);const rows=attempts(receipt.ledgerPath);expect(rows.map(row=>row.termination)).toEqual(['invalid_output','validated','validated','validated']);
  const repair=JSON.parse(inferCalls(runner)[1][0].stdin.slice(DIRECTOR_TEMPLATE.length+1));expect(repair.repairErrors.length).toBeGreaterThan(0);expect(repair.guessData).toEqual(f.plan.cases[0].context.guessData);
  const runDir=receipt.ledgerPath!.replace('/attempts.jsonl','');expect(readFileSync(join(runDir,f.plan.cases[0].caseId+'.1.raw.json'),'utf8')).toBe('{}');
});
test('two invalid candidates use no further repair and continue bounded cases',async()=> {
  const f=fixture(),runner=mockRunner(Array.from({length:6},()=>native('{}'))),receipt=await runSubscriptionDiagnostic(f.args,{},runner);
  expect(receipt).toMatchObject({status:'PARTIAL',successfulCases:0,calls:6,stopReason:'validation_failed'});expect(attempts(receipt.ledgerPath).map(row=>row.attempt)).toEqual([1,2,1,2,1,2]);
});
test.each(['tool_use','extra_turn','invalid_event','deadline','cancelled','refusal','process_error'] as const)('terminal native %s preserves failed attempt and stops without retry',async termination=> {
  const f=fixture(),runner=mockRunner([native('secret-error-payload',termination)]),receipt=await runSubscriptionDiagnostic(f.args,{},runner);
  expect(receipt).toMatchObject({status:'PARTIAL',calls:1,attemptedCases:1,successfulCases:0,stopReason:termination});expect(attempts(receipt.ledgerPath)[0]).toMatchObject({termination,usage:null,usdCost:'unknown'});expect(JSON.stringify(subscriptionTerminalSummary(receipt))).not.toContain('secret-error-payload');
  expect(inferCalls(runner)).toHaveLength(1);expect(existsSync(join(f.dataDir,'.subscription-diagnostic.lock'))).toBe(false);expect(fetch).not.toHaveBeenCalled();
});
test.each(['Refused request','{"version":1,"version":1}'])('unstructured or duplicate-key candidate is terminal without repair',async raw=> {
  const f=fixture(),runner=mockRunner([native(raw)]),receipt=await runSubscriptionDiagnostic(f.args,{},runner);expect(receipt).toMatchObject({calls:1,stopReason:'unstructured_output'});
});
test('oversize raw output is bounded in custody and cannot repair',async()=> {
  const f=fixture(),runner=mockRunner([native('x'.repeat(65537))]),receipt=await runSubscriptionDiagnostic(f.args,{},runner);expect(receipt).toMatchObject({calls:1,stopReason:'oversize'});
  const row=attempts(receipt.ledgerPath)[0];expect(row.rawOutputTruncated).toBe(true);expect(statSync(receipt.ledgerPath!.replace('attempts.jsonl',f.plan.cases[0].caseId+'.1.raw.json')).size).toBe(65536);
});
test('whitelisted environment never forwards credentials or account configuration',()=> {
  expect(subscriptionEnvironment({PATH:'p',HOME:'h',TMPDIR:'t',LANG:'l',LC_ALL:'c',TERM:'term',OPENAI_API_KEY:'secret',CODEX_HOME:'config',AUTH_TOKEN:'token'})).toEqual({PATH:'p',HOME:'h',TMPDIR:'t',LANG:'l',LC_ALL:'c',TERM:'term'});
  const args=nativeInferenceArgs('/schema','/final');expect(args).toContain('model_providers.tiny-mime-subscription.request_max_retries=0');expect(args).toContain('model_providers.tiny-mime-subscription.stream_max_retries=0');expect(args).toContain('model_providers.tiny-mime-subscription.stream_idle_timeout_ms=45000');expect(args).toContain('web_search="disabled"');
});
test('native configuration avoids reserved providers and is checked before inference',async()=> {
  const args=nativeInferenceArgs('/schema','/final');
  expect(args.some(value=>value.startsWith('model_providers.openai.'))).toBe(false);
  expect(args).toContain('model_provider="tiny-mime-subscription"');
  expect(args).toContain('model_providers.tiny-mime-subscription.requires_openai_auth=true');
  expect(args).toContain('model_providers.tiny-mime-subscription.name="OpenAI"');
  expect(args.some(value=>/base_url|env_key|bearer_token/.test(value))).toBe(false);
  const f=fixture(),runner=mockRunner(Array.from({length:3},()=>native(JSON.stringify(f.context.previousScore))));
  await runSubscriptionDiagnostic(f.args,{},runner);
  const preflight=vi.mocked(runner).mock.calls.find(([call])=>call.args.includes('features'))![0];
  const settings=(values:string[])=>values.filter((_,index)=>values[index-1]==='-c');
  expect(settings(preflight.args)).toEqual(settings(args));
});
test('a reduced case budget keeps a prior local failure counted and never adds a repair',async()=> {
  const f=fixture();(f.plan.cases[0] as any).maximumCalls=1;writeFileSync(f.casesPath,JSON.stringify(f.plan));
  const runner=mockRunner([native('{}'),native(JSON.stringify(f.context.previousScore)),native(JSON.stringify(f.context.previousScore))]);
  const receipt=await runSubscriptionDiagnostic(f.args,{},runner);
  expect(receipt).toMatchObject({status:'PARTIAL',successfulCases:2,calls:3,stopReason:'validation_failed'});
  expect(attempts(receipt.ledgerPath).map(row=>row.attempt)).toEqual([1,1,1]);
  for(const maximumCalls of [-1,3,1.5]){const plan=structuredClone(f.plan);(plan.cases[0] as any).maximumCalls=maximumCalls;expect(()=>validateSubscriptionPlan(plan)).toThrow();}
});
test('an exhausted case dispatches nothing while remaining original cases stay bounded',async()=> {
  const f=fixture();(f.plan.cases[0] as any).maximumCalls=0;writeFileSync(f.casesPath,JSON.stringify(f.plan));
  const runner=mockRunner(Array.from({length:2},()=>native(JSON.stringify(f.context.previousScore))));
  const receipt=await runSubscriptionDiagnostic(f.args,{},runner);
  expect(receipt).toMatchObject({status:'PARTIAL',attemptedCases:2,successfulCases:2,calls:2,stopReason:'case_budget_exhausted'});
  expect(attempts(receipt.ledgerPath).map(row=>row.caseId)).toEqual(f.plan.cases.slice(1).map(entry=>entry.caseId));
});
test('pinned catalog uses defined direct mode and disables code-mode flags without ignoring events',()=> {
  const catalog=JSON.parse(readFileSync(resolve('src/server/provider/subscription-model-catalog.json'),'utf8'));
  expect(catalog.models).toHaveLength(1);expect(catalog.models[0]).toMatchObject({slug:SUBSCRIPTION_MODEL,tool_mode:'direct'});
  expect(createHash('sha256').update(JSON.stringify({...catalog.models[0],tool_mode:'code_mode_only'})).digest('hex')).toBe('dd89fc4cb22dbb28d987add10002247bfe5abc64f0af0de6b4bf2f1869c807b7');
  const args=nativeInferenceArgs('/schema','/final');expect(args).toContain('model_catalog_json='+JSON.stringify(resolve('src/server/provider/subscription-model-catalog.json')));
  for(const feature of ['code_mode','code_mode_only','code_mode_host'])expect(args[args.indexOf(feature)-1]).toBe('--disable');
  const monitor=new SubscriptionEventMonitor();monitor.consume(JSON.stringify({type:'item.completed',item:{type:'error',message:'Code Mode unavailable'}}));expect(monitor.finish()).toBe('invalid_event');
});
test('an exhausted case does not hide validation failures in an attempted case',async()=> {
  const f=fixture();(f.plan.cases[0] as any).maximumCalls=0;writeFileSync(f.casesPath,JSON.stringify(f.plan));
  const runner=mockRunner([native('{}'),native('{}'),native(JSON.stringify(f.context.previousScore))]);
  expect(await runSubscriptionDiagnostic(f.args,{},runner)).toMatchObject({status:'PARTIAL',attemptedCases:2,successfulCases:1,calls:3,stopReason:'validation_failed'});
});
test.each([{type:'item.started',item:{type:'command_execution'}},{type:'item.completed',item:{type:'mcp_tool_call'}},{type:'item.completed',item:{type:'unknown'}},{type:'unrecognized'},{type:'refusal'}])('event monitor rejects observed prohibited or unknown events %j',event=> {
  const monitor=new SubscriptionEventMonitor();monitor.consume(JSON.stringify(event));expect(monitor.finish()).not.toBe('completed');
});
test('event monitor requires one turn and tracks observed usage and reported model',()=> {
  const monitor=new SubscriptionEventMonitor();for(const event of [{type:'thread.started',model:SUBSCRIPTION_MODEL},{type:'turn.started'},{type:'item.completed',item:{type:'reasoning',text:'private'}},{type:'item.completed',item:{type:'agent_message',text:'{}'}},{type:'turn.completed',usage:{input_tokens:100,output_tokens:20,cached_input_tokens:10}}])monitor.consume(JSON.stringify(event));
  expect(monitor.finish()).toBe('completed');expect(monitor.usage).toEqual({inputTokens:100,outputTokens:20,cachedInputTokens:10});expect(monitor.reportedModelId).toBe(SUBSCRIPTION_MODEL);monitor.consume('{"type":"turn.started"}');expect(monitor.finish()).toBe('extra_turn');
  const unknown=new SubscriptionEventMonitor();for(const event of [{type:'turn.started'},{type:'item.completed',item:{type:'agent_message',text:'{}'}},{type:'turn.completed',usage:{input_tokens:'bad',output_tokens:10}}])unknown.consume(JSON.stringify(event));expect(unknown.usage).toBeNull();
});
test('mock child emits tool event and is killed immediately, stderr remains hash only',async()=> {
  const finalPath=join(directory,'final.json');const result=await runNativeProcess({cli:process.execPath,args:['-e','process.stderr.write("secret-error-payload");process.stdout.write(JSON.stringify({type:"item.started",item:{type:"command_execution"}})+"\\n");setInterval(()=>{},1000)'],cwd:directory,env:subscriptionEnvironment(process.env),stdin:'',timeoutMs:5000,signal:new AbortController().signal,finalPath});
  expect(result.termination).toBe('tool_use');expect(JSON.stringify(result)).not.toContain('secret-error-payload');expect(result.stderrHash).toHaveLength(64);
});
test('mock child deadlines and cancellation terminate the process group without retries',async()=> {
  const controller=new AbortController();const invoke=(signal:AbortSignal,timeoutMs:number)=>runNativeProcess({cli:process.execPath,args:['-e','setInterval(()=>{},1000)'],cwd:directory,env:subscriptionEnvironment(process.env),stdin:'',timeoutMs,signal,finalPath:join(directory,'final.json')});
  expect((await invoke(controller.signal,20)).termination).toBe('deadline');const pending=invoke(controller.signal,1000);controller.abort();expect((await pending).termination).toBe('cancelled');
});
test('ownership-safe seven-day retention deletes only declared diagnostic runs',async()=> {
  const f=fixture(),root=join(f.dataDir,'subscription-diagnostic-private'),oldId=randomUUID(),unknownId=randomUUID();
  for(const id of [oldId,unknownId]){mkdirSync(join(root,id),{recursive:true});writeFileSync(join(root,id,'manifest.json'),JSON.stringify({owner:id===oldId?'tiny-mime-subscription-diagnostic-v1':'other',runId:id,retentionDays:7,createdAt:new Date(Date.now()-8*86400000).toISOString()}));writeFileSync(join(root,id,'private.json'),'synthetic');}
  const runner=mockRunner(Array.from({length:3},()=>native(JSON.stringify(f.context.previousScore))));await runSubscriptionDiagnostic(f.args,{},runner);expect(existsSync(join(root,oldId))).toBe(false);expect(existsSync(join(root,unknownId))).toBe(true);
});
test('process injection is unavailable outside tests',async()=> {
  const old=process.env.NODE_ENV;process.env.NODE_ENV='production';try{await expect(runSubscriptionDiagnostic([],{},mockRunner([]))).rejects.toThrow('test_only');}finally{process.env.NODE_ENV=old;}
});

test('native backend normalization permits a restricted diagnostic without claiming tool absence',async()=> {
  const f=fixture(),runner=mockRunner(Array.from({length:3},()=>native(JSON.stringify(f.context.previousScore))));
  const receipt=await runSubscriptionDiagnostic(f.args,{},runner);expect(receipt.status).toBe('COMPLETE');
  const manifest=JSON.parse(readFileSync(receipt.ledgerPath!.replace('attempts.jsonl','manifest.json'),'utf8'));
  expect(manifest.nativeControls).toMatchObject({shellToolFeature:false,unifiedExecBackend:true,universalToolFreeQualification:'UNAVAILABLE'});
});

test.each([true,false])('backend state %s is recorded separately from disabled shell exposure',enabled=> {
  const output=features.map(feature=>feature+' stable '+(feature==='unified_exec'?String(enabled):'false')).join('\n');
  expect(readNativeFeatureProfile(output)).toMatchObject({shellToolFeature:false,unifiedExecBackend:enabled,universalToolFreeQualification:'UNAVAILABLE'});
});

test.each(['missing','duplicate','nonboolean'])('invalid backend listing %s prevents inference',async kind=> {
  const f=fixture(),valid=features.filter(feature=>feature!=='unified_exec').map(feature=>feature+' stable false').join('\n');
  const listing=valid+(kind==='missing'?'':kind==='duplicate'?'\nunified_exec stable true\nunified_exec stable false':'\nunified_exec stable unknown');
  const runner=mockRunner([],{features:listing});await expect(runSubscriptionDiagnostic(f.args,{},runner)).rejects.toThrow('required_native_feature_unavailable');expect(inferCalls(runner)).toHaveLength(0);
});

test.each(['preflight','between_calls'])('expired authorization at %s prevents the next inference',async where=> {
  const f=fixture(),base=Date.now();f.plan.authorization.expiresAt=new Date(base+500).toISOString();writeFileSync(f.casesPath,JSON.stringify(f.plan));
  let current=base;const clock=vi.spyOn(Date,'now').mockImplementation(()=>current);
  const delegate=mockRunner(Array.from({length:3},()=>native(JSON.stringify(f.context.previousScore))));
  const runner:NativeRunner=vi.fn(async invocation=>{const result=await delegate(invocation);if(where==='preflight'&&invocation.args.includes('--help')||where==='between_calls'&&invocation.finalPath)current=base+1000;return result;});
  try {const receipt=await runSubscriptionDiagnostic(f.args,{},runner);expect(receipt).toMatchObject({status:'PARTIAL',stopReason:'authorization_expired',calls:where==='preflight'?0:1,attemptedCases:where==='preflight'?0:1});expect(inferCalls(runner)).toHaveLength(where==='preflight'?0:1);expect(existsSync(join(f.dataDir,'.subscription-diagnostic.lock'))).toBe(false);}
  finally{clock.mockRestore();}
});
