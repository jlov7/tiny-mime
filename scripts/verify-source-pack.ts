import { verifySourcePack } from './evidence.js';
try { process.stdout.write(JSON.stringify(verifySourcePack()) + '\n'); }
catch (error) { process.stderr.write(JSON.stringify({ status: 'FAIL', error: String(error) }) + '\n'); process.exitCode = 1; }
