import { readFileSync, realpathSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { spawnSync } from 'node:child_process';
import { z } from 'zod';
import { validateScore } from '../src/shared/validateScore.js';
import { sampleScore } from '../src/shared/sampleScore.js';
import { normalizeGuess } from '../src/shared/normalizeGuess.js';
import { RecoveryStore, inspectTiming } from '../src/client/recoveryStore.js';
import { compileRequest } from '../src/server/provider.js';
import { listScenes } from '../src/server/operator/sceneBank.js';
import { listReferences } from '../src/server/references/index.js';
import type { MotionScoreV1, Roster } from '../src/shared/score.js';
import type { PendingMutationV1, RoundRecoveryV1 } from '../src/shared/api.js';
import { loadAcceptanceRegistry, assertClosedFixtureManifest } from './verify-acceptance.js';
const errors = ['valid','PARSE','BYTES','DEPTH','DUPLICATE_KEY','UNKNOWN_KEY','SCHEMA','ROSTER','TIMELINE','BOUNDS','SPEED','CONTACT','CONTACT_UNCERTAIN'] as const;
const common = { id:z.string().min(1), inputPath:z.string().min(1), sha256:z.string().regex(/^[0-9a-f]{64}$/), requirementIds:z.array(z.string().min(1)).min(1), testPath:z.literal('tests/unit/fixtures.test.ts') };
export const manifestSchema = z.strictObject({version:z.literal(1),cases:z.array(z.discriminatedUnion('kind',[
  z.strictObject({...common,kind:z.enum(['score','contact']),expected:z.enum(errors)}),
  z.strictObject({...common,kind:z.literal('input'),expected:z.enum(['normalized','INVALID_INPUT'])}),
  z.strictObject({...common,kind:z.literal('motion'),expected:z.literal('samples_match')}),
  z.strictObject({...common,kind:z.literal('recovery'),expected:z.enum(['original_client_deadline_preserved','clock_uncertain','sticky_timeout'])}),
  z.strictObject({...common,kind:z.literal('provider_preflight'),expected:z.literal('exact_request_bytes')}),
  z.strictObject({...common,kind:z.literal('provenance'),expected:z.literal('authored_and_mock_not_run')})
])).min(1)});
export type FixtureCase = z.infer<typeof manifestSchema>['cases'][number];
export function containedPath(root:string,path:string):string {
  if(isAbsolute(path)) throw new Error('PATH_ESCAPE');
  const absolute=realpathSync(resolve(root,path)), rel=relative(realpathSync(root),absolute);
  if(rel==='..'||rel.startsWith('../')||isAbsolute(rel))throw new Error('PATH_ESCAPE');
  return absolute;
}
export function loadManifest(root=process.cwd()) {
  const manifest=manifestSchema.parse(JSON.parse(readFileSync(containedPath(root,'fixtures/manifest.json'),'utf8')));
  assertClosedFixtureManifest(manifest,loadAcceptanceRegistry(root));
  const ids=new Set<string>();containedPath(root,'tests/unit/fixtures.test.ts');
  for(const c of manifest.cases){if(ids.has(c.id))throw new Error(`DUPLICATE_ID ${c.id}`);ids.add(c.id);const bytes=readFileSync(containedPath(root,c.inputPath));if(createHash('sha256').update(bytes).digest('hex')!==c.sha256)throw new Error(`HASH_MISMATCH ${c.id}`);}
  return manifest;
}
export function runFixtureCase(c:FixtureCase,root=process.cwd()):{id:string;kind:string;passed:boolean;actual:unknown} {
  const bytes=readFileSync(containedPath(root,c.inputPath));let actual:unknown,passed=false;
  if(c.kind==='score'||c.kind==='contact'){
    const fixture=JSON.parse(bytes.toString()) as {raw:string;roster:Roster};const result=validateScore(fixture.raw,fixture.roster);
    actual=result.ok?'valid':result.errors.map(e=>e.code);passed=result.ok?c.expected==='valid':actual instanceof Array&&actual.includes(c.expected);
  }else if(c.kind==='input'){
    const f=JSON.parse(bytes.toString());const result=normalizeGuess(f.raw);actual=typeof result==='string'?result:result.error.code;passed=c.expected==='normalized'?typeof result==='string'&&result===f.normalized:actual==='INVALID_INPUT';
  }else if(c.kind==='motion'){
    const f=JSON.parse(bytes.toString()) as {score:MotionScoreV1;samples:{tMs:number;actor:number;values:Record<string,number>}[];velocities?:{tMs:number;actor:number;axis:'x'|'y';side:'left'|'right';expected:number;tolerance:number}[]};actual=f.samples.map(s=>{const frame=sampleScore(f.score,s.tMs)[s.actor];return Object.fromEntries(Object.keys(s.values).map(k=>[k,frame[k as keyof typeof frame]]));});passed=isDeepStrictEqual(actual,f.samples.map(s=>s.values));
    for(const v of f.velocities??[]){const h=.01,from=v.side==='left'?v.tMs-h:v.tMs,to=v.side==='left'?v.tMs:v.tMs+h;const velocity=(sampleScore(f.score,to)[v.actor][v.axis]-sampleScore(f.score,from)[v.actor][v.axis])*1000/h;passed=passed&&Math.abs(velocity-v.expected)<=v.tolerance;}
  }else if(c.kind==='recovery'){
    const f=JSON.parse(bytes.toString()) as {mutation:PendingMutationV1;recovery:RoundRecoveryV1;walls:number[];mono?:number};const map=new Map<string,string>();const store=new RecoveryStore({getItem:k=>map.get(k)??null,setItem:(k,v)=>{map.set(k,v);},removeItem:k=>{map.delete(k);}});store.write('mutation',f.mutation);store.write('recovery',f.recovery);
    const restored=f.walls.map(wall=>store.restore(wall));const last=restored.at(-1)!;const timed=inspectTiming(last.mutation!,last.recovery!,0,f.mono??0,f.walls.at(-1)!);
    actual={deadlines:restored.map(r=>r.mutation?.deadlineWallMs),clockUncertain:timed.recovery.clockUncertain,clientTimeout:timed.recovery.clientTimeout};passed=c.expected==='original_client_deadline_preserved'?restored.every(r=>r.mutation?.deadlineWallMs===f.mutation.deadlineWallMs):c.expected==='clock_uncertain'?timed.recovery.clockUncertain:timed.recovery.clientTimeout;
  }else if(c.kind==='provider_preflight'){
    const f=JSON.parse(bytes.toString());const compiled=compileRequest(JSON.parse(f.input[0].content[0].text),f.model,f.max_output_tokens);actual={requestUtf8Bytes:compiled.requestUtf8Bytes,inputTokenBound:compiled.inputTokenBound};passed=compiled.bodyJson===JSON.stringify(f)&&compiled.inputTokenBound<=32768;
  }else{
    const f=JSON.parse(bytes.toString());const scenes=listScenes(),refs=listReferences();actual={sceneCount:scenes.length,referenceCount:refs.length};passed=scenes.length===f.sceneCount&&refs.length===f.referenceCount&&scenes.every(s=>s.source==='authored_fixture'&&s.humanCalibration==='not_run'&&s.authorship.humanReview==='not_run')&&refs.every(r=>r.variants.every(v=>v.source==='mock_fixture'&&v.validation==='passed'));
  }
  return {id:c.id,kind:c.kind,passed,actual};
}
export function runFixtureCorpus(root=process.cwd()) { return loadManifest(root).cases.map(c=>runFixtureCase(c,root)); }
export function assertConsumption(cases:{id:string}[],assertions:{title:string;status:string}[]) {
  for(const c of cases){const matches=assertions.filter(a=>a.title===c.id);if(matches.length!==1||matches[0].status!=='passed')throw new Error('UNCONSUMED_TEST '+c.id);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const cases=runFixtureCorpus();
    mkdirSync('.scratch',{recursive:true});const output=resolve('.scratch','fixture-consumption-'+randomUUID()+'.json');
    const child=spawnSync('npm',['exec','--','vitest','run','tests/unit/fixtures.test.ts','--reporter=json','--outputFile='+output],{encoding:'utf8',maxBuffer:16*1024*1024});
    if(child.error||child.status!==0)throw new Error('CONSUMER_FAILED '+(child.error?.message??child.stderr));
    const report=JSON.parse(readFileSync(output,'utf8'));rmSync(output);const consumerPath=resolve('tests/unit/fixtures.test.ts');const assertions=report.testResults.filter((t:{name:string})=>resolve(t.name)===consumerPath).flatMap((t:{assertionResults:{title:string;status:string}[]})=>t.assertionResults);
    assertConsumption(cases,assertions);
    const registry=loadAcceptanceRegistry();
    console.log(JSON.stringify({status:cases.every(c=>c.passed)?'PASS':'FAIL',empiricalQualifications:'NOT RUN',coverage:{executedNumericFixtures:cases.length,structurallyLinkedSourceRequirements:registry.requirements.length,dedicatedAcceptance:'PENDING actual unit, browser and build reports'},cases},null,2));if(cases.some(c=>!c.passed))process.exitCode=1;
  }catch(error){console.error(JSON.stringify({status:'FAIL',error:String(error)}));process.exitCode=1;}
}
