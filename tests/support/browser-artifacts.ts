import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
export function browserArtifact(name: string) {
  const directory = resolve(process.env.TINY_MIME_EVIDENCE_ROOT ?? 'artifacts', 'browser');
  mkdirSync(directory, { recursive: true });
  return resolve(directory, name);
}
export function captureArtifact(name: string) {
  const directory = resolve(process.env.TINY_MIME_EVIDENCE_ROOT ?? 'artifacts', 'capture');
  mkdirSync(directory, { recursive: true });
  return resolve(directory, name);
}
