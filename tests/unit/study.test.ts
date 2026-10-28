import {testCatalogue} from '../../fixtures/study/testCatalogue.js';
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { StudyService, StudyError } from '../../src/server/study/service.js';
import { syntheticRun, balancedSchedules, validateSchedules } from '../../src/server/study/schedules.js';
import { randomUUID } from 'node:crypto';

describe('study', () => {
  it('finishes an accepted unstarted extra without rewriting the saved choice or retry effects', () => {
    const db=new Database(':memory:'),service=new StudyService(db,{catalogue:testCatalogue()});
    const session=service.createRehearsal('owner',{requestId:randomUUID(),fixtureScheduleId:'synthetic_short_v1'}),id=session.studySessionId;
    const finish={requestId:randomUUID()};
    expect(service.progress('owner',id).feedbackSaved).toBe(false);
    expect(()=>service.finish('foreign',id,finish)).toThrow('NOT_FOUND'); expect(()=>service.finish('owner',randomUUID(),finish)).toThrow('NOT_FOUND');
    expect(()=>service.finish('owner',id,{...finish,unexpected:true} as never)).toThrow('INVALID_INPUT');
    expect(()=>service.finish('owner',id,finish)).toThrow('UNAVAILABLE');
    let final='';
    for(let i=0;i<3;i++){const plan=service.nextRound('owner',id),round=randomUUID();final=round;service.attachRound('owner',id,round,plan);expect(()=>service.finish('owner',id,finish)).toThrow('ACTIVE_ROUND');service.recordRound(round,{terminal:true});service.finishRound(round);}
    expect(()=>service.finish('owner',id,finish)).toThrow('UNAVAILABLE');
    const feedback={requestId:randomUUID(),wouldPlayAgain:true,optionalExtraAccepted:true};service.sessionFeedback('owner',id,feedback);
    expect(service.progress('owner',id)).toMatchObject({feedbackSaved:true,phase:'optional_extra',nextRoundAvailable:true});
    expect(()=>service.finish('owner',id,{requestId:feedback.requestId})).toThrow('IDEMPOTENCY_CONFLICT');
    expect(service.finish('owner',id,finish)).toEqual({saved:true});
    const raw=()=>JSON.parse((db.prepare('SELECT data FROM fixture_rounds WHERE id=?').get(final) as {data:string}).data).row;
    expect(raw()).toMatchObject({would_play_again:true,optional_extra_accepted:true,optional_extra_started:false,optional_extra_completed:false});
    expect(db.prepare('SELECT completion_state FROM fixture_sessions WHERE id=?').get(id)).toEqual({completion_state:'closed'});
    expect(service.progress('owner',id)).toMatchObject({feedbackSaved:true,phase:'complete',nextRoundAvailable:false});
    const changes=db.prepare('SELECT total_changes() n').get();
    expect(service.finish('owner',id,finish)).toEqual({saved:true});expect(service.finish('owner',id,{requestId:randomUUID()})).toEqual({saved:true});
    expect(db.prepare('SELECT total_changes() n').get()).toEqual(changes);
    expect(()=>service.nextRound('owner',id)).toThrow('UNAVAILABLE');expect(()=>service.attachRound('owner',id,randomUUID(),{} as never)).toThrow('UNAVAILABLE');
    expect(()=>service.sessionFeedback('owner',id,{...feedback,requestId:randomUUID(),wouldPlayAgain:false})).toThrow('UNAVAILABLE');expect(raw().would_play_again).toBe(true);db.close();
  });
  it('rejects finish during an active extra and retains completed extra observations', () => {
    const db=new Database(':memory:'),service=new StudyService(db,{catalogue:testCatalogue()});const id=service.createRehearsal('owner',{requestId:randomUUID(),fixtureScheduleId:'synthetic_short_v1'}).studySessionId;
    let final='';for(let i=0;i<3;i++){const plan=service.nextRound('owner',id),round=randomUUID();final=round;service.attachRound('owner',id,round,plan);service.recordRound(round,{terminal:true});service.finishRound(round);}
    service.sessionFeedback('owner',id,{requestId:randomUUID(),wouldPlayAgain:null,optionalExtraAccepted:true});
    const extra=randomUUID();service.attachRound('owner',id,extra,service.nextRound('owner',id));expect(()=>service.finish('owner',id,{requestId:randomUUID()})).toThrow('ACTIVE_ROUND');
    for(const attempt of [1,2]){const playId=randomUUID();service.recordEvent(extra,{eventId:randomUUID(),name:'play_started',attempt,playId,playbackMode:'motion'});service.recordEvent(extra,{eventId:randomUUID(),name:'play_completed',attempt,playId});}
    service.recordRound(extra,{guess1:'first synthetic answer',guess2:'second synthetic answer',terminal:true,normalCompletion:true});service.finishRound(extra);
    const before=(db.prepare('SELECT data FROM fixture_rounds WHERE id=?').get(final) as {data:string}).data;service.finish('owner',id,{requestId:randomUUID()});
    expect((db.prepare('SELECT data FROM fixture_rounds WHERE id=?').get(final) as {data:string}).data).toBe(before);
    expect(JSON.parse(before).row).toMatchObject({optional_extra_accepted:true,optional_extra_started:true,optional_extra_completed:true});expect(service.progress('owner',id).feedbackSaved).toBe(true);db.close();
  });
  it('isolates fixture rehearsals and conceals allocation until accepted guess', () => {
    const db = new Database(':memory:'); const service = new StudyService(db,{catalogue:testCatalogue()});
    const session = service.createRehearsal('owner', {requestId:randomUUID(),fixtureScheduleId:'synthetic_full_v1'});
    expect(JSON.stringify(service.progress('owner',session.studySessionId))).not.toMatch(/TM01|blind_retry|scheduleId/);
    const plan = service.nextRound('owner',session.studySessionId);
    expect(plan).toMatchObject({sceneId:'TM01',phase:'practice',generationProfile:'practice_blind_v1'});
    const roundId = randomUUID(); service.attachRound('owner',session.studySessionId,roundId,plan);
    service.recordRound(roundId,{guess1:'Synthetic first guess'});expect(service.assignAfterFirstGuess('owner',session.studySessionId,roundId).condition).toBeNull();
    expect(db.prepare('SELECT count(*) AS n FROM study_sessions').get()).toEqual({n:0});
    expect(db.prepare('SELECT count(*) AS n FROM fixture_sessions').get()).toEqual({n:1});
    expect(() => service.progress('foreign',session.studySessionId)).toThrow(StudyError); db.close();
  });
  it('counterbalances 24 schedules and blocks unqualified live activation', () => {
    const schedules=balancedSchedules(); validateSchedules(schedules, undefined, true);
    for (const scene of ['TM02','TM03','TM05','TM06','TM08','TM10','TM11','TM12']) {
      expect(schedules.flatMap(s=>s.rounds).filter(r=>r.sceneId===scene&&r.allocation==='informed')).toHaveLength(12);
    }
    const service=new StudyService(new Database(':memory:'));
    expect(() => service.freezeRun({...syntheticRun('synthetic_full_v1'),status:'approved'}, {} as never, {} as never)).toThrow();
  });
});

it('completion consumes targets once and keeps declared interest distinct from observed extra playback',()=>{
  const db=new Database(':memory:'),service=new StudyService(db,{catalogue:testCatalogue()});const s=service.createRehearsal('owner',{requestId:randomUUID(),fixtureScheduleId:'synthetic_short_v1'});let run='';for(let i=0;i<3;i++){const plan=service.nextRound('owner',s.studySessionId);run=plan.studyRunId;const id=randomUUID();service.attachRound('owner',s.studySessionId,id,plan);service.recordRound(id,{guess1:'synthetic response',guess2:'synthetic second response',terminal:true});service.finishRound(id);}expect(service.progress('owner',s.studySessionId)).toMatchObject({phase:'complete',nextRoundAvailable:false,optionalExtraOffered:true});service.sessionFeedback('owner',s.studySessionId,{requestId:randomUUID(),wouldPlayAgain:true,optionalExtraAccepted:true});const extra=service.nextRound('owner',s.studySessionId);expect(extra.phase).toBe('optional_extra');const id=randomUUID();service.attachRound('owner',s.studySessionId,id,extra);const raw=()=>JSON.parse((db.prepare("SELECT data FROM fixture_rounds WHERE json_extract(data,'$.row.optional_extra_round_id')=?").get(id) as {data:string}).data).row;expect(raw()).toMatchObject({would_play_again:true,optional_extra_accepted:true,optional_extra_started:false,optional_extra_completed:null});service.recordEvent(id,{eventId:randomUUID(),name:'play_started',attempt:1,playId:randomUUID(),playbackMode:'motion'});expect(raw().optional_extra_started).toBe(true);service.recordRound(id,{terminal:true,normalCompletion:false});service.finishRound(id);expect(raw().optional_extra_completed).toBe(false);expect(()=>service.nextRound('owner',s.studySessionId)).toThrow();expect(service.readRun(run).manifest.status).toBe('draft');db.close();
});

it('permits separately approved formative collection without comparative calibration and rejects changed freeze inputs',()=>{
  const db=new Database(':memory:');const scene={sceneId:'TM01',meaning:{sceneId:'TM01',meaningId:'TM01.meaning.1',revision:1},rubric:{version:'rubric-v1'},scoreHash:'a'.repeat(64),score:{},category:'physical' as const,authoringMethod:'agent_assisted' as const,humanReview:'reviewed' as const};const q={enabled:true,budgetApproved:true,providerDisclosureVersion:'disclosure-v1',modelVersion:'operator-selected-test-model',promptVersion:'prompt-v1',rendererVersion:'renderer-v1',contactPolicyVersion:'noncontact-v1' as const};const service=new StudyService(db,{catalogue:[scene],liveQualification:()=>q});const run={...syntheticRun('synthetic_full_v1'),status:'approved' as const,allowOptionalExtra:false,optionalExtraSceneIds:[],consentVersion:'consent-v1',providerDisclosureVersion:'disclosure-v1',protocolVersion:'formative-test-only',schedules:[{scheduleId:randomUUID(),rounds:[{sceneId:'TM01',phase:'formative' as const,generationProfile:'practice_blind_v1' as const,allocation:null}]}]};const binding={protocolVersion:run.protocolVersion,modelVersion:q.modelVersion,promptVersion:q.promptVersion,rendererVersion:'renderer-v1',contactPolicyVersion:'noncontact-v1' as const,catalogueHash:service.catalogueHash(),scoreHashes:[{sceneId:scene.sceneId,scoreHash:scene.scoreHash}],operatorContact:'test contact, not a real study',providerDisclosureVersion:q.providerDisclosureVersion};const evidence={phaseApprovalRecordId:randomUUID(),approvedPhases:['formative' as const],providerApprovalRecordId:randomUUID(),consentApproved:true,providerRetentionVerified:true,deletionOwnerConfirmed:true,codingWorkloadApproved:true,calibrationRecords:[]};const freeze=service.freezeRun(run,binding,evidence);expect(service.readRun(run.studyRunId).frozenHash).toBe(freeze.frozenHash);expect(()=>service.freezeRun(run,{...binding,promptVersion:'changed'},evidence)).toThrow();const input={requestId:randomUUID(),studyRunId:run.studyRunId,consentVersion:run.consentVersion,adultConfirmed:true as const,participationConsent:true as const,rawResearchConsent:true as const,providerTransmissionConsent:true as const,retainResults30Days:false,publicationConsent:false};expect(()=>service.start('declined',{...input,rawResearchConsent:false} as never)).toThrow();const session=service.start('owner',input);expect(service.start('owner',input)).toEqual(session);expect(session).toMatchObject({phase:'formative',executionMode:'live'});expect(db.prepare('SELECT count(*) n FROM study_sessions').get()).toEqual({n:1});q.modelVersion='changed';expect(()=>service.start('other',{...input,requestId:randomUUID()})).toThrow();db.close();
});
it('balances category assignments supplied by an approved protocol rather than scene index assumptions',()=>{const categories=new Map([['TM02','social'],['TM03','physical'],['TM05','physical'],['TM06','social'],['TM08','social'],['TM10','physical'],['TM11','social'],['TM12','physical']]);validateSchedules(balancedSchedules(categories),categories,true);});
it('S02 completes the full synthetic schedule with zero real research records and exact analyst header',()=>{const db=new Database(':memory:'),service=new StudyService(db,{catalogue:testCatalogue()});const session=service.createRehearsal('owner',{requestId:randomUUID(),fixtureScheduleId:'synthetic_full_v1'});const seen:string[]=[];let runId='';for(let i=0;i<10;i++){const plan=service.nextRound('owner',session.studySessionId),round=randomUUID();seen.push(plan.sceneId);runId=plan.studyRunId;service.attachRound('owner',session.studySessionId,round,plan);service.recordRound(round,{guess1:'synthetic, not human',guess2:'synthetic, not human'});const assigned=service.assignAfterFirstGuess('owner',session.studySessionId,round);expect(assigned.randomized).toBe(i>=2);service.recordRound(round,{terminal:true,row:{provider_calls:0,second_source_kind:'mock_fixture'}});service.finishRound(round);}expect(new Set(seen).size).toBe(10);expect(db.prepare('SELECT count(*) n FROM study_rounds').get()).toEqual({n:0});const result=service.createExport('owner',{requestId:randomUUID(),studyRunId:runId,format:'analyst_csv'}),text=service.downloadExport('owner',result.exportId).bytes.toString();expect(text.split('\r\n')[0]!.split(',')).toHaveLength(96);expect(text.split('\r\n').filter(Boolean)).toHaveLength(11);expect(text).toContain('synthetic_full_v1');db.close();});

import {readFileSync} from 'node:fs';
import {validateContract} from '../../src/server/study/contracts.js';
it('S02 consumes frozen synthetic manifests as software fixtures without observations',()=>{for(const fixture of ['synthetic_short_v1','synthetic_full_v1']){const record=JSON.parse(readFileSync(new URL(`../../fixtures/study/${fixture}.json`,import.meta.url),'utf8'));expect(record.synthetic).toBe(true);expect(record.empiricalQualification).toBe('NOT RUN');validateContract('run',record.manifest);if(fixture==='synthetic_full_v1')validateSchedules(record.manifest.schedules,undefined,true);expect(record.manifest.status).toBe('draft');expect(record.manifest.bankApproval).toBeNull();}});

it('freezes optional scene scores, categories and rubrics and blocks catalogue drift at next/attach',()=>{
  const db=new Database(':memory:'),catalogue=testCatalogue(),service=new StudyService(db,{catalogue});
  const session=service.createRehearsal('owner',{requestId:randomUUID(),fixtureScheduleId:'synthetic_short_v1'}),plan=service.nextRound('owner',session.studySessionId);
  const snapshot=service.readRun(plan.studyRunId).sceneSnapshot;expect(snapshot.map(s=>s.sceneId)).toContain('TM04');expect(snapshot.find(s=>s.sceneId==='TM01')!.category).toBe(catalogue[0]!.category);
  const oldRubric=JSON.stringify(catalogue[0]!.rubric);(catalogue[0]!.rubric as {complete:string}).complete='changed outside the meaning record';
  expect(()=>service.nextRound('owner',session.studySessionId)).toThrow();expect(()=>service.attachRound('owner',session.studySessionId,randomUUID(),plan)).toThrow();
  expect(service.readRun(plan.studyRunId).sceneSnapshot[0]!.rubric).toEqual(JSON.parse(oldRubric));
  catalogue[0]!.rubric=JSON.parse(oldRubric);catalogue[0]!.category='social';expect(()=>service.nextRound('owner',session.studySessionId)).toThrow();
  catalogue[0]!.category=snapshot.find(s=>s.sceneId==='TM01')!.category;catalogue.find(s=>s.sceneId==='TM04')!.score={changed:true};expect(()=>service.nextRound('owner',session.studySessionId)).toThrow();db.close();
});

it('comparative rows receive calibration IDs from the frozen evidence rather than mutable scene properties',()=>{
  const db=new Database(':memory:'),catalogue=testCatalogue();
  const q={enabled:true,budgetApproved:true,providerDisclosureVersion:'disclosure-test',modelVersion:'test-model-never-called',promptVersion:'prompt-test',rendererVersion:'renderer-test',contactPolicyVersion:'noncontact-v1' as const};
  const service=new StudyService(db,{catalogue,liveQualification:()=>q});
  const calibrationRecords=['TM02','TM03','TM05','TM06','TM08','TM10','TM11','TM12'].map(sceneId=>({recordId:randomUUID(),sceneId,scoreHash:catalogue.find(s=>s.sceneId===sceneId)!.scoreHash,cohortId:randomUUID(),decision:'approved' as const,humanReviewed:true as const}));
  const run={...syntheticRun('synthetic_full_v1'),status:'approved' as const,protocolVersion:'comparative-software-test-only',providerDisclosureVersion:q.providerDisclosureVersion,allowOptionalExtra:false,optionalExtraSceneIds:[],schedules:balancedSchedules(new Map(catalogue.map(s=>[s.sceneId,s.category]))),bankApproval:{approvalRecordId:randomUUID(),approvedAt:'2026-10-08T00:00:00.000Z',calibrationRecordIds:calibrationRecords.map(r=>r.recordId),meaningCatalogueHash:service.catalogueHash(),firstScoreHashes:calibrationRecords.map(r=>({sceneId:r.sceneId,scoreHash:r.scoreHash}))}};
  const binding={protocolVersion:run.protocolVersion,modelVersion:q.modelVersion,promptVersion:q.promptVersion,rendererVersion:q.rendererVersion,contactPolicyVersion:q.contactPolicyVersion,catalogueHash:service.catalogueHash(),scoreHashes:catalogue.map(s=>({sceneId:s.sceneId,scoreHash:s.scoreHash})),operatorContact:'synthetic test contact',providerDisclosureVersion:q.providerDisclosureVersion};
  const evidence={phaseApprovalRecordId:randomUUID(),approvedPhases:['comparative' as const],providerApprovalRecordId:randomUUID(),consentApproved:true,providerRetentionVerified:true,deletionOwnerConfirmed:true,codingWorkloadApproved:true,calibrationRecords};
  service.freezeRun(run,binding,evidence);
  const session=service.start('owner',{requestId:randomUUID(),studyRunId:run.studyRunId,consentVersion:run.consentVersion,adultConfirmed:true,participationConsent:true,rawResearchConsent:true,providerTransmissionConsent:true,retainResults30Days:false,publicationConsent:false});
  for(let i=0;i<2;i++){const p=service.nextRound('owner',session.studySessionId),id=randomUUID();service.attachRound('owner',session.studySessionId,id,p);service.recordRound(id,{terminal:true});service.finishRound(id);}
  const plan=service.nextRound('owner',session.studySessionId),round=randomUUID();expect(plan.phase).toBe('comparative');service.attachRound('owner',session.studySessionId,round,plan);
  const record=JSON.parse((db.prepare('SELECT data FROM study_rounds WHERE id=?').get(round) as {data:string}).data);
  expect(record.row.bank_calibration_record_id).toBe(calibrationRecords.find(r=>r.sceneId===plan.sceneId)!.recordId);
  const scene=catalogue.find(s=>s.sceneId===plan.sceneId)!;scene.category=scene.category==='physical'?'social':'physical';expect(()=>service.start('other',{requestId:randomUUID(),studyRunId:run.studyRunId,consentVersion:run.consentVersion,adultConfirmed:true,participationConsent:true,rawResearchConsent:true,providerTransmissionConsent:true,retainResults30Days:false,publicationConsent:false})).toThrow();
  expect(()=>service.freezeRun(run,binding,evidence)).toThrow();db.close();
});

function optionalStudyFixture(){
  let now=1000000;const db=new Database(':memory:'),catalogue=testCatalogue();
  const q={enabled:true,budgetApproved:true,providerDisclosureVersion:'disclosure-test',modelVersion:'test-model-never-called',promptVersion:'prompt-test',rendererVersion:'renderer-test',contactPolicyVersion:'noncontact-v1' as const};
  const service=new StudyService(db,{catalogue,liveQualification:()=>q,now:()=>now});
  const run={...syntheticRun('synthetic_full_v1'),status:'approved' as const,protocolVersion:'optional-software-test-only',providerDisclosureVersion:q.providerDisclosureVersion,schedules:[{scheduleId:randomUUID(),rounds:[{sceneId:'TM01',phase:'formative' as const,generationProfile:'practice_blind_v1' as const,allocation:null}]}]};
  const binding={protocolVersion:run.protocolVersion,modelVersion:q.modelVersion,promptVersion:q.promptVersion,rendererVersion:q.rendererVersion,contactPolicyVersion:q.contactPolicyVersion,catalogueHash:service.catalogueHash(),scoreHashes:catalogue.filter(s=>['TM01','TM04'].includes(s.sceneId)).map(s=>({sceneId:s.sceneId,scoreHash:s.scoreHash})),operatorContact:'synthetic test contact',providerDisclosureVersion:q.providerDisclosureVersion};
  const evidence={phaseApprovalRecordId:randomUUID(),approvedPhases:['formative' as const,'optional_extra' as const],providerApprovalRecordId:randomUUID(),consentApproved:true,providerRetentionVerified:true,deletionOwnerConfirmed:true,codingWorkloadApproved:true,calibrationRecords:[]};
  const freeze=()=>service.freezeRun(run,binding,evidence);
  const enroll=()=>service.start('owner',{requestId:randomUUID(),studyRunId:run.studyRunId,consentVersion:run.consentVersion,adultConfirmed:true,participationConsent:true,rawResearchConsent:true,providerTransmissionConsent:true,retainResults30Days:true,publicationConsent:false});
  return {db,catalogue,q,service,run,binding,evidence,freeze,enroll,advanceTime:(ms:number)=>{now+=ms;}};
}
it('real optional offer requires frozen held-out material, approved optional scope, active consent and provider budget',()=>{
  for(const scenario of ['disabled','budget','model-drift','extra-score-drift','raw-consent-expired'] as const){
    const fixture=optionalStudyFixture();fixture.freeze();const session=fixture.enroll(),plan=fixture.service.nextRound('owner',session.studySessionId),round=randomUUID();fixture.service.attachRound('owner',session.studySessionId,round,plan);
    if(scenario==='disabled')fixture.q.enabled=false;
    if(scenario==='budget')fixture.q.budgetApproved=false;
    if(scenario==='model-drift')fixture.q.modelVersion='changed';
    if(scenario==='extra-score-drift')fixture.catalogue.find(s=>s.sceneId==='TM04')!.score={changed:true};
    if(scenario==='raw-consent-expired')fixture.advanceTime(7*24*60*60*1000);
    fixture.service.recordRound(round,{terminal:true});fixture.service.finishRound(round);
    expect(fixture.service.progress('owner',session.studySessionId).optionalExtraOffered).toBe(false);
    expect(()=>fixture.service.sessionFeedback('owner',session.studySessionId,{requestId:randomUUID(),wouldPlayAgain:true,optionalExtraAccepted:true})).toThrow();fixture.db.close();
  }
  const missingScope=optionalStudyFixture();missingScope.evidence.approvedPhases=['formative'];expect(()=>missingScope.freeze()).toThrow();missingScope.db.close();
  const missingHash=optionalStudyFixture();missingHash.binding.scoreHashes=missingHash.binding.scoreHashes.filter(s=>s.sceneId!=='TM04');expect(()=>missingHash.freeze()).toThrow();missingHash.db.close();
});
it('an offered optional round cannot be accepted or started after frozen source or budget qualification changes',()=>{
  for(const scenario of ['rubric-drift','budget'] as const){
    const fixture=optionalStudyFixture();fixture.freeze();const session=fixture.enroll(),plan=fixture.service.nextRound('owner',session.studySessionId),round=randomUUID();fixture.service.attachRound('owner',session.studySessionId,round,plan);fixture.service.recordRound(round,{terminal:true});fixture.service.finishRound(round);expect(fixture.service.progress('owner',session.studySessionId).optionalExtraOffered).toBe(true);
    if(scenario==='rubric-drift')(fixture.catalogue.find(s=>s.sceneId==='TM04')!.rubric as {complete:string}).complete='changed';else fixture.q.budgetApproved=false;
    expect(()=>fixture.service.sessionFeedback('owner',session.studySessionId,{requestId:randomUUID(),wouldPlayAgain:true,optionalExtraAccepted:true})).toThrow();expect(()=>fixture.service.nextRound('owner',session.studySessionId)).toThrow();
    expect(fixture.db.prepare('SELECT count(*) n FROM study_rounds').get()).toEqual({n:1});fixture.db.close();
  }
});
it('migrates private run snapshots and persisted session completion without weakening legacy eligibility',()=>{
  const db=new Database(':memory:');db.exec("CREATE TABLE study_runs(id TEXT PRIMARY KEY,manifest TEXT NOT NULL,binding TEXT,evidence TEXT,frozen_hash TEXT NOT NULL); CREATE TABLE study_sessions(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,participant_id TEXT NOT NULL,schedule_id TEXT NOT NULL,consent_id TEXT NOT NULL,withdrawal_lookup TEXT NOT NULL,created_at INTEGER NOT NULL,retain_results INTEGER NOT NULL,publication_consent INTEGER NOT NULL)");
  new StudyService(db,{catalogue:testCatalogue()});expect((db.prepare('PRAGMA table_info(study_runs)').all() as {name:string}[]).map(c=>c.name)).toContain('scene_snapshot');expect((db.prepare('PRAGMA table_info(study_sessions)').all() as {name:string}[]).map(c=>c.name)).toEqual(expect.arrayContaining(['completion_state','current_index']));expect(db.pragma('secure_delete',{simple:true})).toBe(1);db.close();
});
