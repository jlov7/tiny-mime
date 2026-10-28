# Offline pair inspection

In the operator Rehearsal workspace, open **Compare**, choose a baseline,
then select **Download pair inspection ZIP**. **Compare with parent** selects a
saved revision's parent directly. In the app, **First take** shows the baseline
and **Second take** shows the active revision on the main stage. This download
makes no provider calls.

Extract the packet and open `pair-inspection.html`. It starts paused and needs
no server, account or key. The offline player shows Baseline and Revision beside
each other on a wide screen. Both scores share elapsed time; the shorter clip holds
its final pose. On a narrow screen, switch between Baseline and Revision at the
same paused moment. Playback, timeline, reset and previous/next key controls are
explicit. Reduced motion starts with manual key steps. A hidden page pauses and
does not automatically resume.

## Separate artifact contract

This is a new local artifact with manifest kind `rehearsal_pair_inspection`.
It does not change the existing `rehearsal_inspection` packet or the recorded-round
Creator capture format. It contains:

- `pair-inspection.html`: an engine-owned player with embedded licensed font,
  shared sampler and restrictive content policy.
- `baseline-score.json` and `revision-score.json`: unchanged canonical numeric scores.
- `pair-inspection-manifest.json`: both exact score hashes, the HTML hash, roster
  hash, geometry/contact versions, fixed labels and closed provenance values.

The exporter accepts exactly two score/hash/source records. Both scores must pass
the existing validator and share actor IDs, shapes, colours and paint order.
Their canonical hashes must match the supplied hashes. An invalid score, altered
hash, incompatible cast or extra input field refuses the export.

Private titles, notes, meanings, guesses, scene/candidate IDs, local paths and
provider configuration are excluded. The player makes no external requests and
uses no browser storage. Application code is MIT; its embedded display font is
covered by the included SIL Open Font License text.

The timeline is a reconstruction from the two scores. It is not a recorded round,
observed viewer timeline, runtime adaptation or assessment of communication.
Authored provenance is retained only when the chosen material came from an
authorized authored source. Saved or imported scores retain unqualified operator
provenance even when their numeric contents match an authored score.

Numeric validity does not establish meaning or improvement. Human comprehension,
enjoyment, scene calibration, semantic fidelity, comparative effect, actual
assistive-technology use, physical devices and live-provider qualification remain
NOT RUN. The visual activity has no nonvisual equivalent. Keep all inspection
artifacts private unless a separate publication decision authorizes their release.
