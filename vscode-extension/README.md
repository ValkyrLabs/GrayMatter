# GrayMatter Memory for VS Code

Give your coding agent durable memory, retrieval receipts and shared context. GrayMatter is available through VS Code's native MCP tool picker. ValorIDE is not required.

## Start with hosted memory

1. Install **GrayMatter Memory**, then run **GrayMatter: Get Started**.
2. Choose **Hosted GrayMatter (recommended)** and sign in to your valkyrlabs.com account when asked.
3. Enable GrayMatter tools in your agent's tool picker. Run **GrayMatter: Verify Connection** to check the account and required tools.

Hosted memory keeps the service's account and tenant permissions. Credentials use GrayMatter's existing scoped platform vault; no token is written to workspace MCP settings. Installing the extension or listing available MCP definitions does not open a login dialog.

## Local Lite without hosted signup

Run **GrayMatter: Connect Local GrayMatter Lite**. The extension includes the verified Lite source builder and prepares it in private extension storage. It builds/starts Lite, verifies the local account, then exposes memory tools through the native MCP provider. No source checkout or hosted signup is required.

Use macOS/Linux, or a WSL/remote Linux extension host, with Bash, curl, tar, jq and zip installed. Setup names missing tools before starting a build. The first build needs Java, Maven and dependencies; the builder installs missing private Java, Maven and Node toolchains. A first install with uncached dependencies needs internet access. Installed local memory works offline. Retry interrupted setup or reconnect after stopping Lite; existing H2 memory remains available. Local setup requires a trusted workspace. An existing previously selected GrayMatter source folder remains usable.

## Build and review in the maintained repository

From `GrayMatter/vscode-extension`, run `npm ci`, then `npm run release:check`. This typechecks, tests and builds `output/graymatter-memory-0.1.0.vsix`. `npm run package:vsix` also creates that package directly. Build inputs default to this maintained GrayMatter checkout and its sibling `ValorIDE` checkout; no Codex task directory is required. The build bundles three native ValorIDE adapters and the portable GrayMatter runtime, includes licenses, and excludes generated output, logs and credential state from Lite's source payload.

Run `npm run test:native` for a fresh disposable editor/profile acceptance run against the packaged VSIX, including interrupted setup, no-signup memory, reconnect and a full editor restart. Set `GRAYMATTER_ACCEPTANCE_VSCODE_EXECUTABLE` (and `GRAYMATTER_ACCEPTANCE_VSCODE_CLI` if different) when VS Code is installed elsewhere. It needs the local Maven dependency cache for offline fixture builds and uses an isolated copy. Evidence is written to `output/native-acceptance`; the fixture credentials, database, profile and owned processes are cleaned up. This acceptance has been verified on macOS arm64; other hosts need their own validation.

The manifest publisher is `ValkyrLabsInc` and the extension ID is `ValkyrLabsInc.graymatter-memory`. The package is prepared for manual Marketplace submission under that publisher. The build performs no publication and needs no publisher credentials.

Your agent's model is configured separately. Ask it to save a harmless project note, then retrieve it with `memory_query`.

## Connection help

**GrayMatter: Verify Connection** checks actual `memory_query`, `memory_write` and `graymatter_invariant_preflight` discovery. Errors describe the selected account/server and next repair step. Use **MCP: List Servers** to inspect or restart the native server. For local backend diagnostics, run `./vaix doctor` in the source folder. Hosted sign-in stays separate from local credentials.

## Install from VSIX

Use **Extensions → Install from VSIX…** and select `graymatter-memory-0.1.0.vsix`. VS Code 1.103 or newer is required. This extension ships its portable MCP runtime and uses the editor's Node runtime. It does not install another coding assistant.

## Build and review

The build bundles the already-tested local setup/task adapter from the sibling ValorIDE source tree, then ships a standalone artifact. Set `GRAYMATTER_VALORIDE_SOURCE` to that tree when it is named differently. The extension has no ValorIDE dependency at runtime. Portable authentication, connection resolution and MCP server files come directly from GrayMatter source; they are not reimplemented.

Run `npm run build`, `npm test`, then `npm run package:vsix`. The listing, PNG icon, license, changelog and support links are included. Publishing requires approval and access to the existing `ValkyrLabsInc` publisher; packaging does not create publisher credentials or publish anything.

[Setup guide](https://valkyrlabs.com/graymatter/install) · [Support and issues](https://github.com/ValkyrLabs/GrayMatter/issues)
