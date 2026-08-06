# Local model compatibility

GrayMatter Lite is model-neutral. The local model host and GrayMatter are
separate processes connected by Model Context Protocol (MCP):

```text
Ollama / LM Studio / llama.cpp host
               | MCP
      GrayMatter MCP server
               | api-0-compatible HTTP
      GrayMatter Lite + H2
```

This keeps inference choice independent from durable memory, profiles, and the
authorization boundary.

## HTTP MCP

`./vaix setup` starts the HTTP MCP endpoint at:

```text
http://localhost:3333/mcp
```

Use that URL in a local-model host that supports remote/HTTP MCP. The endpoint
targets the Lite backend with its configured local credentials.

## Stdio MCP

For hosts that start MCP servers as subprocesses, use the absolute path to this
checkout:

```json
{
  "mcpServers": {
    "graymatter": {
      "command": "/absolute/path/to/GrayMatter/scripts/gm-mcp-launcher",
      "args": ["--stdio"],
      "env": {
        "GRAYMATTER_PROFILE": "graymatter-lite-local"
      }
    }
  }
}
```

Register the local profile first with `scripts/gm-profile add-local` or let
`./vaix setup` register it. Restart the MCP subprocess after switching the
active profile. Blended federation is exposed through both `scripts/gm-query`
and MCP memory query/read/health tools. Results remain profile-labeled and
mutating or unsupported MCP tools fail closed until one profile is selected.

## Compatibility contract

A local-model host needs:

- MCP stdio or HTTP support;
- the ability to call typed tools;
- enough context budget to consume the selected memory results.

No OpenAI, Anthropic, or hosted embedding credential is required for Lite's
basic H2 text retrieval. Imported embeddings are never trusted across authority
boundaries and are marked for local regeneration.

Verify the server independently of a model:

```bash
./vaix doctor
curl --fail http://localhost:3333/health
```
