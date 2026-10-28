# Preparing a local source release

Tiny Mime is a local prototype and research tool. A prepared source bundle establishes technical packaging evidence. It does not establish human comprehension, enjoyment, scene calibration, semantic fidelity, comparative benefit, live-provider qualification or physical-device coverage.

Use the exact Node and npm versions in `toolchain-manifest.json`. Run `npm run verify:all` and `npm run audit:dependencies` on the final source. Keep those aggregate receipts separate from the consumer archive rehearsal. Neither command authorizes publication.

1. Run `npm run release:bundle` to prepare the source ZIP, offline preview, preview manifest, first-read instructions and checksums in a content-addressed directory under `artifacts/releases/`. Its initial status is `PREPARED`. `npm run release:prepare` still prepares a source ZIP alone.
2. Run `npm run release:rehearse -- --archive <path-to-source.zip>` against the exact ZIP to be reviewed. With no arguments the command prints usage and exits unsuccessfully. It never picks an archive implicitly.
3. Inspect the returned `artifacts/verification/.../receipt.json`, stage results, evidence index and `MANIFEST.sha256`. A failed stage leaves subsequent dependent stages `SKIPPED`. Keep the receipt with the exact archive hash. Rebuild and rehearse again after any source change.
4. Review the offline preview and release copy. Any actual publication, upload, push, account action or outreach requires the maintainer's explicit approval immediately before that action.

The public source excludes private build handoffs, implementation plans and review
prompts. Its specification integrity stage verifies the exact 36-file public
subset and reports that scope explicitly. The private working tree retains its
separate 56-file check. See [provenance](PROVENANCE.md) for the complete policy.

The rehearsal accepts only the deterministic ZIP matching the current checkout's `buildPublicFiles()` output. An archive's own manifest alone cannot authorize copied scripts. Before extraction it bounds ZIP size, file count, declared expansion and compression ratio, and rejects duplicate names, traversal, unsafe paths, symbolic links, unsupported records and mismatched headers. It verifies the extracted manifest and complete file set before running commands.

Each rehearsal uses a fresh ignored `.scratch/release-rehearsal-*` directory with its own home, temporary directory and npm cache. It inherits no credentials or provider configuration. The pinned Node directory comes first in the child PATH. npm uses `/dev/null` for user configuration and the copied `scripts/npm-global.npmrc` for global configuration. Installation uses the committed lockfile and standard package installation tooling, including native prebuilt downloads or native builds when required. It needs network access for public dependencies. All subsequent npm commands run offline.

The checks cover fresh `npm ci`, pinned npm, distribution integrity, typecheck, unit tests, fixtures, source-pack integrity, build, production smoke, doctor setup, disabled provider readiness, a sanitized support report and offline preview generation when the `preview:build` alias is present. Production smoke uses only `127.0.0.1:4317`; an occupied port fails the rehearsal and no existing listener is stopped. The full browser suite belongs to the separate aggregate verification and is not duplicated. Stages have finite deadlines. Child output is kept in private local logs instead of being echoed to the console. Receipts retain exit codes, timeouts, archive identity, source integrity and cleanup status on success or failure.

After the commands, the source manifest must be unchanged and public repackaging must produce byte-identical archive bytes. The command removes only its own scratch copy and cache in its cleanup path. Source ZIPs and sealed evidence remain. Local evidence can contain private diagnostic logs; review it before any later sharing.

## Release claim profiles

| Profile | Supported use and remaining gate |
| --- | --- |
| Local prototype | Authored first takes, clearly labelled mock fixture second takes, local rehearsal and offline capture. A passing rehearsal supports local technical reproducibility for the recorded environment. It does not prove usefulness or user acceptance. |
| Live adaptive play | Requires separately approved exact model, current prices, disclosure, workload budget, secure operator configuration and activation evidence. Authentication, credits, semantic quality and latency need actual authorized provider checks. Rehearsal leaves live qualification `NOT RUN`. |
| Research study | Requires actual consent, calibration, human scoring, allocation and study prerequisites in the source contract. Synthetic operations prove software behavior only. Human comprehension, enjoyment, per-scene calibration and comparative effect remain `NOT RUN` until observed. |

Publication remains a separate human decision. A passing local gate is not approval to publish or a claim that the prototype is fully validated.
