# Contributing

Read the [README](README.md), [architecture](docs/ARCHITECTURE.md),
[security boundaries](SECURITY.md) and [technical specification](Tiny_Mime_Review_Source_Pack/chapters/02_technical_spec.md).
Use synthetic fixtures. Do not commit credentials, real guesses, participant
records, operator exports, machine-local paths or account output.

## Setup

Use the pinned Node/npm toolchain and committed lockfile:

```sh
npm ci
npm run doctor
npm run dev
```

Open literal `http://127.0.0.1:4317`. Stop your own server before browser checks.
No API credential is needed. See [development](docs/DEVELOPMENT.md) for browser
installation, production startup and the macOS clean-start check.

## Changes

Make the smallest complete change. Follow nearby code and tests. Bug fixes need
a regression test; new logic follows existing test conventions. Preserve closed
schemas, noncontact limits, scene meanings and study allocation. A protocol change
needs an explicit rationale and revised evidence, rather than a relaxed assertion.

Keep hidden/operator material server-only at runtime. Validate untrusted inputs,
authenticate before authorization, include request IDs in errors, and use
structured logs without private data. New dependencies need reviewed official
provenance, licensing and advisories. Avoid live calls in tests.

Keep scratch installs in ignored `.scratch/` and remove only the artifacts you
created after recording the check.
Stop any listener or container you start when its check is done.

## Verification and distribution

Run focused tests while editing, then the final gates:

```sh
npm run verify:all
npm run audit:dependencies
```

Describe observed behavior, changes, checks and limitations in the pull request.
Software checks do not qualify research, live model quality or public hosting.

`release/public-files.json` is an explicit allowlist. Add new public files there
when needed. Run `npm run verify:release` and `npm run release:prepare`, then
validate the extracted artifact. Do not expose the private working history by
changing its visibility. Packaging is local; publication remains the maintainer's
decision. Contributions use the root MIT license; third-party notices remain.
