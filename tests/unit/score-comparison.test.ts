import { describe, expect, it } from 'vitest';
import type { MotionScoreV1 } from '../../src/shared/score.js';
import { compareScores, comparisonKeyTimes, scoreChangeDetails } from '../../src/shared/compareScores.js';
import rawScore from '../../src/server/scores/TM01.json';
import delayedScore from '../../src/server/scores/TM09.json';

const score = () => structuredClone(rawScore) as MotionScoreV1;
describe('exact numeric score comparison', () => {
  it('reports repeated fixture takes without suggesting improvement', () => {
    const left = score(); expect(compareScores(left, structuredClone(left))).toEqual({ compatibleActors: true, durationChangeMs: 0, addedKeys: 0, removedKeys: 0, changedKeys: 0, changedFields: 0 });
  });
  it('counts exact changed fields at matching actor times, including easing', () => {
    const left = score(); const right = score(); right.actors[0].keyframes[1].x += 10; right.actors[0].keyframes[1].rotationDeg += 5;
    right.actors[1].keyframes[1].easing = right.actors[1].keyframes[1].easing === 'linear' ? 'easeInOut' : 'linear';
    expect(compareScores(left, right)).toMatchObject({ compatibleActors: true, changedKeys: 2, changedFields: 3, addedKeys: 0, removedKeys: 0 });
  });
  it('counts retimed keys as additions/removals and compares duration separately', () => {
    const left = score(); const right = score(); right.actors[0].keyframes[1].tMs += 1; right.durationMs += 500;
    expect(compareScores(left, right)).toMatchObject({ durationChangeMs: 500, addedKeys: 1, removedKeys: 1, changedFields: 0 });
  });
  it('does not compare fields when cast identity, appearance or paint order differs', () => {
    for (const change of [(right: MotionScoreV1) => right.actors.reverse(), (right: MotionScoreV1) => right.actors.pop(), (right: MotionScoreV1) => { right.actors[0].shape = 'triangle'; }, (right: MotionScoreV1) => { right.actors[0].color = 'teal'; }]) {
      const left = score(); const right = score(); change(right);
      expect(compareScores(left, right)).toMatchObject({ compatibleActors: false, changedKeys: 0, changedFields: 0 });
    }
  });
  it('steps the ordered union of both takes, including unequal clip ends', () => {
    const left = score(); const right = score(); right.durationMs += 1000; right.actors[0].keyframes[1].tMs += 1;
    const keys = comparisonKeyTimes(left, right); expect(keys).toEqual([...new Set([0, left.durationMs, right.durationMs, ...[left, right].flatMap(s => s.actors.flatMap(a => a.keyframes.map(k => k.tMs)))])].sort((a, b) => a - b));
    expect(keys.at(-1)).toBe(right.durationMs); expect(keys).toContain(left.durationMs);
  });
  it('locates a single-coordinate edit and its neighboring motion interval', () => {
    const left = score(); const right = score(); const key = left.actors[0].keyframes[1]; right.actors[0].keyframes[1].x += 10;
    expect(scoreChangeDetails(left, right)).toEqual([{ actorId: 'a', kind: 'fields', before: { keyIndex: 1, key }, after: { keyIndex: 1, key: right.actors[0].keyframes[1] }, fields: ['x'], fromMs: 0, toMs: left.actors[0].keyframes[2].tMs }]);
  });
  it('exposes all nine prepared TM09 timing changes without changing the matching-time totals', () => {
    const left = structuredClone(delayedScore) as MotionScoreV1; const right = structuredClone(left);
    right.actors[1].keyframes.slice(1, -1).forEach(key => { key.tMs += 250; });
    const details = scoreChangeDetails(left, right);
    expect(details).toHaveLength(9);
    expect(details.every(row => row.kind === 'timing' && row.actorId === 'b' && row.fields.join() === 'tMs' && row.after!.key.tMs - row.before!.key.tMs === 250)).toBe(true);
    expect(details[0]).toMatchObject({ before: { keyIndex: 1, key: { tMs: 2000 } }, after: { keyIndex: 1, key: { tMs: 2250 } }, fromMs: 0, toMs: 3000 });
    expect(details.at(-1)).toMatchObject({ fromMs: 6500, toMs: 8000 });
    expect(compareScores(left, right)).toMatchObject({ addedKeys: 9, removedKeys: 9 });
  });
  it('does not pair inserted or removed keys by index, even when the counts stay equal', () => {
    const left = score(); const right = score();
    right.actors[0].keyframes.splice(1, 1); const added = { ...right.actors[0].keyframes[1], tMs: right.actors[0].keyframes[1].tMs - 100, x: right.actors[0].keyframes[1].x + 1 }; right.actors[0].keyframes.splice(1, 0, added);
    const details = scoreChangeDetails(left, right);
    expect(details.map(row => row.kind).sort()).toEqual(['added', 'removed']);
    expect(details.find(row => row.kind === 'added')).toMatchObject({ before: null, after: { keyIndex: 1, key: added }, fields: [] });
    expect(details.find(row => row.kind === 'removed')).toMatchObject({ before: { keyIndex: 1, key: left.actors[0].keyframes[1] }, after: null, fields: [] });
    right.actors[0].keyframes.splice(1, 1);
    expect(scoreChangeDetails(left, right).map(row => row.kind)).toEqual(['removed']);
  });
  it('keeps exact easing values and does not offer detail for incompatible rosters or identical takes', () => {
    const left = score(); const right = score(); right.actors[0].keyframes[1].easing = 'linear';
    expect(scoreChangeDetails(left, right)[0]).toMatchObject({ kind: 'fields', fields: ['easing'], before: { key: { easing: 'easeInOut' } }, after: { key: { easing: 'linear' } } });
    expect(scoreChangeDetails(left, left)).toEqual([]); right.actors.reverse(); expect(scoreChangeDetails(left, right)).toEqual([]);
  });
});
