import type { KeyframeV1, MotionScoreV1 } from './score.js';

const fields = ['x', 'y', 'rotationDeg', 'scaleX', 'scaleY', 'easing'] as const satisfies readonly (keyof KeyframeV1)[];
export function comparisonKeyTimes(left: MotionScoreV1, right: MotionScoreV1): number[] {
  return [...new Set([0, left.durationMs, right.durationMs, ...[left, right].flatMap(score => score.actors.flatMap(actor => actor.keyframes.map(key => key.tMs)))])].sort((a, b) => a - b);
}
export function compareScores(left: MotionScoreV1, right: MotionScoreV1) {
  const compatibleActors = left.actors.length === right.actors.length && left.actors.every((actor, index) => {
    const other = right.actors[index]; return actor.id === other.id && actor.shape === other.shape && actor.color === other.color;
  });
  let addedKeys = 0; let removedKeys = 0; let changedKeys = 0; let changedFields = 0;
  if (compatibleActors) for (const actor of left.actors) {
    const other = right.actors.find(candidate => candidate.id === actor.id)!;
    for (const key of actor.keyframes) {
      const match = other.keyframes.find(candidate => candidate.tMs === key.tMs);
      if (!match) { removedKeys++; continue; }
      const changes = fields.filter(field => key[field] !== match[field]).length;
      changedFields += changes; if (changes) changedKeys++;
    }
    addedKeys += other.keyframes.filter(key => !actor.keyframes.some(candidate => candidate.tMs === key.tMs)).length;
  }
  return { compatibleActors, durationChangeMs: right.durationMs - left.durationMs, addedKeys, removedKeys, changedKeys, changedFields };
}

type StoredKey = { keyIndex: number; key: KeyframeV1 };
export type ScoreChangeDetail = {
  actorId: MotionScoreV1['actors'][number]['id']; kind: 'fields' | 'timing' | 'added' | 'removed';
  before: StoredKey | null; after: StoredKey | null; fields: (keyof KeyframeV1)[];
  fromMs: number; toMs: number;
};

export function scoreChangeDetails(left: MotionScoreV1, right: MotionScoreV1): ScoreChangeDetail[] {
  if (!compareScores(left, right).compatibleActors) return [];
  const details: ScoreChangeDetail[] = [];
  for (const [actorIndex, actor] of left.actors.entries()) {
    const other = right.actors[actorIndex];
    // Index timing is factual only while the entire stored pose/easing sequence is unchanged.
    const timingOnly = actor.keyframes.length === other.keyframes.length && actor.keyframes.every((key, index) => fields.every(field => key[field] === other.keyframes[index][field]));
    const add = (kind: ScoreChangeDetail['kind'], before: StoredKey | null, after: StoredKey | null, changed: (keyof KeyframeV1)[]) => {
      const neighbors = [[actor.keyframes, before], [other.keyframes, after]] as const;
      const starts = neighbors.flatMap(([keys, stored]) => stored ? [keys[Math.max(0, stored.keyIndex - 1)].tMs] : []);
      const ends = neighbors.flatMap(([keys, stored]) => stored ? [keys[Math.min(keys.length - 1, stored.keyIndex + 1)].tMs] : []);
      details.push({ actorId: actor.id, kind, before, after, fields: changed, fromMs: Math.min(...starts), toMs: Math.max(...ends) });
    };
    if (timingOnly) {
      actor.keyframes.forEach((key, keyIndex) => {
        const next = other.keyframes[keyIndex];
        if (key.tMs !== next.tMs) add('timing', { keyIndex, key }, { keyIndex, key: next }, ['tMs']);
      });
      continue;
    }
    actor.keyframes.forEach((key, keyIndex) => {
      const nextIndex = other.keyframes.findIndex(candidate => candidate.tMs === key.tMs);
      if (nextIndex < 0) { add('removed', { keyIndex, key }, null, []); return; }
      const next = other.keyframes[nextIndex]; const changed = fields.filter(field => key[field] !== next[field]);
      if (changed.length) add('fields', { keyIndex, key }, { keyIndex: nextIndex, key: next }, changed);
    });
    other.keyframes.forEach((key, keyIndex) => {
      if (!actor.keyframes.some(candidate => candidate.tMs === key.tMs)) add('added', null, { keyIndex, key }, []);
    });
  }
  return details.sort((a, b) => Math.min(a.before?.key.tMs ?? Infinity, a.after?.key.tMs ?? Infinity) - Math.min(b.before?.key.tMs ?? Infinity, b.after?.key.tMs ?? Infinity));
}
