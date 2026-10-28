import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { test, expect } from '../support/browser-fixtures.js';

for (const mode of ['headers', 'body']) test(`stalled study download ${mode} times out and restores controls`, async ({ page, app, operator }) => {
  app.services.fixtureStudy.createRehearsal('synthetic-owner', { requestId: randomUUID(), fixtureScheduleId: 'synthetic_short_v1' });
  const run = app.services.fixtureStudy.listRuns()[0]!.studyRunId;
  await page.goto('/study'); await page.getByText('Restricted study exports and local commands', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Study run ID' }).selectOption(run); await page.clock.install();
  let held = false; const original = app.server.listeners('request')[0] as (req: IncomingMessage, res: ServerResponse) => void;
  app.server.removeListener('request', original);
  app.server.on('request', (req, res) => { if (req.method === 'GET' && req.url?.startsWith('/api/operator/exports/')) { held = true; if (mode === 'body') { res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Length': '10000' }); res.write('partial'); } } else original(req, res); });
  await page.getByRole('button', { name: 'Download restricted export' }).click(); await expect.poll(() => held).toBe(true);
  await expect(page.getByRole('button', { name: 'Download restricted export' })).toBeDisabled(); await page.clock.fastForward(10010);
  await expect(page.getByRole('status')).toContainText('Export is unavailable.'); await expect(page.getByRole('button', { name: 'Download restricted export' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Start short synthetic study' })).toBeEnabled();
});
