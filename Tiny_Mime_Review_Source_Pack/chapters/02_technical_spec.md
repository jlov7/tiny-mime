# 02. Technical specification

Status: v02 implementation contract for a complete local-private first version. This is a specification, not implemented or tested app software. Codex should finish the whole scoped build in one task without intermediate design approvals. External spending, credentials, real participant collection and publishing remain separate owner-controlled activation gates; they do not block building and testing the complete app offline. No runtime API model is selected by this document, and a reviewer model name is never a runtime model ID.

## 2.1 Scope, stack and trust boundaries

Build four surfaces: `/rehearsal` for the operator's score/scene rehearsal, `/play` for private play, `/study` for consented local study sessions, and `/creator/capture` for clean local capture/export. Use TypeScript, React, Vite, pure SVG, one Node.js 24 LTS server, and SQLite via `better-sqlite3` for consented records and sanitized financial reservations. No physics engine, generated executable code, accounts, public hosting, cloud database, external analytics or animation marketplace. Official Node release information lists the 24 line as LTS. [T1]

Before implementation, resolve exact compatible non-prerelease versions of Node 24, npm, React, React DOM, Vite, TypeScript, Ajv 2020, better-sqlite3, Vitest, Playwright and the required React/Vite plugin from their official registry/vendor metadata; record versions and retrieval date in `toolchain-manifest.json`, exact direct dependency versions in `package.json`, and commit `package-lock.json`. Use `npm ci` thereafter. Choose current supported compatible patch releases without asking the owner; if there is no compatible set, report the concrete incompatibility. This deterministic setup step replaces invented patch pins and does not leave framework selection open. Use built-in `fetch`, `node:http`, `node:crypto`, and AbortController rather than an API SDK with hidden retries. Add only dependencies required by these contracts, including an audited duplicate-key-aware JSON parser and RFC8785-compatible canonicalizer; freeze its exact version too.

Bind only `127.0.0.1:4317`; require Host exactly `127.0.0.1:4317` and mutation Origin exactly `http://127.0.0.1:4317`. No CORS, LAN binding, arbitrary proxy mode or remote deployment. Serve the built frontend and API from that same origin. A loopback HTTP session cookie is HttpOnly, SameSite=Strict, Path=/, with no Domain and without Secure only because this version is HTTP on loopback. Do not imply it protects against a hostile local OS/process. A future HTTPS deployment must use Secure cookies and a separate threat review. Do not silently start Vite on all interfaces.

Server owns scene meaning, target/rubric, conditions, rosters, round state, generation, cost and reveal permission. Browser owns playback and draft input. Separate server-only catalogue modules from client assets; client bundles/source maps contain no target catalogue, prompt templates, conditions or meanings. Serve only public DTO allowlists. All API responses use `Cache-Control: no-store`; no service worker. Client never receives a hidden target inside a readable token. Score hashes identify motion, not semantic targets. Canonical score hashing is RFC8785 JSON canonicalization, UTF-8 bytes, SHA-256 lowercase hex, version jcs-sha256-v1; normalize numeric−0 to0. ZIP/file hashes are distinct artifact hashes. Whitespace/object-key-order changes must not change scoreHash.

A session cookie contains a random 256-bit opaque token, mapped to a RAM-only owner; random round IDs are UUIDv4 and are insufficient for access. Missing session is 401; a round/request owned by someone else is indistinguishable from an unknown ID (404). One active round per session, 100 globally, one generation per session and two globally. Rounds expire after 30 minutes from creation or last accepted round mutation; reads, events, feedback and playback never extend lifetime. Sessions expire after eight hours or process shutdown. No session/round restoration after server restart; old requests receive 410 when identifiable, otherwise 404, and the UI explains that the local session ended.

Operator access is separate from participant ownership: print a one-use 256-bit launch secret to the local terminal at startup, never a URL/query string. `/operator-unlock` accepts it via `POST /api/operator/bootstrap`; five failed attempts invalidate it. Success consumes the secret and sets a separate HttpOnly SameSite=Strict operator cookie with a 30-minute absolute lifetime. Targets, scene guides, research/coder exports, capture and creator APIs require this capability. Mutations require exact Origin; GET reads require Host/cookie, reject cross-site fetch metadata, and validate Origin if present (GET may omit it). `/rehearsal` and `/creator/capture` shells contain no secret content before authorization. `POST /api/operator/lock` invalidates the capability immediately. On lock/expiry/exhausted attempts, generate a fresh one-use launch secret in the terminal without restarting or losing rounds; regeneration is limited to once/minute. A local terminal `unlock` command provides the same recovery path. Never return a launch secret through HTTP. “Enter participant mode” must call this before handing over the browser; operator workflows should use a separate browser profile. Obscure routes are not access control. Operator endpoints never become available through ordinary session cookies.

## 2.2 Canonical motion and parser contract

`MotionScoreV1` alone enters the renderer. The normative structural schema is `supplements/motion-score-v1.schema.json`; the rules below are mandatory additional semantic checks. `scene-meaning-v1.schema.json` and `scene-meaning-contracts.json` describe server-owned meaning separately. Metadata, provenance and semantic labels must not be added to a motion score.

```ts
type ActorId = 'a' | 'b' | 'c';
type Easing = 'linear' | 'easeInOut';
type KeyframeV1 = {
  tMs: number; x: number; y: number; rotationDeg: number;
  scaleX: number; scaleY: number; easing: Easing;
};
type ActorV1 = {
  id: ActorId; shape: 'circle' | 'square' | 'triangle';
  color: 'violet' | 'amber' | 'teal'; keyframes: KeyframeV1[];
};
type MotionScoreV1 = {
  version: 1; durationMs: number;
  stage: { width: 1000; height: 700 }; actors: ActorV1[];
};
type Roster = ReadonlyArray<Pick<ActorV1, 'id' | 'shape' | 'color'>>;
type ScoreErrorCode = 'PARSE' | 'BYTES' | 'DEPTH' | 'DUPLICATE_KEY' |
  'UNKNOWN_KEY' | 'SCHEMA' | 'ROSTER' | 'TIMELINE' | 'BOUNDS' |
  'SPEED' | 'CONTACT' | 'CONTACT_UNCERTAIN';
type ScoreError = { code: ScoreErrorCode; path: string };
type ValidationResult = { ok: true; score: MotionScoreV1; scoreHash: string } |
  { ok: false; errors: ScoreError[] };
```

- Duration: integer 6,000–10,000 ms. Exactly two or three actors, canonical order `a,b[,c]`. IDs, shapes and colors are independently unique and exactly match the server roster in both acts. Array order is paint order; no animated depth.
- Each actor: 2–24 full-transform keys; first at zero, last at duration; strictly increasing integer times with gaps at least 250 ms. Every number finite. Raw score limit 65,536 UTF-8 bytes, maximum nesting level six (root object level one; each nested object/array adds one). Reject duplicate keys before ordinary parsing loses them; reject unknown properties recursively, Unicode-lookalike keys, and `__proto__`, `constructor`, `prototype`. Reconstruct explicit fields into fresh records; never merge untrusted objects. Ajv must not coerce types, fill defaults or strip unknown fields.
- Centers `70 ≤ x ≤ 930`, `70 ≤ y ≤ 630`; each scale `0.75–1.25`; rotation `−360–360` degrees. No text, icons, opacity, color/shape changes, paths, assets, URLs, code, callbacks, sounds, particles or arbitrary CSS.
- Geometry version `svg-shapes-v1`: circle radius 40; centered square side 64; triangle vertices `(0,-48),(24√3,24),(-24√3,24)`. No stroke or shadow. All fit a base radius-50 disk. Largest scaled radius is 62.5; center inset 70 contains every transform throughout interpolation.
- Palette: violet `#7357FF`, amber `#B56A00`, teal `#007F83`, stage `#F7F3EA`. Shape as well as color differentiates actors. Verify contrast in implementation; this document makes no WCAG conformance claim.

Between keys i and i+1, let `u=(t−t_i)/(t_(i+1)−t_i)` and use the outgoing key's easing: linear `p=u`; easeInOut `p=3u²−2u³`. Interpolate x, y, unwrapped rotation, scaleX and scaleY with that same p. The final key's easing is required to be linear and has no effect. Degrees are literal: 350→10 travels −340°, not the shortest path. Transform order is local nonuniform scale, rotation, translation. Authored engine code constructs SVG attributes from validated numbers; it never inserts model-supplied markup.

Per segment, reject maximum center speed over 600 units/s, angular speed over 180°/s, either scale speed over 1/s. Let B=1 for linear or 1.5 for easeInOut; center speed bound is `B×hypot(Δx,Δy)/Δseconds`, rotation/scale use absolute deltas. Equality passes. Numerical rejection tolerance is 1e−9 for these calculated comparisons, not an invitation to exceed bounds materially. Correct examples: easeInOut Δ=(150,150) over 0.5 s gives approximately 636.396 and FAILS; the same over 1 s gives approximately 318.198 and PASSES; Δ=(200,0) over 0.5 s gives exactly 600 and PASSES; Δrotation=60° over 0.5 s gives exactly 180 and PASSES. Positions/scales are non-overshooting; endpoint containment plus the rotation-independent disk bound proves stage containment. It does not prove pairwise non-contact.

### ContactPolicyV1: continuous non-contact certification

All initial TM01/TM09/TM04 scenes use `contactPolicy='noncontact-v1'`. Overlap is not an allowed dramatic technique in this version. Each actor is conservatively enclosed by a FIXED radius-62.5 disk regardless of actual shape/scale. Require pair distance strictly greater than `2×62.5+4 = 129` stage units throughout `[0,durationMs]`. The extra four units are design clearance. This overrejects some geometrically safe near-passes, intentionally; no circle-square or polygon exception, invisible collision response, contact lock or physics engine is introduced. A later contact policy requires a new version and study freeze.

Implement the following deterministic, bounded certificate using stage units and seconds. The distance between two centers is Lipschitz with constant no larger than the sum of their center-speed bounds. This supplies a whole-interval lower bound; a dense frame scan does not.

1. For each unordered actor pair, split time at the sorted union of both actors' keyframe times. On each resulting closed interval both actors are within one original easing segment. Compute each original segment's global center-speed bound B×distance/seconds; set L to their sum. Constant segments have bound zero. Never use endpoint average speed for smoothstep.
2. Use a left-first depth-first stack of intervals `[lo,hi,depth]`. Evaluate center distance d at lo, midpoint m and hi using the canonical sampler. If any `d ≤129+ε`, reject CONTACT. Here `ε=0.000001` stage unit, deliberately much larger than expected float arithmetic error at this coordinate scale; tests compare to a high-precision oracle.
3. Otherwise compute `lower = d(m)−L×(hi−lo)/2`, with times in seconds. If `lower >129+ε`, certify the entire interval. This follows from the reverse triangle inequality and bounded center velocities; unequal key times/easings are handled by the union split.
4. Otherwise bisect, recomputing m samples and keeping the conservative original L. If interval width is at most 0.0005 s, depth reaches 24, or total visited intervals for the pair reaches 131,072, stop and reject CONTACT_UNCERTAIN. Never accept unresolved intervals, including tangency/numerical-borderline cases. Midpoint caching is optional and cannot alter ordering/result.
5. Accept the score only if every interval for every pair is certified. Hard cap work at three pairs; certificate errors contain pair IDs and interval numbers only. Store certificate version in provenance, not score JSON. Re-run the same validator on client and server.

This is a conservative engineering certificate with an explicit floating-point margin, not a formal proof of IEEE arithmetic correctness. Acceptance cannot be inferred from screenshots or rendered-frame sampling. Property tests must compare acceptance with a slower high-precision polynomial/interval oracle on randomized adversarial scores; any oracle-detected intersection in an accepted score blocks release. Baseline hand-authored clips should keep centers at least 150 units apart so they do not depend on marginal cases.

## 2.3 Playback, rehearsal and capture

`sampleScore(score, elapsedMs): Frame` is pure; clamp elapsed time to `[0,durationMs]`, choose the outgoing segment at interior exact keys, and return canonical actor order. Numeric frame tolerance is 1e−9 in unit tests. Browser antialiasing need not be identical. Use requestAnimationFrame timestamps, never frame counts. On hidden-page visibility, freeze elapsed playback time and cancel animation callbacks; return paused with Resume. Generation deadlines continue while hidden. Replay starts at zero and never calls a provider. Both acts stay replayable without changing the active guess slot. Restart round is a server abandonment/new-round operation, not Replay. [T2,T3]

Begin every clip with Play; never autoplay a recovered result. Respect reduced-motion preference using frame stepping at the sorted union of keyframe times, zero and endpoint. User can explicitly opt into motion. Record the chosen mode independently from full-motion outcomes. Keyboard controls and focusable Play/Pause/Replay/Skip/Restart live outside the silent stage; announce state changes, never per-frame updates. No loops/flashing. Frame stepping is not a nonvisual equivalent; disclose the intrinsically visual task and offer Reveal/exit. [T4,T5,T6]

Rehearsal permits operator-only local score import, validation errors, scrub/play and numeric provenance. Imports use the same parser/validator/contact policy; no scripts or external score URLs. Creator selects an owned revealed completed round through gated operator APIs. Mandatory capture is a local ZIP containing self-contained `replay.html` (fixed authored HTML/SVG player), `capture-manifest.json` and canonical score JSON files. It reconstructs actual first performance → submitted guess if authorized → actual wait → actual second performance → reveal. Text stays outside the stage. Original timing is default; an explicit shortened-wait option records both actual and exported timings and a visible “wait shortened” notice. No invented successful repair or guessed text. includeGuessText defaults off and requires creator-owned input or separately verified publication consent when on. Research retention alone is insufficient. Encode embedded data as base64 UTF-8 (ASCII payload, decoded through TextDecoder and JSON.parse); render every untrusted text value with textContent, never innerHTML. Use a CSP hash for fixed renderer code and forbid all network/external assets/fonts/imports. Reject unpaired surrogates under the common input contract; preserve ordinary Unicode. The exact adversarial guess </script><img src=https://example.invalid/x onerror=alert(1)> must render literally without markup execution or any network request. Metadata names source/authorship, score hashes, model/prompt/renderer/contact versions and editing/consent limitations. The local owner can inspect bundle source, so it is not a blinded participant artifact. Optional WebM may be offered only when capability-tested; HTML replay is not a video file. No upload/share/publish button. Exact capture endpoint, limits and lifecycle are in the API supplement.

Required mobile verification is responsive viewport emulation and local cross-browser testing. Physical phone/tablet testing needs separately approved secure exposure because a phone's127.0.0.1 is not the computer's server. Record it as not run if unavailable; do not open LAN/tunnel/public access implicitly or claim physical-device testing.

## 2.4 Server-owned meaning and director inputs

Meaning is canonical server-authored data, frozen before collection. `SceneMeaningV1` binds `meaningId`, scene/revision, target, ordered core-event assertions, exact actor-role bindings, allowed elaborations and contradictions to `noncontact-v1` and `svg-shapes-v1`. The structural schema and all 12 records (three development, eight comparison candidates, one deferred contact scene) are supplied separately. Rubric anchors and examples belong to human scoring. Fidelity assessment belongs to an independent human outcome record, never to the director's self-certification.

The director receives an explicit allowlisted projection: target, core-event invariants, role bindings, allowed elaborations, contradictions, roster, contact/geometry versions, previous score and the profile's guess-data field. Do NOT provide hand-authored act-two beats, interpretation-to-gesture lookups, alternative-guess repair advice from the operator directing guide, rubric exemplars, target catalogue, private participant identifiers, provider secrets or other study answers. This distinguishes invariant-constrained generation from selecting an authored repair clip. Human guides are for authors/reviewers; the provider boundary cannot import that module.

```ts
type GenerationProfile = 'practice_blind_v1' | 'runtime_informed_v1' |
  'runtime_blind_v1' | 'development_probe_informed_v1' |
  'development_probe_blind_v1';
type GenerateContext = {
  sceneMeaning: DirectorMeaningV1; roster: Roster; attempt: 2;
  previousScore: MotionScoreV1; generationProfile: GenerationProfile;
  firstGuessOccurred: true; repairErrors: ScoreError[] | null;
  guessData: { kind: 'actual'; text: string } | { kind: 'withheld' };
};
type ProviderResult = {
  rawJson: string; providerRequestId: string | null;
  model: string; inputTokens: number | null; outputTokens: number | null;
  status: 'completed' | 'refusal' | 'incomplete';
};
interface ScoreProvider {
  generate(context: GenerateContext, signal: AbortSignal): Promise<ProviderResult>;
}
```

First clips are preauthored fixtures with honest authoringMethod and humanReview metadata, not universally human-authored. Build the three development scenes first, then all eight non-contact comparison candidates; TM07 remains deferred. Real comparative study entry stays locked until human calibration and frozen bank approval. Authorized formative and bank-calibration runs use their own approved scope/manifest and consent and do not require prior comparative calibration, avoiding a circular gate. Fixture play/study rehearsal remains visibly synthetic and isolated from research storage. Server derives the profile, never the participant. Informed profiles alone require actual guess data; blind/practice profiles require the exact withheld variant without a text property. Condition is a nullable ANALYSIS field separate from profile: practice uses `condition=null`, `randomized=false`, profile `practice_blind_v1`. Private play uses runtime informed profile after explicit provider disclosure; fixture play performs zero calls. Comparative study uses the concealed schedule to choose runtime informed/blind after accepted first guess. Development probes have their own profiles/ledger and cannot be labeled participant trials. No profile calls a live semantic judge. The type DirectorMeaningV1 is the exact allowlist projection defined in the product meaning contract: contractVersion,meaningId,target,cast,coreEvent,roleBindings,allowedElaborations,contradictions,geometryVersion,contactPolicy. The provider sees motion data, not rendered video/screenshots, and receives no tools, network retrieval or executable-code channel.

## 2.5 Exact participant API and idempotency

Normative structures are in `supplements/api-contracts-v1.schema.json` and `supplements/api-contracts-v1.md`. Every object is closed; unspecified endpoints, free-form analytics, PUT/PATCH editing of guesses and guessed metadata fields are prohibited. `requestId`, `eventId`, `roundId`, `studySessionId` use lowercase UUIDv4. JSON request body ≤4,096 bytes (event batch≤16,384), depth≤8, duplicate-key rejection and prototype-key rejection throughout. Errors are `{error:{code,retryable,requestId}}`, with requestId nullable when unparseable. Never include prompt, guess, target, provider body or stack trace in errors.

All successful round snapshots use this exact public envelope:

```ts
type SourceKind = 'runtime_generated' | 'authored_fixture' | 'mock_fixture';
type PublicAct = {
  attempt: 1 | 2; scoreHash: string; source: SourceKind;
  authorship: null | {authoringMethod:'spec_transcribed'|'agent_assisted'|'human_authored'; humanReview:'not_run'|'reviewed'};
  score: MotionScoreV1;
};
type PublicRound = {
  roundId: string; revision: number; expiresAt: string;
  mode: 'private_play' | 'study'; executionMode:'fixture'|'live'; phase: 'play' | 'formative' |
    'bank_calibration' | 'practice' | 'comparative' | 'optional_extra';
  state: 'awaiting_guess1' | 'generating_act2' | 'awaiting_guess2' |
    'unavailable' | 'revealed' | 'abandoned';
  acts: PublicAct[]; guesses: Array<{attempt: 1 | 2; text: string}>;
  actions: Array<'guess' | 'skip' | 'abandon' | 'restart'>;
  generation: null | {acceptedAt: string; deadlineAt: string;
    status: 'pending' | 'ready' | 'failed' | 'cancelled';
    failure: null | 'provider_disabled' | 'limited' | 'invalid_output' |
      'provider_error' | 'refusal' | 'deadline' | 'cancelled'};
  reveal: null | {target: string};
};
```

No public field contains scene ID, condition, meaning/rubric, prompt or provider model. Before reveal, scene IDs could expose a known answer and remain server-only. `revealed` alone has non-null reveal. Exact state consistency:

| State | Acts | Accepted guesses | Actions |
|---|---|---|---|
| awaiting_guess1 | act1 | none | guess, skip, abandon |
| generating_act2 | act1 | guess1 | skip, abandon |
| awaiting_guess2 | act1+act2 | guess1 | guess, skip, abandon |
| unavailable | act1 | guess1 | skip, abandon |
| revealed | completed acts | zero, one or two | restart |
| abandoned | empty | empty | restart |

`POST /api/session` body `{}` establishes/reuses an owner session, 200 `{sessionReady:true, activeRoundId:string|null}`. It never revives an expired session or rotates a valid cookie behind pending work. All other participant APIs require that established cookie.

| Endpoint | Exact request / success |
|---|---|
| POST /api/rounds | `{requestId, mode:'private_play'\|'study', executionMode:'fixture'\|'live', studySessionId:string\|null}`; private play requires null; study requires an owned eligible study session; 201 PublicRound on first creation, 200 current snapshot on replay |
| GET /api/round-requests/:requestId | Recover round creation by owner-bound request mapping; 200 PublicRound, 404 not found/foreign, 410 expired; no mutation/call |
| GET /api/rounds/:id | 202 PublicRound only while generating; otherwise 200; no mutation/call |
| GET /api/rounds/:id/requests/:requestId | Owner-bound accepted-operation status; 200 `{accepted:true,round:PublicRound}`;404 not accepted/foreign; never resubmits |
| POST /api/rounds/:id/guesses | `{requestId,revision,attempt:1\|2,guess}`; first accepted guess returns 202 generating snapshot immediately, second returns 200 revealed |
| POST /api/rounds/:id/skip | `{requestId,revision}`;200 revealed; cancels active generation epoch |
| POST /api/rounds/:id/abandon | `{requestId,revision}`;200 abandoned; cancels active generation epoch and erases transient guesses/acts |
| POST /api/rounds/:id/events | `{requestId,events:ClientEventV1[]}`; 200 `{acceptedEventIds:string[],duplicateEventIds:string[]}` |
| POST /api/rounds/:id/feedback | `{requestId,enjoyment:1\|2\|3\|4\|5\|null,helpfulness:1\|2\|3\|4\|5\|null}`;200 `{saved:true}` after reveal; once per round |

Map codes explicitly: INVALID_INPUT400, UNAUTHENTICATED401, FORBIDDEN403 (Origin/operator role), NOT_FOUND404, STALE409, IDEMPOTENCY_CONFLICT409, ACTIVE_ROUND409, EXPIRED410, LIMITED429, UNAVAILABLE503, DEADLINE504. Every error has `retryable:false` except LIMITED/UNAVAILABLE, which may be true; network retryability does not authorize another paid call. Retry-After accompanies 429, maximum 60 seconds. A semantic terminal unavailable snapshot is a successful read (200), not 503.

Normalize guesses NFC then trim. Accept 1–240 Unicode code points; reject line breaks, C0/C1 controls, unpaired surrogates and U+202A–U+202E/U+2066–U+2069 bidi controls. Preserve ordinary combining marks, ZWJ and emoji. No submission during IME composition. Render as text. Invalid input consumes no attempt/call. No free-text feedback endpoint in v1. Non-English guesses are accepted; optional offline human language tags never change the live loop.

Bind UUID request IDs globally within the owner session to method+path+canonical normalized payload digest. Reusing with changed payload/path is409. Same accepted request returns the current associated snapshot without repeating mutation, randomization or provider dispatch. For new-round requests, create the mapping and round in ONE atomic section; session/round cap checks and initial catalogue validation precede commitment. A duplicate creation wins over rate-limit/active-round checks. Different new IDs cannot bypass one-active-round. Retain mappings through the round lifetime and a 30-minute expired tombstone; never overwrite a mapping with another round. Expired mappings return 410. Creation never awaits the provider.

Guess1 acceptance is an atomic transaction in the in-memory state machine: validate owner/revision/input/idempotency, record accepted guess, assign profile, increment revision, reserve unique job epoch, set monotonic server deadline, and produce 202. Release the mutex before ALL provider/network work. Dispatch afterward; a failure to dispatch becomes unavailable under the same epoch, never a silent stuck state. No queue. Skip/abandon may run while a call is in flight, invalidates epoch and best-effort aborts. Provider completion commits only if owner/round, job epoch, state and monotonic deadline all match. Terminal state wins over late output. Same-revision concurrent commands: first accepted wins; other 409. A stale Skip refreshes once and reissues the same user skip intent with a NEW request ID/current revision; repeated contention yields a visible Retry reveal control, never a hidden automatic generation. Client navigation epochs discard stale replies after a newer round/navigation.

## 2.6 Client crash/reload recovery and deadlines

Use sessionStorage only for bounded technical metadata, never localStorage/IndexedDB/cache persistence for targets, scenes, drafts, guesses, provider credentials or raw digests of guessed text. Browser draft and loaded scores/history are memory-only. Same-session reload reconstructs accepted history from an owned server snapshot. If sessionStorage is unavailable, disable submissions before dispatch with a storage error and offer read-only rehearsal; do not claim crash recovery without its prerequisite.

Persist the following records synchronously and verify read-back BEFORE the associated fetch. Cap at one pending creation, one pending round mutation and one round recovery record; maximum total 8KiB. All persisted timestamps are finite integer epoch milliseconds and IDs are opaque.

```ts
type PendingCreationV1 = {
  version: 1; requestId: string; mode: 'private_play'|'study'; executionMode:'fixture'|'live';
  studySessionId: string|null; createdWallMs: number;
};
type PendingMutationV1 = {
  version: 1; roundId: string; requestId: string;
  kind: 'guess1'|'guess2'|'skip'|'abandon'; revision: number;
  submittedWallMs: number; deadlineWallMs: number|null;
  lastObservedWallMs: number; clockUncertain: boolean;
};
type RoundRecoveryV1 = {
  version: 1; roundId: string; clientTimeout: boolean;
  clockUncertain: boolean; timeoutEventId: string|null; clockUncertainEventId: string|null;
};
```

On reload with any pending descriptor, first recover using the existing cookie; do not call POST /api/session to establish a new owner before recovery. A401/session loss stops recovery and requires explicit discard of stale pending metadata; never resend its requestId under a new owner. Creation: after session establishment, generate requestId and persist PendingCreationV1 before POST. Lost reply/reload first does GET `/api/round-requests/:requestId`. If found, restore it and clear pending creation only after storing returned roundId. If definitely 404 with the same still-valid session, resend the ORIGINAL creation body/requestId; creating a new ID is prohibited until outcome is resolved or owner explicitly abandons the request. Session loss/process restart ends recovery and clears the stale descriptor after telling the user. A dropped creation response must never strand an invisible active round or hit ACTIVE_ROUND on automatic recovery.

First-guess submission: compute absolute `deadlineWallMs=submittedWallMs+15000`, persist pending mutation and RoundRecovery BEFORE awaiting POST, and capture a nonpersisted `performance.now()` origin. While the document remains alive, monotonic elapsed time governs the 15,000-ms client wait. Persist lastObservedWallMs on submission, each 500-ms wait tick, visibility/pagehide and before a network response is applied. Never store guess content in the descriptor. After response uncertainty, query owned request status; on known absence the player must re-enter the guess explicitly, no automatic guessed-text reconstruction. In the still-live page an explicit Retry submission may reuse original request ID AND original text, but does not reset its deadline.

Reload cannot safely prove wall-clock continuity across processes. Therefore any pending guess1 loaded into a new document immediately sets sticky `clockUncertain=true`, stops automatic waiting/acceptance, and offers “Check result” or Reveal. Do not allocate a fresh 15 seconds or quietly infer success from a backwards-adjusted wall clock. If wall time is already ≥stored deadline, also set clientTimeout=true. Within a live document, if `abs((Date.now−submittedWallMs)−(performance.now−origin))>1000ms`, or wall time falls below lastObservedWallMs−1000ms, mark clockUncertain and stop automatic waiting. The conservative reload rule intentionally marks some harmless reloads uncertain; record separately from a known timeout and treat as non-success for the primary operational outcome. The server continues to own its independent monotonic deadline.

At monotonic elapsed≥15,000 ms without client-validated ready, first persist `clientTimeout=true` and stable timeoutEventId, then stop polling/show timeout. A late response does not clear it or autoplay. Restore flags before applying any snapshot. Recovery GET is only on explicit Check result after timeout/uncertainty, labels any valid score “Recovered after timeout” or “Recovered after interrupted timing”, and never changes the primary operational outcome. A loaded score remains playable offline; Reveal still requires the local server. After successful timely readiness clear PendingMutation; keep sticky outcome flags until round discarded. Events may be retried by the same eventId on connectivity return; no guess auto-submission on reconnect. At5,000ms elapsed, display the slow-generation status from the product copy without resetting either deadline; this is a UI threshold, not a measured p95 claim. Poll at most once/500ms, no parallel polls, stop on terminal snapshot/deadline/hidden recovery gate. Generation clock does not pause for background tabs or network loss.

## 2.7 Real provider adapter, structured outputs and profiles

Build ONE real adapter now: OpenAI Responses, fixed `POST https://api.openai.com/v1/responses`, Bearer `OPENAI_API_KEY`, JSON body. No configurable arbitrary base URL or model-router fallback. Do not invent GPT-6 API availability or silently choose any model. Required `TM_MODEL_ID` is supplied by the operator at activation, validated against official model capabilities for Responses+strict structured outputs; absent/unsupported means disabled. Authentication is injected through the owner's secure environment/secret facility, never entered into a generated document, committed .env, browser, localStorage or repository file. An example config uses names and empty placeholders only.

Adapter request contract: `model=TM_MODEL_ID`, `store=false`, `stream=false`, `background=false`, `max_output_tokens=profile.outputTokenCap`, `instructions=exact supplements/director-template-v1.txt content`, `input=[{role:'user',content:[{type:'input_text',text:JSON.stringify(allowlistedContext)}]}]`, `text.format={type:'json_schema',name:'motion_score_v1',strict:true,schema:providerProjection}`. Send no tools, previous_response_id, conversation, image/video, audio, user identifiers, temperature/top_p/seed/reasoning overrides. No SDK/default automatic retries. Freeze omitted defaults by recording model ID and profile/request manifest; a changed model requires recalibration. The current official Responses reference and structured-output guide document this interface and refusal/incomplete handling. [T7,T8]

Provider schema is a separately checked projection of the canonical local schema: preserve object/array shape, properties, required lists, additionalProperties=false, primitive types and enums; replace const by a singleton enum; inline local refs; omit `$schema`, titles/descriptions, minimum/maximum and minItems/maxItems if the configured model's supported subset rejects them. This projection may constrain LESS at the provider, but NEVER changes/weakens local validation. Its version/hash is frozen. Test the projection in the adapter contract tests and, after explicit paid activation, the first bounded live probe; unsupported schema is a configuration failure, not a fallback to unconstrained executable/text generation. The local MotionScore schema and all semantic/contact checks remain authoritative. The frozen compatible-subset projection is supplied as provider-motion-score-v1.schema.json; use it byte-for-byte in initial adapter snapshots, rather than opportunistically changing schemas per request.

Read response body with a262,144-byte cap. Require HTTP2xx, `status='completed'`, exactly one assistant output message containing exactly one output_text item and no refusal/tool content; optional reasoning output items are ignored but counted in reported billed output usage. Extract output_text≤65,536 UTF-8 bytes and parse it as the score; never concatenate mixed messages/content. `incomplete`, refusal, unexpected shape, invalid/nonfinite usage or malformed body yields typed failure. Preserve only sanitized provider request ID/model/usage/status, no raw provider body in logs. Status429/5xx/network ambiguity/refusal/incomplete/timeouts produce terminal failure for that act, with no automatic paid retry. A completed candidate failing local score validation permits ONE bounded repair call with at most 20 sanitized error codes/paths (path≤200 characters) in repairErrors and original authorized context, never the rejected raw candidate. Two invalid candidates end unavailable. An identical score hash to act1 is a valid technical result but records `no_change`; it is not silently regenerated.

Runtime profile: maximum two calls per act2/round; hard server acceptance-to-ready deadline 15,000ms including validation and repair; each fetch≤7,000ms AND remaining overall time. Client has its separate 15,000-ms deadline above. No wait queue. Cancellation is best-effort and does not guarantee zero billing. Target p95≤5 seconds desirable, ≤10 tolerable, unmeasured until tested.

Offline quality-probe profile: maximum two calls per case, each≤45,000ms, whole case≤90,000ms, concurrency 1; purpose is interpretability/fidelity feasibility before runtime latency tuning. Never reuse its longer deadlines in runtime. Default probe case count is zero until a bounded approved manifest enumerates cases. Probe spends and results are separate from participant runtime. Mock-provider tests may exercise both profiles at zero external cost, but must be labeled mock_fixture. Actual live probe still requires explicit model/rate/provider-disclosure/budget activation and is not authorized by this document.

## 2.8 Complete configuration and cost safety

`provider-config-v1.schema.json` defines the nonsecret activation file. Defaults are disabled with all dollar caps zero. `provider-config.example.json` is non-live and contains no API key. The env variables are exhaustively:

| Variable | Contract |
|---|---|
| NODE_ENV | development or production; production default for served build |
| TM_HOST | must equal 127.0.0.1; default 127.0.0.1; any other value startup error |
| TM_PORT | must equal 4317 in v1; default 4317 |
| TM_DATA_DIR | absolute private local data directory; default OS app-data TinyMime; do not put in served tree/repository |
| TM_PROVIDER_CONFIG | absolute path to validated nonsecret ProviderConfigV1 JSON; omitted uses disabled defaults |
| TM_PROVIDER_MODE | disabled or openai_responses; defaultdisabled; must agree with config |
| TM_MODEL_ID | absent while disabled; otherwise nonempty official supported model ID, exact match to approved config model |
| OPENAI_API_KEY | secret-facility injection only; required when enabled; never exposed or logged |
| TM_STUDY_ENABLED | true or false; defaultfalse; enables consented data collection only with frozen study manifest |
| TM_STUDY_MANIFEST | absolute path to validated frozen study-run manifest; required only when study enabled |

No VITE_ or browser-exposed variable may contain these values/secrets. Reject unknown TM_ variables to catch typos. Profiles' timeout/token hard maxima are compiled constants, not freely adjustable environment variables. `TM_PROVIDER_MODE=disabled` makes provider methods fail closed before network access regardless of a key being present. Rehearsal/capture/fixture play remain fully functional; live-study entry stays disabled while provider or phase-specific authorization prerequisites are missing, with a useful configuration explanation. [T9]

Runtime hard maxima are 32,768 conservative input-bound tokens and 6,000 output tokens/call, $0.10/call, $0.20/round and $5/day. Probe maxima are 32,768 conservative input-bound tokens and 12,000 output tokens/call, $0.50/call, $1/case and $10/day. These are implementation ceilings, NOT spending authorization, current prices or guaranteed sufficient tokens. Actual configured monetary caps default 0 and must fit within them; immutable token caps are recorded in config even while disabled. Owner approval records specific model, rate snapshot, cap/currency, purpose, date and expiry; UI must not describe a config file alone as real-world permission. A fixed planned case list and total job cap bound an activated probe. Budgets never fall back from exhausted runtime to probe or vice versa.

Compile the complete request first, including the exact frozen template, provider schema, model string, guess and null/bounded repairErrors. Serialize with compact JSON and literal Unicode (JSON.stringify semantics). Compute B as its UTF-8 byte length plus 1024 framing tokens, including schema/instructions/context; reject if this exceeds the profile input cap. This is a conservative engineering bound rather than measured token usage. The1024 framing allowance assumes the selected model tokenizes request content at no more than one token per UTF-8 byte and has no more than 1024 additional framing tokens; activation must verify/document that accounting assumption for the chosen model or remain disabled. It intentionally overestimates ordinary byte-level tokenization and may reject large scores; do not truncate meanings/guesses/scores or raise caps automatically. Before live activation verify this bound covers the selected model's documented text tokenization; otherwise keep provider disabled pending a supported tokenizer/counting method. Input bytes, B, assumed framing bound and actual provider usage are recorded numerically outside authorized diagnostic ledgers. If reported input usage exceeds B or framing assumptions fail, lock live dispatch and reconcile; do not claim the bound was proved by a byte count alone. Output cap includes reasoning tokens if billed as output; if the selected model has other unbounded charges, reject configuration. The new input ceiling fixes a concrete preflight impossibility: the three full max-Unicode-guess requests require bounds 10,591 (TM01),10,266 (TM09),11,426 (TM04); maximal 20-error repair fixtures reach 16,363. Thus the old 6000 input rule would reject the starting bank before any call, and the old 12000 probe rule could reject repair. Offline measurements and complete placeholder-model envelopes are supplied in provider-preflight-measurements.json and contract-fixtures/. All fit 32768; these are serialization checks, not provider-token counts, actual calls or performance results. Record input/output per-million USD upper-bound rates from an official pricing snapshot; ignore discounts when reserving. No web/tools/images/service-tier surcharge is allowed.

Reservation in integer USD microdollars: `ceil(B×inputRateUsdPerMillion + outputTokenCap×outputRateUsdPerMillion)`; because one dollar has one million microdollars, this is the direct per-million conversion. Reserve input against B for this fully compiled request (which must be≤32768), not automatically 32768; reserve output against the full 6000 runtime or12000 probe cap. A repair recomputes B before its own reservation. Add any approved bounded other charge (v1 requireszero). Reserve before dispatch in a SQLite transaction against call, round/case, daily profile AND approved job-total caps. Persist reservation/call count BEFORE fetch. A repair needs its own reservation and cannot exceed total caps. Refusal/cancel/network ambiguity keeps the full reservation until verified provider usage permits reconciliation. Missing usage is unknown, neverzero. Reconcile with actual input/output categories without double-counting cached/reasoning subtotals. If provider reports more usage/cost than reserved, stop all live dispatch and flag reconciliation; never rewrite the cap.

Store UTC-day ledger balances plus approval/job IDs, profile/model/rate snapshot, random job/call IDs, reservation/status and numeric usage, with no guesses/prompts/targets/participant identity. On restart, rounds expire and live provider mode is locked until incomplete reservations have been reconciled OR retained at full reserve and the previous day's totals are verified against provider records. A changed/rolled-back wall clock may not reset a daily budget: detect day/clock regression and lock live dispatch pending operator reconciliation. The ledger prevents a restart from erasing spend; multiple processes must be refused through a data-directory lock. Reservation tests use fake time and fake provider billing, not real funds.

## 2.9 Events, consented records and export

Client events use the exact closed discriminated union in the API schema. Allow at most 20 events/request,120 events/minute/session,500 events/round,10,000 queued globally. No arbitrary event names, data objects, URLs, DOM text or extra properties. Event IDs are idempotent by session+round+canonical payload; changed payload conflicts 409, exact duplicates acknowledged without recounting. Authenticate owner before validation diagnostics. Events/feedback neither mutate round revision nor extend expiry. Accept late events up to24h only against a retained owner-bound tombstone; reject unknown/foreign IDs404. Memory queue max 20 client events; persist only bounded timeout/uncertainty event descriptors (no text), never event batches or free-form guesses.

Server-authoritative events: round_started, guess_submitted, generation_started, candidate_rejected, act_ready, generation_failed, revealed, abandoned, expired. Derive timestamps/profile/condition/model/token/cost only on server. Client can report play_started, play_completed, playback_failed, playback_mode_changed, visibility_changed, client_ready, client_deadline and client_clock_uncertain. Client messages are observational and cannot set server generation success, consent, condition or paid call counts. A client_ready only counts when hash/attempt match a committed score; play_completed requires a matching earlier play_started ID. Event flags are monotonic ORs: client_deadline/clock_uncertain can be set, never cleared by a later event. A server deadline remains server-derived. Visibility/reload cannot turn a clock-uncertain run into primary success.

Default private play persists no raw guesses, targets, prompts, motion scores or linked participant histories. RAM holds active round content until expiry/end/process shutdown. Operational storage retains only random technical IDs, enum events, numeric timings/counts, hashes/version identifiers and sanitized errors for at most 24h. No IP address, user agent, names, emails, device fingerprint or URL-query logging. Use cookie/session rate limits and global caps on this loopback app; no need for a persisted IP bucket. Financial ledger uses the separate minimal retention above; delete closed detailed reservations after 30 days once reconciled, retaining only unlinked daily numeric totals for budget integrity.

Study start requires owner-run frozen manifest and participant consent screen that names OpenAI, explains when first guesses are transmitted, actual provider policy links, raw seven-day retention and separate optional 30-day pseudonymous result retention. Practice sends withheld guessData but still generates if live study activated. `store=false` does not promise zero provider retention: verify applicable organization/provider retention and disclose before live use. OpenAI documents separate abuse-monitoring/application-state controls. [T10] No names/contact/health information is requested. Consent is not a detector or guarantee that free text lacks personal data; a discovered private-data incident stops affected processing and follows local/provider deletion controls without a promise to unsend.

The separately authorized creator-owned quality-probe ledger preserves every exact request body and bounded raw response (including invalid attempts) for 7 days as specified in the API supplement; it excludes secrets and participant data. Raw guesses live in separate access-controlled SQLite tables ONLY for explicitly consented study collection and expire no later than 7 days. Exact study/runtime prompts are not saved in v1; versioned templates plus retained authorized inputs can reconstruct within retention only. Optional score/result bundles exclude raw guesses/prompts and expire 30 days; otherwise delete them at7days. Publication/example reuse is a separate opt-in, never inferred from research retention or local capture. Withdrawal removes linked raw, result, feedback, event and export-cache records under the withdrawal code; exported local files cannot be remotely recalled, so operator export screen warns and names retention deadlines. Deleted subject data may leave only aggregates permitted by consent. Purge on startup, hourly and before every export; failed purge blocks study collection/export until fixed.

Operator exports: analyst CSV per the supplied data dictionary, raw responses separately, first-/second-guess blinded coder CSVs with opaque shuffled row IDs and frozen rubric only, manifest/provenance JSON, and optional validated score bundles. Escape CSV formula-leading cells (=,+,−,@ and leading tab/CR) or serialize safe quoted text per a tested export routine. Download-only generated files; never public links. Second-guess coder export stays gated until first-guess adjudication lock exists. No export silently imputes missing guesses/ratings, merges practice with comparison, treats fixture results as live, or treats timeout/clock uncertainty as successful primary outcomes. Full contracts and tests are in the supplements and evaluation chapter.

## 2.10 Required verification matrix

Implement every row in `technical-test-fixtures-v1.json` as an automated contract test, plus the full-build checklist. The supplied fixture descriptions are acceptance cases, not claimed executed tests. Minimum classes: strict parser/size/depth/prototype, roster/time/rate bounds, smoothstep arithmetic, stage containment and continuous pair clearance; pure sampler and reduced-motion/visibility; owner/Origin/operator gates and target leak audit; creation crash recovery and double create; duplicate/revision race/skip during generation and stale completion; deadline-before-await, reload-before 202, wall-clock change, process restart and late recovery; event/feedback idempotency/limits/ownership/retention; practice/profile separation; actual adapter HTTP contract with mocked transport; refusal/incomplete/unknown shape/schema drift; reserve-before-dispatch, unknown billing/restart/day regression; consent/purge/withdrawal/export blinding and local capture.

App release evidence must identify exact commit/toolchain/schema/prompt/geometry/contact versions and list tests passed, failed and not run. Offline fake-provider tests establish engineering behavior only. Paid model probes, calibrated meanings, actual latency, audience comprehension, fidelity and participant-study results remain unmeasured until those specific activities occur. Completing the code is not evidence that any product/research gate passed.

### Technical sources checked 8 October 2026

- [T1: Node.js release status](https://nodejs.org/en/about/previous-releases)
- [T2: MDN requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)
- [T3: MDN Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)
- [T4: MDN reduced motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion)
- [T5: W3C Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html)
- [T6: W3C Non-text Content](https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html)
- [T7: OpenAI Responses API reference](https://developers.openai.com/api/reference/typescript/resources/responses/methods/create)
- [T8: OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)
- [T9: Vite environment-variable exposure](https://vite.dev/guide/env-and-mode)
- [T10: OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data)

Sources establish platform interfaces and limitations. Product limits, contact certificate, storage policy, API contract and budgets are v02 design decisions, not observed performance or externally validated thresholds.
