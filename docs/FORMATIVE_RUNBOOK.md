# First authored-experience observation

Preparation only. Human sessions, physical-device use and assistive-technology
observations are NOT RUN. This makes the existing E03 formative plan executable;
it does not approve recruitment, collection or publication, or change StudyRunV1.
Follow the unchanged
[E03/E11 obligations](../Tiny_Mime_Review_Source_Pack/chapters/03_evaluation_and_evidence.md).

## First decision and scope

Propose 4–6 adults, one at a time, viewing the three fixed authored development
pairs. Allow about 20 minutes per person, with stopping or skipping at any time.
That time is a planning allowance, not an observed session duration. No provider,
account, server, camera, microphone, recording or compensation is needed for the
viewing surface. Compensation, if desired, needs its own approval.

Before anyone takes part, the owner must approve this scope and the completed
disclosure, identify the facilitator and deletion owner, provide a real contact
route, and approve the private storage location. The owner arranges the adults;
an agent must not contact or recruit anyone without approval of that specific
communication. A person separately chooses whether to take part.

Proposed data handling: pseudonymous local session references, optional exact
interpretations, minimal task observations and optional ratings. No names,
demographics or contact details in the notes. Keep the lookup/contact arrangement
separate. Delete these notes within seven days, sooner on withdrawal. This is a
proposed manual deletion obligation, not an existing automated retention service.
Do not put human notes in the repo, synthetic Study, generated test evidence,
assistant memory or a provider request. Approval and a named deletion owner must
exist before collection.

## Bind and rehearse the viewing surface

Use the existing self-contained `tiny-mime-preview.html` and its companion
`tiny-mime-preview-manifest.json` from one release bundle. Preserve those exact bytes for
the session and record the HTML SHA-256 below. A fresh preview can be generated
with `npm run preview:build`; use its own matching manifest and hash. Never
silently mix a changed score or renderer with an earlier session's version.

The current unchanged authored preview is bound to SHA-256
`b89acac1e5ee809590b9791a6f96ce7c1037716ebd76d1c4b65a411b49643472`.
Its neutral scene order is 1 = TM01, 2 = TM09, 3 = TM04. Both takes are authored
fixtures. Neither responds to an interpretation. Preserve all six score hashes
from the manifest in the operator's version record, together with the source
meaning/rubric, renderer and `noncontact-v1` versions.

Open the file in an actual browser. Before the session, set its content viewport
to 390 CSS pixels wide, at 100% browser zoom, and check that only the first take
is visible. The resulting stage is 358 CSS pixels wide. This also works as a
narrow window on a desktop; record it as desktop hardware, not a tested phone.
At wide desktop widths the preview shows both takes together. That simultaneous
view must not precede the first-take interpretation. Keep the first encounter at
the declared single-take width; inspect the wide comparison only after the
initial interpretations are locked.

Start paused, on Scene 1, with Show first take selected and intention/notes
hidden. Leave the viewer's actual reduced-motion preference in force. Record the
preference only if directly observed; chosen frame mode does not establish it.
Do not enable animation on the viewer's behalf or assume manual viewing proves
the same comprehension as continuous motion. Note any format the person cannot
comfortably use and stop that task.

The HTML contains no response form or browser storage. Human notes would be
recorded manually under the separately approved arrangement. `npm run local`
continues to disable real Study. Do not enroll a human in a synthetic rehearsal.

## Fixed facilitator script

Complete the contact and storage details before reading this disclosure:

> You will watch silent shape animations and describe what you think is happening.
> Both takes are prepared examples. There is no AI generation or adaptation, and
> your answers will not be sent to a provider. We are studying the animations and
> controls, not testing you. You can skip anything or stop. With your permission,
> I will write your interpretations and brief observations under a local session
> reference. No camera, microphone or screen recording is used. Please do not
> include private information. The named deletion owner will remove the notes
> within seven days. To withdraw sooner, use your session reference and the
> contact route supplied to you. The app's withdrawal form does not delete these
> separate notes. Participation does not permit publication. Do you want to take
> part, and may I keep those notes?

Record the choices before proceeding. Refusing notes is not permission to retain
answers anyway. This draft applies only to the stated provider-free activity;
the live Study disclosure has different transmission and retention obligations.

For each neutral scene in order:

1. Say: "Please watch the first take in whatever viewing mode is comfortable."
   Let the person find Play pair or the frame controls. Do not reveal intention,
   name the scene meaning, explain actors or steer an answer. If help is needed,
   record the failed unassisted task before offering help. A skip stays a skip.
2. After the first take ends, ask: "What do you think is happening?" Record the
   natural interpretation before the second take or any reveal. Lock that entry;
   keep later corrections separate. An absent answer is missing, not incorrect.
3. Say: "Please look at the other authored take. What, if anything, seems
   different?" Let the person select Show second take and replay from the start.
   Both clocks are synchronized; switching takes alone does not restart playback.
   Record what they notice without suggesting that the second take is better.
4. Ask the optional question: "How enjoyable was this round?" Use 1 = not at all,
   2, 3, 4, 5 = very enjoyable, or prefer not to answer. Keep any perceived
   helpfulness comment separate from enjoyment and semantic recognition.
5. Only now may the person reveal the intention and notes. Record a mismatch as
   an observation, not a failure by the viewer. When changing scenes, verify the
   notes are hidden and Show first take is selected again.

After the three scenes, ask: "Would you voluntarily play another round?" Keep
the optional response as declared interest. This packet offers no held-out extra
scene. Record an extra opportunity as not offered, with acceptance, start and
completion unknown. Do not turn interest, a replay or a yes-click into observed
continuation. A real optional-extra offer needs its separately approved scope.

Then expand to a wide desktop view if applicable. Ask the person to pause,
compare the same moment, use the timeline, find frame controls, change scenes
and find the intention. Record unassisted completion, coaching and confusion.
Do not make a positive judgment contingent on finding a particular interpretation.

## Minimal blank observation sheet

Copy this blank sheet to the approved private location only after approval.
Leave unavailable observations blank with a reason. This is a small formative
note, not a new analyst CSV or a replacement for masked human coding.

| Session field | Blank value |
| --- | --- |
| Random local reference and date | |
| Actual approval/disclosure record; facilitator; deletion owner/contact | |
| Participation choice; permission to retain notes | |
| HTML filename/SHA-256; matching manifest/version record | |
| Hardware, OS, browser; CSS viewport; stage width; zoom | |
| Directly observed motion preference or unknown; chosen viewing mode | |
| Notes location and actual deletion deadline | |
| Withdrawal requested; deletion verified by owner, or not requested | |

| Neutral scene | First take viewed/skipped/missing and mode | Interpretation before second/reveal | Difference noticed after second | Optional enjoyment 1–5/missing reason | Control, pacing, discomfort or coaching observations |
| --- | --- | --- | --- | --- | --- |
| 1 / TM01 | | | | | |
| 2 / TM09 | | | | | |
| 3 / TM04 | | | | | |

| End field | Blank value |
| --- | --- |
| Declared interest yes/no/not answered | |
| Extra opportunity | Not offered; acceptance/start/completion unknown |
| First-use task failures and help given | |
| One change the person would make, if offered | |
| Session stopped early; reason optional | |

## Physical phone and assistive-technology receipt

For a phone, record the real model, OS/browser and exact file-opening method.
First verify that this browser executes the self-contained player. A file-manager
thumbnail or static HTML viewer is not a passing browser journey. If execution
is unavailable, mark BLOCKED. The Mac service binds only to literal loopback;
a phone cannot reach it over Wi-Fi using the Mac URL. Do not change Host/Origin
checks, start a LAN/public listener or publish a page to bypass that boundary.
Offline preview success qualifies only that artifact's motion and touch tasks.
Full Play/Study phone tasks need a separately approved, actually verified route.

For assistive technology, record the actual tool/version and user's familiar
input method. Observe control names/order, focus, playback state, timeline,
reduced-motion operation, reveal text and navigation. Record each as completed
unassisted, completed with help, failed, stopped or not run, with the failure.
The visual interpretation task has no nonvisual equivalent. Do not count a
spoken SVG label, accessibility tree or keyboard script as comprehension or
screen-reader-user success. Device or AT simulation remains separate.

## Use the observations

Retain failed sessions and missing answers. Look for recurring instruction,
pacing, motion-cue and control failures. Repair an observed failure under a new
score/UI version, preserve the old version and run affected software checks.
A changed score needs fresh observation and its own later calibration status.
Do not claim recognition rates, validated enjoyment, adaptive benefit or a quality
judgment merely because 4–6 sessions took place. Reassess the unchanged rubric
against what was actually observed, including unresolved failures.

The eight-scene calibration cohort, provider diagnostic, interactive latency and
spend qualification, 24-person comparison, masked recognition/fidelity work and
publication are later distinct decisions. This first packet activates none of them.
