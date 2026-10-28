import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import specimen from '../../Tiny_Mime_Review_Source_Pack/supplements/contract-fixtures/TM01.first-score.json';
import { scoreHash, canonicalJson } from '../../src/shared/hash.js';
import type { MotionScoreV1 } from '../../src/shared/score.js';
import { buildCapture, type CaptureInput, type CaptureRecord } from '../../src/server/operator/capture.js';
import { REPLAY_STYLE, replayScript } from '../../src/server/operator/replayTemplate.js';
import { DISPLAY_FONT_CSS } from '../../src/server/operator/typography.js';
const hostile = '</script><img src=https://example.invalid/x onerror=alert(1)>';
const roundId = '11111111-1111-4111-8111-111111111111';
const input: CaptureInput = { requestId: '22222222-2222-4222-8222-222222222222', roundId, includeGuessText: true, timing: 'original', shortenedWaitMs: null };
function record(): CaptureRecord {
  const score = structuredClone(specimen) as MotionScoreV1;
  return {
    round: { roundId, revision: 3, expiresAt: '2026-10-08T19:00:00Z', mode: 'private_play', executionMode: 'fixture', phase: 'play', state: 'revealed', actions: [],
      acts: [1, 2].map(attempt => ({ attempt: attempt as 1 | 2, score, scoreHash: scoreHash(score), source: attempt === 1 ? 'authored_fixture' : 'mock_fixture', authorship: attempt === 1 ? { authoringMethod: 'agent_assisted', humanReview: 'not_run' } : null })),
      guesses: [{ attempt: 1, text: hostile }, { attempt: 2, text: 'Ordinary Unicode: café 🟣' }], reveal: { target: 'Awkward passing' }, generation: { acceptedAt: '2026-10-08T18:00:00Z', deadlineAt: '2026-10-08T18:00:15Z', status: 'ready', failure: null } },
    creatorOwned: true, publicationPermission: null, actualWaitMs: 3000, selectedExample: true, createdAt: '2026-10-08T18:02:00Z', versions: { engine: 'svg-shapes-v1', contact: 'noncontact-v1', meaning: 'TM01-v1', prompt: null, model: null },
    timeline: [{ kind: 'act', attempt: 1, durationMs: 8000, playbackSpeed: 1, replay: false }, { kind: 'guess', attempt: 1, durationMs: 500 }, { kind: 'wait', durationMs: 3000 }, { kind: 'act', attempt: 2, durationMs: 8000, playbackSpeed: 1, replay: false }, { kind: 'guess', attempt: 2, durationMs: 500 }, { kind: 'reveal', durationMs: 1000 }],
  };
}
function bundle(r = record(), i = input) { const result = buildCapture(r, i); if ('error' in result) throw new Error(result.error.code); return { ...result, files: unzipSync(result.bytes) }; }
class Element {
  textContent = ''; value = ''; disabled = false; checked = false; children: Element[] = []; attrs: Record<string, string> = {}; listeners: Record<string, () => void> = {};
  setAttribute(name: string, value: string) { this.attrs[name] = value; }
  replaceChildren() { this.children = []; }
  appendChild(child: Element) { this.children.push(child); }
  addEventListener(type: string, listener: () => void) { this.listeners[type] = listener; }
  click() { this.listeners.click?.(); }
}
function reopen(html: string, reduced = true) {
  const elements = Object.fromEntries(['payload', 'notice', 'limitations', 'motion', 'stage', 'label', 'message', 'reveal', 'play', 'replay', 'step', 'previous-step', 'previous-segment', 'next-segment', 'segment', 'timeline', 'position'].map(id => [id, new Element()]));
  elements.payload.textContent = html.match(/<div id="payload" hidden>([^<]+)<\/div>/)![1];
  let callback: ((t: number) => void) | null = null;
  const events: Record<string, () => void> = {};
  const document = { hidden: false, getElementById: (id: string) => elements[id], createElementNS: () => new Element(), addEventListener: (name: string, fn: () => void) => { events[name] = fn; } };
  const mediaEvents: Record<string, (event: { matches: boolean }) => void> = {};
  const preference = { matches: reduced, addEventListener: (name: string, listener: (event: { matches: boolean }) => void) => { mediaEvents[name] = listener; } };
  const context = { document, TextDecoder, Uint8Array, atob: (s: string) => Buffer.from(s, 'base64').toString('binary'), matchMedia: () => preference, requestAnimationFrame: (fn: (t: number) => void) => { callback = fn; return 1; }, cancelAnimationFrame: () => { callback = null; } };
  runInNewContext(html.match(/<script>([\s\S]+)<\/script>/)![1], context);
  return { elements, document, events, frame(t: number) { callback?.(t); }, setReduced(matches: boolean) { preference.matches = matches; mediaEvents.change?.({ matches }); } };
}
describe('local capture contract', () => {
  it('pauses in place when reduced motion changes and never resumes without explicit opt-in', () => {
    const p = reopen(strFromU8(bundle().files['replay.html']), false);
    p.elements.play.click(); p.frame(0); p.frame(900);
    const transforms = p.elements.stage.children.map(shape => shape.attrs.transform); const position = p.elements.position.textContent;
    p.setReduced(true); expect(p.elements.motion.checked).toBe(false); expect(p.elements.play.textContent).toBe('Next frame or segment');
    p.frame(2000); expect(p.elements.stage.children.map(shape => shape.attrs.transform)).toEqual(transforms); expect(p.elements.position.textContent).toBe(position);
    p.setReduced(false); p.frame(2500); expect(p.elements.motion.checked).toBe(false); expect(p.elements.play.textContent).toBe('Next frame or segment');
    p.elements.step.click(); expect(p.elements.position.textContent).not.toBe(position);
    p.elements.motion.checked = true; p.elements.play.click(); expect(p.elements.play.textContent).toBe('Pause');
  });
  it('X08 guarantees HTML/SVG and canonical JSON ZIP without any video capability', () => {
    const b = bundle();
    expect(Object.keys(b.files).sort()).toEqual(['capture-manifest.json', 'replay.html', 'scores/act1.json', 'scores/act2.json']);
    expect(b.filename).toBe('tiny-mime-replay.zip');
    for (const attempt of [1, 2]) { const raw = strFromU8(b.files[`scores/act${attempt}.json`]); expect(raw).toBe(canonicalJson(JSON.parse(raw))); expect(createHash('sha256').update(raw).digest('hex')).toBe(b.manifest.acts[attempt - 1].scoreHash); }
    expect(b.manifest.round.executionMode).toBe('fixture');
    expect(b.manifest.validityLimitations.join(' ')).toContain('NOT RUN');
  });
  it('X05 embeds data only as UTF8 base64 and uses exact CSP script/style hashes', () => {
    const html = strFromU8(bundle().files['replay.html']);
    expect(html).not.toContain(hostile); expect(html).not.toContain(roundId);
    expect(html).toContain(DISPLAY_FONT_CSS);
    expect(html.replace(DISPLAY_FONT_CSS, '')).not.toMatch(/innerHTML|fetch\(|XMLHttpRequest|<img|<link|\bsrc=|url\(|@import/);
    expect(html).toContain('font-src data:');
    const script = html.match(/<script>([\s\S]+)<\/script>/)![1];
    expect(html).toContain(`script-src 'sha256-${createHash('sha256').update(script).digest('base64')}'`);
    expect(html).toContain(`style-src 'sha256-${createHash('sha256').update(REPLAY_STYLE).digest('base64')}'`);
    expect(html).toContain("connect-src 'none'"); expect(html).toContain('new TextDecoder()');
  });
  it('X05 reopens the fixed player, renders malicious text literally and reveals only at reveal', () => {
    const p = reopen(strFromU8(bundle().files['replay.html']));
    expect(p.elements.stage.children).toHaveLength(2); expect(p.elements.reveal.textContent).toBe('');
    expect(p.elements.notice.textContent).toContain('Selected example'); expect(p.elements.label.textContent).toContain('Authored fixture');
    for (let n = 0; n < 30 && p.elements.label.textContent !== 'Accepted guess 1'; n++) p.elements.step.click();
    expect(p.elements.message.textContent).toBe(hostile); expect(p.elements.message.children).toEqual([]); expect(p.elements.reveal.textContent).toBe('');
    for (let n = 0; n < 60 && p.elements.label.textContent !== 'Reveal'; n++) p.elements.step.click();
    expect(p.elements.reveal.textContent).toBe('The scene was meant to show… Awkward passing');
    p.elements.replay.click(); expect(p.elements.reveal.textContent).toBe(''); expect(p.elements.position.textContent).toMatch(/^0.0/);
  });
  it('shares exact engine smoothstep, local scale rotation translation and fixed geometry', () => {
    const p = reopen(strFromU8(bundle().files['replay.html']), false);
    p.elements.play.click(); p.frame(0); p.frame(1650);
    expect(p.elements.stage.children[0].attrs.transform).toBe('translate(332.5 350) rotate(0) scale(1 1)');
    expect(p.elements.stage.children[0].attrs.r).toBe('40'); expect(p.elements.stage.children[1].attrs.width).toBe('64'); expect(p.elements.stage.children[0].attrs.fill).toBe('#7357FF');
  });
  it('supports explicit playback, pause, replay, reduced-motion stepping and hidden-page pause', () => {
    const p = reopen(strFromU8(bundle().files['replay.html']));
    expect(p.elements.motion.checked).toBe(false); p.elements.play.click(); expect(p.elements.position.textContent).toMatch(/^0.9/);
    p.elements.replay.click(); p.elements.motion.checked = true; p.elements.play.click(); p.frame(100); p.frame(1100); expect(p.elements.position.textContent).toMatch(/^1.0/);
    p.document.hidden = true; p.events.visibilitychange(); p.frame(5000); expect(p.elements.position.textContent).toMatch(/^1.0/); expect(p.elements.play.textContent).toBe('Play');
    p.elements.replay.click(); expect(p.elements.position.textContent).toMatch(/^0.0/);
  });
  it('X06 rejects study research consent and unrelated publication consent as guess authority', () => {
    const r = record(); r.creatorOwned = false; r.round.mode = 'study';
    Object.assign(r, { researchConsent: true, publicationConsent: true });
    expect(buildCapture(r, input)).toMatchObject({ error: { code: 'FORBIDDEN' } });
    r.publicationPermission = { roundId: '33333333-3333-4333-8333-333333333333', verified: true, scope: 'guess_text_publication' };
    expect(buildCapture(r, input)).toMatchObject({ error: { code: 'FORBIDDEN' } });
    r.publicationPermission.roundId = roundId; expect(bundle(r).manifest.consentBasis).toBe('publication_opt_in');
  });
  it('excludes both guesses when omitted, with no inferred publication or repair claim', () => {
    const r = record(); r.creatorOwned = false;
    const b = bundle(r, { ...input, includeGuessText: false });
    expect(b.manifest.consentBasis).toBe('no_guess_text'); expect(b.manifest.omittedGuessText).toBe(true);
    const html = strFromU8(b.files['replay.html']); const payload = JSON.parse(Buffer.from(html.match(/<div id="payload" hidden>([^<]+)<\/div>/)![1], 'base64').toString('utf8'));
    expect(payload.guesses).toEqual([]); expect(JSON.stringify(payload)).not.toContain(hostile);
    expect(b.manifest.validityLimitations.join(' ')).toContain('not a complete example');
  });
  it('X07 labels unobserved score reconstruction and refuses unsupported original wait edits', () => {
    const r = record(), before = JSON.stringify(r); const b = bundle(r);
    expect(b.manifest.actualTimeline).toBeNull(); expect(b.manifest.actualWaitMs).toBeNull(); expect(b.manifest.serverGenerationMs).toBe(3000);
    expect(b.manifest.presentationDwellMs).toEqual({ guess: 1500, reveal: 1500 }); expect(JSON.stringify(r)).toBe(before);
    expect(reopen(strFromU8(b.files['replay.html'])).elements.notice.textContent).toContain('Original session timing unavailable');
    expect(buildCapture(r, { ...input, timing: 'shortened_wait', shortenedWaitMs: 200 })).toMatchObject({ error: { code: 'INVALID_INPUT' } });
  });
  it.each([-1, 3001, 15001, 1.5, null])('rejects invalid or inflated shortened wait %s', n => {
    expect(buildCapture(record(), { ...input, timing: 'shortened_wait', shortenedWaitMs: n })).toMatchObject({ error: { code: 'INVALID_INPUT' } });
  });
  it('rejects non-null original edit, unknown input keys and malformed ids', () => {
    expect(buildCapture(record(), { ...input, shortenedWaitMs: 0 })).toMatchObject({ error: { code: 'INVALID_INPUT' } });
    expect(buildCapture(record(), { ...input, extra: true } as CaptureInput)).toMatchObject({ error: { code: 'INVALID_INPUT' } });
    expect(buildCapture(record(), { ...input, requestId: 'invalid' })).toMatchObject({ error: { code: 'INVALID_INPUT' } });
  });
  it.each(['unavailable', 'abandoned', 'generating_act2'] as const)('rejects %s rounds', state => { const r = record(); r.round.state = state; expect(buildCapture(r, input)).toMatchObject({ error: { code: 'UNAVAILABLE' } }); });
  it('rejects incomplete scores, mismatch hashes and missing second guess', () => {
    for (const change of [(r: CaptureRecord) => { r.round.acts.pop(); }, (r: CaptureRecord) => { r.round.acts[1].scoreHash = 'wrong'; }, (r: CaptureRecord) => { r.round.guesses.pop(); }, (r: CaptureRecord) => { r.round.acts[0].score.actors[0].keyframes[0].x = 0; }]) {
      const r = record(); change(r); expect(buildCapture(r, input)).toMatchObject({ error: { code: 'UNAVAILABLE' } });
    }
  });
  it('does not turn reconstructed or manipulated legacy segments into observed timing', () => {
    const r = record(); r.timeline.reverse(); r.timeline[0].durationMs++;
    expect(bundle(r).manifest.actualTimeline).toBeNull();
    r.round.guesses[0].text = '\uD800'; expect(buildCapture(r, input)).toMatchObject({ error: { code: 'UNAVAILABLE' } });
  });
  it('does not infer original replay timing from an unobserved legacy timeline', () => {
    const r = record(); r.timeline.splice(1, 0, { kind: 'act', attempt: 1, durationMs: 4000, playbackSpeed: 2, replay: true });
    const b = bundle(r); expect(b.manifest.actualTimeline).toBeNull(); expect(b.manifest.timelineBasis).toBe('score_reconstruction');
    expect(b.manifest.exportedTimeline.filter(s => s.kind === 'act')).toHaveLength(2);
  });
  it('preserves original reduced-motion viewing and actual replay counts separately', () => {
    const r = record(); r.playbackObservations = [{ attempt: 1, mode: 'frame_step', speed: 1, replay: false }, { attempt: 1, mode: 'frame_step', speed: 1, replay: true }, { attempt: 2, mode: 'full_motion', speed: 1, replay: false }];
    const b = bundle(r); expect(b.manifest.playbackObservations).toEqual(r.playbackObservations); expect(b.manifest.replayCounts).toEqual({ act1: 1, act2: 0 });
    expect(reopen(strFromU8(b.files['replay.html'])).elements.notice.textContent).toContain('Original viewing included frame stepping');
    r.playbackObservations[0].speed = Number.NaN; expect(buildCapture(r, input)).toMatchObject({ error: { code: 'UNAVAILABLE' } });
  });
  it('frame stepping displays the exact final key before proceeding to guess', () => {
    const p = reopen(strFromU8(bundle().files['replay.html']));
    for (let n = 0; n < 20 && !p.elements.position.textContent.startsWith('8.0'); n++) p.elements.step.click();
    expect(p.elements.stage.children[0].attrs.transform).toBe('translate(425 350) rotate(0) scale(1 1)');
    expect(p.elements.label.textContent).toContain('First performance'); p.elements.step.click(); expect(p.elements.label.textContent).toBe('Accepted guess 1');
  });
  it('retains sticky timeout, clock uncertainty and explicit late recovery visibly', () => {
    const r = record(); r.operationalOutcome = { clientTimeout: true, clockUncertain: true, lateRecovery: true };
    const b = bundle(r); expect(b.manifest.operationalOutcome).toEqual(r.operationalOutcome);
    const p = reopen(strFromU8(b.files['replay.html'])); expect(p.elements.notice.textContent).toContain('client waiting limit'); expect(p.elements.notice.textContent).toContain('uncertain clock'); expect(p.elements.notice.textContent).toContain('recovered late by explicit action');
  });
  it('projects only permitted metadata, excluding extra internal identities', () => {
    const r = record(); Object.assign(r.timeline[0], { sessionId: 'private-session' }); Object.assign(r.versions, { secret: 'private-secret' }); Object.assign(r.round.acts[0], { studyId: 'private-study' });
    const b = bundle(r); expect(JSON.stringify(b.manifest)).not.toMatch(/private-session|private-secret|private-study/);
    const payload = JSON.parse(Buffer.from(strFromU8(b.files['replay.html']).match(/<div id="payload" hidden>([^<]+)<\/div>/)![1], 'base64').toString('utf8'));
    expect(JSON.stringify(payload)).not.toMatch(/private-session|private-secret|private-study/);
  });
  it('offline observed playback holds pauses and backward steps without replacing them with full motion', () => {
    const r = record(); const states: any[] = [];
    const add = (atMs: number, patch: any) => states.push({ reason: 'initial', phase: 'awaiting_guess1', waiting: false, hidden: false, attempt: 1, scoreHash: r.round.acts[0].scoreHash, positionMs: 0, playing: false, mode: 'motion', replay: false, submissionRequestId: null, ...states.at(-1), ...patch, seq: states.length, atMs });
    add(0, {}); add(100, { reason: 'play', playing: true }); add(1100, { reason: 'pause', playing: false, positionMs: 1000 }); add(4100, { reason: 'step', mode: 'frame_step', positionMs: 1650 }); add(5000, { reason: 'step', positionMs: 900 });
    add(7000, { reason: 'submission', phase: 'generating_act2', waiting: true, submissionRequestId: input.requestId }); add(8000, { reason: 'phase', phase: 'awaiting_guess2', waiting: false }); add(9000, { reason: 'step', attempt: 2, positionMs: 8000 }); add(9100, { reason: 'submission', submissionRequestId: roundId }); add(9500, { reason: 'reveal', phase: 'revealed' });
    r.trace = { requestId: input.requestId, documentId: roundId, states };
    const p = reopen(strFromU8(bundle(r).files['replay.html']), false);
    p.elements.play.click(); p.frame(0); p.frame(1100); const held = p.elements.stage.children[0].attrs.transform;
    p.frame(4000); expect(p.elements.stage.children[0].attrs.transform).toBe(held);
    p.frame(4100); expect(p.elements.stage.children[0].attrs.transform).toBe('translate(332.5 350) rotate(0) scale(1 1)');
    p.frame(5000); const back = p.elements.stage.children[0].attrs.transform; expect(back).not.toBe(held);
    p.frame(6900); expect(p.elements.stage.children[0].attrs.transform).toBe(back); expect(p.elements.reveal.textContent).toBe('');
    p.frame(9500); expect(p.elements.reveal.textContent).toContain('Awkward passing');
  });
  it('reduced-motion replay visits score keys inside observed motion intervals and preserves their boundaries', () => {
    const r = record(); const states: any[] = [];
    const add = (atMs: number, patch: any) => states.push({ reason: 'initial', phase: 'awaiting_guess1', waiting: false, hidden: false, attempt: 1, scoreHash: r.round.acts[0].scoreHash, positionMs: 0, playing: false, mode: 'motion', replay: false, submissionRequestId: null, ...states.at(-1), ...patch, seq: states.length, atMs });
    add(0, {}); add(100, { reason: 'play', playing: true }); add(1100, { reason: 'pause', playing: false, positionMs: 1000 }); add(4100, { reason: 'play', playing: true });
    add(6100, { reason: 'step', playing: false, mode: 'frame_step', positionMs: 900 }); add(7000, { reason: 'submission', phase: 'generating_act2', waiting: true, submissionRequestId: input.requestId });
    add(8000, { reason: 'phase', phase: 'awaiting_guess2', waiting: false }); add(9000, { reason: 'step', attempt: 2, positionMs: 8000 }); add(9100, { reason: 'submission', submissionRequestId: roundId }); add(9500, { reason: 'reveal', phase: 'revealed' });
    r.trace = { requestId: input.requestId, documentId: roundId, states };
    const p = reopen(strFromU8(bundle(r).files['replay.html']));
    expect(p.elements.motion.checked).toBe(false);
    p.elements.step.click(); expect(p.elements.position.textContent).toMatch(/^0.1/);
    p.elements.step.click(); expect(p.elements.position.textContent).toMatch(/^1.0/); expect(p.elements.stage.children[0].attrs.transform).toBe('translate(250 350) rotate(0) scale(1 1)');
    p.elements.step.click(); expect(p.elements.position.textContent).toMatch(/^1.1/); expect(p.elements.label.textContent).toContain('Playing.');
    p.elements.step.click(); expect(p.elements.position.textContent).toMatch(/^1.1/); expect(p.elements.label.textContent).toContain('Held frame.');
    p.elements.step.click(); expect(p.elements.position.textContent).toMatch(/^4.1/);
    p.elements.step.click(); expect(p.elements.position.textContent).toMatch(/^5.5/); expect(p.elements.stage.children[0].attrs.transform).toBe('translate(415 350) rotate(0) scale(1 1)');
    p.elements.step.click(); expect(p.elements.position.textContent).toMatch(/^5.9/);
    p.elements.step.click(); expect(p.elements.position.textContent).toMatch(/^6.1/); expect(p.elements.label.textContent).toContain('Playing.');
    p.elements.step.click(); expect(p.elements.position.textContent).toMatch(/^6.1/); expect(p.elements.label.textContent).toContain('Held frame.'); expect(p.elements.stage.children[0].attrs.transform).toBe('translate(250 350) rotate(0) scale(1 1)');
    expect(p.elements.reveal.textContent).toBe('');
  });
  it('manual primary visits an equal-time observed reveal before offering restart', () => {
    const r = record(); const states: any[] = [];
    const add = (atMs: number, patch: any) => states.push({ reason: 'initial', phase: 'awaiting_guess1', waiting: false, hidden: false, attempt: 1, scoreHash: r.round.acts[0].scoreHash, positionMs: 0, playing: false, mode: 'motion', replay: false, submissionRequestId: null, ...states.at(-1), ...patch, seq: states.length, atMs });
    add(0, {}); add(100, { reason: 'step', mode: 'frame_step', positionMs: 8000 });
    add(7000, { reason: 'submission', phase: 'generating_act2', waiting: true, submissionRequestId: input.requestId });
    add(8000, { reason: 'phase', phase: 'awaiting_guess2', waiting: false });
    add(9000, { reason: 'step', attempt: 2, positionMs: 8000 }); add(9100, { reason: 'submission', submissionRequestId: roundId });
    add(9200, { reason: 'replay', playing: true, mode: 'motion', replay: true, positionMs: 0 });
    add(9500, { reason: 'reveal', phase: 'revealed', playing: false, positionMs: 300 });
    r.trace = { requestId: input.requestId, documentId: roundId, states };
    const b = bundle(r); expect(b.manifest.timelineBasis).toBe('observed_creator_trace');
    const p = reopen(strFromU8(b.files['replay.html']));
    for (let count = 0; count < 40 && p.elements.label.textContent !== 'Reveal'; count++) p.elements.play.click();
    expect(p.elements.label.textContent).toBe('Reveal'); expect(p.elements.reveal.textContent).toContain('Awkward passing');
    expect(p.elements.play.textContent).toBe('Restart frames');
    p.elements.play.click(); expect(p.elements.position.textContent).toMatch(/^0.0/); expect(p.elements.reveal.textContent).toBe('');
  });

  it('seeks the exported timeline in seconds, pauses motion and clears later text', () => {
    const b = bundle(), html = strFromU8(b.files['replay.html']), p = reopen(html, false);
    p.elements.segment.value = '5'; p.elements.segment.listeners.change();
    expect(p.elements.reveal.textContent).toContain('Awkward passing');
    p.elements.timeline.value = '8'; p.elements.timeline.listeners.input();
    expect(p.elements.label.textContent).toBe('Accepted guess 1');
    expect(p.elements.reveal.textContent).toBe('');
    p.elements.play.click(); p.frame(0); p.frame(500);
    p.elements.timeline.value = '1.65'; p.elements.timeline.listeners.input();
    expect(p.elements.message.textContent).toBe(''); expect(p.elements.reveal.textContent).toBe('');
    expect(p.elements.stage.children[0].attrs.transform).toBe('translate(332.5 350) rotate(0) scale(1 1)');
    expect(p.elements.timeline.attrs['aria-valuetext']).toBe('1.65 of 23.5 seconds in exported timeline');
    expect(p.elements.play.textContent).toBe('Play');
    p.frame(10000); expect(p.elements.timeline.value).toBe('1.65');
    expect(p.elements.payload.textContent).toBe(html.match(/<div id="payload" hidden>([^<]+)<\/div>/)![1]);
  });
  it.each(['score_reconstruction', 'observed_creator_trace'] as const)('visits equal-time %s segments in both directions', basis => {
    const r = record(); r.actualWaitMs = 0;
    if (basis === 'observed_creator_trace') {
      const states: any[] = [];
      const add = (atMs: number, patch: any) => states.push({ reason: 'initial', phase: 'awaiting_guess1', waiting: false, hidden: false, attempt: 1, scoreHash: r.round.acts[0].scoreHash, positionMs: 0, playing: false, mode: 'frame_step', replay: false, submissionRequestId: null, ...states.at(-1), ...patch, seq: states.length, atMs });
      add(0, {}); add(0, { reason: 'step', positionMs: 8000 });
      add(1000, { reason: 'submission', phase: 'generating_act2', waiting: true, submissionRequestId: input.requestId });
      add(1000, { reason: 'phase', phase: 'awaiting_guess2', waiting: false, attempt: 2, positionMs: 0 });
      add(1000, { reason: 'step', positionMs: 8000 }); add(1000, { reason: 'submission', submissionRequestId: roundId });
      add(1000, { reason: 'reveal', phase: 'revealed' });
      r.trace = { requestId: input.requestId, documentId: roundId, states };
    }
    const b = bundle(r), p = reopen(strFromU8(b.files['replay.html']));
    expect(b.manifest.timelineBasis).toBe(basis); expect(p.elements.segment.value).toBe('0');
    const snapshot = () => ({ label: p.elements.label.textContent, message: p.elements.message.textContent, reveal: p.elements.reveal.textContent, position: p.elements.position.textContent, shapes: p.elements.stage.children.map(shape => shape.attrs.transform) });
    const seen = [snapshot()];
    for (let i = 1; i < b.manifest.exportedTimeline.length; i++) { p.elements['next-segment'].click(); expect(p.elements.segment.value).toBe(String(i)); seen.push(snapshot()); }
    expect(p.elements.reveal.textContent).toContain('Awkward passing');
    expect(p.elements['next-segment'].disabled).toBe(true);
    for (let i = seen.length - 2; i >= 0; i--) { p.elements['previous-segment'].click(); expect(p.elements.segment.value).toBe(String(i)); expect(snapshot()).toEqual(seen[i]); }
    expect(p.elements['previous-segment'].disabled).toBe(true);
    p.elements.timeline.value = '0'; p.elements.timeline.listeners.input(); expect(snapshot()).toEqual(seen[0]);
    const frames = [snapshot()];
    for (let i = 0; i < 80 && p.elements.play.textContent !== 'Restart frames'; i++) { p.elements.play.click(); frames.push(snapshot()); }
    expect(p.elements.play.textContent).toBe('Restart frames');
    for (let i = frames.length - 2; i >= 0; i--) { p.elements['previous-step'].click(); expect(snapshot()).toEqual(frames[i]); }
    expect(p.elements.message.textContent).toBe(''); expect(p.elements.reveal.textContent).toBe('');
  });
  it('fixed script is invariant across user text and timeline changes', () => {
    const html = strFromU8(bundle().files['replay.html']); const r = record(); r.round.guesses[0].text = 'different text';
    expect(strFromU8(bundle(r).files['replay.html']).match(/<script>([\s\S]+)<\/script>/)![1]).toBe(html.match(/<script>([\s\S]+)<\/script>/)![1]); expect(html).toContain(replayScript());
  });
});
