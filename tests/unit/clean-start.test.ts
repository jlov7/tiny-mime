import { afterEach, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { copyStartupInputs, safeStartupEvent, stopCleanStart } from '../../scripts/verify-clean-start.js';
const roots: string[] = [];
const fixture = () => { mkdirSync('.scratch', { recursive: true }); const root = mkdtempSync(resolve('.scratch/clean-start-test-')); roots.push(root); return root; };
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
it('copies actual current tracked source bytes while never following forbidden credential paths', () => {
  const root = fixture(), copy = resolve(root, 'copy'); mkdirSync(resolve(root, 'src')); mkdirSync(resolve(root, 'scripts'));
  writeFileSync(resolve(root, 'src/app.ts'), 'current WIP bytes'); writeFileSync(resolve(root, 'scripts/npm-global.npmrc'), '# empty public config');
  for (const path of ['.env', '.npmrc', 'auth.json']) symlinkSync('/nonexistent/credentials', resolve(root, path));
  const inputs = copyStartupInputs(root, copy, ['src/app.ts', 'scripts/npm-global.npmrc', '.env', '.npmrc', 'auth.json', '../escape', '/escape']);
  expect(inputs.map(input => input.path)).toEqual(['scripts/npm-global.npmrc', 'src/app.ts']); expect(readFileSync(resolve(copy, 'src/app.ts'), 'utf8')).toBe('current WIP bytes');
  writeFileSync(resolve(root, 'src/app.ts'), 'changed WIP bytes'); expect(copyStartupInputs(root, copy, ['src/app.ts'])[0].sha256).not.toBe(inputs[1].sha256);
});
it('rejects allowlisted symlinks before reading their target', () => {
  const root = fixture(); mkdirSync(resolve(root, 'src')); symlinkSync('/nonexistent/credentials', resolve(root, 'src/app.ts'));
  expect(() => copyStartupInputs(root, resolve(root, 'copy'), ['src/app.ts'])).toThrow('SOURCE_SYMLINK');
});

it('copies the required local display font into isolated startup inputs', () => {
  const root = fixture(), path = 'src/client/assets/bricolage-grotesque-latin-variable.woff2';
  const inputs = copyStartupInputs(process.cwd(), root, [path]);
  expect(inputs.map(input => input.path)).toEqual([path]);
  expect(readFileSync(resolve(root, path)).equals(readFileSync(path))).toBe(true);
});

it('records only validated startup fields and strips any extra secret-bearing output', () => {
  const output = 'unretained terminal text\n' + JSON.stringify({ event: 'server_started', origin: 'http://127.0.0.1:4317', liveCallsAtStartup: 0, launchSecret: 'synthetic-private-value' });
  expect(safeStartupEvent(output)).toEqual({ event: 'server_started', origin: 'http://127.0.0.1:4317', liveCallsAtStartup: 0 });
  expect(safeStartupEvent(JSON.stringify({ event: 'server_started', origin: 'http://localhost:4317', liveCallsAtStartup: 0 }))).toBeNull();
  expect(safeStartupEvent('{"event":"server_started",bad}')).toBeNull();
});
it('stops its owned process group while allowing cooperative cleanup', async () => {
  const root = fixture(), marker = resolve(root, 'cleanup');
  const code = `process.on('SIGTERM',()=>{require('node:fs').writeFileSync(${JSON.stringify(marker)},'clean');process.exit(0)});process.stdout.write('ready');setInterval(()=>{},1000)`;
  const child = spawn(process.execPath, ['-e', code], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    await new Promise<void>((done, reject) => { child.stdout!.once('data', () => done()); child.once('error', reject); });
    await stopCleanStart(child, child.pid); expect(child.exitCode).toBe(0); expect(readFileSync(marker, 'utf8')).toBe('clean');
  } finally { await stopCleanStart(child, child.pid); }
});
