import { describe, expect, it } from 'vitest';
import { observedRoomScripts, unlockDestination } from '../../src/client/routes.js';

describe('operator return destination', () => {
  it('returns only to an existing local mode with its allowed owned-record parameter', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    for (const route of ['/play', '/showcase', '/rehearsal', '/study', '/creator/capture', '/study?session=' + id, '/creator/capture?round=' + id, '/rehearsal?scene=TM09', '/creator/capture?scene=TM04']) expect(unlockDestination('?next=' + encodeURIComponent(route))).toBe(route);
  });
  it('does not turn unlock into an external redirect or an arbitrary query carrier', () => {
    for (const route of ['https://example.invalid', '//example.invalid/rehearsal', '/\\example.invalid/rehearsal', '/missing', '/showcase?guess=private', '/rehearsal#target', '/rehearsal?launchSecret=private', '/rehearsal?scene=TM07', '/rehearsal?scene=TM09&scene=TM04', '/rehearsal?scene=TM09&guess=private', '/study?session=bad', '/study?session=00000000-0000-4000-8000-000000000001&session=00000000-0000-4000-8000-000000000001']) expect(unlockDestination('?next=' + encodeURIComponent(route))).toBe('/rehearsal');
    expect(unlockDestination('')).toBe('/rehearsal');
  });
  it('preserves only explicit prepared-take and saved-version rehearsal destinations', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    for (const route of ['/rehearsal?scene=TM09&take=second', '/rehearsal?scene=TM01&take=first', '/rehearsal?scene=TM02&take=second', '/rehearsal?candidate=' + id]) expect(unlockDestination('?next=' + encodeURIComponent(route))).toBe(route);
    for (const route of ['/rehearsal?scene=TM09&take=third', '/rehearsal?take=second', '/rehearsal?scene=TM09&take=second&take=first', '/rehearsal?candidate=bad', '/rehearsal?candidate=' + id + '&scene=TM09', '/rehearsal?candidate=' + id + '&notes=private']) expect(unlockDestination('?next=' + encodeURIComponent(route))).toBe('/rehearsal');
  });
});

it('refreshes only a bounded deduplicated set of observed local production scripts', () => {
  const origin = 'http://127.0.0.1:4317';
  const script = origin + '/assets/Rehearsal-hash.js';
  expect(observedRoomScripts([script, script, 'https://example.invalid/assets/other.js', origin + '/api/operator/status', origin + '/assets/file.js?secret=private', origin + '/assets/file.js#fragment', 'invalid'], origin)).toEqual([script]);
  expect(observedRoomScripts(Array.from({ length: 40 }, (_, i) => origin + '/assets/chunk-' + i + '.js'), origin)).toHaveLength(32);
});
