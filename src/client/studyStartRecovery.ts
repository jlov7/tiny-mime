import { z } from 'zod';
import { checkRecoveryBudget, storageBytes } from './recoveryBudget.js';

const id = z.uuidv4().regex(/^[a-f0-9-]+$/);
const common = { version: z.literal(1), requestId: id, createdWallMs: z.number().int().nonnegative().safe(), acceptedSessionId: id.optional() };
const pendingStart = z.discriminatedUnion('kind', [
  z.strictObject({ ...common, kind: z.literal('rehearsal'), fixtureScheduleId: z.enum(['synthetic_short_v1', 'synthetic_full_v1']) }),
  z.strictObject({ ...common, kind: z.literal('enrollment'), studyRunId: id, consentVersion: z.string().min(1).max(128) }),
]);
export type PendingStudyStart = z.infer<typeof pendingStart>;
export const studyStartStatus = z.discriminatedUnion('status', [z.strictObject({ status: z.literal('accepted'), studySessionId: id }), z.strictObject({ status: z.literal('unknown') })]);
const key = 'tm_study_start';
const maximumAge = 86400000;
type StorageAccess = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export class StudyStartStore {
  constructor(private storage: StorageAccess) {}
  read(now = Date.now()): PendingStudyStart | null {
    const raw = this.storage.getItem(key); if (!raw) return null;
    if (storageBytes(raw) > 2048) throw new Error('STUDY_START_STORAGE');
    const record = pendingStart.parse(JSON.parse(raw));
    if (now < record.createdWallMs || now - record.createdWallMs >= maximumAge) throw new Error('STUDY_START_EXPIRED');
    return record;
  }
  write(record: PendingStudyStart, now = Date.now()) {
    const parsed = pendingStart.parse(record);
    if (now < parsed.createdWallMs || now - parsed.createdWallMs >= maximumAge) throw new Error('STUDY_START_EXPIRED');
    const raw = JSON.stringify(parsed);
    if (storageBytes(raw) > 2048) throw new Error('STUDY_START_STORAGE');
    checkRecoveryBudget(this.storage, key, raw);
    this.storage.setItem(key, raw); if (this.storage.getItem(key) !== raw) throw new Error('STUDY_START_STORAGE');
  }
  clear() { this.storage.removeItem(key); }
}
