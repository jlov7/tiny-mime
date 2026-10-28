import { randomBytes, randomUUID } from 'node:crypto';

export type Session = {
  sessionId: string; token: string; createdAt: number; activeRoundId: string | null;
  providerConsent: string | null; creates: number[];
};

export class SessionManager {
  private sessions = new Map<string, Session>();
  private byId = new Map<string, Session>();
  constructor(private now: () => number = Date.now) {}
  lookup(token: string | undefined): Session | undefined {
    const s = token ? this.sessions.get(token) : undefined;
    if (s && this.now() - s.createdAt >= 8 * 3600000) {
      this.sessions.delete(s.token); this.byId.delete(s.sessionId); return undefined;
    }
    return s;
  }
  owner(id: string): Session | undefined {
    const s = this.byId.get(id);
    return s ? this.lookup(s.token) : undefined;
  }
  establish(token?: string): Session {
    const existing = this.lookup(token);
    if (existing) return existing;
    for (const s of this.sessions.values()) this.lookup(s.token);
    if (this.sessions.size >= 1000) throw new Error('SESSION_LIMIT');
    const session: Session = { sessionId: randomUUID(), token: randomBytes(32).toString('hex'), createdAt: this.now(), activeRoundId: null, providerConsent: null, creates: [] };
    this.sessions.set(session.token, session); this.byId.set(session.sessionId, session);
    return session;
  }
}

export function cookieValue(header: string | undefined, name: string): string | undefined {
  const values = (header ?? '').split(';').map(v => v.trim()).filter(v => v.startsWith(name + '='));
  if (values.length !== 1) return undefined;
  const value = values[0].slice(name.length + 1);
  return /^[0-9a-f]{64}$/.test(value) ? value : undefined;
}

export const sessionCookie = (name: string, value: string, maxAge: number) => `${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
