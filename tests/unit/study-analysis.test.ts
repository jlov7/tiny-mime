import { afterEach, expect, test } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ANALYST_HEADER, csv } from '../../src/server/study/exports.js';
import { analyzeSyntheticStudy, parseSyntheticAnalystCsv, MAX_ANALYST_BYTES } from '../../src/server/study/analysis.js';
import { runStudyAnalysis } from '../../scripts/analyze-study.js';
import type { AnalystRow } from '../../src/server/study/contracts.js';
const now='2026-10-11T12:00:00.000Z';
function row(index:number,patch:AnalystRow={}):AnalystRow{return {...Object.fromEntries(ANALYST_HEADER.map(key=>[key,null])),protocol_version:'synthetic_full_v1',study_run_id:'synthetic-run',study_phase:'comparative',participant_id:'synthetic-person',consent_version:'synthetic-no-consent',consent_record_id:'fixture-consent',scene_id:'TM02',target_id:'TM02.meaning.1',target_category:'physical',scene_meaning_version:'1',contact_policy_version:'noncontact-v1',first_variant_id:'TM02.first.1',round_index:index,schedule_id:'fixture-schedule',condition:'informed',randomized:true,randomized_at_utc:now,renderer_version:'synthetic-renderer-v1',first_source_kind:'authored_fixture',first_authoring_method:'agent_assisted',first_human_review_status:'not_run',second_source_kind:'mock_fixture',generation_profile:'runtime_informed_v1',first_animation_hash:'a'.repeat(64),first_clip_duration_ms:8000,second_clip_duration_ms:8000,first_score_adjudicated:0,first_adjudication_locked_at_utc:now,rubric_version:'fixture-rubric',second_score_adjudicated:2,second_fidelity_adjudicated:'target_preserved',initiated_at_utc:now,first_guess_submitted_at_utc:now,second_ready_at_utc:now,second_guess_submitted_at_utc:now,round_ended_at_utc:now,second_ready_latency_ms:100,provider_calls:0,validation_retries:0,estimated_cost:0,currency:'USD',first_render_status:'rendered',second_generation_status:'ready',second_render_status:'rendered',client_wait_timed_out:false,client_timing_uncertain:false,fallback_used:false,withdrawn:false,...patch};}
const fixture=(rows:AnalystRow[])=>csv(ANALYST_HEADER,rows);
let directory:string|undefined;afterEach(()=>{if(directory)rmSync(directory,{recursive:true});directory=undefined;});
test('hand-calculated synthetic denominators preserve failures, pending, withdrawal, retention and fidelity',()=>{
  const report=analyzeSyntheticStudy(fixture([
    row(1),row(2,{client_wait_timed_out:true,timeout_stage:'client_wait',second_ready_latency_ms:99999,second_score_adjudicated:null,missingness_reason:'technical_failure'}),
    row(3,{round_ended_at_utc:null,second_score_adjudicated:null,missingness_reason:'pending'}),
    row(4,{first_score_adjudicated:2,second_ready_latency_ms:200}),
    row(5,{condition:'blind_retry',generation_profile:'runtime_blind_v1',second_fidelity_adjudicated:'changed_story',second_ready_latency_ms:300}),
    row(6,{condition:'blind_retry',generation_profile:'runtime_blind_v1',second_score_adjudicated:1,second_ready_latency_ms:400}),
    row(7,{condition:'blind_retry',generation_profile:'runtime_blind_v1',first_score_adjudicated:null,first_adjudication_locked_at_utc:null,second_ready_latency_ms:500}),
    row(8,{withdrawn:true,missingness_reason:'withdrawal',second_ready_latency_ms:600}),
    row(1,{study_phase:'practice',condition:null,randomized:false,randomized_at_utc:null,generation_profile:'practice_blind_v1',second_ready_latency_ms:700}),
    row(1,{study_phase:'optional_extra',condition:null,randomized:false,randomized_at_utc:null,generation_profile:'practice_blind_v1',second_ready_latency_ms:800}),
  ]));
  expect(report.counts).toMatchObject({initiated:10,practice:1,optional:1,randomized:8,retainedRandomized:7,withdrawn:1,eligible:5,allRandomizedMissingOutcome:1});
  expect(report.conditions.informed.primary).toEqual({successes:1,denominator:2,unresolved:1,rate:.5,retainedCompletionBounds:{lower:1/3,upper:2/3}});
  expect(report.conditions.informed.initialCorrectRetention).toMatchObject({successes:1,denominator:1,rate:1});
  expect(report.conditions.blind_retry.primary).toMatchObject({successes:1,denominator:2,rate:.5});
  expect(report.conditions.blind_retry.allRandomized).toMatchObject({successes:2,denominator:3});
  expect(report.conditions.blind_retry.fidelityPreservingRepair).toMatchObject({successes:0,denominator:2,rate:0});
  expect(report.conditions.blind_retry.fidelity.changed_story).toBe(1);
  expect(report.repairDifferencePercentagePoints).toBe(0);expect(report.repairSignal).toBe('INSUFFICIENT');
  expect(report.latency).toMatchObject({observed:8,medianMs:450,p90Ms:800,p95Ms:800,allTimeouts:1});
  expect(report.coverage.intentionToTreat).toBe('NOT ESTABLISHED');expect(report.humanStudy).toBe('NOT RUN');
  expect(report.byScene[0]!.conditions.informed.primary.denominator).toBe(2);
  expect(report.byCategory[0]!.conditions.blind_retry.primary.denominator).toBe(2);
});
test('offer, acceptance, playback and completion have distinct denominators; missing choice remains unknown',()=>{
  const report=analyzeSyntheticStudy(fixture([
    row(1,{participant_id:'one',optional_extra_offered:true,optional_extra_accepted:false,optional_extra_started:false,optional_extra_completed:false}),
    row(1,{participant_id:'two',optional_extra_offered:true,optional_extra_accepted:true,optional_extra_started:false,optional_extra_completed:false}),
    row(1,{participant_id:'three',optional_extra_offered:true,optional_extra_accepted:true,optional_extra_started:true,optional_extra_completed:false}),
    row(1,{participant_id:'four',optional_extra_offered:true,optional_extra_accepted:true,optional_extra_started:true,optional_extra_completed:true}),
    row(1,{participant_id:'five',optional_extra_offered:false}),row(1,{participant_id:'six',optional_extra_offered:true}),
  ]));
  expect(report.optionalContinuation).toEqual({offerObserved:6,notOffered:1,offered:5,accepted:{count:3,denominator:5,unknown:1},started:{count:2,denominator:3,unknown:0},completed:{count:1,denominator:2,unknown:0}});
});
test('empty/unknown stratum is insufficient rather than zero and null metrics are not synthesized',()=>{
  const report=analyzeSyntheticStudy(fixture([row(1,{first_score_adjudicated:null,first_adjudication_locked_at_utc:null,second_score_adjudicated:null,second_fidelity_adjudicated:null,second_ready_latency_ms:null,estimated_cost:null})]));
  expect(report.conditions.informed.primary).toMatchObject({denominator:0,rate:null});expect(report.conditions.informed.allRandomized.unresolved).toBe(1);expect(report.repairDifferencePercentagePoints).toBeNull();expect(report.latency).toMatchObject({observed:0,missing:1,medianMs:null,p90Ms:null});expect(report.resources.unknownCostRows).toBe(1);
  expect(analyzeSyntheticStudy(fixture([])).counts.initiated).toBe(0);
});
test.each([
  {protocol_version:'human_protocol_v1'},{consent_version:'actual-consent'},{second_source_kind:'runtime_generated'},{provider_calls:1},{estimated_cost:.1},{model_version:'real-model'},
  {condition:null},{study_phase:'practice'},{first_score_adjudicated:3},{first_guess_codepoints:241},{first_clip_duration_ms:5999},
  {round_index:0},{second_ready_latency_ms:-1},{initiated_at_utc:'not-time'},{optional_extra_accepted:true},{optional_extra_completed:true},
] as AnalystRow[])('rejects nonconforming/synthetic boundary values %j',patch=>{expect(()=>parseSyntheticAnalystCsv(fixture([row(1,patch)]))).toThrow('Invalid synthetic analyst CSV');});
test('strict CSV rejects wrong header, malformed quoting, duplicate rows, formula metadata and mixed revisions',()=>{
  const valid=fixture([row(1)]);expect(parseSyntheticAnalystCsv(valid)).toHaveLength(1);
  for(const invalid of [valid.replace('protocol_version','unexpected'),valid.replace('synthetic_full_v1','"broken'),fixture([row(1),row(1)]),fixture([row(1,{participant_id:'=formula'})]),fixture([row(1),row(2,{rubric_version:'changed'})]),valid.replace('true','TRUE')])expect(()=>parseSyntheticAnalystCsv(invalid)).toThrow();
  expect(()=>parseSyntheticAnalystCsv('x'.repeat(MAX_ANALYST_BYTES+1))).toThrow();
});
test('actual local command reads only a bounded conforming CSV and preserves no-upload synthetic claim ceiling',()=>{
  directory=mkdtempSync(join(tmpdir(),'tiny-mime-analysis-'));const path=join(directory,'fixture.csv');writeFileSync(path,fixture([row(1)]));
  expect(runStudyAnalysis(['--fixture',path])).toMatchObject({evidence:'synthetic_fixture',humanStudy:'NOT RUN',liveProvider:'NOT RUN'});
  expect(()=>runStudyAnalysis(['--human',path])).toThrow();writeFileSync(path,fixture([row(1,{protocol_version:'actual-human-study'})]));expect(()=>runStudyAnalysis(['--fixture',path])).toThrow();
});

test('unknown operational inputs remain unresolved and inconsistent authored derived outcomes are flagged',()=>{
  const report=analyzeSyntheticStudy(fixture([row(1,{client_timing_uncertain:null,second_full_operational:true}),row(2,{second_generation_status:null}),row(3,{second_fidelity_adjudicated:'changed_story',fidelity_preserving_repair:true})]));
  expect(report.conditions.informed.allRandomized).toMatchObject({successes:1,denominator:1,unresolved:2});
  expect(report.qualityFlags).toContain('derived_second_full_operational_mismatch');expect(report.qualityFlags).toContain('derived_fidelity_preserving_repair_mismatch');
});
