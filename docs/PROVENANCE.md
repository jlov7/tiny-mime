# Source and evidence

Tiny Mime 0.3 is a local motion theatre and directing workspace with research
tools. The source release includes the application, synthetic fixtures,
verification tools and a selected set of unchanged v0.2 reference specifications.
The root [MIT license](../LICENSE) covers original code and documentation.
[Codex notices](licenses/CODEX-NOTICE.md) identify the Apache-2.0 model metadata;
dependency licenses remain with their packages.

## Specification custody

The original private v0.2 source pack has 56 manifest entries. The public source
contains an exact 36-file subset: product/design, technical and evaluation
specifications, schemas, contract fixtures and supporting reference material.
Every retained file is byte-identical to its original. Schemas, fixtures, scene
meanings, numerical requirements and study schedules are unchanged.

The 20 omitted files are build handoffs, implementation plans, review prompts
and history, the old pack index/overview, a superseded coding brief and proposed
storyboard/layout illustrations. The root build handoff is also excluded.
[release/source-pack-subset.json](../release/source-pack-subset.json) accounts for
all 56 original entries, with their hashes, exact disposition and omission reason.
It contains no omitted file contents. The private working pack is never overwritten.

Generated `SOURCE_PROVENANCE.json` records both manifest hashes, every retained
file hash and every omission. The verifier pins the original 56-entry manifest
and the exact 36-entry subset independently of the editable release allowlist.
`npm run verify:source-pack` reports `full-source-pack` in the original working
tree or `public-specification-subset` in the export. It rejects changed bytes,
missing or extra files, forged manifests and changes to the frozen subset policy.
A public subset PASS does not claim that omitted private inputs were verified.

## Distribution integrity

`release/public-files.json` is the exact distribution allowlist. Packaging rejects
links, unsafe paths, personal home paths, common credential patterns and broken
local Markdown links. It copies no Git directory, development history, operator
data, personal account output, private work reports, caches or installed packages.
The ZIP uses fixed timestamps and file modes. Equal inputs produce equal bytes.

Before extracting a received bundle, run `shasum -a 256 -c SHA256SUMS` in its
directory. This checks bundle-file integrity against the included checksum list.
For source-archive authenticity, compare the archive's SHA-256 with a reference
obtained separately through a trusted channel. A checksum list or archive hash
received with the same bundle does not independently establish authenticity.

`RELEASE_MANIFEST.json` contains every distributed file's size and SHA-256 except
the manifest itself. Run `npm run verify:distribution` after extraction to check
those files. Generated dependencies, builds and test receipts are excluded from
that source integrity check. The archive's SHA-256 also belongs in the release
handoff.

`npm run verify:release` checks the prospective distribution and its links.
`npm run release:prepare` creates an allowlisted source ZIP under
`artifacts/releases/`. Neither command publishes anything. Use this ZIP or an
independently checked fresh repository created from it for publication. Do not
change the working repository's visibility to publish its development history.

`npm run release:bundle` adds a standalone authored preview and a first-use
guide alongside the source ZIP. Each file has a checksum; `RELEASE_BUNDLE.json`
binds the exact contents. A bundle's PREPARED state is separate from verification.
The [consumer rehearsal](RELEASING.md) rejects archives that differ from the
current public source before running their copied scripts. Its private receipts
are not automatically public release assets.

## Evidence limits

The automated suite checks authored/mock behavior, strict contracts, motion
validation, recovery, local HTTP boundaries, retention and offline capture.
Verification receipts are local outputs rather than public human data.
The [guide image record](images/PROVENANCE.json) identifies each current screenshot,
its capture version, viewport, score context and exact file hash. Packaging rejects
missing image records or mismatched hashes. The images use authored fixtures and
synthetic editing/restore examples, with no participant data or provider calls.
Human comprehension, enjoyment, per-scene calibration, semantic-fidelity coding,
actual assistive-technology use, comparative improvement, physical-device testing
and live interactive API qualification are NOT RUN.
CI and remote clone verification are unconfirmed until a repository is pushed
and those jobs actually finish. There is no public-hosting qualification.
