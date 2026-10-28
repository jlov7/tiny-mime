import { randomUUID } from 'node:crypto';
import { test, expect } from '../support/browser-fixtures.js';

test('an unauthenticated withdrawal retries failed session setup before dispatch', async ({ page, app }) => {
  const owner = randomUUID(), service = app.services.fixtureStudy;
  const study = service.createRehearsal(owner, { requestId: randomUUID(), fixtureScheduleId: 'synthetic_short_v1' });
  const code = service.progress(owner, study.studySessionId).withdrawalCode;
  const bodies: unknown[] = []; let setups = 0;
  page.on('request', request => {
    if (request.url().endsWith('/api/session') && request.method() === 'POST') setups++;
    if (request.url().endsWith('/api/study-withdrawals')) bodies.push(request.postDataJSON());
  });
  await page.goto('/study'); await page.getByText('Withdraw local study records', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Withdrawal code', exact: true }).fill(code);
  await page.route('**/api/session', route => route.abort(), { times: 1 });
  await page.getByRole('button', { name: 'Delete my linked study records', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry same withdrawal', exact: true })).toBeVisible();
  expect(bodies).toEqual([]); expect(setups).toBe(1);
  await page.getByRole('button', { name: 'Retry same withdrawal', exact: true }).click();
  await expect(page.getByText('Linked local study records were deleted.', { exact: false })).toBeVisible();
  expect(setups).toBe(2); expect(bodies).toEqual([{ requestId: expect.any(String), withdrawalCode: code, expectedRecoveryOwnerId: expect.any(String) }]);
  expect(() => service.progress(owner, study.studySessionId)).toThrow();
});
