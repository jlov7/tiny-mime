import { createScanner, SyntaxKind, parseTree } from 'jsonc-parser';
import type { ScoreErrorCode } from './score.js';

export class ParseFailure extends Error {
  constructor(public readonly code: ScoreErrorCode, public readonly path: string = '/') { super(code); this.name = 'ParseFailure'; }
}

// Scan first so the recursive parser never sees an unbounded nesting depth.
export function parseJsonStrict(raw: string, options: { maxBytes?: number; maxDepth?: number } = {}): unknown {
  if (typeof raw !== 'string') throw new ParseFailure('PARSE');
  if (new TextEncoder().encode(raw).length > (options.maxBytes ?? 65536)) throw new ParseFailure('BYTES');
  const scanner = createScanner(raw, false);
  const stack: { object: boolean; key: boolean; keys: Set<string> }[] = [];
  let token: SyntaxKind;
  while ((token = scanner.scan()) !== SyntaxKind.EOF) {
    if (scanner.getTokenError()) throw new ParseFailure('PARSE');
    if (token === SyntaxKind.OpenBraceToken || token === SyntaxKind.OpenBracketToken) {
      stack.push({ object: token === SyntaxKind.OpenBraceToken, key: true, keys: new Set() });
      if (stack.length > (options.maxDepth ?? 6)) throw new ParseFailure('DEPTH');
    } else if (token === SyntaxKind.CloseBraceToken || token === SyntaxKind.CloseBracketToken) stack.pop();
    else if (token === SyntaxKind.CommaToken) { const top = stack.at(-1); if (top) top.key = true; }
    else if (token === SyntaxKind.StringLiteral) {
      const value = scanner.getTokenValue();
      if (/[\uD800-\uDFFF]/u.test(value)) throw new ParseFailure('PARSE');
      const top = stack.at(-1);
      if (top?.object && top.key) {
        if (['__proto__', 'constructor', 'prototype'].includes(value)) throw new ParseFailure('UNKNOWN_KEY');
        if (top.keys.has(value)) throw new ParseFailure('DUPLICATE_KEY');
        top.keys.add(value); top.key = false;
      }
    }
  }
  const errors: { error: number; offset: number; length: number }[] = [];
  const tree = parseTree(raw, errors, { disallowComments: true, allowTrailingComma: false, allowEmptyContent: false });
  if (!tree || errors.length) throw new ParseFailure('PARSE');
  const result: unknown = JSON.parse(raw);
  const checkFinite = (value: unknown): void => {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new ParseFailure('PARSE');
    if (value && typeof value === 'object') for (const child of Object.values(value)) checkFinite(child);
  };
  checkFinite(result);
  return result;
}
