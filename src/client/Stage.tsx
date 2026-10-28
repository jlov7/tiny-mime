import type { MotionScoreV1 } from '../shared/score.js';
import { sampleScore } from '../shared/sampleScore.js';

const palette = { violet: '#7357FF', amber: '#B56A00', teal: '#007F83' };
export function Stage({ score, elapsedMs }: { score: MotionScoreV1; elapsedMs: number }) {
  const frame = sampleScore(score, elapsedMs);
  return <svg className="stage" viewBox="0 0 1000 700" role="img" aria-label="Silent geometric animation. This guessing activity requires viewing motion. You can skip to the written reveal.">
    <rect width="1000" height="700" fill="#F7F3EA" />
    {score.actors.map((actor, index) => {
      const pose = frame[index];
      return <g key={actor.id} data-actor={actor.id} transform={`translate(${pose.x} ${pose.y}) rotate(${pose.rotationDeg}) scale(${pose.scaleX} ${pose.scaleY})`} fill={palette[actor.color]}>
        {actor.shape === 'circle' ? <circle r="40" /> : actor.shape === 'square' ? <rect x="-32" y="-32" width="64" height="64" /> : <polygon points={`0,-48 ${24 * Math.sqrt(3)},24 ${-24 * Math.sqrt(3)},24`} />}
      </g>;
    })}
  </svg>;
}
