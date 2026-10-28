import {testCatalogue} from '../../fixtures/study/testCatalogue.js';
import {it,expect} from 'vitest';
import { csvCell, deriveOutcomes, ANALYST_HEADER } from '../../src/server/study/exports.js';
it('uses exact 96-column header and formula-safe CSV',()=>{expect(ANALYST_HEADER).toHaveLength(96);expect(csvCell('=SUM(1,2)')).toBe('"\'=SUM(1,2)"');expect(csvCell(null)).toBe('');});
it('preserves semantic missingness and sticky timeout',()=>{const row={study_phase:'comparative',randomized:true,first_score_adjudicated:0,second_score_adjudicated:2,second_guess_codepoints:10,round_ended_at_utc:'now',second_generation_status:'ready',second_render_status:'rendered',fallback_used:false,client_wait_timed_out:true,client_timing_uncertain:false};expect(deriveOutcomes(row)).toMatchObject({primary_eligible:true,second_full_operational:false});expect(deriveOutcomes({...row,round_ended_at_utc:null})).toMatchObject({second_full_operational:null});});
it('does not treat absent semantic ratings as zero and keeps fidelity separate',()=>{const base={study_phase:'comparative',randomized:true,first_score_adjudicated:2,second_score_adjudicated:null,second_guess_codepoints:10,round_ended_at_utc:'now',second_generation_status:'ready',second_render_status:'rendered',fallback_used:false,client_wait_timed_out:false,client_timing_uncertain:false};expect(deriveOutcomes(base)).toMatchObject({second_score_adjudicated:null,primary_eligible:false,second_full_operational:null,initial_correct_retained:null});expect(deriveOutcomes({...base,second_score_adjudicated:2,second_fidelity_adjudicated:'changed_story'})).toMatchObject({second_full_operational:true,fidelity_preserving_repair:false});});

import Database from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
import {StudyService} from '../../src/server/study/service.js';
import {unzipSync,strFromU8} from 'fflate';
it('independently masks coder exports and fidelity artifacts without condition, timing, provider or cross-attempt linkage',()=>{
  const db=new Database(':memory:');const service=new StudyService(db,{catalogue:[...testCatalogue().filter(s=>s.sceneId!=='TM01'),{sceneId:'TM01',meaning:{target:'Mutual obstruction',targetRubric:{complete:'Mutual mistaken same-side choices'}},rubric:{complete:'Mutual mistaken same-side choices'},scoreHash:'a'.repeat(64),score:{},category:'physical',authoringMethod:'agent_assisted',humanReview:'not_run'}]});const session=service.createRehearsal('owner',{requestId:randomUUID(),fixtureScheduleId:'synthetic_short_v1'}),plan=service.nextRound('owner',session.studySessionId),round=randomUUID();service.attachRound('owner',session.studySessionId,round,plan);service.recordRound(round,{guess1:'=Dangerous spreadsheet formula',guess2:'Test second',secondAct:{score:testCatalogue()[0]!.score,scoreHash:'b'.repeat(64),source:'mock_fixture'},row:{condition:'informed',model_version:'private model',first_guess_submitted_at_utc:'private time'}});
  const exportFile=(format:'coder_first_csv'|'fidelity_bundle')=>{const result=service.createExport('owner',{requestId:randomUUID(),studyRunId:plan.studyRunId,format});expect(result.filename).toMatch(/^synthetic-[0-9a-f-]+\./);return service.downloadExport('owner',result.exportId).bytes;};const first=exportFile('coder_first_csv').toString(),other=exportFile('coder_first_csv').toString();expect(first.split('\r\n')[0]).toBe('rowId,rubric,guess');expect(first).not.toMatch(/informed|private model|private time|participant|TM01/);expect(first).toContain("'=Dangerous");expect(first.split('\r\n')[1]!.split(',')[0]).not.toBe(other.split('\r\n')[1]!.split(',')[0]);const files=unzipSync(exportFile('fidelity_bundle')),review=JSON.parse(strFromU8(files['review.json']!));expect(JSON.stringify(review)).not.toMatch(/informed|Dangerous|Test second|private model|private time/);expect(review.artifacts[0].rowId).not.toBe(first.split('\r\n')[1]!.split(',')[0]);expect(files[review.artifacts[0].scoreFile]).toBeDefined();db.close();
});
it('answered operationally delivered rounds stay pending until human second-score resolution',()=>{
  const row={study_phase:'comparative',randomized:true,first_score_adjudicated:0,second_score_adjudicated:null,second_guess_submitted_at_utc:'accepted',round_ended_at_utc:'terminal',second_generation_status:'ready',second_render_status:'rendered',fallback_used:false,client_wait_timed_out:false,client_timing_uncertain:false};
  expect(deriveOutcomes(row)).toMatchObject({second_full_operational:null,fidelity_preserving_repair:null});
  expect(deriveOutcomes(row,{secondResolved:true})).toMatchObject({second_full_operational:false});
  expect(deriveOutcomes({...row,second_guess_submitted_at_utc:null})).toMatchObject({second_full_operational:false});
  expect(deriveOutcomes({...row,client_wait_timed_out:true})).toMatchObject({second_full_operational:false});
});

import {fidelityHtml} from '../../src/server/study/fidelity.js';
import {createHash} from 'node:crypto';
it('masked fidelity HTML embeds one clip and meaning as inert UTF-8 data with exact fixed-script CSP',()=>{
  const attack='</script><img src=https://example.invalid/x onerror=alert(1)>';
  const data={artifactId:randomUUID(),score:testCatalogue()[0]!.score,scoreHash:testCatalogue()[0]!.scoreHash,meaning:{target:attack}};
  const html=fidelityHtml(data);expect(html).not.toContain(attack);expect(html).not.toMatch(/fetch\(|XMLHttpRequest|innerHTML|condition|provider|guess/);
  const script=html.match(/<script>([\s\S]*)<\/script>/)![1]!;expect(html).toContain("script-src 'sha256-"+createHash('sha256').update(script).digest('base64')+"'");
  expect(html).toContain("connect-src 'none'");expect(html).toContain('.textContent=');
  const encoded=html.match(/<div id="payload" hidden>([^<]*)<\/div>/)![1]!;
  expect(JSON.parse(Buffer.from(encoded,'base64').toString('utf8'))).toEqual(data);
});
it('explicitly resolved missing fidelity fails the secondary outcome while pending fidelity stays null',()=>{
  const row={study_phase:'comparative',randomized:true,first_score_adjudicated:0,second_score_adjudicated:2,second_guess_codepoints:10,second_fidelity_adjudicated:null,round_ended_at_utc:'terminal',second_generation_status:'ready',second_render_status:'rendered',fallback_used:false,client_wait_timed_out:false,client_timing_uncertain:false};
  expect(deriveOutcomes(row).fidelity_preserving_repair).toBeNull();expect(deriveOutcomes(row,{fidelityResolved:true}).fidelity_preserving_repair).toBe(false);
});
it('analyst export carries resolveRating pending versus explicit missing without fabricating semantic zero',()=>{
  const db=new Database(':memory:'),service=new StudyService(db,{catalogue:testCatalogue()});
  const session=service.createRehearsal('owner',{requestId:randomUUID(),fixtureScheduleId:'synthetic_short_v1'});let runId='',measuredRound='';
  for(let i=0;i<3;i++){const plan=service.nextRound('owner',session.studySessionId),round=randomUUID();runId=plan.studyRunId;service.attachRound('owner',session.studySessionId,round,plan);if(i===2){measuredRound=round;service.recordRound(round,{guess1:'Synthetic first answer',guess2:'Synthetic second answer',row:{second_generation_status:'ready',second_render_status:'rendered'}});service.assignAfterFirstGuess('owner',session.studySessionId,round);}service.recordRound(round,{terminal:true});service.finishRound(round);}
  service.sessionFeedback('owner',session.studySessionId,{requestId:randomUUID(),wouldPlayAgain:null,optionalExtraAccepted:false});
  service.createExport('owner',{requestId:randomUUID(),studyRunId:runId,format:'coder_first_csv'});
  const firstId=(db.prepare("SELECT id FROM study_coder_rows WHERE round_id=? AND kind='recognition_first'").get(measuredRound) as {id:string}).id;
  for(const coderId of ['coder_firstaaa','coder_firstbbb'])service.importRatings({version:1,studyRunId:runId,kind:'recognition_first',role:'independent',coderId,rows:[{rowId:firstId,rating:0,missingReason:null}]});
  service.lockFirst(runId);service.createExport('owner',{requestId:randomUUID(),studyRunId:runId,format:'coder_second_csv'});
  const secondId=(db.prepare("SELECT id FROM study_coder_rows WHERE round_id=? AND kind='recognition_second'").get(measuredRound) as {id:string}).id;
  const summary=()=>{const file=service.createExport('owner',{requestId:randomUUID(),studyRunId:runId,format:'analyst_csv'}),text=service.downloadExport('owner',file.exportId).bytes.toString(),lines=text.trim().split('\r\n'),header=lines[0]!.split(','),values=lines[3]!.split(',');return Object.fromEntries(header.map((key,index)=>[key,values[index]]));};
  expect(summary()).toMatchObject({primary_eligible:'true',second_full_operational:'',second_score_adjudicated:''});
  for(const [index,coderId] of ['coder_secondaa','coder_secondbb'].entries()){service.importRatings({version:1,studyRunId:runId,kind:'recognition_second',role:'independent',coderId,rows:[{rowId:secondId,rating:null,missingReason:'unrateable'}]});expect(summary().second_full_operational).toBe(index===0?'':'false');}
  expect(summary().second_score_adjudicated).toBe('');db.close();
});
