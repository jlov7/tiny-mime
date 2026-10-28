import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { expect, it } from 'vitest';
import { DISPLAY_FONT_CSS } from '../../src/server/operator/typography.js';

it('embeds the exact local display face and complete license', () => {
  const font = readFileSync('src/client/assets/bricolage-grotesque-latin-variable.woff2');
  expect(createHash('sha256').update(font).digest('hex')).toBe('85f55a58a31e61a2e19e8bb25fed503181bf2a6b4cab76c589992cfaac377447');
  expect(Buffer.from(DISPLAY_FONT_CSS.match(/base64,([^)]*)/u)![1]!, 'base64')).toEqual(font);
  expect(DISPLAY_FONT_CSS).toContain(readFileSync('src/client/assets/BricolageGrotesque-OFL.txt', 'utf8'));
  expect(DISPLAY_FONT_CSS).toContain('SIL OPEN FONT LICENSE Version 1.1');
});

it('build asset copying supports the compiled helper with identical font and license bytes', () => {
  mkdirSync('.scratch', { recursive: true }); const root = mkdtempSync(resolve('.scratch/typography-'));
  try {
    mkdirSync(root + '/src/client/assets', { recursive: true }); mkdirSync(root + '/src/shared', { recursive: true });
    for (const file of ['bricolage-grotesque-latin-variable.woff2', 'BricolageGrotesque-OFL.txt']) copyFileSync('src/client/assets/' + file, root + '/src/client/assets/' + file);
    copyFileSync('src/shared/scoreStructural.js', root + '/src/shared/scoreStructural.js');
    const copied = spawnSync(process.execPath, ['--import', 'tsx', resolve('scripts/copy-server-assets.ts')], { cwd: root, encoding: 'utf8' });
    expect(copied.status, copied.stderr).toBe(0);
    mkdirSync(root + '/dist/server/server/operator', { recursive: true });
    writeFileSync(root + '/dist/server/server/operator/typography.mjs', stripTypeScriptTypes(readFileSync('src/server/operator/typography.ts', 'utf8')));
    const loaded = spawnSync(process.execPath, ['--input-type=module', '-e', "import { DISPLAY_FONT_CSS } from './dist/server/server/operator/typography.mjs'; process.stdout.write(DISPLAY_FONT_CSS);"], { cwd: root, encoding: 'utf8' });
    expect(loaded.status, loaded.stderr).toBe(0); expect(loaded.stdout).toBe(DISPLAY_FONT_CSS);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
