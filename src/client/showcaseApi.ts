import { z } from 'zod';
import { validateScore } from '../shared/validateScore.js';
import { request } from './request.js';

const key = z.strictObject({ tMs: z.number(), x: z.number(), y: z.number(), rotationDeg: z.number(), scaleX: z.number(), scaleY: z.number(), easing: z.enum(['linear', 'easeInOut']) });
const score = z.strictObject({ version: z.literal(1), durationMs: z.number(), stage: z.strictObject({ width: z.literal(1000), height: z.literal(700) }), actors: z.array(z.strictObject({ id: z.enum(['a', 'b', 'c']), shape: z.enum(['circle', 'square', 'triangle']), color: z.enum(['violet', 'amber', 'teal']), keyframes: z.array(key).min(2).max(24) })).min(2).max(3) });
const take = z.strictObject({ score, scoreHash: z.string().regex(/^[0-9a-f]{64}$/) });
const examplesSchema = z.strictObject({ examples: z.array(z.strictObject({ id: z.string().regex(/^TM(?:0[1-6]|0[89]|1[0-2])$/), title: z.string().min(1).max(200), exampleGuess: z.string().min(1).max(480), intention: z.string().min(1).max(1000), explanation: z.string().min(1).max(3000), source: z.literal('authored_fixture'), humanReview: z.literal('not_run'), left: take, right: take })).min(1).max(3) });
export type DirectingExample = z.infer<typeof examplesSchema>['examples'][number];
export async function getShowcases(signal?: AbortSignal): Promise<DirectingExample[]> {
  const data = examplesSchema.parse(await request('/api/operator/showcases', undefined, signal));
  if (new Set(data.examples.map(example => example.id)).size !== data.examples.length) throw new Error('INVALID_EXAMPLES');
  for (const example of data.examples) for (const take of [example.left, example.right]) {
    const result = validateScore(JSON.stringify(take.score), example.left.score.actors);
    if (!result.ok || result.scoreHash !== take.scoreHash) throw new Error('INVALID_SCORE');
  }
  return data.examples;
}
