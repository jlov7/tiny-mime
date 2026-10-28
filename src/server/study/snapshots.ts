import { canonicalize } from 'json-canonicalize';
import { StudyError, type StudyRun, type StudyScene, type StudyApprovalEvidence } from './contracts.js';
export function sceneSnapshot(run: StudyRun, catalogue: StudyScene[], evidence: StudyApprovalEvidence | null): StudyScene[] {
  const ids = [...new Set([...run.schedules.flatMap(s => s.rounds.map(r => r.sceneId)), ...run.optionalExtraSceneIds])].sort();
  return ids.map(id => {
    const scene = catalogue.find(s => s.sceneId === id);
    if (!scene) throw new StudyError('UNAVAILABLE');
    const calibration = evidence?.calibrationRecords.find(r => r.sceneId === id && r.scoreHash === scene.scoreHash && run.bankApproval?.calibrationRecordIds.includes(r.recordId));
    return JSON.parse(canonicalize({ ...scene, calibrationRecordId: calibration?.recordId ?? scene.calibrationRecordId ?? null }));
  });
}
