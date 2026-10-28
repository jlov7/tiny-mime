import MR01 from './MR01.json' with { type: 'json' };
import MR02 from './MR02.json' with { type: 'json' };
import MR03 from './MR03.json' with { type: 'json' };
import MR04 from './MR04.json' with { type: 'json' };
import MR05 from './MR05.json' with { type: 'json' };
import type { MotionScoreV1 } from '../../shared/score.js';
import { validateScore } from '../../shared/validateScore.js';
import { canonicalJson } from '../../shared/hash.js';
import { CONTACT_CERTIFICATE_VERSION, GEOMETRY_VERSION, CONTACT_POLICY } from '../../shared/score.js';
export type MotionReference = { id: string; title: string; variants: { name: string; score: MotionScoreV1; scoreHash: string; source: 'mock_fixture'; validation: 'passed'; geometryVersion: 'svg-shapes-v1'; contactPolicy: 'noncontact-v1'; contactCertificateVersion: string }[] };
const references: MotionReference[] = Object.entries({MR01,MR02,MR03,MR04,MR05}).map(([id,pair]) => ({ id, title: pair.title, variants: Object.entries(pair.variants).map(([name,raw]) => {
  const result=validateScore(canonicalJson(raw),raw.actors as MotionScoreV1['actors']);
  if (!result.ok) throw new Error(`INVALID_REFERENCE ${id}/${name} ${JSON.stringify(result.errors)}`);
  return { name, score: result.score, scoreHash: result.scoreHash, source: 'mock_fixture', validation: 'passed', geometryVersion: GEOMETRY_VERSION, contactPolicy: CONTACT_POLICY, contactCertificateVersion: CONTACT_CERTIFICATE_VERSION };
}) }));
export function listReferences(): MotionReference[] { return structuredClone(references); }
export function getReference(id: string): MotionReference | undefined { const pair = references.find(pair => pair.id===id); return pair && structuredClone(pair); }
