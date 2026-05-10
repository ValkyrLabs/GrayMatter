# OpenAI App Directory Submission Notes

## Current OpenAI paths

- Legacy ChatGPT Plugins are no longer accepting new submissions.
- ChatGPT App Directory submissions require an app built with the OpenAI Apps SDK, which extends MCP.
- OpenAI Developers Showcase submissions are a separate promotional gallery and require a submitter identity, public project links, a cover image, and agreement to the Showcase Gallery Program terms.

## GrayMatter readiness

GrayMatter is now packaged as a local Codex plugin through `.codex-plugin/plugin.json`.
That plugin packaging is useful for local Codex discovery, but it is not the same thing as a ChatGPT App Directory submission.

To submit GrayMatter to the ChatGPT App Directory, the product still needs:

- A deployed HTTPS Apps SDK/MCP endpoint for ChatGPT to connect to.
- User authentication flow suitable for ChatGPT app review.
- Public directory metadata, screenshots, and testing instructions.
- A clear GrayMatter-specific privacy policy URL.
- Country availability and review details entered from a verified OpenAI platform account.

## Useful submission copy

Title:
GrayMatter

Tagline:
Durable memory and live schema context for business-native agents.

Description:
GrayMatter gives agents durable memory, shared graph context, and authenticated awareness of the live ValkyrAI api-0 schema. It helps Codex and OpenClaw workflows persist decisions, query reusable context, inspect business objects, and coordinate agent state inside an RBAC-scoped business data environment.

Repository:
https://github.com/ValkyrLabs/GrayMatter

Setup:
Clone the repository, install `jq`, run `scripts/gm-activate`, then use `scripts/gm-query`, `scripts/gm-write`, `scripts/gm-graph`, and `scripts/gm-entity` for memory and schema operations.
