# GrayMatter MCP Server

An MCP (Model Context Protocol) server that wraps the ValkyrAI `api-0` REST API, exposing GrayMatter durable memory, SwarmOps graph state, and live business schema as tools for Claude.ai, Claude Code, Cursor, and any other MCP-compatible host.

## Quick Start

```bash
git clone https://github.com/ValkyrLabs/GrayMatter.git
cd GrayMatter/mcp-server
npm install
export VALKYR_AUTH_TOKEN=<your-token>
npm start
```

The server runs on `http://localhost:3333` by default.

For Codex plugin-managed launch, use stdio:

```bash
npm run stdio
```

The repo-level `.mcp.json` points Codex at `node mcp-server/index.js --stdio`.

## Environment Variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `VALKYR_AUTH_TOKEN` | Local/private only | none | Bearer token from `scripts/gm-login`. In hosted multi-tenant mode this process-wide fallback is ignored. |
| `VALKYR_API_BASE` | No | `https://api-0.valkyrlabs.com/v1` | API base to target. Use hosted api-0, a self-hosted api-0, or a local GrayMatter Light ThorAPI instance. |
| `GRAYMATTER_MCP_MODE` | No | `local-dev` | Deployment mode: `local-dev`, `private-stdio`, `single-tenant`, or `hosted-multi-tenant`. Hosted modes disable wildcard CORS. |
| `GRAYMATTER_ALLOWED_ORIGINS` | Hosted modes | `GRAYMATTER_WIDGET_DOMAIN` | Comma-separated trusted browser origins allowed to receive CORS credentials in hosted/public modes. |
| `GRAYMATTER_ALLOW_UNSAFE_HEADER_TOKEN` | No | `false` | Explicit override that allows `X-Valkyr-Token` in hosted modes for private testing only. |
| `GRAYMATTER_LOGIN_COMMAND` | No | `../scripts/gm-login` | Login helper used to refresh process-scoped auth after api-0 returns `SESSION_EXPIRED`. |
| `GRAYMATTER_LOGIN_TIMEOUT_MS` | No | `30000` | Maximum time allowed for the autonomous login helper during MCP auth recovery. |
| `GRAYMATTER_WIDGET_DOMAIN` | No | `https://graymatter.valkyrlabs.com` | Public widget origin advertised in Apps SDK resource metadata for ChatGPT app review. |
| `PORT` | No | `3333` | HTTP port to listen on. |

Get a hosted token:

```bash
scripts/gm-login
```

For local GrayMatter Light, start the ThorAPI instance and point the MCP server at it:

```bash
scripts/gm-light-up
source .graymatter-light/.graymatter-light-env
cd mcp-server
VALKYR_API_BASE=http://localhost:8080 GRAYMATTER_LIGHT_MODE=true npm start
```

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/sse` | SSE stream; connect Claude.ai here with the paired message endpoint. |
| `POST` | `/message` | JSON-RPC message endpoint paired with `/sse`. |
| `POST` | `/mcp` | Public Apps SDK MCP endpoint for ChatGPT connector setup and app review. |
| `POST` | `/` | Direct JSON-RPC endpoint for simpler clients and tests. |
| `GET` | `/health` | Readiness check with configured API base and exposed tools. |
| `GET` | `/health/auth` | Auth/CORS readiness check showing mode, trusted origins, and token fallback posture. |
| `GET` | `/security` | Alias for `/health/auth`. |

Stdio mode exposes the same JSON-RPC methods over newline-delimited stdin/stdout and does not print startup text to stdout.

The server also implements `resources/list` and `resources/read` for the Apps SDK overview widget at `ui://graymatter/overview.html`. Tool descriptors include Apps SDK security scheme mirrors, tool invocation status text, and action annotations for review.

## Available Tools

| Tool | Backing API path | Description |
| --- | --- | --- |
| `memory_write` | `POST /MemoryEntry` | Write a durable `MemoryEntry` (`decision`, `todo`, `context`, `artifact`, or `preference`). |
| `memory_read` | `GET /MemoryEntry/{id}` | Read a `MemoryEntry` by ID. |
| `memory_query` | `POST /MemoryEntry/query` | Semantic search across GrayMatter memory. Hosted api-0 may consume credits. |
| `memory_retrieve_with_receipt` | `POST /graymatter-retrieval-receipts` | Search memory and return a Retrieval Receipt with quality, provenance, policy, and recommended action signals. |
| `retrieval_receipt_get` | `GET /graymatter-retrieval-receipts/{receiptId}` | Fetch one persisted Retrieval Receipt for audit/debug workflows. |
| `retrieval_receipt_query` | `GET /graymatter-retrieval-receipts` | List receipts by trace, agent, workflow, status, or time range. |
| `graph_get` | `GET /SwarmOps/graph` | Inspect the SwarmOps shared object graph. |
| `graymatter_status` | `GET /memory/status`, `/memory/capabilities`, `/memory/usage`, `/memory/semantic-health`, `/graymatter/semantic-index/manifest`, `/graymatter/control`, `/graymatter/admin/control` | Inspect memory, semantic index, entitlement, control, and admin status surfaces. |
| `graymatter_semantic_search` | `POST /memory/semantic-index/search` | Search the semantic/vector memory index directly. |
| `graymatter_semantic_reindex` | `POST /memory/semantic-index/reindex` | Request semantic reindexing when RBAC permits it. |
| `graymatter_object_graph_shape` | `GET /graymatter/object-graph/shape` | Inspect relationship-aware object graph shape. |
| `graymatter_retrieval_tools` | `GET /graymatter/retrieval-tools` | List server-side retrieval tools and retrieval-context capabilities. |
| `graymatter_retrieval_context` | `POST /graymatter/retrieval-context` | Build server-side retrieval context for a query. |
| `graymatter_activation_bridge` | `GET /graymatter/activation/bridge`, `GET /graymatter/activation/bridge/retry`, `POST /graymatter/activation/bridge/event` | Use install/login/signup/credit activation bridge flows. |
| `graymatter_mcp_bundle` | `POST /graymatter/mcp/bundles`, `GET /graymatter/mcp/bundles/{bundleId}` | Create or fetch GrayMatter MCP bundles. |
| `entity_list` | `GET /{entityType}` | List business entities such as `Customer`, `Task`, `Invoice`, or `Goal`. |
| `entity_get` | `GET /{entityType}/{id}` | Fetch a single entity by type and ID. |
| `entity_create` | `POST /{entityType}` | Create one entity when RBAC permits it. |
| `schema_summary` | `GET /api-docs` | Summarize the live ValkyrAI OpenAPI schema. |

See `../docs/server-capabilities.md` for the broader live api-0 capability map. The generic entity tools are intentionally broad because GrayMatter should use the RBAC-visible business object graph, not just a narrow memory endpoint list.

## Scoped Memory

`memory_write` and `memory_query` accept optional scope fields so agents can retrieve memory for the current chat, workspace, automation, or session without relying on loose tag matching.

Supported fields:
- `sourceChannel`
- `scope`
- `runtime`
- `user`
- `workspaceKey`
- `chatKey`
- `sessionKey`
- `automationId`
- `artifactPath`
- `scopePath`

When `sourceChannel` is not provided, the server derives it from the strongest available scope. A path like `$HOME/.codex/automations/mcp-and-skill-hunter/memory.md` becomes `codex:automation:mcp-and-skill-hunter`; a Codex workspace path under `Documents/Codex/<date>/<slug>` becomes `codex:workspace:<date>/<slug>`. `memory_write` preserves the hierarchy in a compact `[graymatter-scope]` header inside `MemoryEntry.text`, while `memory_query` sends the derived value as the api-0 `source` filter.

## Retrieval Receipts

Use `memory_retrieve_with_receipt` when an agent intends to answer from GrayMatter memory. The returned receipt includes `retrievalStatus`, `answerPolicy`, `recommendedAction`, score breakdowns, coverage, provenance, policy decisions, `receiptId`, and `traceId`.

Agents should inspect `answerPolicy` before generation:
- `ALLOW_ANSWER` means the retrieved context is acceptable for answering.
- `ALLOW_WITH_CAVEAT` means answer with uncertainty or provenance.
- `DO_NOT_ANSWER_CONFIDENTLY`, `REQUIRE_RETRY`, `REQUIRE_CLARIFICATION`, and `DENY` mean the agent should not present a confident memory-grounded answer.

Use `retrieval_receipt_get` and `retrieval_receipt_query` for audit trails, debugging, retry chains, and low-confidence retrieval inspection.

## Connect to Claude.ai

For public or shared deployments, use a hosted session/OAuth handoff or short-lived connector bootstrap flow that sends standard bearer auth for the current user. Run hosted connectors with explicit origins, for example:

```bash
GRAYMATTER_MCP_MODE=hosted-multi-tenant \
GRAYMATTER_ALLOWED_ORIGINS=https://claude.ai,https://chatgpt.com \
npm start
```

Then add the MCP server integration using `https://your-host/sse`.

For local/private testing only, expose port `3333` with a tunnel and use the tunnel URL plus `/sse`; raw `X-Valkyr-Token` headers are treated as a debug path, not the public happy path.

```bash
npm start &
ngrok http 3333
```

## Connect to Claude Code

Add an HTTP MCP server entry that points at the message endpoint:

```json
{
  "graymatter": {
    "transport": "http",
    "url": "http://localhost:3333/message",
    "headers": {
      "X-Valkyr-Token": "<your-token>"
    }
  }
}
```

## Per-Request Auth

For hosted multi-tenant deployments, do not set or depend on a shared `VALKYR_AUTH_TOKEN`; the server ignores process-wide auth in `hosted-multi-tenant` mode. Pass each user's credential as standard `Authorization: Bearer <token>` from the approved session/bootstrap flow so api-0 calls stay scoped to that user's RBAC permissions.

`X-Valkyr-Token` remains available for `local-dev` and `private-stdio` workflows. Hosted modes reject it unless `GRAYMATTER_ALLOW_UNSAFE_HEADER_TOKEN=true` is deliberately enabled for private testing.

When the server is using process-scoped auth from `VALKYR_AUTH_TOKEN`, `VALKYR_JWT_SESSION`, or the plugin launch environment, a `401 SESSION_EXPIRED` response triggers one autonomous `gm-login env` refresh and retries the original request with the new token. Per-request bearer credentials are never replaced by process credentials, so tenant-scoped calls remain isolated.

For plugin-managed local/private stdio use, run `../scripts/gm-self-update maybe` during startup and `../scripts/gm-activate` for first-run bootstrap. `gm-activate` performs update, login, install validation, smoke test, agent registration, OpenAPI sync, and schema summary.

## Production Notes

Railway, Fly.io, and Docker deployments all work as long as the server can reach `VALKYR_API_BASE`. Public deployments should run in `single-tenant` or `hosted-multi-tenant` mode with `GRAYMATTER_ALLOWED_ORIGINS` set; token-bearing routes will not emit `access-control-allow-origin: *` in those modes.

For ChatGPT app submission:

1. Deploy this server on a public HTTPS domain with `GRAYMATTER_MCP_MODE=hosted-multi-tenant` and explicit trusted origins.
2. Submit the connector URL as `https://your-host/mcp`.
3. Set `GRAYMATTER_WIDGET_DOMAIN` to the public origin that hosts the widget surface.
4. Verify `/health/auth` reports no wildcard CORS, no hosted `X-Valkyr-Token` happy path, and no multi-tenant process-token fallback.
5. Provide the GrayMatter privacy policy URL, screenshots, test prompts, and reviewer test credentials through the OpenAI Platform Dashboard only.
6. Do not commit reviewer passwords, tokens, OAuth secrets, or MFA recovery material.

Minimal Dockerfile:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY index.js ./
EXPOSE 3333
CMD ["node", "index.js"]
```

## Credits

Some hosted GrayMatter operations, notably `memory_query` and receipt-backed retrieval/evaluation lanes, consume api-0 credits. Fresh signups should receive 500 starter credits automatically. Recharge at <https://valkyrlabs.com/buy-credits>.
