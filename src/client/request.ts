export class HttpFailure extends Error {
  constructor(readonly status: number, readonly code: string, readonly requestId: string | null = null) { super(code); }
}
export async function request<T = any>(path: string, body?: unknown, options: AbortSignal | { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<T> {
  const settings = options instanceof AbortSignal ? { signal: options } : options;
  const controller = new AbortController();
  const aborted = new Promise<never>((_, reject) => { controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true }); });
  const abort = () => controller.abort(settings.signal?.reason);
  settings.signal?.addEventListener('abort', abort, { once: true });
  if (settings.signal?.aborted) abort();
  const timer = setTimeout(() => controller.abort(new Error('REQUEST_TIMEOUT')), settings.timeoutMs ?? 10000);
  try {
    return await Promise.race([aborted, (async () => {
      const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      const value = await response.json();
      if (!response.ok) {
        const error = errorSchema.safeParse(value?.error);
        throw new HttpFailure(response.status, error.success ? error.data.code : 'UNAVAILABLE', error.success ? error.data.requestId ?? null : null);
      }
      return value as T;
    })()]);
  } finally { clearTimeout(timer); settings.signal?.removeEventListener('abort', abort); }
}
import * as z from 'zod/mini';
z.config({ jitless: true });
const errorSchema = z.strictObject({ code: z.enum(['INVALID_INPUT', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'STALE', 'IDEMPOTENCY_CONFLICT', 'ACTIVE_ROUND', 'EXPIRED', 'LIMITED', 'UNAVAILABLE', 'DEADLINE']), retryable: z.boolean(), requestId: z.nullable(z.uuidv4().check(z.lowercase())) });
