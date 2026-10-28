import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { test, expect } from '../support/browser-fixtures.js';
import { CandidateStore } from '../../src/server/operator/workspace.js';
import { getScene } from '../../src/server/operator/sceneBank.js';

function backup() {
  const db = new Database(':memory:');
  try {
    const store = new CandidateStore(db), input = () => ({ requestId: randomUUID(), sceneId: 'TM01', title: 'Restored private title', score: getScene('TM01')!.score, parentCandidateId: null as string | null, notes: [{ atMs: 1000, text: 'Restored private note' }] });
    const parent = store.save(input()); store.save({ ...input(), title: 'Restored child', parentCandidateId: parent.candidateId }); const removed = store.save(input()); store.remove(removed.candidateId, { requestId: randomUUID() });
    return store.backup();
  } finally { db.close(); }
}
for (const width of [1280, 390]) test(`private backup and additive restore preserve the active unsaved rehearsal at ${width}px`, async ({ page, app, operator }, info) => {
  await page.setViewportSize({ width, height: 1000 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/rehearsal'); await expect(page.locator('svg.stage')).toBeVisible();
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  await page.getByLabel('Candidate title', { exact: true }).fill('Original saved title');
  await page.getByRole('button', { name: 'Save new candidate version', exact: true }).click(); await expect(page.getByRole('status')).toContainText('Saved a new immutable candidate version.');
  await page.getByLabel('Candidate title', { exact: true }).fill('UNSAVED_PRIVATE_TITLE'); await page.getByLabel('Rehearsal note', { exact: true }).fill('UNSAVED_PRIVATE_NOTE');
  await page.getByRole('button', { name: 'Revise', exact: true }).click(); await page.getByRole('button', { name: 'Start edit fork', exact: true }).click();
  const numeric = page.getByLabel('Keyframe Rotation (degrees)', { exact: true }); await numeric.fill('1');
  await page.getByText('Import a score for local validation', { exact: true }).click();
  const raw = page.getByRole('textbox', { name: 'MotionScoreV1 JSON', exact: true }); await raw.fill('UNSAVED_IMPORT_TEXT');
  await page.getByRole('slider').fill('2400');
  const beforeUrl = page.url(), beforeHash = await page.locator('main.rehearsal').getAttribute('data-score-hash');
  await page.getByRole('button', { name: 'Versions', exact: true }).click();
  const transfer = page.locator('.workspace-transfer'); await transfer.locator('summary').click();
  await expect(transfer).toContainText('Unsaved edits are excluded');
  const downloadEvent = page.waitForEvent('download'); await transfer.getByRole('button', { name: 'Download private workspace backup' }).click(); const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('tiny-mime-private-workspace.json'); const downloaded = readFileSync((await download.path())!, 'utf8'); expect(downloaded).toContain('Original saved title'); expect(downloaded).not.toContain('UNSAVED_');
  await expect(transfer.getByRole('status')).toContainText('Backup download started.');
  await transfer.getByLabel('Choose private workspace backup').setInputFiles({ name: 'private.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup())) });
  await transfer.getByRole('button', { name: 'Preview restore', exact: true }).click(); await expect(transfer.getByLabel('Workspace restore preview')).toContainText('Add 2; 0 already present'); expect(app.services.workspace.list()).toHaveLength(1); await expect(transfer.locator('[aria-live=polite]')).toContainText('Add 2; 0 already present'); await page.screenshot({ path: info.outputPath('private-restore-preview.png'), fullPage: true });
  await transfer.getByRole('button', { name: 'Restore saved work', exact: true }).click(); await expect(transfer.getByRole('status')).toContainText('Restored 2 saved versions.');
  expect(page.url()).toBe(beforeUrl); await expect(page.locator('main.rehearsal')).toHaveAttribute('data-score-hash', beforeHash!); await expect(numeric).toHaveValue('1'); await expect(raw).toHaveValue('UNSAVED_IMPORT_TEXT'); await expect(page.getByRole('slider')).toHaveValue('2400');
  await page.getByRole('button', { name: 'Notes', exact: true }).click(); await expect(page.getByLabel('Candidate title', { exact: true })).toHaveValue('UNSAVED_PRIVATE_TITLE'); await expect(page.getByLabel('Rehearsal note', { exact: true })).toHaveValue('UNSAVED_PRIVATE_NOTE');
  await page.getByRole('button', { name: 'Versions', exact: true }).click(); await expect(page.getByText('Restored child', { exact: true })).toBeVisible();
  await transfer.getByRole('button', { name: 'Preview restore', exact: true }).click(); await expect(transfer.getByLabel('Workspace restore preview')).toContainText('Add 0; 2 already present'); await transfer.getByRole('button', { name: 'Restore saved work', exact: true }).click(); await expect(transfer.getByRole('status')).toContainText('already present');
  expect(app.services.workspace.list()).toHaveLength(3);
});

test('malformed backups, stale previews and a lost restore response remain recoverable', async ({ page, app, operator }) => {
  await page.goto('/rehearsal'); await expect(page.locator('svg.stage')).toBeVisible(); await page.getByRole('button', { name: 'Versions', exact: true }).click(); const transfer = page.locator('.workspace-transfer'); await transfer.locator('summary').click();
  const choose = transfer.getByLabel('Choose private workspace backup');
  await choose.setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{bad') }); await transfer.getByRole('button', { name: 'Preview restore', exact: true }).click(); await expect(transfer.getByRole('alert')).toContainText('not a valid private workspace backup'); expect(app.services.workspace.list()).toHaveLength(0);
  await choose.setInputFiles({ name: 'private.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup())) }); await transfer.getByRole('button', { name: 'Preview restore', exact: true }).click(); await expect(transfer.getByRole('button', { name: 'Restore saved work', exact: true })).toBeVisible();
  app.services.workspace.save({ requestId: randomUUID(), sceneId: 'TM01', title: 'Saved since preview', score: getScene('TM01')!.score, parentCandidateId: null, notes: [] });
  await transfer.getByRole('button', { name: 'Restore saved work', exact: true }).click(); await expect(transfer.getByRole('alert')).toContainText('Saved work changed after preview'); expect(app.services.workspace.list()).toHaveLength(1);
  await transfer.getByRole('button', { name: 'Preview restore', exact: true }).click(); await expect(transfer.getByRole('button', { name: 'Restore saved work', exact: true })).toBeVisible();
  let first = true; await page.route('**/api/operator/workspace/restore', async route => { if (first) { first = false; await route.fetch(); await route.abort(); } else await route.continue(); });
  await transfer.getByRole('button', { name: 'Restore saved work', exact: true }).click(); await expect(transfer.getByRole('alert')).toContainText('could not be confirmed'); expect(app.services.workspace.list()).toHaveLength(3);
  await transfer.getByRole('button', { name: 'Restore saved work', exact: true }).click(); await expect(transfer.getByRole('status')).toContainText('already present'); expect(app.services.workspace.list()).toHaveLength(3);
  expect(await page.evaluate(() => Object.keys(sessionStorage).concat(Object.keys(localStorage)))).not.toContain('workspaceBackup');
});
