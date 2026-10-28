import { createHash } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';
import { canonicalJson } from '../../shared/hash.js';
import { sampleActor, sampleScore, segmentAt } from '../../shared/sampleScore.js';
import { validateScore } from '../../shared/validateScore.js';
import { GEOMETRY_VERSION, CONTACT_POLICY } from '../../shared/score.js';
import { getScene } from './sceneBank.js';
import { REPLAY_STYLE } from './replayTemplate.js';
import type { Candidate } from './workspace.js';

const PLAYER = `
const score=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(document.getElementById('payload').textContent),c=>c.charCodeAt(0))));
const byId=id=>document.getElementById(id),ns='http://www.w3.org/2000/svg';
const times=[...new Set(score.actors.flatMap(actor=>actor.keyframes.map(key=>key.tMs)))].sort((a,b)=>a-b);
const palette={violet:'#7357FF',amber:'#B56A00',teal:'#007F83'};
let elapsed=0,origin=0,raf=null,playing=false;
function render(){
  const stage=byId('stage');stage.replaceChildren();
  for(const frame of sampleScore(score,elapsed)){
    const shape=document.createElementNS(ns,frame.shape==='circle'?'circle':frame.shape==='square'?'rect':'polygon');
    if(frame.shape==='circle')shape.setAttribute('r','40');
    else if(frame.shape==='square'){shape.setAttribute('x','-32');shape.setAttribute('y','-32');shape.setAttribute('width','64');shape.setAttribute('height','64');}
    else shape.setAttribute('points','0,-48 '+24*Math.sqrt(3)+',24 '+(-24*Math.sqrt(3))+',24');
    shape.setAttribute('fill',palette[frame.color]);shape.setAttribute('transform','translate('+frame.x+' '+frame.y+') rotate('+frame.rotationDeg+') scale('+frame.scaleX+' '+frame.scaleY+')');stage.appendChild(shape);
  }
  byId('timeline').value=elapsed;byId('position').textContent=(elapsed/1000).toFixed(2)+' / '+(score.durationMs/1000).toFixed(2)+' seconds';transport();
}
function transport(){byId('play').textContent=playing?'Pause':byId('frames').checked?(elapsed>=score.durationMs?'Restart frames':'Next frame'):(elapsed>=score.durationMs?'Replay':'Play');}
function pause(){playing=false;if(raf!==null)cancelAnimationFrame(raf);raf=null;transport();}
function seek(time){pause();elapsed=Math.max(0,Math.min(score.durationMs,time));render();}
function step(direction){seek(direction>0?(times.find(t=>t>elapsed)??score.durationMs):([...times].reverse().find(t=>t<elapsed)??0));}
function tick(now){if(!playing||document.hidden){pause();return;}elapsed=Math.min(score.durationMs,now-origin);render();if(elapsed>=score.durationMs)pause();else raf=requestAnimationFrame(tick);}
const preference=matchMedia('(prefers-reduced-motion: reduce)');byId('frames').checked=preference.matches;
byId('play').addEventListener('click',()=>{if(playing){pause();return;}if(byId('frames').checked){if(elapsed>=score.durationMs)seek(0);else step(1);return;}if(document.hidden)return;if(elapsed>=score.durationMs)elapsed=0;origin=performance.now()-elapsed;playing=true;transport();raf=requestAnimationFrame(tick);});
byId('reset').addEventListener('click',()=>seek(0));byId('previous').addEventListener('click',()=>step(-1));byId('next').addEventListener('click',()=>step(1));
byId('timeline').addEventListener('input',event=>seek(Number(event.target.value)));byId('frames').addEventListener('change',pause);
preference.addEventListener('change',event=>{byId('frames').checked=event.matches;pause();});document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
render();
`;
const hash = (text: string) => createHash('sha256').update(text).digest('base64');
const INSPECTION_STYLE = `${REPLAY_STYLE}
body{padding:24px}main{max-width:1120px}.inspection-heading h1{margin-bottom:8px}.inspection-heading p{margin:0 0 20px}.inspection-player{display:grid;grid-template-columns:minmax(0,760px) minmax(240px,1fr);gap:24px;align-items:start}.inspection-controls{min-width:0}.inspection-buttons{display:flex;flex-wrap:wrap;gap:8px}.inspection-buttons button{margin:0}.inspection-controls label{margin:12px 0}.inspection-controls label:has(input[type=range]){display:block}.inspection-controls input[type=range]{display:block;width:100%;min-height:44px;accent-color:#2B675A}.inspection-controls #position{font-variant-numeric:tabular-nums}.inspection-details{margin-top:20px;color:#555A53}.inspection-details summary{cursor:pointer;min-height:44px;padding-block:10px}.inspection-details summary:focus-visible{outline:3px solid #242622;outline-offset:3px}.inspection-details code{overflow-wrap:anywhere}.inspection-details p{font-size:14px}
@media(max-width:700px){body{padding:20px 16px}.inspection-player{display:block}.inspection-heading p{margin-bottom:12px}.inspection-controls{margin-top:12px}.inspection-controls label{margin:8px 0}.inspection-details{margin-top:12px}}
`;

export function buildInspection(candidate: Candidate): Uint8Array {
  const scene = getScene(candidate.sceneId);
  const checked = scene && validateScore(JSON.stringify(candidate.score), scene.roster);
  if (!checked || !checked.ok || checked.scoreHash !== candidate.scoreHash) throw new Error('INVALID_INSPECTION_SCORE');
  const script = `const __name=(fn)=>fn;\n${segmentAt.toString()}\n${sampleActor.toString()}\n${sampleScore.toString()}\n${PLAYER}`;
  const csp = `default-src 'none'; script-src 'sha256-${hash(script)}'; style-src 'sha256-${hash(INSPECTION_STYLE)}'; connect-src 'none'; img-src 'none'; font-src data:; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  const encoded = Buffer.from(canonicalJson(checked.score)).toString('base64');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>Tiny Mime rehearsal inspection</title><style>${INSPECTION_STYLE}</style></head><body><main><header class="inspection-heading"><h1>Rehearsal inspection</h1><p>Operator-saved score. Human review and comprehension: NOT RUN.</p></header><div class="inspection-player"><svg id="stage" viewBox="0 0 1000 700" role="img" aria-label="Silent geometric performance"></svg><section class="inspection-controls" aria-label="Playback controls"><div class="inspection-buttons"><button id="play">Play</button><button id="reset">Reset</button><button id="previous">Previous keyframe</button><button id="next">Next keyframe</button></div><label><input id="frames" type="checkbox"> Frame by frame</label><label>Timeline<input id="timeline" type="range" min="0" max="${checked.score.durationMs}" step="1" value="0"></label><p id="position" aria-live="off"></p></section></div><details class="inspection-details"><summary>About this inspection and score</summary><p>This is a standalone rehearsal artifact, not a recorded round or an AI quality result.</p><p>Score hash: <code>${checked.scoreHash}</code></p><p>No guesses, targets, candidate labels or operator notes are included. Numerical validity does not establish meaning. The visual activity has no nonvisual equivalent.</p></details><div id="payload" hidden>${encoded}</div></main><script>${script}</script></body></html>`;
  const manifest = { version: 1, kind: 'rehearsal_inspection', scoreHash: checked.scoreHash, geometryVersion: GEOMETRY_VERSION, contactPolicy: CONTACT_POLICY, source: 'operator_saved_score', humanReview: 'not_run', containsGuessText: false, omitted: ['title', 'notes', 'meaning', 'candidateId'], files: ['inspection.html', 'score.json'] };
  const options = { mtime: new Date(2000, 0, 1), level: 6 as const };
  return zipSync({ 'inspection.html': [strToU8(html), options], 'score.json': [strToU8(canonicalJson(checked.score)), options], 'inspection-manifest.json': [strToU8(JSON.stringify(manifest, null, 2) + '\n'), options] });
}
