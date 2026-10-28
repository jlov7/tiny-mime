import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { usdMicro, type BudgetProfile, type PriceSnapshot } from './providerConfig.js';

export type Reservation = { callId: string; reservedMicroUsd: number; inputTokenBound: number; outputTokenCap: number };
export type ReserveInput = { jobId: string; unitId: string; approvalId: string; profile: 'runtime' | 'qualityProbe'; model: string; price: PriceSnapshot; caps: BudgetProfile; requestUtf8Bytes: number; framingTokenBound: 1024; inputTokenBound: number; outputTokenCap: number };
export type UnitResources = { calls: number; inputTokens: number | null; outputTokens: number | null; actualMicroUsd: number | null };
export class BudgetError extends Error { constructor(public readonly reason: 'locked' | 'limited' | 'invalid') { super(`Budget ${reason}`); } }
type CallRow = { reserved: number; actual: number | null; input_bound: number; output_cap: number; input_rate: number; output_rate: number; status: string };
const id = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const retentionMs = 30 * 86400000;
export function reserveMicroUsd(bound: number, output: number, price: PriceSnapshot): number {
  const value = Math.ceil(bound * price.inputUsdPerMillion + output * price.outputUsdPerMillion);
  if (!Number.isSafeInteger(value) || value < 0) throw new BudgetError('invalid');
  return value;
}
export class BudgetLedger {
  constructor(private readonly db: Database.Database, private readonly nowWall: () => number = Date.now) {
    db.exec(`CREATE TABLE IF NOT EXISTS provider_meta (name TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS provider_calls (call_id TEXT PRIMARY KEY, job_id TEXT NOT NULL, unit_id TEXT NOT NULL, approval_id TEXT NOT NULL, profile TEXT NOT NULL, day TEXT NOT NULL, model TEXT NOT NULL, price_snapshot TEXT NOT NULL, input_rate REAL NOT NULL, output_rate REAL NOT NULL, input_bound INTEGER NOT NULL, output_cap INTEGER NOT NULL, reserved INTEGER NOT NULL, actual INTEGER, input_tokens INTEGER, output_tokens INTEGER, request_id TEXT, status TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS provider_day ON provider_calls(profile,day);
      CREATE TABLE IF NOT EXISTS provider_daily_totals (profile TEXT NOT NULL, day TEXT NOT NULL, calls INTEGER NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, actual INTEGER NOT NULL, PRIMARY KEY(profile,day));
      CREATE TABLE IF NOT EXISTS provider_retired_jobs (job_hash TEXT PRIMARY KEY);`);
    const columns = (db.prepare('PRAGMA table_info(provider_calls)').all() as { name: string }[]).map(column => column.name);
    for (const name of ['request_utf8_bytes','framing_token_bound','created_wall']) {
      if (!columns.includes(name)) db.exec(`ALTER TABLE provider_calls ADD COLUMN ${name} INTEGER`);
    }
    // Legacy receipts lack exact byte counts; retain that uncertainty and use their UTC day for expiry.
    db.prepare("UPDATE provider_calls SET created_wall=CAST(strftime('%s',day) AS INTEGER)*1000 WHERE created_wall IS NULL").run();
    if ((db.prepare('SELECT EXISTS(SELECT 1 FROM provider_calls) OR EXISTS(SELECT 1 FROM provider_daily_totals) OR EXISTS(SELECT 1 FROM provider_retired_jobs) AS n').get() as { n: number }).n > 0) this.lock('restart');
    this.purge();
  }
  private meta(name: string): string | undefined { return (this.db.prepare('SELECT value FROM provider_meta WHERE name=?').get(name) as { value: string } | undefined)?.value; }
  private set(name: string, value: string) { this.db.prepare('INSERT INTO provider_meta(name,value) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value').run(name,value); }
  private jobHash(jobId: string): string { return createHash('sha256').update(jobId).digest('hex'); }
  private isRetired(jobId: string): boolean { return !!this.db.prepare('SELECT 1 FROM provider_retired_jobs WHERE job_hash=?').get(this.jobHash(jobId)); }
  purge(): void {
    const now = this.nowWall();
    if (!Number.isFinite(now) || now < Number(this.meta('last_wall') ?? now)) { this.lock('day_regression'); return; }
    this.db.transaction(() => {
      this.set('last_wall', String(now));
      const cutoff = now - retentionMs;
      const jobs = this.db.prepare("SELECT DISTINCT job_id FROM provider_calls WHERE actual IS NOT NULL AND status='known' AND created_wall<=?").all(cutoff) as { job_id: string }[];
      // Retiring a random job prevents deleted details from resetting its lifetime caps.
      for (const job of jobs) this.db.prepare('INSERT OR IGNORE INTO provider_retired_jobs(job_hash) VALUES (?)').run(this.jobHash(job.job_id));
      this.db.prepare(`INSERT INTO provider_daily_totals(profile,day,calls,input_tokens,output_tokens,actual)
        SELECT profile,day,COUNT(*),SUM(input_tokens),SUM(output_tokens),SUM(actual) FROM provider_calls
        WHERE actual IS NOT NULL AND status='known' AND created_wall<=? GROUP BY profile,day
        ON CONFLICT(profile,day) DO UPDATE SET calls=calls+excluded.calls,input_tokens=input_tokens+excluded.input_tokens,output_tokens=output_tokens+excluded.output_tokens,actual=actual+excluded.actual`).run(cutoff);
      this.db.prepare("DELETE FROM provider_calls WHERE actual IS NOT NULL AND status='known' AND created_wall<=?").run(cutoff);
    }).immediate();
  }
  summaryForUnit(jobId: string, unitId: string): UnitResources {
    this.purge();
    if (![jobId,unitId].every(value => id.test(value)) || this.isRetired(jobId)) throw new BudgetError('invalid');
    const row = this.db.prepare(`SELECT COUNT(*) AS calls,COUNT(CASE WHEN actual IS NOT NULL AND input_tokens IS NOT NULL AND output_tokens IS NOT NULL THEN 1 END) AS known,COALESCE(SUM(input_tokens),0) AS inputTokens,
      COALESCE(SUM(output_tokens),0) AS outputTokens,COALESCE(SUM(actual),0) AS actualMicroUsd
      FROM provider_calls WHERE job_id=? AND unit_id=?`).get(jobId,unitId) as UnitResources & { known: number };
    return { calls: row.calls, inputTokens: row.known === row.calls ? row.inputTokens : null, outputTokens: row.known === row.calls ? row.outputTokens : null, actualMicroUsd: row.known === row.calls ? row.actualMicroUsd : null };
  }
  lock(reason: 'restart' | 'unknown' | 'day_regression' | 'usage_overrun') {
    if (this.meta('lock') === 'usage_overrun') return;
    this.set('lock', reason);
  }
  status(): { locked: boolean; reason: string | null; reservedUnknownMicroUsd: number } {
    return { locked: !!this.meta('lock'), reason: this.meta('lock') ?? null, reservedUnknownMicroUsd: (this.db.prepare("SELECT COALESCE(SUM(reserved),0) AS n FROM provider_calls WHERE actual IS NULL").get() as { n: number }).n };
  }
  reserve(input: ReserveInput): Reservation {
    this.purge();
    const now = this.nowWall();
    const prior = Number(this.meta('last_wall') ?? now);
    if (!Number.isFinite(now) || now < prior) { this.lock('day_regression'); throw new BudgetError('locked'); }
    this.set('last_wall', String(now));
    return this.db.transaction(() => {
      if (this.meta('lock') || this.isRetired(input.jobId)) throw new BudgetError('locked');
      const { caps, price } = input;
      if (![input.jobId,input.unitId,input.approvalId].every(v => id.test(v)) || !caps.enabled || !Number.isSafeInteger(input.requestUtf8Bytes) || input.requestUtf8Bytes < 0 || input.framingTokenBound !== 1024 || input.inputTokenBound !== input.requestUtf8Bytes + input.framingTokenBound || !Number.isSafeInteger(input.inputTokenBound) || input.inputTokenBound < 1024 || input.inputTokenBound > caps.inputTokenCap || input.outputTokenCap !== caps.outputTokenCap || !Number.isFinite(price.inputUsdPerMillion) || !Number.isFinite(price.outputUsdPerMillion) || price.inputUsdPerMillion < 0 || price.outputUsdPerMillion < 0 || price.otherChargeMicroUsd !== 0) throw new BudgetError('invalid');
      const reserved = reserveMicroUsd(input.inputTokenBound,input.outputTokenCap,price);
      const day = new Date(now).toISOString().slice(0,10);
      const used = (where: string, ...args: unknown[]) => (this.db.prepare(`SELECT COALESCE(SUM(COALESCE(actual,reserved)),0) AS n FROM provider_calls WHERE ${where}`).get(...args) as { n: number }).n;
      const unit = this.db.prepare('SELECT COUNT(*) AS n FROM provider_calls WHERE job_id=? AND unit_id=?').get(input.jobId,input.unitId) as { n: number };
      const cases = this.db.prepare('SELECT COUNT(DISTINCT unit_id) AS n FROM provider_calls WHERE job_id=?').get(input.jobId) as { n: number };
      const job = this.db.prepare('SELECT profile,approval_id,model,price_snapshot FROM provider_calls WHERE job_id=? LIMIT 1').get(input.jobId) as { profile: string; approval_id: string; model: string; price_snapshot: string } | undefined;
      const rateHash = createHash('sha256').update(JSON.stringify(price)).digest('hex');
      if (job && (job.profile !== input.profile || job.approval_id !== input.approvalId || job.model !== input.model || job.price_snapshot !== rateHash)) throw new BudgetError('invalid');
      const retainedDay = (this.db.prepare('SELECT actual FROM provider_daily_totals WHERE profile=? AND day=?').get(input.profile,day) as { actual: number } | undefined)?.actual ?? 0;
      if (unit.n >= 2 || (!unit.n && cases.n >= caps.approvedCaseCount) || reserved > usdMicro(caps.callCapUsd) || used('job_id=? AND unit_id=?',input.jobId,input.unitId)+reserved > usdMicro(caps.unitCapUsd) || retainedDay+used('profile=? AND day=?',input.profile,day)+reserved > usdMicro(caps.dayCapUsd) || used('job_id=?',input.jobId)+reserved > usdMicro(caps.jobCapUsd)) throw new BudgetError('limited');
      const callId = randomUUID();
      this.db.prepare('INSERT INTO provider_calls(call_id,job_id,unit_id,approval_id,profile,day,model,price_snapshot,input_rate,output_rate,input_bound,output_cap,reserved,status,request_utf8_bytes,framing_token_bound,created_wall) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(callId,input.jobId,input.unitId,input.approvalId,input.profile,day,input.model,rateHash,price.inputUsdPerMillion,price.outputUsdPerMillion,input.inputTokenBound,input.outputTokenCap,reserved,'pending',input.requestUtf8Bytes,input.framingTokenBound,now);
      return { callId, reservedMicroUsd: reserved, inputTokenBound: input.inputTokenBound, outputTokenCap: input.outputTokenCap };
    }).immediate();
  }
  reconcile(callId: string, usage: { inputTokens: number; outputTokens: number } | null, providerRequestId: string | null = null): number | null {
    const actual = this.db.transaction(() => {
      const row = this.db.prepare('SELECT * FROM provider_calls WHERE call_id=?').get(callId) as CallRow | undefined;
      if (!row) throw new BudgetError('invalid');
      if (row.actual !== null) return row.actual;
      if (!usage || ![usage.inputTokens,usage.outputTokens].every(n => Number.isSafeInteger(n) && n >= 0)) {
        this.db.prepare("UPDATE provider_calls SET status='reserved_unknown' WHERE call_id=?").run(callId); this.lock('unknown'); return null;
      }
      const actual = Math.ceil(usage.inputTokens*row.input_rate + usage.outputTokens*row.output_rate);
      if (!Number.isSafeInteger(actual)) throw new BudgetError('invalid');
      this.db.prepare("UPDATE provider_calls SET actual=?,input_tokens=?,output_tokens=?,request_id=?,status='known' WHERE call_id=?").run(actual,usage.inputTokens,usage.outputTokens,providerRequestId && /^[A-Za-z0-9_-]{1,200}$/.test(providerRequestId) ? providerRequestId : null,callId);
      if (actual > row.reserved || usage.inputTokens > row.input_bound || usage.outputTokens > row.output_cap) this.lock('usage_overrun');
      return actual;
    }).immediate();
    this.purge();
    return actual;
  }
  // The owner explicitly verifies provider records, or retains unknowns at full reserve.
  confirmReconciliation(input: { providerRecordsVerified: true; retainUnknownAtFullReserve: true; verifiedThroughWallMs: number }): void {
    if (input.providerRecordsVerified !== true || input.retainUnknownAtFullReserve !== true || !Number.isFinite(input.verifiedThroughWallMs) || input.verifiedThroughWallMs < Number(this.meta('last_wall') ?? 0) || this.meta('lock') === 'usage_overrun') throw new BudgetError('locked');
    this.db.transaction(() => { this.set('last_wall', String(input.verifiedThroughWallMs)); this.db.prepare("UPDATE provider_calls SET status='retained_unknown' WHERE actual IS NULL").run(); this.db.prepare("DELETE FROM provider_meta WHERE name='lock'").run(); }).immediate();
  }
}
