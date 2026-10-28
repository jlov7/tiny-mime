import { z } from 'zod';
import { ANALYST_HEADER } from './exports.js';
import type { AnalystRow } from './contracts.js';

export const ANALYSIS_PLAN = {
  version:'synthetic-descriptive-v1',
  authority:['chapters/03_evaluation_and_evidence.md','supplements/pilot-data-dictionary.md'],
  scope:'Synthetic local fixtures only. Human study and live provider qualifications NOT RUN.',
  primary:'Retained resolved comparative randomized first scores 0/1; second full operational recognition. Informed minus blind retry percentage points.',
  missingness:'Pending outcomes and missing first adjudication stay null. Withdrawn rows excluded from retained denominators. Deleted rows cannot be reconstructed from this CSV.',
  latency:'Terminal ready/rendered, no fallback, timeout or timing uncertainty; completed-only median and nearest-rank p90/p95. All timeouts reported separately.',
  inference:'Descriptive only. No significance tests or confidence intervals. Participant and scene are crossed units; rounds are not independent participants.',
  insufficient:'Fewer than 40 retained resolved primary-eligible rounds is insufficient. Synthetic rows never establish a repair effect.',
  sensitivity:'Min/max completion bounds cover unresolved outcomes among retained known-eligible rows only, not withdrawn/deleted rows or unknown eligibility.',
} as const;
export const MAX_ANALYST_BYTES=20*1024*1024;
const identifier=z.string().regex(/^[A-Za-z0-9_.:-]{1,200}$/), integer=z.number().int().nonnegative().safe(), timestamp=z.iso.datetime(), boolean=z.boolean();
const enums:Record<string,z.ZodType>={
  protocol_version:z.enum(['synthetic_short_v1','synthetic_full_v1']),study_phase:z.enum(['formative','bank_calibration','practice','comparative','optional_extra']),
  consent_version:z.literal('synthetic-no-consent'),contact_policy_version:z.literal('noncontact-v1'),target_category:z.enum(['physical','social']),condition:z.enum(['informed','blind_retry']),
  first_source_kind:z.literal('authored_fixture'),first_authoring_method:z.enum(['spec_transcribed','agent_assisted','human_authored']),first_human_review_status:z.enum(['not_run','reviewed']),second_source_kind:z.enum(['mock_fixture','authored_fixture']),
  generation_profile:z.enum(['practice_blind_v1','runtime_informed_v1','runtime_blind_v1']),model_version:z.never(),
  score_disagreement_type:z.enum(['none','first_only','second_only','both']),
  second_fidelity_rater_1:z.enum(['target_preserved','unclear','changed_story','unrateable']),second_fidelity_rater_2:z.enum(['target_preserved','unclear','changed_story','unrateable']),second_fidelity_adjudicated:z.enum(['target_preserved','unclear','changed_story','unrateable']),
  first_render_status:z.enum(['not_started','rendered','failed','cancelled']),second_render_status:z.enum(['not_started','rendered','failed','cancelled']),second_generation_status:z.enum(['not_requested','pending','ready','invalid_output','provider_error','timeout','cancelled']),
  timeout_stage:z.enum(['queue','provider','validation','client_wait','unknown']),failure_category:z.enum(['first_render','provider','validation','second_render','timeout','timing_uncertain','client','stage_leak','privacy','other']),
  skip_stage:z.enum(['before_first_guess','waiting_second','before_second_guess','after_second_playback']),missingness_reason:z.enum(['not_applicable','participant_skipped','technical_failure','no_response','not_collected','pending','withdrawal','other']),currency:z.string().regex(/^[A-Z]{3}$/),
};
const required=new Set('protocol_version study_run_id study_phase participant_id consent_version consent_record_id scene_id target_id scene_meaning_version contact_policy_version first_variant_id round_index randomized renderer_version first_source_kind first_authoring_method first_human_review_status initiated_at_utc provider_calls validation_retries'.split(' '));
const booleans=new Set('research_retention_opt_in randomized primary_eligible second_full_operational fidelity_preserving_repair initial_correct_retained cache_hit client_wait_timed_out client_timing_uncertain fallback_used withdrawn reduced_motion would_play_again optional_extra_offered optional_extra_accepted optional_extra_started optional_extra_completed sanitization_event stage_leak_detected'.split(' '));
const integers=new Set('round_index first_clip_duration_ms second_clip_duration_ms first_guess_codepoints second_guess_codepoints second_ready_latency_ms first_response_latency_ms second_response_latency_ms provider_calls validation_retries input_tokens output_tokens replay_count_first replay_count_second viewport_width_px viewport_height_px delight_1_to_5 perceived_helpfulness_1_to_5 first_score_rater_1 first_score_rater_2 first_score_adjudicated second_score_rater_1 second_score_rater_2 second_score_adjudicated'.split(' '));
const shape:Record<string,z.ZodType>={};
for(const key of ANALYST_HEADER){
  let field=enums[key]??(booleans.has(key)?boolean:integers.has(key)?integer:key.endsWith('_utc')?timestamp:key.endsWith('_hash')?z.string().regex(/^[0-9a-f]{64}$/):key==='estimated_cost'?z.number().nonnegative():identifier);
  if(key==='round_index')field=integer.min(1);
  if(key==='provider_calls'||key==='validation_retries')field=z.literal(0);
  if(key.includes('_score_'))field=z.number().int().min(0).max(2);
  if(key.endsWith('_codepoints'))field=z.number().int().min(1).max(240);
  if(key.endsWith('_clip_duration_ms'))field=z.number().int().min(6000).max(10000);
  if(key.endsWith('_1_to_5'))field=z.number().int().min(1).max(5);
  if(key==='estimated_cost')field=z.literal(0);
  shape[key]=required.has(key)?field:field.nullable();
}
const rowSchema=z.object(shape).strict();
function invalid():never{throw new Error('Invalid synthetic analyst CSV');}
// RFC 4180 quoting, exact fields and bounded input. Never interpret formulas or raw text.
function csvRows(text:string):string[][]{
  if(Buffer.byteLength(text,'utf8')>MAX_ANALYST_BYTES||text.includes('\0'))invalid();
  const rows:string[][]=[];let row:string[]=[],cell='',quoted=false,closed=false;
  const addCell=()=>{row.push(cell);cell='';closed=false;if(row.length>ANALYST_HEADER.length)invalid();};
  const addRow=()=>{addCell();rows.push(row);row=[];if(rows.length>10001)invalid();};
  for(let i=0;i<text.length;i++){
    const c=text[i]!;
    if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;}
    else if(c===',')addCell();
    else if(c==='\n'||c==='\r'){if(c==='\r'){if(text[i+1]!=='\n')invalid();i++;}addRow();}
    else if(c==='"'){if(cell||closed)invalid();quoted=true;}
    else{if(closed)invalid();cell+=c;}
    if(cell.length>1000)invalid();
  }
  if(quoted)invalid();if(cell||row.length||closed)addRow();return rows;
}
export function parseSyntheticAnalystCsv(text:string):AnalystRow[]{
  const rows=csvRows(text);if(JSON.stringify(rows.shift())!==JSON.stringify(ANALYST_HEADER))invalid();
  const keys=new Set<string>();const parsed=rows.map(cells=>{
    if(cells.length!==ANALYST_HEADER.length)invalid();
    const record=Object.fromEntries(ANALYST_HEADER.map((key,i)=>{
      const value=cells[i]!;
      if(value==='')return [key,null];
      if(booleans.has(key)){if(!['true','false'].includes(value))invalid();return [key,value==='true'];}
      if(integers.has(key)||key==='estimated_cost'){if(!/^(0|[1-9]\d*)(\.\d+)?$/.test(value))invalid();return [key,Number(value)];}
      return [key,value];
    }));
    const result=rowSchema.safeParse(record);if(!result.success)invalid();const row=result.data as AnalystRow;
    const key=JSON.stringify([row.study_run_id,row.study_phase,row.participant_id,row.round_index]);if(keys.has(key))invalid();keys.add(key);
    if(row.study_phase!=='comparative'&&(row.randomized!==false||row.condition!==null))invalid();
    if(row.randomized===true&&(row.study_phase!=='comparative'||row.condition===null||row.randomized_at_utc===null||row.schedule_id===null))invalid();
    if(row.randomized===false&&(row.condition!==null||row.randomized_at_utc!==null))invalid();
    if(row.study_phase==='practice'&&row.generation_profile!==null&&row.generation_profile!=='practice_blind_v1')invalid();
    if(row.randomized===true&&row.generation_profile!==null&&row.generation_profile!==(row.condition==='informed'?'runtime_informed_v1':'runtime_blind_v1'))invalid();
    if(row.first_score_adjudicated!==null&&(row.first_adjudication_locked_at_utc===null||row.rubric_version===null))invalid();
    if(row.second_score_adjudicated!==null&&row.rubric_version===null)invalid();
    if(row.estimated_cost!==null&&row.currency===null)invalid();
    if(row.optional_extra_accepted!==null&&row.optional_extra_offered!==true)invalid();
    if(row.optional_extra_started===true&&row.optional_extra_accepted!==true)invalid();
    if(row.optional_extra_completed===true&&row.optional_extra_started!==true)invalid();
    if(row.study_phase==='optional_extra'&&['optional_extra_offered','optional_extra_accepted','optional_extra_started','optional_extra_completed'].some(k=>row[k]!==null))invalid();
    return row;
  });
  for(const field of ['study_run_id','protocol_version','renderer_version','prompt_version','rubric_version'])if(new Set(parsed.map(r=>r[field]).filter(v=>v!==null)).size>1)invalid();
  const offers=new Set<string>();for(const row of parsed)if(row.optional_extra_offered!==null){const key=JSON.stringify([row.study_run_id,row.participant_id]);if(offers.has(key))invalid();offers.add(key);}
  return parsed;
}
function outcome(row:AnalystRow):boolean|null{
  if(row.randomized!==true||row.study_phase!=='comparative'||row.round_ended_at_utc===null)return null;
  if(['client_wait_timed_out','client_timing_uncertain','fallback_used'].some(k=>row[k]===true)||row.skip_stage!==null||['not_requested','invalid_output','provider_error','timeout','cancelled'].includes(String(row.second_generation_status))||['not_started','failed','cancelled'].includes(String(row.second_render_status))||row.second_guess_submitted_at_utc===null)return false;
  if(['client_wait_timed_out','client_timing_uncertain','fallback_used'].some(k=>row[k]!==false)||row.second_generation_status!=='ready'||row.second_render_status!=='rendered'||row.second_score_adjudicated===null)return null;
  return row.second_score_adjudicated===2;
}
function rate(rows:AnalystRow[]){const values=rows.map(outcome),successes=values.filter(v=>v===true).length,resolved=values.filter(v=>v!==null).length,unresolved=values.length-resolved;return {successes,denominator:resolved,unresolved,rate:resolved?successes/resolved:null,retainedCompletionBounds:values.length?{lower:successes/values.length,upper:(successes+unresolved)/values.length}:null};}
function summary(rows:AnalystRow[]){const eligible=rows.filter(r=>r.first_score_adjudicated===0||r.first_score_adjudicated===1),correct=rows.filter(r=>r.first_score_adjudicated===2);return {retainedRandomized:rows.length,unknownFirstAdjudication:rows.filter(r=>r.first_score_adjudicated===null).length,primaryEligible:eligible.length,primary:rate(eligible),allRandomized:rate(rows),initialCorrectRetention:rate(correct),fidelity: Object.fromEntries(['target_preserved','unclear','changed_story','unrateable','missing'].map(label=>[label,rows.filter(r=>label==='missing'?r.second_fidelity_adjudicated===null:r.second_fidelity_adjudicated===label).length])),fidelityPreservingRepair:rateWithFidelity(eligible)};}
function rateWithFidelity(rows:AnalystRow[]){const values=rows.map(row=>{const operational=outcome(row);return operational===true?(row.second_fidelity_adjudicated===null?null:row.second_fidelity_adjudicated==='target_preserved'):operational;});const denominator=values.filter(v=>v!==null).length,successes=values.filter(v=>v===true).length;return {successes,denominator,unresolved:values.length-denominator,rate:denominator?successes/denominator:null};}
function median(values:number[]):number|null{if(!values.length)return null;return (values[Math.floor((values.length-1)/2)]!+values[Math.floor(values.length/2)]!)/2;}
function latency(rows:AnalystRow[]){const complete=rows.filter(r=>r.round_ended_at_utc!==null&&r.second_generation_status==='ready'&&r.second_render_status==='rendered'&&r.client_wait_timed_out===false&&r.client_timing_uncertain===false&&r.fallback_used===false),values=complete.map(r=>r.second_ready_latency_ms).filter((v):v is number=>typeof v==='number').sort((a,b)=>a-b);return {label:'completed-only readiness latency; late recovery excluded',completed:complete.length,observed:values.length,missing:complete.length-values.length,medianMs:median(values),p90Ms:values.length?values[Math.ceil(values.length*.9)-1]:null,p95Ms:values.length?values[Math.ceil(values.length*.95)-1]:null,allTimeouts:rows.filter(r=>r.client_wait_timed_out===true||r.timeout_stage!==null||r.second_generation_status==='timeout').length,timingUncertain:rows.filter(r=>r.client_timing_uncertain===true).length};}
export function analyzeSyntheticStudy(text:string){
  const rows=parseSyntheticAnalystCsv(text),randomized=rows.filter(r=>r.randomized===true),retained=randomized.filter(r=>r.withdrawn===false),arm=(name:string)=>summary(retained.filter(r=>r.condition===name));
  const informed=arm('informed'),blind=arm('blind_retry'),eligible=informed.primary.denominator+blind.primary.denominator;
  const offers=rows.filter(r=>r.optional_extra_offered!==null),offered=offers.filter(r=>r.optional_extra_offered===true),accepted=offered.filter(r=>r.optional_extra_accepted===true),started=accepted.filter(r=>r.optional_extra_started===true);
  const flags:string[]=[];for(const scene of new Set(rows.map(r=>r.scene_id)))if(new Set(rows.filter(r=>r.scene_id===scene).map(r=>r.first_animation_hash).filter(v=>v!==null)).size>1)flags.push('first_hash_mismatch');
  for(const row of rows){
    const operational=outcome(row),primary=row.randomized===true?(row.first_score_adjudicated===null?null:row.first_score_adjudicated!==2):false;
    const fidelity=operational===true?(row.second_fidelity_adjudicated===null?null:row.second_fidelity_adjudicated==='target_preserved'):operational;
    const expected={primary_eligible:primary,second_full_operational:operational,fidelity_preserving_repair:fidelity,initial_correct_retained:row.first_score_adjudicated===2?operational:null};
    for(const [key,value] of Object.entries(expected))if(row[key]!==null&&row[key]!==value)flags.push('derived_'+key+'_mismatch');
  }
  const conditionsFor=(subset:AnalystRow[])=>({informed:summary(subset.filter(r=>r.condition==='informed')),blind_retry:summary(subset.filter(r=>r.condition==='blind_retry'))});
  const delight=rows.map(r=>r.delight_1_to_5).filter((v):v is number=>typeof v==='number').sort((a,b)=>a-b);
  const declared=rows.filter(r=>r.would_play_again!==null);
  return {
    analysisPlan:ANALYSIS_PLAN,evidence:'synthetic_fixture',humanStudy:'NOT RUN',liveProvider:'NOT RUN',
    counts:{
      initiated:rows.length,participants:new Set(rows.map(r=>JSON.stringify([r.study_run_id,r.participant_id]))).size,
      practice:rows.filter(r=>r.study_phase==='practice').length,optional:rows.filter(r=>r.study_phase==='optional_extra').length,
      firstSubmitted:rows.filter(r=>r.first_guess_submitted_at_utc!==null).length,randomized:randomized.length,retainedRandomized:retained.length,
      withdrawn:rows.filter(r=>r.withdrawn===true).length,withdrawalUnknown:rows.filter(r=>r.withdrawn===null).length,
      eligible:informed.primaryEligible+blind.primaryEligible,allRandomizedMissingOutcome:randomized.filter(r=>outcome(r)===null).length,
      validSecondGenerated:rows.filter(r=>r.second_generation_status==='ready').length,secondRendered:rows.filter(r=>r.second_render_status==='rendered').length,
      secondAnswered:rows.filter(r=>r.second_guess_submitted_at_utc!==null).length,
    },
    coverage:{deletedRecords:'UNAVAILABLE from retained CSV',intentionToTreat:'NOT ESTABLISHED',missingnessReasons:Object.fromEntries([...new Set(rows.map(r=>r.missingness_reason??'unrecorded'))].map(reason=>[reason,rows.filter(r=>(r.missingness_reason??'unrecorded')===reason).length]))},
    conditions:{informed,blind_retry:blind},
    repairDifferencePercentagePoints:informed.primary.rate===null||blind.primary.rate===null?null:100*(informed.primary.rate-blind.primary.rate),
    repairSignal:eligible<40?'INSUFFICIENT':'SYNTHETIC ONLY',
    byScene:[...new Set(retained.map(r=>r.scene_id))].map(scene=>({scene,conditions:conditionsFor(retained.filter(r=>r.scene_id===scene))})),
    byCategory:['physical','social','unknown'].map(category=>({category,conditions:conditionsFor(retained.filter(r=>(r.target_category??'unknown')===category))})),
    carryover:['early','late'].map(period=>({period,conditions:conditionsFor(retained.filter(r=>(Number(r.round_index)<=4?'early':'late')===period))})),
    participantDistributions:[...new Set(retained.map(r=>r.participant_id))].map(participant=>({participant,conditions:conditionsFor(retained.filter(r=>r.participant_id===participant))})),
    optionalContinuation:{offerObserved:offers.length,notOffered:offers.filter(r=>r.optional_extra_offered===false).length,offered:offered.length,
      accepted:{count:accepted.length,denominator:offered.length,unknown:offered.filter(r=>r.optional_extra_accepted===null).length},
      started:{count:started.length,denominator:accepted.length,unknown:accepted.filter(r=>r.optional_extra_started===null).length},
      completed:{count:started.filter(r=>r.optional_extra_completed===true).length,denominator:started.length,unknown:started.filter(r=>r.optional_extra_completed===null).length}},
    experience:{delight:{observed:delight.length,missing:rows.length-delight.length,median:median(delight)},declaredInterest:{yes:declared.filter(r=>r.would_play_again===true).length,observed:declared.length,notRecorded:rows.length-declared.length}},
    latency:latency(rows),
    failures:Object.fromEntries([...new Set(rows.map(r=>r.failure_category??'none_or_unrecorded'))].map(reason=>[reason,rows.filter(r=>(r.failure_category??'none_or_unrecorded')===reason).length])),
    resources:{providerCalls:rows.reduce((sum,r)=>sum+Number(r.provider_calls),0),knownCostSubtotal:rows.reduce((sum,r)=>sum+Number(r.estimated_cost),0),unknownCostRows:rows.filter(r=>r.estimated_cost===null).length},
    qualityFlags:[...new Set(flags)],
  };
}
