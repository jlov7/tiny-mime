import { z } from 'zod';
import type { MotionScoreV1, Roster } from '../shared/score.js';
import { validateScore } from '../shared/validateScore.js';
import { HttpFailure, request } from './request.js';

z.config({ jitless: true });
const id = z.uuidv4().toLowerCase();
const note = z.strictObject({ atMs: z.number().int().nonnegative(), text: z.string().min(1).max(240) });
const summary = z.strictObject({ candidateId: id, sceneId: z.string().min(1), title: z.string().min(1).max(80), scoreHash: z.string().regex(/^[0-9a-f]{64}$/), parentCandidateId: id.nullable(), createdAt: z.iso.datetime(), noteCount: z.number().int().min(0).max(12) });
const candidate = summary.extend({ score: z.unknown(), notes: z.array(note).max(12) });
const rosterSchema = z.object({ actors: z.array(z.object({ id: z.enum(['a', 'b', 'c']), shape: z.enum(['circle', 'square', 'triangle']), color: z.enum(['violet', 'amber', 'teal']) })).min(2).max(3) });
export type CandidateNote = z.infer<typeof note>;
export type CandidateSummary = z.infer<typeof summary>;
export type Candidate = CandidateSummary & { score: MotionScoreV1; notes: CandidateNote[] };
export type CandidateInput = { requestId: string; sceneId: string; title: string; score: MotionScoreV1; parentCandidateId: string | null; notes: CandidateNote[] };
export function checkedCandidate(value: unknown, roster?: Roster): Candidate {
  const parsed = candidate.parse(value);
  const result = validateScore(JSON.stringify(parsed.score), roster ?? rosterSchema.parse(parsed.score).actors);
  if (!result.ok || result.scoreHash !== parsed.scoreHash || parsed.noteCount !== parsed.notes.length || parsed.notes.some(n => n.atMs > result.score.durationMs)) throw new Error('INVALID_CANDIDATE');
  return { ...parsed, score: result.score };
}
export async function listCandidates(): Promise<CandidateSummary[]> {
  return z.strictObject({ candidates: z.array(summary).max(64) }).parse(await request('/api/operator/candidates')).candidates;
}
export async function getCandidate(candidateId: string, roster?: Roster): Promise<Candidate> {
  id.parse(candidateId);
  return checkedCandidate(z.strictObject({ candidate: z.unknown() }).parse(await request(`/api/operator/candidates/${candidateId}`)).candidate, roster);
}
export async function saveCandidate(input: CandidateInput, roster: Roster): Promise<Candidate> {
  return checkedCandidate(z.strictObject({ candidate: z.unknown() }).parse(await request('/api/operator/candidates', input)).candidate, roster);
}
export async function removeCandidate(candidateId: string, requestId: string): Promise<{ removed: true }> {
  id.parse(candidateId);
  const input = z.strictObject({ requestId: z.uuidv4().check(z.lowercase()) }).parse({ requestId });
  return z.strictObject({ removed: z.literal(true) }).parse(await request(`/api/operator/candidates/${candidateId}/remove`, input));
}
export async function inspectionBlob(candidateId: string): Promise<Blob> {
  id.parse(candidateId);
  const controller = new AbortController();
  const abort = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('REQUEST_TIMEOUT')), { once: true }));
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    return await Promise.race([abort, (async () => {
      const response = await fetch(`/api/operator/candidates/${candidateId}/inspection`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new HttpFailure(response.status, 'UNAVAILABLE');
      if (response.headers.get('content-type')?.split(';')[0] !== 'application/zip') throw new Error('INVALID_INSPECTION');
      return await response.blob();
    })()]);
  } finally { clearTimeout(timer); }
}
export async function downloadInspection(candidateId: string): Promise<void> {
  const blob = await inspectionBlob(candidateId);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `tiny-mime-candidate-${candidateId}.zip`;
  try { anchor.click(); } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

export const workspaceBackupMaxBytes = 32 * 1024 * 1024;
const workspaceCounts = z.strictObject({ candidates: z.number().int().min(0).max(64), tombstones: z.number().int().min(0).max(10000), removals: z.number().int().min(0).max(10000) });
const workspacePreview = z.strictObject({ artifactHash: z.string().regex(/^[a-f0-9]{64}$/), workspaceHash: z.string().regex(/^[a-f0-9]{64}$/), incoming: workspaceCounts, additions: workspaceCounts, alreadyPresent: workspaceCounts, resulting: workspaceCounts });
export type WorkspaceRestorePreview = z.infer<typeof workspacePreview>;
export async function downloadWorkspaceBackup(): Promise<void> {
  const snapshot = await request('/api/operator/workspace/backup');
  const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'tiny-mime-private-workspace.json';
  try { anchor.click(); } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
export async function previewWorkspaceRestore(raw: string): Promise<WorkspaceRestorePreview> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch('/api/operator/workspace/restore-preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw, credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
    const value = await response.json();
    if (!response.ok) {
      const failure = z.strictObject({ code: z.string(), retryable: z.boolean(), requestId: z.uuidv4().nullable() }).safeParse(value?.error);
      throw new HttpFailure(response.status, failure.success ? failure.data.code : 'UNAVAILABLE', failure.success ? failure.data.requestId : null);
    }
    return workspacePreview.parse(value);
  } finally { clearTimeout(timer); }
}
export async function restoreWorkspace(snapshot: unknown, expectedWorkspaceHash: string) {
  return workspacePreview.extend({ status: z.enum(['restored', 'already_present']) }).parse(await request('/api/operator/workspace/restore', { snapshot, expectedWorkspaceHash }));
}
