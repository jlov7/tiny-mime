import { canonicalize } from 'json-canonicalize';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { MotionScoreV1 } from './score.js';
export function canonicalJson(value: unknown): string { return canonicalize(value); }
export function canonicalHash(value: unknown): string { return bytesToHex(sha256(new TextEncoder().encode(canonicalJson(value)))); }
export function scoreHash(score: MotionScoreV1): string { return canonicalHash(score); }
