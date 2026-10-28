import { test, expect, fixtureRound } from '../support/browser-fixtures.js';
import type { Page } from '@playwright/test';
import type { MotionScoreV1 } from '../../src/shared/score.js';
import { scoreHash } from '../../src/shared/hash.js';
import rawScore from '../../src/server/scores/TM01.json' with { type: 'json' };

async function submitFrameTake(page: Page, attempt: 1 | 2) {
  if (attempt === 2) await page.getByRole('button', { name: 'View next take', exact: true }).click();
  const field = page.getByRole('textbox', { name: attempt === 1 ? 'What’s happening?' : 'What do you think now?', exact: true });
  for (let key = 0; key < 72 && !await field.isEnabled(); key++) await page.getByRole('button', { name: 'Next frame', exact: true }).click();
  await expect(field).toBeEnabled(); await field.fill('A local fixture interpretation.');
  await page.getByRole('button', { name: attempt === 1 ? 'Send guess' : 'Send final guess', exact: true }).click();
  await expect(page.getByRole(attempt === 1 ? 'button' : 'heading', { name: attempt === 1 ? 'View next take' : 'The scene was meant to show…', exact: true })).toBeVisible();
}

test('home discovers protected authored examples and unlock returns to the showcase', async ({ page, app }) => {
  const scripts: string[] = []; page.on('request', request => { if (request.resourceType() === 'script') scripts.push(request.url()); });
  await page.goto('/'); await expect(page.getByRole('link', { name: 'Open directing demo', exact: true })).toBeVisible();
  expect(scripts.some(url => /\/Showcase-/.test(url))).toBe(false);
  await page.getByRole('link', { name: 'Open directing demo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Unlock Tiny Mime.' })).toBeVisible();
  await page.getByLabel('Launch secret', { exact: true }).fill(app.secret()); await page.getByRole('button', { name: 'Unlock operator tools', exact: true }).click();
  await expect(page).toHaveURL('http://127.0.0.1:4317/showcase');
  await expect(page.getByRole('heading', { name: 'A matter of timing.' })).toBeVisible();
  await page.getByRole('button', { name: 'Inspect both takes together', exact: true }).click();
  await expect(page.locator('.score-comparison svg.stage')).toHaveCount(2);
  await expect(page.getByText('Two authored takes. No AI calls or adaptation.', { exact: true })).toBeVisible();
  await expect(page.locator('svg.stage text')).toHaveCount(0);
});

for (const width of [1280, 390]) test(`showcase uses explicit shared frame playback and readable stages at ${width}px`, async ({ page, app, operator }) => {
  await page.setViewportSize({ width, height: 1000 }); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/showcase'); await page.getByRole('button', { name: 'Inspect both takes together', exact: true }).click();
  const comparison = page.getByRole('region', { name: 'Score comparison', exact: true }); const timeline = comparison.getByRole('slider');
  await expect(timeline).toHaveValue('0'); await expect(comparison.getByRole('button', { name: 'Next comparison keyframe', exact: true })).toBeVisible();
  const examples = await (await page.request.get('/api/operator/showcases')).json();
  for (const example of examples.examples) {
    await page.getByRole('combobox', { name: 'Directing example' }).selectOption(example.id); if (await page.getByRole('button', { name: 'Inspect both takes together', exact: true }).isVisible()) await page.getByRole('button', { name: 'Inspect both takes together', exact: true }).click(); await expect(timeline).toHaveValue('0');
    const keys = [...new Set<number>([example.left.score.durationMs, example.right.score.durationMs, ...[example.left.score, example.right.score].flatMap(score => score.actors.flatMap((actor: { keyframes: { tMs: number }[] }) => actor.keyframes.map(key => key.tMs)))])].filter(time => time > 0).sort((a, b) => a - b);
    await comparison.getByText('Frame and key controls', { exact: true }).click();
    for (const key of keys) { await comparison.getByRole('button', { name: 'Next comparison key', exact: true }).click(); await expect(timeline).toHaveValue(String(key)); }
    const ends = await comparison.locator('figcaption span').allTextContents(); expect(ends).toEqual([example.left, example.right].map(take => `${(take.score.durationMs / 1000).toFixed(2)} / ${(take.score.durationMs / 1000).toFixed(2)} s · End frame`));
    await comparison.getByRole('button', { name: 'Reset comparison', exact: true }).click(); await expect(timeline).toHaveValue('0');
    await comparison.getByText('Frame and key controls', { exact: true }).click();
  }
  if (width === 390) expect(await comparison.locator('svg.stage:visible').evaluateAll(stages => stages.every(stage => stage.getBoundingClientRect().width >= 340))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('comparison clamps a shorter clip and pauses animation when the tab is hidden', async ({ page, app, operator }) => {
  const left = structuredClone(rawScore) as MotionScoreV1; const right = structuredClone(left);
  right.durationMs = 10000;
  for (const actor of right.actors) for (const key of actor.keyframes) key.tMs = Math.round(key.tMs * 10000 / left.durationMs);
  await page.route('**/api/operator/showcases', route => route.fulfill({ json: { examples: [{ id: 'TM01', title: 'Unequal durations', exampleGuess: 'A fixed example.', intention: 'A test fixture.', explanation: 'Slower timing for a playback test.', source: 'authored_fixture', humanReview: 'not_run', left: { score: left, scoreHash: scoreHash(left) }, right: { score: right, scoreHash: scoreHash(right) } }] } }));
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.goto('/showcase'); await page.getByRole('button', { name: 'Inspect both takes together', exact: true }).click();
  await page.getByRole('slider').fill('9000');
  await expect(page.locator('.score-comparison figcaption span').first()).toHaveText('8.00 / 8.00 s · End frame');
  await expect(page.locator('.score-comparison figcaption span').last()).toHaveText('9.00 / 10.00 s');
  const comparison = page.getByRole('region', { name: 'Score comparison' }); await comparison.getByRole('button', { name: 'Reset comparison' }).click();
  await comparison.getByRole('button', { name: 'Play comparison', exact: true }).click();
  await expect(comparison.getByRole('button', { name: 'Pause comparison', exact: true })).toBeVisible();
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(comparison.getByRole('button', { name: 'Play comparison', exact: true })).toBeVisible();
});

test('first fixture guidance follows controls and dismisses without storing a preference', async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await fixtureRound(page);
  const guide = page.getByRole('complementary', { name: 'Round guide' });
  await expect(guide).toContainText('Use Next frame'); await expect(guide).toContainText('does not adapt to your guess');
  await submitFrameTake(page, 1); await expect(guide).toContainText('Choose View next take');
  const before = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));
  await guide.getByRole('button', { name: 'Dismiss round guide' }).focus(); await page.keyboard.press('Enter'); await expect(guide).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Take 2 of 2.', exact: true })).toBeFocused();
  expect(await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }))).toEqual(before);
});

test('private reveal compares the owned repeated takes and the next fixture is unguided', async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await fixtureRound(page); await submitFrameTake(page, 1); await submitFrameTake(page, 2);
  await page.getByText('Compare your two takes', { exact: true }).click();
  const comparison = page.getByRole('region', { name: 'Score comparison', exact: true }); await expect(comparison.locator('svg.stage')).toHaveCount(2);
  await comparison.getByText('Numeric changes', { exact: true }).click();
  await expect(comparison).toContainText('0 exact transform or easing fields changed'); await expect(comparison).toContainText('do not measure meaning, quality or improvement');
  await page.getByRole('button', { name: 'Another scene', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Take 1 of 2.' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Round guide' })).toHaveCount(0);
});

test('study has neither the private guide nor the post-reveal comparison', async ({ page, app, operator }) => {
  await page.goto('/study'); await page.getByRole('button', { name: 'Start short synthetic study', exact: true }).click();
  await page.getByRole('button', { name: 'Start next round', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Take 1 of 2.' })).toBeVisible(); await expect(page.getByRole('complementary', { name: 'Round guide' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reveal now', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Thanks for this interpretation.', exact: true })).toBeVisible();
  await expect(page.getByText('Compare your two takes', { exact: true })).toHaveCount(0);
});
