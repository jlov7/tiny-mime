# Tiny Mime Product and Design Specification

## 1.1 Decision and delivery scope

Tiny Mime is a small silent theatre. Two or three geometric actors perform a situation; the player describes what they see; a second performance attempts to clarify the same event; the intended meaning appears after the second guess or an earlier reveal. The desired moment is specific: “It changed the bit I misunderstood.” A more attractive animation alone does not establish that outcome.

This v0.2 chapter makes implementation decisions for the complete local, private first version. It replaces the v0.1 blanket “proposed” status. It is a build specification, not evidence that an application, successful model repair, human calibration or user study already exists. Preparing these documents authorizes no software execution, paid model calls, participant recruitment or publication. When the complete handoff is given to Codex for implementation, the builder proceeds through its internal gates without asking the owner to approve each engineering phase. Unrun human evidence remains explicitly unrun; it must not be invented to unblock implementation.

The finished local application contains four surfaces:

1. **Rehearsal:** creator-only scene inspection, exact-size playback, frame stepping, timeline scrubbing, track inspection and validation diagnostics. Ship three carefully authored first performances before expanding infrastructure.
2. **Private play:** a complete two-take round with a frozen, preauthored first act and a provider-generated second act when an approved provider is configured. The no-provider installation remains useful through rehearsal and clearly labeled test fixtures. It does not pretend that a live second act occurred.
3. **Study:** consent, practice, frozen assignment, comparison rounds, feedback, restricted records and blinded exports. Synthetic end-to-end testing is included. Running a human study and claiming its results are separate matters.
4. **Creator capture:** local export of permitted completed rounds, including the actual guess, exact scores, source labels, real waiting, replays and reveal. Capture creates no public post, account or gallery.

Build in that order: excellent authored motion; bounded offline director quality probe if configured and funded; one complete playable round; study and capture. Software gates require test evidence. Human-comprehension gates qualify content and claims, rather than manufacturing a reason to stop implementing unrelated software. Provider credentials, spending, recruitment, deployment, new permissions and publication still require their specific authority.

The selected direction is bounded AI direction. The runtime director returns numeric choreography, not executable code or autonomous agents. There are no persistent characters who remember, feel or develop relationships with the player. Authored charades remains a truthful usable outcome if generated repair proves weak. Do not silently switch the product to open-ended storytelling during a frozen comparison.

## 1.2 Audience and claim boundaries

Design first for an adult using a private local experiment. A curious player should understand participation immediately. An observant player should be able to see how the second act relates to the first interpretation. A creator needs repeatable performances and honest provenance. A researcher needs independent assessment, neutral feedback, complete denominators and a reproducible comparison.

Enjoyment, first-act recognizability, guess-specific improvement, target fidelity, latency and technical safety are different outcomes. None substitutes for another. Geometric storytelling is not itself a novelty claim: the earlier pack cites fog and Toyteller as related work. This specification claims neither “first of its kind” nor general nonverbal understanding. A selected demonstration may illustrate one permitted round; it cannot establish typical model performance.

## 1.3 Product requirements

Requirements are normative for this version. “Must” is a build obligation; an empirical threshold is an acceptance question, not an assertion that it has passed.

- **P01 Two submitted guesses.** At most two accepted guesses per round. A valid first guess always triggers the configured second-act policy, including an apparently correct guess, “I don't know,” or an unusual interpretation. No live correctness judgment is shown. Guess two or voluntary reveal ends the round.
- **P02 Frozen meaning and cast.** Bind each round to one immutable `sceneMeaningV1` record, first-score hash, role roster, geometry version and contact policy. Both acts retain those identities. Keep event roles as well as shapes and colors stable; an actor cannot silently change from follower to leader merely because the score remains numerically valid.
- **P03 Silent stage.** Render only two or three actors on the fixed neutral background. No text, symbols, faces, eyes, props, trails, newly spawned objects, camera movement, speech, music, answer-shaped formations or semantic UI overlays. Labels and diagnostics belong outside the stage and are absent during scored viewing.
- **P04 Bounded score.** Every played score uses MotionScoreV1, the 1000 by 700 stage, 6–10 seconds, renderer-owned geometry and palette, and the independent validators. Do not add semantic commands or a richer animation language without a versioned redesign justified by observed limits.
- **P05 Human language.** NFC-normalize, then trim and accept 1–240 Unicode code points under the technical input rules. Preserve the normalized wording. Do not require keywords, grammar or a particular language; preserve valid emoji and combining sequences. Never silently truncate.
- **P06 Genuine runtime second act.** In private play, the configured director receives the invariant meaning, frozen first score and actual first guess as untrusted data. In the study, the frozen condition controls whether that guess is present. The director receives no target-specific authored repair script, lookup table, study answers or connected personal data. Only validated outputs play.
- **P07 Independent interpretation and fidelity.** Use no runtime model verdict of “correct” or “incorrect.” Later human scoring assesses the player's interpretation and the second act's fidelity separately. Schema validation does not prove either meaning or repair success.
- **P08 Replay and exit.** Pause, resume, replay, reveal and exit are always clearly available in applicable states. A replay never consumes a guess, changes the current answer slot or creates a provider request. Retain separate act/replay provenance.
- **P09 Honest failure.** A refusal, invalid score, exhausted budget, timeout or abandoned generation does not become successful repair. No silent cached substitute, handcrafted rescue or replay of act one may be labeled runtime-generated act two. Follow the technical recovery contract; no fresh wait or call budget after reload.
- **P10 Local private scope.** No accounts, public gallery, public deployment, purchases, multiplayer, 3D, leaderboard, streaks, user-uploaded scenes, social integration or automatic posting. The creator/operator gate is local and separate from the participant session; knowing a route is not authorization.
- **P11 Complete rehearsal.** Provide all controls and evidence views in section 1.7, including actual phone-scale checks and paired motion references. Rehearsal is inspection, not a general timeline editor.
- **P12 Complete study software.** Implement the protocol, records and exports specified by the evaluation and technical chapters. Distinguish implemented, synthetically tested, content-calibrated and human-study-run statuses. Block real comparison activation if its manifest, approval, calibration or budget is incomplete; still allow clearly synthetic verification.
- **P13 Consent and minimization.** Before any live guess transmission, disclose the configured provider and purpose. Before research recording, obtain the specified study consent. Research retention never grants publication permission. No participant's raw text enters general analytics or ongoing assistant memory.
- **P14 Useful creator capture.** Export permitted rounds locally with exact first act, submitted first guess, actual resulting second act when available, reveal and provenance. Require creator-owned text or a separate permission record covering publication use. Never synthesize a supposedly real guess to match a chosen second act.
- **P15 Noncontact first version.** Adopt `noncontact-v1`: every actor remains within the continuously certified conservative disk-clearance policy. There is no physical pushing, touching, occlusion or collision response in the initial library. This is a new creative restriction in v0.2, not a claim that the earlier numeric schema was broken.
- **P16 Fixed first-act provenance.** First acts make no runtime provider call. Distinguish genuinely human-authored choreography, agent-assisted/spec-transcribed authored fixtures and mock test fixtures in the manifest and UI. Human review alone does not turn agent-authored work into human authorship. “Calibrated” is shown only after the recorded calibration occurred.
- **P17 No answer leakage.** Keep hidden target, semantic scene ID, meaning contract, rubric and condition off participant responses, HTML, bundles, source maps, telemetry and accessible labels until allowed reveal. Operator-only tools may retrieve them through their own gated API.
- **P18 Frozen study presentation.** Study participants see one frozen geometry/layout variant and the same nonrevealing source-label policy in both arms. No automatic phone zoom, color substitution, cast resizing or experimental visual variation during a scored round.
- **P19 Honest responsiveness.** Display real generation progress states without fake thinking narration. A completed score waits for explicit playback. Report observed waiting, failure and resource use; never claim the illustrative deadlines or budgets were achieved without measurements.
- **P20 Complete handoff.** Codex must deliver runnable software, installation/run instructions, automated tests, named evidence files and a concise remaining-limitations report for the complete defined scope. Missing empirical evidence may remain pending with a clear activation lock. Missing required code cannot be relabeled a future phase.

## 1.4 Interaction requirements

- **UX01 One focal activity.** The stage is the largest visual element and each state has one primary action. Do not introduce chat bubbles, assistant avatars or an analytics dashboard in play.
- **UX02 Neutral acknowledgement.** After an accepted first guess, use exactly “Thanks. Here’s another take.” Do not use “Nearly,” “Wrong,” “They understood you,” or a celebratory cue. Waiting text appears separately beneath it.
- **UX03 Deliberate motion.** No autoplay on arrival, after generation, after returning to the tab, or after reconnect. Starting either act requires a labeled action.
- **UX04 Controls have words.** Keep visible text labels for playback, reveal and exit. Icons may supplement words but cannot replace them. All controls work by keyboard and touch without dragging or hover.
- **UX05 Stable layout.** Reserve the stage aspect ratio, controls area and response-panel height. Status, counter and error text appear in reserved space. Never move the input out from under the pointer when a response arrives.
- **UX06 Gentle reveal.** Show “The scene was meant to show…” and the target, then both submitted guesses exactly as accepted. No cross, score, confetti, comparative intelligence language or forced claim that the intended reading is the only imaginable story.
- **UX07 Access is explicit.** Honor reduced motion; retain visible focus and accessible errors; distinguish actors by silhouette as well as color; disclose the visual-task limitation before play.
- **UX08 Submission is deliberate.** A labeled button submits; Enter inserts no new line in the single-line guess field and submits only when composition has ended, input is valid and the current slot is enabled. Do not bind Space or global character shortcuts while typing.
- **UX09 No coercive continuation.** “Finish” is as easy to find as another round. No score, loss message, streak or guilt-based invitation. A study's optional extra round remains genuinely optional and is recorded separately from stated interest.
- **UX10 Recover without fiction.** Draft text survives recoverable UI/network errors in memory. Refresh recovery uses the technical allowlist, not persistent raw drafts. Never automatically transmit a draft on reconnect.
- **UX11 Provenance near playback.** Outside the stage, show “Authored first take,” “Generated second take,” “Test fixture,” or the accurate specialized label. Study labels must not disclose informed versus blind condition. Failed generation has no invented act-two badge.
- **UX12 Access settings are not experiments.** Reduced-motion preference and browser zoom remain available; their use is recorded without silently changing scene content. Experimental cast-size variants are rehearsal-only until an entire version is revalidated and frozen.
- **UX13 Honest timing copy.** Use “Preparing the next performance…” initially, “Still preparing…” at the technical slow threshold, then the defined terminal recovery state. Do not show unmeasured percentages or estimated seconds remaining.
- **UX14 Safe transitions.** Changing route during playback pauses it. A later callback cannot take over a newer round. Exit abandons the active round; a user-requested reveal remains available through normal revision-race recovery.
- **UX15 Target-safe accessibility.** Accessible names identify shapes, controls and timing without describing the unrevealed relationship. No hidden target in alt text or screen-reader-only copy.
- **UX16 No forced orientation.** Support portrait phone use, 200% text zoom and ordinary document scrolling. Do not crop the stage or require fullscreen.

## 1.5 Screen and state specification

The public routes are `/`, `/play` and `/study`. Creator routes `/rehearsal` and `/creator/capture` and their target-bearing APIs require the technical chapter's local operator capability. `/operator-unlock` exposes no targets and does not constitute an account system. “Enter participant mode” revokes operator privileges before that browser is used by a participant. Use a separate creator browser profile for capture. Route shells alone contain no hidden catalogue data.

“Take” is the player-facing word; “act” is the data/API word. Ready, playing and paused states are local presentation substates of the server state. Exact labels below take precedence over older storyboard annotations.

### Welcome

Heading: “A tiny silent scene.” Body: “Watch two takes and tell us what you think is happening.” Supporting line: “You can replay, reveal or stop at any time.” Primary action: “Start a round.” Secondary links: “How it works” and “Accessibility.” An operator-only navigation area links rehearsal, study setup and capture; it does not appear for participants.

Before live play, show the configured provider disclosure: “Your guess is sent to [provider display name] to prepare the second take. Please don’t include personal information.” The name must come from approved configuration, never an invented placeholder in production. Show “Rounds expire after 30 minutes without starting a round or sending an accepted round action.” The technical chapter owns the exact expiry clock; playback and polling do not extend it.

Study uses its own consent and neutral condition disclosure before practice. Do not tell study participants that every second take uses their submitted guess.

### SetupNeeded

If provider configuration, spending authority or availability is missing, disable “Start a round” and show “Live second takes aren’t configured on this installation.” For the creator, the primary action is “Open rehearsal,” with secondary actions “Try a fixture round” and “View setup requirements.” For a participant, show “Ask the facilitator to set up this session” and “Back.” Do not replace the provider with authored repairs in the normal play path. Synthetic round fixtures are available only through a conspicuously labeled creator/test path. Such a round uses `executionMode=fixture`, displays “Fixture round · no live generation” throughout, and labels its second act “Test fixture.” It exercises the complete state flow without claiming an AI response. It is excluded from real research and runtime-quality results. Live rounds use `executionMode=live`.

### Ready1 and Playing1

Ready1 heading: “Take 1 of 2.” Text: “Watch a short scene, then describe it.” Show a static opening frame and “Play scene.” Below it are “Reveal now” and “Exit round.” Playback completion enters Guess1. During motion the primary control is “Pause”; pausing changes it to “Resume.” The response field is inactive and cannot accept a premature answer. A persistent text label reads “Authored first take” or the more specific truthful provenance label.

Paused1 retains the exact frame, time and controls. Returning from a hidden tab or interrupted playback enters Paused1. Never restart automatically. “Replay take 1” starts at time zero only on request.

### Guess1

Heading and field label: “What’s happening?” Placeholder: “Describe the action or relationship…” Primary action: “Send guess.” Secondary playback action: “Watch take 1 again.” Preserve the current draft while replaying; completion returns to Guess1, never a new attempt.

The field is a single-line text input with at least 48 CSS-pixel height; long valid text scrolls within it and the complete accepted guess wraps in the read-only submitted display. Show a live “n / 240” code-point counter. Empty/whitespace error: “Add a few words about what you saw.” Over-limit error: “Keep your guess to 240 characters or fewer.” Invalid-control/line-break error: “Use one line of text without control characters.” Input errors consume no attempt or call and remain associated with the field.

### Directing

Replace the editable field with the exact accepted first guess in a read-only region labeled “Your first guess.” Announce “Thanks. Here’s another take.” Beneath it show “Preparing the next performance…” Keep the stage still. The button that accepted submission remains a stable focusable control labeled “Guess sent” with `aria-disabled=true`; do not remove it while it has focus. Do not invite double submission.

At the technical slow threshold change the status to “Still preparing…” without a spinner that suggests an actor is thinking. “Reveal now” and “Exit round” remain available. Replaying take one is allowed with its distinct label and does not hide the waiting status. If take two becomes ready during that replay, let the replay continue on its own clock and announce readiness; never start take two automatically. A valid on-time score enters Ready2 with a polite announcement: “The next take is ready.” Do not steal focus.

### Ready2, Playing2 and Guess2

Ready2 heading: “Take 2 of 2.” Text: “Watch the next take.” Primary action: “Play next take.” Persistent source label: “Generated second take” only for actual validated runtime generation. The first guess remains secondary, outside the stage. Playing2 and Paused2 mirror first-act controls.

After completion, Guess2 asks “What do you think now?” Primary action: “Send final guess.” Secondary actions: “Watch take 2 again” and “Watch take 1 again.” Whichever act is replayed, the current input remains guess two. Guess one cannot be edited or resubmitted. Valid guess two immediately requests reveal under the round protocol. On uncertain acknowledgement, reconcile the existing operation; do not create a third guess.

### Reveal

Heading: “The scene was meant to show…” followed by the immutable target. List “Your first guess” and “Your second guess” only when submitted. If skipped, state “You revealed before sending another guess.” Show source labels and “Play both takes” when both acts exist; otherwise “Play take 1.” Sequential comparison has a labeled inter-act pause and still requires deliberate playback. A recovered or failed round keeps its qualifier visible.

Primary action: “Another scene.” Secondary action: “Finish.” Study substitutes its frozen next-round/feedback navigation; no player-selected target or experimental condition is exposed. Written post-reveal explanation may use the approved meaning contract, clearly as intended meaning; do not invent a explanation of the runtime model's private reasoning.

### Recovery

General heading: “The next take couldn’t be prepared.” Primary action: “Reveal the scene.” Secondary action: “New round.” Under a client timeout, add “Waiting ended before the next take arrived.” When allowed by the technical contract, offer “Check for a completed take.” A later on-time server completion retrieved explicitly is labeled “Recovered after timeout,” remains exploratory, and never overwrites the recorded operational timeout. A server-expired generation cannot be recovered as a success.

For lost connectivity, add “You appear to be offline. Your next action will wait for a connection.” Locally cached acts remain playable. Reveal needs the server; disable its actual submission while offline and explain that fact instead of guessing the target. Do not silently retry provider calls, silently submit queued guesses or refresh the time budget.

### Expired and Finished

Expired heading: “This round expired.” Body: “Start a new scene when you’re ready.” Primary: “New scene.” Disable guess/reveal mutations; preserve a visible unsent draft until the player exits that view, with “Unsent draft” clearly labeled. Cached acts may still be replayed. Never silently recreate a research round.

Warn once when the server-derived expiry is within two minutes: “This round will expire soon.” Do not show a stressful ticking timer. Finished says “Thanks for playing.” In private play it offers “Back to start.” Study offers only the protocol's feedback, withdrawal information and genuinely optional extra round. A missing provider is never presented as the player's failure.

## 1.6 Selected visual and responsive system

Use a quiet tabletop theatre in a single editorial column. The chosen tokens are implementation inputs, not proof of contrast compliance:

| Token | Selected value |
|---|---|
| Page | `#F6F2E9` |
| Stage | `#F7F3EA` |
| Primary text | `#242622` |
| Secondary text | `#555A53` |
| Primary action | `#2B675A`, white label; verify contrast |
| Focus | `#242622`, 3 px solid outline, 3 px offset |
| Error text | `#922D24`, with a text explanation |
| Actor fills | Violet `#7357FF`, amber `#B56A00`, teal `#007F83` |
| Typography | `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` |
| Type scale | 16 px body, 14 px secondary minimum, 24 px section heading, 32 px title; line height 1.45 |
| Space | 4, 8, 12, 16, 24, 32, 48 px |
| Controls | Minimum 44 by 44 px hit target; primary button 48 px high; radius 8 px |
| Stage framing | No texture, internal border, shadow, vignette or decorative scenery |

At viewport widths of 768 CSS pixels and above, center a column with maximum width 920 px and 24 px side padding. The stage width is the lesser of available column width and 820 px. On narrower screens, use 16 px side margins, stage width `100%` and the unchanged 10:7 aspect ratio. Do not cap the stage by viewport height if that would make the actors tiny; allow scrolling. At 390 px viewport width the 358 px stage gives an approximately 28.6 px baseline circle diameter and 22.9 px square side. Those are calculated sizes, not a conclusion about usability.

Keep title/settings above the stage; playback controls immediately below; status and provenance next; response panel below that; reveal/exit last. The stage, controls and response panel reserve their dimensions across states. Desktop controls use a horizontal row with an 8 px gap. Mobile controls wrap into full-label rows; submit spans the panel width. On-screen keyboard scrolling must keep input and submit reachable without altering stage coordinates or obscuring controls. At 200% text zoom, every label wraps or reflows; nothing essential is clipped or horizontally trapped.

Actors use the technical shape vocabulary and no strokes. Color conveys identity only, never virtue, correctness or a study arm. Keep the chosen roster stable inside a round. Different pre-frozen scene variants may rotate role/silhouette assignments so that a triangle does not always represent an antagonist. No random reassignment during a study.

Phone-size legibility is a rehearsal question. Compare canonical geometry with clearly labeled experimental uniform-scale variants there, never as ad hoc CSS transforms in play. A candidate that changes dimensions must receive its own geometry identity, recomputed containment and clearance checks, regenerated first scores, documentation and validation evidence. The shipped baseline remains `svg-shapes-v1` until a complete alternative is selected and frozen. Do not solve legibility by selectively enlarging the “important” actor.

## 1.7 Rehearsal and motion references

Rehearsal is creator-only and cannot share a participant's active round. Its header permanently says “Rehearsal · authored and test material.” The selected scene title, meaning, role bindings, first-score source and calibration status appear outside the stage. There is no provider call on arrival, scene selection, scrubbing or replay.

Required controls: scene selector; “Play,” “Pause,” “Reset”; elapsed time in milliseconds; a keyboard-operable scrub slider; “Previous keyframe” and “Next keyframe”; speed choices 0.5× and 1× labeled as rehearsal playback; “Show tracks”; “Show validator details”; and “View target.” Default overlays are off. Tracks, centers, clearance disks and numeric transforms are outside the player experience and never baked into a scored act. Both comparison panes sample the same canonical clock; sequential comparison is the default at phone width. Scrubbing remains a deterministic call to the pure sampler.

Provide viewport presets “Desktop 820 px,” “Phone 358 px” and “Narrow phone 288 px.” Display the actual CSS stage width. A preset is a bounded preview, not evidence of physical-device testing. Acceptance also requires real browser/device or emulator evidence at the named sizes, with exact viewport, browser and date recorded. If real hardware was unavailable, state that rather than call an emulator a phone test.

The motion reference suite contains matched, labeled inspection examples made with MotionScoreV1:

- Simultaneous versus 1,000 ms-delayed local motion with otherwise identical paths.
- Approach toward another actor versus early interception of its route, with clear cause-before-response timing and clearance.
- Opening an entry gap versus closing it before arrival, using the same cast and starting positions.
- A held pause after a blocked attempt versus uniformly slowing every segment.
- A smoothstep multi-key path that intentionally stops at each key versus aligned equal-velocity linear keys that continue without a velocity jump.

These are author-training and regression assets. They are not director tools or a guess-to-repair lookup. The runtime must be unable to import the reference library or the three-scene guide into its generation context. Reference scripts and numerical assertions are specified in `supplements/three-scene-directing-guide.md`; the builder must render and inspect them. Diagrams and stills are insufficient proof of motion quality.

## 1.8 Motion and meaning contracts

Write the relationship before the choreography. `supplements/scene-meaning-contracts.json` is the canonical semantic content bank. A record freezes target, event assertions, actor/role bindings, allowed elaborations, explicit contradictions, interpretation rubric and separate fidelity-assessment instructions. The technical chapter defines validation, hashing and the exact director projection. Meaning revisions use a new immutable identity; do not mutate a frozen record in place or quietly rewrite the target after observing guesses.

The director may clarify timing, route separation, spatial staging and causal order within allowed elaboration. It may not change the event, add an invisible prop, swap event roles, turn copying into pursuit, make one deliberate blocker out of two mutually adjusting passers, or turn opening a gap into exclusion. A new endpoint is permitted only if its record explicitly allows it. A textually unchanged target is not proof that this contract was respected.

Assessment instructions are immutable content; actual reviewer judgments are separate records keyed to meaning ID, act hash, reviewer and rubric version. Use the canonical labels `target_preserved`, `unclear`, `changed_story`, and `unrateable`. `target_preserved` requires observable support for the core event and no observed contradiction. `unclear` applies when a complete viewable act is semantically ambiguous. `changed_story` requires an identified incompatible event or role relation. `unrateable` applies to missing, incomplete, corrupted or inaccessible material, with a recorded reason. These are distinct human outcomes, not interchangeable failure codes. Do not label unrecognizable but otherwise inconclusive motion “semantically guaranteed.” Offline reviewers remain decisive; automated checks only validate structure and movement policy.

Each scene needs setup, meaningful change and consequence. Stillness is an action: establish intention; pause when movement is blocked; let the reaction visibly follow the cause; hold the consequence long enough to perceive it. Avoid continuous bouncing, rote beats and indiscriminate squash. A circle's rotation cannot convey an essential cue. Essential information must survive without perceiving a tiny tilt on a phone.

Smoothstep intentionally reaches zero velocity at both ends of each segment. Put keys there when a stop is desired. For uninterrupted travel, use aligned linear segments with matching velocity, or a single longer segment; a linear join is not automatically jerky if vectors and rates match. A rapid direction change may itself communicate indecision, but must be authored and inspected rather than accidentally introduced by dense keys. All transform channels share interpolation timing in V1; do not imply separately eased channels exist.

`noncontact-v1` uses a fixed 62.5-unit conservative disk for every actor and requires center distance strictly above 129 units with the technical numeric margin across the full continuous score. This deliberately rules out some close square/triangle passages that exact outlines could allow. All initial scripted scenes keep at least 150 units of center separation by construction sketch, but the future generated numeric scores must still pass the full independent certifier. Do not call a storyboard, endpoint check or 60 fps frame sample proof of continuous nonintersection. There is no invisible wall, collision response or automatic trajectory correction.

## 1.9 Initial content bank

The bank contains twelve candidate records, not twelve measured successes. Three have full beat guides and are enabled first. The complete build also authors first-score drafts for all eight comparison candidates from the concrete briefs in the directing guide, for eleven playable noncontact drafts in total. Those eight receive the same technical/visual checks before activation. They are not left as content TODOs; research eligibility still requires real calibration. Every first-score manifest starts `humanCalibration: not_run` until there is real supporting evidence. The evaluation chapter owns comparison eligibility and the frozen bank.

| ID | Scene and core event | Main confusion to inspect | Initial status |
|---|---|---|---|
| TM01 | Awkward passing: opposite travelers repeatedly choose the same passing side and obstruct each other's progress | Dance; one intentional blocker | Development; fully beat-scripted |
| TM09 | Delayed copying: one stationary-zone actor repeats another's distinct local movements after a visible lag | Simultaneous dance; pursuit | Development; fully beat-scripted |
| TM04 | Making room: a pair opens a gap so an approaching third actor joins between them | Exclusion; moving away from a threat | Development; fully beat-scripted |
| TM02 | Tagging along: a follower retraces the leader's route at a comfortable delay | Chase | Comparison candidate |
| TM03 | Trying to catch up: a trailing actor closes a travel gap and rejoins the actor ahead | Pursuit or escape | Comparison candidate |
| TM05 | Keeping someone out: a pair closes the opening approached by a third | Making room; accidental obstruction | Comparison candidate |
| TM06 | Taking turns leading: a leader yields its position and then follows the other along the shared route | Overtaking in a race | Comparison candidate |
| TM08 | Getting in the way: one actor repeatedly moves ahead to obstruct the other's intended route | Following; accidental collision | Comparison candidate |
| TM10 | Waiting for the other: a lead actor pauses until a slower companion catches up, then resumes | Indecision; race | Comparison candidate |
| TM11 | Startled retreat: an abrupt approach causes one retreat, then both settle when the approach stops | Continuing chase | Comparison candidate |
| TM12 | Failed coordination: two movers wait and slow until a lagging third can move with them | Synchronized dance | Comparison candidate |
| TM07 | Helping a stuck mover: assistance originally depended on physical nudging | Pushing away or bullying | Deferred contact candidate; cannot activate under noncontact-v1 |

Do not quietly rewrite TM07 as a no-contact story under the same meaning ID. A future noncontact assistance scene would be a distinct target and rubric. No physical/social quota is required merely to fill categories. Use a coherent physical-coordination comparison and narrow claims if that is what the bank supports.

The three full guides contain first-act staging and contrasting repair directions for human author judgment. Those directions are illustrative development references, not hand-selected second clips and not runtime prompt examples. A good first act must stand on its own; do not deliberately make it random or confusing to manufacture an impressive recovery.

## 1.10 Accessibility and participation limits

Implement the surrounding application with semantic HTML and a clear heading hierarchy. Tab order follows the visual order. Every button has a name and state; the input has a persistent visible label; field errors use `aria-describedby`; submission errors use an appropriately brief alert; preparation and readiness use a polite status region. No per-frame announcements. A visible focus outline persists on all keyboard-operable controls. Do not move focus automatically at readiness; move focus to a newly navigated page heading or reveal heading only after the user's corresponding action.

Honor `prefers-reduced-motion` before initial rendering. Default to static frame mode with “View scene,” “Previous frame,” and “Next frame,” stepping through the sorted union of keyframe times including zero and the endpoint. The user can explicitly choose “Play animation.” On preference change while playing, pause and show the current static frame. Preserve exact score content and record presentation mode. A union-of-keys view may not communicate temporal lag equivalently; acknowledge and measure that limitation rather than claim parity.

The stage accessible name is: “Silent geometric animation. This guessing activity requires viewing motion. You can skip to the written reveal.” Do not list actor role names, target labels or choreography interpretation before reveal. A written description of intended meaning may appear afterward. This does not make the unsolved game nonvisually equivalent.

No flashing, camera shake, zoom or automatic loops. Stop scheduling motion when the page is hidden. Controls and error text meet implementation-tested contrast and target-size requirements; record audit results. Check keyboard-only use, screen-reader navigation of surrounding UI, reduced motion, mobile touch, 200% text zoom, landscape/portrait and high-contrast settings. These checks support the stated implementation, not a blanket accessibility or cross-cultural effectiveness claim.

## 1.11 Creator capture and permitted examples

Capture is an operator-only local workflow entered from a revealed round or an authorized imported record. First show the exact text and both source kinds, score hashes, meaning version, generation outcome, actual wait duration and any timeout/recovery. Reject expired/unavailable data rather than reconstructing a missing act from a similar scene. No background capture, microphone, camera, screen recording of unrelated tabs or third-party upload is required.

The creator chooses a permitted source: “My own demonstration text” or “Separately authorized participant example.” Study consent alone never enables the latter. Store the publication-permission reference separately from the short research-retention record; do not duplicate identifying permission documents into an ordinary capture manifest. Lack of publication permission still permits research-internal restricted analysis under the protocol, not a publishable text-containing export. Before publishing later, the owner must review the artifact and give the relevant authority; a local export does not post it.

Guess inclusion is off by default; enable it only for creator-owned text or a verified separate publication permission. The complete publishable-example story order is fixed: labeled first performance; exact accepted first guess; actual waiting; labeled second performance; intended-scene reveal. A permitted export without guess text must state “Guess omitted”; it cannot be presented as a complete example of guess-specific repair. A second guess, if present, follows its actual occurrence before reveal. Preserve a truthful canonical replay and an event/timing manifest even when producing an edited presentation. The creator may create an explicitly labeled edited copy with waiting shortened; never silently replace real waiting with instantaneous readiness. Add “Waiting shortened from X to Y seconds” and record both durations, edit ranges, replay counts and playback speeds. Replayed acts say “Replay.” Fixture acts say “Fixture.” An excerpt says “Selected example.” No generated output may be hand-edited while retaining “unedited runtime-generated” provenance.

The required output is a self-contained local HTML/SVG replay, capture-manifest.json and canonical score JSON. The replay has no external assets or requests. The technical chapter specifies the exact package contract and capability-tested optional WebM encoding. Export must succeed in its guaranteed format even if optional browser video encoding is unavailable. Show the format honestly; an HTML replay is not an MP4. Show “Export ready” only after file creation succeeds, with the local artifact name and format. A failure offers “Try export again” without rerunning generation. No sharing access changes or automatic uploads occur.

## 1.12 Acceptance and remaining evidence

A complete software delivery must demonstrate every state with deterministic fixtures, all four surfaces, private participant/operator separation, no-provider behavior, target-safe payloads, replay semantics, expiry/recovery, consent gates and valid local exports. These are implementation acceptance checks.

The first creative gate inspects the three authored scenes at normal speed on a desktop and phone-sized stage, plus the matched motion references. Record timestamps where cause, reaction, pause and consequence are perceptible; record failure rather than marking all scenes “excellent” by declaration. At least one uninformed human viewing session is needed to support a comprehension claim. If no such session was authorized or available, deliver the implemented scenes with `humanCalibration: not_run`; do not invent observations and do not stop unrelated software work.

The next quality probe holds meaning and first score fixed, supplies two materially different plausible misunderstandings and a competent blind-retry comparator, and retains all attempts. Different paths alone are insufficient. Inspect whether the changed relationship addresses the specific misunderstanding while preserving the event. Probe configuration and budgets differ from interactive qualification only where explicitly recorded; neither is assumed feasible in advance.

The complete round gate checks real waiting, no hidden substitutions, neutral initially-correct behavior, safe failures and voluntary continuation. Study activation requires the separately calibrated frozen bank and the evaluation chapter's readiness checklist. Capture activation requires the exact permitted content and provenance. None of these gates licenses unsupported product claims or silently expands public exposure.

The included v0.2 storyboard and operator-layout diagrams are static design references. Their explanatory labels are document annotations, never gameplay graphics. They are not screenshots of a running application or motion-quality results. The state, geometry, source and contact contracts above govern implementation; a static illustration cannot establish their runtime behavior.
