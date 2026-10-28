# Local API amendments

This document supersedes the v0.2 specification's endpoint and field allowlist
for exactly the bounded additions below. The accepted additive operator workspace
contract is separately defined in [PRODUCT_ADDITIONS.md](PRODUCT_ADDITIONS.md).
Other participant contracts, allocation, retention limits and provider
requirements remain unchanged.

## Finish a study session

`POST /api/study-sessions/:id/finish` accepts exactly
`{requestId: <lowercase UUIDv4>}` and succeeds with exactly `{saved: true}`.
Ordinary Host/Origin, owner-cookie, body-size, strict parser and request-ID rules
apply. Authentication precedes lookup. Foreign and unknown sessions return
`NOT_FOUND`. A reused request ID with a changed method, path or body conflicts;
an exact successful retry returns its saved result.

Finish requires every planned main encounter to be terminal, final session
feedback already saved, and no active round. It closes future extra creation.
For an accepted but unstarted extra, the original acceptance stays true while
started/completed become false. Repeated Finish is a no-op. A terminal extra
retains its actual started/completed outcomes. The hourly cap is unchanged.

## Restore final feedback confirmation

The owner-only study progress DTO has a required boolean `feedbackSaved`.
It reflects the authoritative existing session-feedback flag. It exposes no
choices, target, condition, allocation or operator information and grants no
capability. The UI uses it to restore confirmation after refresh.

## Read round feedback status

`GET /api/rounds/:id/feedback` returns exactly
`{saved:boolean,secondActCompletionRecorded:boolean}` after ordinary
round ownership and expiry checks. Foreign and unknown rounds return `NOT_FOUND`;
expired rounds return `EXPIRED`. It returns no rating, guess, meaning, allocation
or provider information. It does not save feedback, advance a study, create
storage or call a provider. Existing once-only POST feedback remains unchanged.

An uncertain save is resolved with this read before another form is offered.
Saved feedback restores Continue; an unavailable read offers explicit retry.
HTTP boundary and lost-response browser tests cover these amendments.

The completion flag, authorized on 26 October, requires accepted matching start
and completion events for the available second act and its exact score hash and
play identifier. Full motion and completed frame traversal both qualify. False
means no matching completion is recorded, not that a person did not watch.
Unavailable or malformed reads do not establish eligibility. The UI reconciles
an outstanding completion before finalizing feedback; an unavailable observation
requires an explicit choice to continue without helpfulness. This does not change
the full-motion research metric, the analyst format or any human qualification.

## Retry a withdrawal after refresh

The 26 October amendment extends normal `POST /api/session` response to exactly
`{sessionReady:true,activeRoundId:UUIDv4|null,recoveryOwnerId:UUIDv4}`. Its body
remains `{}`. The added value is the existing random technical session identifier,
not an authentication capability. It does not extend the eight-hour authority.

`POST /api/study-withdrawals` now requires exactly
`{requestId:UUIDv4,withdrawalCode:string,expectedRecoveryOwnerId:UUIDv4}`. The code
is the existing 26-character uppercase Base32 value. Authenticate and compare the
current owner before cached replay, lookup or mutation. An expired or mismatched
owner is UNAUTHENTICATED. Bind the full body to idempotency; a successful exact
replay precedes attempt limits. The response remains `{deleted:true}`.

One closed tab-scoped receipt stores version1, requestId, a full canonical SHA-256
digest of requestId and code, recoveryOwnerId and nullable studySessionId. Its cap
is 384 UTF-8 bytes inside the aggregate 8KiB recovery budget. The digest is an
approved secret-derived equality verifier; the raw code is never stored. Persist
and read back the receipt before dispatch. After refresh, require explicit code
re-entry and a matching digest, then retry directly with the saved identity.
Never establish a replacement owner to replay it. Unknown outcomes retain the
receipt until confirmed success or explicit discard. Discard proves no deletion.

Cleanup requires positive identity proof and unchanged local records. Saved Study
identifiers are hints, not authority to erase another request. After deletion has
removed server bindings, unproven local records remain for explicit review or
discard. No new endpoint, provider action or research allocation is introduced.

## Read an uncertain mutation's acceptance after expiry

GET /api/rounds/:roundId/requests/:requestId/status returns exactly {accepted:boolean} after authentication and owned technical-round authorization. Identifiers are lowercase UUIDv4. True means that exact request was committed as a POST guess, skip or abandonment on that round; false means it was not. Foreign, unknown or invalid identifiers return NOT_FOUND. The existing technical tombstone lifetime and authentication expiry apply. The read never touches a deadline, revives a round, binds a request or dispatches work. It exposes no text, timestamps, meanings, allocation or provider data. Ordinary expired snapshot and request reads still return EXPIRED.

Only an explicit recovery check uses this receipt. Accepted first-guess timing evidence must be acknowledged through the existing event endpoint before the saved mutation clears, including an accepted guess whose generation hit a capacity limit. An unaccepted receipt clears only that request's rejected proof. Unavailable or malformed responses retain uncertainty.

## Confirm expired Study creation identity

GET /api/study-sessions/:studySessionId/rounds/:roundId/creation-requests/:requestId/status returns exactly {accepted:boolean}. Authenticate before lookup and require lowercase UUIDv4 identifiers. The technical round must be owned and its server-side Study must match the supplied Study. A mismatched, foreign, unknown or invalid Study/round returns NOT_FOUND. True requires the exact owned POST /api/rounds creation request to bind to this round; an unmatched request returns false. The same tombstone, security, retention and no-mutation rules apply.

When ordinary creation lookup returns EXPIRED, an explicit check must confirm this identity before clearing expired Study recovery. False, unavailable or malformed receipts preserve the saved records. Conflicting mutation/recovery round identifiers stay held. These receipts add no browser storage and expose no additional round or Study data.

## Observe actual reduced-motion preference

The closed ClientEventV1 union adds exactly the existing base fields eventId, clientSequence and elapsedMs plus {name:"motion_preference_observed",reducedMotion:boolean}. Existing event bounds, ownership, batching, rate, idempotency and retention apply. The client observes the media query for an owned active round initially and when its value changes. Playback mode remains a separate observation.

The first observed Boolean populates the existing reduced_motion analyst column. Missing and legacy observations stay null. Subsequent value changes are retained server-side; restricted provenance includes rounds[].motionPreference with exactly {initial:boolean|null,changes:integer}. Repeated values and duplicate deliveries do not add changes. The 96-column analyst header and masked exports remain unchanged. No device identity or new browser storage is collected. This observation proves neither successful viewing nor human comprehension.

## Guided private workspace preservation

The additive operator-only JSON backup and previewed restore contract is defined
in [WORKSPACE_BACKUP.md](WORKSPACE_BACKUP.md). `GET /api/operator/workspace/backup`
downloads the closed snapshot. `POST /api/operator/workspace/restore-preview`
accepts that snapshot directly and returns exactly `artifactHash`,
`workspaceHash`, `incoming`, `additions`, `alreadyPresent` and `resulting`.
Each count object has exactly `candidates`, `tombstones` and `removals`.
`POST /api/operator/workspace/restore` accepts exactly
`{snapshot,expectedWorkspaceHash}` and returns those preview fields plus
`status:"restored"|"already_present"`. Import is an atomic additive union;
changed identity/content or active/tombstone state conflicts. Exact repeated
unions remain idempotent after restart without an operation receipt table.
Authentication precedes operator authorization and body parsing. Both authorities
are rechecked after asynchronous body reads. Exact Host/Origin, no-store responses,
strict JSON limits and safe errors with technical request IDs apply. No upload
body is logged or placed in browser storage. These routes never accept paths or
raw databases and do not alter participant, Study or provider contracts.
