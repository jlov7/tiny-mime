import type { Page } from '@playwright/test';
import { test, expect, fixtureRound } from '../support/browser-fixtures.js';
import { startServer } from '../../src/server/http.js';

async function viewFirst(page: Page) {
  const field = page.getByRole('textbox', { name: 'What’s happening?', exact: true });
  for (let step = 0; step < 72 && !await field.isEnabled(); step++) await page.getByRole('button', { name: 'Next frame', exact: true }).click();
  await expect(field).toBeEnabled(); await field.fill('Synthetic review interpretation.');
}

test('the recommended local introduction unlocks directly into authored directing examples', async ({ page, app }) => {
  await page.goto('/');
  await expect(page.getByText('Use the one-use launch secret', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: 'Open directing demo', exact: true }).click();
  await page.getByLabel('Launch secret', { exact: true }).fill(app.secret());
  await page.getByRole('button', { name: 'Unlock operator tools', exact: true }).click();
  await expect(page).toHaveURL('http://127.0.0.1:4317/showcase');
  await expect(page.getByRole('heading', { name: 'A matter of timing.', exact: true })).toBeVisible();
  await expect(page.getByText('They move together as if rehearsing a dance.', { exact: false })).toBeHidden();
  await page.getByRole('button', { name: 'Skip to written reveal', exact: true }).click();
  await expect(page.getByText('They move together as if rehearsing a dance.', { exact: false })).toBeVisible();
});

for (const width of [390, 320]) test('phone comparison keeps one canonical stage and transport together at ' + width + 'px', async ({ page, app, operator }) => {
  await page.setViewportSize({ width, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/showcase'); await page.getByRole('button', { name: 'Inspect both takes together', exact: true }).click();
  const comparison = page.getByRole('region', { name: 'Score comparison', exact: true });
  const stages = comparison.locator('svg.stage:visible'); await expect(stages).toHaveCount(1);
  const timeline = comparison.getByRole('slider'); await timeline.fill('2400');
  const switchTake = comparison.getByRole('button', { name: 'Show second take', exact: true }); await switchTake.focus(); await page.keyboard.press('Enter');
  await expect(switchTake).toHaveAttribute('aria-pressed', 'true'); await expect(timeline).toHaveValue('2400');
  await expect(stages).toHaveCount(1); const stage = (await stages.boundingBox())!;
  expect(stage.width).toBeCloseTo(width - 32); expect(stage.width / stage.height).toBeCloseTo(10 / 7, 2);
  await comparison.getByRole('button', { name: 'Reset comparison', exact: true }).click();
  const play = comparison.getByRole('button', { name: 'Next comparison keyframe', exact: true }); await play.scrollIntoViewIfNeeded();
  await expect(stages).toBeInViewport({ ratio: 1 }); await expect(play).toBeInViewport({ ratio: 1 });
  await play.click(); expect(Number(await timeline.inputValue())).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const mode of ['play', 'creator/capture', 'study']) test('explicit connection recheck restores ' + mode + ' without an automatic action', async ({ page, app, operator }) => {
  let reachable = false, posts = 0;
  await page.route('http://127.0.0.1:4317/', route => route.request().method() === 'HEAD' && !reachable ? route.fulfill({ status: 503, body: '' }) : route.continue());
  await page.goto('/' + mode);
  const recheck = page.getByRole('button', { name: 'Check local connection', exact: true }); await expect(recheck).toBeVisible();
  page.on('request', request => { if (request.method() === 'POST') posts++; }); reachable = true; await recheck.click();
  await expect(recheck).toHaveCount(0); expect(posts).toBe(0);
  if (mode === 'creator/capture') { await page.getByRole('checkbox', { name: 'My own demonstration text', exact: true }).check(); await expect(page.getByRole('button', { name: 'Start creator demonstration', exact: true })).toBeEnabled(); }
  else await expect(page.getByRole('button', { name: mode === 'play' ? 'Try a fixture round' : 'Start short synthetic study', exact: true })).toBeEnabled();
});

test('rechecking inside a study player also restores parent feedback controls', async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/study'); await page.getByRole('button', { name: 'Start short synthetic study', exact: true }).click();
  await page.getByRole('button', { name: 'Start next round', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Take 1 of 2.', exact: true })).toBeVisible();
  let reachable = false;
  await page.route('http://127.0.0.1:4317/', route => route.request().method() === 'HEAD' && !reachable ? route.fulfill({ status: 503, body: '' }) : route.continue());
  await page.evaluate(() => dispatchEvent(new Event('offline')));
  const recheck = page.getByRole('button', { name: 'Check local connection', exact: true }); await expect(recheck).toBeVisible(); reachable = true; await recheck.click();
  await expect(recheck).toHaveCount(0); await page.getByRole('button', { name: 'Reveal now', exact: true }).click();
  const feedback = page.getByRole('button', { name: 'Save feedback and continue', exact: true }); await expect(feedback).toBeEnabled(); await feedback.click();
  await expect(page.getByRole('button', { name: 'Start next round', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Discard old request', exact: true })).toHaveCount(0);
});

test('an active private player recovers through actual server restart and fresh operator unlock', async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await fixtureRound(page); await viewFirst(page);
  const stopped = new Promise<void>(resolve => app.server.close(() => resolve())); app.server.closeAllConnections(); await stopped;
  let secret = ''; const replacement = await startServer({ memory: true, onLaunchSecret: value => { secret = value; } });
  try {
    await page.getByRole('button', { name: 'Send guess', exact: true }).click();
    const discard = page.getByRole('button', { name: 'Discard old request', exact: true }); await expect(discard).toBeVisible();
    page.once('dialog', dialog => dialog.accept()); await discard.click(); await expect(page.getByRole('heading', { name: 'A tiny silent scene.', exact: true })).toBeVisible();
    expect(await page.evaluate(() => ['tm_creation', 'tm_recovery', 'tm_mutation'].map(key => sessionStorage.getItem(key)))).toEqual([null, null, null]);
    await page.getByRole('link', { name: 'Operator tools', exact: true }).click(); await page.getByLabel('Launch secret', { exact: true }).fill(secret);
    await page.getByRole('button', { name: 'Unlock operator tools', exact: true }).click(); await page.getByRole('link', { name: 'Play', exact: true }).click();
    await page.getByRole('button', { name: 'Try a fixture round', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Take 1 of 2.', exact: true })).toBeVisible();
    expect(replacement.services.ledger.status().reservedUnknownMicroUsd).toBe(0);
  } finally { await replacement.stop(); }
});

for (const status of [404, 503]) test('private local discard requires confirmed lost ownership rather than HTTP ' + status + ' alone', async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await fixtureRound(page); await viewFirst(page);
  await page.route('**/api/rounds/*/guesses', route => route.fulfill({ status, json: { error: status === 404 ? 'NOT_FOUND' : 'UNAVAILABLE', requestId: 'synthetic-review' } }));
  await page.getByRole('button', { name: 'Send guess', exact: true }).click();
  if (status === 404) await expect(page.getByRole('button', { name: 'Discard old request', exact: true })).toBeVisible();
  else { await expect(page.getByRole('heading', { name: 'The next take couldn’t be prepared.', exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'Discard old request', exact: true })).toHaveCount(0); }
});


for (const width of [390, 320]) test('motion references keep their selected canonical stage width at ' + width + 'px', async ({ page, app, operator }) => {
  await page.setViewportSize({ width, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/rehearsal');
  const references = page.getByRole('combobox', { name: 'Comparison', exact: true });
  const ids = await references.locator('option').evaluateAll(nodes => nodes.map(node => (node as HTMLOptionElement).value).filter(Boolean));
  for (const id of ids) {
    await references.selectOption(id); await expect(page.locator('svg.stage:visible')).toHaveCount(1);
    await page.getByText('Frame and key controls', { exact: true }).click();
    await page.getByRole('button', { name: 'Next keyframe', exact: true }).click(); const time = await page.getByRole('slider').inputValue();
    await page.getByRole('button', { name: 'Show reference 2', exact: true }).click();
    await expect(page.getByRole('slider')).toHaveValue(time); await expect(page.locator('svg.stage:visible')).toHaveCount(1);
    await expect(page.getByText('Actual stage width ' + (width - 32) + ' CSS px.', { exact: false })).toBeVisible();
  }
});

test('a missing mutation receipt with a surviving round does not enable local discard', async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await fixtureRound(page); await viewFirst(page);
  await page.route('**/api/rounds/*/guesses', async route => { await route.fetch(); await route.abort(); }, { times: 1 });
  await page.getByRole('button', { name: 'Send guess', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check for a completed take', exact: true })).toBeVisible();
  await page.route('**/api/rounds/*/requests/*', route => route.fulfill({ status: 404, json: { error: 'NOT_FOUND', requestId: 'synthetic-review' } }));
  await page.getByRole('button', { name: 'Check for a completed take', exact: true }).click();
  await expect(page.getByRole('button', { name: 'View next take', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Discard old request', exact: true })).toHaveCount(0);
});

test('lost study ownership keeps local private discard unavailable and withdrawal reachable', async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/study'); await page.getByRole('button', { name: 'Start short synthetic study', exact: true }).click();
  await page.getByRole('button', { name: 'Start next round', exact: true }).click(); await viewFirst(page);
  await page.route('**/api/rounds/*/guesses', route => route.fulfill({ status: 401, json: { error: 'UNAUTHENTICATED', requestId: 'synthetic-review' } }));
  await page.getByRole('button', { name: 'Send guess', exact: true }).click();
  await expect(page.getByText('The local session ended. Your saved study request is kept. Use the withdrawal controls or ask the facilitator for help.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Discard old request', exact: true })).toHaveCount(0);
  await page.getByText('Withdraw local study records', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete my linked study records', exact: true })).toBeVisible();
});
