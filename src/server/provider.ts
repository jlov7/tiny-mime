import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import type { MotionScoreV1, Roster, ScoreError } from '../shared/score.js';
import { validateScore } from '../shared/validateScore.js';
import { scoreHash } from '../shared/hash.js';
import { normalizeGuess } from '../shared/normalizeGuess.js';
import { parseJsonStrict } from '../shared/parseJson.js';
import { BudgetError, BudgetLedger, type Reservation } from './budget.js';
import { requireActivation, validateProviderConfig, type ActivationEvidence, type ProviderConfigV1 } from './providerConfig.js';
import { DIRECTOR_TEMPLATE, PROVIDER_SCHEMA_BYTE_HASH } from './provider/template.js';
import projection from './provider/provider-motion-score-v1.schema.json' with { type: 'json' };

export type GenerationProfile = 'practice_blind_v1' | 'runtime_informed_v1' | 'runtime_blind_v1' | 'development_probe_informed_v1' | 'development_probe_blind_v1';
const actorId = z.enum(['a','b','c']);
const assertion = z.object({ id: z.string(), assertion: z.string() }).strict();
const meaningSchema = z.object({ contractVersion: z.literal('sceneMeaningV1'), meaningId: z.string().min(1).max(80), target: z.string(), cast: z.array(z.object({ actorId, shape: z.enum(['circle','square','triangle']), color: z.enum(['violet','amber','teal']), role: z.string() }).strict()), coreEvent: z.array(assertion), roleBindings: z.array(z.object({ role: z.string(), actorIds: z.array(actorId) }).strict()), allowedElaborations: z.array(z.string()), contradictions: z.array(assertion), geometryVersion: z.literal('svg-shapes-v1'), contactPolicy: z.literal('noncontact-v1') }).strict();
export type DirectorMeaningV1 = z.infer<typeof meaningSchema>;
export type GenerateContext = { sceneMeaning: DirectorMeaningV1; roster: Roster; attempt: 2; previousScore: MotionScoreV1; generationProfile: GenerationProfile; firstGuessOccurred: true; repairErrors: ScoreError[] | null; guessData: { kind: 'actual'; text: string } | { kind: 'withheld' } };
const errorSchema = z.object({ code: z.enum(['PARSE','BYTES','DEPTH','DUPLICATE_KEY','UNKNOWN_KEY','SCHEMA','ROSTER','TIMELINE','BOUNDS','SPEED','CONTACT','CONTACT_UNCERTAIN']), path: z.string().min(1).max(200) }).strict();
const contextSchema = z.object({ sceneMeaning: meaningSchema, roster: z.array(z.object({ id: actorId, shape: z.enum(['circle','square','triangle']), color: z.enum(['violet','amber','teal']) }).strict()).min(2).max(3), attempt: z.literal(2), previousScore: z.unknown(), generationProfile: z.enum(['practice_blind_v1','runtime_informed_v1','runtime_blind_v1','development_probe_informed_v1','development_probe_blind_v1']), firstGuessOccurred: z.literal(true), guessData: z.discriminatedUnion('kind',[z.object({ kind: z.literal('actual'), text: z.string() }).strict(),z.object({ kind: z.literal('withheld') }).strict()]), repairErrors: z.array(errorSchema).min(1).max(20).nullable() }).strict();
export const providerVersions = { promptVersion: 'director-template-v1', schemaHash: PROVIDER_SCHEMA_BYTE_HASH, templateHash: createHash('sha256').update(DIRECTOR_TEMPLATE).digest('hex') };
export type CompiledRequest = { body: Record<string, unknown>; bodyJson: string; requestUtf8Bytes: number; inputTokenBound: number };
export function compileRequest(context: GenerateContext, model: string, outputCap: number): CompiledRequest {
  const parsed = contextSchema.parse(context);
  const informed = parsed.generationProfile.endsWith('informed_v1');
  if (informed !== (parsed.guessData.kind === 'actual') || !model || model.length > 200 || ![6000,12000].includes(outputCap) || (parsed.generationProfile.startsWith('development_probe_') ? outputCap !== 12000 : outputCap !== 6000)) throw new ProviderFailure('provider_error');
  if (parsed.guessData.kind === 'actual') {
    const normalized = normalizeGuess(parsed.guessData.text);
    if (typeof normalized !== 'string' || normalized !== parsed.guessData.text) throw new ProviderFailure('provider_error');
  }
  const prior = validateScore(JSON.stringify(parsed.previousScore),parsed.roster);
  if (!prior.ok || JSON.stringify(parsed.sceneMeaning.cast.map(a => ({ id:a.actorId,shape:a.shape,color:a.color }))) !== JSON.stringify(parsed.roster)) throw new ProviderFailure('provider_error');
  // This order is frozen by the complete source-pack request fixtures.
  const allowlisted = { sceneMeaning: parsed.sceneMeaning, roster: parsed.roster, attempt: 2, previousScore: parsed.previousScore, generationProfile: parsed.generationProfile, firstGuessOccurred: true, guessData: parsed.guessData, repairErrors: parsed.repairErrors };
  const body = { model, store:false, stream:false, background:false, max_output_tokens:outputCap, instructions:DIRECTOR_TEMPLATE, input:[{role:'user',content:[{type:'input_text',text:JSON.stringify(allowlisted)}]}], text:{format:{type:'json_schema',name:'motion_score_v1',strict:true,schema:projection}} };
  const bodyJson = JSON.stringify(body);
  const requestUtf8Bytes = Buffer.byteLength(bodyJson,'utf8');
  const inputTokenBound = requestUtf8Bytes+1024;
  if (inputTokenBound > 32768) throw new ProviderFailure('limited');
  return { body,bodyJson,requestUtf8Bytes,inputTokenBound };
}
export type FailureCode = 'provider_disabled' | 'limited' | 'invalid_output' | 'provider_error' | 'refusal' | 'deadline' | 'cancelled';
export class ProviderFailure extends Error { constructor(public readonly failure: FailureCode) { super(`Generation ${failure}`); } }
export type ProviderResult = { rawJson: string; providerRequestId: string | null; model: string; inputTokens: number | null; outputTokens: number | null; status: 'completed' | 'refusal' | 'incomplete'; failure?: FailureCode; responseBytes?: Uint8Array };
export interface ScoreProvider { generate(context: GenerateContext, signal: AbortSignal): Promise<ProviderResult>; }
export type ProviderTransport = (url: string, init: RequestInit) => Promise<Response>;
export class OpenAIResponsesProvider implements ScoreProvider {
  constructor(private readonly model: string, private readonly outputCap: number, private readonly apiKey: string, private readonly transport: ProviderTransport = fetch, private readonly onResponseBytes?: (bytes: Uint8Array) => void) {}
  async generate(context: GenerateContext, signal: AbortSignal): Promise<ProviderResult> {
    const request = compileRequest(context,this.model,this.outputCap);
    const response = await this.transport('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${this.apiKey}`,'Content-Type':'application/json'},body:request.bodyJson,signal,redirect:'error'});
    const requestId = response.headers.get('x-request-id');
    const result: ProviderResult = { rawJson:'', providerRequestId: requestId && /^[A-Za-z0-9_-]{1,200}$/.test(requestId) ? requestId : null, model:this.model, inputTokens:null, outputTokens:null, status:'incomplete', failure:'provider_error' };
    if (!response.body) return result;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        const remaining=262144-size;
        chunks.push(part.value.subarray(0,remaining)); size += part.value.length;
        result.responseBytes=Buffer.concat(chunks); this.onResponseBytes?.(result.responseBytes);
        if (size > 262144) { await reader.cancel(); return result; }
      }
    } catch { result.responseBytes=Buffer.concat(chunks); return result; }
    const bytes = Buffer.concat(chunks); result.responseBytes = bytes;
    let data: Record<string, unknown>;
    try { data = parseJsonStrict(new TextDecoder('utf-8',{fatal:true}).decode(bytes),{maxBytes:262144,maxDepth:32}) as Record<string,unknown>; } catch { return result; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return result;
    const usage = data.usage as Record<string,unknown> | undefined;
    const count=(value:unknown):value is number=>Number.isSafeInteger(value) && (value as number)>=0 && (value as number)<=1000000;
    const subtotal=(details:unknown,key:string,total:unknown)=>details===undefined || (!!details && typeof details==='object' && !Array.isArray(details) && Object.keys(details).every(k=>k===key) && count((details as Record<string,unknown>)[key]) && count(total) && ((details as Record<string,number>)[key] <= total));
    if (usage && typeof usage==='object' && !Array.isArray(usage) && Object.keys(usage).every(k=>['input_tokens','output_tokens','total_tokens','input_tokens_details','output_tokens_details'].includes(k)) && count(usage.input_tokens) && count(usage.output_tokens) && count(usage.total_tokens) && usage.total_tokens===usage.input_tokens+usage.output_tokens && subtotal(usage.input_tokens_details,'cached_tokens',usage.input_tokens) && subtotal(usage.output_tokens_details,'reasoning_tokens',usage.output_tokens)) { result.inputTokens=usage.input_tokens; result.outputTokens=usage.output_tokens; }
    if (!response.ok || data.model !== this.model) return result;
    if (data.status === 'incomplete') { result.failure=undefined; return result; }
    if (data.status !== 'completed' || !Array.isArray(data.output)) return result;
    const messages = data.output.filter((v: unknown) => !!v && typeof v === 'object' && (v as {type?: string}).type !== 'reasoning');
    if (messages.length !== 1) return result;
    const message = messages[0] as {type?:string;role?:string;content?:unknown[];status?:string};
    if (message.type !== 'message' || message.role !== 'assistant' || message.status !== 'completed' || !Array.isArray(message.content) || message.content.length !== 1) return result;
    const content = message.content[0] as {type?:string;text?:unknown};
    if (content?.type === 'refusal') return { ...result,status:'refusal',failure:'refusal' };
    if (result.inputTokens===null || result.outputTokens===null) return result;
    if (content?.type !== 'output_text' || typeof content.text !== 'string' || Buffer.byteLength(content.text,'utf8') > 65536) return result;
    return { ...result,rawJson:content.text,status:'completed',failure:undefined };
  }
}
export type AttemptRecord = { attempt: 1 | 2; compiled: CompiledRequest; result: ProviderResult | null; startedAt: string; elapsedMs: number; termination: 'validated' | 'invalid_output' | 'refusal' | 'incomplete' | 'provider_error' | 'deadline' | 'cancelled'; validationErrors: ScoreError[]; scoreHash: string | null; reservation: Reservation; actualMicroUsd: number | null };
export type GenerationPolicy = { config: ProviderConfigV1; ledger: BudgetLedger; jobId: string; unitId: string; deadlineMonoMs: number; provider?: ScoreProvider; transport?: ProviderTransport; apiKey?: string; activationEvidence?: ActivationEvidence; nowMono?: () => number; nowWall?: () => number; onAttempt?: (attempt: AttemptRecord) => void | Promise<void> };
export type ValidatedGenerationResult = { ok:true; score:MotionScoreV1; scoreHash:string; noChange:boolean; attempts:number; calls:number } | { ok:false; failure:FailureCode; attempts:number; calls:number };
export async function generateValidated(context: GenerateContext, policy: GenerationPolicy, signal: AbortSignal): Promise<ValidatedGenerationResult> {
  const nowMono = policy.nowMono ?? (() => performance.now());
  const nowWall = policy.nowWall ?? Date.now;
  const probe = context.generationProfile.startsWith('development_probe_');
  const profile = probe ? 'qualityProbe' : 'runtime';
  const caps = policy.config[profile];
  const start = nowMono();
  const deadline = Math.min(policy.deadlineMonoMs,start+(probe ? 90000 : 15000));
  let calls=0;
  let diagnosticWriteFailed=false;
  const fail = (failure:FailureCode): ValidatedGenerationResult => ({ok:false,failure,attempts:calls,calls});
  try {
    validateProviderConfig(policy.config,nowWall());
    if (policy.config.provider === 'disabled' || !caps.enabled) return fail('provider_disabled');
    // Transport/provider injection cannot bypass the activation or reservation gates.
    requireActivation(policy.config,policy.activationEvidence,policy.apiKey,nowWall());
    let observedResponseBytes: Uint8Array | undefined;
    const provider = policy.provider ?? new OpenAIResponsesProvider(policy.config.modelId!,caps.outputTokenCap,policy.apiKey!,policy.transport,bytes=>{observedResponseBytes=bytes;});
    let authorizedContext: GenerateContext = {...context,repairErrors:null};
    for (let index=0;index<2;index++) {
      if (signal.aborted) return fail('cancelled');
      if (nowMono() >= deadline || !Number.isFinite(deadline)) return fail('deadline');
      const compiled = compileRequest(authorizedContext,policy.config.modelId!,caps.outputTokenCap);
      observedResponseBytes=undefined;
      const reservation = policy.ledger.reserve({jobId:policy.jobId,unitId:policy.unitId,approvalId:policy.config.approval!.approvalId,profile,model:policy.config.modelId!,price:policy.config.priceSnapshot!,caps,requestUtf8Bytes:compiled.requestUtf8Bytes,framingTokenBound:1024,inputTokenBound:compiled.inputTokenBound,outputTokenCap:caps.outputTokenCap});
      const controller = new AbortController();
      const abort = () => controller.abort(); signal.addEventListener('abort',abort,{once:true});
      const callStart=nowMono(); let result: ProviderResult | null=null;
      const record: AttemptRecord = {attempt:(index+1) as 1|2,compiled,result:null,startedAt:new Date(nowWall()).toISOString(),elapsedMs:0,termination:'provider_error',validationErrors:[],scoreHash:null,reservation,actualMicroUsd:null};
      calls++;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        result = await Promise.race([provider.generate(authorizedContext,controller.signal),new Promise<never>((_,reject) => { timer=setTimeout(() => { controller.abort(); reject(new ProviderFailure('deadline')); },Math.max(0,Math.min(probe ? 45000 : 7000,deadline-callStart))); }),new Promise<never>((_,reject) => { controller.signal.addEventListener('abort',() => reject(new ProviderFailure(signal.aborted ? 'cancelled' : 'deadline')),{once:true}); })]);
        record.result=result;
        record.actualMicroUsd=policy.ledger.reconcile(reservation.callId,result.inputTokens === null || result.outputTokens === null ? null : {inputTokens:result.inputTokens,outputTokens:result.outputTokens},result.providerRequestId);
        if (signal.aborted) throw new ProviderFailure('cancelled');
        if (nowMono() >= deadline || nowMono()-callStart >= (probe ? 45000 : 7000)) throw new ProviderFailure('deadline');
        if (result.status !== 'completed' || result.failure) { record.termination=result.status === 'refusal' ? 'refusal' : result.status === 'incomplete' && !result.failure ? 'incomplete' : 'provider_error'; return fail(result.failure ?? (result.status === 'refusal' ? 'refusal' : 'provider_error')); }
        if (policy.ledger.status().locked || result.model !== policy.config.modelId) throw new ProviderFailure('provider_error');
        const validated=validateScore(result.rawJson,context.roster);
        if (nowMono() >= deadline) throw new ProviderFailure('deadline');
        if (validated.ok) { record.termination='validated'; record.scoreHash=validated.scoreHash; return {ok:true,score:validated.score,scoreHash:validated.scoreHash,noChange:validated.scoreHash === scoreHash(context.previousScore),attempts:calls,calls}; }
        record.termination='invalid_output';
        record.validationErrors=validated.errors.slice(0,20).map(e => ({code:e.code,path:e.path.slice(0,200) || '/'}));
        authorizedContext={...context,repairErrors:record.validationErrors};
        if (index === 1) return fail('invalid_output');
      } catch (error) {
        if (!result) {
          policy.ledger.reconcile(reservation.callId,null);
          if (observedResponseBytes) record.result={rawJson:'',providerRequestId:null,model:policy.config.modelId!,inputTokens:null,outputTokens:null,status:'incomplete',responseBytes:observedResponseBytes};
        }
        const failure = error instanceof ProviderFailure ? error.failure : signal.aborted ? 'cancelled' : 'provider_error';
        record.termination=failure === 'cancelled' || failure === 'deadline' ? failure : 'provider_error';
        return fail(failure);
      } finally {
        if (timer) clearTimeout(timer); signal.removeEventListener('abort',abort); controller.abort();
        record.elapsedMs=Math.max(0,Math.min(90000,Math.round(nowMono()-callStart)));
        try { await policy.onAttempt?.(record); }
        catch (error) { diagnosticWriteFailed=true; throw error; }
      }
    }
  } catch (error) {
    if (diagnosticWriteFailed) throw error;
    return fail(error instanceof BudgetError ? 'limited' : error instanceof ProviderFailure ? error.failure : calls>0 ? 'provider_error' : 'provider_disabled');
  }
  return fail('invalid_output');
}
