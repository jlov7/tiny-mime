import { test, expect } from '../support/browser-fixtures.js';
import { sampleScore } from '../../src/shared/sampleScore.js';
import type { MotionScoreV1 } from '../../src/shared/score.js';

const button = (page: import('@playwright/test').Page, name: string) => page.getByRole('button', { name, exact: true });

test('display typography loads locally and completion keeps transport focus while promoting reflection', async ({ page, app, operator }) => {
  const external: string[] = []; page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:4317')) external.push(request.url()); });
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.goto('/showcase');
  await expect(page.getByRole('heading', { name: 'Authored first take', exact: true })).toBeVisible();
  expect(await page.evaluate(async () => { await document.fonts.ready; const faces = await document.fonts.load('650 40px "Bricolage Grotesque"'); return faces.length > 0 && faces.every(face => face.status === 'loaded'); })).toBe(true);
  expect(external).toEqual([]);
  await expect(page.locator('.encounter-progress [aria-current=step]')).toHaveText('First take');
  await button(page, 'Play take').click(); await expect(page.getByRole('status')).toHaveText('Playing');
  await page.getByText('Playback controls', { exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Paused');
  const timeline = page.getByRole('slider', { name: 'Take timeline', exact: true });
  await timeline.fill(String(Number(await timeline.getAttribute('max')) - 60));
  const transport = button(page, 'Play take'); await transport.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toHaveText('Finished'); await expect(button(page, 'Replay take')).toBeFocused();
  await expect(button(page, 'Replay take')).not.toHaveClass(/primary/u); await expect(button(page, 'Reflect on first take')).toHaveClass(/primary/u);
  await page.keyboard.press('Tab'); await expect(button(page, 'Reflect on first take')).toBeFocused(); await page.keyboard.press('Enter');
  await expect(page.locator('.encounter-progress [aria-current=step]')).toHaveText('Reflect');
});
async function expectPose(page: import('@playwright/test').Page, score: MotionScoreV1, time: number) {
  expect(await page.locator('.authored-encounter svg g[data-actor]').evaluateAll(nodes => nodes.map(node => node.getAttribute('transform')))).toEqual(sampleScore(score, time).map(f => 'translate(' + f.x + ' ' + f.y + ') rotate(' + f.rotationDeg + ') scale(' + f.scaleX + ' ' + f.scaleY + ')'));
}

test('all three authored encounters start each take at zero, step its own keys and explicitly reveal', async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/showcase');
  const before = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));
  const { examples } = await (await page.request.get('/api/operator/showcases')).json();
  for (const [index, example] of examples.entries()) {
    await expect(page.getByRole('heading', { name: 'Authored first take', exact: true })).toBeVisible();
    await expectPose(page, example.left.score, 0);
    await expect(page.getByText(example.intention, { exact: false })).toBeHidden();
    for (const [take, clip] of [example.left, example.right].entries()) {
      const times = [...new Set<number>(clip.score.actors.flatMap((a: { keyframes: { tMs: number }[] }) => a.keyframes.map(k => k.tMs)))].filter(t => t > 0).sort((a,b) => a-b);
      for (const time of times) { await button(page, 'Next take keyframe').click(); await expectPose(page, clip.score, time); }
      await expect(page.getByRole('status')).toHaveText('Finished');
      await button(page, 'Replay take frames').click(); await expectPose(page, clip.score, 0); await expect(page.getByRole('status')).toHaveText('Paused');
      if (take === 0) {
        await button(page, 'Reflect on first take').click();
        await expect(page.getByText('What do you think is happening?', { exact: true })).toBeVisible();
        await expect(page.getByRole('textbox')).toHaveCount(0);
        await button(page, 'Continue to second take').click();
        await expect(page.getByRole('heading', { name: 'Authored second take', exact: true })).toBeFocused();
        await expectPose(page, example.right.score, 0); await expect(page.getByRole('status')).toHaveText('Paused');
        await expect(page.getByText(example.exampleGuess, { exact: false })).toBeHidden();
      }
    }
    await button(page, 'Reveal intention and notes').click();
    await expect(page.getByText(example.exampleGuess, { exact: false })).toBeVisible();
    await expect(page.getByText(example.intention, { exact: false })).toBeVisible();
    await button(page, index < 2 ? 'Next scene' : 'Finish for now').click();
  }
  await expect(page.getByRole('heading', { name: 'Finished for now.' })).toBeVisible();
  await button(page, 'Return to first scene').click(); await expect(page.getByRole('heading', { name: 'Authored first take', exact: true })).toBeVisible();
  expect(await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }))).toEqual(before);
});

test('full motion, replay, visibility, scene selection and inspection never start a take implicitly', async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.goto('/showcase');
  await expect(page.getByRole('status')).toHaveText('Paused'); await button(page, 'Play take').click();
  await expect(page.getByRole('status')).toHaveText('Playing');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.getByRole('status')).toHaveText('Paused');
  await page.evaluate(() => { delete (document as unknown as { hidden?: boolean }).hidden; document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.getByRole('status')).toHaveText('Paused');
  await page.getByText('Playback controls', { exact: true }).click(); const timeline = page.getByRole('slider', { name: 'Take timeline', exact: true });
  const end = Number(await timeline.getAttribute('max')); await timeline.fill(String(end - 60)); await button(page, 'Play take').click();
  await expect(page.getByRole('status')).toHaveText('Finished'); await button(page, 'Replay take').click(); await expect(page.getByRole('status')).toHaveText('Playing');
  await button(page, 'Reflect on first take').click(); await expect(page.getByRole('status')).toHaveText('Paused');
  await button(page, 'Continue to second take').click(); await expect(timeline).toHaveValue('0'); await expect(page.getByRole('status')).toHaveText('Paused');
  await button(page, 'Play take').click(); await button(page, 'Skip to written reveal').click(); await expect(page.getByRole('status')).toHaveText('Paused');
  await button(page, 'Inspect both takes together').click(); const shared = page.getByRole('slider'); await expect(shared).toHaveValue('0'); await expect(page.getByRole('status')).toHaveText('Paused');
  await shared.fill('2400'); await page.getByText('Numeric changes', { exact: true }).click(); await expect(page.getByText('do not measure meaning, quality or improvement.', { exact: false })).toBeVisible();
  await button(page, 'Return to first take').click(); await expect(page.getByRole('heading', { name: 'Authored first take', exact: true })).toBeVisible();
  await expect(page.locator('.encounter-notes')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Directing example' }).selectOption({ label: 'Scene 2' }); await expect(page.getByRole('status')).toHaveText('Paused');
  await expect(page.locator('.authored-encounter output')).toContainText('0.00 /');
  await button(page, 'Skip to written reveal').click(); await expect(page.locator('.encounter-notes')).toBeVisible();
});

for (const width of [1280, 390, 320]) test('reflection and second take remain together with their controls at ' + width, async ({ page, app, operator }) => {
  await page.setViewportSize({ width, height: width === 1280 ? 720 : 844 }); await page.goto('/showcase');
  await button(page, 'Reflect on first take').click();
  for (const name of ['Continue to second take', 'Skip to written reveal']) await expect(button(page, name)).toBeInViewport({ ratio: 1 });
  await button(page, 'Continue to second take').click();
  await expect(page.locator('.authored-encounter svg')).toBeInViewport({ ratio: 1 });
  for (const name of ['Play take', 'Reveal intention and notes', 'Skip to written reveal']) await expect(button(page, name)).toBeInViewport({ ratio: 1 });
  await button(page, 'Skip to written reveal').click(); await expect(page.getByRole('heading', { name: 'The directing choices.' })).toBeVisible();
});


test('written reveal receives keyboard focus and pauses from skip and second take', async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const examples = await (await page.request.get('/api/operator/showcases')).json();
  for (const entry of ['skip', 'second']) {
    await page.goto('/showcase');
    if (entry === 'second') { await button(page, 'Reflect on first take').click(); await button(page, 'Continue to second take').click(); }
    await button(page, 'Play take').click(); await expect(page.getByRole('status')).toHaveText('Playing');
    const reveal = button(page, entry === 'skip' ? 'Skip to written reveal' : 'Reveal intention and notes'); await reveal.focus(); await page.keyboard.press('Enter');
    const heading = page.getByRole('heading', { name: 'Intention and directing notes', exact: true });
    await expect(heading).toHaveAttribute('tabindex', '-1'); await expect(heading).toBeFocused();
    await expect(page.getByText(examples.examples[0].intention, { exact: false })).toBeVisible(); await expect(page.getByRole('status')).toHaveText('Paused');
  }
});


test('inspection entry finishes focus before the next user action even when animation frames are delayed', async ({ page, app, operator }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/showcase'); await button(page, 'Inspect both takes together').focus();
  await page.evaluate(() => {
    const target = window as typeof window & { heldFocusFrames: FrameRequestCallback[]; originalFocusFrame: typeof requestAnimationFrame };
    target.heldFocusFrames = []; target.originalFocusFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => target.heldFocusFrames.push(callback);
  });
  await page.keyboard.press('Enter'); await expect(button(page, 'Play comparison')).toBeFocused();
  await page.getByRole('slider').fill('2400'); const second = button(page, 'Show second take'); await second.focus();
  await page.evaluate(() => {
    const target = window as typeof window & { heldFocusFrames: FrameRequestCallback[]; originalFocusFrame: typeof requestAnimationFrame };
    window.requestAnimationFrame = target.originalFocusFrame;
    for (const callback of target.heldFocusFrames.splice(0)) callback(performance.now());
  });
  await expect(second).toBeFocused(); await page.keyboard.press('Enter');
  await expect(second).toHaveAttribute('aria-pressed', 'true'); await expect(page.getByRole('slider')).toHaveValue('2400');
});

test('forward Tab reaches continuation, destination playback, inspection and an honest early finish', async ({ page, app, operator }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  let release!: () => void; const ready = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/operator/showcases', async route => { await ready; await route.continue(); });
  await page.goto('/showcase'); const examplesLink = page.getByRole('link', { name: 'Examples', exact: true }); await examplesLink.focus(); release();
  const firstHeading = page.getByRole('heading', { name: 'Authored first take', exact: true }); await expect(firstHeading).toBeVisible(); await expect(examplesLink).toBeFocused();
  async function activate(name: string) { await button(page, name).focus(); await page.keyboard.press('Enter'); }
  async function firstTakeReady() { await expect(firstHeading).toBeFocused(); await expect(page.getByRole('status')).toHaveText('Paused'); await expect(page.locator('.authored-encounter output')).toContainText('0.00 /'); await page.keyboard.press('Tab'); await expect(button(page, 'Play take')).toBeFocused(); }
  await activate('Skip to written reveal'); await expect(page.getByRole('heading', { name: 'Intention and directing notes', exact: true })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(button(page, 'Next scene')).toBeFocused(); await page.keyboard.press('Enter'); await firstTakeReady();
  await page.keyboard.press('Tab'); await expect(button(page, 'Reflect on first take')).toBeFocused();
  await activate('Inspect both takes together'); await expect(button(page, 'Play comparison')).toBeFocused(); await page.keyboard.press('Tab'); await expect(button(page, 'Reset comparison')).toBeFocused();
  await activate('Return to first take'); await firstTakeReady();
  for (const scene of ['Scene 2', 'Scene 1']) {
    await expect(page.getByRole('combobox', { name: 'Directing example' })).toHaveValue(scene === 'Scene 2' ? 'TM09' : 'TM01');
    await activate('Skip to written reveal'); await expect(page.getByRole('heading', { name: 'Intention and directing notes', exact: true })).toBeFocused(); await page.keyboard.press('Tab'); await expect(button(page, 'Next scene')).toBeFocused(); await page.keyboard.press('Tab'); await expect(button(page, 'Finish for now')).toBeFocused();
    await page.keyboard.press('Enter'); await expect(page.getByRole('heading', { name: 'Finished for now.', exact: true })).toBeFocused();
    await activate('Return to first scene'); await firstTakeReady(); await expect(page.locator('.encounter-notes')).toHaveCount(0);
  }
  await page.getByRole('combobox', { name: 'Directing example' }).selectOption({ label: 'Scene 3' }); await firstTakeReady();
  await activate('Skip to written reveal'); await expect(page.getByRole('heading', { name: 'Intention and directing notes', exact: true })).toBeFocused(); await page.keyboard.press('Tab'); await expect(button(page, 'Finish for now')).toBeFocused(); await expect(button(page, 'Next scene')).toHaveCount(0);
});
