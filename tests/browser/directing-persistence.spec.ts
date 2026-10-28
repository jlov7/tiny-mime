import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { startServer } from '../../src/server/http.js';

test('private creator backup survives restart and reopens exact notes through the normal unlock', async ({ page }, info) => {
  if (process.env.TM_PROVIDER_CONFIG || process.env.TM_STUDY_ENABLED === 'true') throw new Error('ISOLATED_RUNTIME_REQUIRED');
  const root = process.cwd(); mkdirSync(resolve('.scratch'), { recursive: true });
  const scratch = mkdtempSync(resolve('.scratch/directing-persistence-'));
  const source = join(scratch, 'source'), original = join(scratch, 'original-data'), restored = join(scratch, 'restored-data'), backups = join(scratch, 'backups');
  for (const directory of [source, original, restored, backups]) mkdirSync(directory, { mode: 0o700 });
  symlinkSync(resolve('dist'), join(source, 'dist')); symlinkSync(resolve('node_modules'), join(source, 'node_modules'));
  const receipt: Record<string, unknown> = { kind: 'synthetic_creator_preservation', browser: info.project.name, providerCalls: 0, status: 'RUNNING' };
  const evidence = info.outputPath('workspace-preservation.json');
  let app: Awaited<ReturnType<typeof startServer>> | null = null, secret = '';
  const launch = async (dataDir: string) => { app = await startServer({ dataDir, onLaunchSecret: value => { secret = value; } }); };
  const stop = async () => { const current = app; app = null; if (current) await current.stop(); };
  const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
  try {
    process.chdir(source); await launch(original);
    await page.goto('http://127.0.0.1:4317/operator-unlock?next=%2Frehearsal');
    await page.getByLabel('Launch secret', { exact: true }).fill(secret); await page.getByRole('button', { name: 'Unlock operator tools', exact: true }).click(); secret = '';
    await expect(page.locator('svg.stage')).toBeVisible(); await page.getByRole('slider').fill('1200');
    await page.getByRole('button', { name: 'Note this frame', exact: true }).click();
    await page.getByLabel('Candidate title', { exact: true }).fill('Synthetic preserved decision');
    await page.getByLabel('Rehearsal note', { exact: true }).fill('Synthetic note about the frame at 1200 ms.');
    await page.getByRole('button', { name: /Add captured note/ }).click(); await page.getByRole('button', { name: 'Save new candidate version', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Saved a new immutable candidate version.');
    const candidateId = new URL(page.url()).searchParams.get('candidate'); expect(candidateId).toMatch(/^[0-9a-f-]{36}$/);
    const scoreHash = await page.locator('main.rehearsal').getAttribute('data-score-hash');
    await stop();
    const sourceHash = hash(join(original, 'rehearsal-workspace.sqlite'));
    const backup = join(backups, 'workspace.sqlite');
    for (const [script, args] of [
      ['workspace-backup.ts', ['--data-dir', original, '--out', backup]],
      ['workspace-restore.ts', ['--backup', backup, '--data-dir', restored]],
    ] as const) {
      const result = spawnSync(process.execPath, ['--import', 'tsx', join(root, 'scripts', script), ...args], { encoding: 'utf8', timeout: 30000 });
      expect(result.status, result.stderr).toBe(0); const resultReceipt = JSON.parse(result.stdout); expect(resultReceipt.status).toBe('OK'); expect(resultReceipt.counts.candidates).toBe(1);
      expect(result.stdout).not.toContain('Synthetic note'); expect(result.stdout).not.toContain('Synthetic preserved'); receipt[script] = resultReceipt;
    }
    expect(hash(join(original, 'rehearsal-workspace.sqlite'))).toBe(sourceHash);
    expect(readdirSync(restored)).toEqual(['rehearsal-workspace.sqlite']);
    await launch(restored); await page.goto('http://127.0.0.1:4317/rehearsal?candidate=' + candidateId);
    await page.getByRole('link', { name: 'Unlock operator tools', exact: true }).click();
    await page.getByLabel('Launch secret', { exact: true }).fill(secret); await page.getByRole('button', { name: 'Unlock operator tools', exact: true }).click(); secret = '';
    await expect(page.locator('main.rehearsal')).toHaveAttribute('data-score-hash', scoreHash!);
    await page.getByRole('button', { name: 'Notes', exact: true }).click();
    await expect(page.getByLabel('Candidate title', { exact: true })).toHaveValue('Synthetic preserved decision');
    await expect(page.getByRole('button', { name: 'Go to 1200 ms', exact: true })).toBeVisible();
    await expect(page.getByText('Synthetic note about the frame at 1200 ms.', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save new candidate version', exact: true })).toBeDisabled();
    receipt.status = 'PASS'; receipt.candidateId = candidateId; receipt.scoreHash = scoreHash;
  } finally {
    await page.close(); await stop(); secret = ''; process.chdir(root); rmSync(scratch, { recursive: true, force: true });
    receipt.ownedScratchRemoved = true; writeFileSync(evidence, JSON.stringify(receipt, null, 2) + '\n');
  }
});
