import { createHash } from 'node:crypto';
import { segmentAt, sampleActor, sampleScore } from '../../shared/sampleScore.js';
const STYLE='body{font:16px system-ui;background:#F7F3EA;color:#242330;margin:24px}main{max-width:900px;margin:auto}svg{width:100%;height:auto;border:1px solid #666}button,input{font:inherit;margin:8px;padding:8px}button:focus-visible,input:focus-visible{outline:3px solid #7357FF}pre{white-space:pre-wrap;overflow-wrap:anywhere}';
const PLAYER=`
const data=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(document.getElementById('payload').textContent),c=>c.charCodeAt(0))));
const byId=id=>document.getElementById(id),ns='http://www.w3.org/2000/svg',palette={violet:'#7357FF',amber:'#B56A00',teal:'#007F83'};
let time=0,playing=false,origin=null,raf=null;
byId('artifact').textContent='Artifact '+data.artifactId+'. Score hash '+data.scoreHash+'.';
byId('meaning').textContent=JSON.stringify(data.meaning,null,2);
byId('motion').checked=!matchMedia('(prefers-reduced-motion: reduce)').matches;
const keys=[...new Set(data.score.actors.flatMap(a=>a.keyframes.map(k=>k.tMs)))].sort((a,b)=>a-b);
function draw(){byId('stage').replaceChildren();for(const f of sampleScore(data.score,time)){const shape=document.createElementNS(ns,f.shape==='circle'?'circle':f.shape==='square'?'rect':'polygon');if(f.shape==='circle')shape.setAttribute('r','40');else if(f.shape==='square'){shape.setAttribute('x','-32');shape.setAttribute('y','-32');shape.setAttribute('width','64');shape.setAttribute('height','64');}else shape.setAttribute('points','0,-48 '+24*Math.sqrt(3)+',24 '+(-24*Math.sqrt(3))+',24');shape.setAttribute('fill',palette[f.color]);shape.setAttribute('transform','translate('+f.x+' '+f.y+') rotate('+f.rotationDeg+') scale('+f.scaleX+' '+f.scaleY+')');byId('stage').appendChild(shape);}byId('scrub').value=String(time);byId('position').textContent=(time/1000).toFixed(1)+' / '+data.score.durationMs/1000+' seconds';}
function pause(){playing=false;if(raf!==null)cancelAnimationFrame(raf);raf=null;origin=null;byId('play').textContent='Play';}
function tick(now){if(!playing)return;if(origin===null)origin=now-time;time=Math.min(data.score.durationMs,now-origin);draw();if(time>=data.score.durationMs)pause();else raf=requestAnimationFrame(tick);}
byId('scrub').max=String(data.score.durationMs);
byId('scrub').addEventListener('input',()=>{pause();time=Number(byId('scrub').value);draw();});
byId('play').addEventListener('click',()=>{if(playing){pause();return;}if(!byId('motion').checked){byId('step').click();return;}if(time>=data.score.durationMs)time=0;playing=true;origin=null;byId('play').textContent='Pause';raf=requestAnimationFrame(tick);});
byId('replay').addEventListener('click',()=>{pause();time=0;draw();});
byId('step').addEventListener('click',()=>{pause();time=keys.find(k=>k>time)??data.score.durationMs;draw();});
byId('motion').addEventListener('change',pause);document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});draw();
`;
export function fidelityHtml(data:{artifactId:string;score:unknown;scoreHash:unknown;meaning:unknown}):string {
  const script=`const __name=(fn)=>fn;\n${segmentAt.toString()}\n${sampleActor.toString()}\n${sampleScore.toString()}\n${PLAYER}`;
  const hash=(text:string)=>createHash('sha256').update(text).digest('base64');
  const csp=`default-src 'none';script-src 'sha256-${hash(script)}';style-src 'sha256-${hash(STYLE)}';connect-src 'none';img-src 'none';font-src 'none';media-src 'none';object-src 'none';base-uri 'none';form-action 'none'`;
  const encoded=Buffer.from(JSON.stringify(data),'utf8').toString('base64');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>Masked artifact review</title><style>${STYLE}</style></head><body><main><h1>Masked artifact review</h1><p id="artifact"></p><p>Independent human fidelity review. Empirical qualification NOT RUN. Assess target_preserved, unclear, changed_story or unrateable.</p><svg id="stage" viewBox="0 0 1000 700" role="img" aria-label="Silent geometric performance"></svg><button id="play">Play</button><button id="replay">Replay</button><button id="step">Next keyframe</button><label><input type="checkbox" id="motion">Full motion</label><label>Position <input type="range" id="scrub" min="0" value="0" step="1"></label><p id="position"></p><h2>Frozen meaning</h2><pre id="meaning"></pre><div id="payload" hidden>${encoded}</div></main><script>${script}</script></body></html>`;
}
