import { getScene } from './sceneBank.js';
import opposingTravel from './prepared/TM01-opposing-travel-v2.json' with { type: 'json' };
import { validateScore } from '../../shared/validateScore.js';
import type { MotionScoreV1 } from '../../shared/score.js';

const examples = [
  { id: 'TM01', title: 'Opposing travel, alternating initiative', exampleGuess: 'They move together as if rehearsing a dance.', explanation: 'Prepared second take, version 2. The actors approach from opposite sides. The circle moves aside first, then the square follows. Their renewed advances stop short. On the next attempt the square moves aside first, then the circle follows. They return toward the centre line and end opposite each other, without passing. Compare the staggered starts and interrupted advances. This is a different authored directing choice, not an established improvement in meaning or enjoyment.', change(_score: MotionScoreV1) { return structuredClone(opposingTravel) as MotionScoreV1; } },
  { id: 'TM09', title: 'Make the copying delay easier to inspect', exampleGuess: 'Both actors are doing the same routine together.', explanation: 'The second authored version delays actor b by another quarter second, preserving its movement sequence. Compare who starts each movement. Whether this communicates copying more clearly still requires human observation.', change(score: MotionScoreV1) { score.actors[1].keyframes.slice(1, -1).forEach(key => { key.tMs += 250; }); } },
  { id: 'TM04', title: 'Give the opening room to read', exampleGuess: 'The outer actors move away from the approaching actor.', explanation: 'The second authored version leaves the opening visible for longer before the arriving actor joins the group and settles in the opening. The direction and cast are unchanged. This does not establish that viewers infer the intended motive.', change(score: MotionScoreV1) { score.durationMs += 500; score.actors.forEach(actor => actor.keyframes.forEach(key => { if (key.tMs >= 4250) key.tMs += 500; })); } },
];

export function listShowcases() {
  return examples.map(({ change, ...example }) => {
    const scene = getScene(example.id)!;
    const copy = structuredClone(scene.score); const alternate = change(copy) ?? copy;
    const result = validateScore(JSON.stringify(alternate), scene.roster);
    if (!result.ok) throw new Error('INVALID_SHOWCASE');
    return { ...example, intention: scene.meaning.target, source: 'authored_fixture' as const, humanReview: 'not_run' as const, left: { score: scene.score, scoreHash: scene.scoreHash }, right: { score: result.score, scoreHash: result.scoreHash } };
  });
}
