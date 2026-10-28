import { apiError, type ApiError } from './api.js';
export function normalizeGuess(raw: unknown): string | ApiError {
  if (typeof raw !== 'string' || /[\uD800-\uDFFF]/u.test(raw) || /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(raw)) return apiError('INVALID_INPUT');
  const text = raw.normalize('NFC').trim();
  const length = [...text].length;
  return length >= 1 && length <= 240 ? text : apiError('INVALID_INPUT');
}
