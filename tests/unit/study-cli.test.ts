import { afterEach, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StudyService } from '../../src/server/study/service.js';
import { listScenes } from '../../src/server/operator/sceneBank.js';
import type { RatingImport, StudyScene } from '../../src/server/study/contracts.js';

const scratch=join(process.cwd(),'.scratch'),directories:string[]=[];
afterEach(()=>{for(const directory of directories.splice(0))rmSync(directory,{recursive:true,force:true});});
function directory(){mkdirSync(scratch,{recursive:true});const dir=mkdtempSync(join(scratch,'study-cli-'));directories.push(dir);return dir;}
function cli(dir:string,script:'study:import-ratings'|'study:lock-first',args:string[]){
  const result=spawnSync(process.execPath,[process.env.npm_execpath!,'run','--silent',script,'--',...args],{cwd:process.cwd(),env:{...process.env,TM_DATA_DIR:dir},encoding:'utf8',timeout:20000});
  expect(result.error).toBeUndefined();expect(result.stderr).toBe('');
  return {exit:result.status,receipt:JSON.parse(result.stdout.trim())};
}
function rehearsal(dir:string,schedule:'synthetic_short_v1'|'synthetic_full_v1'){
  const file=join(dir,'fixture-rehearsals.sqlite'),db=new Database(file);
  const physical=new Set(['TM02','TM03','TM05','TM06']);
  const catalogue:StudyScene[]=listScenes().map(s=>({sceneId:s.id,meaning:s.meaning,rubric:s.meaning.targetRubric,scoreHash:s.scoreHash,score:s.score,category:physical.has(s.id)?'physical':'social',authoringMethod:s.authorship.authoringMethod,humanReview:s.authorship.humanReview}));
  const service=new StudyService(db,{catalogue}),session=service.createRehearsal('fixture-owner',{requestId:randomUUID(),fixtureScheduleId:schedule});
  let studyRunId='';
  for(let i=0;i<(schedule==='synthetic_short_v1'?3:10);i++){
    const plan=service.nextRound('fixture-owner',session.studySessionId),roundId=randomUUID();studyRunId=plan.studyRunId;
    service.attachRound('fixture-owner',session.studySessionId,roundId,plan);
    service.recordRound(roundId,{guess1:'Synthetic first response, not participant data'});
    service.assignAfterFirstGuess('fixture-owner',session.studySessionId,roundId);
    service.recordRound(roundId,{guess2:'Synthetic second response, not participant data',terminal:true,row:{provider_calls:0,second_source_kind:'mock_fixture'}});
    service.finishRound(roundId);
  }
  service.sessionFeedback('fixture-owner',session.studySessionId,{requestId:randomUUID(),wouldPlayAgain:null,optionalExtraAccepted:false});
  expect(()=>service.createExport('fixture-owner',{requestId:randomUUID(),studyRunId,format:'coder_second_csv'})).toThrow();
  const paths=['coder_aaaaaaaa','coder_bbbbbbbb'].map(coderId=>{
    const exported=service.createExport('fixture-owner',{requestId:randomUUID(),studyRunId,format:'coder_first_csv'});
    expect(exported.filename).toMatch(/^synthetic-/);
    const csv=service.downloadExport('fixture-owner',exported.exportId).bytes.toString();
    expect(csv.split('\r\n')[0]).toBe('rowId,rubric,guess');
    const input:RatingImport={version:1,studyRunId,kind:'recognition_first',role:'independent',coderId,rows:csv.split('\r\n').slice(1).filter(Boolean).map(row=>({rowId:row.split(',')[0]!,rating:1,missingReason:null}))};
    const path=join(dir,coderId+'.json');writeFileSync(path,JSON.stringify(input));return {path,input};
  });
  expect(paths[0]!.input.rows.every(row=>!paths[1]!.input.rows.some(other=>other.rowId===row.rowId))).toBe(true);
  expect(db.prepare('SELECT count(*) n FROM study_sessions').get()).toEqual({n:0});
  expect(db.prepare('SELECT count(*) n FROM study_rounds').get()).toEqual({n:0});db.close();
  return {file,studyRunId,paths,count:schedule==='synthetic_short_v1'?3:10};
}

it.each(['synthetic_short_v1','synthetic_full_v1'] as const)('imports two masked coder files and locks %s across actual CLI processes',schedule=>{
  const dir=directory(),fixture=rehearsal(dir,schedule);
  expect(cli(dir,'study:lock-first',['--fixture',fixture.studyRunId])).toEqual({exit:1,receipt:{status:'error',code:'UNAVAILABLE'}});
  for(const {path} of fixture.paths)expect(cli(dir,'study:import-ratings',['--fixture',path])).toEqual({exit:0,receipt:{status:'imported',imported:fixture.count,duplicates:0}});
  expect(cli(dir,'study:import-ratings',['--fixture',fixture.paths[0]!.path])).toEqual({exit:0,receipt:{status:'imported',imported:0,duplicates:fixture.count}});
  const locked=cli(dir,'study:lock-first',['--fixture',fixture.studyRunId]);expect(locked.exit).toBe(0);expect(locked.receipt).toMatchObject({status:'locked',studyRunId:fixture.studyRunId});
  const db=new Database(fixture.file);
  try {
    const service=new StudyService(db),exported=service.createExport('new-process-owner',{requestId:randomUUID(),studyRunId:fixture.studyRunId,format:'coder_second_csv'});
    expect(service.downloadExport('new-process-owner',exported.exportId).bytes.toString().split('\r\n').filter(Boolean)).toHaveLength(fixture.count+1);
    expect(db.prepare('SELECT count(*) n FROM study_ratings').get()).toEqual({n:fixture.count*2});
    expect(db.prepare('SELECT count(*) n FROM study_sessions').get()).toEqual({n:0});expect(db.prepare('SELECT count(*) n FROM study_rounds').get()).toEqual({n:0});
  }finally{db.close();}
},45000);

it('rejects a missing fixture database, wrong run, wrong masked row and synthetic use of the default ledger',()=>{
  const dir=directory();expect(cli(dir,'study:lock-first',['--fixture',randomUUID()])).toEqual({exit:1,receipt:{status:'error',code:'UNAVAILABLE'}});
  const fixture=rehearsal(dir,'synthetic_short_v1');
  expect(cli(dir,'study:lock-first',['--fixture',randomUUID()])).toEqual({exit:1,receipt:{status:'error',code:'NOT_FOUND'}});
  const wrong=join(dir,'wrong.json');writeFileSync(wrong,JSON.stringify({...fixture.paths[0]!.input,rows:[{rowId:randomUUID(),rating:1,missingReason:null}]}));
  expect(cli(dir,'study:import-ratings',['--fixture',wrong])).toEqual({exit:1,receipt:{status:'error',code:'NOT_FOUND'}});
  writeFileSync(wrong,JSON.stringify({...fixture.paths[0]!.input,studyRunId:randomUUID()}));
  expect(cli(dir,'study:import-ratings',['--fixture',wrong])).toEqual({exit:1,receipt:{status:'error',code:'NOT_FOUND'}});
  copyFileSync(fixture.file,join(dir,'research.sqlite'));
  expect(cli(dir,'study:import-ratings',[fixture.paths[0]!.path])).toEqual({exit:1,receipt:{status:'error',code:'FORBIDDEN'}});
  expect(cli(dir,'study:lock-first',[fixture.studyRunId])).toEqual({exit:1,receipt:{status:'error',code:'FORBIDDEN'}});
  expect(cli(dir,'study:import-ratings',['--read-run',fixture.studyRunId])).toEqual({exit:1,receipt:{status:'error',code:'FORBIDDEN'}});
},45000);

it.each(['approved_run','research_round','research_coder_row'] as const)('refuses a fixture ledger containing %s before any import',contamination=>{
  const dir=directory(),fixture=rehearsal(dir,'synthetic_short_v1'),db=new Database(fixture.file);
  if(contamination==='approved_run')db.prepare("UPDATE study_runs SET manifest=json_set(manifest,'$.status','approved') WHERE id=?").run(fixture.studyRunId);
  else if(contamination==='research_round')db.prepare('INSERT INTO study_rounds VALUES (?,?,?)').run(randomUUID(),randomUUID(),'{}');
  else db.prepare('INSERT INTO study_coder_rows VALUES (?,?,?,?,?)').run(randomUUID(),fixture.studyRunId,randomUUID(),'recognition_first','study');
  db.close();
  expect(cli(dir,'study:import-ratings',['--fixture',fixture.paths[0]!.path])).toEqual({exit:1,receipt:{status:'error',code:'FORBIDDEN'}});
  expect(cli(dir,'study:lock-first',['--fixture',fixture.studyRunId])).toEqual({exit:1,receipt:{status:'error',code:'FORBIDDEN'}});
  const readback=new Database(fixture.file);try{expect(readback.prepare('SELECT count(*) n FROM study_ratings').get()).toEqual({n:0});expect(readback.prepare('SELECT count(*) n FROM study_first_locks').get()).toEqual({n:0});}finally{readback.close();}
},45000);

function privateDirectory(){const dir=mkdtempSync(join(tmpdir(),'tiny-mime-study-cli-'));directories.push(dir);return dir;}
function freezeInputs(dir:string){
  const categories=Object.fromEntries(listScenes().map(scene=>[scene.id,'social']));
  const catalogue:StudyScene[]=listScenes().map(scene=>({sceneId:scene.id,meaning:scene.meaning,rubric:scene.meaning.targetRubric,scoreHash:scene.scoreHash,score:scene.score,category:'social',authoringMethod:scene.authorship.authoringMethod,humanReview:scene.authorship.humanReview}));
  const memory=new Database(':memory:'),service=new StudyService(memory,{catalogue});
  const manifest={version:1,studyRunId:randomUUID(),protocolVersion:'bootstrap-software-test-only',consentVersion:'software-test-consent',providerDisclosureVersion:'software-test-disclosure',status:'approved',bankApproval:null,allowOptionalExtra:false,optionalExtraSceneIds:[],schedules:[{scheduleId:randomUUID(),rounds:[{sceneId:'TM01',phase:'formative',generationProfile:'practice_blind_v1',allocation:null}]}],retention:{rawDays:7,optionalResultDays:30,operationalHours:24}};
  const binding={protocolVersion:manifest.protocolVersion,modelVersion:'software-test-model-never-called',promptVersion:'software-test-prompt',rendererVersion:'software-test-renderer',contactPolicyVersion:'noncontact-v1',catalogueHash:service.catalogueHash(),scoreHashes:[{sceneId:'TM01',scoreHash:catalogue.find(scene=>scene.sceneId==='TM01')!.scoreHash}],operatorContact:'Software test only. No operator or participants.',providerDisclosureVersion:manifest.providerDisclosureVersion};
  const evidence={phaseApprovalRecordId:randomUUID(),approvedPhases:['formative'],providerApprovalRecordId:randomUUID(),consentApproved:true,providerRetentionVerified:true,deletionOwnerConfirmed:true,codingWorkloadApproved:true,calibrationRecords:[]};
  memory.close();
  const files=[manifest,binding,evidence,categories].map((value,index)=>{const file=join(dir,'freeze-'+index+'.json');writeFileSync(file,JSON.stringify(value));return file;});
  return {manifest,binding,evidence,files};
}

it('freezes the first approved run into a fresh private ledger without starting a provider or enrolling anyone',()=>{
  const dir=privateDirectory(),input=freezeInputs(dir),data=join(dir,'new-private-directory');
  expect(existsSync(data)).toBe(false);
  const frozen=cli(data,'study:import-ratings',['--freeze',...input.files]);
  expect(frozen.exit).toBe(0);expect(frozen.receipt).toMatchObject({status:'frozen',studyRunId:input.manifest.studyRunId,frozenHash:expect.stringMatching(/^[0-9a-f]{64}$/)});
  expect(statSync(data).mode&0o777).toBe(0o700);expect(statSync(join(data,'research.sqlite')).mode&0o777).toBe(0o600);
  expect(existsSync(join(data,'fixture-rehearsals.sqlite'))).toBe(false);
  const readback=cli(data,'study:import-ratings',['--read-run',input.manifest.studyRunId]);
  expect(readback.exit).toBe(0);expect(readback.receipt).toMatchObject({status:'readback',manifest:input.manifest,binding:input.binding,frozenHash:frozen.receipt.frozenHash});
  expect(cli(data,'study:import-ratings',['--freeze',...input.files])).toEqual(frozen);
  const db=new Database(join(data,'research.sqlite'));
  try {expect(db.prepare('SELECT count(*) n FROM study_runs').get()).toEqual({n:1});expect(db.prepare('SELECT count(*) n FROM study_sessions').get()).toEqual({n:0});expect(db.prepare('SELECT count(*) n FROM study_rounds').get()).toEqual({n:0});expect(db.prepare('SELECT count(*) n FROM fixture_sessions').get()).toEqual({n:0});}finally{db.close();}
  writeFileSync(input.files[1]!,JSON.stringify({...input.binding,promptVersion:'changed-test-prompt'}));
  expect(cli(data,'study:import-ratings',['--freeze',...input.files])).toEqual({exit:1,receipt:{status:'error',code:'IDEMPOTENCY_CONFLICT'}});
  expect(cli(data,'study:import-ratings',['--read-run',input.manifest.studyRunId])).toEqual(readback);
},45000);

it('does not bootstrap a missing ledger for a read, rating import, fixture freeze or malformed freeze invocation',()=>{
  const dir=privateDirectory(),input=freezeInputs(dir);
  for(const args of [['--read-run',input.manifest.studyRunId],[input.files[0]!],['--fixture','--freeze',...input.files],['--freeze',...input.files.slice(0,3)]]){
    const data=join(dir,randomUUID());expect(cli(data,'study:import-ratings',args).exit).toBe(1);expect(existsSync(data)).toBe(false);
  }
},45000);

it('rejects missing approval evidence when freezing a first run',()=>{
  const dir=privateDirectory(),input=freezeInputs(dir),data=join(dir,'rejected-private-directory');
  writeFileSync(input.files[2]!,JSON.stringify({...input.evidence,consentApproved:false}));
  expect(cli(data,'study:import-ratings',['--freeze',...input.files])).toEqual({exit:1,receipt:{status:'error',code:'INVALID_INPUT'}});
  if(existsSync(join(data,'research.sqlite'))){const db=new Database(join(data,'research.sqlite'));try{expect(db.prepare('SELECT count(*) n FROM study_runs').get()).toEqual({n:0});expect(db.prepare('SELECT count(*) n FROM study_sessions').get()).toEqual({n:0});}finally{db.close();}}
},45000);

it('refuses bootstrap in the application directory or its descendants without changing permissions or creating records',()=>{
  const dir=privateDirectory(),input=freezeInputs(dir),child=directory();
  for(const data of [process.cwd(),child]){
    const mode=statSync(data).mode,existing=existsSync(join(data,'research.sqlite'));
    expect(cli(data,'study:import-ratings',['--freeze',...input.files])).toEqual({exit:1,receipt:{status:'error',code:'UNAVAILABLE'}});
    expect(statSync(data).mode).toBe(mode);expect(existsSync(join(data,'research.sqlite'))).toBe(existing);
  }
},45000);
