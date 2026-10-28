import { browserArtifact } from '../support/browser-artifacts.js';
import { test, expect, fixtureRound, firstGuess, secondGuess } from '../support/browser-fixtures.js';

test('plays_full_two_guess_round with stable focus, same-hash second act and literal reveal', async ({ page, app, operator }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); const external: string[] = [];
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:4317')) external.push(request.url()); });
  await fixtureRound(page); await page.screenshot({ path: browserArtifact(`${info.project.name}-ready-desktop.png`), fullPage: true });
  const before = await page.locator('[data-actor="a"]').getAttribute('transform');
  await page.getByRole('button', { name: 'Play scene', exact: true }).click();
  await expect.poll(() => page.locator('[data-actor="a"]').getAttribute('transform')).not.toBe(before);
  await expect(page.getByRole('textbox', { name: 'What’s happening?' })).toBeEnabled({ timeout: 12000 });
  await page.getByRole('textbox', { name: 'What’s happening?' }).fill('Following each other.');
  const send = page.getByRole('button', { name: 'Send guess', exact: true }); await send.focus();
  await send.evaluate(node => { (node as HTMLElement).dataset.identity = 'accepted-send'; }); await send.press('Enter');
  await expect(page.locator('[data-identity="accepted-send"]')).toHaveText('Guess sent');
  await expect(page.locator('[data-identity="accepted-send"]')).toBeFocused();
  await secondGuess(page, '</script><img src=https://example.invalid/x onerror=alert(1)>');
  await expect(page.getByRole('heading', { name: 'The scene was meant to show…' })).toBeFocused();
  await expect(page.getByText('</script><img src=https://example.invalid/x onerror=alert(1)>', { exact: true })).toBeVisible();
  await expect(page.locator('.stage img')).toHaveCount(0); expect(errors).toEqual([]); expect(external).toEqual([]);
  const storage = await page.evaluate(() => Object.fromEntries(Object.entries(sessionStorage))); expect(JSON.stringify(storage)).not.toMatch(/Following|onerror|target|score|model|secret/);
  expect(app.services.ledger.status().reservedUnknownMicroUsd).toBe(0);
  await page.screenshot({ path: browserArtifact(`${info.project.name}-reveal-desktop.png`), fullPage: true });
});

test('early reveal never offers a nonexistent second take', async ({ page, app, operator }) => {
  await fixtureRound(page); await page.getByRole('button', { name: 'Reveal now', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'The scene was meant to show…' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Watch take 2 again' })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Play both takes' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Another scene' }).click(); await expect(page.getByRole('heading', { name: 'Take 1 of 2.' })).toBeVisible();
});

test('replay_preserves_guess_slot, IME never submits, offline text stays unsent', async ({ page, context, app, operator }) => {
  await fixtureRound(page); await page.getByRole('button', { name: 'Play scene', exact: true }).click(); const field = page.getByRole('textbox', { name: 'What’s happening?' });
  await expect(field).toBeEnabled({ timeout: 12000 }); await field.fill('They are moving together');
  await page.getByRole('button', { name: 'Replay take 1' }).click(); await expect(field).toHaveValue('They are moving together'); await page.getByRole('button', { name: 'Pause', exact: true }).click(); await expect(field).toBeEnabled();
  await field.dispatchEvent('compositionstart'); await field.press('Enter'); await field.dispatchEvent('compositionend');
  await expect(page.getByRole('heading', { name: 'What’s happening?' })).toBeVisible();
  await context.setOffline(true); await expect(page.getByRole('button', { name: 'Send guess', exact: true })).toHaveAttribute('aria-disabled', 'true');
  await page.getByRole('button', { name: 'Send guess', exact: true }).dispatchEvent('click');
  expect(await page.evaluate(() => sessionStorage.getItem('tm_mutation'))).toBeNull(); await expect(field).toHaveValue('They are moving together');
  await context.setOffline(false); await page.getByRole('button', { name: 'Send guess', exact: true }).click(); await expect(page.getByRole('button', { name: 'Play next take', exact: true })).toBeVisible();
});
