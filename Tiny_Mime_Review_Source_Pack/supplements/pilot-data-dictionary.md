# Tiny Mime pilot data dictionary

This schema defines the header-only `pilot-results-template.csv`. It contains no observations. Use one row per initiated participant–scene round, including rounds that end before retry assignment. Formative, bank-calibration, practice, comparative, and optional-extra records share a format but must never be pooled for the repair estimate. A row is uniquely identified by `study_run_id`, `study_phase`, `participant_id`, and `round_index`; do not silently deduplicate conflicting rows.

**This combined CSV is analyst-only, never a coder worksheet.** Create a separate, independently shuffled export for each coder containing only an opaque row ID, frozen target rubric, and one guess. Keep the mapping back to the combined CSV in a restricted linkage file. Release first-guess exports first; lock adjudication before releasing separately shuffled second-guess exports. Never give coders condition, paired guesses, prompts, generated clips, timing, or already completed ratings.

## Entry conventions

- **C means comparative-pilot core:** populate when the relevant event occurs in an authorized comparison, or record why it is unavailable. Early formative collection uses the small subset below; unavailable comparative fields stay null. Core does not mean forcing a participant to answer or preserving withdrawn data.
- **O means optional diagnostic:** populate only if the implementation exposes it and the approved protocol needs it. Do not reconstruct unavailable values or burden facilitators with manual entry of automated diagnostics.
- Empty CSV fields mean **null**, not zero, false, failure, or “not applicable.” Use the appropriate status field or `missingness_reason` to explain nulls. Do not put `NA`, `unknown`, or sentinel numbers in numeric fields.
- Boolean values are `true` or `false`; integer and decimal fields have no unit symbols. Timestamps use ISO 8601 UTC, for example `2026-10-08T15:00:00.000Z`. This is a format example, not an observation.
- Durations are nonnegative milliseconds. Prices are decimal currency units and need an ISO 4217 `currency`. Counts are nonnegative integers; semantic ratings are integers 0, 1, or 2.
- IDs are opaque pseudonyms or version references. They must not contain names, email addresses, guess text, account IDs, or private paths. Hashes identify animation artifacts, not raw guesses. Do not place guessed text in metadata, comments, or CSV notes.
- Neutral participant-visible copy must not be driven by these offline human scores. Data entry does not create a live correctness judge.

## Small formative record and automatic field ownership

This 96-column analyst export is an interchange schema, not a 96-question form or a checklist for a facilitator to fill in. Build its complete export/analysis tooling after the playable round, as specified by the implementation sequence. The early scene test needs only a consented participant pseudonym, scene/hash/version, display/motion mode, exact unlabeled interpretation in restricted raw storage, a short optional enjoyment response, and the observed technical outcome. If the two-act loop is available, add its two guesses and genuine extra-round offer/events. No coder/adjudication or comparison-schedule fields are required merely to see whether three scenes work.

- **Configuration or server-derived:** run/phase IDs, consent and retention references/choices/deadlines, scene/target/category, schedule/condition/randomization, versions, source/authoring/review status, hashes, generation profile, provider metrics/cost, accepted submission times, termination/failure, raw-record links and expiry. The server attaches existing configuration; participants do not type it into a form. Server-held enrollment is authoritative for consent/retention; generic client events cannot extend a grant or supply their own consent status.
- **Client observations, reconciled with server state:** playback completion/replays, reduced-motion state, optional viewport, client-ready latency, timeout/uncertainty, and optional-round playback. Missing diagnostics remain null and are not guessed by an operator.
- **Direct participant input:** the ordinary guesses through the game, voluntary numeric enjoyment/helpfulness feedback, declared willingness, and optional-extra choice. These are the only player-facing research answers beyond consent; do not ask the player to inspect their analysis row.
- **Human review later:** independent semantic scores and fidelity labels, adjudication, rubric lock, bank-calibration decision, and any necessary bounded deviation/note record. Export tools create masked work queues and rejoin by restricted keys. An operator does not manually reconstruct timing, token counts, cost, or assignment.
- **Analyst-derived automatically:** primary_eligible, second_full_operational, initial_correct_retained, fidelity_preserving_repair, disagreement classification, and flow/continuation summaries. A reviewed formula and locked inputs produce these fields; no discretionary hand-filled success labels.

An early test with no authorized study collection can use transient playback and the builder's own observations. It must not invent participant IDs or raw answers to populate this schema. Authored fixture-only playback uses zero provider calls. Practice's frozen withheld profile only consumes calls if an authorized configured real provider is invoked; mock fixtures remain labeled and do not establish model performance.

## Study provenance and participant handling

| Field | Tier and type | Meaning and nullability |
| --- | --- | --- |
| protocol_version | C string | Frozen protocol identifier; required for every retained row |
| study_run_id | C string | One approved study run; required |
| study_phase | C enum | `formative`, `bank_calibration`, `practice`, `comparative`, or `optional_extra`; required. The initial 4–6 formative testers, separate bank-calibration cohort, and 24 new comparison participants have separate recruitment/consent scopes. Two practice rounds × 24 gives 48 planned practice records outside the 192 measured encounters. No observations are included |
| participant_id | C string | Random study pseudonym; required while record is retained |
| consent_version | C string | Version of consent text used; required |
| consent_record_id | C string | Reference to restricted consent evidence, without identity or signature content; required |
| research_retention_opt_in | C boolean | Separate explicit choice allowing a pseudonymous score/result bundle to remain for up to 30 days; not inferred from participation |
| raw_delete_due_utc | C timestamp | Earliest applicable raw-record deletion deadline, no later than seven days after collection; earlier deletion or withdrawal takes precedence |
| scene_id | C string | Frozen scene record; required; scene belongs to a defined target |
| target_id | C string | Semantic target record; required; never use raw target wording as the identifier |
| target_category | C enum | `physical` or `social`, assigned before comparison freeze; physical scores observable action, social requires intention/relationship inference. Resolve overlap before a planned four/four bank; if infeasible revise the protocol before recruitment instead of forcing labels |
| scene_meaning_version | C string | Frozen server-only SceneMeaning contract version; required for each scene. Contains minimum event, roles, compatible elaborations and contradictions; CSV holds only its identifier |
| contact_policy_version | C string | Motion contact policy applied to each score, initially `noncontact-v1`; required |
| bank_calibration_record_id | C string, nullable | Restricted per-hash calibration decision record; required before actual comparative collection, null for uncalibrated authored software fixtures. A candidate, a rendered clip, or an author review is not human calibration |
| first_variant_id | C string | Preauthored first-performance variant; required; one frozen variant per scene in the formative comparison |
| round_index | C integer | Positive chronological round number within participant and phase; includes initiated/aborted rounds |
| schedule_id | C string | Counterbalanced order/allocation schedule; required for comparative phase, optional for other phases |
| condition | C enum, nullable | `informed` or `blind_retry` after first-guess submission and assignment; null before randomization and throughout all noncomparative phases |
| randomized | C boolean | Whether comparative retry assignment occurred; required. All noncomparative phases and prerandomization skips are false |
| randomized_at_utc | C timestamp, nullable | Assignment time; required when randomized is true, otherwise null |

Keep participant-to-withdrawal-code handling restricted. A public report must not expose participant rows merely because their IDs are pseudonymous. Withdrawal requiring deletion removes that person's retained records, including copies and response links. Aggregate flow counts can remain only where the agreed consent permits; no placeholder row should preserve deleted private details.

## Artifact and generation provenance

| Field | Tier and type | Meaning and nullability |
| --- | --- | --- |
| renderer_version | C string | Exact renderer build/version; required |
| first_source_kind | C enum | `authored_fixture` for all approved baseline first acts; required; no live act-one generation |
| first_authoring_method | C enum | `spec_transcribed`, `agent_assisted`, or `human_authored`; required. Codex composition is agent_assisted; do not infer human authorship from later review |
| first_human_review_status | C enum | `not_run` or `reviewed`; required. Reviewed is not a calibrated or successful label |
| second_source_kind | C enum, nullable | `runtime_generated`, `mock_fixture`, or `authored_fixture`; null if no second score exists. Fixture rehearsals never count as live-generation results |
| generation_profile | C string, nullable | Exact provider input policy, separate from analysis condition. `practice_blind_v1` in every practice generation; no practice guess in provider input. `runtime_informed_v1` or `runtime_blind_v1` in comparative rounds. Null only when no generation was requested; fixture policy must remain explicitly labeled |
| model_version | C string, nullable | Exact act-two provider/model identifier; null if no real provider request occurred |
| prompt_version | C string, nullable | Frozen prompt-template version, not prompt contents; required if generation was requested |
| rubric_version | C string, nullable | Version used for human semantic ratings; required when any semantic rating is present |
| first_animation_hash | C string | Integrity hash of frozen preauthored score/artifact; required for an exposed first clip |
| second_animation_hash | C string, nullable | Hash of validated second score actually presented; null if none was presented |
| generation_parameters_id | O string, nullable | Reference to model sampling settings if relevant; never imply the deterministic renderer uses a random seed |
| first_clip_duration_ms | C integer, nullable | Planned duration of first clip; required if available; 6,000–10,000 ms under the proposed contract |
| second_clip_duration_ms | C integer, nullable | Planned duration of presented second clip; same duration contract; null without a valid second clip |
| response_record_id | C string, nullable | Restricted raw-response record reference; required while guesses exist, removed when those records are deleted; no raw guess in CSV |
| first_guess_codepoints | O integer, nullable | Unicode-codepoint count, 1–240 when submitted; null when skipped or no submission |
| second_guess_codepoints | O integer, nullable | Same rule for second guess |

`response_record_id` is not a durable permission to retain raw data. Delete linked responses and exact model prompts on schedule; remove dangling raw-response links from longer-retained result bundles. Exact prompts may contain the informed arm's guess and therefore share its restricted retention.

## Blinded semantic ratings and derived outcomes

| Field | Tier and type | Meaning and nullability |
| --- | --- | --- |
| first_score_rater_1 | C integer, nullable | First coder's independent 0/1/2 first-guess score; null without a submitted/scorable retained answer |
| first_score_rater_2 | C integer, nullable | Second coder's independent first score; same rule |
| first_score_adjudicated | C integer, nullable | Resolved first score; null until adjudication is complete |
| first_adjudication_locked_at_utc | C timestamp, nullable | Lock time before coders see second-attempt material; required when first adjudicated score exists |
| second_score_rater_1 | C integer, nullable | Independent second-guess semantic score; missing response is null, not an invented 0 |
| second_score_rater_2 | C integer, nullable | Other coder's second score; same rule |
| second_score_adjudicated | C integer, nullable | Resolved second score; null until complete or if no retained response |
| score_disagreement_type | O enum, nullable | `none`, `first_only`, `second_only`, or `both` based on available independent ratings; null before comparisons exist; detailed reasons stay in restricted adjudication records |
| primary_eligible | C derived boolean, nullable | True only for comparative randomized retained rounds with adjudicated first score 0 or 1; false for initially correct or nonrandomized rounds; null until required first adjudication is complete |
| second_full_operational | C derived boolean, nullable | Operational full recognition on the second guess; formula below; null before outcome resolution or outside randomized comparison |
| second_fidelity_rater_1 | C enum, nullable | Independent masked artifact rating: `target_preserved`, `unclear`, `changed_story`, or `unrateable`; null until reviewed |
| second_fidelity_rater_2 | C enum, nullable | Other masked reviewer's independent rating under the same contract |
| second_fidelity_adjudicated | C enum, nullable | Resolved fidelity label; null until adjudicated. Unclear is insufficient evidence; changed_story is a positive contradiction/material alteration; do not combine them |
| semantic_fidelity_record_id | C string, nullable | Restricted opaque artifact-review and adjudication record; contains hash/meaning version/reason code and linkage, never included in recognition coder files |
| fidelity_preserving_repair | C derived boolean, nullable | Secondary outcome only: true when second_full_operational=true and fidelity=target_preserved. False if operational outcome=false or fidelity is changed_story/unclear/unrateable; null while a successful operational round awaits fidelity rating or outside comparative randomized rounds |
| initial_correct_retained | C derived boolean, nullable | For first score 2, equals second_full_operational after resolution; null for initially incorrect or nonrandomized rounds |

Recognition coders get only independently shuffled opaque response IDs, frozen rubric, and one answer. Artifact-fidelity reviewers get independent opaque artifact IDs, the frozen meaning contract, and one playable clip/hash; no condition, guesses, provider, paired act, or outcome. Never reuse opaque IDs across coder rounds/roles. Keep linkage keys restricted and prevent joins by sorted order, filename, or metadata. Do not expose `condition` to coders while rating. Preserve independent scores even after disagreement resolution. Store the adjudicator and rubric-change history in restricted audit records rather than adding identifying columns.

For a resolved, retained, comparative randomized round:

- `primary_eligible = first_score_adjudicated in {0,1}`.
- `second_full_operational = true` only if `second_generation_status = ready`, `second_render_status = rendered`, `fallback_used = false`, `client_wait_timed_out = false`, `client_timing_uncertain = false`, and `second_score_adjudicated = 2`. It is false for a completed but less-correct answer, a postrandomization skip, timeout, unrecovered invalid output, unreconstructable client timing, abandonment, or no second answer at session close. The semantic rating itself remains null when no answer exists.
- Once `client_wait_timed_out` or `client_timing_uncertain` is true, preserve it permanently for that round. Write the pending non-sensitive timing envelope before dispatch; reload must preserve the original client deadline. Unreliable elapsed-time reconstruction produces uncertainty, never a new budget. An explicit read-back may recover a valid server result later, but must not autoplay it or convert the primary outcome to success. Any resulting comprehension score is exploratory. The server's 15-second acceptance-clock deadline does not extend the client's 15-second submission-clock deadline.
- A successful validation retry within the two-call/deadline budget can still yield true. A fallback scene is not a successful experimental generation even if a later guess happens to match.
- Primary arm rate = true second-full outcomes divided by all retained, resolved, primary-eligible rounds in that arm. Report numerator and denominator. Primary repair difference = informed rate minus blind-retry rate, multiplied by 100 for percentage points.
- Overall randomized comparison uses all retained randomized rounds, with the same operational outcome definition. Report consent-related deleted/missing records and sensitivity bounds; do not claim complete intention-to-treat coverage when withdrawal makes it impossible.
- A live pending round is neither success nor failure. Resolve it from a recorded terminal session state; do not fill a pending value with zero merely to make a chart complete.

## Timing and resource diagnostics

| Field | Tier and type | Meaning and nullability |
| --- | --- | --- |
| initiated_at_utc | C timestamp | Round initiation; required |
| first_guess_submitted_at_utc | C timestamp, nullable | First accepted submission; null for early skip/failure |
| second_ready_at_utc | C timestamp, nullable | Client-observed validated-ready event; null without one. An explicit late read-back can populate it, but never clears client_wait_timed_out |
| second_guess_submitted_at_utc | C timestamp, nullable | Second accepted submission; null without it |
| round_ended_at_utc | C timestamp, nullable | Terminal round event; null only while genuinely pending |
| second_ready_latency_ms | C integer, nullable | Monotonic client elapsed time from first submit to second ready; null without readiness or when reliable reconstruction is impossible, never encode timeout as a successful 15,000 ms response. Late explicit recovery is labelled exploratory and excluded from normal readiness summaries |
| first_response_latency_ms | O integer, nullable | From first-clip playback end to first submission; null if start marker absent |
| second_response_latency_ms | O integer, nullable | From second-clip playback end to second submission; null if start marker absent |
| provider_calls | C integer | Actual act-two calls; 0 before a call, at most 2 per round under protocol. Count every noncomparative phase’s usage and cost even though those rounds are excluded from repair analysis |
| validation_retries | C integer | Calls triggered by failed validation; 0 or 1; included in provider_calls |
| input_tokens | O integer, nullable | Sum of provider-reported input tokens over all calls, not only successful calls |
| output_tokens | O integer, nullable | Sum of reported output tokens over all calls; null when provider data is unavailable |
| estimated_cost | O decimal, nullable | Estimated actual round generation charge, using recorded provider usage/pricing; not the spending cap |
| currency | O string, nullable | ISO 4217 currency when estimated_cost is present; required with that value |
| cache_hit | C boolean | Whether an idempotent same-session result was reused; cross-user generated-score cache is outside this pilot |

Use the same clock origin for duration measurements. If only server timestamps exist, label them in a revised schema rather than pretending they measure client waiting. Timed-out or errored calls still count toward provider_calls and cost when the provider charges them. Latency summaries describe successful readiness plus a separately reported timeout/failure count; failures must not disappear from the report.

## Completion, failure, and participant experience

| Field | Tier and type | Meaning and nullability |
| --- | --- | --- |
| first_render_status | C enum | `not_started`, `rendered`, `failed`, or `cancelled`; rendered means clip completed without an unrecovered playback error |
| second_generation_status | C enum | `not_requested`, `pending`, `ready`, `invalid_output`, `provider_error`, `timeout`, or `cancelled`; ready means a score passed validation within budget |
| second_render_status | C enum | `not_started`, `rendered`, `failed`, or `cancelled` |
| client_wait_timed_out | C boolean | Whether 15 seconds elapsed from client submission without ready delivery; initially false, permanently true after timeout, even if explicit read-back later recovers a valid act |
| client_timing_uncertain | C boolean | Sticky flag when the original pending wait cannot be reliably reconstructed after reload/clock discontinuity. True prevents primary operational success even if a later explicit read-back is valid; it is not a confirmed provider timeout |
| timeout_stage | C enum, nullable | `queue`, `provider`, `validation`, `client_wait`, or `unknown`; null if no timeout; do not guess a finer cause |
| failure_category | C enum, nullable | `first_render`, `provider`, `validation`, `second_render`, `timeout`, `timing_uncertain`, `client`, `stage_leak`, `privacy`, or `other`; primary terminal failure, otherwise null |
| fallback_used | C boolean | Whether a fallback replaced the experimental second performance |
| skip_stage | C enum, nullable | `before_first_guess`, `waiting_second`, `before_second_guess`, or `after_second_playback`; null if no explicit skip |
| withdrawn | C boolean | Stop/withdrawal flag while retention remains permitted; deletion requests remove records rather than justify keeping a flag indefinitely |
| missingness_reason | C enum, nullable | `not_applicable`, `participant_skipped`, `technical_failure`, `no_response`, `not_collected`, `pending`, `withdrawal`, or `other`; applies to the principal missing outcome; precise event reasons remain in restricted records |
| replay_count_first | O integer, nullable | Additional first-clip plays beyond initial playback |
| replay_count_second | O integer, nullable | Additional second-clip plays beyond initial playback |
| reduced_motion | C boolean | Whether the reduced-motion setting was active; document any change within a round as a protocol deviation |
| viewport_width_px | O integer, nullable | Rendered browser viewport width, collected only for display diagnostics |
| viewport_height_px | O integer, nullable | Viewport height under the same rule; no device fingerprint |
| delight_1_to_5 | C integer, nullable | Round enjoyment rating, 1 not at all through 5 very enjoyable; voluntary nonresponse remains null |
| perceived_helpfulness_1_to_5 | O integer, nullable | Participant's perceived usefulness of retry, 1 not at all through 5 very helpful; not semantic accuracy |
| would_play_again | C boolean, nullable | Declared willingness, asked at the end and attached only to the final scheduled/formative main round. It is not observed continuation; voluntary nonresponse is null |
| optional_extra_offered | O boolean, nullable | Whether a genuine optional extra round was made available at session end under the approved protocol; only on the final main row. Null if not collected; false if explicitly not offered |
| optional_extra_accepted | O boolean, nullable | Choice of Play at that offer; false only when a genuine offer was declined. Null without an offer/recorded choice |
| optional_extra_started | O boolean, nullable | Derived from first playback start in the linked optional round, not from acceptance or round creation. False when an offered/accepted round never starts by session close; null when unobserved/not applicable |
| optional_extra_completed | O boolean, nullable | Derived when the linked extra round reaches normal post-second-guess reveal after both clips and guesses. Explicit early reveal, exit, or failure is false at session close; an active extra round remains null |
| optional_extra_round_id | O string, nullable | Restricted opaque link to the optional_extra row; required once a linked extra round is created. Extra rows have condition=null, randomized=false, and never enter repair denominators |
| protocol_deviation_id | C string, nullable | Reference to documented deviation when one occurred, otherwise null |
| sanitization_event | C boolean | Whether an actual input-withholding/redaction event occurred through approved handling or an optional obvious-identifier check; no content in this column. False does not certify the absence of private data |
| stage_leak_detected | C boolean | Whether forbidden stage content or target leakage was observed; an investigation flag, not evidence all false rows were exhaustively audited |
| notes_record_id | O string, nullable | Restricted qualitative or technical note reference; no free-text notes in CSV |

The overlapping skip labels should be resolved by the implementation's event state: use `waiting_second` during generation, `before_second_guess` before/during second playback, and `after_second_playback` once playback finished. A technical failure followed by skip still retains its failure_category. Do not erase the failure because a participant exited gracefully.

## Grouping, quality checks, and retention

Group the primary comparison by condition within comparative phase, then show physical/social category and scene-level results. Participant and scene are crossed clustering units; repeated rounds are not independent participants. `first_variant_id` becomes an additional nested artifact factor only in later variant studies. Use `round_index` for carryover diagnostics, not a post hoc exclusion of inconvenient late rounds. Exclude formative, bank_calibration, optional_extra, and the 48 planned practice rounds from measured repair denominators, but include all phases in cost accounting. Do not pool protocol/model revisions or different generation policies without a declared analysis change.

Before reporting, reconcile initiated → first submitted → randomized → valid second generated → second rendered → second answered. Check unique keys, category/condition balance, expected 24 encounters per measured scene if all finish, and 12 per arm. Enforce the 6–10-second clip contract and 1–240-codepoint submitted-guess contract. Verify first-clip hashes and provenance match across arms, all eight measured hashes have pre-freeze bank calibration, every practice profile is practice_blind_v1 with no provider guess, provider calls never exceed two for an interactive round, and every derived value has its required inputs. Flag violations instead of silently dropping rows.

Proposed retention, subject to approval and verified provider compatibility:

- Active product-round state expires after 30 minutes; that is distinct from explicitly consented study storage.
- Ordinary operational logs expire within 24 hours and contain no raw guesses or exact prompts. Optional diagnostics should be aggregated or deleted on this schedule unless specifically covered by study consent.
- Raw study guesses, exact prompts, linked response records, and identifying administration are access-controlled. The proposed raw research window is at most seven days. Handle administration under its separately approved needs rather than copying it into this schema.
- Without the separate research-retention opt-in, delete participant-level study records no later than seven days after collection, completing approved coding/analysis within that window. Analysis delay does not move the deadline. With opt-in, retain only the pseudonymous nonraw score/result bundle for at most 30 days after collection. Raw guesses and exact prompts still expire within seven days.
- No retention window overrides an applicable withdrawal/deletion request. Keep only consent-permitted aggregate summaries after the row-level retention window. Aggregation is not an automatic guarantee of anonymity, especially for small groups or quoted examples.
- Accepted informed-arm guesses are sent to the actual named provider disclosed before consent. Practice and withheld-arm inputs contain no submitted guess. Explain this before collection and offer skip. Reminders and optional obvious-identifier checks do not guarantee detection of accidental private content. If discovered, stop affected processing, restrict access, and follow verified deletion/reporting controls; do not claim already transmitted text can be unsent or purged from provider systems beyond verified capabilities.
- Assign an owner to verify deletion across source records, exports, coder copies, and provider systems where applicable. An unverified provider-retention mismatch blocks collection; it cannot be solved by wording the consent more confidently.

- Research participation and 30-day nonraw retention never authorize publication. Public screenshots, quotes, linked clip/answer sequences, or recordings require distinct specific permission and an approved retention plan. Creator-only capture uses creator-owned text by default. Do not export raw study text into general assistant memory.

## Collection ownership and software acceptance

The technical chapter owns the closed same-origin event and feedback endpoint schemas. Client events report playback, replay, ready observation, visibility/mode changes, timeout and uncertainty. Server records supply authoritative round/scene/condition/version/profile, accepted submissions, generation/validation/resource outcomes, and terminal mutations. Consent enrollment supplies participant and consent linkage; clients cannot set those fields through generic events. Human operator tools supply masked ratings only. Analysts compute derived outcomes after locking source records. No raw guesses, exact prompts, targets, free-form notes, participant identity, or human scores belong in ordinary analytics payloads.

Round feedback accepts bounded numeric ratings and optional willingness/offer choice through its typed endpoint. Actual optional-extra started/completed values derive from linked round events. Idempotent duplicate events must not double-count plays, rounds, offers, feedback, or cost. Reconcile initiated → first-submitted → randomized → generated → rendered → answered, with failure and abandonment branches. Do not treat a client claim that a response was submitted as server acceptance.

Planned acceptance cases (software fixtures only until real evidence exists):

1. A fixture comparison schedule balances 24 people × eight scenes with four trials per arm per person and 12 per arm per scene; 48 practice records are excluded, with all usage retained.
2. Each of eight comparison hashes must have a bank-calibration approval in real collection mode; synthetic test mode bypass is visibly marked and cannot export as human data.
3. Recognition exports contain exactly opaque row ID, rubric, and one guess; first adjudication is locked before independently shuffled second release. Fidelity exports have separate IDs, one clip, and meaning only. No condition leakage in filenames or metadata.
4. A timeout, pending reload with uncertain clock, invalid output, early postrandomization exit, and missing answer each fail the resolved operational outcome while absent semantic scores remain null. Pending outcomes remain null until terminal resolution.
5. An initially correct first answer still receives the second act, remains outside primary_eligible, and contributes to retention/regression reporting. A changed-story clip with answer score2 remains visible as drift and fails the secondary fidelity outcome.
6. An offered extra round declined differs from no offer; acceptance without playback differs from a started round; early reveal differs from normal completed extra round.
7. Raw collection is refused before consent; withdrawal and expiry remove source, export, coder, and linkage copies. Seven-day raw expiry applies even with 30-day opt-in. Publication export rejects research consent alone.
8. Pending creation read-back retrieves the existing owner-bound active round with zero act-one provider calls. Repeated read/replay/event submission cannot trigger generation or extend retention.

These are proposed definitions and controls, not a claim that collection, validation, or deletion has been implemented or tested.
