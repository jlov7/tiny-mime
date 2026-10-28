import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import Database from 'better-sqlite3';
import { z } from 'zod';
import { apiError, isApiError, type ApiErrorCode, type SessionContext } from '../shared/api.js';
import { canonicalHash } from '../shared/hash.js';
import { ParseFailure, parseJsonStrict } from '../shared/parseJson.js';
import { normalizeGuess } from '../shared/normalizeGuess.js';
import { validateScore } from '../shared/validateScore.js';
import { CONTACT_CERTIFICATE_VERSION, GEOMETRY_VERSION } from '../shared/score.js';
import { matchesContract, parseRequest, uuidPattern } from './contracts.js';
import { SessionManager, cookieValue, sessionCookie, type Session } from './sessions.js';
import { RoundService, type InternalRound } from './rounds.js';
import { EventService } from './events.js';
import { OperatorAccess } from './operator/access.js';
import { listScenes, getScene, disabledScenes, developmentIds, comparisonIds, directorMeaning } from './operator/sceneBank.js';
import { listReferences } from './references/index.js';
import { buildCapture, captureTiming, type CaptureRecord } from './operator/capture.js';
import { CaptureTraceStore, captureTraceSchema } from './operator/captureTrace.js';
import { CandidateStore, CandidateError, candidateInputSchema, candidateRemovalSchema } from './operator/workspace.js';
import { WorkspaceTransferError, parseWorkspaceSnapshot } from './operator/workspaceTransfer.js';
import { workspaceMaxBytes } from './operator/workspaceRecords.js';
import { buildInspection } from './operator/inspection.js';
import { listShowcases } from './operator/showcase.js';
import { BudgetLedger } from './budget.js';
import { disabledProviderConfig, requireActivation, validateProviderConfig, validateProviderEnvironment, type ProviderConfigV1, type ActivationEvidence } from './providerConfig.js';
import { generateValidated, providerVersions, type GenerationProfile } from './provider.js';
import { prepareDataDir, lockDataDir, openPrivateDb } from './storage/db.js';
import { StudyService, StudyError, type StudyScene, type LiveQualification } from './study/service.js';
import { withdrawalLookup } from './study/consent.js';

export const ORIGIN = 'http://127.0.0.1:4317';
const errorStatus: Record<ApiErrorCode, number> = { INVALID_INPUT: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, STALE: 409, IDEMPOTENCY_CONFLICT: 409, ACTIVE_ROUND: 409, EXPIRED: 410, LIMITED: 429, UNAVAILABLE: 503, DEADLINE: 504 };
const operatorCookie = (token = '', age = 1800) => `tm_operator=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}`;
const safeRead = (file: string, max = 262144) => {
  if (!path.isAbsolute(file) || statSync(file).size > max) throw new Error('CONFIGURATION');
  return parseJsonStrict(new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(file)), { maxBytes: max, maxDepth: 20 });
};
export type ApplicationOptions = { development?: boolean; dataDir?: string; memory?: boolean; onLaunchSecret?: (secret: string) => void; nowWall?: () => number; nowMono?: () => number; fixtureDelayMs?: number };

export async function createApplication(options: ApplicationOptions = {}) {
  const wall = options.nowWall ?? Date.now;
  const mono = options.nowMono ?? (() => performance.now());
  const environment = z.object({ TM_HOST: z.literal('127.0.0.1').default('127.0.0.1'), TM_PORT: z.literal('4317').default('4317'), TM_DATA_DIR: z.string().optional(), TM_PROVIDER_CONFIG: z.string().optional(), TM_STUDY_ENABLED: z.enum(['false', 'true']).default('false'), TM_STUDY_MANIFEST: z.string().optional() }).passthrough().parse(process.env);
  let config: ProviderConfigV1 = environment.TM_PROVIDER_CONFIG ? validateProviderConfig(safeRead(environment.TM_PROVIDER_CONFIG), wall()) : disabledProviderConfig();
  validateProviderEnvironment(process.env, config);
  let evidence: ActivationEvidence | undefined;
  if (config.provider !== 'disabled') evidence = requireActivation(config, safeRead(environment.TM_PROVIDER_CONFIG! + '.evidence.json'), process.env.OPENAI_API_KEY, wall());
  const dir = options.memory ? null : prepareDataDir(options.dataDir ?? environment.TM_DATA_DIR);
  const release = dir ? lockDataDir(dir) : () => {};
  const ledgerDb = dir ? openPrivateDb(dir, 'ledger.sqlite') : new Database(':memory:');
  const ledger = new BudgetLedger(ledgerDb, wall);
  const fixtureDb = dir ? openPrivateDb(dir, 'fixture-rehearsals.sqlite') : new Database(':memory:');
  const workspaceDb = dir ? openPrivateDb(dir, 'rehearsal-workspace.sqlite') : new Database(':memory:');
  const workspace = new CandidateStore(workspaceDb, wall);
  const researchDb = environment.TM_STUDY_ENABLED === 'true' ? dir ? openPrivateDb(dir, 'research.sqlite') : new Database(':memory:') : new Database(':memory:');
  const sessions = new SessionManager(wall);
  const operator = new OperatorAccess(options.onLaunchSecret ?? (secret => { if (process.stdout.isTTY) process.stdout.write(`Tiny Mime operator launch secret (one use): ${secret}\n`); }), wall);
  const workloadId = config.approval?.approvalId ?? randomUUID();
  let retentionHealthy = true;
  const liveAvailable = (mode: 'private_play' | 'study' = 'private_play') => { try { validateProviderConfig(config, wall()); return retentionHealthy && config.provider === 'openai_responses' && config.runtime.enabled && !ledger.status().locked && [mode === 'study' ? 'runtime_study' : 'runtime_private_play', 'runtime_and_quality_probe'].includes(config.approval?.purpose ?? ''); } catch { return false; } };
  const qualification = (): LiveQualification => ({ enabled: environment.TM_STUDY_ENABLED === 'true' && liveAvailable('study'), budgetApproved: liveAvailable('study'), providerDisclosureVersion: config.approval?.providerDisclosureVersion ?? '', modelVersion: config.modelId ?? '', promptVersion: providerVersions.promptVersion + ':' + providerVersions.templateHash, rendererVersion: GEOMETRY_VERSION, contactPolicyVersion: 'noncontact-v1' });
  const authored = [...developmentIds, ...comparisonIds].map(id => getScene(id)!);
  const syntheticPhysical = new Set<string>([...comparisonIds.slice(0, 4), ...developmentIds]);
  const fixtureCatalogue: StudyScene[] = authored.map(s => ({ sceneId: s.id, meaning: s.meaning, rubric: s.meaning.targetRubric, scoreHash: s.scoreHash, score: s.score, category: syntheticPhysical.has(s.id) ? 'physical' : 'social', authoringMethod: s.authorship.authoringMethod, humanReview: 'not_run' }));
  const fixtureStudy = new StudyService(fixtureDb, { now: wall, catalogue: fixtureCatalogue });
  let realCatalogue: StudyScene[] = [];
  if (environment.TM_STUDY_ENABLED === 'true') {
    if (!environment.TM_STUDY_MANIFEST || !qualification().enabled || !qualification().budgetApproved) throw new Error('STUDY_CONFIGURATION');
    const categories = z.record(z.string(), z.enum(['physical', 'social'])).parse(safeRead(environment.TM_STUDY_MANIFEST + '.categories.json'));
    realCatalogue = authored.map(s => { if (!categories[s.id]) throw new Error('STUDY_CATEGORIES'); return { sceneId: s.id, meaning: s.meaning, rubric: s.meaning.targetRubric, scoreHash: s.scoreHash, score: s.score, category: categories[s.id]!, authoringMethod: s.authorship.authoringMethod, humanReview: s.authorship.humanReview }; });
  }
  const realStudy = new StudyService(researchDb, { now: wall, catalogue: realCatalogue, liveQualification: qualification });
  fixtureStudy.terminateInterruptedSessions(); realStudy.terminateInterruptedSessions();
  let liveManifest: any = null;
  if (environment.TM_STUDY_ENABLED === 'true') {
    liveManifest = safeRead(environment.TM_STUDY_MANIFEST!);
    // Browser enrollment cannot create approval evidence or silently freeze a changed run.
    const stored = realStudy.readRun(liveManifest.studyRunId);
    if (canonicalHash(stored.manifest) !== canonicalHash(liveManifest)) throw new Error('STUDY_FREEZE');
  }
  const studyById = new Map<string, StudyService>();
  const studyRound = new Map<string, StudyService>();
  const study = {
    nextRound(owner: string, id: string) { const service = studyById.get(id); if (!service) throw new StudyError('NOT_FOUND'); return service.nextRound(owner, id); },
    attachRound(owner: string, id: string, round: string, plan: any) { const service = studyById.get(id)!; service.attachRound(owner, id, round, plan); studyRound.set(round, service); },
    assignAfterFirstGuess(owner: string, id: string, round: string) { return studyById.get(id)!.assignAfterFirstGuess(owner, id, round); },
    recordRound(round: string, patch: any) { studyRound.get(round)?.recordRound(round, patch); },
    finishRound(round: string) { studyRound.get(round)?.finishRound(round); },
    recordEvent(round: string, event: any) { studyRound.get(round)?.recordEvent(round, event); },
    recordFeedback(round: string, input: any) { studyRound.get(round)?.recordFeedback(round, input); },
    transaction(effect: () => void) { fixtureDb.transaction(() => researchDb.transaction(effect)())(); },
  };
  let sceneIndex = 0;
  const priorScene = new WeakMap<Session, string>();
  const captureTraces = new CaptureTraceStore();
  const rounds = new RoundService({ sessions, nowWall: wall, nowMono: mono, liveEnabled: liveAvailable, onDispose: id => captureTraces.clear([id]), disclosureVersion: () => config.approval?.providerDisclosureVersion ?? null, study,
    scene(id, session) { let scene = id ? getScene(id) : authored[sceneIndex++ % authored.length]; if (!scene) throw new Error('SCENE'); if (!id && scene.id === priorScene.get(session)) scene = authored[sceneIndex++ % authored.length]; priorScene.set(session, scene.id); return scene; },
    async director(r, signal) {
      if (r.public.executionMode === 'fixture') {
        await new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, options.fixtureDelayMs ?? 650); signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('ABORTED')); }, { once: true }); });
        return { ok: true, score: structuredClone(r.scene.score), scoreHash: r.scene.scoreHash };
      }
      if (!liveAvailable(r.public.mode)) return { ok: false, failure: 'provider_disabled' };
      const profile = r.generationProfile as GenerationProfile;
      const result = await generateValidated({ sceneMeaning: directorMeaning(r.scene.meaning as any), roster: r.scene.score.actors.map(({ id, shape, color }) => ({ id, shape, color })), attempt: 2, previousScore: r.scene.score, generationProfile: profile, firstGuessOccurred: true, repairErrors: null, guessData: profile === 'runtime_informed_v1' ? { kind: 'actual', text: r.public.guesses[0].text } : { kind: 'withheld' } }, { config, ledger, jobId: workloadId, unitId: r.public.roundId, deadlineMonoMs: r.deadlineMono!, apiKey: process.env.OPENAI_API_KEY, activationEvidence: evidence, nowMono: mono, nowWall: wall }, signal);
      if (r.studySessionId) { const usage = ledger.summaryForUnit(workloadId, r.public.roundId); study.recordRound(r.public.roundId, { row: { provider_calls: usage.calls, validation_retries: Math.max(0, result.attempts - 1), input_tokens: usage.inputTokens, output_tokens: usage.outputTokens, estimated_cost: usage.actualMicroUsd === null ? null : usage.actualMicroUsd / 1000000, currency: usage.actualMicroUsd === null ? null : 'USD', model_version: config.modelId, prompt_version: providerVersions.promptVersion + ':' + providerVersions.templateHash } }); }
      return result;
    },
  });
  const events = new EventService({ access: (s, id) => rounds.internal(s, id), technicalAccess: (s, id) => rounds.technical(s, id), study, now: wall });
  type RequestBinding = { digest: string; contract: string; path: string; result?: unknown; expiresAt: number; capture?: { roundId: string; studySessionId: string | null } };
  const requestIds = new Map<string, RequestBinding>();
  let withdrawalAttempts: { owner: string; at: number }[] = [];
  const captures = new Map<string, { owner: string; roundId: string; studySessionId: string | null; bytes: Uint8Array; expiresAt: number; downloaded: boolean }>();
  const MAX_CACHE = 20 * 1024 * 1024;
  function captureRecord(r: InternalRound): CaptureRecord {
    const observations = events.observations(r.public.roundId);
    const playTimeline: any[] = [{ kind: 'act', attempt: 1, durationMs: r.public.acts[0].score.durationMs, playbackSpeed: 1, replay: false }, { kind: 'guess', attempt: 1, durationMs: 1500 }, { kind: 'wait', durationMs: r.actualWaitMs ?? 0 }, { kind: 'act', attempt: 2, durationMs: r.public.acts[1]?.score.durationMs ?? 0, playbackSpeed: 1, replay: false }, { kind: 'guess', attempt: 2, durationMs: 1500 }, { kind: 'reveal', durationMs: 1500 }];
    return { round: structuredClone(r.public), creatorOwned: r.creatorOwned, publicationPermission: null, actualWaitMs: r.actualWaitMs ?? 0, timeline: playTimeline, trace: captureTraces.read(r.public.roundId), serverGenerationMs: r.actualWaitMs, selectedExample: true, versions: { engine: GEOMETRY_VERSION, contact: CONTACT_CERTIFICATE_VERSION, meaning: String(r.scene.meaning.revision ?? 1), prompt: r.public.executionMode === 'live' ? providerVersions.promptVersion + ':' + providerVersions.templateHash : null, model: r.public.executionMode === 'live' ? config.modelId : null }, createdAt: new Date(wall()).toISOString(), playbackObservations: observations.playbackObservations, operationalOutcome: observations.operationalOutcome };
  }
  const output = (res: ServerResponse, status: number, value: unknown) => { const bytes = Buffer.from(JSON.stringify(value)); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': bytes.length }); res.end(bytes); };
  const result = (res: ServerResponse, value: any, status = 200) => output(res, isApiError(value) ? errorStatus[value.error.code] : status, value);
  const authenticated = (req: IncomingMessage): Session | undefined => sessions.lookup(cookieValue(req.headers.cookie, 'tm_session'));
  const authorizedOperator = (req: IncomingMessage) => operator.status(cookieValue(req.headers.cookie, 'tm_operator'));
  const readBody = async (req: IncomingMessage, max: number) => { let bytes = 0; const chunks: Buffer[] = []; for await (const chunk of req) { bytes += chunk.length; if (bytes > max) throw new Error('INVALID_INPUT'); chunks.push(chunk); } try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); } catch { throw new Error('INVALID_INPUT'); } };
  const mutations = new Map<string, string>([['/api/rounds', 'CreateRound'], ['/api/provider-consent', 'ProviderConsent'], ['/api/study-sessions', 'StudyStart'], ['/api/study-withdrawals', 'StudyWithdraw'], ['/api/operator/creator-rounds', 'CreatorRoundInput'], ['/api/operator/study-rehearsals', 'StudyRehearsalInput'], ['/api/operator/scores/validate', 'ScoreImportInput'], ['/api/operator/captures', 'CaptureInput'], ['/api/operator/exports', 'OperatorExportInput'], ['/api/operator/candidates', 'CandidateInput']]);
  const dynamic = (pathname: string) => {
    let m = /^\/api\/rounds\/([a-f0-9-]+)(?:\/(guesses|skip|abandon|events|feedback|requests\/([a-f0-9-]+)(?:\/status)?))?$/.exec(pathname);
    if (m) return { kind: 'round', id: m[1], action: m[2], requestId: m[3] };
    m = /^\/api\/study-sessions\/([a-f0-9-]+)(?:\/(feedback|finish))?$/.exec(pathname);
    if (m) return { kind: 'study', id: m[1], action: m[2], requestId: undefined };
    return null;
  };
  let vite: any = null;
  if (options.development) { const { createServer } = await import('vite'); vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' }); }
  const htmlTemplate = () => readFileSync(path.resolve(options.development ? 'index.html' : 'dist/client/index.html'), 'utf8');
  async function handler(req: IncomingMessage, res: ServerResponse) {
    const nonce = randomBytes(16).toString('base64');
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
    let requestId: string | null = null;
    try {
      const countHeader = (name: string) => req.rawHeaders.filter((_, i) => i % 2 === 0 && req.rawHeaders[i].toLowerCase() === name).length;
      if (countHeader('host') !== 1 || req.headers.host !== '127.0.0.1:4317' || countHeader('origin') > 1 || req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== ORIGIN)) return result(res, apiError('FORBIDDEN'));
      const url = new URL(req.url ?? '/', ORIGIN); const p = url.pathname; const method = req.method ?? 'GET';
      if (!['GET', 'POST', 'HEAD'].includes(method) || (p.startsWith('/api/') && (method === 'HEAD' || url.search))) return result(res, apiError('INVALID_INPUT'));
      if (method === 'POST' && (req.headers.origin !== ORIGIN || req.headers['content-encoding'] || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? ''))) return result(res, apiError('FORBIDDEN'));
      if (p === '/api/operator/status' && method === 'GET') { const status = authorizedOperator(req); return result(res, status ?? apiError('UNAUTHENTICATED')); }
      if (p === '/api/session' && method === 'POST') { const raw = await readBody(req, 4096); const value = parseJsonStrict(raw, { maxBytes: 4096, maxDepth: 8 }); if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).length) return result(res, apiError('INVALID_INPUT')); const s = sessions.establish(cookieValue(req.headers.cookie, 'tm_session')); res.setHeader('Set-Cookie', sessionCookie('tm_session', s.token, 28800)); return result(res, { sessionReady: true, activeRoundId: s.activeRoundId, recoveryOwnerId: s.sessionId }); }
      if (p === '/api/operator/bootstrap' && method === 'POST') { const input = parseRequest(await readBody(req, 4096), 'OperatorBootstrap'); const status = operator.bootstrap(input.launchSecret); if (!status) return result(res, apiError('UNAUTHENTICATED')); res.setHeader('Set-Cookie', operatorCookie(status.token)); return result(res, { operatorReady: true, expiresAt: status.expiresAt }); }
      if (p.startsWith('/api/operator/workspace/')) requestId = randomUUID();
      if (p.startsWith('/api/')) {
        const session = authenticated(req); if (!session) return result(res, apiError('UNAUTHENTICATED', requestId));
        const s: SessionContext = { sessionId: session.sessionId };
        if (p.startsWith('/api/operator/') && !authorizedOperator(req)) return result(res, apiError('FORBIDDEN', requestId));
        if (!retentionHealthy && (p.startsWith('/api/study-') || p.startsWith('/api/operator/exports') || p === '/api/operator/study-rehearsals')) return result(res, apiError('UNAVAILABLE'));
        if (p === '/api/operator/workspace/backup' && method === 'GET') {
          const bytes = Buffer.from(JSON.stringify(workspace.backup()));
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="tiny-mime-private-workspace.json"', 'Content-Length': bytes.length }); return res.end(bytes);
        }
        if (['/api/operator/workspace/restore-preview', '/api/operator/workspace/restore'].includes(p) && method === 'POST') {
          const raw = await readBody(req, workspaceMaxBytes + 256);
          if (!authenticated(req)) return result(res, apiError('UNAUTHENTICATED', requestId));
          if (!authorizedOperator(req)) return result(res, apiError('FORBIDDEN', requestId));
          if (p.endsWith('/restore-preview')) return result(res, workspace.previewRestore(parseWorkspaceSnapshot(raw)));
          return result(res, workspace.restore(parseJsonStrict(raw, { maxBytes: workspaceMaxBytes + 256, maxDepth: 15 })));
        }
        if (p === '/api/operator/lock' && method === 'POST') { const body = parseJsonStrict(await readBody(req, 4096)); if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) return result(res, apiError('INVALID_INPUT')); operator.lock(); res.setHeader('Set-Cookie', operatorCookie('', 0)); return result(res, { locked: true }); }
        const studyIdentity = /^\/api\/study-sessions\/([^/]+)\/rounds\/([^/]+)\/creation-requests\/([^/]+)\/status$/.exec(p);
        if (method === 'GET' && studyIdentity) return result(res, await rounds.readStudyCreationStatus(s, studyIdentity[1], studyIdentity[2], studyIdentity[3]));
        const d = dynamic(p);
        const requestStatus = d?.kind === 'round' && d.action?.endsWith('/status');
        if (d && (!uuidPattern.test(d.id!) || (requestStatus && !uuidPattern.test(d.requestId!)))) return result(res, apiError('NOT_FOUND'));
        if (d?.kind === 'study' && d.action === 'finish') (studyById.get(d.id!) ?? realStudy).progress(s.sessionId, d.id!);
        if (d?.kind === 'round') { const access = d.action === 'events' || requestStatus ? rounds.technical(s, d.id!) : rounds.internal(s, d.id!); if (isApiError(access)) return result(res, access); if (!retentionHealthy && access.studySessionId) return result(res, apiError('UNAVAILABLE')); }
        if (method === 'GET') {
          const startRequest = /^\/api\/study-start-requests\/([^/]+)$/.exec(p);
          if (startRequest) {
            if (!uuidPattern.test(startRequest[1])) return result(res, apiError('NOT_FOUND'));
            const binding = requestIds.get(s.sessionId + ':' + startRequest[1]);
            const accepted = binding && binding.expiresAt > wall() && ((binding.contract === 'StudyStart' && binding.path === '/api/study-sessions') || (binding.contract === 'StudyRehearsalInput' && binding.path === '/api/operator/study-rehearsals')) ? binding.result as { studySessionId: string } | undefined : undefined;
            return result(res, accepted ? { status: 'accepted', studySessionId: accepted.studySessionId } : { status: 'unknown' });
          }
          if (p === '/api/operator/showcases') return result(res, { examples: listShowcases() });
          if (p === '/api/operator/candidates') return result(res, { candidates: workspace.list() });
          const candidatePath = /^\/api\/operator\/candidates\/([^/]+)(\/inspection)?$/.exec(p);
          if (candidatePath) {
            const candidate = uuidPattern.test(candidatePath[1]) ? workspace.read(candidatePath[1]) : undefined;
            if (!candidate) return result(res, apiError('NOT_FOUND'));
            if (!candidatePath[2]) return result(res, { candidate });
            const bytes = buildInspection(candidate);
            res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="tiny-mime-inspection.zip"', 'Content-Length': bytes.length }); return res.end(bytes);
          }
          if (d?.kind === 'round') return result(res, requestStatus ? await rounds.readMutationRequestStatus(s, d.id!, d.requestId!) : d.action?.startsWith('requests/') ? await rounds.readMutationRequest(s, d.id!, d.requestId!) : d.action === 'feedback' ? events.feedbackStatus(s, d.id!) : d.action ? apiError('NOT_FOUND') : await rounds.read(s, d.id!));
          if (d?.kind === 'study' && !d.action) return result(res, (studyById.get(d.id!) ?? realStudy).progress(s.sessionId, d.id!));
          const create = /^\/api\/round-requests\/([a-f0-9-]+)$/.exec(p); if (create) return result(res, uuidPattern.test(create[1]) ? await rounds.readCreateRequest(s, create[1]) : apiError('NOT_FOUND'));
          if (p === '/api/operator/scenes') return result(res, { catalogueVersion: 'scene-meaning-v1', records: [...authored.map(v => v.meaning), ...disabledScenes.map(v => v.meaning)].sort((a, b) => a.sceneId.localeCompare(b.sceneId)) });
          const score = /^\/api\/operator\/scenes\/([^/]+)\/score$/.exec(p); if (score) { const sc = getScene(score[1]); return result(res, sc ? { sceneId: sc.id, scoreHash: sc.scoreHash, source: sc.source, authorship: sc.authorship, score: sc.score } : apiError('NOT_FOUND')); }
          const capture = /^\/api\/operator\/captures\/([a-f0-9-]+)$/.exec(p); if (capture) { const cached = captures.get(capture[1]); if (!cached || cached.owner !== s.sessionId) return result(res, apiError('NOT_FOUND')); if (cached.expiresAt <= wall() || cached.downloaded) return result(res, apiError('EXPIRED')); cached.downloaded = true; captures.delete(capture[1]); res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="tiny-mime-replay.zip"', 'Content-Length': cached.bytes.length }); return res.end(cached.bytes); }
          const exported = /^\/api\/operator\/exports\/([a-f0-9-]+)$/.exec(p); if (exported) { let file: ReturnType<StudyService['downloadExport']>; try { file = fixtureStudy.downloadExport(s.sessionId, exported[1]); } catch (e) { if (!(e instanceof StudyError) || e.code !== 'NOT_FOUND') throw e; file = realStudy.downloadExport(s.sessionId, exported[1]); } res.writeHead(200, { 'Content-Type': file.mime, 'Content-Disposition': `attachment; filename="${file.filename}"`, 'Content-Length': file.bytes.length }); return res.end(file.bytes); }
          return result(res, apiError('NOT_FOUND'));
        }
        const captureTracePath = /^\/api\/operator\/creator-rounds\/([^/]+)\/capture-trace$/.exec(p);
        if (captureTracePath && !uuidPattern.test(captureTracePath[1])) return result(res, apiError('NOT_FOUND'));
        const traceRound = captureTracePath ? rounds.internal(s, captureTracePath[1]) : null;
        if (traceRound && isApiError(traceRound)) return result(res, traceRound);
        const candidateRemoval = /^\/api\/operator\/candidates\/([^/]+)\/remove$/.exec(p);
        if (candidateRemoval && !uuidPattern.test(candidateRemoval[1])) return result(res, apiError('NOT_FOUND'));
        const contract = captureTracePath ? 'CreatorCaptureTrace' : candidateRemoval ? 'CandidateRemoval' : mutations.get(p) ?? (d?.kind === 'round' ? d.action === 'guesses' ? 'GuessInput' : ['skip', 'abandon'].includes(d.action ?? '') ? 'RoundMutation' : d.action === 'events' ? 'EventsInput' : d.action === 'feedback' ? 'FeedbackInput' : null : d?.kind === 'study' ? d.action === 'feedback' ? 'SessionFeedback' : d.action === 'finish' ? 'StudyFinishInput' : null : null);
        if (!contract) return result(res, apiError('NOT_FOUND'));
        const maximum = contract === 'CreatorCaptureTrace' ? 65536 : contract === 'EventsInput' ? 16384 : contract === 'ScoreImportInput' ? 70000 : contract === 'CandidateInput' ? 98304 : 4096;
        const raw = await readBody(req, maximum);
        const input = contract === 'CreatorCaptureTrace' ? captureTraceSchema.parse(parseJsonStrict(raw, { maxBytes: maximum, maxDepth: 5 })) : contract === 'CandidateInput' ? candidateInputSchema.parse(parseJsonStrict(raw, { maxBytes: maximum, maxDepth: 8 })) : contract === 'CandidateRemoval' ? candidateRemovalSchema.parse(parseJsonStrict(raw, { maxBytes: maximum, maxDepth: 2 })) : parseRequest(raw, contract, maximum); requestId = input.requestId;
        if (contract === 'StudyWithdraw' && (!sessions.owner(s.sessionId) || input.expectedRecoveryOwnerId !== s.sessionId)) return result(res, apiError('UNAUTHENTICATED', requestId));
        if (contract === 'GuessInput') { const text = normalizeGuess(input.guess); if (typeof text !== 'string') return result(res, { error: { ...text.error, requestId } }); input.guess = text; }
        const key = s.sessionId + ':' + requestId; const digest = canonicalHash({ method, path: p, payload: input }); const prior = requestIds.get(key);
        if (prior && prior.digest !== digest) return result(res, apiError('IDEMPOTENCY_CONFLICT', requestId));
        if (prior?.result !== undefined && !['CandidateInput', 'CandidateRemoval', 'CreatorCaptureTrace'].includes(contract)) return result(res, prior.result);
        if (!prior && requestIds.size >= 20000) return result(res, apiError('LIMITED', requestId));
        let value: any; let status = 200; let captureBinding: RequestBinding['capture'];
        if (p === '/api/rounds') { const duplicate = rounds.hasRequest(s, input.requestId); value = await rounds.create(s, input); status = duplicate ? 200 : 201; }
        else if (d?.kind === 'round') {
          if (d.action === 'guesses') { value = await rounds.submitGuess(s, d.id!, input); status = input.attempt === 1 ? 202 : 200; }
          else if (d.action === 'skip') value = await rounds.skip(s, d.id!, input);
          else if (d.action === 'abandon') value = await rounds.abandon(s, d.id!, input);
          else if (d.action === 'events') value = events.submit(s, d.id!, input);
          else if (d.action === 'feedback') value = events.feedback(s, d.id!, input);
        } else if (p === '/api/provider-consent') { if (!liveAvailable() || input.disclosureVersion !== config.approval?.providerDisclosureVersion) value = apiError('UNAVAILABLE', requestId); else { session.providerConsent = input.disclosureVersion; value = { accepted: true, disclosureVersion: input.disclosureVersion }; } }
        else if (p === '/api/operator/creator-rounds') { const duplicate = rounds.hasRequest(s, input.requestId); value = await rounds.createCreator(s, input); status = duplicate ? 200 : 201; }
        else if (p === '/api/operator/scores/validate') { const scene = getScene(input.sceneId); value = scene ? validateScore(JSON.stringify(input.score), scene.roster) : apiError('NOT_FOUND', requestId); }
        else if (captureTracePath) value = captureTraces.submit(traceRound!, s.sessionId, input, traceRound!.finalSubmissionRequestId);
        else if (candidateRemoval) value = workspace.remove(candidateRemoval[1], input);
        else if (p === '/api/operator/candidates') { value = { candidate: workspace.save(input) }; status = prior ? 200 : 201; }
        else if (p === '/api/study-sessions' || p === '/api/operator/study-rehearsals') { const service = p.includes('operator') ? fixtureStudy : realStudy; value = p.includes('operator') ? service.createRehearsal(s.sessionId, input) : service.start(s.sessionId, input); studyById.set(value.studySessionId, service); status = 201; }
        else if (d?.kind === 'study' && d.action === 'finish') { const service = studyById.get(d.id!); value = service ? service.finish(s.sessionId, d.id!, input) : apiError('NOT_FOUND', requestId); }
        else if (d?.kind === 'study' && d.action === 'feedback') { const service = studyById.get(d.id!); if (!service) value = apiError('NOT_FOUND', requestId); else value = service.sessionFeedback(s.sessionId, d.id!, input); }
        else if (p === '/api/study-withdrawals') {
          withdrawalAttempts = withdrawalAttempts.filter(v => wall() - v.at < 3600000);
          if (withdrawalAttempts.length >= 20 || withdrawalAttempts.filter(v => v.owner === s.sessionId).length >= 5) return result(res, apiError('LIMITED', requestId));
          withdrawalAttempts.push({ owner: s.sessionId, at: wall() });
          let found: string | null = null; let service: StudyService | null = null;
          for (const candidate of [fixtureStudy, realStudy]) { const k = candidate.db.prepare("SELECT value FROM study_keys WHERE name='withdrawal'").get() as { value: string }; for (const part of ['fixture', 'study']) { const row = candidate.db.prepare(`SELECT id FROM ${part}_sessions WHERE withdrawal_lookup=?`).get(withdrawalLookup(input.withdrawalCode, k.value)) as { id: string } | undefined; if (row) { found = row.id; service = candidate; } } }
          value = (service ?? realStudy).withdraw(s.sessionId, input.requestId, input.withdrawalCode);
          if (found) { const ids = rounds.invalidateStudy(found); for (const [id, capture] of captures) if (capture.studySessionId === found || ids.includes(capture.roundId)) captures.delete(id); for (const binding of requestIds.values()) if (binding.capture?.studySessionId === found || binding.capture && ids.includes(binding.capture.roundId)) { delete binding.result; delete binding.capture; } events.clear(ids); for (const id of ids) studyRound.delete(id); studyById.delete(found); for (const [key, binding] of requestIds) if (binding.result && typeof binding.result === 'object' && 'studySessionId' in binding.result && binding.result.studySessionId === found) requestIds.delete(key); }
        }
        else if (p === '/api/operator/captures') {
          const r = rounds.internal(s, input.roundId); if (isApiError(r)) value = r;
          else {
            const completed = events.observations(r.public.roundId).completedViews;
            if (![1, 2].every(attempt => completed.some(v => v.attempt === attempt && v.scoreHash === r.public.acts[attempt - 1]?.scoreHash))) value = apiError('UNAVAILABLE', requestId);
            else { const bundle = buildCapture(captureRecord(r), input); if (isApiError(bundle)) value = bundle; else { for (const [id, c] of captures) if (c.expiresAt <= wall()) captures.delete(id); const cacheBytes = [...captures.values()].reduce((sum, c) => sum + c.bytes.length, 0); if (bundle.bytes.length > MAX_CACHE || cacheBytes + bundle.bytes.length > MAX_CACHE) value = apiError('LIMITED', requestId); else { const captureId = randomUUID(); captureBinding = { roundId: r.public.roundId, studySessionId: r.studySessionId }; captures.set(captureId, { owner: s.sessionId, ...captureBinding, bytes: bundle.bytes, expiresAt: wall() + 600000, downloaded: false }); value = { captureId, filename: 'tiny-mime-replay.zip', byteLength: bundle.bytes.length }; status = 201; } } }
          }
        } else if (p === '/api/operator/exports') { let service: StudyService; try { fixtureStudy.readRun(input.studyRunId); service = fixtureStudy; } catch { service = realStudy; } value = service.createExport(s.sessionId, input); status = 201; }
        if (value === undefined) value = apiError('NOT_FOUND', requestId);
        if (!isApiError(value)) { const cache = !['CreateRound', 'CreatorRoundInput', 'GuessInput', 'RoundMutation', 'EventsInput', 'FeedbackInput', 'CandidateInput', 'CandidateRemoval', 'CreatorCaptureTrace'].includes(contract); requestIds.set(key, { digest, contract, path: p, ...(cache ? { result: value } : {}), ...(captureBinding ? { capture: captureBinding } : {}), expiresAt: wall() + 86400000 }); }
        return result(res, value, status);
      }
      if (method !== 'GET' && method !== 'HEAD') return result(res, apiError('NOT_FOUND'));
      if (['/', '/play', '/rehearsal', '/showcase', '/study', '/creator/capture', '/operator-unlock'].includes(p)) {
        const op = !!authorizedOperator(req); const session = authenticated(req);
        const boot: any = { operator: op, liveAvailable: liveAvailable(), disclosureVersion: config.approval?.providerDisclosureVersion ?? null, study: liveManifest ? { available: qualification().enabled, studyRunId: liveManifest.studyRunId, consentVersion: liveManifest.consentVersion, operatorContact: realStudy.readRun(liveManifest.studyRunId).binding?.operatorContact } : { available: false } };
        if (op && p === '/rehearsal') boot.references = listReferences();
        if (op && p === '/study') boot.operatorRuns = [fixtureStudy, realStudy].flatMap(service => (service.db.prepare('SELECT id,manifest FROM study_runs').all() as { id: string; manifest: string }[]).map(r => { const m = JSON.parse(r.manifest); return { studyRunId: r.id, synthetic: m.status === 'draft', protocolVersion: m.protocolVersion }; }));
        if (op && session && p === '/creator/capture' && url.searchParams.has('round')) { const r = rounds.internal(session, url.searchParams.get('round')!); if (!isApiError(r) && r.public.acts.length === 2) { const record = captureRecord(r); boot.captureSummary = { ...captureTiming(record), canIncludeGuessText: r.creatorOwned, versions: record.versions, operationalOutcome: record.operationalOutcome }; } }
        let html = htmlTemplate();
        html = html.replace('</head>', `<meta name="tiny-mime" content="${Buffer.from(JSON.stringify(boot)).toString('base64')}"></head>`).replace(/<script(?![^>]*src=)/g, `<script nonce="${nonce}"`);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(method === 'HEAD' ? '' : html);
      }
      if (vite) {
        const safe = /^\/(?:src\/client\/|src\/shared\/|node_modules\/\.vite\/|node_modules\/vite\/dist\/client\/env\.mjs$)/.test(p);
        if (safe && !p.includes('..') && !p.includes('%') && !p.endsWith('.map')) return vite.middlewares(req, res, () => result(res, apiError('NOT_FOUND')));
      } else if (/^\/assets\/[a-zA-Z0-9_.-]+\.(js|css|svg|woff2)$/.test(p)) {
        const file = path.resolve('dist/client', '.' + p); if (existsSync(file)) { const bytes = readFileSync(file); res.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript; charset=utf-8' : p.endsWith('.css') ? 'text/css; charset=utf-8' : p.endsWith('.svg') ? 'image/svg+xml' : 'font/woff2', 'Content-Length': bytes.length }); return res.end(method === 'HEAD' ? undefined : bytes); }
      }
      return result(res, apiError('NOT_FOUND'));
    } catch (e) { const code = e instanceof StudyError || e instanceof CandidateError || e instanceof WorkspaceTransferError ? e.code : e instanceof ParseFailure || e instanceof z.ZodError || e instanceof Error && e.message === 'INVALID_INPUT' || e instanceof SyntaxError ? 'INVALID_INPUT' : 'UNAVAILABLE'; if (!res.headersSent) result(res, apiError(code, requestId)); else res.destroy(); }
  }
  function maintain() { try { rounds.sweep(); events.sweep(); fixtureStudy.sweep(); realStudy.sweep(); ledger.purge(); for (const [key, v] of requestIds) if (v.expiresAt <= wall()) requestIds.delete(key); for (const [id, c] of captures) if (c.expiresAt <= wall()) captures.delete(id); operator.status(); return true; } catch { retentionHealthy = false; rounds.shutdown(); return false; } }
  const sweep = setInterval(maintain, 60000); sweep.unref();
  async function close() { clearInterval(sweep); rounds.shutdown(); await vite?.close(); fixtureDb.close(); workspaceDb.close(); researchDb.close(); ledgerDb.close(); release(); }
  return { handler, close, services: { rounds, events, captureTraces, sessions, operator, fixtureStudy, realStudy, ledger, workspace, maintain } };
}

export async function startServer(options: ApplicationOptions = {}) {
  const app = await createApplication(options); const server = http.createServer(app.handler); server.requestTimeout = 10000; server.headersTimeout = 10000;
  try { await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(4317, '127.0.0.1', () => resolve()); }); } catch (error) { await app.close(); throw error; }
  return { ...app, server, async stop() { const closed = new Promise<void>(resolve => server.close(() => resolve())); server.closeAllConnections(); await closed; await app.close(); } };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer({ development: process.env.NODE_ENV !== 'production' }).then(app => {
    process.stdout.write(JSON.stringify({ event: 'server_started', origin: ORIGIN, provider: 'configured_by_approval', liveCallsAtStartup: 0 }) + '\n');
    if (process.stdin.isTTY) { const terminal = createInterface({ input: process.stdin, output: process.stdout }); terminal.on('line', line => { if (line.trim() === 'unlock') app.services.operator.regenerate(); }); }
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.stop().then(() => process.exit(0)); });
  }).catch(() => { process.stderr.write(JSON.stringify({ event: 'startup_failed', code: 'CONFIGURATION_OR_PORT', requestId: null }) + '\n'); process.exitCode = 1; });
}
