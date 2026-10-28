import { it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { StudyService } from '../../src/server/study/service.js';
import { testCatalogue } from '../../fixtures/study/testCatalogue.js';
import { parseSyntheticAnalystCsv } from '../../src/server/study/analysis.js';
import { ANALYST_HEADER } from '../../src/server/study/exports.js';
import type { MotionScoreV1 } from '../../src/shared/score.js';

it('unobserved reduced-motion preference exports as null even after frame-step viewing', () => {
  const db = new Database(':memory:'), catalogue = testCatalogue(), service = new StudyService(db, { catalogue });
  try {
    const session = service.createRehearsal('owner', { requestId: randomUUID(), fixtureScheduleId: 'synthetic_short_v1' });
    const plan = service.nextRound('owner', session.studySessionId), id = randomUUID(); service.attachRound('owner', session.studySessionId, id, plan);
    const check = () => {
      const exported = service.createExport('owner', { requestId: randomUUID(), studyRunId: plan.studyRunId, format: 'analyst_csv' });
      const csv = service.downloadExport('owner', exported.exportId).bytes.toString();
      expect(csv.split('\r\n')[1]!.split(',')[ANALYST_HEADER.indexOf('reduced_motion')]).toBe('');
      expect(parseSyntheticAnalystCsv(csv)[0]!.reduced_motion).toBeNull();
    };
    check();
    const clip = catalogue.find(scene => scene.sceneId === plan.sceneId)!, playId = randomUUID();
    service.recordEvent(id, { eventId: randomUUID(), name: 'play_started', attempt: 1, scoreHash: clip.scoreHash, playId, playbackMode: 'frame_step' });
    service.recordEvent(id, { eventId: randomUUID(), name: 'play_completed', attempt: 1, scoreHash: clip.scoreHash, playId, playbackMode: 'frame_step', playedElapsedMs: (clip.score as MotionScoreV1).durationMs });
    check();
  } finally { db.close(); }
});

it('late completed playback corrects optional completion without erasing a terminal failure', () => {
  for (const normalCompletion of [true, false]) {
    const db = new Database(':memory:'), catalogue = testCatalogue(), service = new StudyService(db, { catalogue });
    const session = service.createRehearsal('owner', { requestId: randomUUID(), fixtureScheduleId: 'synthetic_short_v1' });
    for (let i = 0; i < 3; i++) { const plan = service.nextRound('owner', session.studySessionId), id = randomUUID(); service.attachRound('owner', session.studySessionId, id, plan); service.recordRound(id, { terminal: true }); service.finishRound(id); }
    service.sessionFeedback('owner', session.studySessionId, { requestId: randomUUID(), wouldPlayAgain: true, optionalExtraAccepted: true });
    const plan = service.nextRound('owner', session.studySessionId), id = randomUUID(); service.attachRound('owner', session.studySessionId, id, plan);
    const clip = catalogue.find(s => s.sceneId === plan.sceneId)!;
    service.recordRound(id, { guess1: 'Synthetic first answer', guess2: 'Synthetic second answer', secondAct: { attempt: 2, score: clip.score, scoreHash: clip.scoreHash, source: 'mock_fixture', authorship: null } });
    const plays = [randomUUID(), randomUUID()];
    for (const attempt of [1, 2]) service.recordEvent(id, { eventId: randomUUID(), name: 'play_started', attempt, scoreHash: clip.scoreHash, playId: plays[attempt - 1], playbackMode: 'motion' });
    service.recordEvent(id, { eventId: randomUUID(), name: 'play_completed', attempt: 1, scoreHash: clip.scoreHash, playId: plays[0], playbackMode: 'motion', playedElapsedMs: 6000 });
    service.recordRound(id, { terminal: true, normalCompletion }); service.finishRound(id);
    const main = () => JSON.parse((db.prepare("SELECT data FROM fixture_rounds WHERE json_extract(data,'$.row.optional_extra_round_id')=?").get(id) as { data: string }).data).row;
    expect(main().optional_extra_completed).toBe(false);
    service.recordEvent(id, { eventId: randomUUID(), name: 'play_completed', attempt: 2, scoreHash: clip.scoreHash, playId: plays[1], playbackMode: 'motion', playedElapsedMs: 6000 });
    expect(main().optional_extra_started).toBe(true); expect(main().optional_extra_completed).toBe(normalCompletion);
    db.close();
  }
});
