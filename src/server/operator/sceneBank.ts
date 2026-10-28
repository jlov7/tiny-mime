import catalogue from '../targets/meanings.json' with { type: 'json' };
import manifest from '../targets/first-act-manifest.json' with { type: 'json' };
import TM01 from '../scores/TM01.json' with { type: 'json' };
import TM02 from '../scores/TM02.json' with { type: 'json' };
import TM03 from '../scores/TM03.json' with { type: 'json' };
import TM04 from '../scores/TM04.json' with { type: 'json' };
import TM05 from '../scores/TM05.json' with { type: 'json' };
import TM06 from '../scores/TM06.json' with { type: 'json' };
import TM08 from '../scores/TM08.json' with { type: 'json' };
import TM09 from '../scores/TM09.json' with { type: 'json' };
import TM10 from '../scores/TM10.json' with { type: 'json' };
import TM11 from '../scores/TM11.json' with { type: 'json' };
import TM12 from '../scores/TM12.json' with { type: 'json' };
import type { Authorship } from '../../shared/api.js';
import type { MotionScoreV1, Roster } from '../../shared/score.js';
import { validateScore } from '../../shared/validateScore.js';
import { canonicalJson, canonicalHash } from '../../shared/hash.js';
import { meaningRoster, type SceneMeaningV1 } from '../targets/meaning.js';
export { directorMeaning } from '../targets/meaning.js';
export type { DirectorMeaningV1, SceneMeaningV1 } from '../targets/meaning.js';
export type Scene = { id: string; meaning: SceneMeaningV1; roster: Roster; score: MotionScoreV1; scoreHash: string; source: 'authored_fixture'; authorship: Authorship; humanCalibration: 'not_run' };
export const developmentIds = ['TM01','TM09','TM04'] as const;
export const comparisonIds = ['TM02','TM03','TM05','TM06','TM08','TM10','TM11','TM12'] as const;
const scores = {TM01,TM02,TM03,TM04,TM05,TM06,TM08,TM09,TM10,TM11,TM12};
const scenes: Scene[] = Object.entries(scores).map(([id,raw]) => {
  const meaning = catalogue.records.find(m => m.sceneId === id)! as SceneMeaningV1;
  const roster = meaningRoster(meaning);
  const result = validateScore(canonicalJson(raw),roster);
  if (!result.ok) throw new Error(`INVALID_AUTHORED_SCORE ${id} ${JSON.stringify(result.errors)}`);
  const entry = manifest.records.find(r => r.sceneId === id);
  if (!entry || entry.scoreHash !== result.scoreHash || entry.meaningHash !== canonicalHash(meaning) || canonicalJson(entry.roster) !== canonicalJson(roster)) throw new Error(`AUTHORED_MANIFEST_MISMATCH ${id}`);
  return { id, meaning, roster, score: result.score, scoreHash: result.scoreHash, source: 'authored_fixture', authorship: { authoringMethod: (developmentIds as readonly string[]).includes(id) ? 'spec_transcribed' : 'agent_assisted', humanReview: 'not_run' }, humanCalibration: 'not_run' };
});
export const disabledScenes = [{ id: 'TM07', meaning: catalogue.records.find(m => m.sceneId==='TM07') as SceneMeaningV1, score: null, scoreHash: null, enabled: false, reason: 'future_contact_required', humanCalibration: 'not_run' }] as const;
export function getScene(id: string): Scene | undefined { const scene=scenes.find(s=>s.id===id); return scene && structuredClone(scene); }
export function listScenes(): Scene[] { return structuredClone(scenes); }
