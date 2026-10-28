import { test, expect } from '../support/browser-fixtures.js';
import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';

async function openNotes(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
}

test('restoring the bank asks before discarding an applied unsaved fork', async ({ page, app, operator }) => {
  await page.goto('/rehearsal'); await expect(page.locator('svg.stage')).toBeVisible();
  await page.getByRole('button', { name: 'Revise', exact: true }).click();
  await page.getByRole('button', { name: 'Start edit fork', exact: true }).click();
  await page.getByLabel('Keyframe Rotation (degrees)', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Validate and rehearse fork', exact: true }).click();
  await expect(page.locator('.provenance')).toContainText('Edited score');
  const transforms = await page.locator('svg.stage [data-actor]').evaluateAll(nodes => nodes.map(node => node.getAttribute('transform')));
  let prompted = false;
  page.once('dialog', dialog => { prompted = true; return dialog.dismiss(); });
  await page.getByRole('button', { name: 'Restore authored draft', exact: true }).click();
  expect(prompted).toBe(true);
  await expect(page.locator('.provenance')).toContainText('Edited score');
  expect(await page.locator('svg.stage [data-actor]').evaluateAll(nodes => nodes.map(node => node.getAttribute('transform')))).toEqual(transforms);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Restore authored draft', exact: true }).click();
  await expect(page.locator('.provenance')).toContainText('Authored first take');
});

test('a note seek cannot move a different scene away from its initial frame', async ({ page, app, operator }) => {
  await page.goto('/rehearsal'); await expect(page.locator('svg.stage')).toBeVisible();
  await page.getByRole('slider').fill('2400');
  await page.getByRole('button', { name: 'Note this frame', exact: true }).click();
  await page.getByLabel('Rehearsal note', { exact: true }).fill('A moment in the first scene.');
  await page.getByRole('button', { name: /Add captured note/ }).click();
  await page.getByRole('button', { name: 'Go to 2400 ms', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByLabel('Scene', { exact: true }).selectOption('TM09');
  await expect(page.getByLabel('Scene', { exact: true })).toHaveValue('TM09');
  await expect(page.locator('.provenance')).toContainText('Authored first take');
  await expect(page.getByRole('slider')).toHaveValue('0');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
});

test('an unchanged saved version cannot silently consume another tray slot', async ({ page, app, operator }) => {
  await page.goto('/rehearsal'); await expect(page.locator('svg.stage')).toBeVisible(); await openNotes(page);
  await page.getByLabel('Candidate title', { exact: true }).fill('A saved directing decision');
  const save = page.getByRole('button', { name: 'Save new candidate version', exact: true });
  await save.click(); await expect(page.getByRole('status')).toContainText('Saved a new immutable candidate version.');
  await expect(save).toBeDisabled();
  expect((await (await page.request.get('/api/operator/candidates')).json()).candidates).toHaveLength(1);
  await page.getByLabel('Candidate title', { exact: true }).fill('A distinct revision title');
  await expect(save).toBeEnabled(); await save.click();
  const versions = (await (await page.request.get('/api/operator/candidates')).json()).candidates;
  expect(versions).toHaveLength(2); expect(versions[0].parentCandidateId).toBe(versions[1].candidateId);
});

for (const sceneId of ['TM01', 'TM09', 'TM04']) test(`both ${sceneId} authored takes arrive in rehearsal with their exact identity`, async ({ page, app, operator }) => {
  const example = (await (await page.request.get('/api/operator/showcases')).json()).examples.find((value: any) => value.id === sceneId);
  const bank = await (await page.request.get(`/api/operator/scenes/${sceneId}/score`)).json();
  await page.goto('/showcase'); await page.getByRole('combobox', { name: 'Directing example', exact: true }).selectOption(sceneId);
  await page.getByRole('button', { name: 'Skip to written reveal', exact: true }).click();
  const second = page.getByRole('link', { name: 'Rehearse second take', exact: true });
  await expect(second).toHaveAttribute('href', `/rehearsal?scene=${sceneId}&take=second`); await second.click();
  await expect(page.locator('main.rehearsal')).toHaveAttribute('data-score-hash', example.right.scoreHash);
  await expect(page.locator('.provenance')).toContainText('Prepared authored second take'); await expect(page.getByRole('slider')).toHaveValue('0');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Authored first take', exact: true }).click();
  await expect(page.locator('main.rehearsal')).toHaveAttribute('data-score-hash', example.left.scoreHash);
  await page.getByRole('button', { name: 'Prepared second take', exact: true }).click();
  await expect(page.locator('main.rehearsal')).toHaveAttribute('data-score-hash', example.right.scoreHash);
  await openNotes(page); await page.getByLabel('Candidate title', { exact: true }).fill(`${sceneId} chosen second take`);
  await page.getByRole('button', { name: 'Save new candidate version', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Saved a new immutable candidate version.');
  await page.reload(); await expect(page.locator('main.rehearsal')).toHaveAttribute('data-score-hash', example.right.scoreHash);
  await expect(page.locator('.provenance')).toContainText('Saved candidate score'); await expect(page.getByRole('slider')).toHaveValue('0');
  await page.getByRole('button', { name: 'Compare', exact: true }).click(); await page.getByLabel('Compare with', { exact: true }).selectOption('prepared');
  const comparison = page.getByRole('region', { name: 'Score comparison', exact: true });
  await expect(page.locator('.directing-stage-host figcaption strong')).toHaveText(['Prepared second take', 'Active revision · unreviewed']);
  await comparison.getByText('Numeric changes', { exact: true }).click(); await expect(comparison).toContainText('No stored key differences.');
  expect(await (await page.request.get(`/api/operator/scenes/${sceneId}/score`)).json()).toEqual(bank);
});

for (const width of [1280, 320]) test(`a directing revision can be made, compared, exported and found again at ${width}px`, async ({ page, app, operator }, info) => {
  await page.setViewportSize({ width, height: 1000 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const example = (await (await page.request.get('/api/operator/showcases')).json()).examples.find((value: any) => value.id === 'TM09');
  await page.goto('/rehearsal?scene=TM09&take=second');
  await expect(page.locator('main.rehearsal')).toHaveAttribute('data-score-hash', example.right.scoreHash);
  await openNotes(page); await page.getByLabel('Candidate title', { exact: true }).fill('Delay experiment first');
  await page.getByRole('slider').fill('2400'); await page.getByRole('button', { name: 'Edit this moment', exact: true }).click();
  const keyIndex = example.right.score.actors[0].keyframes.findLastIndex((key: any) => key.tMs <= 2400);
  const key = example.right.score.actors[0].keyframes[keyIndex];
  await expect(page.getByLabel('Edit keyframe', { exact: true })).toHaveValue(String(keyIndex));
  await expect(page.getByLabel('Keyframe Time (ms)', { exact: true })).toBeFocused();
  await page.getByLabel('Keyframe Rotation (degrees)', { exact: true }).fill(String(key.rotationDeg + 1));
  await page.getByRole('button', { name: 'Inspect selected key', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Active rehearsal stage', exact: true })).toBeFocused();
  await expect(page.getByRole('slider')).toHaveValue(String(key.tMs));
  await page.getByRole('button', { name: 'Edit this moment', exact: true }).click();
  await expect(page.getByLabel('Keyframe Rotation (degrees)', { exact: true })).toHaveValue(String(key.rotationDeg + 1));
  await page.getByRole('button', { name: 'Validate and rehearse fork', exact: true }).click();
  await expect(page.locator('.provenance')).toContainText('Edited score'); await expect(page.getByRole('slider')).toHaveValue(String(key.tMs));
  await openNotes(page); await expect(page.getByLabel('Candidate title', { exact: true })).toHaveValue('Delay experiment first');
  await page.getByRole('button', { name: 'Save new candidate version', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Saved a new immutable candidate version.');
  const first = (await (await page.request.get('/api/operator/candidates')).json()).candidates[0];
  await page.getByRole('button', { name: 'Edit this moment', exact: true }).click();
  await page.getByLabel('Keyframe Rotation (degrees)', { exact: true }).fill(String(key.rotationDeg + 2));
  await page.getByRole('button', { name: 'Validate and rehearse fork', exact: true }).click();
  await expect(page.locator('main.rehearsal')).not.toHaveAttribute('data-score-hash', first.scoreHash);
  await openNotes(page); await page.getByLabel('Candidate title', { exact: true }).fill('Delay experiment second');
  await page.getByRole('button', { name: 'Save new candidate version', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Saved a new immutable candidate version.');
  const versions = (await (await page.request.get('/api/operator/candidates')).json()).candidates;
  const second = versions.find((value: any) => value.candidateId !== first.candidateId); expect(second.parentCandidateId).toBe(first.candidateId);
  await page.getByRole('button', { name: 'Compare with parent', exact: true }).click();
  const comparison = page.getByRole('region', { name: 'Score comparison', exact: true });
  await expect(comparison.getByRole('button', { name: 'Next comparison keyframe', exact: true })).toBeFocused();
  await expect(page.locator('.directing-stage-host figcaption strong')).toHaveText(['Delay experiment first', 'Active revision · unreviewed']);
  await comparison.getByText('Numeric changes', { exact: true }).click();
  await expect(comparison.getByRole('list', { name: 'Stored key changes' })).toContainText(`${key.rotationDeg + 1} → ${key.rotationDeg + 2}`);
  const pending = page.waitForEvent('download'); await comparison.getByRole('button', { name: 'Download pair inspection ZIP', exact: true }).click();
  const packet = unzipSync(readFileSync((await (await pending).path())!)); const manifest = JSON.parse(strFromU8(packet['pair-inspection-manifest.json']));
  expect(manifest.baseline.scoreHash).toBe(first.scoreHash); expect(manifest.revision.scoreHash).toBe(second.scoreHash);
  expect(Object.values(packet).map(value => strFromU8(value)).join('\n')).not.toContain('Delay experiment');
  await page.getByRole('link', { name: 'Tiny Mime', exact: true }).click();
  await page.getByRole('link', { name: 'Explore rehearsal', exact: true }).click();
  await page.getByRole('button', { name: 'Versions', exact: true }).click(); await page.getByText('Find saved work', { exact: true }).click();
  await page.getByLabel('Find a saved version', { exact: true }).fill('Delay experiment second');
  await page.getByRole('link', { name: 'Open Delay experiment second (TM09)', exact: true }).click();
  await expect(page.locator('main.rehearsal')).toHaveAttribute('data-score-hash', second.scoreHash);
  await expect(page.getByLabel('Scene', { exact: true })).toHaveValue('TM09'); await expect(page.getByRole('slider')).toHaveValue('0');
  await page.reload(); await expect(page.locator('main.rehearsal')).toHaveAttribute('data-score-hash', second.scoreHash);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('directing-workflow-' + width + '.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('source notes are saved under their original hash before a numeric fork is applied', async ({ page, app, operator }) => {
  await page.goto('/rehearsal'); await expect(page.locator('svg.stage')).toBeVisible(); await openNotes(page);
  const originalHash = await page.locator('main.rehearsal').getAttribute('data-score-hash');
  await page.getByLabel('Candidate title', { exact: true }).fill('Notes about the source');
  await page.getByLabel('Rehearsal note', { exact: true }).fill('This observation belongs to the original frame.');
  await page.getByRole('button', { name: /Add captured note/ }).click();
  await page.getByRole('button', { name: 'Edit this moment', exact: true }).click();
  await page.getByLabel('Keyframe Rotation (degrees)', { exact: true }).fill('1');
  await expect(page.getByLabel('Keyframe Rotation (degrees)', { exact: true })).toHaveValue('1');
  await expect(page.getByLabel('Keyframe Horizontal position (x)', { exact: true })).toHaveValue('250');
  const apply = page.getByRole('button', { name: 'Validate and rehearse fork', exact: true }); await expect(apply).toBeDisabled();
  await page.getByRole('button', { name: 'Save source notes and keep fork', exact: true }).click();
  await expect(apply).toBeEnabled(); await expect(page.getByLabel('Keyframe Rotation (degrees)', { exact: true })).toHaveValue('1');
  await apply.click(); await expect(page.locator('main.rehearsal')).not.toHaveAttribute('data-score-hash', originalHash!);
  await openNotes(page); await expect(page.getByLabel('Rehearsal note', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Save new candidate version', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Saved a new immutable candidate version.');
  const versions = (await (await page.request.get('/api/operator/candidates')).json()).candidates;
  expect(versions).toHaveLength(2); expect(versions[0].parentCandidateId).toBe(versions[1].candidateId);
  const source = (await (await page.request.get(`/api/operator/candidates/${versions[1].candidateId}`)).json()).candidate;
  expect(source.scoreHash).toBe(originalHash); expect(source.notes).toEqual([{ atMs: 0, text: 'This observation belongs to the original frame.' }]);
  const revision = (await (await page.request.get(`/api/operator/candidates/${versions[0].candidateId}`)).json()).candidate; expect(revision.notes).toEqual([]);
});

test('an unavailable or mismatched prepared take is held instead of silently substituting the bank', async ({ page, app, operator }) => {
  await page.route('**/api/operator/showcases', async route => { const reply = await route.fetch(); const body = await reply.json(); body.examples[0].right.scoreHash = '0'.repeat(64); await route.fulfill({ response: reply, json: body }); });
  await page.goto('/rehearsal?scene=TM01&take=second');
  await expect(page.getByRole('alert')).toContainText('prepared second take could not load');
  await expect(page.locator('svg.stage')).toHaveCount(0);
  await page.getByRole('button', { name: 'Authored first take', exact: true }).click();
  await expect(page.locator('svg.stage')).toBeVisible(); await expect(page.locator('.provenance')).toContainText('Authored first take');
});

for (const outcome of ['accepted', 'failed']) test(`a delayed ${outcome} saved-version entry cannot replace a newer scene or fork`, async ({ page, app, operator }) => {
  const authored = await (await page.request.get('/api/operator/scenes/TM01/score')).json();
  const saved = (await (await page.request.post('/api/operator/candidates', { data: { requestId: crypto.randomUUID(), sceneId: 'TM01', title: 'Delayed entry', score: authored.score, parentCandidateId: null, notes: [] }, headers: { Origin: 'http://127.0.0.1:4317' } })).json()).candidate;
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let held = false;
  await page.route(`**/api/operator/candidates/${saved.candidateId}`, async route => { if (held) return route.continue(); held = true; const response = await route.fetch(); await gate; if (outcome === 'failed') await route.abort(); else await route.fulfill({ response }); });
  try {
    await page.goto('/rehearsal?candidate=' + saved.candidateId); await expect.poll(() => held).toBe(true);
    await page.getByLabel('Scene', { exact: true }).selectOption('TM09'); await expect(page.locator('svg.stage')).toBeVisible();
    await page.getByRole('button', { name: 'Edit this moment', exact: true }).click(); await page.getByLabel('Keyframe Rotation (degrees)', { exact: true }).fill('1');
    release(); await page.waitForTimeout(200);
    await expect(page.getByLabel('Scene', { exact: true })).toHaveValue('TM09');
    await expect(page.getByLabel('Keyframe Rotation (degrees)', { exact: true })).toHaveValue('1');
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally { release(); }
});

test('an open saved-work library removes a deleted noncurrent version immediately', async ({ page, app, operator }) => {
  const authored = await (await page.request.get('/api/operator/scenes/TM01/score')).json();
  const saved = [];
  for (const title of ['Disposable synthetic version', 'Retained synthetic version']) saved.push((await (await page.request.post('/api/operator/candidates', { data: { requestId: crypto.randomUUID(), sceneId: 'TM01', title, score: authored.score, parentCandidateId: null, notes: [] }, headers: { Origin: 'http://127.0.0.1:4317' } })).json()).candidate);
  await page.goto('/rehearsal?candidate=' + saved[1].candidateId); await expect(page.locator('svg.stage')).toBeVisible();
  await page.getByRole('button', { name: 'Versions', exact: true }).click(); await page.getByText('Find saved work', { exact: true }).click();
  const library = page.locator('.saved-library'); await expect(library.getByRole('link')).toHaveCount(2);
  await page.getByRole('button', { name: 'Versions', exact: true }).click();
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: `Remove Disposable synthetic version (${saved[0].candidateId.slice(0, 8)})`, exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Saved version removed.');
  await expect(library.getByRole('link', { name: 'Open Disposable synthetic version (TM01)', exact: true })).toHaveCount(0);
  await expect(library.getByRole('link')).toHaveCount(1); await expect(library).toContainText('1 of 1 saved versions');
});
