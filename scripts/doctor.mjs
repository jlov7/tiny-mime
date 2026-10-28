import { existsSync } from 'node:fs';
import { toolchain, dependencies, sqlite, browsers, portAvailable } from './local-runtime.mjs';
const mode = process.argv[2] ?? 'setup';
if (!['setup', 'test'].includes(mode) || process.argv.length > 3) { process.stderr.write('Usage: npm run doctor -- [setup|test]\n'); process.exitCode = 1; }
else {
  const checks = { ...toolchain(), dependencies: dependencies() ? 'PASS' : 'MISSING', nativeSQLite: sqlite(), browserBinaries: browsers(), productionBuild: existsSync('dist/server/server/http.js') && existsSync('dist/client/index.html') ? 'PASS' : 'MISSING', port4317: await portAvailable() ? 'AVAILABLE' : 'OCCUPIED_OR_UNAVAILABLE' };
  const setupReady = checks.node.status === 'PASS' && checks.npm.status === 'PASS' && checks.port4317 === 'AVAILABLE';
  const ready = setupReady && (mode === 'setup' || checks.dependencies === 'PASS' && checks.nativeSQLite === 'PASS' && Object.values(checks.browserBinaries).every(status => status === 'PASS'));
  process.stdout.write(JSON.stringify({ mode, status: ready ? 'PASS' : 'FAIL', checks, empiricalQualifications: 'NOT RUN' }, null, 2) + '\n');
  if (!ready) process.exitCode = 1;
}
