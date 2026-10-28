# Using Tiny Mime

## First visit

Run `npm run local` in an interactive terminal. Open `http://127.0.0.1:4317`,
select **Open directing demo**, and enter the one-use launch secret from that
terminal. Play the first take, reflect privately, then start the prepared second
take. Select **Reveal intention and notes** when ready. Optional **Inspect both
takes together** opens a shared timeline. On a phone, its take switch pauses
playback without changing the shared time.

## First round

Open **Play** and select **Try a fixture round**. Play the first take to its end, enter
a guess and select **Send guess**. Play the next take, enter the final guess,
then reveal the intended scene. Select **Another scene** or **Finish**.

Fixture take 2 repeats take 1 and does not adapt to the guess. This path needs
no API key. A live adaptation requires the separate Responses API setup in
[PROVIDER.md](PROVIDER.md).

The first private fixture round in a page visit includes a dismissible guide.
After reveal, **Compare your two takes** provides a shared clock and exact numeric
change counts. Neither feature is added to Study. A repeated fixture has zero
score changes; numerical differences never establish improved communication.

## Directing examples

Select **Open directing demo** from Home, or **Examples** in operator navigation.
Watch the authored first take, select **Reflect on first take**, keep your thought
to yourself, then **Continue to second take**. Each take starts at zero paused.
No response is collected, and the prepared second take never adapts to a guess.
Choose **Reveal intention and notes** or **Skip to written reveal** to see the
fixed example interpretation and directing choices. **Next scene** is optional;
**Finish for now** is available after every reveal. Scene changes conceal the
notes and focus the new first take.

**Playback controls** exposes the individual take timeline, reset and key steps.
Reduced motion starts in keyframe mode: **Next keyframe** advances without
animation and **Replay frames** resets after the last key. Full motion offers
**Play take** and **Replay take**.

**Inspect both takes together** opens the secondary comparison. Both panes
preserve their original timing on one clock; a shorter clip holds its final
frame. On phones, switch the visible take at the same paused moment. **Frame and
key controls** exposes precise comparison controls. **Return to first take**
leaves inspection and resets the current encounter. **Open rehearsal** retains
the selected scene. After reveal, **Rehearse first take** and **Rehearse second
take** open the exact chosen score in Rehearsal, paused at zero. Human review
stays NOT RUN.

In Play, **Reveal** and **Exit** remain available during a round. Refresh offers explicit
recovery without autoplay. Interrupted generation retains its original deadline;
**Check result** does not create another generation request. Submit with the send button or Enter while the enabled guess field is focused.
Composition input is never submitted mid-composition. Guess text is not saved in browser storage.

If a local reachability check fails, use **Check local connection** after restoring
the server. This checks reachability without submitting anything. After confirmed
private session/round loss, **Discard old request** returns to setup after an
explicit confirmation. It removes this tab’s saved request and unsent draft;
it does not cancel provider work or erase recorded charges. Study recovery and
withdrawal remain separate.

## Viewing controls

The player supports pause, replay, scrub and frame stepping. Use **Frame by
frame** to avoid animated playback, or explicitly choose **Play animation**.
System reduced-motion preference starts in frame mode. A hidden tab pauses and
does not automatically resume. The exported creator replay also pauses if reduced
motion is enabled while it is playing. Clearing that preference cannot autoplay. Watching the whole take, or stepping through all
required frames, enables guessing. Changing viewing mode can require a replay.

Use Tab and Shift-Tab to navigate the skip link and labelled controls. Space or
Enter activates a focused button. Arrow keys adjust the focused Rehearsal
timeline. The primary **Next frame** advances manual playback. Rehearsal keeps
previous/next keys under **Frame and key controls**. The stage and
controls fit narrow screens; browser zoom is supported.

## Rehearsal

Unlock operator tools and open **Rehearsal**. Choose an authored scene, inspect
its tracks, play/scrub it, and compare matched motion references. Settings offer
820, 358 and 288 CSS-pixel previews, constrained by available width.

Imported MotionScoreV1 JSON is checked locally and on the server, including
continuous noncontact constraints. A score becomes active only after server
acceptance. A failed validation keeps the previous score and imported text,
with an explicit retry. Accepted imports, candidate loads and edit forks focus
a status identifying what is now in rehearsal. Import never rewrites the authored bank.
**Restore authored draft** returns to the selected bank score. Human review and
calibration labels remain NOT RUN.

The three directing scenes also offer **First take** and **Second take** as
explicit source choices. The second take is a fixed authored
alternative. It is never selected from a viewer's guess. Saving it creates an
unreviewed operator snapshot and does not change the authored bank.
If prepared takes fail to load while a score is open, **Retry prepared takes**
restores those choices without replacing your current score, fork, title or notes.

The **Directing desk** keeps private snapshots separately from the bank. Its
**Revise**, **Compare**, **Notes** and **Versions** buttons select one task at a
time. They preserve your title, notes, numeric edits and selected key. On a wide
screen the task stays beside the stage; on a phone it follows the stage.

Open **Notes** and give the candidate a title. During playback,
**Note this frame** pauses and opens the note editor at that exact frame. Entering
the editor directly also pauses and captures a frame for a new note. The visible
**Note frame** stays fixed while typing or inspecting another time; **Return to
note frame** seeks back. **Note this frame** explicitly replaces the draft note’s
timestamp when needed. Select **Add captured note**, then **Save new candidate
version**. Earlier snapshots
remain available in **Versions**, under **Saved candidates and version history**. Load a snapshot
explicitly. Notes belong to its exact score hash; their time buttons return to
the relevant frame. The local tray stores at most 64 snapshots across scenes.
Snapshots survive app restart. Unsaved drafts stay in memory only. To free space,
remove a saved version with no retained children and confirm the removal. Remove
child versions before their parent. The current score, title and unsaved notes
remain usable; save them as a new version when needed. Removed payloads cannot
be restored by retrying their original save request.

Within **Versions**, **Find saved work** searches private version titles and scene IDs.
Open a result to return to its exact score and notes. A saved-version URL also
reopens that version after refresh or a new unlock. Candidate IDs grant no access
without operator authorization. The current version and its parent are identified
in the workbench; **Compare with parent** opens the exact saved baseline directly.
An unchanged saved version cannot consume another tray slot through an ordinary Save.

Open **Compare** to select the authored draft, a prepared second take where
available, or another saved candidate from the same scene. The main stage shows
the selected comparison on a shared clock. Switch **First take** and **Second take**
to inspect either take at the same moment. **View comparison stage** returns
to the canvas from the comparison controls.

Open **Revise** and select **Start edit fork** to change supported
numbers, undo up to 30 edits and validate before activating a fork. Cast, stage,
key count and easing stay fixed. Invalid forks cannot play, save or export.
**Edit this moment**, beside playback, pauses and opens the source key at or before
the playhead. It reopens a fork already in progress without replacing its edits.
**Inspect selected key** returns to the stage at that timestamp. **Preview valid
fork** uses the main stage to inspect source and fork on a shared clock before
application. Leaving comparison or preview returns to the source paused at the
visible moment, clamped to its duration. Applying preserves the paused
inspection position and title. Unsaved source notes must first be saved under
their original hash; **Save source notes and keep fork** preserves both jobs.
Notes from an earlier score are never silently relabelled as notes about a revision.

Applying a fork preserves independent import text. Inspecting an error can select
the offending JSON and identifies its actor or interval. Unsaved material requires
an explicit decision before replacement.

**Loop a rehearsal interval** repeats a selected section of at least 250 ms only
after an explicit Play. Reduced motion continues to use manual frame steps.
**Download candidate inspection ZIP** exports a saved, unchanged candidate as
`inspection.html`, `score.json` and `inspection-manifest.json`. Open the HTML
offline without the app. Candidate titles, notes, targets and guesses are omitted.
This is a rehearsal artifact, separate from the recorded-round creator bundle.
The complete stage and playback controls stay together at desktop and phone
sizes. Frame mode uses **Next frame** and **Restart frames**; motion mode uses
**Play**, **Pause** and **Replay**. **About this inspection and score** contains
the exact score hash and qualification limits.

**Numeric changes** shows exact before/after stored fields and buttons to inspect
their neighboring intervals. A timing correspondence is shown only for equal-length
key lists whose complete stored transform/easing sequences are unchanged. Other
differences are matched at exact actor timestamps; no moved-key identity is inferred.
These are numerical differences, not judgments of meaning or quality.

Within a comparison, **Download pair inspection ZIP** exports a separate
`pair-inspection.html`, two canonical score files and a pair manifest. It preserves
the chosen baseline and active revision with fixed labels, exact hashes and
factual provenance. It excludes private titles, notes, targets, guesses and local
IDs. The offline player starts paused, uses one clock, holds the shorter score's
end frame and supports phone switching, seeking and manual key traversal.
See [pair inspection](PAIR_INSPECTION.md). The existing single-score inspection
and recorded-round capture formats keep their separate meanings.

To preserve private titles, notes and version history, open **Versions**, then
**Back up or restore saved work**. Download a private backup, or choose an existing
backup and preview what would be added before restoring. Existing versions and
unsaved edits stay intact. The [backup guide](WORKSPACE_BACKUP.md) also covers
stopped-app command-line recovery. Inspection exports cannot restore private work.

## Creator capture

Use **Use authored scene in creator capture** or open Creator Capture. Confirm
that the material is yours and explicitly start. Guess text is excluded by
default. Downloaded bundles contain offline `replay.html`, scores and a manifest.
Open the HTML locally without starting Tiny Mime. A complete creator timing
record preserves pauses, frame steps and replay order. After refresh or incomplete
recording, the export is labelled as score reconstruction and original timing is
unavailable. Shortened waits are offered only when they preserve recorded
playback. Changing export options clears the prior download; options stay fixed
while a new bundle is created. This is not a video renderer or upload tool.
The offline replay keeps its stage and primary controls together. With full
motion off, the primary control advances the next frame or recorded segment;
**Restart frames** starts again after the end. **About this replay and its
limits** holds the full qualification statement. Turning off a reduced-motion
preference never starts playback or opts into animation.
Exports are outside automatic retention; delete them when no longer needed.

## Study recovery

Human collection stays locked unless separately approved. Operators can rehearse
the flow with synthetic records. Refresh restores helpfulness eligibility only
after the app has recorded a completed second take. If viewing cannot be
confirmed, check again or use the explicit option to continue without helpfulness.
A pending feedback retry keeps the original answers and request identity.

Keep the withdrawal code until deletion is confirmed. After an interrupted
withdrawal and refresh, re-enter that code to check the original request. A
different code sends nothing. Discarding a saved request does not delete Study
records or confirm that an earlier deletion succeeded. If saved round receipts
cannot be matched safely, the app keeps them and offers explicit review or discard.

## Local authority and data

The service binds to literal loopback. Use the exact URL; `localhost` and LAN
addresses are rejected. Keep the launch secret out of URLs, screenshots, files
and shared messages. **Enter participant mode** locks operator tools before
handover. Use a separate browser profile for operator work.

Default application data is in the OS user's application-support directory.
Directory permissions are 0700 and database permissions 0600. An optional
`TM_DATA_DIR` must be absolute and outside the app directory. Keep data out of
source/static files and cloud-synced folders.

Private rounds expire after 30 minutes of inactivity; reads do not extend them.
Restart discards rounds and browser authority. Real study collection has separate
retention, consent and activation requirements described in [RESEARCH.md](RESEARCH.md).

## Troubleshooting

Run `npm run doctor` for setup checks, or `npm run doctor -- test` after installing
test browsers. Wrong Node/npm versions require installing the pinned versions;
doctor does not modify your machine. If native SQLite is unavailable after a
toolchain change, reinstall with `npm ci` under the pinned Node version.

An occupied port is not automatically cleared. Stop only the instance you
started, then retry. A database lock indicates another process using that data
directory. Session expiry requires a new session; do not edit cookies or the
database to revive it. Use Ctrl-C in the launching terminal to stop the service.

Internet access is unnecessary for authored and fixture tools after installation.
When the local server is unreachable, check its terminal before retrying. Network
recovery never silently submits an answer or enrolls a study session. A lost study
start has an explicit check; after reload, an unknown real-study start requires
consent to be reaffirmed before any retry.
