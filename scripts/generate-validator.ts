import { readFileSync, writeFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import standaloneCode from 'ajv/dist/standalone/index.js';

const schema = JSON.parse(readFileSync('src/shared/score.schema.json', 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false, code: { source: true, esm: true } });
const code = standaloneCode(ajv, ajv.compile(schema));
if (/require\(|new Function|\beval\(/.test(code)) throw new Error('NON_STANDALONE_VALIDATOR');
writeFileSync('src/shared/scoreStructural.js', code + '\n');
