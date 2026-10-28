import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { test, expect } from '../support/browser-fixtures.js';

async function completeTake(page: Page, attempt: 1 | 2) {
  if (attempt === 2) await page.getByRole('button', { name: 'View next take', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Next frame', exact: true })).toBeVisible();
  const id = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId);
  const round = await (await page.request.get('/api/rounds/' + id)).json();
  const times = new Set(round.acts[attempt - 1].score.actors.flatMap((actor: any) => actor.keyframes.map((key: any) => key.tMs)));
  for (let index = 1; index < times.size; index++) await page.getByRole('button', { name: 'Next frame', exact: true }).click();
  const field = page.getByRole('textbox', { name: attempt === 1 ? 'What’s happening?' : 'What do you think now?', exact: true });
  await expect(field).toBeEnabled(); await field.fill('Synthetic local interpretation.');
  await page.getByRole('button', { name: attempt === 1 ? 'Send guess' : 'Send final guess', exact: true }).click();
  if (attempt === 1) await expect(page.getByRole('button', { name: 'View next take', exact: true })).toBeVisible();
  else await expect(page.getByRole('heading', { name: 'The scene was meant to show…', exact: true })).toBeVisible();
}

test('lost accepted study start reloads the same session without another POST or round', async ({ page, app, operator }) => {
  let acceptedId = ''; let posts = 0; let savedBeforeDispatch: any;
  await page.route('**/api/operator/study-rehearsals', async route => {
    posts++; savedBeforeDispatch = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_study_start')!));
    const response = await route.fetch(); acceptedId = (await response.json()).studySessionId; await route.abort();
  }, { times: 1 });
  await page.goto('/study'); await page.getByRole('button', { name: 'Start short synthetic study', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check saved study start', exact: true })).toBeEnabled();
  expect(savedBeforeDispatch.fixtureScheduleId).toBe('synthetic_short_v1'); expect(savedBeforeDispatch.requestId).toBeTruthy();
  expect(Object.keys(savedBeforeDispatch).sort()).toEqual(['createdWallMs', 'fixtureScheduleId', 'kind', 'requestId', 'version']);
  await page.reload(); await expect(page.getByRole('button', { name: 'Start next round', exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('session')).toBe(acceptedId); expect(posts).toBe(1);
  expect((app.services.fixtureStudy.db.prepare('SELECT count(*) n FROM fixture_sessions').get() as any).n).toBe(1);
  expect((app.services.fixtureStudy.db.prepare('SELECT count(*) n FROM fixture_rounds').get() as any).n).toBe(0);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('tm_study_start'))).toBeNull();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0);
});

test('an unreceived study start waits through reload and explicitly retries its original identity', async ({ page, app, operator }) => {
  const ids: string[] = [];
  await page.route('**/api/operator/study-rehearsals', async route => { ids.push(route.request().postDataJSON().requestId); if (ids.length === 1) await route.abort(); else await route.continue(); });
  await page.goto('/study'); await page.getByRole('button', { name: 'Start full synthetic study', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check saved study start', exact: true })).toBeEnabled();
  await page.reload(); await expect(page.getByRole('button', { name: 'Retry saved synthetic study', exact: true })).toBeEnabled();
  expect(ids).toHaveLength(1); await expect(page.getByRole('button', { name: 'Start short synthetic study', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry saved synthetic study', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start next round', exact: true })).toBeVisible(); expect(ids).toEqual([ids[0], ids[0]]);
  expect((app.services.fixtureStudy.db.prepare('SELECT count(*) n FROM fixture_sessions').get() as any).n).toBe(1);
});

test('browser offline hints leave a reachable loopback synthetic study usable', async ({ page, app, operator }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'onLine', { get: () => false }); });
  await page.goto('/study'); await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.getByRole('button', { name: 'Start short synthetic study', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Start short synthetic study', exact: true }).click(); await expect(page.getByRole('button', { name: 'Start next round', exact: true })).toBeVisible();
  expect((app.services.fixtureStudy.db.prepare('SELECT count(*) n FROM fixture_sessions').get() as any).n).toBe(1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (let index = 0; index < 3; index++) {
    await page.getByRole('button', { name: 'Start next round', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Take 1 of 2.', exact: true })).toBeVisible();
    await completeTake(page, 1); await completeTake(page, 2);
    await page.getByRole('button', { name: 'Save feedback and continue', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Finish and save choices', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Thanks for taking part.', exact: true })).toBeVisible();
  expect((app.services.fixtureStudy.db.prepare('SELECT count(*) n FROM fixture_rounds').get() as any).n).toBe(3);
  expect((app.services.realStudy.db.prepare('SELECT count(*) n FROM study_sessions').get() as any).n).toBe(0);
});

test('browser offline hints allow private creation retry, both guesses, reveal and exit', async ({ page, app, operator }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'onLine', { get: () => false }); });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/rounds', route => route.abort(), { times: 1 });
  await page.goto('/play'); await page.getByRole('button', { name: 'Try a fixture round', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check result', exact: true })).toBeEnabled();
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_creation')!));
  await page.reload(); await expect(page.getByRole('button', { name: 'Retry round creation', exact: true })).toBeEnabled();
  const retry = page.waitForRequest(request => request.url().endsWith('/api/rounds') && request.method() === 'POST');
  await page.getByRole('button', { name: 'Retry round creation', exact: true }).click();
  expect((await retry).postDataJSON().requestId).toBe(saved.requestId);
  await expect(page.getByRole('heading', { name: 'Take 1 of 2.', exact: true })).toBeVisible();
  await completeTake(page, 1); await completeTake(page, 2);
  await page.getByRole('button', { name: 'Another scene', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Take 1 of 2.', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reveal now', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'The scene was meant to show…', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Another scene', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Take 1 of 2.', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Exit round', exact: true }).click();
  await expect.poll(async () => { const id = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId); return (await (await page.request.get('/api/rounds/' + id)).json()).state; }).toBe('abandoned');
});

test('a blocked storage write prevents the study start POST', async ({ page, app, operator }) => {
  let posts = 0; page.on('request', request => { if (request.url().endsWith('/api/operator/study-rehearsals')) posts++; });
  await page.addInitScript(() => { const setItem = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key === 'tm_study_start') throw new Error('blocked'); setItem.call(this, key, value); }; });
  await page.goto('/study'); await page.getByRole('button', { name: 'Start short synthetic study', exact: true }).click();
  await expect(page.getByText('This tab cannot safely save a study start. Ask the facilitator to check local storage before continuing.', { exact: true })).toBeVisible(); expect(posts).toBe(0);
  expect((app.services.fixtureStudy.db.prepare('SELECT count(*) n FROM fixture_sessions').get() as any).n).toBe(0);
});

test('reloaded human enrollment keeps consent only in memory and requires explicit reaffirmation', async ({ page, app, operator }) => {
  const runId = randomUUID(); const ids: string[] = [];
  // Only expose the form for this UI check. The real service remains locked and receives no enrollment.
  await page.route('**/study', async route => {
    const response = await route.fetch(); const html = await response.text();
    await route.fulfill({ response, body: html.replace(/(<meta name="tiny-mime" content=")([^"]+)(">)/, (_all, prefix, encoded, suffix) => {
      const boot = JSON.parse(Buffer.from(encoded, 'base64').toString()); boot.study = { available: true, studyRunId: runId, consentVersion: 'consent-v1', operatorContact: 'Local fixture' };
      return prefix + Buffer.from(JSON.stringify(boot)).toString('base64') + suffix;
    }) });
  });
  await page.route('**/api/study-sessions', async route => { ids.push(route.request().postDataJSON().requestId); await route.abort(); });
  await page.goto('/study'); const choices = page.getByRole('checkbox'); for (let i = 0; i < 5; i++) await choices.nth(i).check();
  await page.getByRole('button', { name: 'Start study', exact: true }).click(); await expect(page.getByRole('button', { name: 'Check saved study start', exact: true })).toBeEnabled();
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_study_start')!));
  expect(Object.keys(saved).sort()).toEqual(['consentVersion', 'createdWallMs', 'kind', 'requestId', 'studyRunId', 'version']);
  await page.reload(); const retry = page.getByRole('button', { name: 'Reaffirm choices and retry study', exact: true }); await expect(retry).toBeDisabled();
  await expect(page.getByText('No accepted start was found. Review and reaffirm every consent choice before retrying this study start.', { exact: true })).toBeVisible();
  for (let i = 0; i < 5; i++) await expect(choices.nth(i)).not.toBeChecked(); expect(ids).toHaveLength(1);
  for (let i = 0; i < 4; i++) await choices.nth(i).check(); await retry.click(); await expect.poll(() => ids.length).toBe(2); expect(ids[1]).toBe(ids[0]);
  expect((app.services.realStudy.db.prepare('SELECT count(*) n FROM study_sessions').get() as any).n).toBe(0);
});

test('failed loopback checks disable starts and reconnect checks never create a study automatically', async ({ page, app, operator }) => {
  let reachable = false; let posts = 0;
  await page.route('http://127.0.0.1:4317/', async route => { if (route.request().method() === 'HEAD' && !reachable) await route.abort(); else await route.continue(); });
  page.on('request', request => { if (request.url().endsWith('/api/operator/study-rehearsals')) posts++; });
  await page.goto('/study'); const start = page.getByRole('button', { name: 'Start short synthetic study', exact: true }); await expect(start).toBeDisabled();
  reachable = true; await page.evaluate(() => window.dispatchEvent(new Event('online'))); await expect(start).toBeEnabled(); expect(posts).toBe(0);
  expect((app.services.fixtureStudy.db.prepare('SELECT count(*) n FROM fixture_sessions').get() as any).n).toBe(0);
});

test('an unreceived session handshake can be checked explicitly before retrying the saved start', async ({ page, context, app, operator }) => {
  await context.clearCookies({ name: 'tm_session' }); let starts = 0;
  page.on('request', request => { if (request.url().endsWith('/api/operator/study-rehearsals')) starts++; });
  await page.route('**/api/session', route => route.abort(), { times: 1 });
  await page.goto('/study'); await page.getByRole('button', { name: 'Start short synthetic study', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check saved study start', exact: true })).toBeEnabled();
  const id = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_study_start')!).requestId);
  await page.reload(); await expect(page.getByText('The saved study start could not be checked. Check it before trying again.', { exact: true })).toBeVisible(); expect(starts).toBe(0);
  await page.getByRole('button', { name: 'Check saved study start', exact: true }).click(); await expect(page.getByRole('button', { name: 'Retry saved synthetic study', exact: true })).toBeEnabled(); expect(starts).toBe(0);
  const outgoing = page.waitForRequest(request => request.url().endsWith('/api/operator/study-rehearsals'));
  await page.getByRole('button', { name: 'Retry saved synthetic study', exact: true }).click(); expect((await outgoing).postDataJSON().requestId).toBe(id);
  await expect(page.getByRole('button', { name: 'Start next round', exact: true })).toBeVisible();
  expect((app.services.fixtureStudy.db.prepare('SELECT count(*) n FROM fixture_sessions').get() as any).n).toBe(1);
});
