import { test, expect } from '../support/browser-fixtures.js';
test.use({ development: true });
test('development modules render without exposing server or source pack', async ({ page, operator }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const failedRequests: { path: string; status: number }[] = [], viteClientRequests: string[] = [];
  page.on('response', response => { if (response.status() >= 400) failedRequests.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  page.on('request', request => { if (new URL(request.url()).pathname === '/@vite/client') viteClientRequests.push('/@vite/client'); });
  let sockets = 0; page.on('websocket', () => sockets++);
  await page.addInitScript(() => { (window as any).policyViolations = []; document.addEventListener('securitypolicyviolation', event => (window as any).policyViolations.push(event.effectiveDirective)); });
  try {
  await page.goto('/rehearsal'); await expect(page.locator('svg.stage')).toBeVisible();
  expect(await page.locator('button.primary').evaluate(node => getComputedStyle(node).minHeight)).toBe('48px');
  await page.getByRole('button', { name: 'Play', exact: true }).click(); await expect.poll(async () => Number(await page.locator('input[type=range]').inputValue())).toBeGreaterThan(100);
  await page.getByRole('button', { name: 'Versions', exact: true }).click();
  await page.getByText('Back up or restore saved work', { exact: true }).click();
  await expect(page.locator('.workspace-restore')).toBeVisible();
  await expect(page.locator('.workspace-restore')).toHaveCSS('display', 'flex');
  await expect(page.locator('.workspace-restore')).toHaveCSS('flex-wrap', 'wrap');
  for (const path of ['/@id/src/server/targets/meanings.json?import', '/@fs/src/server/targets/meanings.json', '/src/server/targets/meanings.json', '/Tiny_Mime_Review_Source_Pack/chapters/02_technical_spec.md']) expect((await page.request.get(path)).status()).toBe(404);
  expect(errors).toEqual([]);
  expect(viteClientRequests).toEqual([]);
  expect(sockets).toBe(0); expect(await page.evaluate(() => (window as any).policyViolations)).toEqual([]);
  } finally { await info.attach('development-diagnostics', { body: JSON.stringify({ errors, failedRequests, viteClientRequests }), contentType: 'application/json' }); }
});
