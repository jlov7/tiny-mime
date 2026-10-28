# 03. Tiny Mime evaluation and evidence

## Decision this evaluation should support

Tiny Mime deserves a bounded experiment if abstract motion is enjoyable and intelligible enough to support a guessing game. Its distinctive hypothesis is narrower: **a second performance informed by the viewer’s actual first guess improves semantic understanding more than an equally resourced retry that never sees that guess.** A nicer second animation alone does not establish this. Describe responsive choreography without implying that the actors feel, understand a person as a companion, or form an enduring relationship.

This chapter defines the evidence work and future study tools in the complete first-version handoff. It contains no collected observations, recruited participants, model benchmarks, or validated product results. Codex should complete the authorized software build and its fixture-based checks without repeated permission for ordinary engineering phases. Human viewing, live-model spending, research collection, and publication remain distinct evidence or authorization boundaries. A software-complete build may honestly report those qualifications as NOT RUN; it must not invent them or stop at a paper review instead of building.

**E01 — Evidence sequence.** Make three authored scenes and the smallest safe rehearsal stage first; diagnose director response to contrasting guesses next; make one complete playable round before implementing full comparative-study operations. Build the later safeguards and operator tools within the same handoff. When human or paid work is unavailable, preserve its pending status and continue independent authorized engineering. Do not treat a missing human review as automatic authorization to recruit, nor as a reason to abandon software work that can proceed safely.

Keep five questions separate:

- **Delight:** Did people enjoy watching and interpreting the shapes?
- **Recognizability:** Did their descriptions capture the intended physical event or social relationship?
- **Fidelity:** Does the new performance still depict the frozen event and roles, or has the story changed?
- **Repair:** Did access to the first guess improve the next interpretation relative to blind retry?
- **Stability:** Did the experience reliably render, recover, and finish within its operating limits?

Delight and repair can succeed independently; effective repair can still make a tedious game.

## What existing evidence does and does not establish

The original pack and supplied independent review record source checks on **8 October 2026**. This revision preserves those attributed findings; it does not claim a new independent audit of the linked sites. “Fact” describes what a source reports, not an independent replication. “Interpretation” identifies the relevance to Tiny Mime. “Unknown” is a question this project must answer.

| Source and exact URL | Verified fact | Interpretation and unknown |
| --- | --- | --- |
| fog paper, version 1: https://arxiv.org/html/2607.07952v1 | Reports 452 animations across its evaluations. Recognition uses four-alternative forced choice. Table 2 reports 67.8% across 1,256 judgments on 260 stimuli; the paper separately evaluates refined compositions. | Supports investigating expressive abstract motion. It does not establish Tiny Mime’s open-ended guessing accuracy, user-specific repair effect, or generalization to its stricter stage rules. |
| fog paper, sections 4.1.11 and 5.2.1: https://arxiv.org/html/2607.07952v1 | Automatic self-refinement did not significantly improve overall accuracy. A ten-person editing study reports 0.36 versus 1.75 minutes between new animations. | Refinement must be tested. The timing is an interaction feedback-cycle measure, not measured generation latency for this product. |
| fog project: https://fog-motion-emotion.vercel.app/ and linked repository: https://github.com/hellovivian/fog-motion-emotion/tree/main | The v0.1 source check records a 404 at the linked repository; a subsequent source-review project-page fetch did not return usable content. | Public reusable code and its license were not verified. Do not assume availability or reuse permission. Propose an independent implementation. |
| Toyteller project: https://mj-storytelling.github.io/project/toyteller | Describes two-character symbol-motion interaction, motion-steered text generation, and text-steered motion generation. Its findings describe complementary strengths of motion and language. | Clear prior art for AI-supported symbolic storytelling. Tiny Mime’s possible contribution is the controlled guess-informed repair loop; no novelty or superiority claim is established. |

The paper’s license is not a software license. Recheck availability and permission if reuse becomes an implementation decision.

## Freeze the experimental contract

Use an adult-only, private pilot. Each round has two performances and at most two free-text guesses. The stage is 1000 × 700 logical units, containing two or three fixed abstract characters. Each clip lasts 6–10 seconds. Do not add stage text, icons, faces, or audio. Text is allowed in the surrounding interface. Preserve character identity across attempts.

Accept 1–240 Unicode codepoints for a submitted guess. Provide a separate skip action rather than treating blank text as an answer. After any submitted first guess, use the same neutral acknowledgement and offer the second performance, whether that guess is correct, partly correct, or wrong. Reveal the target only after the second guess or an explicit skip. An early skip ends that round. Do not show a live model-generated correctness verdict, and do not condition retry availability on a judge’s decision.

**E02 — Frozen meaning.** Freeze each target’s intended meaning, acceptable paraphrases, important roles, distinguishing cues, and scoring rubric before collecting comparison data. The v0.1 already required this semantic freeze. Strengthen its execution with the server-only, versioned SceneMeaning contract: minimum event, role bindings, compatible elaborations, and explicit contradictions. Supply invariant meaning to the director in both arms; do not supply target-specific authored repair instructions or the complete research pack. Stable target wording alone is not proof of fidelity. The target describes an event or relationship, not a password that the participant must type. Use ordinary vocabulary and avoid private experiences, stereotypes, diagnostic interpretations, or knowledge of particular films and personalities.

## Early creative evidence before study operations

**E03 — Three-scene theatre.** Start with TM01 Awkward passing, TM09 Delayed copying, and TM04 Making room. Their meaning identifiers are TM01.meaning.1, TM09.meaning.1, and TM04.meaning.1. Inspect the real clips at desktop and phone scale; a storyboard or schema-valid specimen does not establish legibility. Capture unlabeled interpretations before showing the target. Use the builder rehearsal view to compare synchronous/delayed motion, approach/interception, yield/block, and meaning-changing pauses. Retain unsuccessful versions and the reason for a revision. An author may judge motion quality, but must not fabricate participant responses.

The first small human scope is **4–6 adults**, after approved recruitment, disclosure, and data handling. It checks legibility, instructions, controls, and pacing on the three development scenes. Once the round exists, inspect real waiting, replay, reveal, and whether two guesses feel worthwhile. These formative observations do not estimate an adaptive-repair effect. Keep the first record small: consented pseudonym, clip/version, display mode, natural interpretation, optional enjoyment, and observed failure. The 96-column analyst export is produced later from application events, configuration, and human coding; it is never a 96-field facilitator questionnaire. When no human sessions are authorized, deliver runnable scripts and a NOT RUN evidence entry instead. A demonstrated unreadable scene must be revised or honestly disabled before it is represented as ready.

**E04 — Bounded offline director diagnostic.** Before spending, freeze an explicit batch plan: provider/model and endpoint, price basis/currency, maximum requests and tokens, absolute spend cap, longer offline call deadline, sampling configuration, and stop conditions. Zero paid calls is the default without approval. This quality probe is separate from interactive qualification: do not reject a model's expressive capacity solely because it cannot fit the proposed seven-second interactive call limit. Conversely, an offline success does not prove acceptable live waiting.

For each selected target and immutable first score, use two materially different, plausible misunderstandings, alongside a competent guess-withheld retry. TM01 provides a useful pair: “They are dancing” and “One is deliberately blocking the other.” Each informed input should clarify a different diagnostic relation while preserving opposite travel and mutual accidental obstruction. The blind prompt receives the same meaning, first score, cast, motion vocabulary, and resource budget; it is allowed to find equally good improvements.

Use creator-authored diagnostic guesses initially. If real participant text is used later, the approved provider transfer and retention must cover it. Preserve every exact input/output, refusal, invalid result, validation retry, timestamp, token count, known charge, and intervention within the applicable retention policy. Keep a frozen request manifest and attempt index; never regenerate until a charming example appears, hand-edit a result and call it model-only, or hide failed attempts. Rate validity, target fidelity, and cue-specific change separately. Different paths alone do not demonstrate semantic targeting.

Matched input versus blind retry is the baseline diagnostic. A later matched-versus-mismatched-guess diagnostic may use plausible misunderstandings of the same scene, but must have an explicit analysis plan. It is not automatically a third arm of the 24-person comparison. No target-specific runtime lookup from guess phrases to authored repairs is permitted.

## Bank calibration and comparative pilot

**E05 — Separate people, separate freezes.** The twelve candidate records divide into three development scenes (TM01, TM04, TM09), eight comparison candidates (TM02, TM03, TM05, TM06, TM08, TM10, TM11, TM12), and one deferred contact-dependent scene (TM07). Author the three development scenes first; the complete software build also includes the other eight noncontact first clips, each honestly marked uncalibrated until human calibration occurs. TM07 stays disabled. Candidate or implemented status is not evidence of calibration or recognizability. This removes the artificial four-development quota while preserving the twelve-record catalogue.

Before a comparison, author and calibrate **all eight measured first clips** with a separate adult bank-calibration cohort who will not join the comparison. The operator must freeze that cohort's scope and consent before collection; its size is not silently included in either the initial 4–6 testers or the 24 comparison participants. Record per clip: score hash, meaning/rubric/renderer/contact-policy versions, calibration cohort reference, first-guess distribution, important confusions, revisions, decision, and date. A final changed hash requires its own calibration status. “Held out” means held out from comparative-answer-driven tuning, not never viewed by any human.

Revise and classify candidates before freeze. The planned comparison seeks four physical and four social targets: physical scores observable action; social requires an intention or relationship inference. Existing candidates overlap. Do not manufacture category labels to satisfy a quota. If a coherent four/four bank cannot be established, freeze a revised narrower protocol and balanced schedule before comparison recruitment, and narrow claims. Do not remove difficult scenes or rename conditions after observing comparative results.

**E06 — Comparison allocation.** Proposed sample: **24 new adults × eight measured rounds = 192 planned measured encounters**, plus **two practice rounds each = 48 planned practice records**. Those totals assume all finish; they are planning arithmetic, not collected data or a power calculation. Randomly assign people to concealed, counterbalanced schedules: each sees every measured target once, four informed and four blind retries. With the planned four/four category bank, each condition includes two physical and two social targets per person. Each measured scene should receive 24 encounters, 12 per arm. Check scene, order, early/late, and condition-sequence balance, and report attrition. Never repeat a target through a disguised paraphrase.

Use identical immutable **preauthored first clips** across arms. Runtime AI generates only act two. Preserve the canonical animation score, renderer version, hash, and authorship metadata. source=authored_fixture is distinct from authoringMethod (spec_transcribed, agent_assisted, or human_authored) and humanReview (not_run or reviewed). Codex-authored choreography is agent_assisted; a later human review does not change who authored it. “Animation score” is motion data, not a correctness rating. The deterministic renderer has no random seed. Assign condition only after the first valid, nonblank guess is accepted; no semantic judge enters randomization. Both arms receive the same server-only meaning contract, target, first score, cast, and fact that a first guess occurred. The informed arm receives that actual guess; blind retry receives an explicit content-withheld marker, never “the guess was wrong.”

**E07 — Explicit practice policy.** Use TM01 and TM09 as the two practice scenes. In study data, practice has condition=null and randomized=false. Its separately recorded generation_profile is practice_blind_v1: the provider receives the content-withheld profile for every practice second act. The practice guess is recorded only under approved study consent and is not included in provider input. Explain that some second acts use a guess and some do not. Practice is excluded from repair denominators; every call and cost still counts. A fixture-only rehearsal is labeled mock_fixture and is not an authorized live-model comparison run.

**E08 — Interactive parity and timing.** Freeze model/version, prompt family, output-token ceiling, renderer, contact policy, validator, motion vocabulary, sampling settings, and deadlines before the comparison. The proposed interactive contract is at most two provider calls per round, including at most one validation retry, a seven-second maximum per call constrained by remaining time, and a 15-second absolute server deadline. Client waiting separately ends 15 seconds from submission. Both arms use identical limits. Actual use and charges may differ under equal caps.

Persist non-sensitive pending client timing metadata before dispatch and preserve the original waiting budget across reload. If reliable elapsed time cannot be reconstructed, keep client_timing_uncertain=true; never grant a fresh budget or count that round as operational success. Timeout and uncertainty are sticky for analysis. Late explicit read-back may expose a valid result for exploratory viewing only, with no autoplay. Uncertain creation must reconcile to the owner-bound active round without stranding it or creating another active round; creation itself makes zero provider calls. Technical implementation and event contracts are authoritative in chapter 02.

Use identical transition copy and loading affordances without revealing assignment. Repair quality may allow participants to infer an arm; acknowledge imperfect masking. The control receives a genuine opportunity to improve. Do not share generated scores across people or tune prompts during the frozen comparison.

### Carryover and implementation controls

Reveals teach the game’s visual vocabulary. Counterbalancing mitigates that carryover but cannot eliminate it. Record round position and analyze early versus late rounds descriptively. Limit facilitator commentary to the script. Collect explanations after the guess is locked; think-aloud during scored viewing can alter the task.

Deterministic first clips make the comparison cleaner but narrow inference to those clips. Record display size, reduced-motion choice, replay count, and technical interruptions without collecting unnecessary device identifiers. Preserve the first score hash across arms. Initially allow only same-session idempotent result reuse, not cross-user generated-score caching. Mark every cache hit. A cached blind retry and a newly generated informed retry would confound waiting time and stochastic variation.

## Semantic scoring and blinding

**E09 — Independent recognition coding.**

Two human coders independently score every submitted guess. Give each an independently shuffled export containing only the target rubric, one guess, and an opaque row ID. The combined CSV is analyst-only; keep its linkage key restricted. Hide condition, prompts, performances, timing, and other guesses. Lock first-guess adjudication before releasing second-guess exports.

Use a three-level rubric:

| Score | Meaning | Example for “one character reluctantly follows another” |
| --- | --- | --- |
| 0 | No relevant event, incompatible event, or essential roles reversed | “They are fighting”; “the leader is being chased away” |
| 1 | Relevant action or relationship, but a required distinction is missing or contradicted | “One follows the other”; “they happily go together” |
| 2 | Core event, relevant role direction, and distinguishing meaning are present | “It keeps hesitating but goes after the other one”; “the smaller one trails behind unwillingly” |

For “one character protects another from a third,” “gets between the small one and its pursuer” can score 2 without “protect”; “one follows another” scores 1; “they all attack each other” scores 0. Names or colors need not match if roles are clear. Contradictory accounts do not earn 2 merely by including target words. Judge meaning, not keyword overlap or eloquence.

Train coders on separate practice answers. Preserve independent ratings, disagreement type, and final resolution. Resolve disagreements against the written rubric; if unresolved, a third blinded adjudicator decides. Report exact agreement, the 0/1/2 disagreement matrix, and weighted agreement with its limitations. Do not silently rewrite acceptance criteria after viewing condition results. If a rubric defect requires revision, version it and rescore all affected answers while masked; document the change as a deviation.

The full 24-person comparison can produce up to 384 submitted measured guesses and 768 independent recognition ratings with two coders, before adjudication and practice/training. Two ratings for each of 192 second clips add up to 384 artifact-fidelity ratings. This is workload arithmetic, not collected evidence. Confirm a feasible coding/deletion schedule before collection; shortage of coders does not extend seven-day raw retention.

### Semantic fidelity is a separate review

**E10 — Do not confuse recognition with preserved meaning.** A numeric validator cannot guarantee that a story remains the same. Two independent fidelity reviewers see the frozen meaning contract and one playable clip under an opaque artifact ID. Hide condition, provider, guess text, paired act, and outcome. Use independent opaque IDs and a separate linkage file from the recognition-coding export. Reviewers may need motion controls, but do not receive a model explanation as ground truth.

Classify each second act as target_preserved (minimum event and roles hold), unclear (insufficient evidence to tell whether the event holds), changed_story (a contradiction or materially different event), or unrateable (missing/corrupt/unviewable artifact). Preserve independent labels, masked adjudication, a bounded reason code, and artifact hash. Recognition coders continue to see only a target rubric and one guess. A guess that matches the target does not prove that the generated clip communicated that target.

Report fidelity by arm and scene. Distinguish “still unclear” from “changed the story” in failure diagnosis. Keep the original primary recognition estimand below; also report the preregistered secondary fidelity_preserving_repair, requiring both operational full recognition and adjudicated target_preserved. Do not silently reclassify the primary outcome after inspecting clips. A selected changed-story example cannot be presented as faithful repair even when its participant answer scores 2.

## Outcomes and analysis

**Primary repair outcome:** among randomized rounds with an adjudicated first score of 0 or 1, compare the proportion reaching score 2 on the second guess between informed and blind retry. Report the absolute percentage-point difference, arm denominators, scene/category breakdowns, and uncertainty. This is a predeclared incorrect-first stratum whose membership is determined using pretreatment evidence. It is not a post hoc subset of rounds the system called failures.

Also report an intention-to-treat comparison across **all randomized rounds**, including initially correct answers. Within that population, report score-2 retention for initially correct guesses and regressions from 2 to 0/1. Secondary outcomes are change in ordinal score, first-guess recognizability, time to second guess, skips, and replay use. Keep exploratory analyses visibly separate from the primary outcome.

Analyze retained randomized rounds in their assigned arm. Timeout, invalid output, abandonment, or missing second guess fails the primary operational outcome; do not invent a semantic score of 0. Client waiting expires 15 seconds after submission, separately from the server acceptance clock. Preserve that timeout flag, and any unreconstructable client-timing uncertainty, even if explicit read-back later recovers a valid act: no autoplay, exploratory comprehension only, primary outcome still zero. Completed-response analysis is secondary. Report prerandomization failures/skips. Withdrawal/deletion overrides retention for intention-to-treat; report permitted aggregate counts, missingness, and sensitivity bounds.

**E11 — Delight and observed continuation.** For delight, ask after each round, “How enjoyable was this round?” on an anchored five-point scale from “not at all” to “very enjoyable.” Ask whether they would voluntarily play another round at the end; retain this as declared interest. Separately, in an approved formative session, offer one optional extra development round with equally prominent Finish and Play controls, no compensation difference, facilitator persuasion, or penalty. Record offered, accepted, actually started, and completed separately. A yes-click is not an observed played round. The extra round belongs to optional_extra, remains outside comparison denominators, and has its own provenance and costs. An unavailable opportunity is null/not offered, not refusal. Report declared interest and observed continuation with their separate denominators. Record perceived helpfulness separately; it is not semantic repair. For stability, report initiated rounds, both clips delivered, validator rejections, bounded retries, timeouts, rendering failures, and fallback use. Show median, p90/p95 where informative, and the complete timeout count for submission-to-ready latency. Completed-only latency excludes failures and must be labelled as such.

Report participant- and scene-level distributions, not 192 supposedly independent observations. The small pilot primarily supports descriptive estimates and error diagnosis. If confidence intervals are shown, predeclare a method accounting for crossed participant and scene dependence and flag instability with few clusters; ordinary binomial intervals over all rounds overstate precision. Do not claim statistical significance, universal understanding, or a validated effect from directional pilot differences.

## Proposed decision gates

These are **product-owner proposals**, not literature-derived standards or observed outcomes. Approve them before running the pilot and interpret them together with uncertainty and qualitative evidence.

| Dimension | Directional signal to investigate further | Consequence if absent |
| --- | --- | --- |
| Stability | At least 90% of initiated rounds complete both performances without unrecovered technical failure; zero stage-content or private-data leaks | Fix engineering and rerun affected checks before judging efficacy |
| Waiting | Second-act ready p95 at most 10 seconds, with five seconds the desirable target; 15-second terminal timeout works | Reduce scope or improve serving; no claim that latency targets were met |
| Recognizability | At least 60% fully correct second guesses in the informed arm, with category results visible | Revise target bank and motion vocabulary; inspect whether social scenes collapse |
| Delight | Median enjoyment at least 4/5, without repeated reports of fatigue, discomfort, or confusing instructions | Rework pacing and interaction before adding features |
| Repair | At least a 10-percentage-point informed advantage in the primary stratum, without obvious category-specific harm | Positive signal warrants confirmation; small or negative signal warrants diagnosis, not an adaptive-repair claim |

With fewer than 40 eligible incorrect-first rounds overall, label the repair signal insufficient even if the point estimate looks large. This is a practical interpretability floor, not a power calculation. Meeting every threshold authorizes consideration of a larger study, not a public efficacy claim or automatic launch. A strong nonadaptive experience can justify a simpler product direction.

## Later confirmatory study and useful baselines

Freeze the product version, targets, primary estimand, exclusions, scoring, missing-data treatment, analysis, and stopping rule before recruitment. Use new participants and a larger, separately curated scene bank. A planning envelope of 80–160 adults across 24–32 targets is reasonable for budgeting; determine the actual sample with simulation using plausible effect sizes, baseline recognition, eligible-stratum frequency, and participant/scene correlation. Do not claim this range provides adequate power without that work.

Use multiple authored first-performance variants per target, balanced across conditions, while keeping each participant’s target exposure unique. Estimate the condition effect with a prespecified crossed-effects model and report marginal absolute differences with intervals respecting participant and scene clustering. Predeclare convergence and sparse-stratum handling. A multiway cluster bootstrap can support sensitivity analysis with enough clusters. Test one primary hypothesis; label secondary work exploratory or address multiplicity. Do not stop when a favorable difference appears. Runtime-generated first acts require a separate gate and evaluation; build-time agent-assisted authorship of frozen fixtures remains explicitly labeled in the baseline.

Retain blind retry as the core causal baseline. In a separate study, add an exact first-clip replay to estimate gains from a second look; a manually authored second animation to benchmark a human-designed alternative; and a fixed, no-AI scene library to test whether generation improves the product at all. Match clip length and interaction opportunity. Separate production effort, serving cost, and recognition outcomes. A manual condition is not a free computational baseline, and forcing all four conditions into the small pilot would dilute the main question.

If the repair effect survives, investigate held-out targets, multilingual paraphrases, accessible motion alternatives, and longer collaborative scenes in separate stages. Camera interpretation, voice input, child audiences, social sharing, and arbitrary user-generated targets are outside this pilot and require new design and safety decisions.

## Consent and data handling proposal

**E12 — Consent, retention, and publication are distinct.**

Use a plain-language script before participation:

The following draft template names the selected provider, OpenAI. Before use, add the real operator/contact, protocol-specific recording details, verified provider-policy links and retention terms. Missing or incompatible data-handling terms block collection. A later provider change requires a matching disclosure and protocol revision.

“You’ll watch silent shape animations and describe what is happening. Some second animations use your first answer and some don’t. We’re studying the animations, not testing you. You can skip, stop, or ask us to delete your records using your study code. Please don’t include names, contact details, health information, or other private information. No camera or microphone is used. We record guesses, ratings, and timings under a random study ID. When your round uses your answer, we send that answer to OpenAI to make another animation. In the practice and withheld-answer rounds, your answer is not sent in the generation request. Raw guesses and exact prompts are deleted within seven days. Keeping pseudonymous scores and timings for up to 30 days is optional and requires a separate choice. Do you want to take part?”

Before use, identify the real operator/contact and withdrawal route, confirm that the deployed adapter uses the disclosed provider OpenAI, and verify provider-side retention/deletion compatibility. Users may skip rather than submit. Resolve deletion-policy mismatches before collection. Input reminders or obvious-identifier checks cannot guarantee detection of private information. If discovered, stop affected processing, restrict access, and follow verified deletion controls; do not promise to unsend data. Keep compensation separate, score within seven days, and verify deletion. Explain withdrawal limits for already unlinked aggregates; never promise anonymization.

Study participation and the separate 30-day pseudonymous-result opt-in grant no publication permission. Creator capture defaults to creator-owned demonstration text. Any identifiable or pseudonymous participant quote, screenshot, animation sequence linked to an answer, or recording intended for public display requires distinct, specific publication permission covering the chosen material, audience, and purpose. Do not keep raw text beyond seven days merely because someone opted into nonraw retention. A proposed publication package needs its own authorized storage/retention scope before any export; no permission is implied by this plan.

No camera, microphone, screen recording, or external messaging is part of the default pilot. If recording becomes necessary, it requires separate disclosure/consent before collection. Do not send raw participant answers to a general assistant's persistent memory; provide only consent-permitted aggregates or independently authorized creator examples.

## Risk register and claims ledger

| Risk | Evidence to inspect | Mitigation and decision |
| --- | --- | --- |
| Target leaks through UI, stage, or metadata | Stage audit and participant-visible requests | Hide target before reveal; stop affected runs |
| Adapting to words rather than meaning | Synonyms, role reversals, contradictory exact matches | Human semantic rubric; later paraphrase stress test |
| Guess-conditioned overfitting | Gains limited to familiar phrases or a few scenes | Held-out targets and first-performance variants |
| Carryover and demand effects | Round-order trends and condition guesses | Counterbalance; neutral script; disclose residual uncertainty |
| Judge leakage or flexible scoring | Rating access logs and rubric versions | Lock first ratings before second material; preserve disagreements |
| Silent failure filtering | Initiated/randomized/completed reconciliation | Intention-to-treat reporting and explicit failure categories |
| Motion discomfort or exclusion | Skips, reduced-motion use, participant comments | Pause/skip controls; characterize access limits without medical claims |
| Privacy or generation drift | Sanitization events and artifact/model hashes | Minimal inputs, short retention, version freeze, bounded validation |

The claims ledger starts without product results. Prior evidence supports investigating abstract motion. Tiny Mime’s enjoyment, open-ended recognition, adaptive repair, speed, stability, and generalization remain unverified. Each claim needs its corresponding outcome and a stated population/version. “First of its kind” is unsupported given known prior art.

## Results template contract

The accompanying CSV is header-only and defined by supplements/pilot-data-dictionary.md: **one future row per initiated participant–scene round, no fabricated observations**. Randomized fields remain empty when a round ends earlier. IDs are pseudonymous; hashes identify immutable artifacts. `first_score_*` and `second_score_*` are human semantic ratings, distinct from `first_animation_hash`. Preserve the two independent ratings and adjudication. `primary_eligible` is set only after blinded first-score adjudication; `second_full_operational` includes postrandomization failures as false, with timeout and uncertain client timing preserved. Semantic-fidelity labels remain separate. Only optional-extra start/completion events establish actual continuation. Missing values stay empty and receive an explicit missingness reason.

Keep raw guesses in access-controlled records referenced by `response_record_id`, not the summary CSV. Record UTC timestamps, milliseconds, token counts, actual cost/currency when available, and retention choice. Reconcile initiated, randomized, rendered, answered, and withdrawn counts where consent permits. Report those denominators, deviations, rubric versions, all failures, consented deidentified examples, and conclusions proportional to the evidence.


## Evidence execution and completion labels

Maintain an evidence manifest keyed to commit, test ID, artifact hash, provider/profile, and actual run date. Use PASS, FAIL, NOT RUN, BLOCKED, and NOT APPLICABLE precisely. Unit fixtures may test calculation and export behavior; synthetic fixture rows must never be merged into the human-study results template or labeled participant observations.

A complete first software version includes the playable toy, three development scenes plus eight separately labeled uncalibrated comparison first clips, development/benchmark harness, recovery and safety controls, optional study mode, event/feedback ingestion, masked export tools, deletion routines, and creator-only capture path specified by the implementation plan. It may be software-complete while phone-human legibility, paid-model quality/latency, eight-bank calibration, comparison findings, and publication permission remain pending. Report the exact limitation; do not claim 100% optimization, tested fun, model capability, or scientific validation. Internal engineering checks should lead to fixes and reruns in the same build, with escalation only for a genuine blocker or an action outside authority.
