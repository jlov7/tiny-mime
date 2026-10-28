import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { StudyWithdrawalStore, withdrawalDigest, type PendingWithdrawal } from '../../src/client/studyWithdrawalRecovery.js';
import { RecoveryStore } from '../../src/client/recoveryStore.js';
import { StudyStartStore } from '../../src/client/studyStartRecovery.js';
import { canonicalHash } from '../../src/shared/hash.js';
import { checkedSession, feedbackStatus } from '../../src/client/api.js';

const code = 'A'.repeat(26);
const record = (): PendingWithdrawal => { const requestId = randomUUID(); return { version: 1, requestId, bodyDigest: withdrawalDigest(requestId, code), recoveryOwnerId: randomUUID(), studySessionId: randomUUID() }; };
function memory() { const values = new Map<string, string>(); return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; }
describe('exact withdrawal recovery metadata', () => {
  it('retains only the approved descriptor and full canonical equality verifier across refresh', () => {
    const storage = memory(), original = record(); const store = new StudyWithdrawalStore(storage); store.write(original);
    expect(new StudyWithdrawalStore(storage).read()).toEqual(original);
    expect(original.bodyDigest).toBe(canonicalHash({ withdrawalCode: code, requestId: original.requestId }));
    expect(withdrawalDigest(original.requestId, 'B'.repeat(26))).not.toBe(original.bodyDigest);
    const raw = storage.getItem('tm_withdrawal')!; expect(new TextEncoder().encode(raw).length).toBeLessThanOrEqual(384); expect(raw).not.toContain(code);
    store.clear(); expect(store.read()).toBeNull();
  });
  it('rejects malformed, extra, oversized and noncanonical metadata without rewriting it', () => {
    const storage = memory(), store = new StudyWithdrawalStore(storage), valid = record();
    for (const value of [{ ...valid, version: 2 }, { ...valid, requestId: randomUUID().toUpperCase() }, { ...valid, bodyDigest: valid.bodyDigest.toUpperCase() }, { ...valid, recoveryOwnerId: 'bad' }, { ...valid, withdrawalCode: code }, { ...valid, studySessionId: undefined }]) expect(() => store.write(value as any)).toThrow();
    for (const raw of ['', '{', 'x'.repeat(385), JSON.stringify({ ...valid, extra: true })]) { storage.setItem('tm_withdrawal', raw); expect(() => store.read()).toThrow(); expect(storage.getItem('tm_withdrawal')).toBe(raw); }
  });
  it('preserves a different saved command that arrives before initial persistence', () => {
    const storage = memory(), store = new StudyWithdrawalStore(storage), original = record();
    store.write(original); const raw = storage.getItem('tm_withdrawal');
    expect(() => store.write(record())).toThrow('WITHDRAWAL_STORAGE');
    expect(storage.getItem('tm_withdrawal')).toBe(raw); expect(store.read()).toEqual(original);
    expect(() => store.write(original)).not.toThrow();
  });
  it('fails closed on write, readback and removal failures', () => {
    for (const storage of [{ ...memory(), setItem: () => { throw new Error('quota'); } }, { ...memory(), setItem: () => {} }, { ...memory(), getItem: () => { throw new Error('blocked'); } }]) expect(() => new StudyWithdrawalStore(storage).write(record())).toThrow();
    const storage = memory(); storage.setItem('tm_withdrawal', JSON.stringify(record())); expect(() => new StudyWithdrawalStore({ ...storage, removeItem: () => {} }).clear()).toThrow();
  });
  it('counts every recovery writer within one UTF-8 8 KiB budget', () => {
    const storage = memory(), valid = record();
    storage.setItem('tm_creation', 'é'.repeat(4000)); storage.setItem('tm_study_start', 'x'.repeat(100));
    expect(() => new StudyWithdrawalStore(storage).write(valid)).toThrow('STORAGE'); expect(storage.getItem('tm_withdrawal')).toBeNull();
    storage.values.clear(); storage.setItem('tm_withdrawal', 'x'.repeat(384)); storage.setItem('tm_study_start', 'é'.repeat(3850));
    expect(() => new RecoveryStore(storage).write('recovery', { version: 1, roundId: randomUUID(), clientTimeout: false, clockUncertain: false, timeoutEventId: null, clockUncertainEventId: null })).toThrow('STORAGE');
    storage.values.clear(); storage.setItem('tm_withdrawal', 'x'.repeat(384)); storage.setItem('tm_recovery', 'é'.repeat(3850));
    expect(() => new StudyStartStore(storage).write({ version: 1, requestId: randomUUID(), createdWallMs: 1000, kind: 'rehearsal', fixtureScheduleId: 'synthetic_short_v1' }, 1000)).toThrow('STORAGE');
  });
  it('accepts only the exact normal session and feedback receipts', () => {
    const receipt = { sessionReady: true, activeRoundId: null, recoveryOwnerId: randomUUID() };
    expect(checkedSession(receipt)).toEqual(receipt);
    for (const value of [{ sessionReady: true, activeRoundId: null }, { ...receipt, token: 'secret' }, { ...receipt, recoveryOwnerId: 'invalid' }]) expect(() => checkedSession(value)).toThrow();
    expect(feedbackStatus.parse({ saved: false, secondActCompletionRecorded: true })).toEqual({ saved: false, secondActCompletionRecorded: true });
    for (const value of [{ saved: false }, { saved: false, secondActCompletionRecorded: 'yes' }, { saved: false, secondActCompletionRecorded: true, events: [] }]) expect(() => feedbackStatus.parse(value)).toThrow();
  });
});
