export type RecoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const keys = ['tm_creation', 'tm_mutation', 'tm_recovery', 'tm_study_start', 'tm_withdrawal'];
export const storageBytes = (value: string) => new TextEncoder().encode(value).byteLength;
export function checkRecoveryBudget(storage: RecoveryStorage, key: string, raw: string) {
  const total = keys.filter(candidate => candidate !== key).reduce((bytes, candidate) => bytes + storageBytes(storage.getItem(candidate) ?? ''), storageBytes(raw));
  if (total > 8192) throw new Error('STORAGE');
}
