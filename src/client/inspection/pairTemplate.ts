import { PAIR_FONT_CSS, PAIR_SAMPLER } from './pairAssets.js';
import { sha256 } from '@noble/hashes/sha2.js';
import type { MotionScoreV1 } from '../../shared/score.js';

export function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
const hash = (text: string) => base64(sha256(new TextEncoder().encode(text)));
const STYLE = PAIR_FONT_CSS + `
:root{font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#242622;background:#F6F2E9;font-synthesis:none;line-height:1.5}*{box-sizing:border-box}body{margin:0;padding:24px}main{max-width:1120px;margin:auto}h1{font-size:clamp(32px,4vw,40px);font-weight:650;letter-spacing:-.035em;line-height:1.12;margin:0 0 8px}p{overflow-wrap:anywhere;max-width:76ch}header p{margin:0 0 20px}.panes{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px}figure{margin:0;min-width:0}svg{display:block;width:100%;height:auto;aspect-ratio:10/7;background:#F7F3EA;outline:1px solid #d6d1c5}figcaption{display:flex;justify-content:space-between;gap:8px;margin:8px 0 16px}figcaption span,#position{font-variant-numeric:tabular-nums}button,input{font:inherit}button{min-height:44px;min-width:44px;padding:10px 16px;background:#fffdf7;color:#242622;border:1px solid #7b8374;border-radius:8px;cursor:pointer}button:hover{background:#e9e6dd}button:focus-visible,input:focus-visible,summary:focus-visible{outline:3px solid #242622;outline-offset:3px}.buttons{display:flex;flex-wrap:wrap;gap:8px}#play{background:#2B675A;color:#fff;border-color:#2B675A}#play:hover{background:#24564b}label{display:flex;align-items:center;gap:10px;margin:12px 0;min-height:44px}input[type=checkbox]{width:20px;height:20px;accent-color:#2B675A}.timeline{display:block}input[type=range]{display:block;width:100%;min-height:44px;accent-color:#2B675A}details{margin-top:20px;color:#555A53}summary{cursor:pointer;min-height:44px;padding-block:10px}details p{font-size:14px}.take-switch,.phone-help{display:none}button[aria-pressed=true]{background:#e1e7df;border-color:#2B675A}code{overflow-wrap:anywhere}[hidden]{display:none}::selection{background:#d5e7dc;color:#242622}
@media(max-width:700px){body{padding:20px 16px}.panes{display:block}.panes figure:not(.selected){display:none}.take-switch{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}.phone-help{display:block;margin:0 0 12px}header p{margin-bottom:12px}figcaption{flex-wrap:wrap}details{margin-top:12px}}
`;
const PLAYER = `
const data=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(document.getElementById('payload').textContent),c=>c.charCodeAt(0))));
const scores=[data.baseline,data.revision],byId=id=>document.getElementById(id),ns='http://www.w3.org/2000/svg';
const duration=Math.max(...scores.map(s=>s.durationMs));
const times=[...new Set([0,duration,...scores.flatMap(s=>[s.durationMs,...s.actors.flatMap(a=>a.keyframes.map(k=>k.tMs))])])].sort((a,b)=>a-b);
const palette={violet:'#7357FF',amber:'#B56A00',teal:'#007F83'};
let elapsed=0,origin=0,raf=null,playing=false;
function transport(){byId('play').textContent=playing?'Pause pair':byId('frames').checked?(elapsed>=duration?'Replay frames':'Next keyframe'):(elapsed>=duration?'Replay pair':'Play pair');const status=playing?'Playing':elapsed>=duration?'Finished':'Paused';if(byId('status').textContent!==status)byId('status').textContent=status;}
function render(){
  scores.forEach((score,index)=>{
    const stage=byId('stage-'+index);stage.replaceChildren();
    for(const frame of sampleScore(score,elapsed)){
      const shape=document.createElementNS(ns,frame.shape==='circle'?'circle':frame.shape==='square'?'rect':'polygon');
      if(frame.shape==='circle')shape.setAttribute('r','40');
      else if(frame.shape==='square'){shape.setAttribute('x','-32');shape.setAttribute('y','-32');shape.setAttribute('width','64');shape.setAttribute('height','64');}
      else shape.setAttribute('points','0,-48 '+24*Math.sqrt(3)+',24 '+(-24*Math.sqrt(3))+',24');
      shape.setAttribute('fill',palette[frame.color]);shape.setAttribute('transform','translate('+frame.x+' '+frame.y+') rotate('+frame.rotationDeg+') scale('+frame.scaleX+' '+frame.scaleY+')');stage.appendChild(shape);
    }
    byId('position-'+index).textContent=(Math.min(elapsed,score.durationMs)/1000).toFixed(2)+' / '+(score.durationMs/1000).toFixed(2)+' s'+(elapsed>=score.durationMs?' · End frame':'');
  });
  byId('timeline').value=elapsed;byId('timeline').setAttribute('aria-valuetext',(elapsed/1000).toFixed(2)+' of '+(duration/1000).toFixed(2)+' seconds');byId('position').textContent=(elapsed/1000).toFixed(2)+' / '+(duration/1000).toFixed(2)+' seconds';transport();
}
function pause(){playing=false;if(raf!==null)cancelAnimationFrame(raf);raf=null;transport();}
function seek(time){pause();elapsed=Math.max(0,Math.min(duration,time));render();}
function step(direction){seek(direction>0?(times.find(t=>t>elapsed)??duration):([...times].reverse().find(t=>t<elapsed)??0));}
function tick(now){if(!playing||document.hidden){pause();return;}elapsed=Math.min(duration,now-origin);render();if(elapsed>=duration)pause();else raf=requestAnimationFrame(tick);}
const preference=matchMedia('(prefers-reduced-motion: reduce)');byId('frames').checked=preference.matches;
byId('play').addEventListener('click',()=>{if(playing){pause();return;}if(byId('frames').checked){if(elapsed>=duration)seek(0);else step(1);return;}if(document.hidden)return;if(elapsed>=duration)elapsed=0;origin=performance.now()-elapsed;playing=true;render();raf=requestAnimationFrame(tick);});
byId('reset').addEventListener('click',()=>seek(0));byId('previous').addEventListener('click',()=>step(-1));byId('next').addEventListener('click',()=>step(1));
byId('timeline').addEventListener('input',event=>seek(Number(event.target.value)));byId('frames').addEventListener('change',pause);
[0,1].forEach(index=>byId('take-'+index).addEventListener('click',()=>{pause();[0,1].forEach(i=>{byId('pane-'+i).classList.toggle('selected',i===index);byId('take-'+i).setAttribute('aria-pressed',String(i===index));});}));
preference.addEventListener('change',event=>{byId('frames').checked=event.matches;pause();});document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
render();
`;
export function pairInspectionHtml(baseline: MotionScoreV1, revision: MotionScoreV1, baselineHash: string, revisionHash: string, sources: readonly ['authored_fixture' | 'operator_saved_score' | 'imported_score', 'authored_fixture' | 'operator_saved_score' | 'imported_score']): string {
  const script = PAIR_SAMPLER + '\n' + PLAYER;
  const csp = `default-src 'none'; script-src 'sha256-${hash(script)}'; style-src 'sha256-${hash(STYLE)}'; connect-src 'none'; img-src 'none'; font-src data:; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  const sourceLabels = { authored_fixture: 'Authored fixture', operator_saved_score: 'Operator-saved score', imported_score: 'Imported score' };
  const payload = base64(new TextEncoder().encode(JSON.stringify({ baseline, revision })));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>Tiny Mime pair inspection</title><style>${STYLE}</style></head><body><main><header><h1>Rehearsal pair inspection</h1><p>Baseline and revision on one clock. Play or inspect the same moment.</p></header><div class="take-switch" role="group" aria-label="Visible take"><button id="take-0" aria-pressed="true" aria-controls="pane-0">Baseline</button><button id="take-1" aria-pressed="false" aria-controls="pane-1">Revision</button></div><p class="phone-help">Same moment. Switching pauses.</p><div class="panes">${['Baseline','Revision'].map((label,index)=>`<figure id="pane-${index}" class="${index===0?'selected':''}"><svg id="stage-${index}" viewBox="0 0 1000 700" role="img" aria-label="${label} silent geometric performance"></svg><figcaption><strong>${label}</strong><span id="position-${index}"></span></figcaption></figure>`).join('')}</div><section aria-label="Pair playback controls"><div class="buttons"><button id="play">Play pair</button><button id="reset">Reset pair</button><button id="previous">Previous pair keyframe</button><button id="next">Next pair keyframe</button></div><p id="status" role="status">Paused</p><label><input id="frames" type="checkbox"> Frame by frame</label><label class="timeline" for="timeline">Pair timeline<input id="timeline" type="range" min="0" max="${Math.max(baseline.durationMs,revision.durationMs)}" step="1" value="0"></label><p id="position"></p></section><details><summary>About this pair and its limits</summary><p>A shorter take holds its end frame. These are numerical score reconstructions. This artifact is not a recorded round, runtime adaptation or AI quality result. Numerical validity does not establish meaning, quality or improvement. Human review, comprehension, enjoyment, scene calibration, semantic fidelity, comparative effect, actual assistive-technology use, physical-device and live-provider qualification: NOT RUN.</p><p>Baseline source: ${sourceLabels[sources[0]]}. Revision source: ${sourceLabels[sources[1]]}. Operator text and identifiers are omitted. The visual activity has no nonvisual equivalent. Application code: MIT. Embedded display font: SIL Open Font License 1.1.</p><p>Baseline hash: <code>${baselineHash}</code><br>Revision hash: <code>${revisionHash}</code></p></details><div id="payload" hidden>${payload}</div></main><script>${script}</script></body></html>`;
}
