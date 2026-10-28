# Tiny Mime maintainer conventions

Read docs/DEVELOPMENT.md for setup and verification. The retained v0.2 technical
specification owns closed wire formats and numerical limits. docs/API_EXTENSIONS.md
records the implemented recovery amendments; docs/PRODUCT_ADDITIONS.md defines
the additive operator workspace. docs/PROVENANCE.md explains the public subset.

Run `npm run verify:all` and `npm run audit:dependencies` before handing off changes.
Keep meanings, rosters, study allocation, provider configuration and operator data
server-only. Preserve strict input validation, authentication before authorization,
and request IDs. Use authored/mock fixtures and preserve NOT RUN empirical claims.
Keep credentials and real participant data out of source and verification inputs.
