# Codex model metadata

`src/server/provider/subscription-model-catalog.json` contains the installed Codex 0.160.1 bundled metadata for `gpt-6.1-sol`. The source is OpenAI's [pinned catalog](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/models-manager/models.json), distributed under the [Apache License 2.0](CODEX-APACHE-2.0.txt).

The diagnostic changes exactly one field: `tool_mode` from `code_mode_only` to the supported value `direct`. Other model metadata is retained. This is a local native-tool control, not a model-weight or director-prompt change. The server-only asset is hash-pinned, included in verification inputs, and never imported by the frontend.
