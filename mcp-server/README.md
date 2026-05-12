# GrayMatter MCP Server

An MCP server that wraps the ValkyrAI `api-0` REST API and exposes GrayMatter durable memory, SwarmOps graph state, and live business schema tools to MCP-compatible hosts.

## Quick Start

```bash
cd mcp-server
npm install
export VALKYR_AUTH_TOKEN=<your-token>
npm start
```

The server runs on `http://localhost:3333` by default.

## Environment

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `VALKYR_AUTH_TOKEN` | Recommended | none | Bearer token from `scripts/gm-login`, also accepted per request through `X-Valkyr-Token`. |
| `VALKYR_API_BASE` | No | `https://api-0.valkyrlabs.com/v1` | Override for a self-hosted or test api-0 instance. |
| `PORT` | No | `3333` | HTTP port to listen on. |

Per-request auth takes precedence over the environment token:

```text
X-Valkyr-Token: <user-token>
```

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/sse` | SSE stream for MCP clients that use the paired message endpoint. |
| `POST` | `/message` | JSON-RPC message endpoint paired with `/sse`. |
| `POST` | `/` | Direct JSON-RPC endpoint for simpler clients and tests. |
| `GET` | `/health` | Readiness check with configured api base and exposed tools. |

## Tools

| Tool | Description |
| --- | --- |
| `memory_write` | Write a durable `MemoryEntry`. |
| `memory_read` | Read a `MemoryEntry` by id. |
| `memory_query` | Semantic search across GrayMatter memory. |
| `graph_get` | Inspect the SwarmOps shared object graph. |
| `entity_list` | List live business entities such as `Customer`, `Task`, `Invoice`, or `Goal`. |
| `entity_get` | Fetch one entity by type and id. |
| `entity_create` | Create one entity when RBAC permits it. |
| `schema_summary` | Summarize the live ValkyrAI OpenAPI schema. |

## Claude.ai

1. Run the server somewhere Claude.ai can reach it.
2. Add an MCP server integration using `https://your-host/sse`.
3. Add `X-Valkyr-Token: <your-token>` as a request header.

For local testing, expose port `3333` with your tunnel of choice and use the tunnel URL plus `/sse`.

## Claude Code

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

## Production Notes

For multi-tenant deployments, do not set a shared `VALKYR_AUTH_TOKEN`. Pass each user's token through `X-Valkyr-Token` so api-0 calls stay scoped to that user's RBAC permissions.
