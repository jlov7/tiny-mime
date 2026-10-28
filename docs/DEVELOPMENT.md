# Development and verification

The pinned development toolchain is Node.js 24.15.0 and npm 12.0.0. The local
startup path is tested on macOS. POSIX scripts and native SQLite mean Windows is
not qualified. A proposed Ubuntu CI job is included; its remote result is unknown
until run on the published head.

```sh
npm ci
npm run doctor
npm run dev
```

Use literal `http://127.0.0.1:4317`. Development has no HMR listener. Stop your own
server before browser verification, since tests use the same fixed port. No API
key is needed for development checks.

## Checks

```sh
npm run typecheck
npm test
npm run verify:fixtures
npx playwright install chromium firefox webkit
npm run verify:all
npm run audit:dependencies
```

Browser installation downloads binaries and is needed only for testing.
`verify:all` verifies the full private specification manifest or the exact public
36-file subset, with the scope recorded in its receipt. It runs type checking, unit tests,
numeric fixtures, Chromium/Firefox/WebKit tests, build, client privacy audit,
production smoke and source-release checks. It verifies all 76 specification
acceptance IDs and 69 numeric fixtures against passing test reports. Required
skips, retries and missing cases fail. Live provider configuration is removed
from the child environment.

Evidence is isolated under `artifacts/verification/`, hashed before/after and
sealed with file manifests. It can contain machine-local paths and is not copied
into the public source archive. A failed or unavailable dependency audit fails
its gate; it does not mean zero advisories.

`verify:distribution` validates the source manifest in an extracted distribution.
`verify:release` checks the exact prospective public files and Markdown links.
`release:prepare` creates a deterministic source ZIP without publishing it.
See [PROVENANCE.md](PROVENANCE.md).

`npm run release:bundle` pairs source and a standalone authored HTML preview.
`npm run release:rehearse -- --archive <source-zip>` checks that exact current
archive in an isolated fresh install and cleans its copy and cache. Its receipt
distinguishes real command execution from unit-test stubs. The rehearsal covers
consumer installation and packaging; the aggregate supplies the browser suite.
See [releasing](RELEASING.md) for the complete sequence and claim profiles.

`npm run provider:readiness` checks explicitly supplied nonsecret configuration
records without credentials or network access. `npm run support:report` previews
allowlisted environment diagnostics. The commands use Node's existing tsx import
hook without the tsx command's IPC listener. See [operator tools](OPERATOR_TOOLS.md)
and the [additive contract](PRODUCT_ADDITIONS.md).

## Clean startup

On macOS, run `npm run verify:clean-start` in an interactive terminal. It creates
a temporary ignored copy inside the repository, installs the lockfile with a
fresh cache, builds through `npm run local`, and exercises desktop animated and
390px frame-mode rounds. Its one-use launch secret stays in memory. It stops its
listener and deletes only the copy it created. Registry access and installed
test browsers are prerequisites.

## Contributing safely

Use bounded regression tests for changed behavior. Preserve closed schemas and
study allocation. Do not add provider calls, relax safety limits or change
research claims to obtain a pass. Keep real data and credentials outside source.
New dependencies need a concrete purpose and reviewed provenance/license.
See [CONTRIBUTING.md](../CONTRIBUTING.md) and [SECURITY.md](../SECURITY.md).
