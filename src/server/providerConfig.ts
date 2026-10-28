import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from './formats.js';
import { z } from 'zod';
import schema from './provider/provider-config-v1.schema.json' with { type: 'json' };
import defaults from './provider/provider-config.example.json' with { type: 'json' };

export type BudgetProfile = { enabled: boolean; callCapUsd: number; unitCapUsd: number; dayCapUsd: number; jobCapUsd: number; approvedCaseCount: number; inputTokenCap: 32768; outputTokenCap: 6000 | 12000 };
export type PriceSnapshot = { sourceUrl: string; checkedAt: string; inputUsdPerMillion: number; outputUsdPerMillion: number; otherChargeMicroUsd: 0; tokenAccountingVerified: true };
export type ProviderConfigV1 = { version: 1; provider: 'disabled' | 'openai_responses'; endpoint: 'https://api.openai.com/v1/responses'; modelId: string | null; currency: 'USD'; priceSnapshot: PriceSnapshot | null; approval: { approvalId: string; approvedAt: string; expiresAt: string; purpose: 'runtime_private_play' | 'runtime_study' | 'quality_probe' | 'runtime_and_quality_probe'; providerDisclosureVersion: string; budgetAcknowledged: true } | null; runtime: BudgetProfile; qualityProbe: BudgetProfile };
export const disabledProviderConfig = (): ProviderConfigV1 => structuredClone(defaults) as ProviderConfigV1;
export class ProviderConfigError extends Error { constructor() { super('Provider configuration is invalid or inactive'); } }
const ajv = new Ajv2020({ strict: false, allErrors: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv);
const validate = ajv.compile(schema);
export function validateProviderConfig(value: unknown, nowMs = Date.now()): ProviderConfigV1 {
  if (!validate(value)) throw new ProviderConfigError();
  const config = structuredClone(value) as ProviderConfigV1;
  const profiles = [config.runtime, config.qualityProbe];
  const inactive = (p: BudgetProfile) => !p.enabled && [p.callCapUsd, p.unitCapUsd, p.dayCapUsd, p.jobCapUsd, p.approvedCaseCount].every(v => v === 0);
  if (config.provider === 'disabled') {
    if (config.modelId !== null || config.priceSnapshot !== null || config.approval !== null || !profiles.every(inactive)) throw new ProviderConfigError();
    return config;
  }
  const { approval, priceSnapshot: price } = config;
  if (!config.modelId || !approval || !price || !profiles.some(p => p.enabled) || Date.parse(approval.approvedAt) > nowMs || Date.parse(approval.expiresAt) <= nowMs || Date.parse(approval.expiresAt) <= Date.parse(approval.approvedAt) || Date.parse(price.checkedAt) > nowMs || price.inputUsdPerMillion + price.outputUsdPerMillion <= 0) throw new ProviderConfigError();
  if (config.runtime.enabled && !['runtime_private_play', 'runtime_study', 'runtime_and_quality_probe'].includes(approval.purpose)) throw new ProviderConfigError();
  if (config.qualityProbe.enabled && !['quality_probe', 'runtime_and_quality_probe'].includes(approval.purpose)) throw new ProviderConfigError();
  for (const p of profiles) {
    if (!p.enabled) { if (!inactive(p)) throw new ProviderConfigError(); continue; }
    if ([p.callCapUsd, p.unitCapUsd, p.dayCapUsd, p.jobCapUsd].some(v => usdMicro(v) <= 0) || p.approvedCaseCount <= 0 || p.unitCapUsd < p.callCapUsd || p.dayCapUsd < p.unitCapUsd || p.jobCapUsd < p.unitCapUsd || p.approvedCaseCount * usdMicro(p.unitCapUsd) > usdMicro(p.jobCapUsd)) throw new ProviderConfigError();
  }
  return config;
}
export const usdMicro = (usd: number): number => Math.floor(usd * 1_000_000);

// This operator record binds capability/accounting evidence to the exact approved model.
export const activationEvidenceSchema = z.object({ version: z.literal(1), modelId: z.string().min(1).max(200), officialSourceUrl: z.url().refine(s => /^https:\/\/(developers\.openai\.com|openai\.com)\//.test(s)), checkedAt: z.iso.datetime(), responsesSupported: z.literal(true), strictStructuredOutputsSupported: z.literal(true), inputBytesPlus1024Verified: z.literal(true), boundedOutputBillingVerified: z.literal(true), explicitSpendingApproved: z.literal(true), approvalId: z.uuidv4(), providerDisclosureVersion: z.string().min(1).max(80) }).strict();
export type ActivationEvidence = z.infer<typeof activationEvidenceSchema>;
export function requireActivation(config: ProviderConfigV1, evidence: unknown, apiKey: string | undefined, nowMs = Date.now()): ActivationEvidence {
  validateProviderConfig(config, nowMs);
  const parsed = activationEvidenceSchema.safeParse(evidence);
  if (config.provider !== 'openai_responses' || !apiKey || !parsed.success || parsed.data.modelId !== config.modelId || parsed.data.approvalId !== config.approval?.approvalId || parsed.data.providerDisclosureVersion !== config.approval.providerDisclosureVersion || Date.parse(parsed.data.checkedAt) > nowMs || Date.parse(parsed.data.checkedAt) < Date.parse(config.approval.approvedAt)) throw new ProviderConfigError();
  return parsed.data;
}
export function validateProviderEnvironment(env: Record<string, string | undefined>, config: ProviderConfigV1): void {
  const allowed = new Set(['TM_HOST','TM_PORT','TM_DATA_DIR','TM_PROVIDER_CONFIG','TM_PROVIDER_MODE','TM_MODEL_ID','TM_STUDY_ENABLED','TM_STUDY_MANIFEST']);
  if (Object.keys(env).some(k => k.startsWith('TM_') && !allowed.has(k)) || (env.TM_PROVIDER_MODE ?? 'disabled') !== config.provider || (config.provider === 'disabled' ? !!env.TM_MODEL_ID : env.TM_MODEL_ID !== config.modelId)) throw new ProviderConfigError();
}
