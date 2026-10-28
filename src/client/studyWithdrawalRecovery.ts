import { z } from 'zod';
import { canonicalHash } from '../shared/hash.js';
import { checkRecoveryBudget, storageBytes, type RecoveryStorage } from './recoveryBudget.js';

const id = z.uuidv4().regex(/^[a-f0-9-]+$/);
const descriptor = z.strictObject({ version: z.literal(1), requestId: id, bodyDigest: z.string().regex(/^[0-9a-f]{64}$/), recoveryOwnerId: id, studySessionId: id.nullable() });
export type PendingWithdrawal = z.infer<typeof descriptor>;
const key = 'tm_withdrawal';
export function withdrawalDigest(requestId: string, withdrawalCode: string) { return canonicalHash({ requestId, withdrawalCode }); }
export class StudyWithdrawalStore {
  constructor(private storage: RecoveryStorage) {}
  read(): PendingWithdrawal | null {
    const raw = this.storage.getItem(key); if (raw === null) return null;
    if (storageBytes(raw) > 384) throw new Error('WITHDRAWAL_STORAGE');
    checkRecoveryBudget(this.storage, key, raw);
    return descriptor.parse(JSON.parse(raw));
  }
  write(record: PendingWithdrawal) {
    const raw = JSON.stringify(descriptor.parse(record));
    if (storageBytes(raw) > 384) throw new Error('WITHDRAWAL_STORAGE');
    const existing = this.storage.getItem(key);
    if (existing !== null && existing !== raw) throw new Error('WITHDRAWAL_STORAGE');
    checkRecoveryBudget(this.storage, key, raw);
    this.storage.setItem(key, raw); if (this.storage.getItem(key) !== raw) throw new Error('WITHDRAWAL_STORAGE');
  }
  clear() { this.storage.removeItem(key); if (this.storage.getItem(key) !== null) throw new Error('WITHDRAWAL_STORAGE'); }
}
