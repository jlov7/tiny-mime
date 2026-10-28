import { expect, it } from 'vitest';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import catalogue from '../../src/server/targets/meanings.json';
import meaningSchema from '../../src/server/targets/meaning.schema.json';
import manifest from '../../src/server/targets/first-act-manifest.json';
import manifestSchema from '../../src/server/targets/first-act-manifest.schema.json';
import { listScenes, getScene, developmentIds, comparisonIds, disabledScenes, directorMeaning } from '../../src/server/operator/sceneBank.js';
import { listReferences, getReference } from '../../src/server/references/index.js';
import { canonicalJson, canonicalHash, scoreHash } from '../../src/shared/hash.js';
import { validateScore } from '../../src/shared/validateScore.js';
import { sampleScore } from '../../src/shared/sampleScore.js';
const bytes=(path:string)=>fs.readFileSync(new URL('../../'+path,import.meta.url));
const byteHash=(path:string)=>createHash('sha256').update(bytes(path)).digest('hex');
it('canonical schemas and meaning catalogue unchanged from v0.2 pack',()=>{
  expect(bytes('src/server/targets/meanings.json')).toEqual(bytes('Tiny_Mime_Review_Source_Pack/supplements/scene-meaning-contracts.json'));
  expect(bytes('src/shared/score.schema.json')).toEqual(bytes('Tiny_Mime_Review_Source_Pack/supplements/motion-score-v1.schema.json'));
  expect(bytes('src/server/targets/meaning.schema.json')).toEqual(bytes('Tiny_Mime_Review_Source_Pack/supplements/scene-meaning-v1.schema.json'));
  expect(new Ajv2020({strict:true}).compile(meaningSchema)(catalogue)).toBe(true);
});
it('has_three_distinct_valid_scenes and all 8 other honest drafts',()=>{
  const scenes=listScenes();expect(scenes).toHaveLength(11);expect(new Set(scenes.map(s=>s.id)).size).toBe(11);expect(new Set(scenes.map(s=>s.scoreHash)).size).toBe(11);
  expect(scenes.map(s=>s.id).sort()).toEqual([...developmentIds,...comparisonIds].sort());
  for(const scene of scenes){expect(scene.meaning.meaningId).toBe(`${scene.id}.meaning.1`);expect(validateScore(canonicalJson(scene.score),scene.roster).ok).toBe(true);expect(scene.source).toBe('authored_fixture');expect(scene.humanCalibration).toBe('not_run');expect(scene.authorship).toEqual({authoringMethod:developmentIds.includes(scene.id as typeof developmentIds[number])?'spec_transcribed':'agent_assisted',humanReview:'not_run'});}
  for(const id of developmentIds)expect(bytes(`src/server/scores/${id}.json`)).toEqual(bytes(`Tiny_Mime_Review_Source_Pack/supplements/contract-fixtures/${id}.first-score.json`));
});
it('scene_manifest_matches_hashes, rosters, closed schema and empirical qualifications',()=>{
  expect(new Ajv2020({strict:true}).compile(manifestSchema)(manifest)).toBe(true);expect(manifest.empiricalQualifications).toBe('not_run');expect(manifest.scoreSchemaHash).toBe(byteHash('src/shared/score.schema.json'));expect(manifest.meaningCatalogueHash).toBe(byteHash('src/server/targets/meanings.json'));
  for(const entry of manifest.records){const scene=getScene(entry.sceneId)!;expect(entry.scoreHash).toBe(scoreHash(scene.score));expect(entry.meaningHash).toBe(canonicalHash(scene.meaning));expect(entry.roster).toEqual(scene.roster);expect(entry.authorship).toEqual(scene.authorship);expect(JSON.parse(bytes(entry.scorePath).toString())).toEqual(scene.score);}
});
it('TM07 remains explicitly disabled with no fabricated noncontact performance',()=>{expect(getScene('TM07')).toBeUndefined();expect(disabledScenes[0]).toMatchObject({id:'TM07',score:null,enabled:false,reason:'future_contact_required'});expect(disabledScenes[0].meaning.contactPolicy).toBe('future_contact_required');expect(()=>directorMeaning(disabledScenes[0].meaning)).toThrow('DEFERRED_CONTACT');});
it('director projection exact allowlist excludes rubric/title/status/guides; mutation cannot edit bank',()=>{
  const scene=getScene('TM01')!,projection=directorMeaning(scene.meaning);expect(Object.keys(projection).sort()).toEqual(['contractVersion','meaningId','target','cast','coreEvent','roleBindings','allowedElaborations','contradictions','geometryVersion','contactPolicy'].sort());
  projection.cast[0].role='mutated';expect(getScene('TM01')!.meaning.cast[0].role).toBe('left_to_right_traveler');scene.score.actors[0].keyframes[0].x=999;expect(getScene('TM01')!.score.actors[0].keyframes[0].x).toBe(250);
});
it('TM09 samples prove translated copying with 1-second positive lag',()=>{const s=getScene('TM09')!.score;for(let t=1000;t<=6250;t+=125){const a=sampleScore(s,t)[0],b=sampleScore(s,t+1000)[1];expect(b.x-a.x).toBeCloseTo(460,9);expect(b.y-a.y).toBeCloseTo(0,9);} });
it('TM04 opening completes before entry and settles into inclusive three-actor line',()=>{const s=getScene('TM04')!.score;expect(sampleScore(s,4000).map(f=>f.x)).toEqual([280,720,500]);expect(sampleScore(s,4250)[2].y).toBe(430);expect(sampleScore(s,6000)[2].y).toBe(260);expect(sampleScore(s,9000).map(f=>[f.x,f.y])).toEqual([[330,260],[670,260],[500,260]]);});
it('motion_pairs_keep_comparable_setup and truthful mock source',()=>{const refs=listReferences();expect(refs).toHaveLength(5);for(const pair of refs){expect(pair.variants).toHaveLength(2);for(const v of pair.variants){expect(v.source).toBe('mock_fixture');expect(v.validation).toBe('passed');expect(v.scoreHash).toBe(scoreHash(v.score));expect(validateScore(canonicalJson(v.score),v.score.actors).ok).toBe(true);}expect(pair.variants[0].score.durationMs).toBe(pair.variants[1].score.durationMs);expect(pair.variants[0].score.actors.map(a=>[a.id,a.shape,a.color])).toEqual(pair.variants[1].score.actors.map(a=>[a.id,a.shape,a.color]));}expect(getReference('unknown')).toBeUndefined();});
it('MR01 isolates synchronization from delay on identical local path',()=>{const variants=getReference('MR01')!.variants;const sync=variants.find(v=>v.name==='synchronous')!.score,delayed=variants.find(v=>v.name==='delayed')!.score;for(let t=0;t<=8000;t+=200){const frame=sampleScore(sync,t);expect(frame[1].x-frame[0].x).toBeCloseTo(460,9);expect(frame[1].y).toBeCloseTo(frame[0].y,9);}expect(sampleScore(delayed,1750)[0].y).not.toBe(sampleScore(delayed,1750)[1].y);});
it('MR03 opening/closing share composition and safe controlled gap change',()=>{const variants=getReference('MR03')!.variants;const a=variants[0].score,b=variants[1].score;expect(sampleScore(a,0)).toEqual(sampleScore(b,0));expect(sampleScore(a,0).map(f=>[f.x,f.y])).toEqual([[340,260],[660,260],[500,590]]);expect(sampleScore(a,4000).slice(0,2).map(f=>f.x)).toEqual([280,720]);expect(sampleScore(b,4000).slice(0,2).map(f=>f.x)).toEqual([425,575]);expect(sampleScore(b,9000)[2].y).toBe(430);});
it('MR04 stationary encounter differs from uniform slow approach',()=>{const pair=getReference('MR04')!;const pause=pair.variants.find(v=>v.name==='pause')!.score,slow=pair.variants.find(v=>v.name==='slowdown')!.score;expect(sampleScore(pause,2500)[0].x).toBe(sampleScore(pause,4500)[0].x);expect(sampleScore(slow,2500)[0].x).not.toBe(sampleScore(slow,4500)[0].x);});
it('MR05 same keyed transforms but zero stop velocity versus continuous 100 units/s',()=>{const pair=getReference('MR05')!;const stop=pair.variants.find(v=>v.name==='stops')!.score,continuous=pair.variants.find(v=>v.name==='continuous')!.score;for(const t of [0,1500,3000,4500,6000])expect(sampleScore(stop,t)).toEqual(sampleScore(continuous,t));for(const t of [1500,3000,4500]){const h=.01;expect((sampleScore(continuous,t+h)[0].x-sampleScore(continuous,t-h)[0].x)/(2*h)*1000).toBeCloseTo(100,6);expect((sampleScore(stop,t+h)[0].x-sampleScore(stop,t-h)[0].x)/(2*h)*1000).toBeLessThan(.003);} });
it('comparison draft causal order and stable consequence beats',()=>{
  const at=(id:string,t:number)=>sampleScore(getScene(id)!.score,t);
  expect(at('TM02',4250)[0]).toMatchObject({x:760,y:480});expect(at('TM02',4750)[1]).toMatchObject({x:760,y:220});expect(at('TM03',3000)[0].x-at('TM03',3000)[1].x).toBe(350);expect(at('TM03',7000)[0].x).toBe(at('TM03',7000)[1].x);
  expect(at('TM05',2250).map(f=>f.x)).toEqual([280,720,500]);expect(at('TM05',3400).slice(0,2).map(f=>f.x)).toEqual([410,590]);expect(at('TM05',6500).slice(0,2).map(f=>f.x)).toEqual([190,450]);expect(at('TM05',7500).slice(0,2).map(f=>f.x)).toEqual([270,450]);expect(at('TM05',9000)[2].y).toBeGreaterThan(260);
  expect(at('TM06',3500)[0].y).toBe(180);expect(at('TM06',5250)[1].x).toBeGreaterThan(at('TM06',5250)[0].x);expect(at('TM06',7500)[1].x-at('TM06',7500)[0].x).toBe(200);
  expect(at('TM08',2000)[1]).toMatchObject({x:650,y:350});expect(at('TM08',5500)[1]).toMatchObject({x:700,y:200});expect(at('TM08',5500)[0].x).toBe(470);
  expect(at('TM10',3750)[0].x).toBe(at('TM10',3750)[1].x);expect(at('TM10',6750)[0].x).toBe(at('TM10',6750)[1].x);expect(at('TM10',8000)[0].x).toBe(at('TM10',8000)[1].x);
  expect(at('TM11',1200)[0].x).toBeGreaterThan(200);expect(at('TM11',1200)[1].x).toBe(600);expect(at('TM11',8000)[0].x).toBe(430);expect(at('TM11',8000)[1].x).toBe(730);
  expect(at('TM12',2750)[0].x).toBeGreaterThan(at('TM12',2750)[2].x);expect(at('TM12',4500).map(f=>f.x)).toEqual([620,620,620]);expect(at('TM12',7500).map(f=>f.x)).toEqual([780,780,780]);
});
