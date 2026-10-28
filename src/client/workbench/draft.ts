import { createScanner, findNodeAtLocation, parseTree, SyntaxKind } from 'jsonc-parser';
import type { KeyframeV1, MotionScoreV1, Roster, ScoreError, ValidationResult } from '../../shared/score.js';
import { validateScore } from '../../shared/validateScore.js';

export type NumericField = Exclude<keyof KeyframeV1, 'easing'>;
export const numericFields: NumericField[] = ['tMs', 'x', 'y', 'rotationDeg', 'scaleX', 'scaleY'];
export type EditHistory = { score: MotionScoreV1; undo: MotionScoreV1[] };
export function editKeyframe(history: EditHistory, actor: number, key: number, field: NumericField, value: number, roster: Roster): { history: EditHistory; result: ValidationResult } {
  const score = structuredClone(history.score);
  score.actors[actor].keyframes[key][field] = value;
  const result = validateScore(JSON.stringify(score), roster);
  return { history: { score, undo: [...history.undo, history.score].slice(-30) }, result };
}
export function undoEdit(history: EditHistory): EditHistory {
  return history.undo.length ? { score: history.undo.at(-1)!, undo: history.undo.slice(0, -1) } : history;
}
export type ErrorLocation = { start: number; end: number; context: string; atMs?: number };
export function locateScoreError(raw: string, error: ScoreError): ErrorLocation {
  if (raw.length > 65536) return { start: 0, end: Math.min(raw.length, 1), context: 'Score document' };
  const scanner = createScanner(raw); let depth = 0; let token: SyntaxKind;
  while ((token = scanner.scan()) !== SyntaxKind.EOF) {
    if (token === SyntaxKind.OpenBraceToken || token === SyntaxKind.OpenBracketToken) { depth++; if (depth > 6) { const start = scanner.getTokenOffset(); return { start, end: start + 1, context: 'Excessive JSON nesting' }; } }
    else if (token === SyntaxKind.CloseBraceToken || token === SyntaxKind.CloseBracketToken) depth--;
  }
  const errors: { error: number; offset: number; length: number }[] = [];
  const tree = parseTree(raw, errors, { disallowComments: true, allowTrailingComma: false });
  if (!tree || error.code === 'PARSE') {
    const issue = errors[0];
    return { start: issue?.offset ?? 0, end: (issue?.offset ?? 0) + Math.max(1, issue?.length ?? 1), context: 'JSON syntax' };
  }
  const parts = error.path.split('/').slice(1).filter(Boolean).map(p => /^\d+$/.test(p) ? Number(p) : p.replaceAll('~1', '/').replaceAll('~0', '~'));
  let context = 'Score document'; let atMs: number | undefined;
  const pair = /^\/pairs\/([abc])-([abc])\/intervals\/(\d+)$/.exec(error.path);
  let target = parts;
  if (pair) {
    const actors = findNodeAtLocation(tree, ['actors']);
    const indices = actors?.children?.flatMap((a, index) => {
      const actorId = findNodeAtLocation(a, ['id'])?.value;
      return actorId === pair[1] || actorId === pair[2] ? [index] : [];
    }) ?? [];
    const times = [...new Set<number>(indices.flatMap(i => findNodeAtLocation(tree, ['actors', i, 'keyframes'])?.children?.map(k => findNodeAtLocation(k, ['tMs'])?.value).filter((t): t is number => typeof t === 'number') ?? []))].sort((a, b) => a - b);
    const interval = Number(pair[3]); atMs = times[interval];
    context = `Actors ${pair[1]} and ${pair[2]} · interval ${times[interval] ?? '?'}–${times[interval + 1] ?? '?'} ms`;
    const keys = findNodeAtLocation(tree, ['actors', indices[0] ?? 0, 'keyframes'])?.children ?? [];
    const key = keys.findIndex((k, i) => (findNodeAtLocation(k, ['tMs'])?.value ?? 0) <= (atMs ?? 0) && (findNodeAtLocation(keys[i + 1] ?? k, ['tMs'])?.value ?? Infinity) > (atMs ?? 0));
    target = ['actors', indices[0] ?? 0, 'keyframes', Math.max(0, key)];
  } else if (parts[0] === 'actors' && typeof parts[1] === 'number') {
    const actorId = findNodeAtLocation(tree, ['actors', parts[1], 'id'])?.value ?? parts[1];
    context = `Actor ${actorId}`;
    if (parts[2] === 'keyframes' && typeof parts[3] === 'number') {
      const key = parts[3];
      atMs = findNodeAtLocation(tree, ['actors', parts[1], 'keyframes', key, 'tMs'])?.value;
      const next = findNodeAtLocation(tree, ['actors', parts[1], 'keyframes', key + 1, 'tMs'])?.value;
      context += ` · key ${key + 1}${atMs === undefined ? '' : ` · ${atMs}${next === undefined ? '' : `–${next}`} ms`}`;
    }
  }
  let node = findNodeAtLocation(tree, target);
  while (!node && target.length) { target = target.slice(0, -1); node = findNodeAtLocation(tree, target); }
  return { start: node?.offset ?? 0, end: node ? node.offset + node.length : raw.length, context, atMs };
}
