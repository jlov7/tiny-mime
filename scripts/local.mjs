import { isAbsolute, resolve, sep } from 'node:path';
import { toolchain, dependencies, sqlite, localEnvironment, portAvailable, runCommand } from './local-runtime.mjs';
const environment = { ...localEnvironment(), TM_PROVIDER_MODE: 'disabled', TM_STUDY_ENABLED: 'false', NODE_ENV: 'production' };
let stopChild;
let interrupted = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { interrupted = true; stopChild?.(signal); });
const run = (command, args, timeoutMs) => runCommand(command, args, { env: environment, timeoutMs, onStop: stop => { stopChild = stop; } });
try {
  if (process.env.TM_DATA_DIR) {
    const dataDir = resolve(process.env.TM_DATA_DIR);
    if (!isAbsolute(process.env.TM_DATA_DIR) || dataDir === process.cwd() || dataDir.startsWith(process.cwd() + sep)) throw new Error('LOCAL_DATA_DIR_MUST_BE_ABSOLUTE_AND_OUTSIDE_APP_CWD');
    environment.TM_DATA_DIR = dataDir;
  }
  const versions = toolchain();
  if (versions.node.status !== 'PASS' || versions.npm.status !== 'PASS') throw new Error(`PINNED_TOOLCHAIN_REQUIRED: Node ${versions.node.expected}, npm ${versions.npm.expected}. Run npm run doctor.`);
  if (!await portAvailable()) throw new Error('PORT_4317_OCCUPIED_OR_UNAVAILABLE. Doctor reports it; local never stops another process.');
  if (!dependencies()) { process.stdout.write('Installing committed package-lock.json with npm ci.\n'); await run('npm', ['ci'], 300000); }
  if (interrupted) process.exitCode = 130;
  else {
    if (sqlite() !== 'PASS') throw new Error('NATIVE_SQLITE_UNAVAILABLE. Run npm run doctor.');
    process.stdout.write('Building Tiny Mime. Paid provider and real study are disabled for this local demo.\n');
    await run('npm', ['run', 'build'], 300000);
    if (!interrupted) { process.stdout.write('Opening local service at http://127.0.0.1:4317. Press Ctrl-C to stop.\n'); await run(process.execPath, ['dist/server/server/http.js'], 0); }
  }
  if (interrupted) process.exitCode = 130;
} catch (error) { if (interrupted) process.exitCode = 130; else { process.stderr.write(JSON.stringify({ event: 'local_failed', error: error.message }) + '\n'); process.exitCode = 1; } }
