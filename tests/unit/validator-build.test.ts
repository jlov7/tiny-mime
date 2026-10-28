import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import standaloneCode from 'ajv/dist/standalone/index.js';
import { expect, it } from 'vitest';

it('the CSP-safe browser validator is compiled from the exact canonical score schema', () => {
  const schema = JSON.parse(readFileSync('src/shared/score.schema.json', 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false, code: { source: true, esm: true } });
  const expected = standaloneCode(ajv, ajv.compile(schema)) + '\n';
  expect(readFileSync('src/shared/scoreStructural.js', 'utf8')).toBe(expected);
  expect(expected).not.toMatch(/require\(|new Function|\beval\(/);
});
