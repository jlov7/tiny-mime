# Runtime timing diagnostic

`probe:runtime` inspects or, with separate explicit approval, runs a bounded private runtime timing diagnostic. The default is offline and credential-free. Default verification makes no live provider calls. Live timing and human usefulness remain **NOT RUN** until separately observed.

```sh
node --import tsx scripts/runtime-qualification.ts
node --import tsx scripts/runtime-qualification.ts --plan \
  --config /absolute/nonsecret-config.json \
  --evidence /absolute/nonsecret-evidence.json \
  --cases /absolute/frozen-cases.json \
  --data-dir /absolute/private-data
```

The first command prints `NOT RUN`. With all four explicit inputs, plan mode validates their offline bindings and prints `PREFLIGHT_VALID` and a canonical `planHash`. It does not inspect environment variables or credentials, authenticate, create accounting files, or dispatch requests. An inherited API key, provider environment, test hooks or input flags cannot make plan mode dispatch. `--plan` and `--execute` are mutually exclusive. Paths, meanings, guesses and outputs are omitted from terminal summaries.

## Required approval and inputs

Approval must cover the exact model, current official rates, disclosure, runtime purpose, bounded workload, frozen manifest hash and private accounting directory. Earlier subscription diagnostics or permission to prepare local code do not authorize this execution. An approval field or a valid input file does not grant human authorization.

Use the existing `ProviderConfigV1` and `ActivationEvidence` records. No config schema, model ID, pricing, support evidence, credentials or budget is manufactured by this command. Required config bindings are:

- Provider `openai_responses`, runtime enabled, unexpired approval purpose `runtime_private_play` or `runtime_and_quality_probe`.
- Runtime `approvedCaseCount` exactly equal to manifest count, at most nine cases. Cases consist of three per frozen development scene: two distinct synthetic first guesses and one withheld guess.
- Original runtime limits: 7,000 ms per call, 15,000 ms per case, at most two calls (one validation repair), 32,768 input token bound and 6,000 output cap. The quality probe's 45/90 second limits and 12,000 output cap are never used.
- Integer worst-case reservations fit call, unit, day and job caps, including a full possible repair for every case. Existing ledger history may still make dispatch unavailable.
- Exact activation evidence model, approval ID, disclosure and timing bindings. Official source records remain operator supplied and require independent verification.

The existing config schema has no case-manifest hash, private-directory binding or price-snapshot UUID field. It is unchanged. Therefore an operator must separately approve the canonical manifest hash, including its `dataDir`, and pass that exact hash at execution. The manifest's `priceSnapshotId` labels diagnostic rows; its `configHash` binds the actual price contents. Do not treat an arbitrary new UUID as evidence that rates were approved.

The nonsecret manifest is strict JSON matching exported `runtimePlanSchema` in `scripts/runtime-qualification.ts`:

| Field | Required value |
| --- | --- |
| `version` | `1` |
| `probeRunId`, `approvalId`, `priceSnapshotId` | Lowercase UUID v4; approval matches config |
| `creatorOwnedNonpersonal` | `true`, an owner assertion about every synthetic input |
| `configHash`, `evidenceHash` | `canonicalHash` of the parsed exact records |
| `probeLedgerSchemaHash` | `runtimeProbeLedgerSchemaHash` from the diagnostic script |
| `providerVersionsHash` | `canonicalHash(providerVersions)` from the existing adapter |
| `dataDir` | Exact absolute private directory used for existing runtime accounting |
| `cases` | Three to nine entries, unique case UUIDs, full triplets per scene |

Each case has only `caseId`, `sceneId`, `meaningHash`, `rosterHash`, `firstScoreHash`, and `context`. `sceneId` must be TM01, TM09 or TM04. Hashes must match the actual current `getScene` bank: `canonicalHash(scene.meaning)`, `canonicalHash(scene.roster)`, and `scene.scoreHash`. Full context must match `directorMeaning(scene.meaning)`, the frozen roster and the unchanged first score. It uses `attempt: 2`, `firstGuessOccurred: true`, `repairErrors: null`, and either `runtime_informed_v1` with a normalized synthetic actual guess or `runtime_blind_v1` with withheld guess data. Study/practice and development-probe profiles, edited meanings/scores, duplicate guesses, incomplete triplets and cross-plan hashes are rejected.

Use `canonicalHash` from `src/shared/hash.ts`, not a hash of whitespace-sensitive JSON file bytes. The default inspection command supplies no synthetic model or approval template. It accepts only explicit bounded nonsecret JSON files, uses fatal UTF-8 decoding, rejects duplicate keys, and rejects symlink and credential-like paths. Use resolved macOS paths; `/tmp` or `/var` aliases may be symlinks. Private storage must be outside the checkout and have no symlinks in its accounting or diagnostic files.

## Explicit execution, only after approval

Case IDs must also be lowercase UUID v4. This matches the private ledger format
and is checked before credentials, accounting files or provider dispatch.

Keep credentials in the already approved secure environment. Do not put keys in arguments, config, manifests, shell history, tracked files or terminal output. Execution additionally requires exact existing `TM_PROVIDER_MODE`, `TM_MODEL_ID`, `TM_PROVIDER_CONFIG` and `TM_DATA_DIR` environment bindings; study activation is rejected. After obtaining approval immediately before this particular run, use the approved hash:

```sh
node --import tsx scripts/runtime-qualification.ts --execute \
  --config /absolute/nonsecret-config.json \
  --evidence /absolute/nonsecret-evidence.json \
  --cases /absolute/frozen-cases.json \
  --data-dir /absolute/private-data \
  --approved-plan-sha256 APPROVED_CANONICAL_MANIFEST_HASH
```

The private `probe-ledger-v1.schema.json` generation-profile enum is additively extended to accept `runtime_informed_v1` and `runtime_blind_v1`, while retaining both existing development-probe profiles. The frozen source pack and participant/provider contracts are unchanged. The canonical schema hash is bound into the approved plan and private run metadata; changing it requires fresh plan approval. Runtime attempts are never relabelled as development probes.

Execution calls existing `generateValidated` sequentially, with existing `BudgetLedger` reservations/reconciliation and `ProbeLedger` diagnostics. It creates no HTTP route and makes no changes to the runtime protocol or request template. Never choose a fresh directory to evade existing uncertain spend or reset budgets. An existing restart or billing lock blocks this command; use the established operator reconciliation process. Neither this command nor cancellation reconciles unknown billing on the owner's behalf.

The private diagnostic directory has seven-day raw retention through `ProbeLedger`. Each attempt records its request, response bytes when observed, reservation, known cost or retained unknown reserve, validation errors, termination and timing. A private `*.summary.json` records all planned case outcomes, including failed and unattempted cases. Files are mode 0600 under private directories. Diagnostic or accounting failure stops execution. An unwritable diagnostic file may prevent a final summary; existing SQLite reservations and any written attempt records remain the authority for spend uncertainty.

Refusal, incomplete output, cancellation, deadline, provider error, budget failure or billing ambiguity stops later cases. Only score validation failure permits the existing single repair. There is no outer retry. Ctrl-C/SIGTERM cancels the current request and later cases; transport cancellation does not establish that billing stopped. The existing 7-second call timer and shared 15-second deadline remain active during a repair. A maximum nine-case run is sequential and bounded; stopping early leaves later cases explicitly unattempted.

## Reading results

Terminal totals include planned, attempted, unattempted, valid, unchanged and failed cases, actual calls, failure counts and elapsed time. `completedCaseP95Ms` is nearest-rank p95 over **valid completed cases only**; failed and unattempted cases remain in the denominator counts and are never silently discarded. A `COMPLETE` run means every case was processed, including possible validation failures. It does not mean every case succeeded.

Actual live attempts report `TIMING_EVIDENCE_ONLY`. Mock transport/clock injection is rejected outside `NODE_ENV=test` and reports `mock_fixture`, `mock_zero` and live `NOT RUN`. Authored first scores remain authored fixtures. Valid new scores are runtime generated only during real execution. A validated unchanged score counts as `noChange`, not an improvement. No result from this command establishes semantic fidelity, improved communication, comprehension, enjoyment, physical-device usability, study readiness or general provider qualification. Human usefulness is always `NOT RUN` and semantic improvement is `NOT ASSESSED`.

Scoped checks (no network/provider calls):

```sh
npm run typecheck
npm test -- tests/unit/runtime-qualification.test.ts
```
