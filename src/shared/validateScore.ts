import structural from './scoreStructural.js';
import type { MotionScoreV1, Roster, ScoreError, ValidationResult } from './score.js';
import { ParseFailure, parseJsonStrict } from './parseJson.js';
import { centerSpeed } from './sampleScore.js';
import { certifyContact } from './contact.js';
import { scoreHash } from './hash.js';
export function validateScore(raw: string, roster: Roster): ValidationResult {
  let value: unknown;
  try { value = parseJsonStrict(raw); } catch (error) { return { ok: false, errors: [{ code: error instanceof ParseFailure ? error.code : 'PARSE', path: error instanceof ParseFailure ? error.path : '/' }] }; }
  if (!structural(value)) return { ok: false, errors: (structural.errors ?? []).slice(0,20).map(e => ({ code: e.keyword === 'additionalProperties' ? 'UNKNOWN_KEY' : ['minimum','maximum'].includes(e.keyword) && /\/(x|y|rotationDeg|scaleX|scaleY)$/.test(e.instancePath) ? 'BOUNDS' : 'SCHEMA', path: e.instancePath || '/' })) };
  const input = value as MotionScoreV1;
  // Only explicitly reconstructed fields may cross the renderer boundary.
  const score: MotionScoreV1 = { version: 1, durationMs: input.durationMs, stage: { width: 1000, height: 700 }, actors: input.actors.map(a => ({ id: a.id, shape: a.shape, color: a.color, keyframes: a.keyframes.map(k => ({ tMs: k.tMs, x: k.x, y: k.y, rotationDeg: k.rotationDeg, scaleX: k.scaleX, scaleY: k.scaleY, easing: k.easing })) })) };
  if (roster.length !== score.actors.length || ['id','shape','color'].some(field => new Set(score.actors.map(a => a[field as 'id'])).size !== score.actors.length) || score.actors.some((a,i) => a.id !== ['a','b','c'][i] || !roster[i] || a.id !== roster[i].id || a.shape !== roster[i].shape || a.color !== roster[i].color)) return { ok: false, errors: [{ code: 'ROSTER', path: '/actors' }] };
  const errors: ScoreError[] = [];
  score.actors.forEach((a,i) => {
    const keys = a.keyframes;
    if (keys[0].tMs !== 0 || keys.at(-1)!.tMs !== score.durationMs || keys.at(-1)!.easing !== 'linear') errors.push({ code: 'TIMELINE', path: `/actors/${i}/keyframes` });
    for (let j=0; j<keys.length-1; j++) {
      const from = keys[j], to = keys[j+1], seconds = (to.tMs-from.tMs)/1000;
      const path = `/actors/${i}/keyframes/${j}`;
      if (seconds < .25) { errors.push({ code: 'TIMELINE', path }); continue; }
      const B = from.easing === 'linear' ? 1 : 1.5;
      if (centerSpeed(from,to) > 600+1e-9 || B*Math.abs(to.rotationDeg-from.rotationDeg)/seconds > 180+1e-9 || ['scaleX','scaleY'].some(field => B*Math.abs(to[field as 'scaleX']-from[field as 'scaleX'])/seconds > 1+1e-9)) errors.push({ code: 'SPEED', path });
    }
  });
  if (errors.length) return { ok: false, errors: errors.slice(0,20) };
  const contact = certifyContact(score);
  return contact.length ? { ok: false, errors: contact } : { ok: true, score, scoreHash: scoreHash(score) };
}
