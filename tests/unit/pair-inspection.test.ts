import { describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { unzipSync, strFromU8 } from 'fflate';
import { buildPairInspection, downloadPairInspection, type PairInspectionScore } from '../../src/client/inspection/pairInspection.js';
import { PAIR_SAMPLER, PAIR_FONT_CSS } from '../../src/client/inspection/pairAssets.js';
import { sampleScore } from '../../src/shared/sampleScore.js';
import { canonicalJson, scoreHash } from '../../src/shared/hash.js';
import type { MotionScoreV1 } from '../../src/shared/score.js';
import rawScore from '../../src/server/scores/TM01.json';
import { buildInspection } from '../../src/server/operator/inspection.js';
import { getScene } from '../../src/server/operator/sceneBank.js';

const score = () => structuredClone(rawScore) as MotionScoreV1;
const take = (value = score(), source: PairInspectionScore['source'] = 'authored_fixture'): PairInspectionScore => ({ score: value, scoreHash: scoreHash(value), source });
const bundle = () => unzipSync(buildPairInspection(take(), take(score(), 'operator_saved_score')));
describe('portable score pair inspection', () => {
  it('exports exactly four files with canonical scores, file hashes and bounded provenance', () => {
    const files = bundle();
    expect(Object.keys(files).sort()).toEqual(['baseline-score.json', 'pair-inspection-manifest.json', 'pair-inspection.html', 'revision-score.json']);
    expect(strFromU8(files['baseline-score.json'])).toBe(canonicalJson(score()));
    expect(strFromU8(files['revision-score.json'])).toBe(canonicalJson(score()));
    const manifest = JSON.parse(strFromU8(files['pair-inspection-manifest.json']));
    expect(manifest).toMatchObject({ kind: 'rehearsal_pair_inspection', baseline: { label: 'Baseline', scoreHash: scoreHash(score()), source: 'authored_fixture' }, revision: { label: 'Revision', source: 'operator_saved_score' }, geometryVersion: 'svg-shapes-v1', contactPolicy: 'noncontact-v1', contactCertificateVersion: 'lipschitz-union-v1', recordedRound: false, runtimeAdaptation: false, humanReview: 'not_run', humanComprehension: 'not_run', semanticFidelity: 'not_run', comparativeEffect: 'not_run' });
    for (const file of manifest.files) expect(createHash('sha256').update(files[file.name]).digest('hex')).toBe(file.sha256);
    expect(buildPairInspection(take(), take())).toEqual(buildPairInspection(take(), take()));
  });
  it('rejects invalid scores, changed hashes, unknown sources and extra wrapper/score metadata', () => {
    const invalid = score(); invalid.actors[0].keyframes[0].x = -1;
    const overlap = score(); overlap.actors[1].keyframes = structuredClone(overlap.actors[0].keyframes);
    for (const value of [take(invalid), take(overlap), { ...take(), scoreHash: '0'.repeat(64) }, { ...take(), source: 'runtime_generated' }, { ...take(), title: '</script><script>fetch("https://example.invalid")</script>' }, { ...take(), notes: ['private'], meaning: 'secret', candidateId: randomUUID(), localPath: '/private/operator' }, take({ ...score(), guess: 'private' } as MotionScoreV1)]) {
      expect(() => buildPairInspection(value as PairInspectionScore, take())).toThrow();
    }
    const unknownKey = score(); (unknownKey.actors[0].keyframes[0] as any).notes = 'private';
    expect(() => buildPairInspection(take(), take(unknownKey))).toThrow();
  });
  it('requires identical actor identity, appearance and paint order while allowing unequal durations', () => {
    const changed = score(); changed.actors[0].shape = 'triangle';
    expect(() => buildPairInspection(take(), take(changed))).toThrow('INCOMPATIBLE_PAIR_INSPECTION_ROSTER');
    const reordered = score(); reordered.actors.reverse();
    expect(() => buildPairInspection(take(), take(reordered))).toThrow();
    const longer = score(); longer.durationMs += 1000;
    longer.actors.forEach(actor => { actor.keyframes.at(-1)!.tMs = longer.durationMs; });
    expect(() => buildPairInspection(take(), take(longer, 'imported_score'))).not.toThrow();
  });
  it('has a hashed CSP, embedded licensed font, paused manual transport and no network or storage APIs', () => {
    const html = strFromU8(bundle()['pair-inspection.html']);
    const script = html.match(/<script>([\s\S]*)<\/script>/)![1], style = html.match(/<style>([\s\S]*)<\/style>/)![1];
    for (const [kind, content] of [['script', script], ['style', style]]) expect(html).toContain(`${kind}-src 'sha256-${createHash('sha256').update(content).digest('base64')}'`);
    expect(html).toContain("connect-src 'none'"); expect(html).toContain("default-src 'none'"); expect(html).not.toContain('unsafe-inline');
    expect(style).toContain('data:font/woff2;base64,'); expect(style).toContain('SIL OPEN FONT LICENSE');
    expect(script).not.toMatch(/\bfetch\b|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB|sendBeacon/);
    expect(script).toContain('playing=false'); expect(script).toContain("visibilitychange"); expect(script).toContain("prefers-reduced-motion");
    expect(html).toContain('not a recorded round, runtime adaptation');
    expect(PAIR_FONT_CSS).toContain(readFileSync('src/client/assets/BricolageGrotesque-OFL.txt', 'utf8'));
  });
  it('embeds the exact shared sampler, including own fields, segment endpoints and end holds', () => {
    const sample = runInNewContext(PAIR_SAMPLER + ';sampleScore') as typeof sampleScore;
    for (const name of readdirSync('src/server/scores').filter(name => name.endsWith('.json'))) {
      const value = JSON.parse(readFileSync(`src/server/scores/${name}`, 'utf8')) as MotionScoreV1;
      const times = [-1, 0, 123.456, value.durationMs, value.durationMs + 500, ...value.actors.flatMap(actor => actor.keyframes.flatMap(key => [key.tMs - 0.001, key.tMs, key.tMs + 0.001]))];
      for (const time of times) {
        const actual = sample(value, time), expected = sampleScore(value, time);
        expect(JSON.parse(JSON.stringify(actual))).toEqual(expected);
        actual.forEach((frame, index) => expect(Object.keys(frame)).toEqual(Object.keys(expected[index])));
      }
    }
  });
  it('leaves the existing candidate inspection format unchanged', () => {
    const scene = getScene('TM01')!;
    const files = unzipSync(buildInspection({ candidateId: randomUUID(), sceneId: scene.id, title: 'Never exported', scoreHash: scene.scoreHash, parentCandidateId: null, createdAt: '2026-10-27T00:00:00Z', noteCount: 0, score: scene.score, notes: [] }));
    expect(Object.keys(files).sort()).toEqual(['inspection-manifest.json', 'inspection.html', 'score.json']);
    expect(JSON.parse(strFromU8(files['inspection-manifest.json'])).kind).toBe('rehearsal_inspection');
  });
  it('downloads the generated ZIP with a fixed filename and releases its object URL', () => {
    const clicked: string[] = [], removed: boolean[] = [], revoked: string[] = [];
    const link = { href: '', download: '', click() { clicked.push(this.download); }, remove() { removed.push(true); } };
    const original = { document: globalThis.document, create: URL.createObjectURL, revoke: URL.revokeObjectURL, timeout: globalThis.setTimeout };
    let blob: Blob | undefined;
    try {
      globalThis.document = { createElement: () => link, body: { appendChild: () => {} } } as unknown as Document;
      URL.createObjectURL = value => { blob = value as Blob; return 'blob:local-pair'; };
      URL.revokeObjectURL = url => { revoked.push(url); };
      globalThis.setTimeout = ((callback: () => void) => { callback(); return 0; }) as unknown as typeof setTimeout;
      downloadPairInspection(take(), take());
      expect(blob?.type).toBe('application/zip'); expect(blob!.size).toBeGreaterThan(1000);
      expect(link.href).toBe('blob:local-pair'); expect(clicked).toEqual(['tiny-mime-pair-inspection.zip']); expect(removed).toEqual([true]); expect(revoked).toEqual(['blob:local-pair']);
    } finally { globalThis.document = original.document; URL.createObjectURL = original.create; URL.revokeObjectURL = original.revoke; globalThis.setTimeout = original.timeout; }
  });
});
