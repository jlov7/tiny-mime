# Architecture

Tiny Mime uses React, Vite and SVG in the browser; Node.js, TypeScript and SQLite
on the server. It runs one local HTTP listener at `http://127.0.0.1:4317` in both
development and production. Development uses on-request compilation with HMR
and its WebSocket listener disabled.

| Location | Responsibility |
| --- | --- |
| `src/client/` | Navigation, playback, forms and bounded recovery descriptors |
| `src/shared/` | Public score types, parsing, normalization and geometry validation |
| `src/server/http.ts` | Host/Origin checks, sessions, authorization and public DTOs |
| `src/server/rounds.ts` | Two-take round state and interrupted-request recovery |
| `src/server/operator/` | Protected rehearsal, imports and offline capture |
| `src/server/study/` | Consent, schedules, ratings, retention and analysis |
| `src/server/provider*` | Disabled-by-default Responses adapter, budgets and diagnostics |
| `fixtures/`, `tests/` | Authored/mock acceptance inputs and regressions |
| `scripts/` | Build, verification, local setup and source packaging |

## Motion language

MotionScoreV1 has two or three fixed geometric actors, a 1000 by 700 coordinate
system and six-to-ten-second scenes. Keyframes use bounded transforms. Strict
structural validation and continuous geometry checks enforce the noncontact-v1
language. Generated JavaScript, arbitrary assets and physics are not accepted.
The authored bank has eleven noncontact scenes and five matched motion references.
The contact-dependent scene is disabled.

## Trust boundaries

Requests are authenticated, authorized and validated before privileged logic.
Operator capability is distinct from participant ownership. Meanings, scoring
material, rosters, allocation, provider configuration and operator records stay
server-only. Public source naturally contains the authored bank; hiding that
source is not a substitute for runtime authorization or research blinding.

The [recovery API amendments](API_EXTENSIONS.md) supersede the specification's
endpoint/field allowlist for the documented implemented extensions only.
The [directing workspace extension](PRODUCT_ADDITIONS.md) separately defines
authored examples and closed candidate APIs. Participant DTOs and Study remain
unchanged. Candidate metadata and notes never enter public bootstrap data.

The private `rehearsal-workspace.sqlite` stores at most 64 immutable operator
snapshots with bounded notes and transactional request identities. This local
workspace survives restarts and is shared by authorized operators on that trusted
computer. It is separate from participant records and their retention. There is
no automatic deletion of authored snapshots or browser persistence of scores.

Prepared-take and candidate navigation contains only allowlisted technical IDs.
Scores are fetched through existing operator routes, checked against their
hashes and selected scene roster, and start paused. Saved-version links restore
the explicitly chosen snapshot; unsaved work stays in memory. Exact numeric
comparison and editing do not infer meaning or change the frozen bank.

Private [workspace backup and restore](WORKSPACE_BACKUP.md) run as local commands
with the app stopped. Only the creator database is preserved. Backup performs
SQLite operations on private staged DB/WAL copies under the normal application
lock; restore validates records and reconstructs trusted tables in an empty
destination. Neither operation reads provider configuration or participant stores.

The production client audit checks compiled assets for server-only material and
source maps. HTTP tests exercise exact Host/Origin restrictions, session isolation,
bounded bodies and protected routes. This is a trusted local-computer design,
not isolation from malware running as the same OS user.

## Generation and recovery

Live generation is disabled by default. The adapter requires explicit activation
evidence, a pinned model, strict structured output, disclosures and nonzero
budgets. A job has a deadline, a bounded validation repair and durable spend
reservations. Transport uncertainty does not release a potentially spent reserve.
Provider failures are surfaced rather than silently substituted with a fixture.

The browser stores bounded creation, mutation, round-recovery, Study-start and
withdrawal receipts in sessionStorage, within a shared 8KiB UTF-8 budget.
Guesses, scores, capabilities, raw withdrawal codes and configuration do not
belong there. The withdrawal receipt stores only a canonical code verifier and
technical retry identity; code re-entry is required after refresh. Requests keep
their identity and original deadlines. Owned acceptance receipts resolve expired
submissions where possible; unavailable or mismatched proof preserves uncertainty.
See [API_EXTENSIONS.md](API_EXTENSIONS.md) for the approved boundaries and
[RESEARCH.md](RESEARCH.md) for empirical limitations.

## Offline capture

Creator bundles contain escaped data, a strict offline Content Security Policy,
reconstructed playback and explicit timing/provenance metadata. No remote assets,
tracking, account connection or external upload is needed to view them.
Standalone rehearsal inspection bundles validate the saved score again and omit
candidate labels, notes and meaning. Both offline players embed the existing pure
sampler, use hash-bound scripts/styles and disable network connections through CSP.

The separate [pair inspection](PAIR_INSPECTION.md) is built in the operator client
from two already-authorized numeric score/hash/source records. It revalidates
both scores and their compatible cast, excludes private metadata and has its own
manifest kind. Its font and stable shared sampler source are generated before
Vite compilation. The exporter loads only when requested, keeping those assets
out of initial Home and Rehearsal navigation. The single-score inspection and
recorded-round capture contracts remain unchanged.

The separate [public preview](PREVIEW.md) is a build-time release companion,
not a participant route. It intentionally publishes three authored score pairs
and their fixed explanations behind a reveal control. It uses the same sampler
and hashed CSP. It includes no operator notes, session records, provider
configuration, study allocation or complete meaning catalogue. It does not
change the application's participant DTOs or serve as a blinded evaluation.

[Runtime qualification](RUNTIME_QUALIFICATION.md) is an operator CLI. Its offline
plan cannot dispatch. Approved execution reuses the existing runtime generator,
cost reservations and seven-day private diagnostics, with a hash-bound additive
private-ledger profile extension. No participant API or generation limit changes.
