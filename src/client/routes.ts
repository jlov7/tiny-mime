const paths = new Set(['/play', '/study', '/rehearsal', '/creator/capture', '/showcase']);
const scenePattern = /^TM(?:0[1-6]|0[89]|1[0-2])$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export type RehearsalEntry = { scene?: string; take?: 'first' | 'second'; candidate?: string };
export function rehearsalEntry(search: string): RehearsalEntry | null {
  const params = new URLSearchParams(search), entries = [...params];
  if (!entries.length) return {};
  if (new Set(entries.map(([name]) => name)).size !== entries.length) return null;
  if (entries.length === 1 && params.has('candidate')) return uuidPattern.test(params.get('candidate')!) ? { candidate: params.get('candidate')! } : null;
  const scene = params.get('scene'), take = params.get('take');
  if (!scene || !scenePattern.test(scene) || entries.some(([name]) => name !== 'scene' && name !== 'take')) return null;
  if (take !== null && take !== 'first' && take !== 'second') return null;
  return { scene, ...(take ? { take: take as 'first' | 'second' } : {}) };
}
export function observedRoomScripts(names: string[], origin: string): string[] {
  return [...new Set(names.flatMap(name => {
    try { const url = new URL(name); return url.origin === origin && !url.search && !url.hash && /^\/assets\/[A-Za-z0-9_-]+\.js$/.test(url.pathname) ? [url.href] : []; }
    catch { return []; }
  }))].slice(0, 32);
}
export function unlockDestination(search: string): string {
  const next = new URLSearchParams(search).get('next');
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/rehearsal';
  const url = new URL(next, 'http://127.0.0.1:4317');
  if (url.origin !== 'http://127.0.0.1:4317' || !paths.has(url.pathname) || url.hash) return '/rehearsal';
  if (url.pathname === '/rehearsal') return rehearsalEntry(url.search) ? url.pathname + url.search : '/rehearsal';
  const key = url.pathname === '/study' ? 'session' : url.pathname === '/creator/capture' ? 'round' : null;
  if ([...url.searchParams].some(([name, value]) => name === 'scene' && url.pathname === '/creator/capture' ? !scenePattern.test(value) : name !== key || !uuidPattern.test(value)) || [...url.searchParams].length > 1) return '/rehearsal';
  return url.pathname + url.search;
}
