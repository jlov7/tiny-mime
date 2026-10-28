# API access and optional diagnostics

The local fixture demo and authored Rehearsal require no API key. Fixture take 2
replays take 1. It does not adapt to a guess.

## Live Play and Study

Live adaptation uses the OpenAI Responses API. Each operator needs an API account
and server-side credential, or access to a separately operated service whose owner
accepts its usage costs. This app ships as a local application and provides no
shared hosted account. Never put a credential in browser code or a public repository.

`npm run local` explicitly disables live calls and research collection even if
provider-related environment variables were inherited. Manual live activation
requires a validated provider configuration, exact supported model ID, current
price/disclosure evidence, explicit spending approval, enabled runtime flags and
nonzero caps. A key alone does not activate it. Configuration examples contain no
credential and grant no transmission or spending authority.

Read the exact [technical specification](../Tiny_Mime_Review_Source_Pack/chapters/02_technical_spec.md)
and server-side configuration schema before activating a provider. The
`probe:quality` command fails closed without approved inputs. Live timed API
qualification remains NOT RUN; no runtime reliability or cost estimate is claimed.

## ChatGPT subscription diagnostic

`probe:subscription` is an optional owner diagnostic that invokes a pinned Codex
CLI using its existing login. It is separate from the app's Responses API adapter
and does not enable live Play or Study. There is no subscription sharing or
Sign in with ChatGPT integration in this app.

The diagnostic requires Codex CLI 0.160.1, requested model `gpt-6.1-sol`, its pinned
catalog and an explicitly authorized synthetic plan. Account/model access is not
guaranteed. The native agent supplies framing, and universal tool-free execution
cannot be established. Unknown returned model identity and subscription usage
must not be reported as known. Default verification uses mocked processes and
does not invoke that CLI for inference.

Generated valid scores can be imported into Rehearsal for inspection without
altering the authored bank. Such inspection does not qualify the original
tool-free API protocol or establish semantic improvement. Raw diagnostic files
have private permissions and are purged on the next diagnostic run after seven
days. If no further run occurs, the operator must delete expired owned files.
Copied exports are outside automatic retention.
