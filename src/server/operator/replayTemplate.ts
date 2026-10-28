import { createHash } from 'node:crypto';
import { DISPLAY_FONT_CSS } from './typography.js';
import { sampleScore, sampleActor, segmentAt } from '../../shared/sampleScore.js';
import type { PublicAct, PublicRound } from '../../shared/api.js';
import type { CaptureManifest } from './capture.js';

type ReplayData = { manifest: CaptureManifest; acts: PublicAct[]; guesses: PublicRound['guesses']; target: string };
export const REPLAY_STYLE = DISPLAY_FONT_CSS + `:root{font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#242622;background:#F6F2E9;font-synthesis:none;line-height:1.5}*{box-sizing:border-box}body{margin:0;padding:32px 24px}main{max-width:920px;margin:auto}h1{font-size:clamp(32px,4vw,40px);font-weight:650;letter-spacing:-.035em;line-height:1.12;margin:0 0 20px}p{line-height:1.5;overflow-wrap:anywhere;max-width:74ch}svg{display:block;width:100%;height:auto;aspect-ratio:10/7;background:#F7F3EA;outline:1px solid #d6d1c5}button,input,select{font:inherit}button{min-height:44px;min-width:44px;padding:10px 16px;margin:8px 8px 8px 0;background:#fffdf7;color:#242622;border:1px solid #7b8374;border-radius:8px;cursor:pointer}button:hover{background:#e9e6dd}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #242622;outline-offset:3px}#play{background:#2B675A;color:#fff;border-color:#2B675A;min-height:48px}#play:hover{background:#24564b}#label,#message{min-height:1.5em}#label,#notice,#limitations{font-size:14px;color:#555A53}#message{white-space:pre-wrap}label{display:flex;align-items:center;gap:10px;margin:12px 0;min-height:44px}input[type=checkbox]{width:20px;height:20px;accent-color:#2B675A}::selection{background:#d5e7dc;color:#242622}[hidden]{display:none}@media(max-width:450px){body{padding:24px 16px}}
.replay-document{padding:24px}.replay-document main{max-width:1120px}.replay-heading h1{margin-bottom:8px}.replay-heading p{margin:0 0 20px}.replay-player{display:grid;grid-template-columns:minmax(0,760px) minmax(240px,1fr);gap:24px;align-items:start}.replay-controls{min-width:0}.replay-buttons{display:flex;flex-wrap:wrap;gap:8px}.replay-buttons button{margin:0}.replay-controls #label{margin:0 0 12px}.replay-controls #message,.replay-controls #reveal{margin:12px 0}.replay-controls label{font-size:14px;align-items:flex-start}.replay-controls input{flex-shrink:0}.replay-controls #position{font-variant-numeric:tabular-nums}.replay-details{margin-top:20px}.replay-details summary{cursor:pointer;min-height:44px;padding-block:10px}.replay-details summary:focus-visible{outline:3px solid #242622;outline-offset:3px}.replay-document:has(#motion:not(:checked)) #step,.replay-document:has(#motion:checked) #previous-step{display:none}button:disabled{opacity:.55;cursor:default}.replay-navigation label{display:block;margin:12px 0 4px;min-height:0}.replay-navigation select,.replay-navigation input{display:block;width:100%;min-width:0;min-height:44px}.replay-navigation select{height:44px;padding:8px;background:#fffdf7;color:#242622;border:1px solid #7b8374;border-radius:8px}.replay-navigation input{margin:0;accent-color:#2B675A}#navigation-help{font-size:14px;color:#555A53}
@media(max-width:700px){.replay-document{padding:20px 16px}.replay-player{display:block}.replay-heading h1{font-size:32px}.replay-heading p{margin-bottom:12px}.replay-controls{margin-top:12px}.replay-controls label{margin:8px 0}.replay-details{margin-top:12px}}
`;

// This authored player receives validated data only. The shared pure sampler is embedded unchanged.
const PLAYER = `
const data=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(document.getElementById('payload').textContent),c=>c.charCodeAt(0))));
const byId=id=>document.getElementById(id);
const timeline=data.manifest.exportedTimeline;
const palette={violet:'#7357FF',amber:'#B56A00',teal:'#007F83'};
const ns='http://www.w3.org/2000/svg';
let elapsed=0,playing=false,origin=null,raf=null,lastSegment=-1;
const duration=timeline.reduce((sum,s)=>sum+s.durationMs,0);
const steps=[],starts=[];
let cursor=0;
for(let index=0;index<timeline.length;index++){
  const s=timeline[index];starts.push(cursor);
  if(s.kind==='act')for(const time of [...new Set(data.acts.find(a=>a.attempt===s.attempt).score.actors.flatMap(a=>a.keyframes.map(k=>k.tMs)))].sort((a,b)=>a-b))steps.push({time:cursor+time/s.playbackSpeed,index,local:time/s.playbackSpeed});
  else if(s.kind==='observed'&&s.playing){
    const keys=data.acts.find(a=>a.attempt===s.attempt).score.actors.flatMap(a=>a.keyframes.map(k=>k.tMs-s.positionMs)).filter(time=>time>0&&time<s.durationMs);
    for(const local of [...new Set([0,...keys,s.durationMs])].sort((a,b)=>a-b))steps.push({time:cursor+local,index,local});
  }else steps.push({time:cursor,index,local:0});
  cursor+=s.durationMs;
}
const seconds=time=>String(Number((time/1000).toFixed(3)));
function segmentLabel(s){
  if(s.kind==='observed')return (s.phase==='revealed'?'Reveal. ':'')+(s.attempt===1?'First performance. ':'Second performance. ')+(s.playing?'Recorded motion. ':'Held frame. ')+(s.waiting?'Waiting. ':'')+(s.hidden?'Page hidden. ':'')+(s.guessAttempt?'Accepted guess '+s.guessAttempt+'. ':'')+(s.replay?'Replay.':'');
  return s.kind==='act'?(s.attempt===1?'First performance':'Second performance')+(s.replay?'. Replay':''):s.kind==='guess'?'Accepted guess '+s.attempt:s.kind==='wait'?'Server generation interval':'Reveal';
}
for(let index=0;index<timeline.length;index++){
  const option=document.createElementNS('http://www.w3.org/1999/xhtml','option');option.value=String(index);
  option.textContent=(index+1)+'. '+segmentLabel(timeline[index])+' ('+seconds(starts[index])+' seconds)';byId('segment').appendChild(option);
}
byId('timeline').max=String(duration/1000);
byId('notice').textContent=[data.manifest.timelineBasis==='observed_creator_trace'?'Reconstruction from observed creator timing.':'Score reconstruction. Original session timing unavailable. Guess and reveal display holds are presentation choices.',data.manifest.selectedExample?'Selected example.':'',data.manifest.round.executionMode==='fixture'?'Fixture round. No live generation.':'',data.manifest.timingEdited?'Waiting shortened from '+data.manifest.actualWaitMs/1000+' to '+data.manifest.exportedWaitMs/1000+' seconds.':data.manifest.actualWaitMs===null?'Server generation duration: '+data.manifest.serverGenerationMs/1000+' seconds. This is not viewer waiting time.':'Observed waiting: '+data.manifest.actualWaitMs/1000+' seconds.',data.manifest.omittedGuessText?'Guess omitted.':'',data.manifest.playbackObservations.some(o=>o.mode==='frame_step')?'Original viewing included frame stepping.':'',data.manifest.operationalOutcome?.clientTimeout?'Original round reached its client waiting limit.':'',data.manifest.operationalOutcome?.clockUncertain?'Original round had an uncertain clock.':'',data.manifest.operationalOutcome?.lateRecovery?'Second performance was recovered late by explicit action.':'',data.manifest.round.generationFailure?'Recorded generation failure: '+data.manifest.round.generationFailure+'.':''].filter(Boolean).join(' ');
byId('limitations').textContent=data.manifest.validityLimitations.join(' ');
const preference=matchMedia('(prefers-reduced-motion: reduce)');
byId('motion').checked=!preference.matches;
function locate(time){let start=0;for(let i=0;i<timeline.length;i++){const s=timeline[i];if(time<start+s.durationMs||i===timeline.length-1)return {s,i,local:Math.max(0,time-start)};start+=s.durationMs;}}
function draw(score,time){
  const stage=byId('stage');stage.replaceChildren();
  for(const f of sampleScore(score,time)){
    const shape=document.createElementNS(ns,f.shape==='circle'?'circle':f.shape==='square'?'rect':'polygon');
    if(f.shape==='circle')shape.setAttribute('r','40');
    else if(f.shape==='square'){shape.setAttribute('x','-32');shape.setAttribute('y','-32');shape.setAttribute('width','64');shape.setAttribute('height','64');}
    else shape.setAttribute('points','0,-48 '+24*Math.sqrt(3)+',24 '+(-24*Math.sqrt(3))+',24');
    shape.setAttribute('fill',palette[f.color]);shape.setAttribute('transform','translate('+f.x+' '+f.y+') rotate('+f.rotationDeg+') scale('+f.scaleX+' '+f.scaleY+')');stage.appendChild(shape);
  }
}
function render(override){
  const current=override||locate(elapsed),s=current.s;
  byId('message').textContent='';byId('reveal').textContent='';lastSegment=current.i;
  if(s.kind==='observed'){
    const act=data.acts.find(a=>a.attempt===s.attempt);
    byId('label').textContent=(s.replay?'Replay. ':'')+(s.attempt===1?'First performance. ':'Second performance. ')+(s.playing?'Playing. ':'Held frame. ')+(s.hidden?'Page hidden. ':'')+(s.waiting?'Waiting for next take. ':'')+(act.source==='runtime_generated'?'Runtime generated.':act.source==='mock_fixture'?'Fixture. Mock material.':'Authored fixture.');
    draw(act.score,Math.min(act.score.durationMs,s.positionMs+(s.playing?current.local:0)));
    if(s.waiting)byId('message').textContent='Waiting for next take.';
    if(s.phase==='revealed'){byId('label').textContent='Reveal';byId('reveal').textContent='The scene was meant to show… '+data.target;}
    if(s.guessAttempt)byId('message').textContent=(s.waiting?'Waiting for next take. ':'')+(data.manifest.omittedGuessText?'Guess omitted':data.guesses.find(g=>g.attempt===s.guessAttempt)?.text||'');
  }else if(s.kind==='act'){
    const act=data.acts.find(a=>a.attempt===s.attempt);
    byId('label').textContent=(s.replay?'Replay. ':'')+(s.attempt===1?'First performance. ':'Second performance. ')+(act.source==='runtime_generated'?'Runtime generated.':act.source==='mock_fixture'?'Fixture. Mock material.':'Authored fixture.')+' Playback speed '+s.playbackSpeed+'×.';
    draw(act.score,current.local*s.playbackSpeed);
  }else{
    byId('stage').replaceChildren();
    byId('label').textContent=s.kind==='guess'?'Accepted guess '+s.attempt:s.kind==='wait'?'Waiting':'Reveal';
    if(s.kind==='guess')byId('message').textContent=data.manifest.omittedGuessText?'Guess omitted':data.guesses.find(g=>g.attempt===s.attempt).text;
    if(s.kind==='wait')byId('message').textContent=(data.manifest.actualWaitMs===null?'Server generation duration '+data.manifest.serverGenerationMs/1000+' seconds. Viewer wait unavailable.':'Observed waiting '+data.manifest.actualWaitMs/1000+' seconds.')+(data.manifest.timingEdited?' Waiting shortened to '+data.manifest.exportedWaitMs/1000+' seconds.':'');
    if(s.kind==='reveal')byId('reveal').textContent='The scene was meant to show… '+data.target;
  }
  byId('timeline').value=String(elapsed/1000);byId('timeline').setAttribute('aria-valuetext',seconds(elapsed)+' of '+seconds(duration)+' seconds in exported timeline');
  byId('segment').value=String(current.i);byId('previous-segment').disabled=current.i===0;byId('next-segment').disabled=current.i===timeline.length-1;
  byId('previous-step').disabled=!previousStep();
  byId('position').textContent=(elapsed/1000).toFixed(1)+' / '+(duration/1000).toFixed(1)+' seconds';transport();
}
function nextStep(){return steps.find(s=>s.time>elapsed+1e-6||(Math.abs(s.time-elapsed)<=1e-6&&s.index>lastSegment));}
function previousStep(){return steps.findLast(s=>s.time<elapsed-1e-6||(Math.abs(s.time-elapsed)<=1e-6&&s.index<lastSegment));}
function seekSegment(index){pause();elapsed=starts[index];render({s:timeline[index],i:index,local:0});}
function transport(){byId('play').textContent=playing?'Pause':!byId('motion').checked?(elapsed>=duration&&!nextStep()?'Restart frames':'Next frame or segment'):(elapsed>=duration?'Replay':'Play');}
function pause(){playing=false;if(raf!==null)cancelAnimationFrame(raf);raf=null;origin=null;transport();}
function tick(now){if(!playing)return;if(origin===null)origin=now-elapsed;elapsed=Math.min(duration,now-origin);render();if(elapsed>=duration)pause();else raf=requestAnimationFrame(tick);}
byId('play').addEventListener('click',()=>{if(playing){pause();return;}if(!byId('motion').checked){if(elapsed>=duration&&!nextStep()){seekSegment(0);}else byId('step').click();return;}if(elapsed>=duration)elapsed=0;playing=true;origin=null;byId('play').textContent='Pause';render();raf=requestAnimationFrame(tick);});
byId('replay').addEventListener('click',()=>seekSegment(0));
byId('step').addEventListener('click',()=>{pause();const next=nextStep();if(next){elapsed=next.time;render({s:timeline[next.index],i:next.index,local:next.local});}else{elapsed=duration;render();}});
byId('previous-step').addEventListener('click',()=>{pause();const previous=previousStep();if(previous){elapsed=previous.time;render({s:timeline[previous.index],i:previous.index,local:previous.local});}});
byId('previous-segment').addEventListener('click',()=>{if(lastSegment>0)seekSegment(lastSegment-1);});
byId('next-segment').addEventListener('click',()=>{if(lastSegment<timeline.length-1)seekSegment(lastSegment+1);});
byId('segment').addEventListener('change',()=>seekSegment(Number(byId('segment').value)));
byId('timeline').addEventListener('input',()=>{pause();elapsed=Math.max(0,Math.min(duration,Number(byId('timeline').value)*1000));if(elapsed===0)seekSegment(0);else render();});
byId('motion').addEventListener('change',pause);
preference.addEventListener('change',event=>{if(event.matches){byId('motion').checked=false;pause();}});
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
seekSegment(0);
`;

export function replayScript(): string {
  // Transpilers may annotate function names using this identity helper.
  return `const __name=(fn)=>fn;\n${segmentAt.toString()}\n${sampleActor.toString()}\n${sampleScore.toString()}\n${PLAYER}`;
}
const hash = (text: string) => createHash('sha256').update(text).digest('base64');
export function replayHtml(data: ReplayData): string {
  const script = replayScript();
  const encoded = Buffer.from(JSON.stringify(data), 'utf8').toString('base64');
  const csp = `default-src 'none'; script-src 'sha256-${hash(script)}'; style-src 'sha256-${hash(REPLAY_STYLE)}'; connect-src 'none'; img-src 'none'; font-src data:; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>Tiny Mime local replay</title><style>${REPLAY_STYLE}</style></head><body class="replay-document"><main><header class="replay-heading"><h1>Tiny Mime local replay</h1><p>${data.manifest.timelineBasis === "observed_creator_trace" ? "Replay of recorded creator timing." : "Score reconstruction. Original viewing timing unavailable."} Playback starts paused.</p></header><div class="replay-player"><svg id="stage" viewBox="0 0 1000 700" role="img" aria-label="Silent geometric performance"></svg><section class="replay-controls" aria-label="Playback controls"><p id="label" aria-live="polite"></p><div class="replay-buttons"><button id="play" type="button">Play</button><button id="replay" type="button">Replay from beginning</button><button id="previous-step" type="button">Previous frame or segment</button><button id="step" type="button">Next frame or segment</button></div><label><input id="motion" type="checkbox" aria-label="Full motion (explicit opt-in when reduced motion is preferred)"> Full motion</label><div class="replay-navigation"><label for="timeline">Exported timeline (seconds)</label><input id="timeline" type="range" min="0" step="0.001" value="0" aria-describedby="navigation-help"><p id="position"></p><label for="segment">Replay segment</label><select id="segment" aria-describedby="navigation-help"></select><div class="replay-buttons"><button id="previous-segment" type="button">Previous segment</button><button id="next-segment" type="button">Next segment</button></div><p id="navigation-help">Use arrow keys on the timeline or choose a segment. Navigation pauses playback. Segments at the same time remain separate.</p></div><p id="message"></p><p id="reveal" aria-live="polite"></p><p id="notice"></p></section></div><details class="replay-details"><summary>About this replay and its limits</summary><p id="limitations"></p><p>This visual task has no nonvisual equivalent. Application code: MIT. Embedded display font: SIL Open Font License 1.1.</p></details><div id="payload" hidden>${encoded}</div></main><script>${script}</script></body></html>`;
}
