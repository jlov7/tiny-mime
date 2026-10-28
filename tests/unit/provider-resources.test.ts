import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BudgetLedger, type ReserveInput } from '../../src/server/budget.js';
import { compileRequest, generateValidated, type GenerateContext, type GenerationPolicy, type ProviderResult } from '../../src/server/provider.js';
import { disabledProviderConfig } from '../../src/server/providerConfig.js';

let db: Database.Database;
let now: number;
const dayMs = 86400000;
beforeEach(() => { db=new Database(':memory:'); now=Date.parse('2026-10-08T12:00:00Z'); vi.stubGlobal('fetch',vi.fn(() => { throw new Error('Network forbidden'); })); });
afterEach(() => { db.close(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function input(): ReserveInput {
  return { jobId:randomUUID(),unitId:randomUUID(),approvalId:randomUUID(),profile:'runtime',model:'mock-model',price:{sourceUrl:'https://openai.com/api/pricing/',checkedAt:new Date(now).toISOString(),inputUsdPerMillion:1,outputUsdPerMillion:1,otherChargeMicroUsd:0,tokenAccountingVerified:true},caps:{...disabledProviderConfig().runtime,enabled:true,callCapUsd:.1,unitCapUsd:.2,dayCapUsd:5,jobCapUsd:5,approvedCaseCount:10},requestUtf8Bytes:8976,framingTokenBound:1024,inputTokenBound:10000,outputTokenCap:6000 };
}
function policy(): { context: GenerateContext; policy: GenerationPolicy } {
  const fixture=JSON.parse(readFileSync(resolve('Tiny_Mime_Review_Source_Pack/supplements/contract-fixtures/TM01.blind.request.json'),'utf8'));
  const context: GenerateContext=JSON.parse(fixture.input[0].content[0].text);
  const config=disabledProviderConfig(); const approved=input();
  config.provider='openai_responses'; config.modelId=approved.model; config.priceSnapshot=approved.price; config.runtime=approved.caps;
  config.approval={approvalId:approved.approvalId,approvedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+dayMs).toISOString(),purpose:'runtime_private_play',providerDisclosureVersion:'mock-disclosure',budgetAcknowledged:true};
  return { context, policy:{config,ledger:new BudgetLedger(db,()=>now),jobId:approved.jobId,unitId:approved.unitId,deadlineMonoMs:15000,apiKey:'fake-fixture-value',nowMono:()=>0,nowWall:()=>now,activationEvidence:{version:1,modelId:approved.model,officialSourceUrl:'https://developers.openai.com/api/docs/models/',checkedAt:new Date(now).toISOString(),responsesSupported:true,strictStructuredOutputsSupported:true,inputBytesPlus1024Verified:true,boundedOutputBillingVerified:true,explicitSpendingApproved:true,approvalId:approved.approvalId,providerDisclosureVersion:'mock-disclosure'}} };
}
function result(context: GenerateContext, rawJson=JSON.stringify(context.previousScore)): ProviderResult {
  return { rawJson,providerRequestId:'req_mock',model:'mock-model',inputTokens:100,outputTokens:200,status:'completed' };
}

describe('Numeric resource receipts, fake time and fake billing only', () => {
  test('exact compiled bytes, framing and B persist before each initial and repair dispatch', async () => {
    const {context,policy:p}=policy(); let calls=0;
    p.provider={generate:vi.fn(async current => {
      const compiled=compileRequest(current,p.config.modelId!,6000);
      const rows=db.prepare('SELECT request_utf8_bytes,framing_token_bound,input_bound,status FROM provider_calls ORDER BY rowid').all();
      expect(rows).toHaveLength(++calls);
      expect(rows.at(-1)).toEqual({request_utf8_bytes:Buffer.byteLength(compiled.bodyJson,'utf8'),framing_token_bound:1024,input_bound:compiled.requestUtf8Bytes+1024,status:'pending'});
      return result(context,calls===1 ? '{}' : undefined);
    })};
    expect(await generateValidated(context,p,new AbortController().signal)).toMatchObject({ok:true,calls:2});
    expect(p.ledger.summaryForUnit(p.jobId,p.unitId)).toEqual({calls:2,inputTokens:200,outputTokens:400,actualMicroUsd:600});
    expect(fetch).not.toHaveBeenCalled();
  });
  test('invalid output, refusal and timeout keep every attempt with billed usage or uncertainty', async () => {
    const {context,policy:p}=policy();
    p.provider={generate:vi.fn(async()=>result(context,'{}'))};
    expect(await generateValidated(context,p,new AbortController().signal)).toMatchObject({failure:'invalid_output',calls:2});
    expect(p.ledger.summaryForUnit(p.jobId,p.unitId)).toEqual({calls:2,inputTokens:200,outputTokens:400,actualMicroUsd:600});
    const refusal={...p,jobId:randomUUID(),unitId:randomUUID(),provider:{generate:vi.fn(async()=>({...result(context),status:'refusal' as const}))}};
    expect(await generateValidated(context,refusal,new AbortController().signal)).toMatchObject({failure:'refusal',calls:1});
    expect(p.ledger.summaryForUnit(refusal.jobId,refusal.unitId)).toEqual({calls:1,inputTokens:100,outputTokens:200,actualMicroUsd:300});
    vi.useFakeTimers();
    const timeout={...p,jobId:randomUUID(),unitId:randomUUID(),provider:{generate:vi.fn(()=>new Promise<ProviderResult>(()=>{}))}};
    const pending=generateValidated(context,timeout,new AbortController().signal);
    await vi.advanceTimersByTimeAsync(7000);
    expect(await pending).toMatchObject({failure:'deadline',calls:1});
    expect(p.ledger.summaryForUnit(timeout.jobId,timeout.unitId)).toEqual({calls:1,inputTokens:null,outputTokens:null,actualMicroUsd:null});
  });
  test('unknown repair usage never produces partial totals or a zero-cost estimate', () => {
    const ledger=new BudgetLedger(db,()=>now); const i=input();
    ledger.reconcile(ledger.reserve(i).callId,{inputTokens:10,outputTokens:20});
    ledger.reconcile(ledger.reserve(i).callId,null);
    expect(ledger.summaryForUnit(i.jobId,i.unitId)).toEqual({calls:2,inputTokens:null,outputTokens:null,actualMicroUsd:null});
    expect(ledger.summaryForUnit(randomUUID(),randomUUID())).toEqual({calls:0,inputTokens:0,outputTokens:0,actualMicroUsd:0});
  });
  test('known zero usage and zero pricing remain known zero rather than unknown', () => {
    const ledger=new BudgetLedger(db,()=>now); const i=input();
    i.price.inputUsdPerMillion=0; i.price.outputUsdPerMillion=0;
    ledger.reconcile(ledger.reserve(i).callId,{inputTokens:10,outputTokens:20});
    expect(ledger.summaryForUnit(i.jobId,i.unitId)).toEqual({calls:1,inputTokens:10,outputTokens:20,actualMicroUsd:0});
    const zero={...i,jobId:randomUUID(),unitId:randomUUID()};
    ledger.reconcile(ledger.reserve(zero).callId,{inputTokens:0,outputTokens:0});
    expect(ledger.summaryForUnit(zero.jobId,zero.unitId)).toEqual({calls:1,inputTokens:0,outputTokens:0,actualMicroUsd:0});
  });
  test.each([{requestUtf8Bytes:8975},{requestUtf8Bytes:-1},{requestUtf8Bytes:8976.5},{framingTokenBound:1023}])('inconsistent byte/framing receipt %j refuses before dispatch reservation', change => {
    const ledger=new BudgetLedger(db,()=>now);
    expect(()=>ledger.reserve({...input(),...change} as ReserveInput)).toThrow('Budget invalid');
    expect(db.prepare('SELECT COUNT(*) AS n FROM provider_calls').get()).toEqual({n:0});
  });
  test('purge at 30 days retains only unlinked daily numbers and a hashed job retirement lock', () => {
    const ledger=new BudgetLedger(db,()=>now); const i=input(); const started=now;
    ledger.reconcile(ledger.reserve(i).callId,{inputTokens:10,outputTokens:20},'req_mock');
    ledger.reconcile(ledger.reserve(i).callId,{inputTokens:30,outputTokens:40},'req_mock_repair');
    now=started+30*dayMs-1; ledger.purge();
    expect(db.prepare('SELECT COUNT(*) AS n FROM provider_calls').get()).toEqual({n:2});
    now++; ledger.purge(); ledger.purge();
    expect(db.prepare('SELECT COUNT(*) AS n FROM provider_calls').get()).toEqual({n:0});
    expect(db.prepare('SELECT * FROM provider_daily_totals').all()).toEqual([{profile:'runtime',day:'2026-10-08',calls:2,input_tokens:40,output_tokens:60,actual:100}]);
    expect(db.prepare('SELECT * FROM provider_retired_jobs').all()).toEqual([{job_hash:createHash('sha256').update(i.jobId).digest('hex')}]);
    expect(()=>ledger.reserve({...i,unitId:randomUUID()})).toThrow('Budget locked');
    expect(()=>ledger.summaryForUnit(i.jobId,i.unitId)).toThrow('Budget invalid');
    const retained=JSON.stringify(db.prepare('SELECT * FROM provider_daily_totals').all())+JSON.stringify(db.prepare('SELECT * FROM provider_retired_jobs').all());
    for (const value of [i.jobId,i.unitId,i.approvalId,i.model,'req_mock']) expect(retained).not.toContain(value);
  });
  test('pending, unknown and explicitly retained unknown reservations never expire', () => {
    const ledger=new BudgetLedger(db,()=>now); const pending=ledger.reserve(input()); const unknown=ledger.reserve(input());
    ledger.reconcile(unknown.callId,null);
    now+=31*dayMs; ledger.purge();
    expect(ledger.status().reservedUnknownMicroUsd).toBe(pending.reservedMicroUsd+unknown.reservedMicroUsd);
    ledger.confirmReconciliation({providerRecordsVerified:true,retainUnknownAtFullReserve:true,verifiedThroughWallMs:now});
    now+=31*dayMs; ledger.purge();
    expect(db.prepare('SELECT COUNT(*) AS n FROM provider_calls').get()).toEqual({n:2});
    expect(ledger.status().reservedUnknownMicroUsd).toBe(pending.reservedMicroUsd+unknown.reservedMicroUsd);
    ledger.reconcile(unknown.callId,{inputTokens:10,outputTokens:20});
    expect(db.prepare('SELECT call_id FROM provider_calls').all()).toEqual([{call_id:pending.callId}]);
    expect(db.prepare('SELECT actual FROM provider_daily_totals').get()).toEqual({actual:30});
  });
  test('startup purges known details but history still locks restart and retired jobs stay closed', () => {
    const ledger=new BudgetLedger(db,()=>now); const i=input();
    ledger.reconcile(ledger.reserve(i).callId,{inputTokens:0,outputTokens:0});
    now+=30*dayMs;
    const firstRestart=new BudgetLedger(db,()=>now);
    expect(db.prepare('SELECT COUNT(*) AS n FROM provider_calls').get()).toEqual({n:0});
    expect(firstRestart.status()).toMatchObject({locked:true,reason:'restart'});
    firstRestart.confirmReconciliation({providerRecordsVerified:true,retainUnknownAtFullReserve:true,verifiedThroughWallMs:now});
    const secondRestart=new BudgetLedger(db,()=>now);
    expect(secondRestart.status()).toMatchObject({locked:true,reason:'restart'});
    secondRestart.confirmReconciliation({providerRecordsVerified:true,retainUnknownAtFullReserve:true,verifiedThroughWallMs:now});
    expect(()=>secondRestart.reserve(i)).toThrow('Budget locked');
    expect(secondRestart.reserve(input()).reservedMicroUsd).toBe(16000);
  });
  test('pruning old days cannot free current UTC-day spend or let a regressed clock erase totals', () => {
    const ledger=new BudgetLedger(db,()=>now); const old=input();
    ledger.reconcile(ledger.reserve(old).callId,{inputTokens:10000,outputTokens:6000});
    now+=30*dayMs; const current=input(); current.caps.dayCapUsd=.016;
    ledger.reserve(current);
    expect(()=>ledger.reserve({...current,jobId:randomUUID(),unitId:randomUUID()})).toThrow('Budget limited');
    expect(db.prepare('SELECT actual FROM provider_daily_totals').get()).toEqual({actual:16000});
    now-=30*dayMs; ledger.purge();
    expect(ledger.status()).toMatchObject({locked:true,reason:'day_regression'});
    ledger.confirmReconciliation({providerRecordsVerified:true,retainUnknownAtFullReserve:true,verifiedThroughWallMs:now+30*dayMs});
    expect(()=>ledger.reserve(input())).toThrow('Budget locked');
    expect(db.prepare('SELECT actual FROM provider_daily_totals').get()).toEqual({actual:16000});
  });
  test('daily caps include retained numeric totals exactly once', () => {
    const ledger=new BudgetLedger(db,()=>now); const i=input(); i.caps.dayCapUsd=.016;
    db.prepare('INSERT INTO provider_daily_totals(profile,day,calls,input_tokens,output_tokens,actual) VALUES (?,?,?,?,?,?)').run('runtime','2026-10-08',1,500,500,1000);
    expect(()=>ledger.reserve(i)).toThrow('Budget limited');
    const remaining={...i,inputTokenBound:9000,requestUtf8Bytes:7976};
    expect(ledger.reserve(remaining).reservedMicroUsd).toBe(15000);
    expect(()=>ledger.reserve({...remaining,jobId:randomUUID(),unitId:randomUUID()})).toThrow('Budget limited');
    expect(db.prepare('SELECT actual FROM provider_daily_totals').get()).toEqual({actual:1000});
  });
  test('legacy details migrate without inventing measured bytes and expire while preserving restart lock', () => {
    const ledger=new BudgetLedger(db,()=>now); const i=input();
    ledger.reconcile(ledger.reserve(i).callId,{inputTokens:10,outputTokens:20});
    for (const column of ['request_utf8_bytes','framing_token_bound','created_wall']) db.exec(`ALTER TABLE provider_calls DROP COLUMN ${column}`);
    const migrated=new BudgetLedger(db,()=>now);
    expect(db.prepare('SELECT request_utf8_bytes,framing_token_bound,created_wall FROM provider_calls').get()).toEqual({request_utf8_bytes:null,framing_token_bound:null,created_wall:Date.parse('2026-10-08T00:00:00Z')});
    expect(migrated.status()).toMatchObject({locked:true,reason:'restart'});
    now+=30*dayMs; migrated.purge();
    expect(db.prepare('SELECT COUNT(*) AS n FROM provider_calls').get()).toEqual({n:0});
    expect(db.prepare('SELECT actual FROM provider_daily_totals').get()).toEqual({actual:30});
  });
});
