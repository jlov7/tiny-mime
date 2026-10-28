import { it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { StudyService } from '../../src/server/study/service.js';
import { testCatalogue } from '../../fixtures/study/testCatalogue.js';

it('restart terminates interrupted study rows without restoring participant ownership', () => {
  const db = new Database(':memory:'); const options = { catalogue: testCatalogue(), now: () => 1000000 };
  const original = new StudyService(db, options);
  const session = original.createRehearsal('owner', { requestId: randomUUID(), fixtureScheduleId: 'synthetic_short_v1' });
  const plan = original.nextRound('owner', session.studySessionId), round = randomUUID();
  original.attachRound('owner', session.studySessionId, round, plan);
  original.recordRound(round, { guess1: 'Synthetic pending answer', row: { second_generation_status: 'pending' } });
  const restarted = new StudyService(db, { ...options, now: () => 1001000 });
  restarted.terminateInterruptedSessions();
  const record = JSON.parse((db.prepare('SELECT data FROM fixture_rounds WHERE id=?').get(round) as { data: string }).data);
  expect(record.row).toMatchObject({ second_generation_status: 'cancelled', failure_category: 'other', missingness_reason: 'technical_failure', round_ended_at_utc: new Date(1001000).toISOString() });
  expect(record.normalCompletion).toBe(false);
  expect(db.prepare('SELECT completion_state FROM fixture_sessions').get()).toEqual({ completion_state: 'closed' });
  expect(() => restarted.progress('owner', session.studySessionId)).toThrow('NOT_FOUND');
  restarted.terminateInterruptedSessions();
  expect(JSON.parse((db.prepare('SELECT data FROM fixture_rounds').get() as { data: string }).data)).toEqual(record);
  db.close();
});
