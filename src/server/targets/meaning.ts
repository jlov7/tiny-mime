import type { ActorId, ActorV1, Roster } from '../../shared/score.js';
export type SceneMeaningV1 = {
  meaningId: string; sceneId: string; revision: number; title: string; target: string;
  cast: ( { actorId: ActorId; role: string } & Pick<ActorV1,'shape'|'color'>)[];
  coreEvent: { id: string; assertion: string }[];
  roleBindings: { role: string; actorIds: ActorId[] }[];
  allowedElaborations: string[]; contradictions: { id: string; assertion: string }[];
  targetRubric: { version: string; complete: string; partial: string; offTarget: string; acceptedParaphrases: string[]; likelyConfusions: string[] };
  fidelityAssessment: { version: string; method: 'independent_human_review'; labels: Record<'target_preserved'|'unclear'|'changed_story'|'unrateable',string>; requiredEvidence: string[] };
  contentStatus: 'development_scripted'|'comparison_candidate'|'deferred_contact'; geometryVersion: 'svg-shapes-v1'; contactPolicy: 'noncontact-v1'|'future_contact_required';
};
export type DirectorMeaningV1 = Pick<SceneMeaningV1,'meaningId'|'target'|'cast'|'coreEvent'|'roleBindings'|'allowedElaborations'|'contradictions'|'geometryVersion'> & { contractVersion: 'sceneMeaningV1'; contactPolicy: 'noncontact-v1' };
export function directorMeaning(meaning: SceneMeaningV1): DirectorMeaningV1 {
  if (meaning.contactPolicy !== 'noncontact-v1') throw new Error('DEFERRED_CONTACT');
  return { contractVersion: 'sceneMeaningV1', meaningId: meaning.meaningId, target: meaning.target, cast: structuredClone(meaning.cast), coreEvent: structuredClone(meaning.coreEvent), roleBindings: structuredClone(meaning.roleBindings), allowedElaborations: [...meaning.allowedElaborations], contradictions: structuredClone(meaning.contradictions), geometryVersion: meaning.geometryVersion, contactPolicy: meaning.contactPolicy };
}
export function meaningRoster(meaning: SceneMeaningV1): Roster { return meaning.cast.map(({actorId,shape,color}) => ({ id: actorId, shape, color })); }
