import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../support/browser-fixtures.js';
import { browserArtifact } from '../support/browser-artifacts.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { unzipSync, strFromU8 } from 'fflate';

async function tabTo(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  await expect(target).toBeEnabled();
  for (let count = 0; count < 96; count++) {
    if (await target.evaluate(node => node === document.activeElement)) return;
    const key = await target.evaluate(node => document.activeElement && (document.activeElement.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING) ? 'Shift+Tab' : 'Tab');
    await page.keyboard.press(key);
  }
  throw new Error('KEYBOARD_TARGET_UNREACHABLE');
}
async function activate(page: Page, target: Locator) { await tabTo(page, target); const href = await target.getAttribute('href'); const navigation = href?.startsWith('/') ? page.waitForURL(new URL(href, 'http://127.0.0.1:4317').href) : null; await page.keyboard.press('Enter'); await navigation; }
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
async function take(page: Page, attempt: 1 | 2) {
  if (attempt === 2) await activate(page, button(page, 'View next take'));
  await expect(button(page, 'Next frame')).toBeVisible();
  const id = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId);
  const round = await (await page.request.get('/api/rounds/' + id)).json();
  const times = new Set(round.acts[attempt - 1].score.actors.flatMap((actor: any) => actor.keyframes.map((key: any) => key.tMs)));
  for (let index = 1; index < times.size; index++) await activate(page, button(page, 'Next frame'));
  const field = page.getByRole('textbox', { name: attempt === 1 ? 'What’s happening?' : 'What do you think now?', exact: true }); await expect(field).toBeEnabled();
  await tabTo(page, field); await page.keyboard.type('A synthetic interpretation of the shapes.'); await page.keyboard.press('Enter');
  if (attempt === 1) await expect(button(page, 'View next take')).toBeVisible();
}

for (const width of [1280, 390]) test(`all four rooms support a complete keyboard fixture journey at ${width}px`, async ({ page, app, operator }, info) => {
  test.setTimeout(120000); await page.setViewportSize({ width, height: 1000 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  const screenshots = async (name: string) => { if (name === 'capture') await expect(page.getByRole('heading', { name: 'Keep the whole performance.' })).toBeVisible(); if (name === 'study') await expect(page.getByRole('heading', { name: 'Watch, describe, discover.' })).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: browserArtifact(`${info.project.name}-quality-${name}-${width}.png`), fullPage: true }); };
  await page.goto('/rehearsal'); await expect(page.locator('svg.stage')).toBeVisible(); await activate(page, button(page, 'Next frame')); await screenshots('rehearsal');
  await activate(page, page.getByRole('link', { name: 'Play', exact: true })); await activate(page, button(page, 'Try a fixture round')); await take(page, 1); await take(page, 2);
  await expect(page.getByRole('heading', { name: 'The scene was meant to show…' })).toBeVisible(); await screenshots('play'); await activate(page, button(page, 'Finish'));
  await activate(page, page.getByRole('link', { name: 'Capture', exact: true })); await screenshots('capture');
  const ownership = page.getByRole('checkbox', { name: 'My own demonstration text', exact: true }); await tabTo(page, ownership); await page.keyboard.press('Space'); await activate(page, button(page, 'Start creator demonstration')); await take(page, 1); await take(page, 2);
  const creatorId = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId);
  await expect.poll(() => app.services.events.observations(creatorId).completedViews.length).toBe(2); expect(app.services.events.observations(creatorId).completedPlays).toHaveLength(0);
  await activate(page, page.getByRole('link', { name: 'Creator capture', exact: true })); await activate(page, button(page, 'Create local replay bundle')); await expect(page.getByRole('link', { name: 'Save tiny-mime-replay.zip', exact: true })).toBeVisible();
  const downloaded = page.waitForEvent('download'); await activate(page, page.getByRole('link', { name: 'Save tiny-mime-replay.zip', exact: true })); const zip = browserArtifact(`${info.project.name}-quality-frames-${width}.zip`); await (await downloaded).saveAs(zip);
  const manifest = JSON.parse(strFromU8(unzipSync(readFileSync(zip))['capture-manifest.json']!)); expect(manifest.playbackObservations.map((p: any) => p.mode)).toEqual(['frame_step', 'frame_step']); expect(manifest.validityLimitations).toContain('Replay reconstructs score motion. Exported motion is not evidence of original full-motion viewing.');
  await activate(page, page.getByRole('link', { name: 'Return to the completed round', exact: true })); await activate(page, button(page, 'Finish'));
  await activate(page, page.getByRole('link', { name: 'Study', exact: true })); await screenshots('study'); await activate(page, button(page, 'Start short synthetic study'));
  for (let index = 0; index < 3; index++) { await activate(page, button(page, 'Start next round')); await take(page, 1); await take(page, 2); await activate(page, button(page, 'Save feedback and continue')); }
  await activate(page, button(page, 'Finish and save choices')); await expect(page.getByRole('heading', { name: 'Thanks for taking part.' })).toBeVisible();
  expect(app.services.ledger.status().reservedUnknownMicroUsd).toBe(0);
  expect((app.services.realStudy.db.prepare('SELECT count(*) n FROM study_sessions').get() as any).n).toBe(0);
  expect(app.services.fixtureStudy.db.prepare('SELECT data FROM fixture_rounds').all().every((r: any) => { const row = JSON.parse(r.data).row; return row.first_render_status !== 'rendered' && row.second_render_status !== 'rendered'; })).toBe(true);
  writeFileSync(browserArtifact(`${info.project.name}-quality-journey-${width}.json`), JSON.stringify({ status: 'PASS', browser: info.project.name, width, input: 'keyboard', mode: 'frame_step', roomsPassed: ['rehearsal', 'private_play', 'creator_capture', 'synthetic_study'], providerCalls: 0, humanExperience: 'NOT RUN', physicalDevices: 'NOT RUN' }, null, 2) + '\n');
});

test('fresh home requests satisfy the predeclared compressed entry-payload target', async ({ page, app }, info) => {
  const responses = new Map<string, Promise<Buffer>>(); page.on('response', response => { if (response.request().resourceType() === 'script') responses.set(new URL(response.url()).pathname, response.body()); });
  await page.goto('/'); await expect(page.getByRole('heading', { name: 'A tiny silent scene.' })).toBeVisible(); await page.waitForLoadState('networkidle');
  const files = await Promise.all([...responses].map(async ([path, bytes]) => ({ path, gzipBytes: gzipSync(await bytes).length })));
  const gzipBytes = files.reduce((total, file) => total + file.gzipBytes, 0); expect(gzipBytes).toBeLessThanOrEqual(96860);
  writeFileSync(browserArtifact(`${info.project.name}-quality-entry.json`), JSON.stringify({ status: 'PASS', files, gzipBytes, baselineGzipBytes: 121075, reductionPercent: (1 - gzipBytes / 121075) * 100, compression: 'node:zlib gzipSync defaults', empiricalLatency: 'NOT RUN' }, null, 2) + '\n');
});
