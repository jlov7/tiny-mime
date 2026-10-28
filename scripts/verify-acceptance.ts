import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';

const technicalPath = 'Tiny_Mime_Review_Source_Pack/supplements/technical-test-fixtures-v1.json';
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const testReference = z.strictObject({ stage: z.enum(['unit', 'browser', 'build']), path: z.string().min(1), title: z.string().min(1) });
export const acceptanceRegistrySchema = z.strictObject({
  version: z.literal(1),
  technicalSource: z.strictObject({ path: z.literal(technicalPath), sha256: hash }),
  fixtureManifest: z.strictObject({ path: z.literal('fixtures/manifest.json'), sha256: hash }),
  browserProjects: z.array(z.string().min(1)).min(1),
  fixtures: z.array(z.strictObject({ id: z.string().min(1), inputPath: z.string().min(1), sha256: hash, requirementIds: z.array(z.string().min(1)).min(1), test: testReference })).length(69),
  requirements: z.array(z.strictObject({ sourceId: z.string().min(1), tests: z.array(testReference).min(1) })).length(76),
});
export type AcceptanceRegistry = z.infer<typeof acceptanceRegistrySchema>;
type Manifest = { cases: { id: string; inputPath: string; sha256: string; testPath: string; requirementIds: string[] }[] };
type Execution = { stage: string; path: string; title: string; status: string; project?: string };
export type AcceptanceReports = { unit: unknown; browser: unknown; build: unknown };
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
function exactSet(actual: string[], expected: string[], label: string) {
  if (new Set(actual).size !== actual.length) throw new Error('DUPLICATE_' + label);
  if (actual.length !== expected.length || actual.some(id => !expected.includes(id))) throw new Error('INCOMPLETE_' + label);
}
function safeRelative(path: string) {
  if (isAbsolute(path) || path.split('/').includes('..') || path.includes('\\')) throw new Error('PATH_ESCAPE');
  return path;
}
export function assertClosedFixtureManifest(manifest: Manifest, registry: AcceptanceRegistry) {
  exactSet(manifest.cases.map(c => c.id), registry.fixtures.map(c => c.id), 'FIXTURE_IDS');
  for (const binding of registry.fixtures) {
    const fixture = manifest.cases.find(c => c.id === binding.id)!;
    if (fixture.sha256 !== binding.sha256 || fixture.inputPath !== binding.inputPath || fixture.testPath !== binding.test.path || binding.test.stage !== 'unit' || binding.test.title !== binding.id) throw new Error('FIXTURE_BINDING_MISMATCH ' + binding.id);
    exactSet(fixture.requirementIds, binding.requirementIds, 'FIXTURE_REQUIREMENTS ' + binding.id);
  }
}
export function validateAcceptanceRegistry(value: unknown, sourceIds: string[]): AcceptanceRegistry {
  const registry = acceptanceRegistrySchema.parse(value);
  exactSet(registry.requirements.map(r => r.sourceId), sourceIds, 'SOURCE_IDS');
  exactSet(registry.fixtures.map(f => f.id), registry.fixtures.map(f => f.id), 'REGISTRY_FIXTURE_IDS');
  exactSet(registry.browserProjects, ['chromium', 'firefox', 'webkit'], 'BROWSER_PROJECTS');
  for (const tests of [...registry.requirements.map(r => r.tests), registry.fixtures.map(f => f.test)]) {
    const keys = tests.map(t => {
      safeRelative(t.path);
      if (t.stage === 'unit' && !/^tests\/unit\/.+\.test\.ts$/.test(t.path)) throw new Error('INVALID_TEST_PATH');
      if (t.stage === 'browser' && !/^tests\/browser\/.+\.spec\.ts$/.test(t.path)) throw new Error('INVALID_TEST_PATH');
      if (t.stage === 'build' && (t.path !== 'package.json' || t.title !== 'npm run build')) throw new Error('INVALID_BUILD_BINDING');
      return JSON.stringify(t);
    });
    if (new Set(keys).size !== keys.length) throw new Error('DUPLICATE_TEST_BINDING');
  }
  return registry;
}
export function loadAcceptanceRegistry(root = process.cwd()) {
  const value = JSON.parse(readFileSync(resolve(root, 'fixtures/acceptance-registry.json'), 'utf8'));
  const sourceBytes = readFileSync(resolve(root, technicalPath));
  const source = z.object({ cases: z.array(z.object({ id: z.string() })).length(76) }).parse(JSON.parse(sourceBytes.toString('utf8')));
  const registry = validateAcceptanceRegistry(value, source.cases.map(c => c.id));
  if (digest(sourceBytes) !== registry.technicalSource.sha256) throw new Error('SOURCE_HASH_MISMATCH');
  const manifestBytes = readFileSync(resolve(root, registry.fixtureManifest.path));
  if (digest(manifestBytes) !== registry.fixtureManifest.sha256) throw new Error('MANIFEST_HASH_MISMATCH');
  assertClosedFixtureManifest(JSON.parse(manifestBytes.toString('utf8')), registry);
  return registry;
}
function reportPath(path: string, root: string, browser = false) {
  const result = isAbsolute(path) ? relative(resolve(root), path) : path;
  safeRelative(result);
  return browser && !result.startsWith('tests/browser/') ? 'tests/browser/' + result : result;
}
export function executionsFromReports(reports: AcceptanceReports, root = process.cwd()): Execution[] {
  const unit = z.object({ success: z.literal(true), testResults: z.array(z.object({ name: z.string(), assertionResults: z.array(z.object({ title: z.string(), status: z.string() })) })) }).parse(reports.unit);
  const executions: Execution[] = unit.testResults.flatMap(file => file.assertionResults.map(test => ({ stage: 'unit', path: reportPath(file.name, root), title: test.title, status: test.status })));
  const browser = z.object({ suites: z.array(z.unknown()), errors: z.array(z.unknown()).max(0) }).parse(reports.browser);
  const specSchema = z.object({ title: z.string(), file: z.string(), tests: z.array(z.object({ projectName: z.string(), expectedStatus: z.literal('passed'), results: z.array(z.object({ status: z.string() })).min(1) })) });
  const walk = (value: unknown) => {
    const suite = z.object({ suites: z.array(z.unknown()).optional(), specs: z.array(z.unknown()).optional() }).parse(value);
    for (const raw of suite.specs ?? []) {
      const spec = specSchema.parse(raw);
      for (const test of spec.tests) executions.push({ stage: 'browser', path: reportPath(spec.file, root, true), title: spec.title, project: test.projectName, status: test.results.every(result => result.status === 'passed') ? 'passed' : 'failed' });
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of browser.suites) walk(suite);
  const build = z.object({ command: z.literal('npm run build'), exitCode: z.literal(0) }).parse(reports.build);
  executions.push({ stage: 'build', path: 'package.json', title: build.command, status: 'passed' });
  return executions;
}
export function verifyAcceptanceReports(registry: AcceptanceRegistry, reports: AcceptanceReports, root = process.cwd()) {
  if (!isDeepStrictEqual(registry, loadAcceptanceRegistry(root))) throw new Error('REGISTRY_MISMATCH');
  const executions = executionsFromReports(reports, root);
  const consume = (test: z.infer<typeof testReference>, id: string) => {
    const projects = test.stage === 'browser' ? registry.browserProjects : [undefined];
    for (const project of projects) {
      const matches = executions.filter(e => e.stage === test.stage && e.path === test.path && e.title === test.title && e.project === project);
      if (matches.length !== 1 || matches[0].status !== 'passed') throw new Error('UNCONSUMED_ACCEPTANCE ' + id + ' ' + JSON.stringify({ ...test, project }));
    }
  };
  for (const fixture of registry.fixtures) consume(fixture.test, fixture.id);
  for (const requirement of registry.requirements) for (const test of requirement.tests) consume(test, requirement.sourceId);
  return { status: 'PASS', sourceRequirements: registry.requirements.length, numericFixtures: registry.fixtures.length, browserProjects: registry.browserProjects, empiricalQualifications: 'NOT RUN' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const argumentsMap = new Map<string, string>();
    for (let i = 2; i < process.argv.length; i += 2) {
      const key = process.argv[i], value = process.argv[i + 1];
      if (!['--unit', '--browser', '--build'].includes(key) || !value || argumentsMap.has(key)) throw new Error('REQUIRED_REPORT_ARGUMENTS');
      argumentsMap.set(key, value);
    }
    const read = (key: string) => {
      const path = argumentsMap.get(key);
      if (!path) throw new Error('MISSING_REPORT ' + key);
      return JSON.parse(readFileSync(resolve(path), 'utf8'));
    };
    console.log(JSON.stringify(verifyAcceptanceReports(loadAcceptanceRegistry(), { unit: read('--unit'), browser: read('--browser'), build: read('--build') }), null, 2));
  } catch (error) { console.error(JSON.stringify({ status: 'FAIL', error: String(error) })); process.exitCode = 1; }
}
