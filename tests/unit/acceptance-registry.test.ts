import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { acceptanceRegistrySchema, assertClosedFixtureManifest, loadAcceptanceRegistry, validateAcceptanceRegistry, verifyAcceptanceReports, type AcceptanceRegistry } from '../../scripts/verify-acceptance.js';

const registry = loadAcceptanceRegistry();
const sourceIds = registry.requirements.map(r => r.sourceId);
function passingReports(value: AcceptanceRegistry = registry) {
  const references = [...value.fixtures.map(f => f.test), ...value.requirements.flatMap(r => r.tests)];
  const unique = [...new Map(references.map(test => [JSON.stringify(test), test])).values()];
  return {
    unit: { success: true, testResults: unique.filter(t => t.stage === 'unit').map(test => ({ name: resolve(test.path), assertionResults: [{ title: test.title, status: 'passed' }] })) },
    browser: { errors: [], suites: [{ specs: unique.filter(t => t.stage === 'browser').map(test => ({ file: test.path, title: test.title, tests: value.browserProjects.map(projectName => ({ projectName, expectedStatus: 'passed', results: [{ status: 'passed' }] })) })) }] },
    build: { command: 'npm run build', exitCode: 0 },
  };
}
it('closes all source requirements and numeric fixtures independently of generated tests', () => {
  expect(registry.requirements).toHaveLength(76); expect(registry.fixtures).toHaveLength(69);
  expect(() => validateAcceptanceRegistry({ ...registry, requirements: registry.requirements.slice(1) }, sourceIds)).toThrow();
  const duplicate = structuredClone(registry); duplicate.requirements[1] = duplicate.requirements[0];
  expect(() => validateAcceptanceRegistry(duplicate, sourceIds)).toThrow('DUPLICATE_SOURCE_IDS');
  const unknown = structuredClone(registry); unknown.requirements[0].sourceId = 'UNKNOWN';
  expect(() => validateAcceptanceRegistry(unknown, sourceIds)).toThrow('INCOMPLETE_SOURCE_IDS');
  expect(() => acceptanceRegistrySchema.parse({ ...registry, fixtures: registry.fixtures.slice(1) })).toThrow();
  expect(() => verifyAcceptanceReports({ ...registry, requirements: registry.requirements.slice(1) }, passingReports())).toThrow('REGISTRY_MISMATCH');
});
it('rejects removed, duplicate, changed and incorrectly linked manifest fixtures', () => {
  const manifest = JSON.parse(readFileSync('fixtures/manifest.json', 'utf8'));
  expect(() => assertClosedFixtureManifest(manifest, registry)).not.toThrow();
  expect(() => assertClosedFixtureManifest({ cases: manifest.cases.slice(1) }, registry)).toThrow('INCOMPLETE_FIXTURE_IDS');
  expect(() => assertClosedFixtureManifest({ cases: [...manifest.cases, manifest.cases[0]] }, registry)).toThrow('DUPLICATE_FIXTURE_IDS');
  const changed = structuredClone(manifest); changed.cases[0].sha256 = '0'.repeat(64);
  expect(() => assertClosedFixtureManifest(changed, registry)).toThrow('FIXTURE_BINDING_MISMATCH');
  const linked = structuredClone(registry); linked.fixtures[0].test.title = 'other';
  expect(() => assertClosedFixtureManifest(manifest, linked)).toThrow('FIXTURE_BINDING_MISMATCH');
  const duplicate = structuredClone(registry); duplicate.fixtures[1] = duplicate.fixtures[0];
  expect(() => validateAcceptanceRegistry(duplicate, sourceIds)).toThrow('DUPLICATE_REGISTRY_FIXTURE_IDS');
});
it('checks exact source and manifest byte hashes before accepting structural linkage', () => {
  mkdirSync('.scratch', { recursive: true }); const root = mkdtempSync(resolve('.scratch', 'acceptance-test-'));
  try {
    for (const path of ['fixtures/acceptance-registry.json', registry.technicalSource.path, registry.fixtureManifest.path]) { mkdirSync(dirname(resolve(root, path)), { recursive: true }); cpSync(path, resolve(root, path)); }
    expect(loadAcceptanceRegistry(root)).toEqual(registry);
    writeFileSync(resolve(root, registry.technicalSource.path), readFileSync(registry.technicalSource.path, 'utf8') + '\n');
    expect(() => loadAcceptanceRegistry(root)).toThrow('SOURCE_HASH_MISMATCH');
    cpSync(registry.technicalSource.path, resolve(root, registry.technicalSource.path));
    writeFileSync(resolve(root, registry.fixtureManifest.path), readFileSync(registry.fixtureManifest.path, 'utf8') + '\n');
    expect(() => loadAcceptanceRegistry(root)).toThrow('MANIFEST_HASH_MISMATCH');
  } finally { rmSync(root, { recursive: true }); }
});
it('consumes exact report file and title assertions, never source text or substring evidence', () => {
  expect(verifyAcceptanceReports(registry, passingReports())).toMatchObject({ status: 'PASS', sourceRequirements: 76, numericFixtures: 69 });
  const absent = passingReports(); absent.unit.testResults.shift();
  expect(() => verifyAcceptanceReports(registry, absent)).toThrow('UNCONSUMED_ACCEPTANCE');
  const title = passingReports(); title.unit.testResults[0].assertionResults[0].title += ' extra';
  expect(() => verifyAcceptanceReports(registry, title)).toThrow('UNCONSUMED_ACCEPTANCE');
  const path = passingReports(); path.unit.testResults[0].name = resolve('tests/unit/unrelated.test.ts');
  expect(() => verifyAcceptanceReports(registry, path)).toThrow('UNCONSUMED_ACCEPTANCE');
  expect(() => verifyAcceptanceReports(registry, { unit: 'tests contain every ID', browser: {}, build: {} })).toThrow();
});
it('rejects skipped, failing or duplicate unit assertions and failed build execution', () => {
  for (const status of ['skipped', 'pending', 'failed']) { const reports = passingReports(); reports.unit.testResults[0].assertionResults[0].status = status; expect(() => verifyAcceptanceReports(registry, reports)).toThrow('UNCONSUMED_ACCEPTANCE'); }
  const duplicate = passingReports(); duplicate.unit.testResults.push(duplicate.unit.testResults[0]);
  expect(() => verifyAcceptanceReports(registry, duplicate)).toThrow('UNCONSUMED_ACCEPTANCE');
  const build = passingReports(); build.build.exitCode = 1;
  expect(() => verifyAcceptanceReports(registry, build)).toThrow();
});
it('requires each browser engine to execute every mapped test without skips or failed retries', () => {
  for (const status of ['skipped', 'timedOut', 'failed']) { const reports = passingReports(); reports.browser.suites[0].specs[0].tests[0].results[0].status = status; expect(() => verifyAcceptanceReports(registry, reports)).toThrow('UNCONSUMED_ACCEPTANCE'); }
  const absent = passingReports(); absent.browser.suites[0].specs[0].tests.pop();
  expect(() => verifyAcceptanceReports(registry, absent)).toThrow('UNCONSUMED_ACCEPTANCE');
  const retry = passingReports(); retry.browser.suites[0].specs[0].tests[0].results.unshift({ status: 'failed' });
  expect(() => verifyAcceptanceReports(registry, retry)).toThrow('UNCONSUMED_ACCEPTANCE');
  const duplicate = passingReports(); duplicate.browser.suites[0].specs[0].tests.push(duplicate.browser.suites[0].specs[0].tests[0]);
  expect(() => verifyAcceptanceReports(registry, duplicate)).toThrow('UNCONSUMED_ACCEPTANCE');
});
