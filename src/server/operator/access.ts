import { randomBytes, timingSafeEqual } from 'node:crypto';

export class OperatorAccess {
  private secret: string | null = null;
  private failures = 0;
  private token: string | null = null;
  private expiresAt = 0;
  private lastSecretAt = -Infinity;
  constructor(private output: (secret: string) => void, private now: () => number = Date.now) { this.regenerate(); }
  regenerate(): boolean {
    if (this.now() - this.lastSecretAt < 60000) return false;
    this.secret = randomBytes(32).toString('base64url'); this.failures = 0; this.lastSecretAt = this.now(); this.output(this.secret); return true;
  }
  status(token?: string): { operatorReady: true; expiresAt: string } | null {
    if (this.token && this.now() >= this.expiresAt) { this.token = null; this.regenerate(); }
    return token && token === this.token ? { operatorReady: true, expiresAt: new Date(this.expiresAt).toISOString() } : null;
  }
  bootstrap(input: string): { token: string; operatorReady: true; expiresAt: string } | null {
    if (!this.secret) { this.regenerate(); return null; }
    const valid = /^[A-Za-z0-9_-]{43}$/.test(input) && timingSafeEqual(Buffer.from(input), Buffer.from(this.secret));
    if (!valid) { this.failures++; if (this.failures >= 5) { this.secret = null; this.regenerate(); } return null; }
    this.secret = null; this.token = randomBytes(32).toString('hex'); this.expiresAt = this.now() + 1800000;
    return { token: this.token, operatorReady: true, expiresAt: new Date(this.expiresAt).toISOString() };
  }
  lock() { this.token = null; this.secret = null; this.regenerate(); }
}
