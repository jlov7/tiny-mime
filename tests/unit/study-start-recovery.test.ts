import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { StudyStartStore, studyStartStatus, type PendingStudyStart } from '../../src/client/studyStartRecovery.js';

const record = (): PendingStudyStart => ({ version: 1, requestId: randomUUID(), createdWallMs: 1000, kind: 'enrollment', studyRunId: randomUUID(), consentVersion: 'consent-v1' });
function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
describe('study start recovery metadata', () => {
  it('retains the original identity across a fresh store and clears it after reconciliation', () => {
    const backing = storage(); const original = record(); new StudyStartStore(backing).write(original, 1000);
    expect(new StudyStartStore(backing).read(2000)).toEqual(original);
    new StudyStartStore(backing).clear(); expect(new StudyStartStore(backing).read(2000)).toBeNull();
  });
  it('rejects consent, guesses, withdrawal codes and malformed metadata instead of persisting them', () => {
    const backing = storage(); const store = new StudyStartStore(backing);
    for (const extra of [{ retainResults30Days: true }, { participationConsent: true }, { guess: 'private text' }, { withdrawalCode: 'A'.repeat(26) }, { providerConfiguration: {} }]) expect(() => store.write({ ...record(), ...extra }, 1000)).toThrow();
    expect(backing.getItem('tm_study_start')).toBeNull();
    for (const value of [{ ...record(), requestId: 'invalid' }, { ...record(), consentVersion: 'a'.repeat(129) }]) expect(() => store.write(value, 1000)).toThrow();
  });
  it('blocks stale records, clock reversal, oversized input and storage that silently drops writes', () => {
    const backing = storage(); const store = new StudyStartStore(backing); store.write(record(), 1000);
    expect(() => store.read(1000 + 86400000)).toThrow('STUDY_START_EXPIRED'); expect(() => store.write(record(), 1000 + 86400000)).toThrow('STUDY_START_EXPIRED'); expect(() => store.read(999)).toThrow('STUDY_START_EXPIRED');
    backing.setItem('tm_study_start', 'x'.repeat(2049)); expect(() => store.read()).toThrow('STUDY_START_STORAGE');
    expect(() => new StudyStartStore({ ...storage(), setItem: () => {} }).write(record(), 1000)).toThrow('STUDY_START_STORAGE');
  });
  it('accepts only the minimal owner recovery reply', () => {
    expect(studyStartStatus.parse({ status: 'accepted', studySessionId: randomUUID() }).status).toBe('accepted'); expect(studyStartStatus.parse({ status: 'unknown' }).status).toBe('unknown');
    expect(() => studyStartStatus.parse({ status: 'accepted', studySessionId: randomUUID(), withdrawalCode: 'A'.repeat(26) })).toThrow();
  });
});
