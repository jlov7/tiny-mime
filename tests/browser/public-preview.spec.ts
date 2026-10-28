import { expect, test } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildPublicPreview } from '../../src/server/operator/publicPreview.js';
import { listShowcases } from '../../src/server/operator/showcase.js';
import { sampleScore } from '../../src/shared/sampleScore.js';

let directory: string, url: string;
test.beforeAll(() => {
  mkdirSync(resolve('.scratch'), { recursive: true });
  directory = mkdtempSync(resolve('.scratch/public-preview-browser-'));
  const file = join(directory, 'tiny-mime-preview.html');
  writeFileSync(file, buildPublicPreview().html);
  url = pathToFileURL(file).href;
});
test.afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

async function scrub(page: import('@playwright/test').Page, time: number) {
  await page.locator('#scrub').evaluate((input: HTMLInputElement, value) => { input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true })); }, time);
}

test('offline typography loads its embedded face without external requests or CSP violations', async ({ page, context }) => {
  const external: string[] = [], violations: string[] = [];
  page.on('request', request => { if (!/^(file:|data:)/u.test(request.url())) external.push(request.url()); });
  await page.addInitScript(() => { (window as unknown as { fontViolations: string[] }).fontViolations = []; document.addEventListener('securitypolicyviolation', event => { (window as unknown as { fontViolations: string[] }).fontViolations.push(event.violatedDirective); }); });
  await context.setOffline(true); await page.goto(url);
  expect(await page.evaluate(async () => {
    await document.fonts.ready;
    const loaded = await document.fonts.load('650 40px "Bricolage Grotesque"', 'A matter of timing.');
    return loaded.length > 0 && loaded.every(face => face.status === 'loaded') && getComputedStyle(document.querySelector('h1')!).fontFamily.replaceAll('"', '').startsWith('Bricolage Grotesque');
  })).toBe(true);
  violations.push(...await page.evaluate(() => (window as unknown as { fontViolations: string[] }).fontViolations));
  expect(external).toEqual([]); expect(violations).toEqual([]);
});

test('offline completion preserves transport focus and promotes reflection without autoplay', async ({ page, context }) => {
  await context.setOffline(true); await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.goto(url);
  await expect(page.locator('.encounter-progress [aria-current=step]')).toHaveText('First take');
  await page.locator('#encounter-play').click(); await expect(page.locator('#encounter-status')).toHaveText('Playing');
  await page.locator('#encounter-tools summary').click();
  await expect(page.locator('#encounter-status')).toHaveText('Paused');
  const end = Number(await page.locator('#encounter-scrub').getAttribute('max'));
  await page.locator('#encounter-scrub').evaluate((input: HTMLInputElement, time) => { input.value=String(time); input.dispatchEvent(new Event('input')); }, end - 60);
  const transport = page.locator('#encounter-play'); await transport.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#encounter-status')).toHaveText('Finished'); await expect(transport).toBeFocused();
  await expect(transport).not.toHaveClass(/primary/u); await expect(page.locator('#encounter-reflect')).toHaveClass(/primary/u);
  await page.keyboard.press('Tab'); await expect(page.locator('#encounter-reflect')).toBeFocused(); await page.keyboard.press('Enter');
  await expect(page.locator('.encounter-progress [aria-current=step]')).toHaveText('Reflect');
  await page.locator('#encounter-continue').click(); await expect(page.locator('.encounter-progress [aria-current=step]')).toHaveText('Second take');
  await expect(page.locator('#encounter-status')).toHaveText('Paused');
});

test('opens from disk offline, samples all three exact authored pairs and clamps the shorter clip', async ({ page, context }, info) => {
  const errors: string[] = [], remote: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!request.url().startsWith('file:')) remote.push(request.url()); });
  await context.setOffline(true); await page.goto(url); await page.locator('#inspect').click();
  await expect(page.locator('#status')).toHaveText('Paused');
  await expect(page.getByRole('timer', { name: 'Playback position' })).toHaveAttribute('aria-live', 'off');
  await expect(page.locator('#notes')).toBeHidden();
  await page.getByText('Frame and key controls', { exact: true }).click();
  for (const [index, pair] of listShowcases().entries()) {
    await page.locator('.example').nth(index).click(); await page.locator('#inspect').click();
    await expect(page.locator('#scene-title')).toHaveText('Scene ' + (index + 1));
    await expect(page.locator('#interpretation')).toBeHidden();
    await page.getByRole('button', { name: 'Reveal intention and notes', exact: true }).click();
    await expect(page.locator('#interpretation')).toHaveText(pair.exampleGuess); await expect(page.locator('#intention')).toHaveText(pair.intention); await expect(page.locator('#explanation')).toContainText(pair.explanation);
    await page.getByRole('button', { name: 'Hide intention and notes', exact: true }).click();
    const times = [...new Set([pair.left, pair.right].flatMap(clip => clip.score.actors.flatMap(actor => actor.keyframes.map(key => key.tMs))))].sort((a, b) => a - b);
    for (const time of times) {
      await scrub(page, time);
      for (const [id, clip] of [['original', pair.left], ['alternate', pair.right]] as const) {
        expect(await page.locator('#' + id).getAttribute('data-time')).toBe(String(Math.min(time, clip.score.durationMs)));
        expect(await page.locator('#' + id + ' > *').evaluateAll(shapes => shapes.map(shape => shape.getAttribute('transform')))).toEqual(sampleScore(clip.score, time).map(frame => `translate(${frame.x} ${frame.y}) rotate(${frame.rotationDeg}) scale(${frame.scaleX} ${frame.scaleY})`));
      }
    }
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(page.locator('#scrub')).toHaveValue('0');
    await page.getByRole('button', { name: 'Next keyframe', exact: true }).click();
    await expect(page.locator('#scrub')).toHaveValue(String(times[1]));
    await page.getByRole('button', { name: 'Previous keyframe', exact: true }).click();
    await expect(page.locator('#scrub')).toHaveValue('0');
  }
  await page.locator('.example').first().click(); await page.locator('#inspect').click();
  await page.screenshot({ path: info.outputPath('offline-preview-desktop.png'), fullPage: true });
  expect(errors).toEqual([]); expect(remote).toEqual([]);
});

test('reduced motion, keyboard, explicit notes and 390/320 reflow remain usable', async ({ page, context }, info) => {
  await context.setOffline(true); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto(url); await page.locator('#inspect').click();
  await expect(page.locator('#motion')).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Next keyframe', exact: true })).toBeVisible();
  await page.locator('h1').click(); await page.keyboard.press('Space');
  const firstTime = await page.locator('#scrub').inputValue(); expect(Number(firstTime)).toBeGreaterThan(0);
  await expect(page.locator('#status')).toHaveText('Paused');
  await page.keyboard.press('ArrowRight'); expect(Number(await page.locator('#scrub').inputValue())).toBeGreaterThan(Number(firstTime));
  await page.keyboard.press('Home'); await expect(page.locator('#scrub')).toHaveValue('0');
  await page.keyboard.press('End'); await expect(page.locator('#next')).toBeDisabled();
  await page.getByRole('button', { name: 'Replay frames', exact: true }).click(); await expect(page.locator('#scrub')).toHaveValue('0'); await expect(page.locator('#status')).toHaveText('Paused');
  const inspection = page.getByText('Frame and key controls', { exact: true }); await inspection.focus(); await page.keyboard.press('Space'); await expect(inspection.locator('..')).toHaveAttribute('open', ''); await expect(page.locator('#scrub')).toHaveValue('0'); await page.keyboard.press('Space'); await expect(inspection.locator('..')).not.toHaveAttribute('open', '');
  await page.getByRole('button', { name: 'Reveal intention and notes', exact: true }).focus();
  await page.keyboard.press('Enter'); await expect(page.locator('#notes')).toBeVisible();
  await expect(page.locator('#intention')).toHaveText(listShowcases()[0]!.intention);
  await page.locator('.example').nth(1).click(); await expect(page.locator('#notes')).toBeHidden();
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(url); await page.locator('#inspect').click();
    await expect(page.locator('#play')).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width <= 390) {
      await expect(page.locator('#alternate')).toBeHidden(); await expect(page.locator('#original')).toBeVisible();
      const time = await page.locator('#scrub').inputValue(); await page.locator('#show-alternate').click();
      await expect(page.locator('#original')).toBeHidden(); await expect(page.locator('#alternate')).toBeVisible();
      await expect(page.locator('#scrub')).toHaveValue(time); await expect(page.locator('#status')).toHaveText('Paused');
      await expect(page.locator('#show-alternate')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('#alternate')).toBeInViewport({ ratio: 1 }); await expect(page.locator('#show-original')).toBeInViewport({ ratio: 1 }); await expect(page.locator('#scrub')).toBeInViewport({ ratio: 1 }); await expect(page.locator('#reveal')).toBeInViewport({ ratio: 1 });
      expect((await page.locator('#alternate').boundingBox())!.width).toBeCloseTo(width - 32);
    } else { await expect(page.locator('#original')).toBeVisible(); await expect(page.locator('#alternate')).toBeVisible(); }
    await page.getByText('Frame and key controls', { exact: true }).click();
    for (const id of ['play', 'reset', 'next', 'motion', 'scrub', 'reveal']) {
      const box = (await page.locator('#' + id).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    await page.getByText('Frame and key controls', { exact: true }).click();
    await page.screenshot({ path: info.outputPath(`offline-preview-${width}.png`), fullPage: true });
  }
});

test('explicit full motion pauses, stops at the end, honors hiding and blocks connections', async ({ page, context }) => {
  await context.setOffline(true); await page.goto(url); await page.locator('#inspect').click();
  await page.getByText('Frame and key controls', { exact: true }).click(); await page.locator('#motion').check();
  await page.getByRole('button', { name: 'Play pair', exact: true }).click();
  await expect.poll(async () => Number(await page.locator('#scrub').inputValue())).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Paused');
  const paused = await page.locator('#scrub').inputValue();
  await expect(page.locator('#scrub')).toHaveValue(paused);
  await page.getByRole('button', { name: 'Play pair', exact: true }).click();
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.locator('#status')).toHaveText('Paused');
  await page.evaluate(() => { delete (document as unknown as { hidden?: boolean }).hidden; });
  const end = Number(await page.locator('#scrub').getAttribute('max'));
  await scrub(page, end - 50); await page.getByRole('button', { name: 'Play pair', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Finished'); await expect(page.locator('#scrub')).toHaveValue(String(end));
  await page.getByRole('button', { name: 'Replay pair', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Playing');
  await page.keyboard.press('Escape'); await expect(page.locator('#status')).toHaveText('Paused');
  expect(Number(await page.locator('#scrub').inputValue())).toBeLessThan(end);
  const blocked = await page.evaluate(async () => { try { await fetch('https://example.invalid/preview-test'); return false; } catch { return true; } });
  expect(blocked).toBe(true);
});


test('desktop encounter keeps task, both takes and reveal together at 720px height', async ({ page, context }, info) => {
  await context.setOffline(true); await page.setViewportSize({ width: 1280, height: 720 }); await page.goto(url); await page.locator('#inspect').click();
  await expect(page.getByText('Watch the first take. Think, then see the second.', { exact: true })).toBeInViewport({ ratio: 1 });
  for (const id of ['original', 'alternate', 'scrub', 'reveal']) await expect(page.locator('#' + id)).toBeInViewport({ ratio: 1 });
  await expect(page.locator('figcaption strong').first()).toHaveText('First take'); await expect(page.locator('figcaption strong').last()).toHaveText('Second take');
  await page.screenshot({ path: info.outputPath('offline-preview-720.png'), fullPage: true });
});

test('offline completion distinguishes replay from pause and revealing notes pauses motion', async ({ page, context }) => {
  await context.setOffline(true); await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.goto(url); await page.locator('#inspect').click();
  const end = Number(await page.locator('#scrub').getAttribute('max')); await scrub(page, end - 60); await page.locator('#play').click();
  await expect(page.locator('#status')).toHaveText('Finished'); await expect(page.locator('#play')).toHaveText('Replay pair');
  await page.locator('#play').click(); await expect(page.locator('#status')).toHaveText('Playing');
  await page.locator('#reveal').click(); await expect(page.locator('#status')).toHaveText('Paused'); await expect(page.locator('#notes')).toBeVisible();
  await page.getByText('Frame and key controls', { exact: true }).click(); await page.locator('#motion').uncheck();
  await expect(page.locator('#play')).toHaveText('Next keyframe');
  await page.setViewportSize({ width: 390, height: 844 }); await page.reload(); await page.locator('#inspect').click();
  await expect(page.getByText('Same moment. Switching pauses.', { exact: true })).toBeVisible();
});


test('offline first encounters use each take independently, reveal explicitly and finish all three scenes', async ({ page, context }) => {
  await context.setOffline(true); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto(url);
  const before = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));
  for (const [index, pair] of listShowcases().entries()) {
    await expect(page.locator('#encounter-title')).toHaveText('Authored first take'); await expect(page.locator('#encounter-stage')).toHaveAttribute('data-time', '0');
    await expect(page.locator('#notes')).toBeHidden();
    for (const [take, clip] of [pair.left, pair.right].entries()) {
      for (const time of [...new Set(clip.score.actors.flatMap(a => a.keyframes.map(k => k.tMs)))].filter(t=>t>0).sort((a,b)=>a-b)) {
        await page.locator('#encounter-play').click(); await expect(page.locator('#encounter-stage')).toHaveAttribute('data-time', String(time));
        expect(await page.locator('#encounter-stage > *').evaluateAll(shapes=>shapes.map(shape=>shape.getAttribute('transform')))).toEqual(sampleScore(clip.score,time).map(f=>'translate('+f.x+' '+f.y+') rotate('+f.rotationDeg+') scale('+f.scaleX+' '+f.scaleY+')'));
      }
      await expect(page.locator('#encounter-status')).toHaveText('Finished'); await expect(page.locator('#encounter-play')).toHaveText('Replay frames');
      await page.locator('#encounter-play').click(); await expect(page.locator('#encounter-stage')).toHaveAttribute('data-time', '0');
      if (take === 0) { await page.locator('#encounter-reflect').click(); await expect(page.locator('#reflection')).toBeVisible(); await page.locator('#encounter-continue').click(); await expect(page.locator('#encounter-title')).toHaveText('Authored second take'); await expect(page.locator('#encounter-stage')).toHaveAttribute('data-time', '0'); await expect(page.locator('#encounter-status')).toHaveText('Paused'); }
    }
    await page.locator('#encounter-notes').click(); await expect(page.locator('#written-notes-title')).toBeFocused(); await expect(page.locator('#intention')).toHaveText(pair.intention); await expect(page.locator('#notes')).toBeVisible();
    await page.locator(index < 2 ? '#encounter-next' : '#encounter-finish').click();
  }
  await expect(page.locator('#encounter-title')).toHaveText('Finished for now.'); await page.locator('#encounter-return').click(); await expect(page.locator('#encounter-stage')).toHaveAttribute('data-time', '0'); await expect(page.locator('#notes')).toBeHidden();
  expect(await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }))).toEqual(before);
});

for (const width of [1280, 390, 320]) test('offline sequential encounter fits at ' + width, async ({ page, context }, info) => {
  await context.setOffline(true); await page.setViewportSize({ width, height: width === 1280 ? 720 : 844 }); await page.goto(url);
  for (const id of ['encounter-stage', 'encounter-play', 'encounter-reflect', 'encounter-reveal']) await expect(page.locator('#' + id)).toBeInViewport({ ratio: 1 });
  if (width < 700) expect((await page.locator('#encounter-stage').boundingBox())!.width).toBeCloseTo(width - 32);
  await page.screenshot({ path: info.outputPath('sequential-first-preview-' + width + '.png'), fullPage: true });
  await page.locator('#encounter-reflect').click(); for (const id of ['encounter-stage', 'encounter-continue', 'encounter-reveal']) await expect(page.locator('#'+id)).toBeInViewport({ratio:1});
  await page.locator('#encounter-continue').click(); await expect(page.locator('#encounter-stage')).toHaveAttribute('data-time', '0'); await expect(page.locator('#encounter-status')).toHaveText('Paused');
  await expect(page.locator('#encounter-notes')).toBeInViewport({ ratio: 1 }); await page.screenshot({path:info.outputPath('sequential-preview-'+width+'.png'),fullPage:true});
});

test('offline reveal, inspection, restoration and selection stay paused with full-motion replay available', async ({ page, context }) => {
  await context.setOffline(true); await page.emulateMedia({reducedMotion:'no-preference'}); await page.goto(url);
  await page.locator('#encounter-tools summary').click(); const end = Number(await page.locator('#encounter-scrub').getAttribute('max'));
  await page.locator('#encounter-scrub').evaluate((input:HTMLInputElement,time)=>{input.value=String(time);input.dispatchEvent(new Event('input'));},end-60);
  await page.locator('#encounter-play').click(); await expect(page.locator('#encounter-status')).toHaveText('Finished'); await page.locator('#encounter-play').click(); await expect(page.locator('#encounter-status')).toHaveText('Playing');
  await page.locator('#encounter-reflect').click(); await expect(page.locator('#encounter-status')).toHaveText('Paused'); await page.locator('#encounter-continue').click(); await expect(page.locator('#encounter-stage')).toHaveAttribute('data-time','0');
  await page.locator('#encounter-play').click(); await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  await page.evaluate(()=>{delete (document as unknown as {hidden?:boolean}).hidden;document.dispatchEvent(new Event('visibilitychange'));}); await expect(page.locator('#encounter-status')).toHaveText('Paused');
  await page.locator('#encounter-play').click(); await page.locator('#encounter-reveal').click(); await expect(page.locator('#encounter-status')).toHaveText('Paused'); await expect(page.locator('#notes')).toBeVisible(); await expect(page.locator('#written-notes-title')).toBeFocused(); await expect(page.locator('#written-notes-title')).toHaveAttribute('tabindex','-1'); await expect(page.locator('#intention')).toHaveText(listShowcases()[0]!.intention);
  await page.locator('#inspect').click(); await expect(page.locator('#status')).toHaveText('Paused'); await page.locator('#return-encounter').click(); await expect(page.locator('#encounter-title')).toHaveText('Authored first take'); await expect(page.locator('#encounter-stage')).toHaveAttribute('data-time','0'); await expect(page.locator('#notes')).toBeHidden();
  await page.locator('.example').nth(2).click(); await expect(page.locator('#encounter-title')).toHaveText('Authored first take'); await expect(page.locator('#encounter-stage')).toHaveAttribute('data-time','0'); await page.locator('#encounter-reveal').click(); await expect(page.locator('#notes')).toBeVisible();
});


test('offline forward Tab reaches continuation, destination playback, inspection and an honest early finish', async ({ page, context }) => {
  await context.setOffline(true); await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.goto(url);
  const title = page.locator('#encounter-title'); await expect(title).not.toBeFocused();
  async function activate(id: string) { await page.locator('#' + id).focus(); await page.keyboard.press('Enter'); }
  async function firstTakeReady() { await expect(title).toHaveText('Authored first take'); await expect(title).toBeFocused(); await expect(page.locator('#encounter-status')).toHaveText('Paused'); await expect(page.locator('#encounter-stage')).toHaveAttribute('data-time', '0'); await page.keyboard.press('Tab'); await expect(page.locator('#encounter-play')).toBeFocused(); }
  await activate('encounter-reveal'); await expect(page.locator('#written-notes-title')).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.locator('#encounter-next')).toBeFocused(); await page.keyboard.press('Enter'); await firstTakeReady();
  await page.keyboard.press('Tab'); await expect(page.locator('#encounter-reflect')).toBeFocused();
  await activate('inspect'); await expect(page.locator('#play')).toBeFocused(); await page.keyboard.press('Tab'); await expect(page.locator('#scrub')).toBeFocused();
  await activate('return-encounter'); await firstTakeReady();
  for (const scene of [1, 0]) {
    await expect(page.locator('.example').nth(scene)).toHaveAttribute('aria-pressed', 'true');
    await activate('encounter-reveal'); await page.keyboard.press('Tab'); await expect(page.locator('#encounter-next')).toBeFocused(); await page.keyboard.press('Tab'); await expect(page.locator('#encounter-finish')).toBeFocused();
    await page.keyboard.press('Enter'); await expect(title).toHaveText('Finished for now.'); await expect(title).toBeFocused();
    await activate('encounter-return'); await firstTakeReady(); await expect(page.locator('#notes')).toBeHidden();
  }
  await page.locator('.example').nth(2).click(); await firstTakeReady();
  await activate('encounter-reveal'); await page.keyboard.press('Tab'); await expect(page.locator('#encounter-finish')).toBeFocused(); await expect(page.locator('#encounter-next')).toBeHidden();
});
