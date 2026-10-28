import type { MotionScoreV1, ScoreError } from './score.js';
import { sampleActor, segmentAt, centerSpeed } from './sampleScore.js';
export const CONTACT_THRESHOLD = 129;
export const CONTACT_EPSILON = 0.000001;

export function certifyContact(score: MotionScoreV1): ScoreError[] {
  for (let aIndex = 0; aIndex < score.actors.length; aIndex++) for (let bIndex = aIndex + 1; bIndex < score.actors.length; bIndex++) {
    const a = score.actors[aIndex], b = score.actors[bIndex];
    const times = [...new Set([...a.keyframes, ...b.keyframes].map(k => k.tMs))].sort((x,y) => x-y);
    let visited = 0;
    const distance = (t: number) => { const x = sampleActor(a,t), y = sampleActor(b,t); return Math.hypot(x.x-y.x,x.y-y.y); };
    for (let interval = 0; interval < times.length - 1; interval++) {
      const mid = (times[interval] + times[interval+1])/2;
      const ai = segmentAt(a,mid), bi = segmentAt(b,mid);
      const L = centerSpeed(a.keyframes[ai],a.keyframes[ai+1]) + centerSpeed(b.keyframes[bi],b.keyframes[bi+1]);
      const stack = [{ lo: times[interval], hi: times[interval+1], depth: 0 }];
      const path = `/pairs/${a.id}-${b.id}/intervals/${interval}`;
      while (stack.length) {
        if (visited >= 131072) return [{ code: 'CONTACT_UNCERTAIN', path }];
        const { lo, hi, depth } = stack.pop()!; visited++;
        const m = (lo + hi)/2, dm = distance(m);
        if ([distance(lo),dm,distance(hi)].some(d => d <= CONTACT_THRESHOLD + CONTACT_EPSILON)) return [{ code: 'CONTACT', path }];
        if (dm - L*(hi-lo)/2000 > CONTACT_THRESHOLD + CONTACT_EPSILON) continue;
        if ((hi-lo)/1000 <= 0.0005 || depth >= 24 || visited >= 131072) return [{ code: 'CONTACT_UNCERTAIN', path }];
        // LIFO: push right first for the contract's left-first traversal.
        stack.push({ lo: m, hi, depth: depth+1 }, { lo, hi: m, depth: depth+1 });
      }
    }
  }
  return [];
}
