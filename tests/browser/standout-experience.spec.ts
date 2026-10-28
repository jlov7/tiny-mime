import type { Locator, Page } from '@playwright/test';
import type { MotionScoreV1 } from '../../src/shared/score.js';
import { sampleScore } from '../../src/shared/sampleScore.js';
import { validateScore } from '../../src/shared/validateScore.js';
import { listReferences } from '../../src/server/references/index.js';
import { ORIGIN } from '../../src/server/http.js';
import { test, expect, fixtureRound } from '../support/browser-fixtures.js';

async function tabTo(page: Page, target: Locator) {
  await expect(target).toBeVisible(); await expect(target).toBeEnabled();
  for (let count = 0; count < 96; count++) {
    if (await target.evaluate(node => node === document.activeElement)) return;
    const key = await target.evaluate(node => document.activeElement && (document.activeElement.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING) ? 'Shift+Tab' : 'Tab');
    await page.keyboard.press(key);
  }
  throw new Error('KEYBOARD_TARGET_UNREACHABLE');
}
async function activate(page: Page, target: Locator) { await tabTo(page, target); await page.keyboard.press('Enter'); }
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const status = (page: Page, text: string) => page.getByRole('status').filter({ hasText: new RegExp('^' + text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') });
async function expectActiveStatus(page: Page, text: string) {
  const message = status(page, text); await expect(message).toBeVisible(); await expect(message).toHaveAttribute('tabindex', '-1'); await expect(message).toBeFocused();
}
async function transforms(stage: Locator) { return stage.locator('g[data-actor]').evaluateAll(nodes => nodes.map(node => node.getAttribute('transform'))); }
function atTime(score: MotionScoreV1, time: number) { return sampleScore(score, time).map(pose => `translate(${pose.x} ${pose.y}) rotate(${pose.rotationDeg}) scale(${pose.scaleX} ${pose.scaleY})`); }
function keys(score: MotionScoreV1) { return [...new Set(score.actors.flatMap(actor => actor.keyframes.map(key => key.tMs)))].sort((a, b) => a - b); }
async function scene(page: Page, id = 'TM01') { return (await (await page.request.get('/api/operator/scenes/' + id + '/score')).json()); }
async function editedScore(page: Page) {
  const authored = await scene(page); const edited: MotionScoreV1 = structuredClone(authored.score); edited.actors[0].keyframes[0].rotationDeg = 1;
  const checked = validateScore(JSON.stringify(edited), authored.score.actors); expect(checked.ok).toBe(true);
  if (!checked.ok) throw new Error('INVALID_TEST_SCORE');
  return { authored, edited, hash: checked.scoreHash };
}

for (const width of [390, 320]) test(`showcase keeps the full stage, transport and unrevealed notes in the first ${width}px viewport`, async ({ page, app, operator }) => {
  await page.setViewportSize({ width, height: 844 }); await page.goto('/showcase'); await page.getByRole('button', { name: 'Inspect both takes together', exact: true }).click();
  const comparison = page.getByRole('region', { name: 'Score comparison', exact: true });
  const stage = comparison.locator('svg.stage:visible'); const summary = page.getByText('Intention and directing notes', { exact: true });
  await test.info().attach('inspection-layout.json', { body: JSON.stringify(await page.evaluate(() => ({ fontStatus: document.fonts.status, scrollY, navigation: [...document.querySelectorAll('.site-header nav a')].map(link => ({ label: link.textContent, ...link.getBoundingClientRect().toJSON() })), notes: document.querySelector('.directing-notes > summary')?.getBoundingClientRect().toJSON(), viewportWidth: innerWidth, scrollWidth: document.documentElement.scrollWidth }))), contentType: 'application/json' });
  await expect(stage).toHaveCount(1); const box = (await stage.boundingBox())!;
  expect(box.width).toBeCloseTo(width - 32); expect(box.width / box.height).toBeCloseTo(10 / 7, 2);
  await expect(stage).toBeInViewport({ ratio: 1 });
  await expect(comparison.getByRole('button', { name: 'Show first take', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(comparison.getByRole('button', { name: 'Show second take', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(comparison.getByRole('button', { name: 'Play comparison', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(comparison.getByRole('slider')).toBeInViewport({ ratio: 1 }); await expect(summary).toBeInViewport({ ratio: 1 });
  for (const link of await page.locator('.site-header nav a').all()) { const target = (await link.boundingBox())!; expect(target.width).toBeGreaterThanOrEqual(44); expect(target.height).toBeGreaterThanOrEqual(44); }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.evaluate(async () => { await document.fonts.ready; }); await expect(summary).toBeInViewport({ ratio: 1 });
  const labels = await page.locator('.site-header nav a').evaluateAll(links => links.map(link => { const range = document.createRange(); range.selectNodeContents(link); const { left, right, top } = range.getBoundingClientRect(); return { left, right, top }; }));
  for (let index = 1; index < labels.length; index++) if (Math.abs(labels[index].top - labels[index - 1].top) < 1) expect(labels[index].left - labels[index - 1].right).toBeGreaterThan(0);
  await test.info().attach('inspection-screen.png', { body: await page.screenshot(), contentType: 'image/png' });
  const notes = summary.locator('..'); await expect(notes).not.toHaveAttribute('open', '');
  await summary.click(); await expect(notes).toHaveAttribute('open', '');
  await page.getByRole('combobox', { name: 'Directing example', exact: true }).selectOption({ label: 'Scene 2' });
  await page.getByRole('button', { name: 'Inspect both takes together', exact: true }).click();
  await expect(page.getByText('Intention and directing notes', { exact: true }).locator('..')).not.toHaveAttribute('open', '');
});

test('rehearsal primary advances manual frames and matched references use the union of both takes', async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/rehearsal'); await expect(page.locator('svg.stage')).toBeVisible();
  const authored = await scene(page); const primary = page.locator('.controls button.primary').first(); const timeline = page.getByRole('slider');
  const next = keys(authored.score)[1]; await primary.click(); await expect(timeline).toHaveValue(String(next));
  await expect(primary).toHaveText('Next frame'); await page.waitForTimeout(120); await expect(timeline).toHaveValue(String(next)); await expect(button(page, 'Pause')).toHaveCount(0);
  await page.getByText('Loop a rehearsal interval', { exact: true }).click(); await page.getByLabel('Loop selected interval', { exact: true }).check();
  await primary.click(); await expect(timeline).toHaveValue(String(keys(authored.score)[2]));
  await page.waitForTimeout(120); await expect(timeline).toHaveValue(String(keys(authored.score)[2]));
  const reference = listReferences().find(pair => keys(pair.variants[1].score).some(time => !keys(pair.variants[0].score).includes(time)))!; expect(reference).toBeDefined();
  await page.getByRole('combobox', { name: 'Comparison', exact: true }).selectOption(reference.id);
  const union = [...new Set(reference.variants.flatMap(variant => keys(variant.score)))].sort((a, b) => a - b);
  for (const time of union.slice(1)) { await primary.click(); await expect(timeline).toHaveValue(String(time)); }
  await page.waitForTimeout(120); await expect(timeline).toHaveValue(String(union.at(-1)));
});

test('private play primary steps whole takes before enabling guesses and explicitly selects the second take', async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await fixtureRound(page);
  const id = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId);
  const round = await (await page.request.get('/api/rounds/' + id)).json(); const score: MotionScoreV1 = round.acts[0].score;
  const field = page.getByRole('textbox', { name: 'What’s happening?', exact: true }); const primary = page.locator('.controls.playback button.primary'); const stage = page.locator('svg.stage');
  await expect(field).toBeDisabled();
  for (const time of keys(score).slice(1)) {
    await expect(field).toBeDisabled(); await primary.click(); await expect.poll(() => transforms(stage)).toEqual(atTime(score, time));
    await page.waitForTimeout(30); await expect.poll(() => transforms(stage)).toEqual(atTime(score, time));
  }
  await expect(field).toBeEnabled(); await expect(button(page, 'Next frame')).toHaveCount(1); await expect(button(page, 'Pause')).toHaveCount(0);
  await field.fill('A synthetic interpretation.'); await button(page, 'Send guess').click();
  const select = button(page, 'View next take'); await expect(select).toBeVisible(); const final = page.getByRole('textbox', { name: 'What do you think now?', exact: true }); await expect(final).toBeDisabled();
  await expect.poll(() => transforms(stage)).toEqual(atTime(score, score.durationMs)); await select.click();
  const second = await (await page.request.get('/api/rounds/' + id)).json(); const secondScore: MotionScoreV1 = second.acts[1].score;
  await expect.poll(() => transforms(stage)).toEqual(atTime(secondScore, 0)); await expect(final).toBeDisabled();
  await expect(page.locator('.controls.playback button.primary')).toHaveText('Next frame'); await expect(button(page, 'Next frame')).toHaveCount(1);
  for (const time of keys(secondScore).slice(1)) { await expect(final).toBeDisabled(); await page.locator('.controls.playback button.primary').click(); await expect.poll(() => transforms(stage)).toEqual(atTime(secondScore, time)); }
  await expect(final).toBeEnabled();
  await expect.poll(() => app.services.events.observations(id).completedViews.length).toBe(2); expect(app.services.events.observations(id).completedPlays).toHaveLength(0);
});

test('a selected directing scene opens that same rehearsal and valid direct scene links are honored', async ({ page, app, operator }) => {
  await page.goto('/showcase'); await page.getByRole('button', { name: 'Inspect both takes together', exact: true }).click(); await page.getByRole('combobox', { name: 'Directing example', exact: true }).selectOption({ label: 'Scene 2' });
  await page.getByRole('link', { name: 'Open rehearsal', exact: true }).click(); await expect(page).toHaveURL('http://127.0.0.1:4317/rehearsal?scene=TM09');
  await expect(page.getByRole('combobox', { name: 'Scene', exact: true })).toHaveValue('TM09'); await expect(page.locator('svg.stage')).toBeVisible();
  await page.goto('/rehearsal?scene=TM04'); await expect(page.getByRole('combobox', { name: 'Scene', exact: true })).toHaveValue('TM04'); await expect(page.locator('svg.stage')).toBeVisible();
});

test('unknown and deferred direct scene links fall back to the first available catalogue scene', async ({ page, app, operator }) => {
  for (const id of ['unknown-scene', 'TM07']) {
    await page.goto('/rehearsal?scene=' + id); await expect(page.getByRole('combobox', { name: 'Scene', exact: true })).toHaveValue('TM01'); await expect(page.locator('svg.stage')).toBeVisible();
    await expect(page.locator('.provenance')).toContainText('Authored first take'); await expect(page.getByRole('alert')).toHaveCount(0);
  }
});

test('a server-rejected locally valid import keeps the old stage and only an explicit successful retry announces activation', async ({ page, app, operator }) => {
  await page.goto('/rehearsal'); await expect(page.locator('svg.stage')).toBeVisible(); const { authored, edited, hash } = await editedScore(page);
  await button(page, 'Show validator details').click(); await expect(page.getByText(authored.scoreHash, { exact: true })).toBeVisible(); const before = await transforms(page.locator('svg.stage'));
  await page.getByText('Import a score for local validation', { exact: true }).click(); const raw = page.getByRole('textbox', { name: 'MotionScoreV1 JSON', exact: true }); await raw.fill(JSON.stringify(edited));
  let attempts = 0, reject = true;
  await page.route('**/api/operator/scores/validate', route => { attempts++; return reject ? route.fulfill({ status: 503, json: { error: 'UNAVAILABLE', requestId: 'synthetic-import-failure' } }) : route.continue(); });
  await button(page, 'Validate score').click(); await expect(page.getByRole('alert')).toContainText('Validation could not reach the local server');
  await expect.poll(() => transforms(page.locator('svg.stage'))).toEqual(before); await expect(page.getByText(authored.scoreHash, { exact: true })).toBeVisible(); await expect(raw).toHaveValue(JSON.stringify(edited));
  await expect(page.getByText('Valid score. Ready for rehearsal.', { exact: true })).toHaveCount(0); await expect(status(page, 'Imported score is now in rehearsal.')).toHaveCount(0);
  await page.waitForTimeout(120); expect(attempts).toBe(1); reject = false; await activate(page, button(page, 'Validate score'));
  await expectActiveStatus(page, 'Imported score is now in rehearsal.'); await expect(page.getByText(hash, { exact: true })).toBeVisible(); await expect.poll(() => transforms(page.locator('svg.stage'))).toEqual(atTime(edited, 0)); expect(attempts).toBe(2);
});

test('keyboard loading a saved candidate focuses a stable status and activates its score', async ({ page, app, operator }) => {
  const { edited, hash } = await editedScore(page);
  const response = await page.request.post('/api/operator/candidates', { headers: { Origin: ORIGIN }, data: { requestId: crypto.randomUUID(), sceneId: 'TM01', title: 'Keyboard candidate', score: edited, parentCandidateId: null, notes: [] } }); expect(response.ok()).toBe(true);
  const candidate = (await response.json()).candidate;
  await page.goto('/rehearsal'); await expect(page.locator('svg.stage')).toBeVisible(); await button(page, 'Show validator details').click();
  await page.getByRole('button', { name: 'Versions', exact: true }).click(); await activate(page, button(page, `Load Keyboard candidate (${candidate.candidateId.slice(0, 8)})`));
  await expectActiveStatus(page, 'Saved candidate loaded for rehearsal.'); await expect(page.locator('.provenance')).toContainText('Saved candidate score'); await expect(page.getByText(hash, { exact: true })).toBeVisible(); await expect.poll(() => transforms(page.locator('svg.stage'))).toEqual(atTime(edited, 0));
});

test('keyboard applying a numeric fork focuses a stable status and activates the edited score', async ({ page, app, operator }) => {
  await page.goto('/rehearsal'); await expect(page.locator('svg.stage')).toBeVisible(); const { edited, hash } = await editedScore(page); await button(page, 'Show validator details').click();
  await page.getByRole('button', { name: 'Revise', exact: true }).click(); await button(page, 'Start edit fork').click(); await page.getByLabel('Keyframe Rotation (degrees)', { exact: true }).fill('1');
  await activate(page, button(page, 'Validate and rehearse fork')); await expectActiveStatus(page, 'Edited score is now in rehearsal.');
  await expect(page.locator('.provenance')).toContainText('Edited score'); await expect(page.getByText(hash, { exact: true })).toBeVisible(); await expect.poll(() => transforms(page.locator('svg.stage'))).toEqual(atTime(edited, 0));
});
