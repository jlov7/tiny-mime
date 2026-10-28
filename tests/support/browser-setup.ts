import { spawnSync } from 'node:child_process';
import { browserArtifact } from './browser-artifacts.js';

export default function setup() {
  browserArtifact('results.json');
  const validator = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/generate-validator.ts'], { stdio: 'inherit' });
  if (validator.status !== 0) throw new Error('BROWSER_VALIDATOR_BUILD');
  const pairAssets = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/generate-pair-assets.ts'], { stdio: 'inherit' });
  if (pairAssets.status !== 0) throw new Error('BROWSER_PAIR_ASSET_BUILD');
  const built = spawnSync('npm', ['exec', 'vite', 'build'], { stdio: 'inherit' });
  if (built.status !== 0) throw new Error('BROWSER_ASSET_BUILD');
}
