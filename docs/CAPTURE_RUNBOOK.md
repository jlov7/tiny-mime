# Local creator capture

Start with `npm run local` on Node 24.15.0/npm 12.0.0, then open
`http://127.0.0.1:4317/creator/capture`. The runner disables live generation and
real study collection. Use a separate creator browser profile and unlock the
local operator capability.

## Make a creator example

Select an authored scene, confirm **My own demonstration text** and choose
**Start creator demonstration**. Complete both takes and both guesses, then
select **Creator capture** after reveal. Full motion and frame stepping are
supported. Early reveal and an unavailable second take cannot become complete
examples.

An uninterrupted creator visit records bounded control timing in private server
memory: playback, pauses, frame steps, replays, submission, waiting and reveal.
The record contains no guess text, target or provider configuration. It belongs
only to this creator-owned round and expires with it. It is a client observation,
not independent evidence of viewing or a video recording.

The export distinguishes two timing bases:

| Basis | What the replay preserves |
| --- | --- |
| Observed creator timing | Recorded control order, positions and holds, including concurrent replay during waiting |
| Score reconstruction | Each validated score at 1× speed, server generation duration and chosen 1.5-second text display holds |

Refresh, a lost creation acknowledgement, missing timing, overflow or interrupted
recording makes original control timing unavailable. The export remains useful
as a labelled reconstruction. Its manifest has `actualTimeline: null`; it does
not invent an observed session. Server generation duration and viewer-observed
waiting are separate fields.

Timeout or an uncertain clock ends the observed waiting interval. Time spent
before explicitly recovering a result remains a separate recovery gap. A
shortened-wait export is offered only for complete timing where shortening
cannot remove recorded playback. Its manifest retains actual and exported
timelines and exact edit ranges. Frame stepping never becomes evidence of
original full-motion viewing.

## Choose the exported content

Guess inclusion starts off. Enable it only for creator-owned text or separately
verified publication permission for this specific round. Study consent never
grants publication permission. Omitted text is absent from the embedded payload.

Options are fixed while a bundle is generated. Changing an option afterward
removes the old download; create a new bundle for the new choices. Scores and
accepted guesses are never edited. A selected example does not establish typical
results.

Create the export and save `tiny-mime-replay.zip` locally. Operator and owning
session authority must remain valid. The server retains an undownloaded bundle
for at most ten minutes, removes it after a successful download, and revokes
linked cached bundles and receipts when study records are withdrawn. Downloaded
files cannot be recalled. Select **Return to the completed round**, then
**Finish**, before starting another journey.

## Reopen and inspect

The ZIP contains `replay.html`, `capture-manifest.json`, `scores/act1.json` and
`scores/act2.json`. Extract it into a private local folder and open the HTML
without the app or network. Playback starts explicitly. Pause freezes the frame;
Replay returns to the beginning without autoplay. Reduced motion selects frame
stepping, including intermediate key poses inside observed motion intervals.
A hidden tab pauses playback. The intended scene appears only at reveal.

Use the exported-seconds timeline to seek, or choose a recorded/reconstructed
segment directly. **Previous segment** and **Next segment** move between acts,
waits, guesses and reveal without replaying the whole bundle. **Previous frame
or segment** moves backward through manual key positions. Separate segments at
the same timestamp keep their recorded order. Every jump pauses, and rewinding
clears text and reveal that belong to later segments. These controls do not edit
the exported timeline or convert a reconstruction into an observation.

The local owner can inspect the embedded source, so the bundle is unsuitable for
blinded participants. It provides no publication or upload authority.

For technical verification, preserve the ZIP and canonical score hashes. Check
both provenance labels, omitted or literal guess text, edited-wait notices,
initial hidden reveal, final reveal, and replay clearing reveal. The literal
guess `</script><img src=https://example.invalid/x onerror=alert(1)>` must appear
as text without creating an image, script execution or external request.
Ordinary Unicode must survive. Record the browser and viewport; emulation does
not qualify a physical device.

Run `npm test -- tests/unit/capture.test.ts tests/unit/capture-trace.test.ts` and
`npm run test:browser -- tests/browser/capture.spec.ts tests/browser/capture-timing.spec.ts tests/browser/capture-options.spec.ts`.
The final gates remain `npm run verify:all` and `npm run audit:dependencies`.
Human comprehension, enjoyment, calibration, fidelity and comparative benefit
remain NOT RUN.
