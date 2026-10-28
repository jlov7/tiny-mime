import {test,expect} from '../support/browser-fixtures.js';
import type {Page} from '@playwright/test';

async function continuationBlocked(page:Page){const button=page.getByRole('button',{name:'Continue study',exact:true});expect(await button.count()===0||await button.isDisabled()).toBe(true);}
async function frames(page:Page,attempt:1|2){
  if(attempt===2)await page.getByRole('button',{name:'View next take',exact:true}).click();
  await expect(page.getByRole('button',{name:'Next frame',exact:true})).toBeVisible();
  const id=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId);
  const round=await(await page.request.get(`/api/rounds/${id}`)).json();
  const keys=new Set(round.acts[attempt-1].score.actors.flatMap((actor:any)=>actor.keyframes.map((key:any)=>key.tMs)));
  for(let index=1;index<keys.size;index++)await page.getByRole('button',{name:'Next frame',exact:true}).click();
}
async function beginStudy(page:Page){
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/study');
  await page.getByRole('button',{name:'Start short synthetic study',exact:true}).click();
  await page.getByRole('button',{name:'Start next round',exact:true}).click();await frames(page,1);
}

for(const reload of [false,true])test(`an unaccepted submission after expiry ${reload?'with':'without'} refresh clears only after an authoritative receipt`,async({page,app,operator})=>{
  let statusMode:'unavailable'|'malformed'|'real'='unavailable',checks=0;
  await page.route('**/api/rounds/*/requests/*/status',route=>{checks++;return statusMode==='unavailable'?route.fulfill({status:503,json:{error:{code:'UNAVAILABLE',retryable:true,requestId:null}}}):statusMode==='malformed'?route.fulfill({status:200,json:{accepted:false,unexpected:true}}):route.continue();});
  await beginStudy(page);await page.clock.install();
  await page.route('**/api/rounds/*/guesses',async route=>{await page.clock.fastForward(15010);await route.abort();},{times:1});
  await page.getByRole('textbox',{name:'What’s happening?'}).fill('Synthetic unaccepted interpretation, not participant data');
  await page.getByRole('button',{name:'Send guess',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('tm_recovery')!).clientTimeout)).toBe(true);
  const saved=await page.evaluate(()=>({m:JSON.parse(sessionStorage.getItem('tm_mutation')!),r:JSON.parse(sessionStorage.getItem('tm_recovery')!)}));
  app.advance(30*60000);await page.clock.fastForward(30*60000);
  if(reload)await page.reload();
  await continuationBlocked(page);await page.waitForLoadState('networkidle');expect(checks).toBe(0);
  for(const mode of ['unavailable','malformed'] as const){
    statusMode=mode;await page.getByRole('button',{name:'Check result',exact:true}).click();
    await expect.poll(()=>checks).toBe(mode==='unavailable'?1:2);
    expect(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('tm_mutation')!).requestId)).toBe(saved.m.requestId);
    expect(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('tm_recovery')!).timeoutEventId)).toBe(saved.r.timeoutEventId);
    await continuationBlocked(page);
  }
  statusMode='real';await page.getByRole('button',{name:'Check result',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>sessionStorage.getItem('tm_mutation'))).toBeNull();
  const remaining=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('tm_recovery')!));expect(remaining.clientTimeout).toBe(false);expect(remaining.timeoutEventId).toBeNull();expect(remaining.clockUncertainEventId).toBeNull();
  await expect(page.getByRole('button',{name:'Continue study',exact:true})).toBeEnabled();
  if(!reload)await expect(page.getByText('Unsent draft: Synthetic unaccepted interpretation, not participant data',{exact:true})).toBeVisible();
  expect((app.services.fixtureStudy.db.prepare('SELECT count(*) n FROM fixture_rounds').get() as any).n).toBe(1);
  await page.getByRole('button',{name:'Continue study',exact:true}).click();await expect(page.getByRole('button',{name:'Start next round',exact:true})).toBeVisible();
  expect((app.services.fixtureStudy.db.prepare('SELECT count(*) n FROM fixture_rounds').get() as any).n).toBe(1);
});

test('an accepted expired submission after refresh retains timing proof until acknowledged',async({page,app,operator})=>{
  await beginStudy(page);await page.clock.install();let deliver=false,statusChecks=0;
  await page.route('**/api/rounds/*/events',route=>deliver?route.continue():route.abort());
  await page.route('**/api/rounds/*/guesses',async route=>{await route.fetch();await page.clock.fastForward(15010);await route.abort();},{times:1});
  await page.getByRole('textbox',{name:'What’s happening?'}).fill('Synthetic accepted interpretation, not participant data');await page.getByRole('button',{name:'Send guess',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('tm_recovery')!).clientTimeout)).toBe(true);
  const saved=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('tm_mutation')!));
  await page.route('**/api/rounds/*/requests/*/status',async route=>{statusChecks++;const response=await route.fetch();expect(await response.json()).toEqual({accepted:true});await route.fulfill({response});});
  app.advance(30*60000);await page.clock.fastForward(30*60000);await page.reload();
  await expect(page.getByRole('button',{name:'Check result',exact:true})).toBeEnabled();await continuationBlocked(page);expect(statusChecks).toBe(0);await expect(page.getByRole('button',{name:'Discard pending request',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Check result',exact:true}).click();await expect.poll(()=>statusChecks).toBe(1);
  expect(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('tm_mutation')!).requestId)).toBe(saved.requestId);
  await continuationBlocked(page);
  deliver=true;await page.getByRole('button',{name:'Check result',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>sessionStorage.getItem('tm_mutation'))).toBeNull();await expect(page.getByRole('button',{name:'Continue study',exact:true})).toBeEnabled();
  expect(app.services.events.observations(saved.roundId).operationalOutcome).toMatchObject({clientTimeout:true,clockUncertain:true});
});

test('an expired unaccepted final guess preserves acknowledged first-guess timing proof',async({page,app,operator})=>{
  await beginStudy(page);await page.clock.install();
  await page.route('**/api/rounds/*/guesses',async route=>{await route.fetch();await page.clock.fastForward(15010);await route.abort();},{times:1});
  await page.getByRole('textbox',{name:'What’s happening?'}).fill('Synthetic late first interpretation');await page.getByRole('button',{name:'Send guess',exact:true}).click();
  await expect(page.getByRole('button',{name:'Check for a completed take',exact:true})).toBeVisible();
  await expect.poll(()=>(app.services.rounds as any).rounds.values().next().value.public.generation.status).toBe('ready');
  await page.getByRole('button',{name:'Check for a completed take',exact:true}).click();await expect(page.getByRole('button',{name:'View next take',exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>sessionStorage.getItem('tm_mutation'))).toBeNull();await frames(page,2);
  const proof=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('tm_recovery')!));
  await page.route('**/api/rounds/*/guesses',route=>route.abort(),{times:1});
  await page.getByRole('textbox',{name:'What do you think now?'}).fill('Synthetic unaccepted final interpretation');await page.getByRole('button',{name:'Send final guess',exact:true}).click();
  app.advance(30*60000);await page.clock.fastForward(30*60000);
  await continuationBlocked(page);await page.getByRole('button',{name:'Check result',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>sessionStorage.getItem('tm_mutation'))).toBeNull();
  const remaining=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('tm_recovery')!));expect(remaining.clientTimeout).toBe(true);expect(remaining.timeoutEventId).toBe(proof.timeoutEventId);
  expect(app.services.events.observations(proof.roundId).operationalOutcome.clientTimeout).toBe(true);
  await expect(page.getByRole('button',{name:'Continue study',exact:true})).toBeEnabled();
});

for(const initial of [false,true])test(`initial preference ${initial} stays independent of manual playback and refresh`,async({page,app,operator})=>{
  await page.emulateMedia({reducedMotion:initial?'reduce':'no-preference'});await page.goto('/study');await page.getByRole('button',{name:'Start short synthetic study',exact:true}).click();await page.getByRole('button',{name:'Start next round',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Take 1 of 2.',exact:true})).toBeVisible();
  const id=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId);
  const data=()=>JSON.parse((app.services.fixtureStudy.db.prepare('SELECT data FROM fixture_rounds WHERE id=?').get(id) as any).data);
  await expect.poll(()=>data().row.reduced_motion).toBe(initial);
  await page.getByRole('button',{name:initial?'Play animation':'Frame by frame',exact:true}).click();
  expect(data().row.reduced_motion).toBe(initial);expect(data().motionPreference.changes).toBe(0);
  await page.emulateMedia({reducedMotion:initial?'no-preference':'reduce'});
  await expect.poll(()=>data().motionPreference.changes).toBe(1);expect(data().row.reduced_motion).toBe(initial);
  await page.reload();await expect(page.getByRole('heading',{name:'Take 1 of 2.',exact:true})).toBeVisible();
  await expect.poll(()=>data().motionPreference.current).toBe(!initial);expect(data().motionPreference.changes).toBe(1);expect(data().row.reduced_motion).toBe(initial);
  await expect(page.getByRole('button',{name:'Pause',exact:true})).toHaveCount(0);
});

for(const mode of ['study','private_play'] as const)test('expired Study recovery preserves another owned '+mode+' round',async({page,app,operator})=>{
  await beginStudy(page);await page.route('**/api/rounds/*/guesses',route=>route.abort(),{times:1});
  await page.getByRole('textbox',{name:'What’s happening?'}).fill('Synthetic mismatched recovery');await page.getByRole('button',{name:'Send guess',exact:true}).click();
  const saved=await page.evaluate(()=>({c:sessionStorage.getItem('tm_creation')!,m:JSON.parse(sessionStorage.getItem('tm_mutation')!),r:JSON.parse(sessionStorage.getItem('tm_recovery')!)}));
  expect((await page.request.post('/api/rounds/'+saved.m.roundId+'/skip',{headers:{Origin:'http://127.0.0.1:4317'},data:{requestId:crypto.randomUUID(),revision:0}})).ok()).toBe(true);
  if(mode==='study')for(let i=0;i<2;i++){const r=await(await page.request.post('/api/rounds',{headers:{Origin:'http://127.0.0.1:4317'},data:{requestId:crypto.randomUUID(),mode:'study',executionMode:'fixture',studySessionId:JSON.parse(saved.c).studySessionId}})).json();expect((await page.request.post('/api/rounds/'+r.roundId+'/skip',{headers:{Origin:'http://127.0.0.1:4317'},data:{requestId:crypto.randomUUID(),revision:0}})).ok()).toBe(true);}
  const study=mode==='study'?await(await page.request.post('/api/operator/study-rehearsals',{headers:{Origin:'http://127.0.0.1:4317'},data:{requestId:crypto.randomUUID(),fixtureScheduleId:'synthetic_full_v1'}})).json():null;
  const other=await(await page.request.post('/api/rounds',{headers:{Origin:'http://127.0.0.1:4317'},data:{requestId:crypto.randomUUID(),mode,executionMode:'fixture',studySessionId:study?.studySessionId??null}})).json();expect(other.roundId).toBeTruthy();
  const mixed={c:saved.c,m:JSON.stringify({...saved.m,roundId:other.roundId,clockUncertain:true}),r:JSON.stringify({...saved.r,roundId:other.roundId,clockUncertain:true,clockUncertainEventId:crypto.randomUUID()})};
  await page.addInitScript(value=>{sessionStorage.setItem('tm_creation',value.c);sessionStorage.setItem('tm_mutation',value.m);sessionStorage.setItem('tm_recovery',value.r);},mixed);
  app.advance(1800000);await page.reload();await expect(page.getByRole('button',{name:'Check result',exact:true})).toBeEnabled();
  const protectedRecords=await page.evaluate(()=>({c:sessionStorage.getItem('tm_creation'),m:sessionStorage.getItem('tm_mutation'),r:sessionStorage.getItem('tm_recovery')}));
  expect(protectedRecords.c).toBe(mixed.c);expect(JSON.parse(protectedRecords.m!).roundId).toBe(other.roundId);await expect(page.getByRole('button',{name:'Discard pending request',exact:true})).toHaveCount(0);
  for(let attempt=0;attempt<2;attempt++){
    await page.getByRole('button',{name:'Check result',exact:true}).click();
    await expect(page.getByRole('alert')).toContainText('saved round belongs to another session');
    expect(await page.evaluate(()=>({c:sessionStorage.getItem('tm_creation'),m:sessionStorage.getItem('tm_mutation'),r:sessionStorage.getItem('tm_recovery')}))).toEqual(protectedRecords);
    await continuationBlocked(page);
    await page.reload();
  }
});

test('expired Study identity needs an explicit valid receipt before mutation recovery',async({page,app,operator})=>{
  let mode:'unavailable'|'malformed'|'false'|'real'='unavailable',checks=0;
  await page.route('**/api/study-sessions/*/rounds/*/creation-requests/*/status',route=>{checks++;return mode==='real'?route.continue():route.fulfill({status:mode==='unavailable'?503:200,json:mode==='unavailable'?{error:{code:'UNAVAILABLE',requestId:null,retryable:true}}:mode==='malformed'?{accepted:true,extra:true}:{accepted:false}});});
  await beginStudy(page);await page.route('**/api/rounds/*/guesses',route=>route.abort(),{times:1});
  await page.getByRole('textbox',{name:'What’s happening?'}).fill('Synthetic identity outage');await page.getByRole('button',{name:'Send guess',exact:true}).click();
  app.advance(1800000);await page.reload();await expect(page.getByRole('button',{name:'Check result',exact:true})).toBeEnabled();expect(checks).toBe(0);
  const saved=await page.evaluate(()=>({c:sessionStorage.getItem('tm_creation'),m:sessionStorage.getItem('tm_mutation'),r:sessionStorage.getItem('tm_recovery')}));
  for(const value of ['unavailable','malformed','false'] as const){mode=value;await page.getByRole('button',{name:'Check result',exact:true}).click();await expect(page.getByRole('button',{name:'Check result',exact:true})).toBeEnabled();expect(await page.evaluate(()=>({c:sessionStorage.getItem('tm_creation'),m:sessionStorage.getItem('tm_mutation'),r:sessionStorage.getItem('tm_recovery')}))).toEqual(saved);await continuationBlocked(page);}
  mode='real';await page.getByRole('button',{name:'Check result',exact:true}).click();await expect.poll(()=>page.evaluate(()=>sessionStorage.getItem('tm_mutation'))).toBeNull();await expect(page.getByRole('button',{name:'Continue study',exact:true})).toBeEnabled();expect(checks).toBe(4);
});

for(const outage of [false,true])test('discarding an expired creation-only request refreshes Study progress '+(outage?'after an explicit outage check':'without reload'),async({page,app,operator})=>{
  let progressAvailable=true;await page.route('**/api/study-sessions/*',route=>progressAvailable?route.continue():route.fulfill({status:503,json:{error:{code:'UNAVAILABLE',retryable:true,requestId:null}}}));
  await page.goto('/study');await page.getByRole('button',{name:'Start short synthetic study',exact:true}).click();
  let createdRound='';await page.route('**/api/rounds',async route=>{const response=await route.fetch();createdRound=(await response.json()).roundId;await route.abort();},{times:1});
  await page.getByRole('button',{name:'Start next round',exact:true}).click();await expect(page.getByRole('button',{name:'Check result',exact:true})).toBeEnabled();
  expect(createdRound).toBeTruthy();expect(await page.evaluate(()=>sessionStorage.getItem('tm_creation'))).not.toBeNull();expect(await page.evaluate(()=>sessionStorage.getItem('tm_mutation'))).toBeNull();expect(await page.evaluate(()=>sessionStorage.getItem('tm_recovery'))).toBeNull();
  let release!:()=>void,held=false;const gate=new Promise<void>(resolve=>{release=resolve;});await page.route('**/api/round-requests/*',async route=>{held=true;await gate;await route.continue();});
  try{
    await page.reload();await expect.poll(()=>held).toBe(true);await expect(page.getByText('Practice · 1 / 2',{exact:true})).toBeVisible();
    app.advance(1800000);release();await expect(page.getByRole('button',{name:'Discard pending request',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Check result',exact:true})).toBeEnabled();
    if(outage)progressAvailable=false;await page.getByRole('button',{name:'Discard pending request',exact:true}).click();
    if(outage){await expect(page.getByRole('button',{name:'Check study progress',exact:true})).toBeEnabled();await expect(page.getByRole('button',{name:'Start next round',exact:true})).toBeDisabled();expect((app.services.fixtureStudy.db.prepare('SELECT count(*) n FROM fixture_rounds').get() as any).n).toBe(1);progressAvailable=true;await page.getByRole('button',{name:'Check study progress',exact:true}).click();}
    await expect(page.getByText('Practice · 2 / 2',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Start next round',exact:true})).toBeEnabled();
    expect(await page.evaluate(()=>sessionStorage.getItem('tm_creation'))).toBeNull();expect((app.services.fixtureStudy.db.prepare('SELECT count(*) n FROM fixture_rounds').get() as any).n).toBe(1);
    const internal=(app.services.rounds as any).rounds.get(createdRound);expect(internal.expiredAt).not.toBeNull();
    await page.getByRole('button',{name:'Start next round',exact:true}).click();await expect(page.getByRole('heading',{name:'Take 1 of 2.',exact:true})).toBeVisible();expect((app.services.fixtureStudy.db.prepare('SELECT count(*) n FROM fixture_rounds').get() as any).n).toBe(2);
  }finally{release();}
});
