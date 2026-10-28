import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { certifyContact } from '../../src/shared/contact.js';
import { validateScore } from '../../src/shared/validateScore.js';
import { sampleScore } from '../../src/shared/sampleScore.js';
import type { ActorV1, KeyframeV1, MotionScoreV1 } from '../../src/shared/score.js';
const key = (tMs:number,x:number,y=350,easing:KeyframeV1['easing']='linear'):KeyframeV1 => ({tMs,x,y,rotationDeg:0,scaleX:1,scaleY:1,easing});
function score(a:KeyframeV1[],b:KeyframeV1[]):MotionScoreV1 { return {version:1,durationMs:6000,stage:{width:1000,height:700},actors:[{id:'a',shape:'circle',color:'violet',keyframes:a},{id:'b',shape:'square',color:'amber',keyframes:b}]}; }
const stationary=(gap:number)=>score([key(0,300),key(6000,300)],[key(0,300+gap),key(6000,300+gap)]);

// Independent continuous oracle: cubic center polynomials -> degree-six
// squared-distance polynomial -> Bernstein convex hull, subdivided in 80-digit
// arithmetic. It never uses sampled frames, engine easing or speed bounds.
Decimal.set({precision:80});
const D=(x:Decimal.Value)=>new Decimal(x);
const add=(a:Decimal[],b:Decimal[])=>Array.from({length:Math.max(a.length,b.length)},(_,i)=>(a[i]??D(0)).plus(b[i]??0));
const mul=(a:Decimal[],b:Decimal[])=>{const out=Array.from({length:a.length+b.length-1},()=>D(0));a.forEach((x,i)=>b.forEach((y,j)=>out[i+j]=out[i+j].plus(x.mul(y))));return out;};
function coordinate(actor:ActorV1,lo:number,hi:number,field:'x'|'y'):Decimal[] {
  const k=actor.keyframes;let index=0;while(index<k.length-2 && lo>=k[index+1].tMs)index++;
  const a=k[index],b=k[index+1],span=D(b.tMs).minus(a.tMs);
  const u=[D(lo).minus(a.tMs).div(span),D(hi).minus(lo).div(span)];
  const p=a.easing==='linear'?u:add(mul(u,u).map(x=>x.mul(3)),mul(mul(u,u),u).map(x=>x.mul(-2)));
  const delta=D(b[field]).minus(a[field]);return add([D(a[field])],p.map(x=>x.mul(delta)));
}
function choose(n:number,k:number):number { let x=1;for(let i=1;i<=k;i++)x=x*(n-i+1)/i;return x; }
function splitHull(values:Decimal[]):[Decimal[],Decimal[]] {let row=values;const left=[row[0]],right=[row.at(-1)!];while(row.length>1){row=row.slice(0,-1).map((x,i)=>x.plus(row[i+1]).div(2));left.push(row[0]);right.unshift(row.at(-1)!);}return [left,right];}
function polynomialStatus(coefficients:Decimal[]):'safe'|'contact'|'unknown' {
  const bernstein=Array.from({length:7},(_,k)=>coefficients.slice(0,k+1).reduce((sum,a,i)=>sum.plus(a.mul(choose(k,i)).div(choose(6,i))),D(0)));
  const stack:[Decimal[],number][]=[[bernstein,0]];let visits=0;
  while(stack.length){const [values,depth]=stack.pop()!;if(++visits>200000)return 'unknown';
    if(values.every(x=>x.gt('1e-60')))continue;
    if(values[0].lte(0)||values.at(-1)!.lte(0)||values.every(x=>x.lt('-1e-60')))return 'contact';
    if(depth===60)return 'unknown';const [left,right]=splitHull(values);stack.push([right,depth+1],[left,depth+1]);
  }return 'safe';
}
function oracle(input:MotionScoreV1):'safe'|'contact'|'unknown' {
  for(let i=0;i<input.actors.length;i++)for(let j=i+1;j<input.actors.length;j++){
    const a=input.actors[i],b=input.actors[j],times=[...new Set([...a.keyframes,...b.keyframes].map(k=>k.tMs))].sort((a,b)=>a-b);
    for(let k=0;k<times.length-1;k++){
      const dx=add(coordinate(a,times[k],times[k+1],'x'),coordinate(b,times[k],times[k+1],'x').map(x=>x.negated()));
      const dy=add(coordinate(a,times[k],times[k+1],'y'),coordinate(b,times[k],times[k+1],'y').map(x=>x.negated()));
      const distance=add(mul(dx,dx),mul(dy,dy));distance[0]=distance[0].minus(D(129).pow(2));
      const status=polynomialStatus(distance);if(status!=='safe')return status;
    }
  }return 'safe';
}

describe('continuous clearance certificate',()=>{
  it('C01 static 150, zero Lipschitz certifies',()=>expect(certifyContact(stationary(150))).toEqual([]));
  it('C02 threshold 129 rejects',()=>expect(certifyContact(stationary(129))[0].code).toBe('CONTACT'));
  it('C03 numerical margin rejects 129.0000005',()=>expect(certifyContact(stationary(129.0000005))[0].code).toBe('CONTACT'));
  it('C04 distance 129.00001 passes static',()=>expect(certifyContact(stationary(129.00001))).toEqual([]));
  it('C05 safe endpoints, crossing at midpoint rejects',()=>{const s=score([key(0,200),key(6000,800)],[key(0,800),key(6000,200)]);expect(certifyContact(s)[0].code).toBe('CONTACT');expect(oracle(s)).toBe('contact');});
  it('C06 sub-60Hz unsafe near-pass, unmatched times/easing rejects',()=>{const s=score([key(0,300,300),key(1000,300,300),key(1250,450,300),key(6000,450,300)],[key(0,377.01,428.9999,'easeInOut'),key(900,377.01,428.9999,'easeInOut'),key(1600,377.01,428.9999),key(6000,377.01,428.9999)]);for(let t=0;t<=6000;t+=1000/60){const [a,b]=sampleScore(s,t);expect(Math.hypot(a.x-b.x,a.y-b.y)).toBeGreaterThan(129);}const result=certifyContact(s);expect(['CONTACT','CONTACT_UNCERTAIN']).toContain(result[0].code);expect(oracle(s)).toBe('contact');});
  it('C07 unresolved just-clear interval fails closed',()=>{const s=score([key(0,200,300),key(6000,800,300)],[key(0,499.97,429.00001),key(6000,499.97,429.00001)]);expect(certifyContact(s)[0].code).toBe('CONTACT_UNCERTAIN');expect(oracle(s)).toBe('safe');});
  it('C08 certifies all three pairs and reports only pair/interval',()=>{const s=stationary(150);s.actors.push({id:'c',shape:'triangle',color:'teal',keyframes:[key(0,550),key(6000,550)]});expect(certifyContact(s)).toEqual([{code:'CONTACT',path:'/pairs/b-c/intervals/0'}]);});
  it('C09 parallel travel with loose L adaptively certifies',()=>{const s=score([key(0,200,300,'easeInOut'),key(6000,600,300)],[key(0,350,300,'easeInOut'),key(6000,750,300)]);expect(certifyContact(s)).toEqual([]);expect(oracle(s)).toBe('safe');});
  it('C10 randomized adversarial pieces: zero accepted intersections against continuous high-precision oracle',()=>{
    let state=0x481737;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/2**32;};let accepted=0,rejected=0,contacts=0;
    for(let n=0;n<160;n++){
      const timesA=[0,1000,2750,4500,6000],timesB=[0,1250,2500,4750,6000];
      const tracks=[timesA,timesB].map((times,i)=>times.map((t,index)=>({ ...key(t,180+random()*640,(i===0?190:350)+random()*100,index===times.length-1?'linear':random()<.5?'linear':'easeInOut'),rotationDeg:random()*180-90,scaleX:.75+random()*.5,scaleY:.75+random()*.5 })));
      const s=score(tracks[0],tracks[1]),result=validateScore(JSON.stringify(s),s.actors),truth=oracle(s);if(truth==='contact')contacts++;
      if(result.ok){accepted++;expect(truth,`accepted case ${n}`).toBe('safe');}else rejected++;
    }expect(accepted).toBeGreaterThan(10);expect(rejected).toBeGreaterThan(10);expect(contacts).toBeGreaterThan(10);
  });
  it('independent oracle detects an off-midpoint tangency and analytically safe near-pass',()=>{expect(oracle(score([key(0,200,300),key(6000,800,300)],[key(0,477,429),key(6000,477,429)]))).not.toBe('safe');expect(oracle(score([key(0,200,300),key(6000,800,300)],[key(0,477,429.001),key(6000,477,429.001)]))).toBe('safe');});
});
