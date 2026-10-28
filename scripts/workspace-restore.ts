import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { restoreWorkspace } from '../src/server/operator/workspaceBackup.js';

export function runWorkspaceRestore(args: string[]) {
  if (args.length !== 4 || args[0] !== '--backup' || !args[1] || args[2] !== '--data-dir' || !args[3]) return { output: { status: 'ERROR', code: 'ARGUMENTS_INVALID' }, exitCode: 1 };
  try { return { output: restoreWorkspace(args[1], args[3]), exitCode: 0 }; }
  catch { return { output: { status: 'ERROR', code: 'WORKSPACE_REJECTED' }, exitCode: 1 }; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = runWorkspaceRestore(process.argv.slice(2)); process.stdout.write(JSON.stringify(result.output) + '\n'); process.exitCode = result.exitCode;
}
