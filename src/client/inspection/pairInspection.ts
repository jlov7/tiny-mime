import { z } from 'zod';
import { zipSync, strToU8 } from 'fflate';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { canonicalJson, canonicalHash } from '../../shared/hash.js';
import { validateScore } from '../../shared/validateScore.js';
import { GEOMETRY_VERSION, CONTACT_POLICY, CONTACT_CERTIFICATE_VERSION, type MotionScoreV1, type Roster } from '../../shared/score.js';
import { pairInspectionHtml } from './pairTemplate.js';

const input = z.object({ score: z.unknown(), scoreHash: z.string().regex(/^[a-f0-9]{64}$/), source: z.enum(['authored_fixture', 'operator_saved_score', 'imported_score']) }).strict();
export type PairInspectionScore = { score: MotionScoreV1; scoreHash: string; source: 'authored_fixture' | 'operator_saved_score' | 'imported_score' };
function checked(value: PairInspectionScore) {
  const parsed = input.safeParse(value);
  if (!parsed.success) throw new Error('INVALID_PAIR_INSPECTION_INPUT');
  const raw = parsed.data.score as MotionScoreV1 | null;
  const roster = Array.isArray(raw?.actors) ? raw.actors.map(actor => ({ id: actor?.id, shape: actor?.shape, color: actor?.color })) as Roster : [];
  const result = validateScore(JSON.stringify(parsed.data.score), roster);
  if (!result.ok || result.scoreHash !== parsed.data.scoreHash) throw new Error('INVALID_PAIR_INSPECTION_SCORE');
  return { score: result.score, scoreHash: result.scoreHash, source: parsed.data.source, roster };
}
export function buildPairInspection(baseline: PairInspectionScore, revision: PairInspectionScore): Uint8Array {
  const left = checked(baseline), right = checked(revision);
  if (canonicalJson(left.roster) !== canonicalJson(right.roster)) throw new Error('INCOMPATIBLE_PAIR_INSPECTION_ROSTER');
  const html = pairInspectionHtml(left.score, right.score, left.scoreHash, right.scoreHash, [left.source, right.source]);
  const manifest = {
    version: 1, kind: 'rehearsal_pair_inspection',
    baseline: { label: 'Baseline', scoreHash: left.scoreHash, source: left.source },
    revision: { label: 'Revision', scoreHash: right.scoreHash, source: right.source },
    rosterHash: canonicalHash(left.roster), geometryVersion: GEOMETRY_VERSION, contactPolicy: CONTACT_POLICY, contactCertificateVersion: CONTACT_CERTIFICATE_VERSION,
    timelineBasis: 'shared_elapsed_score_reconstruction', shorterScore: 'hold_end_frame', recordedRound: false, runtimeAdaptation: false,
    humanReview: 'not_run', humanComprehension: 'not_run', semanticFidelity: 'not_run', comparativeEffect: 'not_run', containsGuessText: false,
    omitted: ['title', 'notes', 'meaning', 'guess', 'candidateId', 'sceneId', 'localPaths', 'providerConfiguration', 'operatorData'],
    files: [
      { name: 'pair-inspection.html', sha256: bytesToHex(sha256(new TextEncoder().encode(html))), representation: 'utf8' },
      { name: 'baseline-score.json', sha256: left.scoreHash, representation: 'canonical_json' },
      { name: 'revision-score.json', sha256: right.scoreHash, representation: 'canonical_json' },
    ],
  };
  const options = { mtime: new Date('2000-01-01T00:00:00Z'), level: 6 as const };
  return zipSync({
    'pair-inspection.html': [strToU8(html), options],
    'baseline-score.json': [strToU8(canonicalJson(left.score)), options],
    'revision-score.json': [strToU8(canonicalJson(right.score)), options],
    'pair-inspection-manifest.json': [strToU8(canonicalJson(manifest)), options],
  });
}
export function downloadPairInspection(baseline: PairInspectionScore, revision: PairInspectionScore): void {
  const bytes = buildPairInspection(baseline, revision);
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/zip' }));
  const link = document.createElement('a');
  link.href = url; link.download = 'tiny-mime-pair-inspection.zip';
  document.body.appendChild(link); try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
