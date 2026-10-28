# Local directing workspace additions

The directing workspace extends the local application with ten capabilities:

1. Three pre-authored directing examples, with explicit illustrative provenance.
2. A dismissible guide through a private fixture round.
3. Post-reveal comparison and numeric change summaries, outside Study.
4. Private saved candidate snapshots and version relationships.
5. An offline provider configuration readiness assistant.
6. Clickable import validation diagnostics.
7. Rehearsal beat loops and timestamped review notes.
8. A constrained numeric keyframe editor with bounded undo.
9. A standalone, score-only offline rehearsal inspection packet.
10. A previewable, allowlisted environment support report.

These are additive workspaces. The v0.2 source pack, authored first-act bank,
meanings, roster, motion language, study allocation and participant DTOs stay
unchanged. No live calls, credentials, recruitment, publication or public listener
are part of this work. New examples are authored illustrations, not observed
adaptation or evidence of improved comprehension. Human qualification stays
NOT RUN. The original fixture round continues to repeat take one.

## Closed operator extension

This document records the accepted additive operator contract. Ordinary exact
Host/Origin, session authentication and separate operator authorization run before
lookup or body validation. Locking operator tools removes access immediately.

- `GET /api/operator/showcases` returns an `examples` array. Each example has
  `id`, `title`, `exampleGuess`, `intention`, `explanation`,
  `source: "authored_fixture"`, `humanReview: "not_run"`, and `left`/`right`
  objects containing only `score` and `scoreHash`. It never accepts a guess.
- `GET /api/operator/candidates` returns `candidates`, an array of summaries.
- `POST /api/operator/candidates` accepts exactly `requestId`, `sceneId`, `title`,
  `score`, `parentCandidateId` and `notes`. IDs are lowercase UUIDv4. Titles have
  1–80 characters. At most twelve notes each have exactly an integer `atMs` within
  the score and 1–240 characters of `text`. Scores pass the unchanged validator
  against the selected authored scene's roster. A parent must exist in that scene.
  Success returns `{candidate: ...}`. Exact request retries return the original
  immutable snapshot; changed input conflicts. At most 64 snapshots are stored.
- `GET /api/operator/candidates/:id` returns `{candidate: ...}` or NOT_FOUND.
- `GET /api/operator/candidates/:id/inspection` returns an offline ZIP. It includes
  the validated score, an inspection manifest and an engine-owned HTML player.
  Candidate titles, notes, guesses, targets, local IDs and private paths are omitted.

A summary has exactly `candidateId`, `sceneId`, `title`, `scoreHash`,
`parentCandidateId`, `createdAt` and `noteCount`. A full candidate adds `score`
and `notes`. Stored candidates are operator-created snapshots with unqualified
semantic provenance, regardless of their imported numerical contents.

Snapshots belong to this trusted local operator workspace, not participant
sessions. They survive app restart in a separate private SQLite file. No draft or
note is persisted in browser storage. There is no automatic deletion of authored
work. Save explicitly, export copies as needed, and treat this data directory as
private. The 64-snapshot bound makes storage use finite.

## Delivery checks

New logic receives focused unit and HTTP boundary tests. Browser checks exercise
the actual guide, examples, editor, persistence, comparison, loops and downloaded
inspection player, including narrow layout and reduced motion. Existing Study,
recovery and privacy checks must continue to pass. Final verification is
`npm run verify:all` and `npm run audit:dependencies`, followed by a fresh source
distribution check. Independent review examines the integrated diff.

Software results establish behavior only. Observed newcomer completion, review
speed and comprehension remain unmeasured until a separately authorized human
evaluation. Probe browsing, benchmark expansion, coder UI and video encoding are
later candidates, not requirements added to this pass.

## Recovery, capture timing and candidate maintenance

These operator extensions preserve the frozen participant event and motion
contracts.

- `GET /api/study-start-requests/:requestId` requires the owning session and
  returns exactly `{status:"accepted",studySessionId}` for its cached accepted
  study-start request, or `{status:"unknown"}`. It exposes no consent or
  withdrawal data. Replies expire after 24 hours and disappear on restart.
  Explicit recovery never starts a round or enrolls automatically. Browser
  recovery metadata is strictly bounded and excludes consent choices and text.
- `POST /api/operator/candidates/:id/remove` accepts exactly `{requestId}`.
  Both IDs are lowercase UUIDv4. It requires operator authority and returns
  `{removed:true}`. A version with retained children returns LIMITED. Removal
  wipes its score/title/notes payload and frees one of 64 retained-version
  slots. Small request-identity tombstones prevent an old save request from
  recreating it. Exact removal retries are safe. The active unsaved draft stays
  in memory. No automatic removal occurs.
- `POST /api/operator/creator-rounds/:id/capture-trace` accepts exactly
  `{requestId,documentId,states}` after operator and owning-session checks.
  It is restricted to creator-owned private rounds. At most 256 closed,
  contiguous states and 64 KiB describe one document's monotonic control timing
  through reveal. Both accepted guess request identities, score hashes,
  positions, phases and bounds are checked. It accepts no free text or target.
  Exact duplicates are idempotent; conflicting records fail. Timing disappears
  on expiry or restart. Study events and participant collection are unchanged.

Capture manifests identify observed creator timing or score reconstruction.
Incomplete timing has no actual timeline. Observed waiting and server generation
duration are distinct. Shortening never cuts recorded playback. See
[creator capture](CAPTURE_RUNBOOK.md) for use and limits.

Internet connectivity hints trigger a bounded same-origin availability check.
Only actual local-service failure disables actions. No connectivity check
contacts an external service or automatically submits a guess or consent.

## Complete directing workflow

The 0.3.0 local workspace connects the existing capabilities without changing
the closed APIs or stored schemas above. Prepared takes are fetched through the
existing showcase route, checked against their hashes and scene roster, then
opened explicitly in Rehearsal. Navigation permits only allowlisted scene/take
or saved-candidate identifiers. It carries no score, title, note or meaning.

The playhead can open a constrained numeric fork. Valid forks can be inspected
against their source on a shared clock using the main stage, then applied at
the same paused position. Source notes must
be saved under their original score hash before changing it. Saved versions
are findable across scenes and can be compared directly with their parent.
Exact comparisons expose stored values and inspection intervals without judging
meaning or inferring moved-key identity from proximity.

The separate client-generated [pair inspection](PAIR_INSPECTION.md) has its own
artifact kind and excludes private metadata. It leaves the accepted single-score
inspection endpoint and recorded-round capture packet unchanged. A download
checks existing operator access and validates both scores before creating the file.

The [private workspace backup commands](WORKSPACE_BACKUP.md) preserve creator data
locally with the app stopped. They use no HTTP endpoint and never read participant
or provider databases. Restore validates records and recreates trusted tables
in a new empty private directory. Neither command merges or overwrites existing data.

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
