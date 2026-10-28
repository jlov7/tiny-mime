# Security and privacy

Tiny Mime supports one trusted local operator on one computer. It is not
qualified as a public, LAN, multi-tenant or hosted service, or as protection from
malware running as the same OS user. The [architecture](docs/ARCHITECTURE.md),
[usage guide](docs/USAGE.md) and
[technical specification](Tiny_Mime_Review_Source_Pack/chapters/02_technical_spec.md)
describe the implemented boundaries.

## Sensitive boundaries

- Preserve literal loopback binding and exact Host/Origin restrictions.
- Authenticate, authorize and validate before protected operations. Operator
  capability is distinct from participant ownership.
- Keep meanings, rubrics, rosters, allocation, provider configuration and operator
  records server-only at runtime. Client route hiding is not authorization.
- Treat guesses, imports, rating files and provider output as untrusted. Preserve
  size limits, strict schemas and continuous noncontact checks. Never execute
  supplied markup, scripts or motion functions.
- Keep the launch secret only in the launching terminal and unlock form. Lock
  operator tools before handover. Keep capabilities out of URLs, traces,
  screenshots, logs, exports and browser storage.
- Preserve retention and withdrawal rules. Downloaded exports need separate
  deletion controls. Research consent does not grant publication permission.
- Keep providers disabled by default. A credential is not spending or transmission
  approval. Preserve budgets, deadlines and unresolved reservations.

## Reporting

Do not put secrets, participant content, capabilities, databases or auth files
in a public issue. Prepare a minimal synthetic reproduction with the affected
revision, expected/observed behavior and request ID if available.

No dedicated private reporting channel or response-time commitment is established.
If the repository's Security tab offers private vulnerability reporting, use it.
Otherwise request a private channel without public exploit details. The maintainer
must enable and verify that channel before advertising it as available.

Do not access real records, contact participants, activate a provider, expose a
listener or delete data to demonstrate an issue. Reproduce locally with synthetic
inputs. This policy is not a security certification or bug bounty.

## Validation

Use a relevant regression and `npm run verify:all` plus
`npm run audit:dependencies`. Client audit, HTTP/session tests, recovery,
retention and offline-capture checks establish only their tested behavior.
Unavailable advisory data must not be reported as a clean audit.

Source packaging checks its allowlist, links, common credential patterns and
personal paths. It excludes history and runtime data. These checks reduce
accidental disclosure; they do not prove the absence of all possible secrets
or replace a penetration test.
