import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function productionSmoke(root = process.cwd()) {
  const scratch = resolve(root, '.scratch'); mkdirSync(scratch, { recursive: true });
  const directory = mkdtempSync(resolve(scratch, 'production-smoke-'));
  const dataDir = resolve(directory, 'data'), launchDir = resolve(directory, 'app');
  mkdirSync(launchDir); symlinkSync(resolve(root, 'dist'), resolve(launchDir, 'dist'), 'dir');
  symlinkSync(resolve(root, 'Tiny_Mime_Review_Source_Pack'), resolve(launchDir, 'Tiny_Mime_Review_Source_Pack'), 'dir');
  const environment = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG'].flatMap(name => process.env[name] === undefined ? [] : [[name, process.env[name]!]]));
  const child = spawn(process.execPath, [resolve(root, 'dist/server/server/http.js')], { cwd: launchDir, stdio: ['ignore', 'pipe', 'pipe'], env: { ...environment, NODE_ENV: 'production', TM_DATA_DIR: dataDir, TM_STUDY_ENABLED: 'false', TM_PROVIDER_MODE: 'disabled' } });
  let output = '', error = '', cookie = '';
  child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { error += chunk; });
  const call = (path: string, body?: unknown, host = '127.0.0.1:4317', origin = 'http://127.0.0.1:4317') => new Promise<{ status: number; text: string }>((done, reject) => {
    const request = http.request({ host: '127.0.0.1', port: 4317, path, method: body === undefined ? 'GET' : 'POST', headers: { Host: host, Origin: origin, 'Content-Type': 'application/json', Cookie: cookie } }, response => {
      if (response.headers['set-cookie']) cookie = response.headers['set-cookie'][0].split(';')[0];
      let text = ''; response.on('data', chunk => { text += chunk; }); response.on('end', () => done({ status: response.statusCode!, text }));
    });
    request.setTimeout(5000, () => request.destroy(new Error('SMOKE_REQUEST_TIMEOUT'))); request.on('error', reject); request.end(body === undefined ? undefined : JSON.stringify(body));
  });
  try {
    await new Promise<void>((done, reject) => {
      const timer = setTimeout(() => reject(new Error('SMOKE_START_TIMEOUT')), 15000);
      const ready = () => { if (output.includes('"event":"server_started"')) { clearTimeout(timer); done(); } };
      child.stdout.on('data', ready); child.once('error', reject); child.once('exit', () => { clearTimeout(timer); reject(new Error('SMOKE_START_FAILED ' + (/code: '([A-Z_]+)'/.exec(error)?.[1] ?? 'CONFIGURATION_OR_PORT'))); });
    });
    const page = await call('/play'); if (page.status !== 200 || !page.text.includes('/assets/')) throw new Error('SMOKE_COMPILED_ASSETS');
    const session = await call('/api/session', {}); if (session.status !== 200) throw new Error('SMOKE_SESSION');
    const operator = await call('/api/operator/scenes'); if (operator.status !== 403) throw new Error('SMOKE_OPERATOR_CAPABILITY');
    const live = await call('/api/rounds', { requestId: randomUUID(), executionMode: 'live', mode: 'private_play', studySessionId: null }); if (live.status !== 503) throw new Error('SMOKE_LIVE_NOT_DISABLED');
    const fixture = await call('/api/rounds', { requestId: randomUUID(), executionMode: 'fixture', mode: 'private_play', studySessionId: null }); if (fixture.status !== 201) throw new Error('SMOKE_FIXTURE');
    if (/launchSecret|OPENAI_API_KEY|target|meaningId|condition/.test(fixture.text)) throw new Error('SMOKE_PRIVATE_READBACK');
    const wrongHost = await call('/play', undefined, 'localhost:4317'); if (wrongHost.status !== 403) throw new Error('SMOKE_HOST');
    const wrongOrigin = await call('/api/session', {}, '127.0.0.1:4317', 'http://localhost:4317'); if (wrongOrigin.status !== 403) throw new Error('SMOKE_ORIGIN');
    if (output.includes('launch secret') || error) throw new Error('SMOKE_SECRET_OR_SERVER_ERROR');
    return { status: 'PASS', compiledPage: page.status, fixture: fixture.status, liveDisabled: live.status, wrongHost: wrongHost.status, wrongOrigin: wrongOrigin.status, operatorForbidden: operator.status, secretReadback: false, empiricalQualifications: 'NOT RUN' };
  } finally {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      const stopped = new Promise<void>(done => child.once('exit', () => done())); child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000); await stopped; clearTimeout(timer);
    }
    rmSync(directory, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = process.env.TINY_MIME_EVIDENCE_ROOT ?? resolve('artifacts/verification', new Date().toISOString().replace(/[:.]/g, '-') + '-production-smoke-' + randomUUID());
  mkdirSync(directory, { recursive: true });
  const receipt = resolve(directory, 'production-smoke.json');
  try { const result = await productionSmoke(); if (receipt) writeFileSync(receipt, JSON.stringify(result, null, 2) + '\n'); process.stdout.write(JSON.stringify(result) + '\n'); }
  catch (error) { const result = { status: 'FAIL', error: String(error) }; if (receipt) writeFileSync(receipt, JSON.stringify(result, null, 2) + '\n'); process.stderr.write(JSON.stringify(result) + '\n'); process.exitCode = 1; }
}
