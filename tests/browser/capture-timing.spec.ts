import type { Page } from '@playwright/test';
import { test, expect, fixtureRound } from '../support/browser-fixtures.js';

async function frames(page: Page, attempt: 1 | 2) {
  if (attempt === 2) await page.getByRole('button', { name: 'View next take', exact: true }).click();
  for (let i = 0; i < 40; i++) {
    const field = page.getByRole('textbox', { name: attempt === 1 ? 'What’s happening?' : 'What do you think now?' });
    if (await field.isEnabled()) return;
    await page.getByRole('button', { name: 'Next frame', exact: true }).click();
  }
  throw new Error('FRAME_COMPLETION_NOT_REACHED');
}

test('main playback during the both-takes gap cancels the scheduled second take', async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await fixtureRound(page); await frames(page, 1);
  await page.getByRole('textbox', { name: 'What’s happening?' }).fill('A synthetic first guess');
  await page.getByRole('button', { name: 'Send guess', exact: true }).click();
  await expect(page.getByRole('button', { name: 'View next take', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reveal now', exact: true }).click();
  // A future pause avoids racing the installed browser clock with the Node wall clock.
  await page.clock.install(); await page.clock.pauseAt(new Date(Date.now() + 60000));
  await page.getByRole('button', { name: 'Play both takes', exact: true }).click();
  // Revealed rounds no longer expose a guess field; reaching the final key schedules the gap.
  for (let i = 0; i < 30 && !await page.getByText('Pause between takes.', { exact: true }).isVisible(); i++) await page.getByRole('button', { name: 'Next frame', exact: true }).click();
  await expect(page.getByText('Pause between takes.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stop both takes', exact: true }).click();
  await page.clock.fastForward(1001);
  await expect(page.getByText('Authored first take', { exact: true })).toBeVisible();
  await expect(page.getByText('Pause between takes.', { exact: true })).toHaveCount(0);
});

test('creator trace preserves unequal holds and backward frame steps; refresh cannot invent continuity', async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install();
  await page.goto('/creator/capture'); await page.getByRole('checkbox', { name: 'My own demonstration text' }).check();
  await page.getByRole('button', { name: 'Start creator demonstration' }).click();
  await expect(page.getByRole('heading', { name: 'Take 1 of 2.' })).toBeVisible();
  let posted: any = null;
  page.on('request', r => { if (r.url().endsWith('/capture-trace')) posted = r.postDataJSON(); });
  await page.clock.pauseAt(new Date(Date.now() + 60000));
  await page.getByRole('button', { name: 'Next frame', exact: true }).click(); await page.clock.fastForward(300);
  await page.getByRole('button', { name: 'Next frame', exact: true }).click(); await page.clock.fastForward(900);
  await page.getByRole('button', { name: 'Previous frame', exact: true }).click(); await page.clock.fastForward(1200);
  await frames(page, 1); await page.clock.resume();
  await page.getByRole('textbox', { name: 'What’s happening?' }).fill('A synthetic first guess'); await page.getByRole('button', { name: 'Send guess', exact: true }).click();
  await expect(page.getByRole('button', { name: 'View next take', exact: true })).toBeVisible(); await frames(page, 2);
  await page.getByRole('textbox', { name: 'What do you think now?' }).fill('A synthetic second guess');
  const response = page.waitForResponse(r => r.url().endsWith('/capture-trace'));
  await page.getByRole('button', { name: 'Send final guess', exact: true }).click(); expect((await response).status()).toBe(200);
  const steps = posted.states.filter((s: any) => s.reason === 'step');
  expect(steps[1].atMs - steps[0].atMs).toBeGreaterThanOrEqual(300); expect(steps[2].atMs - steps[1].atMs).toBeGreaterThanOrEqual(900);
  expect(steps[2].positionMs).toBe(steps[0].positionMs); expect(steps[1].positionMs).toBeGreaterThan(steps[0].positionMs);
  await page.getByRole('link', { name: 'Creator capture', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Create a labelled shortened-wait replay' })).toBeEnabled();
  await page.goto('/creator/capture'); await page.getByRole('checkbox', { name: 'My own demonstration text' }).check();
  await page.getByRole('button', { name: 'Start creator demonstration' }).click(); await expect(page.getByRole('heading', { name: 'Take 1 of 2.' })).toBeVisible();
  posted = null; await page.reload(); await frames(page, 1);
  await page.getByRole('textbox', { name: 'What’s happening?' }).fill('After reload'); await page.getByRole('button', { name: 'Send guess', exact: true }).click();
  await expect(page.getByRole('button', { name: 'View next take', exact: true })).toBeVisible(); await frames(page, 2);
  await page.getByRole('textbox', { name: 'What do you think now?' }).fill('Reconstruction only'); await page.getByRole('button', { name: 'Send final guess', exact: true }).click();
  await page.getByRole('link', { name: 'Creator capture', exact: true }).click(); expect(posted).toBeNull();
  await expect(page.getByRole('checkbox', { name: 'Create a labelled shortened-wait replay' })).toBeDisabled();
});

for (const interruption of ['timeout', 'clock uncertainty'] as const) test(`creator trace stops waiting at ${interruption}, before the idle recovery gap`, async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.clock.install();
  await page.route('**/api/operator/creator-rounds', async route => {
    const response = await route.fetch(); const round = await response.json();
    await page.evaluate(id => sessionStorage.setItem('tm.creator-trace-start', id), round.roundId);
    await route.fulfill({ response });
  });
  let posted: any = null;
  await page.route('**/capture-trace', async route => { posted = route.request().postDataJSON(); await route.fulfill({ json: { accepted: true } }); });
  await page.goto('/creator/capture'); await page.getByRole('checkbox', { name: 'My own demonstration text' }).check();
  await page.getByRole('button', { name: 'Start creator demonstration' }).click(); await frames(page, 1);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let held = false;
  await page.route('**/api/rounds/*/guesses', async route => {
    const response = await route.fetch(); held = true; await gate; await route.fulfill({ response }).catch(() => {});
  }, { times: 1 });
  try {
    await page.getByRole('textbox', { name: 'What’s happening?' }).fill('A synthetic interrupted guess');
    const submissionBefore = await page.evaluate(() => performance.now());
    await page.getByRole('button', { name: 'Send guess', exact: true }).click();
    const submissionAfter = await page.evaluate(() => performance.now());
    await expect.poll(() => held).toBe(true);
    const id = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId);
    await expect.poll(async () => (await (await page.request.get('/api/rounds/' + id)).json()).state).toBe('awaiting_guess2');
    const interruptionBefore = await page.evaluate(() => performance.now());
    if (interruption === 'clock uncertainty') { await page.clock.setSystemTime(new Date(Date.now() + 100000)); await page.clock.fastForward(500); await expect(page.getByText('Timing was interrupted. Check the result explicitly.', { exact: true })).toBeVisible(); }
    else { await page.clock.fastForward(16000); await expect(page.getByText('Waiting ended before the next take arrived.', { exact: true })).toBeVisible(); }
    const interruptionAfter = await page.evaluate(() => performance.now());
    await page.clock.fastForward(20000); release();
    await page.getByRole('button', { name: 'Check for a completed take', exact: true }).click();
    await expect(page.getByRole('button', { name: 'View next take', exact: true })).toBeVisible(); await frames(page, 2);
    await page.getByRole('textbox', { name: 'What do you think now?' }).fill('A synthetic final guess'); await page.getByRole('button', { name: 'Send final guess', exact: true }).click();
    await expect.poll(() => posted).not.toBeNull();
    const stopped = posted.states.find((s: any, i: number) => i > 0 && posted.states[i - 1].waiting && !s.waiting);
    const ready = posted.states.find((s: any) => s.phase === 'awaiting_guess2');
    expect(stopped.phase).toBe('generating_act2'); expect(ready.atMs - stopped.atMs).toBeGreaterThanOrEqual(20000);
    const waited = posted.states.slice(0, -1).reduce((sum: number, s: any, i: number) => sum + (s.waiting ? posted.states[i + 1].atMs - s.atMs : 0), 0);
    // The trace rounds each document timestamp to milliseconds; browser windows include transport and setup time.
    expect(waited).toBeGreaterThanOrEqual(Math.floor(interruptionBefore - submissionAfter) - 1);
    expect(waited).toBeLessThanOrEqual(Math.ceil(interruptionAfter - submissionBefore) + 1);
    if (interruption === 'timeout') expect(waited).toBeGreaterThanOrEqual(15000);
    expect(posted.states.filter((s: any) => s.atMs >= stopped.atMs).every((s: any) => !s.waiting)).toBe(true);
  } finally { release(); }
});
