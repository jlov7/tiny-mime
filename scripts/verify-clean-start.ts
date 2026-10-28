import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import type { Browser, Page } from '@playwright/test';
import { sealEvidence } from './evidence.js';
import { sourcePaths } from './source-distribution.js';

class CheckFailure extends Error { constructor(readonly code: string) { super(code); } }
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const startupEventSchema = z.object({ event: z.literal('server_started'), origin: z.literal('http://127.0.0.1:4317'), liveCallsAtStartup: z.literal(0) });
export function safeStartupEvent(output: string) {
  const line = /\{"event":"server_started",[^\r\n]*\}/.exec(output)?.[0];
  try { const result = startupEventSchema.safeParse(JSON.parse(line ?? 'null')); return result.success ? result.data : null; } catch { return null; }
}
const top = new Set(['README.md', 'START_HERE_CODEX.md', 'package.json', 'package-lock.json', 'toolchain-manifest.json', '.node-version', 'index.html', 'tsconfig.json', 'tsconfig.server.json', 'vite.config.ts']);
export function startupInputPath(path: string) {
  if (path.startsWith('/') || path.includes('\\') || path.split('/').some(part => part === '..' || part.startsWith('.env') || ['node_modules', '.scratch', 'artifacts'].includes(part))) return false;
  if (path === 'scripts/npm-global.npmrc') return true;
  if (path.split('/').some(part => /^(?:\.npmrc|auth|token|credentials?)(?:\.|$)/i.test(part))) return false;
  return top.has(path) || /^(src|scripts|fixtures|Tiny_Mime_Review_Source_Pack)\/.+\.(?:tsx?|mjs|js|json|css|html|md|svg|png|woff2|txt|csv|sha256)$/.test(path);
}
export function copyStartupInputs(root: string, destination: string, paths: string[]) {
  const inputs = paths.filter(startupInputPath).sort().map(path => {
    const source = resolve(root, path);
    for (let parent = source; parent !== resolve(root); parent = dirname(parent)) if (lstatSync(parent).isSymbolicLink()) throw new CheckFailure('SOURCE_SYMLINK');
    const bytes = readFileSync(source), target = resolve(destination, path);
    mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes);
    return { path, sha256: digest(bytes), bytes: bytes.length };
  });
  if (inputs.some(input => digest(readFileSync(resolve(root, input.path))) !== input.sha256)) throw new CheckFailure('SOURCE_CHANGED_DURING_COPY');
  return inputs;
}
const wait = (ms: number) => new Promise<void>(done => setTimeout(done, ms));
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
export async function stopCleanStart(child: ChildProcess, ttyGroup?: number) {
  const signal = (name: NodeJS.Signals) => {
    if (ttyGroup && alive(-ttyGroup)) try { process.kill(-ttyGroup, name); } catch {}
    if (child.pid && child.exitCode === null && child.signalCode === null) child.kill(name);
  };
  signal('SIGTERM');
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && (child.exitCode === null && child.signalCode === null || ttyGroup && alive(-ttyGroup))) await wait(100);
  if (child.exitCode === null && child.signalCode === null || ttyGroup && alive(-ttyGroup)) { signal('SIGKILL'); await wait(100); }
}

export async function verifyCleanStart(root = process.cwd()) {
  const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-clean-start-' + randomUUID();
  const evidence = resolve(root, 'artifacts/verification', runId); mkdirSync(evidence, { recursive: true });
  const receipt: { status: string; command: string; sourceMode: string; driverSha256: string; stages: unknown[]; scratchRemoved: boolean; failureCode?: string; startedAt: string; finishedAt?: string } = { status: 'RUNNING', command: 'npm run local', sourceMode: 'actual allowlisted tracked current bytes, including WIP', driverSha256: digest(readFileSync(fileURLToPath(import.meta.url))), startedAt: new Date().toISOString(), stages: [], scratchRemoved: false };
  const save = () => writeFileSync(resolve(evidence, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n'); save();
  let scratch: string | undefined, child: ChildProcess | undefined, browser: Browser | undefined, ttyGroup: number | undefined;
  let launchSecret = '', pendingOutput = '', serverStarted = false, installSeen = false, buildSeen = false;
  let startupEvent: ReturnType<typeof safeStartupEvent> = null;
  let stage = 'SOURCE_COPY';
  try {
    const listing = sourcePaths(root);
    mkdirSync(resolve(root, '.scratch'), { recursive: true }); scratch = mkdtempSync(resolve(root, '.scratch/clean-start-'));
    const checkout = resolve(scratch, 'app'), data = resolve(scratch, 'data'); mkdirSync(checkout);
    const inputs = copyStartupInputs(root, checkout, listing);
    writeFileSync(resolve(evidence, 'inputs.json'), JSON.stringify(inputs, null, 2) + '\n');
    if (existsSync(resolve(checkout, 'node_modules'))) throw new CheckFailure('FRESH_DEPENDENCIES_REQUIRED');
    receipt.stages.push({ stage: 'source-copy', status: 'PASS', inputFiles: inputs.length, existingDependencies: false }); save();
    stage = 'LOCAL_STARTUP';
    if (!process.stdin.isTTY) throw new CheckFailure('INTERACTIVE_TTY_REQUIRED');
    const env = { ...Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM'].flatMap(name => process.env[name] === undefined ? [] : [[name, process.env[name]!] ])), npm_config_userconfig: '/dev/null', npm_config_globalconfig: resolve(checkout, 'scripts/npm-global.npmrc'), npm_config_registry: 'https://registry.npmjs.org', npm_config_cache: resolve(scratch, 'npm-cache'), TM_DATA_DIR: data };
    const wrapper = 'printf \'{"event":"clean_start_pty","pid":%s}\\n\' "$$"; exec npm run local';
    child = spawn('/usr/bin/script', ['-q', '/dev/null', '/bin/sh', '-c', wrapper], { cwd: checkout, env, detached: true, stdio: ['inherit', 'pipe', 'pipe'] });
    const ownedChild = child;
    await new Promise<void>((done, reject) => {
      const timer = setTimeout(() => reject(new CheckFailure('LOCAL_STARTUP_TIMEOUT')), 300000);
      const consume = (chunk: Buffer) => {
        pendingOutput = (pendingOutput + chunk.toString('utf8')).slice(-16384);
        const group = /"event":"clean_start_pty","pid":(\d+)/.exec(pendingOutput); if (group) ttyGroup = Number(group[1]);
        const secret = /Tiny Mime operator launch secret \(one use\): ([A-Za-z0-9_-]{43})/.exec(pendingOutput); if (secret) launchSecret = secret[1];
        installSeen ||= pendingOutput.includes('Installing committed package-lock.json with npm ci.');
        buildSeen ||= pendingOutput.includes('Building Tiny Mime.');
        startupEvent ??= safeStartupEvent(pendingOutput); serverStarted ||= !!startupEvent;
        if (serverStarted && launchSecret) { clearTimeout(timer); pendingOutput = ''; done(); }
      };
      ownedChild.stdout!.on('data', consume); ownedChild.stderr!.on('data', consume);
      ownedChild.once('error', () => { clearTimeout(timer); reject(new CheckFailure('LOCAL_STARTUP_PROCESS')); });
      ownedChild.once('exit', () => { clearTimeout(timer); reject(new CheckFailure('LOCAL_STARTUP_EXIT')); });
    });
    const { sqlite } = createRequire(import.meta.url)('./local-runtime.mjs') as { sqlite: (root: string) => string };
    const nativeSQLite = sqlite(checkout), compiledServerPresent = existsSync(resolve(checkout, 'dist/server/server/http.js'));
    const started = installSeen && buildSeen && nativeSQLite === 'PASS' && compiledServerPresent && serverStarted;
    receipt.stages.push({ stage: 'fresh-local-start', status: started ? 'PASS' : 'FAIL', npmCiObserved: installSeen, buildObserved: buildSeen, nativeSQLite, compiledServerPresent, productionServerStarted: serverStarted, startupEvent, ttySecretKeptInMemory: true }); save();
    if (!started) throw new CheckFailure('FRESH_INSTALL_BUILD_NOT_OBSERVED');
    const { chromium, expect } = createRequire(resolve(root, 'package.json'))('@playwright/test') as typeof import('@playwright/test');
    browser = await chromium.launch(); const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, reducedMotion: 'no-preference' });
    let externalRequests = 0, pageErrors = 0;
    await context.route('**/*', route => { if (route.request().url().startsWith('http://127.0.0.1:4317/')) return route.continue(); externalRequests++; return route.abort(); });
    const page = await context.newPage(); page.on('pageerror', () => { pageErrors++; }); page.setDefaultTimeout(15000);
    stage = 'FIRST_VISIT'; await page.goto('http://127.0.0.1:4317/'); await expect(page.getByRole('heading', { name: 'A tiny silent scene.', exact: true })).toBeVisible();
    await page.screenshot({ path: resolve(evidence, 'desktop-first-visit.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: resolve(evidence, 'phone-first-visit.png'), fullPage: true }); await page.setViewportSize({ width: 1280, height: 1000 });
    stage = 'UI_UNLOCK'; await page.getByRole('link', { name: 'Open directing demo', exact: true }).click(); await page.getByLabel('Launch secret', { exact: true }).fill(launchSecret); launchSecret = '';
    await page.getByRole('button', { name: 'Unlock operator tools', exact: true }).click(); await expect(page).toHaveURL('http://127.0.0.1:4317/showcase'); await expect(page.getByRole('heading', { name: 'A matter of timing.', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Play', exact: true }).click();
    const journey = async (view: Page, mode: 'motion' | 'frames', name: string) => {
      await view.getByRole('button', { name: 'Try a fixture round', exact: true }).click();
      await expect(view.getByRole('heading', { name: 'Take 1 of 2.', exact: true })).toBeVisible();
      await view.screenshot({ path: resolve(evidence, name + '-ready.png'), fullPage: true });
      for (const attempt of [1, 2] as const) {
        stage = name.toUpperCase() + '_TAKE_' + attempt;
        const label = attempt === 1 ? 'What’s happening?' : 'What do you think now?';
        if (mode === 'motion') await view.getByRole('button', { name: attempt === 1 ? 'Play scene' : 'Play next take', exact: true }).click();
        else {
          if (attempt === 2) await view.getByRole('button', { name: 'View next take', exact: true }).click();
          await expect(view.getByRole('button', { name: 'Next frame', exact: true })).toBeVisible();
          const roundId = await view.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId);
          const round = await (await view.request.get('http://127.0.0.1:4317/api/rounds/' + roundId)).json();
          const times = new Set(round.acts[attempt - 1].score.actors.flatMap((actor: { keyframes: { tMs: number }[] }) => actor.keyframes.map(key => key.tMs)));
          for (let frame = 1; frame < times.size; frame++) await view.getByRole('button', { name: 'Next frame', exact: true }).click();
        }
        await expect(view.getByRole('textbox', { name: label, exact: true })).toBeEnabled({ timeout: 15000 });
        await view.getByRole('textbox', { name: label, exact: true }).fill(attempt === 1 ? 'Synthetic startup check: one shape follows another.' : 'Synthetic startup check: the shapes are taking turns.');
        await view.getByRole('button', { name: attempt === 1 ? 'Send guess' : 'Send final guess', exact: true }).click();
        if (attempt === 1) await expect(view.getByRole('button', { name: mode === 'motion' ? 'Play next take' : 'View next take', exact: true })).toBeVisible();
      }
      stage = name.toUpperCase() + '_REVEAL'; await expect(view.getByRole('heading', { name: 'The scene was meant to show…', exact: true })).toBeVisible();
      await view.screenshot({ path: resolve(evidence, name + '-reveal.png'), fullPage: true }); receipt.stages.push({ stage: name + '-fixture-journey', status: 'PASS', viewingMode: mode, viewport: view.viewportSize(), guesses: 2, source: 'authored first take / mock fixture second take' }); save();
    };
    await journey(page, 'motion', 'desktop');
    const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    await phoneContext.addCookies((await context.cookies()).filter(cookie => cookie.name === 'tm_operator'));
    await phoneContext.route('**/*', route => { if (route.request().url().startsWith('http://127.0.0.1:4317/')) return route.continue(); externalRequests++; return route.abort(); });
    const phone = await phoneContext.newPage(); phone.setDefaultTimeout(15000); phone.on('pageerror', () => { pageErrors++; }); await phone.goto('http://127.0.0.1:4317/play'); await journey(phone, 'frames', 'phone');
    if (externalRequests || pageErrors) throw new CheckFailure('BROWSER_REQUEST_OR_RUNTIME_ERROR');
    receipt.stages.push({ stage: 'browser-isolation', status: 'PASS', externalRequests, pageErrors, physicalDevices: 'NOT RUN', humanComprehension: 'NOT RUN', liveProvider: 'NOT RUN' }); receipt.status = 'PASS';
  } catch (error) { receipt.status = 'FAIL'; receipt.failureCode = error instanceof CheckFailure ? error.code : stage + '_FAILED'; receipt.stages.push({ stage, status: 'FAIL', childExitCode: child?.exitCode ?? null }); }
  finally {
    launchSecret = ''; pendingOutput = '';
    try { await browser?.close(); } catch { receipt.status = 'FAIL'; receipt.failureCode = 'BROWSER_CLEANUP_FAILED'; }
    if (child) await stopCleanStart(child, ttyGroup);
    receipt.finishedAt = new Date().toISOString(); save();
    if (scratch) { rmSync(scratch, { recursive: true, force: true }); receipt.scratchRemoved = !existsSync(scratch); }
    save(); sealEvidence(evidence);
  }
  return { status: receipt.status, failureCode: receipt.failureCode ?? null, receipt: resolve(evidence, 'receipt.json'), scratchRemoved: receipt.scratchRemoved };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await verifyCleanStart(); process.stdout.write(JSON.stringify(result) + '\n'); if (result.status !== 'PASS') process.exitCode = 1;
}
