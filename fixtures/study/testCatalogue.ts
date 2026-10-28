import type { StudyScene } from '../../src/server/study/contracts.js';
import { createHash } from 'node:crypto';
import { canonicalize } from 'json-canonicalize';
export function testCatalogue(): StudyScene[] {
  const score = { version: 1, durationMs: 6000, stage: { width: 1000, height: 700 }, actors: [
    { id: 'a', shape: 'circle', color: 'violet', keyframes: [0,6000].map(tMs => ({tMs,x:200,y:300,rotationDeg:0,scaleX:1,scaleY:1,easing:'linear'})) },
    { id: 'b', shape: 'square', color: 'amber', keyframes: [0,6000].map(tMs => ({tMs,x:800,y:300,rotationDeg:0,scaleX:1,scaleY:1,easing:'linear'})) }
  ] };
  return ['TM01','TM02','TM03','TM04','TM05','TM06','TM08','TM09','TM10','TM11','TM12'].map((sceneId,index) => ({sceneId, meaning:{sceneId,meaningId:sceneId+'.synthetic',revision:1,target:'Synthetic software fixture'},rubric:{version:'synthetic-rubric-v1',complete:'Synthetic rubric only'},category:index<6?'physical':'social',score,scoreHash:createHash('sha256').update(canonicalize(score)).digest('hex'),authoringMethod:'agent_assisted',humanReview:'not_run'}));
}
