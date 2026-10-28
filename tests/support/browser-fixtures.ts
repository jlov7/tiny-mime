import { test as base, expect, type Page } from '@playwright/test';
import { startServer, ORIGIN } from '../../src/server/http.js';

type App = Awaited<ReturnType<typeof startServer>> & { secret: () => string; advance: (ms: number) => void };
export const test = base.extend<{ app: App; operator: void; fixtureDelayMs: number; development: boolean }>({
  fixtureDelayMs: [650, { option: true }],
  development: [false, { option: true }],
  app: async ({ fixtureDelayMs, development }, use) => {
    let secret = ''; let offset = 0;
    const server = await startServer({ memory: true, development, onLaunchSecret: value => { secret = value; }, fixtureDelayMs, nowWall: () => Date.now() + offset, nowMono: () => performance.now() + offset });
    try { await use({ ...server, secret: () => secret, advance: ms => { offset += ms; } }); } finally { await server.stop(); }
  },
  operator: async ({ app, context }, use) => {
    const session = await context.request.post('/api/session', { data: {}, headers: { Origin: ORIGIN } }); expect(session.status()).toBe(200);
    const bootstrap = await context.request.post('/api/operator/bootstrap', { data: { launchSecret: app.secret() }, headers: { Origin: ORIGIN } }); expect(bootstrap.status()).toBe(200);
    await use();
  },
});
export { expect };
export async function fixtureRound(page: Page) {
  await page.goto('/play'); await page.getByRole('button', { name: 'Try a fixture round', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Take 1 of 2.' })).toBeVisible();
}
export async function firstGuess(page: Page, text = 'One shape follows the other.') {
  await page.getByRole('button', { name: 'Play scene', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'What’s happening?' })).toBeEnabled({ timeout: 12000 });
  await page.getByRole('textbox', { name: 'What’s happening?' }).fill(text);
  await page.getByRole('button', { name: 'Send guess', exact: true }).click();
}
export async function secondGuess(page: Page, text = 'The shapes are taking turns.') {
  await expect(page.getByRole('button', { name: 'Play next take', exact: true })).toBeVisible({ timeout: 12000 });
  await page.getByRole('button', { name: 'Play next take', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'What do you think now?' })).toBeEnabled({ timeout: 12000 });
  await page.getByRole('textbox', { name: 'What do you think now?' }).fill(text);
  await page.getByRole('button', { name: 'Send final guess', exact: true }).click();
}
