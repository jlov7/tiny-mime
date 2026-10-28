import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildPublicPreview } from '../src/server/operator/publicPreview.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function writeIdenticalOrNew(file: string, bytes: Buffer): void {
  let descriptor: number;
  try { descriptor = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new Error('PREVIEW_OUTPUT_REJECTED');
    const existing = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try { if (!fstatSync(existing).isFile() || fstatSync(existing).size !== bytes.length || !readFileSync(existing).equals(bytes)) throw new Error('PREVIEW_OUTPUT_EXISTS'); }
    finally { closeSync(existing); }
    return;
  }
  try { writeFileSync(descriptor, bytes); } finally { closeSync(descriptor); }
}
export function exportPublicPreview(root = projectRoot) {
  const trusted = resolve(root);
  if (realpathSync(trusted) !== trusted) throw new Error('PREVIEW_OUTPUT_REJECTED');
  const directory = join(trusted, 'artifacts', 'releases');
  for (const entry of [join(trusted, 'artifacts'), directory]) {
    try { mkdirSync(entry, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new Error('PREVIEW_OUTPUT_REJECTED'); }
    if (!lstatSync(entry).isDirectory() || lstatSync(entry).isSymbolicLink() || realpathSync(entry) !== entry) throw new Error('PREVIEW_OUTPUT_REJECTED');
  }
  const { html, manifest } = buildPublicPreview();
  const metadata = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  writeIdenticalOrNew(join(directory, manifest.file.name), html);
  writeIdenticalOrNew(join(directory, 'tiny-mime-preview-manifest.json'), metadata);
  return { version: 1 as const, status: 'PASS' as const, files: [
    { name: manifest.file.name, sha256: manifest.file.sha256 },
    { name: 'tiny-mime-preview-manifest.json', sha256: createHash('sha256').update(metadata).digest('hex') },
  ] };
}
export function runPublicPreview(args: string[], root = projectRoot) {
  if (args.length) return { exitCode: 1, output: { version: 1, status: 'ERROR', code: 'ARGUMENTS_INVALID' } };
  try { return { exitCode: 0, output: exportPublicPreview(root) }; }
  catch { return { exitCode: 1, output: { version: 1, status: 'ERROR', code: 'PREVIEW_EXPORT_FAILED' } }; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = runPublicPreview(process.argv.slice(2));
  process.stdout.write(JSON.stringify(result.output, null, 2) + '\n');
  process.exitCode = result.exitCode;
}
