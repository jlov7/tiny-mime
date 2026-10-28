import { test, expect } from '../support/browser-fixtures.js';
import { unzipSync, strFromU8 } from 'fflate';
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

async function completedCreator(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/creator/capture');
  await page.getByRole('checkbox', { name: 'My own demonstration text' }).check();
  await page.getByRole('button', { name: 'Start creator demonstration', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Take 1 of 2.', exact: true })).toBeVisible();
  for (const attempt of [1, 2] as const) {
    if (attempt === 2) await page.getByRole('button', { name: 'View next take', exact: true }).click();
    const roundId = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId);
    const round = await (await page.request.get('/api/rounds/' + roundId)).json();
    const keys = new Set(round.acts[attempt - 1].score.actors.flatMap((actor: any) => actor.keyframes.map((key: any) => key.tMs)));
    for (let index = 1; index < keys.size; index++) await page.getByRole('button', { name: 'Next frame', exact: true }).click();
    await page.getByRole('textbox', { name: attempt === 1 ? 'What’s happening?' : 'What do you think now?', exact: true }).fill(attempt === 1 ? 'A private creator first guess' : 'A private creator final guess');
    await page.getByRole('button', { name: attempt === 1 ? 'Send guess' : 'Send final guess', exact: true }).click();
    if (attempt === 1) await expect(page.getByRole('button', { name: 'View next take', exact: true })).toBeVisible();
  }
  await page.getByRole('link', { name: 'Creator capture', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Include authorized guess text' })).toBeEnabled();
}

test('changing guess inclusion invalidates the old capture before exporting the new bytes', async ({ page, app, operator }) => {
  await completedCreator(page);
  const include = page.getByRole('checkbox', { name: 'Include authorized guess text' });
  const create = page.getByRole('button', { name: 'Create local replay bundle', exact: true });
  const save = page.getByRole('link', { name: 'Save tiny-mime-replay.zip', exact: true });
  await include.check(); await create.click(); await expect(save).toBeVisible();
  await include.uncheck(); await expect(save).toHaveCount(0);
  await create.click(); await expect(save).toBeVisible();
  const downloading = page.waitForEvent('download'); await save.click();
  const path = await (await downloading).path(); expect(path).not.toBeNull();
  const files = unzipSync(readFileSync(path!));
  const manifest = JSON.parse(strFromU8(files['capture-manifest.json']));
  expect(manifest.omittedGuessText).toBe(true); expect(manifest.consentBasis).toBe('no_guess_text');
  const html = strFromU8(files['replay.html']);
  const payload = html.match(/<div id="payload" hidden>([A-Za-z0-9+/=]+)<\/div>/);
  expect(payload).not.toBeNull();
  expect(Buffer.from(payload![1], 'base64').toString('utf8')).not.toContain('A private creator first guess');
});

test('capture options stay fixed while an export acknowledgement is delayed', async ({ page, app, operator }) => {
  await completedCreator(page);
  let release!: () => void; let held = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/operator/captures', async route => {
    const response = await route.fetch(); held = true; await gate; await route.fulfill({ response });
  }, { times: 1 });
  try {
    await page.getByRole('button', { name: 'Create local replay bundle', exact: true }).click();
    await expect.poll(() => held).toBe(true);
    await expect(page.getByRole('checkbox', { name: 'Include authorized guess text' })).toBeDisabled();
    await expect(page.getByRole('checkbox', { name: 'Create a labelled shortened-wait replay' })).toBeDisabled();
    await expect(page.getByRole('link', { name: 'Save tiny-mime-replay.zip', exact: true })).toHaveCount(0);
    release(); await expect(page.getByRole('link', { name: 'Save tiny-mime-replay.zip', exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Include authorized guess text' })).toBeEnabled();
  } finally { release(); }
});
