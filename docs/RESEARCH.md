# Research workflow and limits

The study workspace supports synthetic short/full rehearsals, consent and
retention controls, masked coding, adjudication, withdrawal and frozen analysis
inputs. Synthetic fixtures test the software workflow. They are not participant
observations or evidence that a second take improves interpretation.

Real study activation remains held until an operator supplies the required human
review/calibration, approved bank, consent/disclosure and provider qualification.
Do not recruit or collect data merely because the app builds. The exact frozen
protocol and data dictionary are in the
[evaluation specification](../Tiny_Mime_Review_Source_Pack/chapters/03_evaluation_and_evidence.md).

The [formative runbook](FORMATIVE_RUNBOOK.md) provides a provider-free observation script and blank notes for the three authored examples. It needs actual scope, disclosure, facilitator, storage and deletion approval before anyone takes part.

## Measurement and recovery limits

The [API amendments](API_EXTENSIONS.md) define exact reduced-motion observations and expired-request receipts. The first actual preference observation populates the existing analyst field; missing or legacy observations stay null. Chosen playback mode does not establish a preference. Restricted provenance records the initial value and observed changes, while masked exports and the 96-column header stay unchanged.

An expired study submission with an uncertain server acknowledgement cannot be
treated as unsaved. The workflow preserves uncertainty and holds continuation
when authoritative identity, acceptance or timing acknowledgment cannot be recovered. An explicit check confirms the exact Study/creation/round identity before resolving its saved mutation. Do not clear the descriptor
or edit records to force another response.

The owner-wide creation cap is ten rounds per hour across modes. A full study
uses those ten slots; prior rounds or an immediate optional extra can hit the
cap. Finish or decline the extra. Do not create another owner to evade allocation.

## Retention

Synthetic rehearsals use a separate temporary SQLite ledger with seven-day
retention. Real study guesses expire after seven days. Separately opted-in nonraw
results expire after 30 days. Startup, periodic maintenance and pre-export checks
enforce these boundaries; maintenance failure holds affected operations.
Downloaded exports need the operator's own deletion controls.

Session feedback recovery reads the authoritative saved flag before showing a
second rating form. An unavailable check offers retry without discarding the
uncertainty. Operator exports remain protected by authorization and masking.

## Analysis commands

The scripts `study:import-ratings`, `study:lock-first` and `study:analyze` operate
on explicitly supplied local study inputs. Use their argument validation and the
specification's schemas; the command names do not grant approval to collect or
publish observations. Keep real records outside the source tree and distribution.

A strict real freeze can initialize the first private research ledger without app startup or provider activation:

```sh
npm run study:import-ratings -- --freeze manifest.json protocol-binding.json approval-evidence.json categories.json
```

The four files must contain actual approved records conforming to the frozen schemas. Storage is restricted to the OS-private directory or an approved absolute TM_DATA_DIR outside the app tree (directory 0700, ledger 0600). Missing or malformed files and schema-invalid fields fail before storage initialization. Semantic rejection records no run but can leave an empty private ledger. Re-freezing changed inputs conflicts. Readback, ratings import and fixture paths never initialize an absent ledger. No freeze creates participants, activates a provider or supplies a missing approval.

Human comprehension, enjoyment, semantic fidelity, inter-rater calibration and
comparative effect remain NOT RUN. Passing software tests cannot close those gates.
