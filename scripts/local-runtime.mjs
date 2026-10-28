import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import { resolve } from 'node:path';

export function localEnvironment() {
  return { ...Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM', 'npm_execpath', 'npm_config_cache'].flatMap(name => process.env[name] === undefined ? [] : [[name, process.env[name]]])), npm_config_userconfig: '/dev/null', npm_config_globalconfig: resolve('scripts/npm-global.npmrc'), npm_config_registry: 'https://registry.npmjs.org' };
}
export function toolchain(root = process.cwd()) {
  const expected = JSON.parse(readFileSync(resolve(root, 'toolchain-manifest.json'), 'utf8'));
  const npm = spawnSync('npm', ['--version'], { encoding: 'utf8', timeout: 10000, env: localEnvironment() });
  return { node: { status: process.version === expected.node ? 'PASS' : 'FAIL', expected: expected.node, actual: process.version }, npm: { status: !npm.error && npm.status === 0 && npm.stdout.trim() === expected.npm ? 'PASS' : 'FAIL', expected: expected.npm, actual: npm.stdout?.trim() || 'UNAVAILABLE' } };
}
export function dependencies(root = process.cwd()) {
  const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
  const declared = { ...lock.packages[''].dependencies, ...lock.packages[''].devDependencies };
  return Object.entries(declared).every(([name, version]) => {
    const file = resolve(root, 'node_modules', name, 'package.json');
    return existsSync(file) && JSON.parse(readFileSync(file, 'utf8')).version === version;
  });
}
export function sqlite(root = process.cwd()) {
  try { const require = createRequire(resolve(root, 'package.json')); const Database = require(resolve(root, 'node_modules/better-sqlite3')); const db = new Database(':memory:'); db.prepare('SELECT 1').get(); db.close(); return 'PASS'; } catch { return 'UNAVAILABLE'; }
}
export async function portAvailable() {
  return new Promise(resolve => { const server = net.createServer(); server.once('error', () => resolve(false)); server.listen(4317, '127.0.0.1', () => server.close(() => resolve(true))); });
}
export function browsers(root = process.cwd()) {
  try { const require = createRequire(resolve(root, 'package.json')); const playwright = require(resolve(root, 'node_modules/@playwright/test')); return Object.fromEntries(['chromium', 'firefox', 'webkit'].map(name => [name, existsSync(playwright[name].executablePath()) ? 'PASS' : 'UNAVAILABLE'])); } catch { return { chromium: 'UNAVAILABLE', firefox: 'UNAVAILABLE', webkit: 'UNAVAILABLE' }; }
}

export function runCommand(command, args, { env, timeoutMs = 0, killAfterMs = 5000, onStop = () => {}, stdio = 'inherit' } = {}) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { stdio, env });
    let timedOut = false, killTimer;
    const stop = signal => { child.kill(signal); killTimer ??= setTimeout(() => child.kill('SIGKILL'), killAfterMs); };
    onStop(stop);
    const timer = timeoutMs ? setTimeout(() => { timedOut = true; stop('SIGTERM'); }, timeoutMs) : undefined;
    const cleanup = () => { clearTimeout(timer); clearTimeout(killTimer); onStop(undefined); };
    child.once('error', error => { cleanup(); reject(error); });
    child.once('exit', (code, signal) => { cleanup(); if (timedOut) reject(new Error('COMMAND_TIMEOUT')); else if (code === 0) done(); else reject(new Error(signal ? 'COMMAND_INTERRUPTED' : 'COMMAND_FAILED')); });
  });
}
