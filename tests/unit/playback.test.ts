import { describe, expect, it } from 'vitest';
import { adjacentKey, PlaybackTraversal } from '../../src/client/usePlayback.js';
import type { MotionScoreV1 } from '../../src/shared/score.js';
import rawScore from '../../src/server/scores/TM01.json';

describe('playback traversal accounting', () => {
  it('keeps a single traversal through pause, Resume and visibility pauses', () => {
    const traversal = new PlaybackTraversal(); expect(traversal.start()).toBe(true);
    expect(traversal.start()).toBe(false); expect(traversal.start()).toBe(false);
    expect(traversal.complete()).toBe(true); expect(traversal.complete()).toBe(false);
    expect(traversal.start()).toBe(true);
  });
  it('Replay and score changes explicitly reset the traversal', () => {
    const traversal = new PlaybackTraversal(); traversal.start(); traversal.reset(); expect(traversal.start()).toBe(true);
    traversal.reset(); expect(traversal.complete()).toBe(false);
  });
  it('does not qualify a partial motion traversal as a complete viewing', () => {
    const traversal = new PlaybackTraversal(); expect(traversal.start(false)).toBe(true);
    expect(traversal.complete()).toBe(false);
    expect(traversal.start()).toBe(true); expect(traversal.complete()).toBe(true);
  });
  it('steps through the union of actor keyframes with clamped endpoints', () => {
    const score = rawScore as MotionScoreV1; const all = [...new Set(score.actors.flatMap(a => a.keyframes.map(k => k.tMs)))].sort((a, b) => a - b);
    let time = 0; for (const expected of all.slice(1)) { time = adjacentKey(score, time, 1); expect(time).toBe(expected); }
    expect(adjacentKey(score, time, 1)).toBe(score.durationMs);
    for (const expected of all.slice(0, -1).reverse()) { time = adjacentKey(score, time, -1); expect(time).toBe(expected); }
    expect(adjacentKey(score, time, -1)).toBe(0);
  });
});
