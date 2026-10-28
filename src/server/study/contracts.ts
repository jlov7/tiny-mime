import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from '../formats.js';
export class StudyError extends Error { constructor(public code: 'INVALID_INPUT'|'FORBIDDEN'|'NOT_FOUND'|'UNAVAILABLE'|'ACTIVE_ROUND'|'IDEMPOTENCY_CONFLICT'|'LIMITED'|'EXPIRED', message=code) { super(message); } }
const ajv=new Ajv2020({strict:false,allErrors:true}); addFormats(ajv);
const load=(name:string)=>JSON.parse(readFileSync(resolve('Tiny_Mime_Review_Source_Pack/supplements',name),'utf8'));
const runValidator=ajv.compile(load('study-run-v1.schema.json'));
const ratingValidator=ajv.compile(load('rating-import-v1.schema.json'));
const api=load('api-contracts-v1.schema.json');
export function validateContract(name:'run'|'ratings'|'StudyStart'|'SessionFeedback'|'OperatorExportInput',input:unknown):void { const validate=name==='run'?runValidator:name==='ratings'?ratingValidator:ajv.compile({$schema:api.$schema,$defs:api.$defs,$ref:`#/$defs/${name}`}); if (!validate(input)) throw new StudyError('INVALID_INPUT'); }
export type StudyPhase='formative'|'bank_calibration'|'practice'|'comparative'|'optional_extra';
export type Condition='informed'|'blind_retry';
export type ScheduledRound={phase:Exclude<StudyPhase,'optional_extra'>;sceneId:string;generationProfile:'practice_blind_v1'|'runtime_informed_v1'|'runtime_blind_v1';allocation:Condition|null};
export type StudyRun={version:1;studyRunId:string;protocolVersion:string;consentVersion:string;providerDisclosureVersion:string;status:'draft'|'approved';bankApproval:null|{approvalRecordId:string;approvedAt:string;calibrationRecordIds:string[];meaningCatalogueHash:string;firstScoreHashes:{sceneId:string;scoreHash:string}[]};allowOptionalExtra:boolean;optionalExtraSceneIds:string[];schedules:{scheduleId:string;rounds:ScheduledRound[]}[];retention:{rawDays:7;optionalResultDays:30;operationalHours:24}};
export type StudyScene={sceneId:string;meaning:Record<string,unknown>;rubric:unknown;scoreHash:string;score:unknown;category:'physical'|'social';authoringMethod:'spec_transcribed'|'agent_assisted'|'human_authored';humanReview:'not_run'|'reviewed';calibrationRecordId?:string|null};
export type ProtocolFreeze={protocolVersion:string;modelVersion:string;promptVersion:string;rendererVersion:string;contactPolicyVersion:'noncontact-v1';catalogueHash:string;scoreHashes:{sceneId:string;scoreHash:string}[];operatorContact:string;providerDisclosureVersion:string};
export type StudyApprovalEvidence={phaseApprovalRecordId:string;approvedPhases:StudyPhase[];providerApprovalRecordId:string;consentApproved:boolean;providerRetentionVerified:boolean;deletionOwnerConfirmed:boolean;codingWorkloadApproved:boolean;calibrationRecords:{recordId:string;sceneId:string;scoreHash:string;cohortId:string;decision:'approved';humanReviewed:true}[]};
export type LiveQualification={enabled:boolean;budgetApproved:boolean;providerDisclosureVersion:string;modelVersion:string;promptVersion:string;rendererVersion:string;contactPolicyVersion:'noncontact-v1'};
export type StudyStart={requestId:string;studyRunId:string;consentVersion:string;adultConfirmed:true;participationConsent:true;rawResearchConsent:true;providerTransmissionConsent:true;retainResults30Days:boolean;publicationConsent:boolean};
export type RatingKind='recognition_first'|'recognition_second'|'fidelity';
export type RatingValue=0|1|2|'target_preserved'|'unclear'|'changed_story'|'unrateable'|null;
export type RatingImport={version:1;studyRunId:string;kind:RatingKind;role:'independent'|'adjudication';coderId:string;rows:{rowId:string;rating:RatingValue;missingReason:string|null}[]};
export type AnalystRow=Record<string,string|number|boolean|null>;

import { z } from 'zod';
const uuid=z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),hash=z.string().regex(/^[0-9a-f]{64}$/),version=z.string().min(1).max(200),scene=z.enum(['TM01','TM02','TM03','TM04','TM05','TM06','TM08','TM09','TM10','TM11','TM12']);
const bindingSchema=z.object({protocolVersion:z.string().min(1).max(80),modelVersion:version,promptVersion:version,rendererVersion:version,contactPolicyVersion:z.literal('noncontact-v1'),catalogueHash:hash,scoreHashes:z.array(z.object({sceneId:scene,scoreHash:hash}).strict()).min(1).max(11),operatorContact:z.string().min(1).max(240),providerDisclosureVersion:z.string().min(1).max(80)}).strict();
const evidenceSchema=z.object({phaseApprovalRecordId:uuid,approvedPhases:z.array(z.enum(['formative','bank_calibration','practice','comparative','optional_extra'])).min(1).max(5),providerApprovalRecordId:uuid,consentApproved:z.literal(true),providerRetentionVerified:z.literal(true),deletionOwnerConfirmed:z.literal(true),codingWorkloadApproved:z.literal(true),calibrationRecords:z.array(z.object({recordId:uuid,sceneId:scene,scoreHash:hash,cohortId:uuid,decision:z.literal('approved'),humanReviewed:z.literal(true)}).strict()).max(100)}).strict();
export function validateFreeze(binding:unknown,evidence:unknown):void {if(!bindingSchema.safeParse(binding).success||!evidenceSchema.safeParse(evidence).success)throw new StudyError('INVALID_INPUT');}
