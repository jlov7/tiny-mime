import { z } from 'zod';
import { checkRecoveryBudget, storageBytes } from './recoveryBudget.js';
import type { PendingCreationV1, PendingMutationV1, RoundRecoveryV1 } from '../shared/api.js';

const id = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const time = z.number().int().nonnegative().safe();
const creation = z.strictObject({ version: z.literal(1), requestId: id, mode: z.enum(['private_play', 'study']), executionMode: z.enum(['fixture', 'live']), studySessionId: id.nullable(), createdWallMs: time });
const mutation = z.strictObject({ version: z.literal(1), roundId: id, requestId: id, kind: z.enum(['guess1', 'guess2', 'skip', 'abandon']), revision: time, submittedWallMs: time, deadlineWallMs: time.nullable(), lastObservedWallMs: time, clockUncertain: z.boolean() });
const recovery = z.strictObject({ version: z.literal(1), roundId: id, clientTimeout: z.boolean(), clockUncertain: z.boolean(), timeoutEventId: id.nullable(), clockUncertainEventId: id.nullable() });
type Records = { creation: PendingCreationV1; mutation: PendingMutationV1; recovery: RoundRecoveryV1 };
const schemas = { creation, mutation, recovery };
const prefix = 'tm_';

export class RecoveryStore {
  constructor(private storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {}
  read<K extends keyof Records>(kind: K): Records[K] | null {
    const raw = this.storage.getItem(prefix + kind); if (!raw) return null;
    if (storageBytes(raw) > 8192) throw new Error('STORAGE');
    return schemas[kind].parse(JSON.parse(raw)) as Records[K];
  }
  write<K extends keyof Records>(kind: K, record: Records[K]) {
    schemas[kind].parse(record);
    const raw = JSON.stringify(record); checkRecoveryBudget(this.storage, prefix + kind, raw);
    this.storage.setItem(prefix + kind, raw); if (this.storage.getItem(prefix + kind) !== raw) throw new Error('STORAGE');
  }
  clear(kind: keyof Records) { this.storage.removeItem(prefix + kind); }
  discard() { this.clear('creation'); this.clear('mutation'); this.clear('recovery'); }
  restore(wallMs: number): { creation: PendingCreationV1 | null; mutation: PendingMutationV1 | null; recovery: RoundRecoveryV1 | null } {
    const c = this.read('creation'); const m = this.read('mutation'); let r = this.read('recovery');
    if (m?.kind === 'guess1') {
      r = { version: 1, roundId: m.roundId, clientTimeout: r?.clientTimeout || wallMs >= m.deadlineWallMs!, clockUncertain: true, timeoutEventId: r?.timeoutEventId ?? null, clockUncertainEventId: r?.clockUncertainEventId ?? crypto.randomUUID() };
      m.clockUncertain = true; this.write('mutation', m); this.write('recovery', r);
    }
    return { creation: c, mutation: m, recovery: r };
  }
}
export function inspectTiming(m: PendingMutationV1, r: RoundRecoveryV1, submittedMono: number, mono: number, wall: number): { mutation: PendingMutationV1; recovery: RoundRecoveryV1 } {
  const elapsed = mono - submittedMono;
  const uncertain = Math.abs((wall - m.submittedWallMs) - elapsed) > 1000 || wall < m.lastObservedWallMs - 1000;
  return { mutation: { ...m, lastObservedWallMs: wall, clockUncertain: m.clockUncertain || uncertain }, recovery: { ...r, clockUncertain: r.clockUncertain || uncertain, clientTimeout: r.clientTimeout || elapsed >= 15000, clockUncertainEventId: r.clockUncertainEventId ?? (uncertain ? crypto.randomUUID() : null), timeoutEventId: r.timeoutEventId ?? (elapsed >= 15000 ? crypto.randomUUID() : null) } };
}
