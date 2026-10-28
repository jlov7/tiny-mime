import { browserArtifact } from './tests/support/browser-artifacts.js';
import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/browser', outputDir: resolve(process.env.TINY_MIME_EVIDENCE_ROOT ?? 'artifacts', 'browser/test-results'), fullyParallel: false, workers: 1, retries: 0, timeout: 45000,
  globalSetup: './tests/support/browser-setup.ts',
  reporter: [['list'], ['json', { outputFile: browserArtifact('results.json') }]],
  use: { baseURL: 'http://127.0.0.1:4317', viewport: { width: 1280, height: 1000 }, trace: 'off', screenshot: 'only-on-failure' },
  projects: [{ name: 'webkit', use: { browserName: 'webkit' } }, { name: 'chromium', use: { browserName: 'chromium' } }, { name: 'firefox', use: { browserName: 'firefox' } }],
});
