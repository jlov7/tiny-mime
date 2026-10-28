import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from './formats.js';
import { parseJsonStrict } from '../shared/parseJson.js';

const ajv = new Ajv2020({ strict: false, allErrors: false, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv);
const root = path.resolve('Tiny_Mime_Review_Source_Pack/supplements');
const motion = JSON.parse(readFileSync(path.join(root, 'motion-score-v1.schema.json'), 'utf8'));
const api = JSON.parse(readFileSync(path.join(root, 'api-contracts-v1.schema.json'), 'utf8'));
// Approved local amendment. Keep every original closed event branch unchanged.
const eventBase = api.$defs.ClientEventV1.oneOf[0].properties;
const localDefs = { ...api.$defs, StudyWithdraw: { ...api.$defs.StudyWithdraw, properties: { ...api.$defs.StudyWithdraw.properties, expectedRecoveryOwnerId: api.$defs.StudyWithdraw.properties.requestId }, required: [...api.$defs.StudyWithdraw.required, 'expectedRecoveryOwnerId'] }, ClientEventV1: { oneOf: [...api.$defs.ClientEventV1.oneOf, {
  type: 'object', additionalProperties: false,
  properties: { eventId: eventBase.eventId, clientSequence: eventBase.clientSequence, elapsedMs: eventBase.elapsedMs, name: { const: 'motion_preference_observed' }, reducedMotion: { type: 'boolean' } },
  required: ['eventId', 'clientSequence', 'elapsedMs', 'name', 'reducedMotion'],
}] } };
ajv.addSchema(motion, 'motion-score-v1.schema.json');
const validators = new Map<string, ReturnType<typeof ajv.compile>>();
for (const name of Object.keys(api.$defs)) validators.set(name, ajv.compile({ $schema: api.$schema, $defs: localDefs, $ref: `#/$defs/${name}` }));
validators.set('StudyFinishInput', ajv.compile({ type: 'object', additionalProperties: false, properties: { requestId: api.$defs.SessionFeedback.properties.requestId }, required: ['requestId'] }));

export function matchesContract(name: string, value: unknown): boolean { return validators.get(name)?.(value) === true; }
export function parseRequest(raw: string, name: string, maxBytes = 4096): any {
  const value = parseJsonStrict(raw, { maxBytes, maxDepth: 8 });
  if (!matchesContract(name, value)) throw new Error('INVALID_INPUT');
  return value;
}
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
