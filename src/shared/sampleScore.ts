import type { ActorV1, ActorFrame, MotionScoreV1, Frame, KeyframeV1 } from './score.js';
export function segmentAt(actor: ActorV1, tMs: number): number {
  let index = 0;
  while (index < actor.keyframes.length - 2 && tMs >= actor.keyframes[index + 1].tMs) index++;
  return index;
}
export function sampleActor(actor: ActorV1, tMs: number): ActorFrame {
  const i = segmentAt(actor, tMs), from = actor.keyframes[i], to = actor.keyframes[i + 1];
  const u = Math.min(1, Math.max(0, (tMs - from.tMs) / (to.tMs - from.tMs)));
  const p = from.easing === 'linear' ? u : u*u*(3-2*u);
  const mix = (field: 'x'|'y'|'rotationDeg'|'scaleX'|'scaleY') => p === 0 ? from[field] : p === 1 ? to[field] : from[field] + (to[field] - from[field])*p;
  return { id: actor.id, shape: actor.shape, color: actor.color, x: mix('x'), y: mix('y'), rotationDeg: mix('rotationDeg'), scaleX: mix('scaleX'), scaleY: mix('scaleY') };
}
export function sampleScore(score: MotionScoreV1, elapsedMs: number): Frame {
  const tMs = Math.max(0, Math.min(score.durationMs, elapsedMs));
  return score.actors.map(actor => sampleActor(actor, tMs));
}
export function centerSpeed(from: KeyframeV1, to: KeyframeV1): number {
  return (from.easing === 'linear' ? 1 : 1.5)*Math.hypot(to.x-from.x,to.y-from.y)/((to.tMs-from.tMs)/1000);
}
