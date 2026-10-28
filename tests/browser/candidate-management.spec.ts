import { test, expect } from '../support/browser-fixtures.js';
import { ORIGIN } from '../../src/server/http.js';

async function openSave(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
}
async function openTray(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Versions', exact: true }).click();
}
async function summaries(page: import('@playwright/test').Page) { return (await (await page.request.get('/api/operator/candidates')).json()).candidates; }

// Browser fixtures use a fresh in-memory workspace. No operator files are opened.
test('confirmed leaf removal keeps the active score, title and unsaved notes usable', async ({ page, app, operator }) => {
  await page.goto('/rehearsal'); await expect(page.locator('svg.stage')).toBeVisible();
  const other = await (await page.request.get('/api/operator/scenes/TM09/score')).json();
  expect((await page.request.post('/api/operator/candidates', { headers: { Origin: ORIGIN }, data: { requestId: crypto.randomUUID(), sceneId: 'TM09', title: 'Other scene survivor', score: other.score, parentCandidateId: null, notes: [] } })).ok()).toBe(true);
  await page.reload(); await expect(page.locator('svg.stage')).toBeVisible(); await openSave(page);
  await page.getByLabel('Candidate title', { exact: true }).fill('Synthetic removable version');
  await page.getByLabel('Rehearsal note', { exact: true }).fill('Saved note retained in active draft'); await page.getByRole('button', { name: /Add captured note/ }).click();
  await page.getByRole('button', { name: 'Save new candidate version' }).click(); await expect(page.getByRole('status')).toContainText('Saved a new immutable candidate version.');
  const removed = (await summaries(page)).find((value: any) => value.sceneId === 'TM01'); await openTray(page);
  await expect(page.getByText('Saved tray: 2/64 versions across all scenes. Remove versions with no saved children to free space.', { exact: true })).toBeVisible();
  await openSave(page); await page.getByLabel('Candidate title', { exact: true }).fill('Retained unsaved title'); await page.getByLabel('Rehearsal note', { exact: true }).fill('Retained unfinished note');
  await openTray(page); const remove = page.getByRole('button', { name: `Remove Synthetic removable version (${removed.candidateId.slice(0, 8)})`, exact: true });
  page.once('dialog', async dialog => { expect(dialog.type()).toBe('confirm'); expect(dialog.message()).toContain('and its saved notes'); await dialog.dismiss(); });
  await remove.click(); expect(await summaries(page)).toHaveLength(2); await expect(page.getByLabel('Rehearsal note', { exact: true })).toHaveValue('Retained unfinished note');
  page.once('dialog', dialog => dialog.accept()); await remove.click();
  await expect(page.getByRole('status')).toContainText('Saved version removed. Your current draft was kept.');
  await expect(page.getByText('Saved tray: 1/64 versions across all scenes. Remove versions with no saved children to free space.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Candidate title', { exact: true })).toHaveValue('Retained unsaved title'); await expect(page.getByLabel('Rehearsal note', { exact: true })).toHaveValue('Retained unfinished note');
  await openSave(page); await expect(page.getByText('Saved note retained in active draft', { exact: false })).toBeVisible(); await expect(page.locator('svg.stage')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download candidate inspection ZIP' })).toBeDisabled();
  await page.getByRole('button', { name: /Add captured note/ }).click(); await page.getByRole('button', { name: 'Save new candidate version' }).click();
  await expect(page.getByRole('status')).toContainText('Saved a new immutable candidate version.');
  const next = (await summaries(page)).find((value: any) => value.sceneId === 'TM01'); expect(next.parentCandidateId).toBeNull(); expect(next.scoreHash).toBe(removed.scoreHash);
  const record = (await (await page.request.get(`/api/operator/candidates/${next.candidateId}`)).json()).candidate;
  expect(record.notes.map((note: any) => note.text)).toEqual(['Saved note retained in active draft', 'Retained unfinished note']);
  expect((await summaries(page)).find((value: any) => value.sceneId === 'TM09').title).toBe('Other scene survivor');
});

test('ancestor removal explains the child guard and preserves the active draft', async ({ page, app, operator }) => {
  await page.goto('/rehearsal'); await expect(page.locator('svg.stage')).toBeVisible(); await openSave(page);
  await page.getByLabel('Candidate title', { exact: true }).fill('Synthetic parent'); await page.getByRole('button', { name: 'Save new candidate version' }).click(); await expect(page.getByRole('status')).toContainText('Saved a new immutable candidate version.');
  const parent = (await summaries(page))[0];
  let releaseSave!: () => void, releaseRemoval!: () => void;
  const saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
  const removalGate = new Promise<void>(resolve => { releaseRemoval = resolve; });
  let childCommitted = false, removalRejected = false;
  await page.route('**/api/operator/candidates', async route => {
    if (route.request().method() !== 'POST' || route.request().postDataJSON().title !== 'Synthetic child') return route.continue();
    const response = await route.fetch(); childCommitted = true; await saveGate; await route.fulfill({ response });
  });
  await page.route(`**/api/operator/candidates/${parent.candidateId}/remove`, async route => {
    const response = await route.fetch(); removalRejected = true; await removalGate; await route.fulfill({ response });
  });
  const note = page.getByLabel('Rehearsal note', { exact: true });
  try {
    await page.getByLabel('Candidate title', { exact: true }).fill('Synthetic child'); await page.getByRole('button', { name: 'Save new candidate version' }).click();
    await expect.poll(() => childCommitted).toBe(true); expect(await summaries(page)).toHaveLength(2);
    await expect(note).toBeDisabled(); releaseSave(); await expect(note).toBeEnabled();
    await expect(page.locator('.desk-current p')).toHaveText('This version is saved.');
    await note.focus(); await expect(page.locator('.note-frame')).toContainText('Note frame:');
    await note.fill('Keep this draft during rejected removal'); await expect(note).toHaveValue('Keep this draft during rejected removal');
    await openTray(page);
    page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: `Remove Synthetic parent (${parent.candidateId.slice(0, 8)})`, exact: true }).click();
    await expect.poll(() => removalRejected).toBe(true);
    await expect(note).toBeDisabled(); await expect(note).toHaveValue('Keep this draft during rejected removal');
    releaseRemoval(); await expect(page.getByRole('alert')).toContainText('Remove child versions first.'); expect(await summaries(page)).toHaveLength(2);
    await expect(note).toBeEnabled(); await expect(note).toHaveValue('Keep this draft during rejected removal');
  } finally { releaseSave(); releaseRemoval(); }
});

test('a lost removal acknowledgement retries the same deletion identity', async ({ page, app, operator }) => {
  await page.goto('/rehearsal'); await expect(page.locator('svg.stage')).toBeVisible(); await openSave(page);
  await page.getByLabel('Candidate title', { exact: true }).fill('Synthetic retry removal'); await page.getByRole('button', { name: 'Save new candidate version' }).click(); await expect(page.getByRole('status')).toContainText('Saved a new immutable candidate version.'); await openTray(page);
  const bodies: unknown[] = []; let first = true;
  await page.route('**/api/operator/candidates/*/remove', async route => {
    bodies.push(route.request().postDataJSON());
    if (first) { first = false; await route.fetch(); await route.abort(); } else await route.continue();
  });
  const remove = page.getByRole('button', { name: /^Remove Synthetic retry removal/ });
  page.once('dialog', dialog => dialog.accept()); await remove.click(); await expect(page.getByRole('alert')).toContainText('Removal could not complete.');
  page.once('dialog', dialog => dialog.accept()); await remove.click(); await expect(page.getByRole('status')).toContainText('Saved version removed.');
  expect(bodies).toHaveLength(2); expect(bodies[1]).toEqual(bodies[0]); expect(await summaries(page)).toHaveLength(0);
  await expect(page.getByLabel('Candidate title', { exact: true })).toHaveValue('Synthetic retry removal');
});
