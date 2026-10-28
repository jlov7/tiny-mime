import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { runQualityProbe, probeTerminalSummary, type ProbeReceipt } from '../../scripts/quality-probe.js';
import { disabledProviderConfig } from '../../src/server/providerConfig.js';
import type { GenerateContext, ProviderTransport } from '../../src/server/provider.js';
let directory:string;
beforeEach(()=>{directory=mkdtempSync(join(tmpdir(),'tiny-mime-probe-'));vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('Real fetch forbidden');}));});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();rmSync(directory,{recursive:true});});
function plan(){
  const config=disabledProviderConfig();config.provider='openai_responses';config.modelId='mock-supported-model';
  config.priceSnapshot={sourceUrl:'https://openai.com/api/pricing/',checkedAt:new Date(Date.now()-1000).toISOString(),inputUsdPerMillion:.1,outputUsdPerMillion:.1,otherChargeMicroUsd:0,tokenAccountingVerified:true};
  config.approval={approvalId:randomUUID(),approvedAt:new Date(Date.now()-2000).toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),purpose:'quality_probe',providerDisclosureVersion:'fixture-disclosure',budgetAcknowledged:true};
  Object.assign(config.qualityProbe,{enabled:true,callCapUsd:.5,unitCapUsd:1,dayCapUsd:3,jobCapUsd:3,approvedCaseCount:3});
  const context=JSON.parse(JSON.parse(readFileSync(resolve('Tiny_Mime_Review_Source_Pack/supplements/contract-fixtures/TM01.blind.request.json'),'utf8')).input[0].content[0].text) as GenerateContext;
  const cases=[{...context,generationProfile:'development_probe_informed_v1' as const,guessData:{kind:'actual' as const,text:'They are dancing'}},{...context,generationProfile:'development_probe_informed_v1' as const,guessData:{kind:'actual' as const,text:'One is deliberately blocking the other'}},{...context,generationProfile:'development_probe_blind_v1' as const}].map(context=>({caseId:randomUUID(),context}));
  const manifest={version:1,probeRunId:randomUUID(),approvalId:config.approval.approvalId,priceSnapshotId:randomUUID(),creatorOwnedNonpersonal:true,cases};
  const configPath=join(directory,'fixture-config.json'),casesPath=join(directory,'fixture-cases.json'),dataDir=join(directory,'private-data');
  writeFileSync(configPath,JSON.stringify(config));writeFileSync(casesPath,JSON.stringify(manifest));
  writeFileSync(configPath+'.evidence.json',JSON.stringify({version:1,modelId:config.modelId,officialSourceUrl:'https://developers.openai.com/api/docs/models/',checkedAt:new Date().toISOString(),responsesSupported:true,strictStructuredOutputsSupported:true,inputBytesPlus1024Verified:true,boundedOutputBillingVerified:true,explicitSpendingApproved:true,approvalId:config.approval.approvalId,providerDisclosureVersion:config.approval.providerDisclosureVersion}));
  return {config,context,manifest,configPath,casesPath,dataDir,args:['--config',configPath,'--cases',casesPath,'--data-dir',dataDir],env:{TM_PROVIDER_MODE:config.provider,TM_MODEL_ID:config.modelId,OPENAI_API_KEY:'mock-fixture-not-a-key'}};
}
function response(score:unknown,status='completed',usage=true){return new Response(JSON.stringify({model:'mock-supported-model',status:status==='refusal'?'completed':status,...(usage?{usage:{input_tokens:100,output_tokens:100,total_tokens:200}}:{}),output:[{type:'message',role:'assistant',status:'completed',content:status==='refusal'?[{type:'refusal',refusal:'fixture refusal'}]:[{type:'output_text',text:JSON.stringify(score)}]}]}),{headers:{'x-request-id':'fixture-request'}});}
function attempts(receipt:ProbeReceipt){return readFileSync(receipt.ledgerPath!,'utf8').trim().split('\n').map(line=>JSON.parse(line));}
function assertReleased(dataDir:string){expect(existsSync(join(dataDir,'.tiny-mime.lock'))).toBe(false);const db=new Database(join(dataDir,'ledger.sqlite'));try{return (db.prepare('SELECT COUNT(*) AS n FROM provider_calls').get() as {n:number}).n;}finally{db.close();}}
test('genuine bounded command executes frozen informed/informed/blind triplet plus exactly one repair, private mock custody and sanitized terminal summary',async()=>{
  const fixture=plan(),requests:Record<string,any>[]=[],answers=[{},fixture.context.previousScore,fixture.context.previousScore,fixture.context.previousScore];
  const transport=vi.fn(async(url:string,init:RequestInit)=>{expect(url).toBe('https://api.openai.com/v1/responses');const request=JSON.parse(init.body as string);requests.push(JSON.parse(request.input[0].content[0].text));return response(answers.shift());});
  const receipt=await runQualityProbe(fixture.args,fixture.env,transport);
  expect(receipt).toMatchObject({status:'COMPLETE',plannedCases:3,attemptedCases:3,successfulCases:3,calls:4,stopReason:null,source:'mock_fixture'});
  expect(requests.map(request=>request.guessData)).toEqual([{kind:'actual',text:'They are dancing'},{kind:'actual',text:'They are dancing'},{kind:'actual',text:'One is deliberately blocking the other'},{kind:'withheld'}]);
  expect(requests[0]!.repairErrors).toBeNull();expect(requests[1]!.repairErrors.length).toBeGreaterThan(0);
  const rows=attempts(receipt);expect(rows.map(row=>row.attempt)).toEqual([1,2,1,1]);expect(rows.map(row=>row.termination)).toEqual(['invalid_output','validated','validated','validated']);
  for(const row of rows){expect(row).toMatchObject({source:'mock_fixture',costStatus:'mock_zero',actualMicroUsd:0});expect(row.responseBodyBase64).toBeTruthy();expect(row.reservedMicroUsd).toBeGreaterThan(0);}
  const manifest=JSON.parse(readFileSync(receipt.ledgerPath!.replace('.jsonl','.manifest.json'),'utf8'));expect(manifest).toMatchObject({retentionDays:7,manifest:{source:'mock_fixture',costProvenance:'mock_zero',limits:{callMs:45000,caseMs:90000,maximumCalls:2,concurrency:1}}});expect(manifest.manifest.plan).toEqual(fixture.manifest);expect(manifest.manifest.initialRequests).toHaveLength(3);
  expect(statSync(receipt.ledgerPath!).mode&0o777).toBe(0o600);expect(assertReleased(fixture.dataDir)).toBe(4);
  const summary=JSON.stringify(probeTerminalSummary(receipt));for(const privateValue of ['They are dancing','blocking','previousScore','Authorization','mock-fixture-not-a-key',fixture.dataDir])expect(summary).not.toContain(privateValue);expect(fetch).not.toHaveBeenCalled();
});
test.each(['refusal','incomplete','unknown_billing','deadline'] as const)('command stops after %s and reports planned versus attempted calls',async reason=>{
  const fixture=plan();if(reason==='deadline')vi.useFakeTimers();
  const transport:ProviderTransport=vi.fn(async()=>reason==='deadline'?new Promise<Response>(()=>{}):response(fixture.context.previousScore,reason==='refusal'?'refusal':reason==='incomplete'?'incomplete':'completed',reason!=='unknown_billing'));
  const pending=runQualityProbe(fixture.args,fixture.env,transport);if(reason==='deadline')await vi.advanceTimersByTimeAsync(45000);
  const receipt=await pending;expect(receipt).toMatchObject({status:'PARTIAL',plannedCases:3,attemptedCases:1,successfulCases:0,calls:1});expect(attempts(receipt)).toHaveLength(1);expect(assertReleased(fixture.dataDir)).toBe(1);expect(fetch).not.toHaveBeenCalled();
  expect(receipt.stopReason).toBe(reason);
  if(reason==='deadline')expect(attempts(receipt)[0]!.termination).toBe('deadline');
  if(reason==='incomplete')expect(attempts(receipt)[0]!.termination).toBe('incomplete');
  if(reason==='unknown_billing'){const db=new Database(join(fixture.dataDir,'ledger.sqlite'));try{expect((db.prepare('SELECT actual FROM provider_calls').get() as {actual:null}).actual).toBeNull();}finally{db.close();}}
});
test('reconciled ledger gate rejects restart uncertainty with zero dispatch and releases the data lock',async()=>{
  const fixture=plan();const initial=await runQualityProbe(fixture.args,fixture.env,async()=>response(fixture.context.previousScore));expect(initial.calls).toBe(3);
  const transport=vi.fn(async()=>response(fixture.context.previousScore)),receipt=await runQualityProbe(fixture.args,fixture.env,transport);
  expect(receipt).toMatchObject({status:'FAILED',stopReason:'ledger_locked',plannedCases:3,attemptedCases:0,calls:0,ledgerPath:null});expect(transport).not.toHaveBeenCalled();expect(assertReleased(fixture.dataDir)).toBe(3);expect(fetch).not.toHaveBeenCalled();
});
test('transport injection cannot bypass approval, environment, triplet or key gates and cannot be used by production command',async()=>{
  const fixture=plan(),transport=vi.fn(async()=>response(fixture.context.previousScore));
  await expect(runQualityProbe(fixture.args,{...fixture.env,OPENAI_API_KEY:undefined},transport)).rejects.toThrow();
  await expect(runQualityProbe(fixture.args,{...fixture.env,TM_MODEL_ID:'other'},transport)).rejects.toThrow();
  fixture.manifest.cases[1]!.context.guessData=fixture.manifest.cases[0]!.context.guessData;writeFileSync(fixture.casesPath,JSON.stringify(fixture.manifest));
  await expect(runQualityProbe(fixture.args,fixture.env,transport)).rejects.toThrow('two distinct');
  const old=process.env.NODE_ENV;process.env.NODE_ENV='production';try{await expect(runQualityProbe(fixture.args,fixture.env,transport)).rejects.toThrow('test-only');}finally{process.env.NODE_ENV=old;}
  expect(transport).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
});

test('seven-day raw diagnostic retention is preserved by genuine command startup',async()=>{
  const fixture=plan(),privateDir=join(fixture.dataDir,'probe-private'),oldId=randomUUID();mkdirSync(privateDir,{recursive:true});
  const oldManifest=join(privateDir,oldId+'.manifest.json'),oldLedger=join(privateDir,oldId+'.jsonl');
  writeFileSync(oldManifest,JSON.stringify({createdAt:new Date(Date.now()-7*86400000).toISOString()}));writeFileSync(oldLedger,'expired fixture diagnostics');
  const receipt=await runQualityProbe(fixture.args,fixture.env,async()=>response(fixture.context.previousScore));
  expect(receipt.status).toBe('COMPLETE');expect(existsSync(oldManifest)).toBe(false);expect(existsSync(oldLedger)).toBe(false);expect(existsSync(receipt.ledgerPath!)).toBe(true);expect(assertReleased(fixture.dataDir)).toBe(3);
});
test('diagnostic custody failure after dispatch preserves FAILED attempt counts and closes accounting',async()=>{
  const fixture=plan();let caught:unknown;
  try{await runQualityProbe(fixture.args,fixture.env,async()=>{rmSync(join(fixture.dataDir,'probe-private'),{recursive:true});return response(fixture.context.previousScore);});}catch(error){caught=error;}
  expect(caught).toMatchObject({receipt:{status:'FAILED',stopReason:'diagnostic_or_accounting_failure',plannedCases:3,attemptedCases:1,calls:1,successfulCases:0}});
  expect(assertReleased(fixture.dataDir)).toBe(1);expect(fetch).not.toHaveBeenCalled();
});
