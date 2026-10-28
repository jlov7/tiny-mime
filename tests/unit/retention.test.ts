import {testCatalogue} from '../../fixtures/study/testCatalogue.js';
import {it,expect} from 'vitest';
import Database from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
import {StudyService} from '../../src/server/study/service.js';
import {RAW_MS,RESULT_MS} from '../../src/server/study/retention.js';
it('withdraws linked source, coder mapping, ratings and export caches',()=>{const db=new Database(':memory:'),service=new StudyService(db,{catalogue:testCatalogue()});const session=service.createRehearsal('owner',{requestId:randomUUID(),fixtureScheduleId:'synthetic_short_v1'}),plan=service.nextRound('owner',session.studySessionId),round=randomUUID();service.attachRound('owner',session.studySessionId,round,plan);service.recordRound(round,{guess1:'fixture only'});const exportResult=service.createExport('owner',{requestId:randomUUID(),studyRunId:plan.studyRunId,format:'coder_first_csv'});const code=service.progress('owner',session.studySessionId).withdrawalCode;expect(code).toMatch(/^[A-Z2-7]{26}$/);service.withdraw('otherOwner',randomUUID(),code);for(const table of ['fixture_sessions','fixture_rounds','study_coder_rows','study_exports','study_ratings'])expect(db.prepare(`SELECT count(*) n FROM ${table}`).get()).toEqual({n:0});expect(()=>service.downloadExport('owner',exportResult.exportId)).toThrow();db.close();});
it('raw expires at seven days even with opt-in; nonraw records expire at thirty',()=>{let now=1000000;const db=new Database(':memory:'),service=new StudyService(db,{now:()=>now,catalogue:testCatalogue()});const session=service.createRehearsal('owner',{requestId:randomUUID(),fixtureScheduleId:'synthetic_short_v1'}),plan=service.nextRound('owner',session.studySessionId),round=randomUUID();service.attachRound('owner',session.studySessionId,round,plan);service.recordRound(round,{guess1:'fixture text',terminal:true});db.prepare('UPDATE fixture_sessions SET retain_results=1').run();now+=RAW_MS;expect(service.sweep()).toEqual({rawPurged:1,sessionsPurged:0});const data=JSON.parse((db.prepare('SELECT data FROM fixture_rounds').get() as {data:string}).data);expect(data.raw).toBeUndefined();expect(data.row.response_record_id).toBeNull();expect(()=>service.createExport('owner',{requestId:randomUUID(),studyRunId:plan.studyRunId,format:'raw_responses_json'})).toThrow();now+=RESULT_MS-RAW_MS;expect(service.sweep()).toEqual({rawPurged:0,sessionsPurged:1});db.close();});

import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
it('secure deletion removes raw and export sentinels from serialized memory and database files',()=>{
  for(const action of ['withdrawal','raw-expiry'] as const)for(const fileBacked of [false,true]){
    const dir=mkdtempSync(join(process.cwd(),'.scratch/study-delete-')),filename=join(dir,'research.sqlite');
    let now=1000000;const db=new Database(fileBacked?filename:':memory:');db.pragma('journal_mode = DELETE');
    const notifications:{sessionId:string;roundIds:string[]}[]=[];
    const service=new StudyService(db,{now:()=>now,catalogue:testCatalogue(),onWithdrawal:(sessionId,roundIds)=>notifications.push({sessionId,roundIds})});
    expect(db.pragma('secure_delete',{simple:true})).toBe(1);
    const session=service.createRehearsal('owner',{requestId:randomUUID(),fixtureScheduleId:'synthetic_short_v1'}),plan=service.nextRound('owner',session.studySessionId),round=randomUUID();
    const sentinel='RAW_SENTINEL_'+randomUUID()+'_'+('x'.repeat(170));
    service.attachRound('owner',session.studySessionId,round,plan);service.recordRound(round,{guess1:sentinel});
    service.createExport('owner',{requestId:randomUUID(),studyRunId:plan.studyRunId,format:'raw_responses_json'});
    expect(db.serialize().includes(Buffer.from(sentinel))).toBe(true);
    if(action==='withdrawal'){service.withdraw('other',randomUUID(),service.progress('owner',session.studySessionId).withdrawalCode);expect(notifications).toEqual([{sessionId:session.studySessionId,roundIds:[round]}]);}
    else{db.prepare('UPDATE fixture_sessions SET retain_results=1').run();now+=RAW_MS;service.sweep();expect(db.prepare('SELECT count(*) n FROM fixture_rounds').get()).toEqual({n:1});}
    expect(db.serialize().includes(Buffer.from(sentinel))).toBe(false);db.close();
    if(fileBacked)expect(readFileSync(filename).includes(Buffer.from(sentinel))).toBe(false);
    rmSync(dir,{recursive:true});
  }
});
