import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPublicPreview } from '../../src/server/operator/publicPreview.js';
import * as showcase from '../../src/server/operator/showcase.js';
import { exportPublicPreview, runPublicPreview } from '../../scripts/public-preview.js';
import { getScene } from '../../src/server/operator/sceneBank.js';
import authoring from '../../src/server/operator/prepared/TM01-opposing-travel-v2.authoring.json';

const hash = (bytes: Buffer | string, encoding: 'hex' | 'base64' = 'hex') => createHash('sha256').update(bytes).digest(encoding);
const applicationVersion = JSON.parse(readFileSync('package.json', 'utf8')).version;
const scratch: string[] = [];
function temporary() { mkdirSync(resolve('.scratch'), { recursive: true }); const root = mkdtempSync(resolve('.scratch/public-preview-unit-')); scratch.push(root); return root; }
afterEach(() => { vi.restoreAllMocks(); scratch.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });

describe('offline public preview', () => {
  it('deterministically projects exactly the three authored pairs and records their exact hashes', () => {
    const first = buildPublicPreview(), second = buildPublicPreview();
    expect(first).toEqual(second);
    expect(first.manifest).toEqual({
      version: 1, kind: 'tiny_mime_offline_public_preview', applicationVersion, provenance: 'authored_fixture', adaptiveAI: false,
      qualifications: { humanComprehension: 'NOT RUN', enjoyment: 'NOT RUN', sceneCalibration: 'NOT RUN', comparativeEffect: 'NOT RUN', assistiveTechnology: 'NOT RUN', semanticFidelity: 'NOT RUN', liveProvider: 'NOT RUN', physicalDevice: 'NOT RUN' },
      file: { name: 'tiny-mime-preview.html', bytes: first.html.length, sha256: hash(first.html) },
      pairs: showcase.listShowcases().map(pair => ({ sceneId: pair.id, original: { scoreHash: pair.left.scoreHash, durationMs: pair.left.score.durationMs }, alternate: { scoreHash: pair.right.scoreHash, durationMs: pair.right.score.durationMs } })),
    });
    const text = first.html.toString();
    const payload = JSON.parse(Buffer.from(text.match(/<div id="payload" hidden>([^<]+)<\/div>/)![1]!, 'base64').toString());
    expect(payload.map((pair: { id: string }) => pair.id)).toEqual(['TM01', 'TM09', 'TM04']);
    expect(payload.map((pair: { exampleGuess: string }) => pair.exampleGuess)).toEqual(showcase.listShowcases().map(pair => pair.exampleGuess));
    expect(Object.keys(payload[0]).sort()).toEqual(['exampleGuess', 'explanation', 'id', 'intention', 'left', 'right', 'title']);
    expect(text).toContain('Human qualification: NOT RUN');
    expect(text).not.toMatch(/(?:fetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|<form|<link|src=)/);
  });

  it('pins all executable code and styles in CSP and blocks network and forms', () => {
    const text = buildPublicPreview().html.toString();
    const script = text.match(/<script>([\s\S]+)<\/script>/)![1]!;
    const style = text.match(/<style>([\s\S]+)<\/style>/)![1]!;
    expect(text).toContain(`script-src 'sha256-${hash(script, 'base64')}'`);
    expect(text).toContain(`style-src 'sha256-${hash(style, 'base64')}'`);
    expect(text).toContain("default-src 'none'");
    expect(text).toContain("connect-src 'none'");
    expect(text).toContain('font-src data:');
    expect(text).toContain("form-action 'none'");
    expect(text).not.toContain('unsafe-inline');
  });

  it('keeps the TM04 directing note faithful to the arriving actor joining the group', () => {
    const scene = showcase.listShowcases().find(scene => scene.id === 'TM04')!;
    expect(scene.explanation).toContain('joins the group and settles in the opening');
    expect(scene.explanation).not.toContain('passes through');
  });

  it('versions only the fixed TM01 second take while preserving frozen first acts and prior custody', () => {
    const before = ['TM01', 'TM09', 'TM04'].map(id => getScene(id)!);
    const pairs = showcase.listShowcases();
    expect(pairs[0]!.left.scoreHash).toBe('0eb0a8b09283e2f4ded48d42cfa3423d9cb596599d409ee3f7d024d77ad3b13a');
    expect(pairs[0]!.right.scoreHash).toBe('272c1f6a3a8ea37bee8bf5f97bb8305c69e973bcd5491731941c76ef88a665bc');
    expect(buildPublicPreview().manifest.pairs[0]!.alternate.scoreHash).toBe(pairs[0]!.right.scoreHash);
    expect(authoring).toMatchObject({ preparedVersion: 2, candidateScoreHash: pairs[0]!.right.scoreHash, parentScoreHash: pairs[0]!.left.scoreHash, previousPreparedScoreHash: 'e506d770ace1cf99f9d462ef943b9b58b3f4a3f7362b7e3139336de71d8bf861', notInstalledInBank: true, notConditionedOnVisitorText: true, humanReview: 'not_run' });
    expect(pairs[0]!.explanation).toContain('not an established improvement');
    pairs[0]!.right.score.actors[0]!.keyframes[0]!.x = 999;
    expect(showcase.listShowcases()[0]!.right.score.actors[0]!.keyframes[0]!.x).toBe(160);
    expect(['TM01', 'TM09', 'TM04'].map(id => getScene(id)!)).toEqual(before);
  });

  it.each(['unknown', 'numeric', 'hash'])('fails closed for a %s score defect before exporting', defect => {
    const pairs = showcase.listShowcases();
    if (defect === 'unknown') Object.assign(pairs[0]!.left.score, { callback: 'alert(1)' });
    if (defect === 'numeric') pairs[0]!.left.score.actors[0]!.keyframes[0]!.x = NaN;
    if (defect === 'hash') pairs[0]!.left.scoreHash = '0'.repeat(64);
    vi.spyOn(showcase, 'listShowcases').mockReturnValue(pairs);
    expect(() => buildPublicPreview()).toThrow('INVALID_PUBLIC_PREVIEW_SCORE');
  });

  it('writes only the two fixed release files, accepts identical exports and preserves conflicting bytes', () => {
    const root = temporary();
    const result = exportPublicPreview(root);
    expect(result.status).toBe('PASS');
    expect(exportPublicPreview(root)).toEqual(result);
    expect(JSON.stringify(result)).not.toContain(root);
    const file = join(root, 'artifacts/releases/tiny-mime-preview.html');
    writeFileSync(file, 'preserve this');
    expect(() => exportPublicPreview(root)).toThrow('PREVIEW_OUTPUT_EXISTS');
    expect(readFileSync(file, 'utf8')).toBe('preserve this');
    expect(runPublicPreview([], root)).toEqual({ exitCode: 1, output: { version: 1, status: 'ERROR', code: 'PREVIEW_EXPORT_FAILED' } });
  });

  it('rejects symlinked output directories and files and unexpected CLI arguments', () => {
    const root = temporary(), other = temporary();
    symlinkSync(other, join(root, 'artifacts'));
    expect(() => exportPublicPreview(root)).toThrow('PREVIEW_OUTPUT_REJECTED');
    const next = temporary(); mkdirSync(join(next, 'artifacts/releases'), { recursive: true });
    symlinkSync(join(other, 'outside.html'), join(next, 'artifacts/releases/tiny-mime-preview.html'));
    expect(() => exportPublicPreview(next)).toThrow();
    expect(runPublicPreview(['--out', '/private/path'], root)).toEqual({ exitCode: 1, output: { version: 1, status: 'ERROR', code: 'ARGUMENTS_INVALID' } });
  });
});
