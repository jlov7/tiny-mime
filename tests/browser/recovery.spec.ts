import { test, expect, fixtureRound, firstGuess } from '../support/browser-fixtures.js';
import { randomUUID } from 'node:crypto';

test('an exited round reloads its stopped screen without a playback error', async ({ page, app, operator }) => {
  await fixtureRound(page); await page.getByRole('button', { name: 'Exit round', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Thanks for playing.', exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByRole('heading', { name: 'The round was stopped.', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Thanks for playing.', exact: true })).toBeVisible();
  await page.goto('/play'); await expect(page.getByRole('button', { name: 'Try a fixture round', exact: true })).toBeEnabled();
});

test('reconnect check restores the saved round after its reload read fails', async ({ page, app, operator }) => {
  await fixtureRound(page);
  const id = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId);
  await page.route(`**/api/rounds/${id}`, route => route.abort(), { times: 1 });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Check result', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Check result', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Take 1 of 2.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check result', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId)).toBe(id);
  expect((app.services.rounds as any).rounds.size).toBe(1);
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0);
});

test('startup restoration gates new creation until the owned round is restored', async ({ page, app, operator }) => {
  await fixtureRound(page);
  const id = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId);
  let held = false; let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/rounds/${id}`, async route => { held = true; await gate; await route.continue(); });
  try {
    await page.reload();
    await expect.poll(() => held).toBe(true);
    await expect(page.getByRole('button', { name: 'Try a fixture round', exact: true })).toBeDisabled();
  } finally { release(); }
  await expect(page.getByRole('heading', { name: 'Take 1 of 2.' })).toBeVisible();
  expect((app.services.rounds as any).rounds.size).toBe(1);
  expect(await page.evaluate(() => sessionStorage.getItem('tm_creation'))).toBeNull();
});

test('R01 lost creation acknowledgement reloads the same owned round', async ({ page, app, operator }) => {
  let createdId = '';
  await page.route('**/api/rounds', async route => { const res = await route.fetch(); createdId = (await res.json()).roundId; await route.abort(); }, { times: 1 });
  await page.goto('/play'); await page.getByRole('button', { name: 'Try a fixture round' }).click(); await expect(page.getByRole('button', { name: 'Check result', exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_creation')!).requestId)).toBeTruthy();
  await page.reload(); await expect(page.getByRole('heading', { name: 'Take 1 of 2.' })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId)).toBe(createdId);
  expect((app.services.rounds as any).rounds.size).toBe(1);
});

test('R02 creation that never arrives can retry its original identity explicitly', async ({ page, app, operator }) => {
  await page.route('**/api/rounds', route => route.abort(), { times: 1 });
  await page.goto('/play'); await page.getByRole('button', { name: 'Try a fixture round' }).click(); await expect(page.getByRole('button', { name: 'Check result', exact: true })).toBeVisible();
  const requestId = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_creation')!).requestId);
  await page.reload(); await expect(page.getByRole('button', { name: 'Retry round creation' })).toBeVisible();
  const outgoing = page.waitForRequest(request => request.url().endsWith('/api/rounds') && request.method() === 'POST');
  await page.getByRole('button', { name: 'Retry round creation' }).click(); expect((await outgoing).postDataJSON().requestId).toBe(requestId);
  await expect(page.getByRole('heading', { name: 'Take 1 of 2.' })).toBeVisible(); expect((app.services.rounds as any).rounds.size).toBe(1);
});

test('D02 lost first acknowledgement and repeated reload require explicit recovery without autoplay', async ({ page, app, operator }) => {
  await fixtureRound(page);
  await page.route('**/api/rounds/*/guesses', async route => { await route.fetch(); await route.abort(); }, { times: 1 });
  await firstGuess(page); await expect(page.getByText('The local server could not be reached. Check the connection, then try again.')).toBeVisible();
  const deadline = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_mutation')!).deadlineWallMs);
  await page.reload(); await expect(page.getByText('Timing was interrupted. Check the result explicitly.')).toBeVisible();
  await page.reload(); await expect(page.getByText('Timing was interrupted. Check the result explicitly.')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_mutation')!).deadlineWallMs)).toBe(deadline);
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0);
  await expect.poll(() => (app.services.rounds as any).rounds.values().next().value.public.generation.status).toBe('ready');
  await page.getByRole('button', { name: 'Check for a completed take' }).click();
  await expect(page.getByRole('button', { name: 'Play next take' })).toBeVisible(); await expect(page.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).clockUncertain)).toBe(true);
  const r = (app.services.rounds as any).rounds.values().next().value; expect(app.services.events.observations(r.public.roundId).operationalOutcome.clockUncertain).toBe(true);
});

test('D01 deadline starts before acknowledgement and leaves reveal usable at fifteen seconds', async ({ page, app, operator }) => {
  await fixtureRound(page); await page.clock.install();
  await page.getByRole('button', { name: 'Play scene', exact: true }).click(); await page.clock.fastForward(10000); await expect(page.getByRole('textbox', { name: 'What’s happening?' })).toBeEnabled();
  let captured: any = null;
  await page.route('**/api/rounds/*/guesses', async () => { captured = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_mutation')!)); await new Promise(() => {}); });
  await page.getByRole('textbox', { name: 'What’s happening?' }).fill('A stalled submission'); await page.getByRole('button', { name: 'Send guess', exact: true }).click();
  await expect.poll(() => captured?.deadlineWallMs - captured?.submittedWallMs).toBe(15000);
  await page.clock.fastForward(15010);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).clientTimeout)).toBe(true);
  await expect(page.getByRole('button', { name: 'Reveal the scene' })).toBeEnabled(); await page.getByRole('button', { name: 'Reveal the scene' }).click(); await expect(page.getByRole('heading', { name: 'The scene was meant to show…' })).toBeVisible();
});

test('D04 clock discontinuity stops automatic acceptance and late check does not autoplay', async ({ page, app, operator }) => {
  await fixtureRound(page); await firstGuess(page);
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_mutation')!));
  const read = page.waitForResponse(response => response.url().endsWith(`/api/rounds/${saved.roundId}`) && response.request().method() === 'GET');
  await page.evaluate(() => { const original = Date.now; Date.now = () => original() + 60 * 60 * 1000; });
  await expect(page.getByText('Timing was interrupted. Check the result explicitly.')).toBeVisible();
  expect((await read).status()).toBe(200);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_mutation')!).deadlineWallMs)).toBe(saved.deadlineWallMs);
  await expect.poll(() => (app.services.rounds as any).rounds.values().next().value.public.generation.status).toBe('ready');
  await page.getByRole('button', { name: 'Check for a completed take' }).click(); await expect(page.getByRole('button', { name: 'Play next take' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0);
});

for (const action of ['guess', 'reveal', 'exit']) test(`a browser-only forward clock jump preserves the owned round for ${action}`, async ({ page, app, operator }) => {
  await fixtureRound(page); await page.clock.install();
  await page.getByRole('button', { name: 'Play scene', exact: true }).click(); await page.clock.fastForward(10000);
  await page.getByRole('textbox', { name: 'What’s happening?' }).fill('A draft kept through a clock jump');
  const id = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId);
  const original = (app.services.rounds as any).rounds.get(id).public;
  const expiresAt = original.expiresAt;
  let reads = 0;
  page.on('request', request => { if (request.url().endsWith(`/api/rounds/${id}`) && request.method() === 'GET') reads++; });
  const read = page.waitForResponse(response => response.url().endsWith(`/api/rounds/${id}`) && response.request().method() === 'GET');
  await page.evaluate(() => { const original = Date.now; Date.now = () => original() + 60 * 60 * 1000; });
  await page.clock.runFor(1100); expect((await read).status()).toBe(200);
  await page.waitForLoadState('networkidle');
  await page.clock.resume(); await page.waitForTimeout(3100); expect(reads).toBe(1);
  await expect(page.getByRole('heading', { name: 'This round expired.', exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'What’s happening?' })).toBeEnabled();
  await expect(page.getByRole('textbox', { name: 'What’s happening?' })).toHaveValue('A draft kept through a clock jump');
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0);
  expect((app.services.rounds as any).rounds.get(id).public.expiresAt).toBe(expiresAt);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId)).toBe(id);
  expect((app.services.rounds as any).rounds.size).toBe(1);
  if (action === 'guess') {
    await page.getByRole('button', { name: 'Send guess', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Play next take', exact: true })).toBeVisible();
  } else {
    await page.getByRole('button', { name: action === 'reveal' ? 'Reveal now' : 'Exit round', exact: true }).click();
    await expect(page.getByRole('heading', { name: action === 'reveal' ? 'The scene was meant to show…' : 'Thanks for playing.', exact: true })).toBeVisible();
  }
  expect((app.services.rounds as any).rounds.size).toBe(1);
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0);
});

for (const afterConfirmation of [false, true]) test(`a server-expired round stays expired ${afterConfirmation ? 'after a valid expiry confirmation' : 'on its first authoritative check'}`, async ({ page, app, operator }) => {
  await fixtureRound(page); await page.clock.install();
  await page.getByRole('button', { name: 'Play scene', exact: true }).click(); await page.clock.fastForward(10000);
  await page.getByRole('textbox', { name: 'What’s happening?' }).fill('An expired synthetic guess');
  const id = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId);
  if (!afterConfirmation) app.advance(30 * 60000);
  const read = page.waitForResponse(response => response.url().endsWith(`/api/rounds/${id}`) && response.status() === (afterConfirmation ? 200 : 410));
  await page.evaluate(() => { const original = Date.now; Date.now = () => original() + 60 * 60 * 1000; });
  await page.clock.runFor(1100); await read;
  if (afterConfirmation) {
    app.advance(30 * 60000);
    await page.getByRole('button', { name: 'Send guess', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: 'This round expired.', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Check result', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'This round expired.', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reveal now', exact: true })).toHaveCount(0);
  expect((app.services.rounds as any).rounds.size).toBe(1);
});

for (const late of [
  { action: 'guess', status: 200 }, { action: 'reveal', status: 200 },
  { action: 'guess', status: 410 }, { action: 'reveal', status: 410 },
  { action: 'expired', status: 200 }, { action: 'another', status: 503 },
] as const) test(`a delayed expiry ${late.status} cannot overwrite ${late.action}`, async ({ page, app, operator }) => {
  await fixtureRound(page); await page.clock.install();
  await page.getByRole('button', { name: 'Play scene', exact: true }).click(); await page.clock.fastForward(10000);
  await page.getByRole('textbox', { name: 'What’s happening?' }).fill('A guess sent while the expiry read is pending');
  const id = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId);
  let held = false, released = false; let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/rounds/${id}`, async route => {
    if (held) return released ? route.abort() : route.continue();
    const response = await route.fetch(); expect(response.status()).toBe(200); expect((await response.json()).revision).toBe(0);
    held = true; await gate; released = true;
    if (late.status === 200) await route.fulfill({ response, headers: { ...response.headers(), 'x-tm-held-expiry': 'true' } });
    else await route.fulfill({ status: late.status, headers: { 'x-tm-held-expiry': 'true' }, json: { error: late.status === 410 ? 'EXPIRED' : 'UNAVAILABLE', requestId: randomUUID() } });
  });
  try {
    await page.evaluate(() => { const original = Date.now; Date.now = () => original() + 60 * 60 * 1000; });
    await page.clock.runFor(1100); await expect.poll(() => held).toBe(true); await page.clock.resume();
    if (late.action === 'expired') app.advance(30 * 60000);
    if (late.action === 'guess' || late.action === 'expired') await page.getByRole('button', { name: 'Send guess', exact: true }).click();
    else await page.getByRole('button', { name: 'Reveal now', exact: true }).click();
    const expected = late.action === 'guess' ? page.getByRole('button', { name: 'Play next take', exact: true })
      : page.getByRole('heading', { name: late.action === 'expired' ? 'This round expired.' : 'The scene was meant to show…', exact: true });
    await expect(expected).toBeVisible();
    if (late.action === 'another') {
      await page.getByRole('button', { name: 'Another scene', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Take 1 of 2.', exact: true })).toBeVisible();
    }
    const delivered = page.waitForResponse(response => response.headers()['x-tm-held-expiry'] === 'true');
    release(); await (await delivered).finished(); await page.waitForTimeout(1000);
    if (late.action === 'another') {
      await expect(page.getByRole('heading', { name: 'Take 1 of 2.', exact: true })).toBeVisible();
      expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId)).not.toBe(id);
    } else await expect(expected).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0);
  } finally { release(); }
});

test('[R07] stale reveal refreshes once and never launches another job', async ({ page, app, operator }) => {
  await fixtureRound(page); const ids: string[] = [];
  await page.route('**/api/rounds/*/skip', async route => {
    ids.push(route.request().postDataJSON().requestId);
    if (ids.length === 1) { const r = (app.services.rounds as any).rounds.values().next().value; await app.services.rounds.submitGuess({ sessionId: r.ownerId }, r.public.roundId, { requestId: randomUUID(), revision: r.public.revision, attempt: 1, guess: 'Synthetic simultaneous answer' }); }
    await route.continue();
  });
  await page.getByRole('button', { name: 'Reveal now' }).click(); await expect(page.getByRole('heading', { name: 'The scene was meant to show…' })).toBeVisible();
  expect(ids).toHaveLength(2); expect(new Set(ids).size).toBe(2);
  await expect.poll(() => (app.services.rounds as any).jobs.size).toBe(0); expect((app.services.rounds as any).rounds.values().next().value.public.acts).toHaveLength(1);
});

test.describe('slow fixture preparation', () => {
  test.use({ fixtureDelayMs: 8000 });
  test('[L01] five seconds switches waiting copy without moving focus', async ({ page, app, operator }) => {
    await fixtureRound(page); await page.clock.install(); await page.getByRole('button', { name: 'Play scene', exact: true }).click(); await page.clock.fastForward(10000);
    await page.getByRole('textbox', { name: 'What’s happening?' }).fill('A synthetic answer'); const send = page.getByRole('button', { name: 'Send guess', exact: true }); await send.focus(); await send.press('Enter');
    await expect(page.getByRole('heading', { name: 'Thanks. Here’s another take.' })).toBeVisible(); await expect(page.getByRole('status')).toHaveText('Preparing the next performance…');
    await page.clock.fastForward(5001); await expect(page.getByRole('status')).toHaveText('Still preparing…'); await expect(page.getByRole('button', { name: 'Guess sent' })).toBeFocused();
    await page.getByRole('button', { name: 'Reveal now' }).click(); await expect(page.getByRole('heading', { name: 'The scene was meant to show…' })).toBeVisible();
  });
});

test.describe('Q99 Study clock authority', () => {
  test.beforeEach(async ({ page, operator }) => {
    await page.goto('/study'); await page.getByRole('button', { name: 'Start short synthetic study', exact: true }).click();
    await page.getByRole('button', { name: 'Start next round', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Take 1 of 2.', exact: true })).toBeVisible(); await page.clock.install();
    await page.getByRole('button', { name: 'Play scene', exact: true }).click(); await page.clock.fastForward(10000);
    await page.getByRole('textbox', { name: 'What’s happening?' }).fill('A synthetic Study draft kept through a clock jump');
  });

  for (const explicit of [false, true]) for (const action of ['guess', 'reveal', 'exit']) test(`${explicit ? 'explicit' : 'automatic'} confirmation preserves the same Study encounter for ${action}`, async ({ page, app }) => {
    const saved = await page.evaluate(() => ({ id: JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId, creation: sessionStorage.getItem('tm_creation') }));
    const expiresAt = (app.services.rounds as any).rounds.get(saved.id).public.expiresAt;
    let reads = 0; page.on('request', request => { if (request.url().endsWith(`/api/rounds/${saved.id}`) && request.method() === 'GET') reads++; });
    if (explicit) await page.route(`**/api/rounds/${saved.id}`, route => route.abort(), { times: 1 });
    const valid = page.waitForResponse(response => response.url().endsWith(`/api/rounds/${saved.id}`) && response.status() === 200);
    await page.evaluate(() => { const original = Date.now; Date.now = () => original() + 60 * 60 * 1000; }); await page.clock.runFor(1100);
    if (explicit) {
      await expect(page.getByText('Expiry could not be confirmed.', { exact: false })).toBeVisible();
      await page.getByRole('button', { name: 'Check result', exact: true }).click();
    }
    await (await valid).finished(); await page.clock.resume(); await page.waitForTimeout(3100);
    expect(reads).toBe(explicit ? 2 : 1);
    await expect(page.getByRole('heading', { name: 'This round expired.', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Continue study', exact: true })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'What’s happening?' })).toHaveValue('A synthetic Study draft kept through a clock jump');
    await expect(page.getByRole('textbox', { name: 'What’s happening?' })).toBeEnabled();
    expect((app.services.rounds as any).rounds.get(saved.id).public.expiresAt).toBe(expiresAt);
    expect(await page.evaluate(() => sessionStorage.getItem('tm_creation'))).toBe(saved.creation);
    await page.getByRole('button', { name: action === 'guess' ? 'Send guess' : action === 'reveal' ? 'Reveal now' : 'Exit round', exact: true }).click();
    if (action === 'guess') await expect(page.getByRole('button', { name: 'Play next take', exact: true })).toBeVisible();
    else if (action === 'reveal') await expect(page.getByRole('heading', { name: 'The scene was meant to show…', exact: true })).toBeVisible();
    else await expect(page.getByText('The round was stopped.', { exact: true })).toBeVisible();
    expect((app.services.rounds as any).rounds.get(saved.id).public.state).toBe(action === 'guess' ? 'awaiting_guess2' : action === 'reveal' ? 'revealed' : 'abandoned');
    expect((app.services.fixtureStudy.db.prepare('SELECT count(*) n FROM fixture_rounds').get() as any).n).toBe(1);
    expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId)).toBe(saved.id);
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0);
  });

  for (const accepted of [false, true]) test(`a held Study expiry read preserves ${accepted ? 'an accepted reveal' : 'an unrelated failed-guess error'}`, async ({ page, app }) => {
    const id = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId);
    let held = false, released = false; let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route(`**/api/rounds/${id}`, async route => {
      if (held) return released ? route.abort() : route.continue();
      const response = await route.fetch(); expect(response.status()).toBe(200); held = true; await gate; released = true;
      await route.fulfill({ response, headers: { ...response.headers(), 'x-tm-held-study-expiry': 'true' } });
    });
    try {
      if (!accepted) await page.route('**/api/rounds/*/guesses', route => route.abort(), { times: 1 });
      await page.evaluate(() => { const original = Date.now; Date.now = () => original() + 60 * 60 * 1000; });
      await page.clock.runFor(1100); await expect.poll(() => held).toBe(true); await page.clock.resume();
      await page.getByRole('button', { name: accepted ? 'Reveal now' : 'Send guess', exact: true }).click();
      const expected = accepted ? page.getByRole('heading', { name: 'The scene was meant to show…', exact: true }) : page.getByRole('alert').filter({ hasText: 'The local server could not be reached. Check the connection, then try again.' });
      await expect(expected).toBeVisible();
      const pending = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_mutation') ?? 'null'));
      const delivered = page.waitForResponse(response => response.headers()['x-tm-held-study-expiry'] === 'true');
      release(); await (await delivered).finished(); await page.waitForTimeout(1000);
      await expect(expected).toBeVisible();
      if (!accepted) expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_mutation')!))).toMatchObject({ requestId: pending.requestId, deadlineWallMs: pending.deadlineWallMs });
      await expect(page.getByRole('button', { name: 'Continue study', exact: true })).toHaveCount(0);
      expect((app.services.fixtureStudy.db.prepare('SELECT count(*) n FROM fixture_rounds').get() as any).n).toBe(1);
    } finally { release(); }
  });

  for (const outcome of ['unavailable', 'expired'] as const) test(`separate current terminal expiry ${outcome} preserves the authoritative Study outcome`, async ({ page, app }) => {
    const id = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId);
    let reads = 0, originalHeld = false, terminalHeld = 0;
    let releaseOriginal!: () => void, releaseTerminal!: () => void;
    const originalGate = new Promise<void>(resolve => { releaseOriginal = resolve; });
    const terminalGate = new Promise<void>(resolve => { releaseTerminal = resolve; });
    await page.route(`**/api/rounds/${id}`, async route => {
      if (++reads === 1) {
        const response = await route.fetch(); expect(response.status()).toBe(200); originalHeld = true;
        await originalGate; await route.fulfill({ response, headers: { ...response.headers(), 'x-tm-original-terminal-expiry': 'true' } });
      } else {
        terminalHeld++; await terminalGate;
        if (outcome === 'unavailable') await route.abort();
        else { const response = await route.fetch(); expect(response.status()).toBe(410); await route.fulfill({ response }); }
      }
    });
    try {
      await page.evaluate(() => { const original = Date.now; Date.now = () => original() + 60 * 60 * 1000; });
      await page.clock.runFor(1100); await expect.poll(() => originalHeld).toBe(true); await page.clock.resume();
      await page.getByRole('button', { name: 'Reveal now', exact: true }).click();
      const reveal = page.getByRole('heading', { name: 'The scene was meant to show…', exact: true });
      const feedback = page.getByRole('button', { name: 'Save feedback and continue', exact: true });
      await expect(reveal).toBeVisible(); await expect(feedback).toBeEnabled(); await expect.poll(() => terminalHeld).toBeGreaterThan(0);
      const target = await page.locator('.play > .intro').innerText();
      const accepted = (app.services.rounds as any).rounds.get(id).public;
      expect(accepted.state).toBe('revealed');
      const originalDelivered = page.waitForResponse(response => response.headers()['x-tm-original-terminal-expiry'] === 'true');
      if (outcome === 'unavailable') {
        releaseOriginal(); await (await originalDelivered).finished();
        const failed = page.waitForEvent('requestfailed', { predicate: request => request.url().endsWith(`/api/rounds/${id}`) });
        releaseTerminal(); await failed; await page.waitForTimeout(1000);
        await expect(reveal).toBeVisible(); await expect(feedback).toBeEnabled();
        await expect(page.locator('.play > .intro')).toHaveText(target);
        await expect(page.getByRole('heading', { name: 'This round expired.', exact: true })).toHaveCount(0);
        await expect(page.getByText('Expiry could not be confirmed.', { exact: false })).toHaveCount(0);
        expect((app.services.rounds as any).rounds.get(id).public.revision).toBe(accepted.revision);
      } else {
        app.advance(30 * 60000);
        const expired = page.waitForResponse(response => response.url().endsWith(`/api/rounds/${id}`) && response.status() === 410);
        releaseTerminal(); await (await expired).finished();
        await expect(page.getByRole('heading', { name: 'This round expired.', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Continue study', exact: true })).toBeEnabled();
        releaseOriginal(); await (await originalDelivered).finished(); await page.waitForTimeout(1000);
        await expect(page.getByRole('heading', { name: 'This round expired.', exact: true })).toBeVisible(); await expect(reveal).toHaveCount(0);
      }
      expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId)).toBe(id);
      expect((app.services.fixtureStudy.db.prepare('SELECT count(*) n FROM fixture_rounds').get() as any).n).toBe(1);
    } finally { releaseOriginal(); releaseTerminal(); }
  });

  for (const afterConfirmation of [false, true]) test(`true Study expiry ${afterConfirmation ? 'after' : 'before'} a valid confirmation requires authoritative continuation`, async ({ page, app }) => {
    const id = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId);
    if (!afterConfirmation) app.advance(30 * 60000);
    const read = page.waitForResponse(response => response.url().endsWith(`/api/rounds/${id}`) && response.status() === (afterConfirmation ? 200 : 410));
    await page.evaluate(() => { const original = Date.now; Date.now = () => original() + 60 * 60 * 1000; }); await page.clock.runFor(1100); await (await read).finished();
    if (afterConfirmation) {
      await expect(page.getByRole('button', { name: 'Continue study', exact: true })).toHaveCount(0);
      app.advance(30 * 60000); await page.getByRole('button', { name: 'Send guess', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'This round expired.', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Check result', exact: true }).click();
    }
    await expect(page.getByRole('button', { name: 'Continue study', exact: true })).toBeEnabled();
    await expect(page.getByText('Unsent draft: A synthetic Study draft kept through a clock jump', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Continue study', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Start next round', exact: true })).toBeVisible();
    expect((app.services.fixtureStudy.db.prepare('SELECT count(*) n FROM fixture_rounds').get() as any).n).toBe(1);
  });

  test('an offline Study expiry hold restores only its server-valid encounter after reconnect', async ({ page, context, app }) => {
    const id = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId);
    await context.setOffline(true); await page.evaluate(() => { const original = Date.now; Date.now = () => original() + 60 * 60 * 1000; }); await page.clock.runFor(1100);
    await expect(page.getByRole('button', { name: 'Check result', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Continue study', exact: true })).toHaveCount(0);
    const restored = page.waitForResponse(response => response.url().endsWith(`/api/rounds/${id}`) && response.status() === 200);
    await context.setOffline(false); await (await restored).finished();
    await expect(page.getByRole('textbox', { name: 'What’s happening?' })).toBeEnabled();
    await expect(page.getByText('Expiry could not be confirmed.', { exact: false })).toHaveCount(0);
    await page.getByRole('button', { name: 'Reveal now', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'The scene was meant to show…', exact: true })).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('tm_recovery')!).roundId)).toBe(id);
    expect((app.services.fixtureStudy.db.prepare('SELECT count(*) n FROM fixture_rounds').get() as any).n).toBe(1);
  });
});
