# Offline operator tools

These commands inspect local prerequisites without contacting a provider, opening a listener, reading credentials, or enabling generation. They do not grant spending authority. Live-provider qualification stays `NOT RUN`.

## Provider readiness

```sh
npm run provider:readiness
npm run provider:readiness -- --template
npm run provider:readiness -- --config /absolute/nonsecret-config.json
npm run provider:readiness -- --config /absolute/nonsecret-config.json --evidence /absolute/nonsecret-evidence.json
```

The direct entry point is `node --import tsx scripts/provider-readiness.ts`. `--template` prints the existing disabled provider configuration unchanged. It contains no credentials, approved model, price or enabled budget. Save that output only as a nonsecret configuration. Do not add a key or credential field.

Without arguments the report is `DISABLED_DEFAULT`. An explicitly supplied valid disabled configuration is `VALID_DISABLED`. Both exit zero and mean generation remains disabled. For an enabled configuration, missing or mismatched activation evidence produces `OFFLINE_PREREQUISITES_INCOMPLETE` and exit one. Valid matching records produce `OFFLINE_PREREQUISITES_VALID` and exit zero. This is a check of supplied records, not a verification of their factual claims. Authentication, credential presence and credits remain `NOT CHECKED`; live support and live qualification have not been tested.

The command uses the existing provider configuration validator and strict activation evidence schema. It checks the model, approval ID, disclosure version, and evidence time against the approved configuration, using the same noncredential bindings as activation. Approval expiry, purpose, price and budget relationships are enforced by the configuration validator. It does not assess reservation sufficiency for a particular request or inspect the private accounting ledger. Approval records document authority; this tool cannot create authority.

Inputs must be absolute `.json` paths, at most 256 KiB and 20 levels deep. Duplicate or unknown fields and invalid JSON are rejected. Credential-like path components, symlinks and directory traversal are rejected before reading. Do not point this command at credentials, environment files or operator data. Invalid arguments, files or records return sanitized error codes and exit one. Reports contain coded checks and fixed next steps, without supplied values, paths or exception messages.

Next, obtain explicit approval for an exact supported model, current official prices, disclosure and bounded workload, and prepare the nonsecret configuration and activation evidence described in the provider runbook. Use the existing secure credential environment separately. An authorized bounded quality probe is a separate operation and can spend money. Running readiness does not authorize that operation or participant service.

## Support report

```sh
npm run support:report
npm run support:report -- --out artifacts/support/report.json
```

The direct entry point is `node --import tsx scripts/support-report.ts`. Without `--out`, it prints a preview JSON report and creates no report file. `--out` also writes that same report to a new JSON file directly inside the repository's ignored `artifacts/support/` directory. The destination may be relative to the repository root or absolute. Existing files, symlinks, path escapes and nested directories are rejected. Newly created directories use mode `0700`; report files use `0600`. An existing support directory must already exclude group and other permissions. Errors return a generic code and exit one. A report containing unavailable checks can still exit zero because diagnostic collection completed.

The allowlist contains application version, declared Node/npm versions from the toolchain manifest, observed versions, platform and architecture, dependency availability, an in-memory native SQLite check and production build file presence. npm is queried only with `--version`, a three-second timeout, bounded output, offline mode and disabled user/global configuration. Version values must match a bounded numeric version format. A `PASS` for build files records presence, not build freshness or correctness.

Port availability is `NOT CHECKED` because the tool opens no listener. Browser binaries, startup, runtime health and user experience are outside this report's coverage. It does not inspect logs, environment values, provider configuration, persisted databases, account state or operator data. It includes no private paths, hostname, username, raw exceptions or arbitrary input fields. All empirical and public-release qualifications stay `NOT RUN`.

Preview the report before sharing it. Producing or saving a report does not send it anywhere or authorize external contact.

## Focused verification

```sh
npm test -- tests/unit/provider-readiness.test.ts tests/unit/support-report.test.ts
npm run typecheck
```

The focused tests cover disabled defaults, config/evidence bindings, strict bounded input, sanitized errors and fields, exclusive private output, symlink/path rejection, and both real CLI entry points with fetch, HTTP, socket and listener APIs blocked. They use synthetic approval/model/price records. They make no live-provider or empirical claim.
