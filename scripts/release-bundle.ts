import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildPublicFiles, publicZip } from './public-release.js';
import { sha256 } from './evidence.js';
import { buildPublicPreview } from '../src/server/operator/publicPreview.js';

const json = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + '\n');

export function releaseBundleFiles(root = process.cwd()) {
  const source = buildPublicFiles(root), preview = buildPublicPreview();
  const zip = publicZip(source.files, source.version), archiveSha256 = sha256(zip);
  const archive = `tiny-mime-${source.version}-source-${archiveSha256.slice(0, 12)}.zip`;
  const guide = Buffer.from(`# Tiny Mime ${source.version}\n\nOpen tiny-mime-preview.html to inspect three authored timing examples.\nIt works offline without an installation, server, account or API key.\nThe examples are prepared in advance and do not adapt to a guess.\n\nBefore extracting any files, check the bundle contents from its directory:\n\n\`\`\`sh\nshasum -a 256 -c SHA256SUMS\n\`\`\`\n\nA matching checksum confirms that files match this SHA256SUMS file. To check archive authenticity, calculate the downloaded source ZIP's SHA-256 and compare it with a reference obtained separately through a trusted channel. If the ZIP and reference came together in this bundle, that comparison does not establish independent authenticity.\n\nFor the complete directing workspace, extract ${archive}.\nRead its README.md, select the documented Node.js 24.15.0 and npm 12.0.0,\nthen run npm run local. Installation requires npm registry access.\nThe application uses http://127.0.0.1:4317 on the local computer.\n\nFrom a directing example, open either take in Rehearsal. Use the focused desk\nto revise a moment, compare exact changes, save a version and reopen it later.\nA pair inspection keeps both scores in a self-contained offline player.\nThis complete directing workflow makes no AI calls. In Versions, open\nBack up or restore saved work to download a private backup or preview a restore\nwhile the app is running. Existing versions and unsaved edits stay intact.\nThe source includes docs/WORKSPACE_BACKUP.md with recovery details.\n\nThe source includes Play, Rehearsal, Creator Capture and synthetic Study tools.\nFixture take two repeats take one. Live AI needs separately approved server-side\nAPI configuration and a budget. No subscription or hosted account is shared.\n\nHuman comprehension, enjoyment, per-scene calibration, semantic-fidelity coding,\nactual assistive-technology use, comparative benefit, physical-device testing\nand live interactive API qualification remain NOT RUN.\nCreating this bundle does not run verification or publish anything.\nUse the source's docs/RELEASING.md for the release rehearsal and claim limits.\n`);
  const files = new Map<string, Buffer>([
    [archive, zip], ['tiny-mime-preview.html', preview.html],
    ['tiny-mime-preview-manifest.json', json(preview.manifest)], ['README_FIRST.md', guide],
  ]);
  const records = [...files].sort(([a], [b]) => a.localeCompare(b)).map(([path, bytes]) => ({ path, sha256: sha256(bytes), bytes: bytes.length }));
  const bundleId = sha256(json(records));
  const manifest = {
    version: 1, kind: 'tiny_mime_local_source_release', releaseVersion: source.version, bundleId,
    sourceManifestSha256: source.manifestSha256, status: 'PREPARED',
    verification: 'NOT_RUN_BY_BUNDLE_COMMAND',
    qualifications: { humanComprehension: 'NOT RUN', enjoyment: 'NOT RUN', sceneCalibration: 'NOT RUN', semanticFidelity: 'NOT RUN', assistiveTechnology: 'NOT RUN', comparativeBenefit: 'NOT RUN', physicalDevices: 'NOT RUN', liveInteractiveApi: 'NOT RUN' },
    files: records,
  };
  files.set('RELEASE_BUNDLE.json', json(manifest));
  files.set('SHA256SUMS', Buffer.from([...files].sort(([a], [b]) => a.localeCompare(b)).map(([path, bytes]) => `${sha256(bytes)}  ${path}`).join('\n') + '\n'));
  return { files, manifest, archive, archiveSha256, directory: `artifacts/releases/tiny-mime-${source.version}-${bundleId.slice(0, 12)}` };
}

export function prepareReleaseBundle(root = process.cwd()) {
  const result = releaseBundleFiles(root);
  let directory = resolve(root);
  for (const part of result.directory.split('/')) {
    directory = join(directory, part);
    const stat = lstatSync(directory, { throwIfNoEntry: false });
    if (stat) {
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('BUNDLE_DIRECTORY_UNSAFE');
    } else mkdirSync(directory, { mode: 0o700 });
  }
  for (const [name, bytes] of result.files) {
    const path = join(directory, name);
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (stat) {
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size !== bytes.length || !readFileSync(path).equals(bytes)) throw new Error('BUNDLE_OUTPUT_CONFLICT');
    }
  }
  for (const [name, bytes] of result.files) {
    const path = join(directory, name);
    if (!existsSync(path)) writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 });
  }
  return { status: 'PREPARED', directory: result.directory, archive: result.archive, archiveSha256: result.archiveSha256, bundleId: result.manifest.bundleId, manifestSha256: sha256(result.files.get('RELEASE_BUNDLE.json')!), verification: 'NOT_RUN_BY_BUNDLE_COMMAND' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 2) throw new Error('NO_ARGUMENTS_EXPECTED');
    process.stdout.write(JSON.stringify(prepareReleaseBundle()) + '\n');
  } catch {
    process.stderr.write(JSON.stringify({ event: 'release_bundle_blocked', status: 'FAIL', reason: 'The source or output directory could not be validated. No publication was attempted.' }) + '\n');
    process.exitCode = 1;
  }
}
