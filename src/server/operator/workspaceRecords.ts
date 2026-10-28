import { z } from 'zod';
import { canonicalHash } from '../../shared/hash.js';
import { parseJsonStrict } from '../../shared/parseJson.js';
import { validateScore } from '../../shared/validateScore.js';
import { getScene } from './sceneBank.js';

const text = (maximum: number) => z.string().min(1).max(maximum).refine(value => value.trim().length > 0 && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value));
export const candidateInputSchema = z.strictObject({ requestId: z.uuidv4().check(z.lowercase()), sceneId: z.string().regex(/^TM\d{2}$/), title: text(80), score: z.unknown(), parentCandidateId: z.uuidv4().check(z.lowercase()).nullable(), notes: z.array(z.strictObject({ atMs: z.number().int().min(0).max(10000), text: text(240) })).max(12) });
export const candidateRemovalSchema = z.strictObject({ requestId: z.uuidv4().check(z.lowercase()) });

export const workspaceMaxBytes = 32 * 1024 * 1024;
export const workspaceMaxRows = 10000;
export const workspaceUuid = z.uuidv4().check(z.lowercase());
export const workspaceDigest = z.string().regex(/^[a-f0-9]{64}$/);
export const workspaceRowSchema = z.strictObject({ id: workspaceUuid, request_id: workspaceUuid, input_hash: workspaceDigest, payload: z.string().max(128 * 1024) });
export const workspaceRemovalSchema = z.strictObject({ request_id: workspaceUuid, candidate_id: workspaceUuid });
const recordSchema = candidateInputSchema.omit({ requestId: true }).extend({ candidateId: workspaceUuid, scoreHash: workspaceDigest, createdAt: z.iso.datetime({ precision: 3 }), noteCount: z.number().int().min(0).max(12) });
export type WorkspaceRow = z.infer<typeof workspaceRowSchema>;
export type WorkspaceRemoval = z.infer<typeof workspaceRemovalSchema>;
export type WorkspaceCounts = { candidates: number; tombstones: number; removals: number };
const reject = (): never => { throw new Error('INVALID_INPUT'); };
export function validateWorkspaceRecords(rows: WorkspaceRow[], removals: WorkspaceRemoval[]): WorkspaceCounts {
  if (rows.length > workspaceMaxRows || removals.length > workspaceMaxRows) reject();
  const deadline = Date.now() + 10000;
  const checkTime = () => { if (Date.now() > deadline) reject(); };
  const ids = new Set<string>(), requests = new Set<string>(), active = new Map<string, { sceneId: string }>(), tombstones = new Set<string>();
  for (const row of rows) {
    checkTime(); if (ids.has(row.id) || requests.has(row.request_id)) reject(); ids.add(row.id); requests.add(row.request_id);
    if (row.payload === '') { tombstones.add(row.id); continue; }
    const value = recordSchema.parse(parseJsonStrict(row.payload, { maxBytes: 128 * 1024, maxDepth: 12 }));
    const scene = getScene(value.sceneId); if (!scene) return reject();
    const score = validateScore(JSON.stringify(value.score), scene.roster);
    if (!score.ok || value.candidateId !== row.id || value.scoreHash !== score.scoreHash || value.noteCount !== value.notes.length || value.notes.some(note => note.atMs > score.score.durationMs) || new Date(value.createdAt).toISOString() !== value.createdAt) reject();
    const input = candidateInputSchema.parse({ requestId: row.request_id, sceneId: value.sceneId, title: value.title, score: value.score, parentCandidateId: value.parentCandidateId, notes: value.notes });
    if (canonicalHash(input) !== row.input_hash) reject();
    // Parents must already exist in insertion order. This also rejects cycles and removed ancestors.
    if (value.parentCandidateId !== null && active.get(value.parentCandidateId)?.sceneId !== value.sceneId) reject();
    active.set(row.id, { sceneId: value.sceneId });
  }
  if (active.size > 64) reject();
  const removed = new Set<string>();
  for (const removal of removals) {
    checkTime();
    if (requests.has(removal.request_id) || !tombstones.has(removal.candidate_id) || removed.has(removal.candidate_id)) reject();
    requests.add(removal.request_id); removed.add(removal.candidate_id);
  }
  if (removed.size !== tombstones.size) reject();
  return { candidates: active.size, tombstones: tombstones.size, removals: removals.length };
}
