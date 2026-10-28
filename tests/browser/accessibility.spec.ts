import { browserArtifact } from '../support/browser-artifacts.js';
import { writeFileSync } from 'node:fs';
import { test, expect } from '../support/browser-fixtures.js';

test('computed contrast, control targets and landscape layout meet local UI checks', async ({ page, operator }, info) => {
  await page.goto('/rehearsal'); await page.getByRole('combobox', { name: 'Scene', exact: true }).selectOption('TM04'); await expect(page.locator('[data-actor]')).toHaveCount(3);
  const checks = await page.evaluate(() => {
    const lum = (rgb: string) => { const c = rgb.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return c[0] * .2126 + c[1] * .7152 + c[2] * .0722; };
    const contrast = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
    const body = getComputedStyle(document.body), primary = getComputedStyle(document.querySelector('button.primary')!), secondary = getComputedStyle(document.querySelector('.secondary')!), plain = getComputedStyle([...document.querySelectorAll('button')].find(b => b.textContent === 'Reset')!), input = getComputedStyle(document.querySelector('select')!), stage = getComputedStyle(document.querySelector('svg.stage')!);
    return { text: { body: contrast(body.color, body.backgroundColor === 'rgba(0, 0, 0, 0)' ? getComputedStyle(document.documentElement).backgroundColor : body.backgroundColor), secondary: contrast(secondary.color, getComputedStyle(document.documentElement).backgroundColor), primary: contrast(primary.color, primary.backgroundColor) }, nontext: { button: contrast(plain.borderColor, getComputedStyle(document.documentElement).backgroundColor), input: contrast(input.borderColor, input.backgroundColor), ...Object.fromEntries([...document.querySelectorAll('[data-actor]')].map(a => [a.getAttribute('data-actor')!, contrast(getComputedStyle(a).fill, stage.backgroundColor)])) }, targets: [...document.querySelectorAll('button,select')].filter(n => n.getBoundingClientRect().height).map(n => ({ width: n.getBoundingClientRect().width, height: n.getBoundingClientRect().height })) };
  });
  for (const ratio of Object.values(checks.text)) expect(ratio).toBeGreaterThanOrEqual(4.5);
  for (const ratio of Object.values(checks.nontext)) expect(ratio).toBeGreaterThanOrEqual(3);
  for (const target of checks.targets) { expect(target.width).toBeGreaterThanOrEqual(44); expect(target.height).toBeGreaterThanOrEqual(44); }
  await page.setViewportSize({ width: 844, height: 390 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  let forcedColors = 'PASS'; try { await page.emulateMedia({ forcedColors: 'active' }); await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible(); } catch (error) { if (!String(error).includes('not supported')) throw error; forcedColors = 'UNAVAILABLE in this browser engine'; }
  writeFileSync(browserArtifact(`${info.project.name}-accessibility.json`), JSON.stringify({ browser: info.project.name, checks, landscape: { width: 844, height: 390 }, forcedColors, assistiveTechnology: 'NOT RUN', physicalDevices: 'NOT RUN' }, null, 2));
});
