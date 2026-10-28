import { describe, expect, it } from 'vitest';
import { sampleScore } from '../../src/shared/sampleScore.js';
import type { MotionScoreV1 } from '../../src/shared/score.js';
const score: MotionScoreV1 = { version: 1, durationMs: 6000, stage: { width: 1000, height: 700 }, actors: ['a', 'b'].map((id, i) => ({ id: id as 'a'|'b', shape: i ? 'square' : 'circle', color: i ? 'amber' : 'violet', keyframes: [ { tMs: 0, x: 200 + i*400, y: 350, rotationDeg: 350, scaleX: 1, scaleY: 1, easing: 'easeInOut' }, { tMs: 3000, x: 300 + i*400, y: 350, rotationDeg: 10, scaleX: 1.2, scaleY: 0.8, easing: 'linear' }, { tMs: 6000, x: 350 + i*400, y: 350, rotationDeg: 0, scaleX: 1, scaleY: 1, easing: 'linear' } ] })) };
describe('canonical sampler', () => {
  it('P01 deterministic, canonical, clamped, exact keys', () => { for (const t of [-1,0,10,1500,3000,5999,6000,7000]) expect(sampleScore(score,t)).toEqual(sampleScore(score,t)); expect(sampleScore(score,-1)).toEqual(sampleScore(score,0)); expect(sampleScore(score,7000)).toEqual(sampleScore(score,6000)); expect(sampleScore(score,3000)[0].x).toBe(300); expect(sampleScore(score,3000).map(f=>f.id)).toEqual(['a','b']); });
  it('P02 literal unwrapped rotation and smoothstep arithmetic', () => { expect(sampleScore(score,1500)[0].rotationDeg).toBe(180); expect(sampleScore(score,750)[0].x).toBe(215.625); expect(sampleScore(score,1500)[0].scaleX).toBeCloseTo(1.1,9); });
  it('smoothstep stops on each side of key; linear outgoing joins', () => { const h=.001; expect((sampleScore(score,3000)[0].x-sampleScore(score,3000-h)[0].x)/h).toBeLessThan(1e-6); expect((sampleScore(score,3000+h)[0].x-sampleScore(score,3000)[0].x)/h).toBeCloseTo(50/3000,9); });
});
