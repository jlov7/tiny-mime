# Tiny Mime Scene Authoring and Motion Reference Guide

## Purpose and execution boundary

This is the builder's choreography specification for the first three development scenes and the remaining eight noncontact first-act drafts. It also defines a small matched motion-reference suite. Transcribe and refine this content during an authorized build, validate it, inspect real playback, and keep the resulting evidence. No scene in this document is an observed runtime success or a human-calibrated clip.

The initial development set is TM01 Awkward passing, TM09 Delayed copying and TM04 Making room. Author and inspect these before expanding to the eight comparison candidates. The finished software includes eleven noncontact first-score drafts; only real calibration can qualify them for a human comparison. TM07 remains disabled because its meaning depends on contact. Do not fill the twelve-scene selector with a misleading fake TM07 clip.

Every first clip has `source: authored_fixture`, a truthful `authoringMethod`, `humanReview: not_run` initially, and `humanCalibration: not_run` initially. A literal transcription may use `spec_transcribed`; creative changes by the coding agent use `agent_assisted`; use `human_authored` only when the choreography's documented origin actually supports it. Review and calibration are different events; neither rewrites origin. A frozen first act makes zero runtime provider calls.

This guide is author/reviewer material, not runtime director input. The director receives only the approved invariant projection from `scene-meaning-contracts.json`, its frozen first score, the actual guess or withheld condition, and the global numeric/motion contract. Never provide the authored second-act suggestions, likely-confusion list, matched examples, target rubric or the full handoff as runtime few-shot instructions. Do not implement a hidden `guess -> repairClip` lookup. Test this separation with import boundaries and exact serialized context snapshots.

## Shared notation and hard constraints

Stage coordinates are 1000 by 700, positive x right and positive y down. Actors have baseline scale 1, rotation 0 and the shape/color assignments stated per scene. Circle radius is 40; square side is 64; the triangle uses the canonical renderer-owned vertices. Actors have no stroke, face, outline, trail, shadow, sound or props. There is no camera or interaction physics.

Every table below describes full-transform keys. Unless a row explicitly says otherwise, use `rotationDeg=0`, `scaleX=1`, `scaleY=1`, and `easing="easeInOut"` on that row's outgoing segment. The last row always uses `easing="linear"`. A repeated position is a deliberate hold. All listed times are integer milliseconds, include zero and duration, respect the 250 ms minimum spacing, and fit the 24-key cap. The transcribed JSON is still subject to every independent validator; these prose tables are not a validation certificate.

An outgoing easeInOut segment is smoothstep and comes to rest at its next key. These scripts deliberately use discrete attempts, reactions and holds. For any genuinely uninterrupted travel introduced during revision, use one segment or aligned equal-velocity linear segments. Do not scatter smoothstep keys across a route while claiming continuous speed. Rotation and scale use the same interpolation factor as position in V1.

All scores use `geometryVersion="svg-shapes-v1"` and `contactPolicy="noncontact-v1"`. The policy treats each actor as a fixed radius-62.5 disk and certifies center separation strictly above 129 stage units, with the technical 1e-6 margin, over continuous time. This is intentionally more conservative than visible shape outlines. No sampled-frame check replaces the certifier. An uncertain interval fails closed. Initial coordinate sketches keep a visible separation margin but must be tested after any edit, including easing or timing changes.

Do not show the target to an uninformed viewer before collecting their natural description. Do not use the phrase “Did you see them trying to pass?” as a legibility question. Ask “What do you think happened?” and record the answer only under the approved data-handling process. If no human session is authorized, record a builder-only inspection and leave human calibration unrun.

## Scene one Awkward passing

### Meaning and staging

ID `TM01`; immutable meaning `TM01.meaning.1`. Actor a is a violet circle traveling left to right. Actor b is an amber square traveling right to left. The event is mutual same-side route adjustment while trying to pass, not dance, pursuit or one persistent blocker. Role bindings remain constant in act two.

Duration: 8,000 ms. Start with two well-separated travelers on the same horizontal centerline. Their large initial approach establishes opposing travel. Hold at the encounter, shift both to the same upper lane, make another blocked forward attempt, shift both to the lower lane, and finally reattempt the original lane. End with an unresolved, readable encounter. The first act should look like a coherent event even before any repair is considered.

### Exact initial key plan

| tMs | Actor a x | Actor a y | Actor b x | Actor b y | Beat |
|---:|---:|---:|---:|---:|---|
| 0 | 250 | 350 | 750 | 350 | Opening frame |
| 900 | 250 | 350 | 750 | 350 | Establish separation |
| 2400 | 415 | 350 | 585 | 350 | Opposite travel reaches encounter |
| 2800 | 415 | 350 | 585 | 350 | Both hesitate |
| 3550 | 415 | 275 | 585 | 275 | Both choose upper lane |
| 4050 | 425 | 275 | 575 | 275 | Small renewed forward attempt, then stop |
| 4850 | 425 | 440 | 575 | 440 | Both choose lower lane |
| 5450 | 425 | 440 | 575 | 440 | Blocked pause |
| 6250 | 415 | 350 | 585 | 350 | Modest recoil and reset to center lane |
| 6950 | 425 | 350 | 575 | 350 | Another opposing advance |
| 8000 | 425 | 350 | 575 | 350 | Hold the unresolved encounter |

All coordinates describe choreography, not an invisible wall. Nothing physically stops the actors; the score authors the stops. The minimum endpoint x gap is 150 and both y tracks match, making this initial plan comfortably separated. The implemented score still needs full continuous clearance certification. Do not shrink their separation to imply contact.

### What must read

By 2.4 seconds: opposite travel and a shared encounter. By 4.1 seconds: an attempted accommodation has failed. By 5.5 seconds: the repeated same-side pattern is visible. At the end: both are participants in an unresolved passing problem. If a viewer sees only “dancing,” inspect whether the large approach or blocked forward attempts were visually lost, rather than adding facial cues or making take one deliberately worse.

The construction uses pronounced lane changes because tiny lateral jitter would disappear on a 358 px phone stage. The slight final forward movements are secondary cues; the event must not rely on seeing a ten-unit nudge alone.

### Two contrasting misunderstandings for development

**Interpretation A: “They are dancing.”** A useful director revision could preserve the opposing approach, break the regularity of the sidesteps, and show an attempt to continue travel interrupted by another accidental same-side choice. It must not merely speed up the whole scene or add bouncing. Human inspection asks whether the revision makes destinationward travel and obstruction clearer while retaining mutuality.

**Interpretation B: “One is deliberately blocking the other.”** A useful revision could let a initiate the first accommodation and b initiate the next, with the other responding in each case. Maintain visible independent travel intent for both. It must not convert the scene into TM08 by keeping the same actor as every interceptor.

These are semantic authoring directions, not exact second-act trajectories, and are never fed to the live director. Withheld-guess retries receive the same target, first score, vocabulary and resources; they may independently discover the same useful changes. Do not weaken the comparator.

### Rehearsal checks

- View once at 1× before opening the target or track overlay.
- Inspect 820, 358 and 288 CSS-pixel stage widths with the full stage visible.
- Confirm neither actor passes through the other between any keys.
- Confirm the endpoint holds feel like a social coordination problem, not a rhythmic loop; do not call this a passed human result from author inspection alone.
- Check that neither color nor shape is used as permanent “bad actor” coding.
- Reject a repair that removes opposing travel, makes all obstruction one-sided, or changes the cast/role assignment.

## Scene two Delayed copying

### Meaning and staging

ID `TM09`; immutable meaning `TM09.meaning.1`. Actor a is a violet square, the initiator. Actor b is an amber triangle, the copier. Both stay in separate local areas. b copies the ordered relative displacements of a exactly one second later in the initial script. The relation is local imitation, not following another through the same global route.

Duration: 8,000 ms. a moves up, left, down, right and returns to its initial height with irregular holds. b reproduces the same path around its own anchor after the delay. A visibly quiet ending lets the copier finish after the initiator. Positional changes carry the meaning; rotation is unnecessary.

### Exact initial keys for actor a

| tMs | x | y | Beat |
|---:|---:|---:|---|
| 0 | 270 | 350 | Opening anchor |
| 1000 | 270 | 350 | Hold before initiation |
| 1750 | 270 | 280 | Up |
| 2150 | 270 | 280 | Uneven pause |
| 2900 | 200 | 280 | Left |
| 3250 | 200 | 280 | Shorter pause |
| 4250 | 200 | 420 | Down past original height |
| 4750 | 200 | 420 | Longer pause |
| 5500 | 270 | 420 | Right |
| 6250 | 270 | 350 | Return up |
| 8000 | 270 | 350 | Settle while b finishes |

### Exact initial keys for actor b

| tMs | x | y | Beat |
|---:|---:|---:|---|
| 0 | 730 | 350 | Separate opening anchor |
| 2000 | 730 | 350 | Hold one second beyond a’s start |
| 2750 | 730 | 280 | Copy up |
| 3150 | 730 | 280 | Copy pause |
| 3900 | 660 | 280 | Copy left |
| 4250 | 660 | 280 | Copy shorter pause |
| 5250 | 660 | 420 | Copy down |
| 5750 | 660 | 420 | Copy longer pause |
| 6500 | 730 | 420 | Copy right |
| 7250 | 730 | 350 | Copy return up |
| 8000 | 730 | 350 | Hold final arrangement |

The actor anchors are 460 units apart. Their exact paths are translated copies with a one-second temporal offset after a's motion begins. The minimum gap remains generous even when one moves left before the other. Verify the delayed relationship from the sampled transforms, not solely from matching key labels.

### What must read

There is an initiator and a copier. At least three direction changes recur in the same order, and the lag survives the small stage. The first actor finishes earlier and waits while the second catches up to the sequence. Do not add a turn of the circle as a cue in alternate roster variants; an unmarked circle's angle is invisible.

### Two contrasting misunderstandings for development

**Interpretation A: “They are dancing together.”** A useful revision can increase the perceptible lag within duration limits, lengthen an irregular leader pause and let b reproduce it. The evidence is ordered dependency rather than visually nicer symmetry. It must not reverse the initiating role.

**Interpretation B: “One is chasing the other.”** A useful revision can strengthen the separate anchor zones and keep both actors' net positions local. It must not place b on a's global route or close their inter-actor distance as a pursuit.

Do not award fidelity solely because a second clip contains similar zigzags. The ordered relative motion and role direction must survive. A blind retry may improve exactly those cues; that is a legitimate comparator result.

### Rehearsal checks

- Play the delayed version, then its synchronous reference with the same local path. At 1×, confirm they are perceptibly different to the author; human judgments remain separate.
- Verify that each moved key after a's first motion corresponds to the same translated b key 1,000 ms later, with matching outgoing interpolation where applicable.
- Check that the frame-step view remains operable but does not falsely claim to preserve the impression of lag.
- Keep a/b roles unchanged between first and second acts.
- Reject interpretations or generated choreography that introduce pursuit, role reversal or independent random motions.

## Scene three Making room

### Meaning and staging

ID `TM04`; immutable meaning `TM04.meaning.1`. a is a violet square on the left, b an amber triangle on the right, and c a teal circle approaching from below. a and b make the gap usable before c moves into it. The final arrangement contains all three; the pair does not flee.

Duration: 9,000 ms. Begin with a relatively close pair and a separate third actor. c approaches and waits. The pair opens noticeably, c joins, then the pair settles a little toward the new middle member while maintaining safe spacing. End with a quiet three-actor line.

### Exact initial key plan

| tMs | a x | a y | b x | b y | c x | c y | Beat |
|---:|---:|---:|---:|---:|---:|---:|---|
| 0 | 410 | 260 | 590 | 260 | 500 | 590 | Pair and separate third |
| 1000 | 410 | 260 | 590 | 260 | 500 | 590 | Establish relationship |
| 2250 | 410 | 260 | 590 | 260 | 500 | 430 | c approaches but stops outside |
| 2600 | 410 | 260 | 590 | 260 | 500 | 430 | Brief request-like pause without symbols |
| 4000 | 280 | 260 | 720 | 260 | 500 | 430 | Pair opens generous space |
| 4250 | 280 | 260 | 720 | 260 | 500 | 430 | Opening visible before entry |
| 6000 | 280 | 260 | 720 | 260 | 500 | 260 | c joins between them |
| 6250 | 280 | 260 | 720 | 260 | 500 | 260 | Pause as a group |
| 7250 | 330 | 260 | 670 | 260 | 500 | 260 | Pair settles toward the joined member |
| 9000 | 330 | 260 | 670 | 260 | 500 | 260 | Hold an inclusive arrangement |

The initial pair is 180 units apart. c's closest approach before opening is still outside the pair. Entry occurs only after the gap has widened to 440 units; the final neighbor separation is 170. These observations support the sketch, while the implementation must certify continuous clearance independently.

### What must read

The approach happens first, the pair's opening happens second, and c enters third. A pause between opening and entry makes the dependency visible. The last inward settle supports continued grouping, without relying on a facial “welcome” expression or asserting friendship as a required mental state.

### Two contrasting misunderstandings for development

**Interpretation A: “They are keeping the third one out.”** A useful revision can hold the open gap longer, let c enter fully and sustain the three-member arrangement. It must not remove the initial pair or replace the event with simple parallel travel.

**Interpretation B: “They are running away from it.”** A useful revision can have the pair move only far enough to open a place, wait for c, and remain nearby after arrival. The important contrast is accommodation rather than continuing escape. Do not show pursuit, a threat or a forceful shove.

### Rehearsal checks

- Inspect whether the pair initially reads as a pair at phone size without making their clearance illegal.
- Verify c cannot enter before the gap opens, including the continuous interpolated positions.
- Keep all three visible at every aspect ratio and zoom level.
- Inspect whether the final three-way arrangement reads as settled rather than as a still frame cut from ongoing escape.
- Reject repairs that close the opening, let c force through it, abandon the third, or swap the joiner role.

## Motion reference suite

These assets are deterministic authoring controls, not runtime examples of successful repair. Place them in an operator-only fixture module with names that clearly distinguish them from measured content. Store actual JSON, hashes, policy versions and validation results during the build. Source is `mock_fixture` for diagnostic motions, not `runtime_generated`.

### MR01 Synchronous and delayed copying

Use TM09's a track and a b track translated +460 units in x. In the synchronous reference, b uses a's key times. In the delayed reference, use the TM09 b table. Both last 8,000 ms and have the same local geometric path. Assert the synchronous transforms have identical local displacement at every tested time, and the delayed transforms match a at time `t-1000` for the corresponding active interval. Inspect at 358 px, 1×. Do not call every synchronized performance “dance” as a semantic fact; the contrast isolates timing.

### MR02 Approach and interception

Two actors, a circle at (200,350), b square at (680,350), duration 8,000 ms. In the approach reference, a advances to (500,350) over 1,000–3,000 ms and holds while b stays at (680,350); the endpoint gap is 180. In the interception reference, use a route at y=350 from (200,350) toward (620,350), and let b move from (650,550) to (650,350) during 1,000–2,000 ms, before a advances only to (470,350) during 2,250–4,250 ms and stops. Keep the opening and closing holds so all scores last eight seconds. The traveler never actually reaches (620,350); that is authoring intent, not a hidden scene object. Certify the complete two-actor paths. The visible comparison is a stationary destination actor versus a blocker arriving first, not an assertion that coordinates alone prove intention.

### MR03 Opening and closing a gap

Use TM04's cast and 9,000 ms duration, but give BOTH references the identical starting positions a=(340,260), b=(660,260), c=(500,590). The 320-unit initial pair gap is an intermediate, passable opening. Both hold through 1,000 ms, and c approaches (500,430) during 1,000–2,250 ms, then holds through 4,250 ms. During 2,600–4,000 ms, the OPENING pair moves to (280,260)/(720,260); the CLOSING pair moves to (425,260)/(575,260). The closing pair stays 150 units apart and holds through 9,000 ms; c stays at (500,430), so there is no attempted collision. In the opening reference only, c enters (500,260) during 4,250–6,000 ms; after a hold through 6,250 ms the pair settles to (330,260)/(670,260) by 7,250 ms and all hold to 9,000 ms. Use zero-rotation, unit-scale smoothstep segments and explicit holds at those shared times. The closing reference's analytic minimum pair separation is 150 units, and its closest c-to-member distance is sqrt(75²+170²), about 185.8 units. The opening reference's minimum is 170 units. Revalidate the transcribed scores independently. The matched change is whether the same starting gap opens or closes before entry; the initial scene composition is identical. This diagnostic is separate from both the full TM04 script and a two-closure TM05 act; label it as a reference, not a calibrated scene.

### MR04 Meaningful pause and uniform slowdown

Use a (circle) and b (square), duration 8,000 ms. a starts at (200,350), approaches (450,350) during 1,000–2,500 ms; b is fixed at (630,350). Hold a at (450,350) until 4,500 ms, then retreat to (360,350) during 4,500–5,500 ms and hold. Compare with a slow continuous version that goes (200,350) to (450,350) during 1,000–4,500 ms, then retreats to (360,350) by 6,000 ms with no separate held encounter. Both are legal and noncontact. Compare whether the visible stop changes the interpretation. The two motions need not be duration-rescaled clones; the controlled distinction is the existence of the stationary encounter.

### MR05 Intentional stops and continuous travel

Duration 6,000 ms. a is a circle with keys at 0:(150,250), 1500:(300,250), 3000:(450,250), 4500:(600,250), 6000:(750,250). b is a square fixed at (500,500) at zero and 6,000 ms. Baseline scales and zero rotation throughout. In the continuous version, every outgoing segment is linear; a's velocity is exactly (100,0) stage units/second on every segment, so the joins have no velocity discontinuity. In the stops version, every nonfinal outgoing segment is easeInOut; it reaches zero speed at each key and peaks at 150 units/second. Both obey speed and clearance limits. Assert transforms at keys are the same while intermediate velocity behavior differs. The comparison demonstrates an expressive choice, not a defect requiring an expanded engine.

## Concrete briefs for the eight comparison drafts

Complete these eight first-score drafts after the three detailed scenes pass technical and builder-visual checks. Each uses the corresponding canonical meaning/roster, full-transform keys, the same geometry/policy and no live generation. Use eight or nine seconds, a one-second opening hold and at least a one-second settled consequence. Give meaningful travel precedence over ornamental rotation or squash. Do not activate a study merely because all drafts exist.

The coordinates below are staging anchors and routing constraints, not promises of a collision-free finished score. The builder must choose exact times/keys, validate full continuous clearance, inspect real playback, and store the final immutable hash. Maximum 24 keys per actor and the shared numeric bounds remain mandatory. A repair required for numerical safety may change timing/staging but cannot quietly change the meaning.

### TM02 Tagging along

Use a circle leader and square follower. Route the leader from (420,220) right to (760,220), down to (760,480), then left to (580,480). Start the follower at (200,220); it reaches the leader's successive route points after the leader, with at least 180 units of along-route separation and a visible positive delay. Do not run the follower on a parallel translated path: it must traverse the same global corners. Prevent corner cutting by holding sufficient separation and, if necessary, letting the leader wait only after the follower has reached its previous corner. End with the follower behind, without overtaking or closing aggressively. Inspect confusion with chase and local imitation.

### TM03 Trying to catch up

Use a circle ahead at (440,280) and square behind at (180,440). Both head right in safely separate lanes, making the shared direction obvious without stage markings. In the first half, let a advance to about (700,280) while b makes slower progress to about (350,440), establishing a widening x gap. In the second half a eases to a stop near (760,280); b accelerates within limits to (760,440). The final center separation is 160 and the two can make one small shared rightward move before holding. Do not let b overtake or a flee. The final side-by-side reunion distinguishes catching up from pursuit.

### TM05 Keeping someone out

Use the TM04 pair/joiner roster, with the pair initially at (280,260)/(720,260) and c at (500,590). c approaches to (500,440); the pair closes toward (410,260)/(590,260) and holds before c attempts entry. c stops, then shifts its approach toward a visibly different lane; the pair opens that lane briefly only as needed for staging and closes the new approach in response, while c remains outside. Preserve at least 129-plus-margin clearance at every instant, including pair adjustments. Use one causal closure at a time; if the second closure cannot be staged clearly in nine seconds, reduce extraneous motion rather than allow contact. End with c outside and a held barrier-like pair, not a near-contact clash. No angry tilt coding is required.

### TM06 Taking turns leading

Use a triangle a at (400,350) ahead of square b at (180,350). Travel right together initially to about (580,350)/(340,350). Then a moves aside to y=180 and pauses while b advances along y=350 to x≈740. Only after b is safely ahead, a follows from the side lane onto the same rightward route, settling about 200 units behind b. Construct that merge as separate noncontact phases; no crossing-through. End with b leading for at least one visible travel segment. Avoid acceleration that makes the event look like winning a race; a's yielding pause is the essential causal cue.

### TM08 Getting in the way

Use a circle traveler at (200,350) and triangle blocker at (600,540). a begins an obvious rightward approach; before it reaches the middle, b moves to about (650,350) and stops. a brakes around (470,350), safely 180 units away. a then clearly begins a detour toward an upper lane, and b moves ahead into that lane before a reaches it. Route the second interception using enough vertical separation that b never crosses through a; adjust positions after full clearance certification. Hold b stationary before each braking response. End unresolved. In contrast to TM01, b is consistently the interceptor and a consistently the traveler.

### TM10 Waiting for the other

Use a square a at (300,250) and circle b at (160,450), both traveling right. First a moves faster toward x≈500 while b reaches x≈300. a then holds until b reaches a matching x position in its own y=450 lane, making arrival readable with 200 units of vertical clearance. Repeat a shorter advance to x≈720, another wait until b reaches that x, then a small simultaneous move at the slower pace. Travel happens toward a shared destination; no oscillatory choreography. Each resumption must visibly follow the companion's arrival, not a metronomic schedule independent of b.

### TM11 Startled retreat

Use triangle a at (200,350) and circle b at (600,350). Hold one second. a makes one abrupt but legal approach to (430,350) over approximately 700 ms. b's retreat begins after that motion has visibly started and takes it toward (780,350); preserve safe center separation during the delayed response. a stops at (430,350) and never pursues. b holds, then settles modestly toward (730,350) and remains there through eight seconds. One sharp onset followed by a long calm consequence is sufficient. Do not repeat advances, create impacts, or imply injury. The word “startled” is an intended reading, not a measured internal emotion.

### TM12 Failed coordination

Use square a at (280,300), triangle b at (500,300) and circle c at (720,300). All travel upward in separated columns. a and b begin toward y≈160 while c starts late and reaches only y≈260. Hold the pair until c approaches their y coordinate; then make a second, slower shared move along a shallow common diagonal or downward destinationward continuation that remains within bounds. The final segment must show the adjustment succeeding, without any actor teleporting back to the opening row. Choose the route to avoid merely bouncing in place, and hold the final group. Verify pair/lagger separation across any diagonal segment; no exclusion or reversal of the lagging role.

## Revision and freeze procedure

For every first act, save the canonical JSON, score hash, meaning ID, geometry/contact versions, authoring provenance, validator report and scene-specific visual inspection notes. A caption reading “draft” or “uncalibrated” is metadata outside the stage. Never bake title text or explanatory arrows into the scored image.

Make a bounded choreography revision when a concrete issue is observed: an invisible travel intent, regular timing that overwhelms causality, insufficient hold, small-screen cue or a failed numerical interval. Record what changed and why. Revalidate the full score after every change, not only the edited segment. An engine or geometry change invalidates old evidence and requires coordinated version/hash updates. A meaning change requires a new immutable meaning revision and rubric review.

For an offline director probe, preserve all outputs and failure categories under the approved collection policy. No hand-edited generated clip counts as an unedited success. Compare two actual or explicitly synthetic contrasting guesses and a strong withheld baseline with the same fixed first score. Synthetic guesses must be labeled synthetic in records and capture; they are not participant evidence. Runtime generation must remain disjoint from these illustrative repair directions.

Before freezing a real comparison bank, collect the evaluation chapter's independent calibration evidence for each included first-score hash. Keep development viewers, bank-calibration viewers and comparison participants distinct as specified. Freeze target meaning, roles, score, geometry, policy, rubric, provider configuration and presentation together. An uncalibrated clip can be a complete software asset; it cannot be labeled a calibrated study stimulus.

## Required evidence and honest status

The builder's deliverable includes the eleven first-score drafts, five matched reference pairs, actual validation output, automated assertions, representative playback captures, viewport/browser information, source manifests and a record of remaining issues. Provide the full count of checked/rejected/changed scenes. A contact-disabled candidate is intentionally absent from playback, not a failed missing implementation.

Screenshots establish composition, not causal motion. Code assertions establish selected numeric facts, not interpretability. Creator taste review establishes an author's judgment, not a blinded result. Human calibration and provider success must each cite their actual records or remain `not_run`. Do not promise that meticulous documentation makes the creative outcome certain.
