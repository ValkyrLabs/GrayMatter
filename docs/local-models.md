# Local model compatibility

GrayMatter Lite is model-neutral. A local model host, Valkyr SWARM, and
GrayMatter are separate processes connected through two deliberately distinct
MCP boundaries:

```text
                 ValkyrAI signed Workflow package
                               |
                    Valkyr SWARM MCP server
                registration | workflow coordination
                               |
                 LM Studio / Ollama local inference
                               |
                      GrayMatter MCP server
                  memory | context | durable evidence
                               |
                    GrayMatter Cloud or Lite
```

The Valkyr SWARM MCP owns node registration, heartbeats, exact-target command
routing, signed Workflow delivery, leases, fences, and lifecycle coordination.
The GrayMatter MCP owns authorized memory, bounded context, object-graph access,
and durable execution evidence. GrayMatter is not a scheduler, command bus, or
hot execution journal. A node may keep a narrow encrypted local journal for
restart recovery, then persist only bounded checkpoints, artifacts, approvals,
and terminal receipts to GrayMatter.

## Node classes

SWARM distinguishes two node classes and fails closed across their boundary:

- `agentic-runtime` nodes such as ValorIDE and OpenClaw may execute only the
  native SWARM capabilities they explicitly advertise. They may also host the
  signed Workflow engine when they advertise its exact capability.
- `model-only` nodes backed by LM Studio or Ollama are inference workers,
  not general-purpose agents. They accept only a signed, immutable ValkyrAI
  Workflow execution envelope, expose no native command capabilities, and
  cannot become arbitrary shell, browser, file, or outbound-message runners.

Both classes use the same provider-neutral Workflow and durable receipt
contracts. A model-only node never interprets an ordinary SWARM command as an
instruction to execute local tools.

The versioned durable evidence contract is
[`graymatter_swarm_workflow_execution_receipt_v1.schema.json`](../references/contracts/swarm/graymatter_swarm_workflow_execution_receipt_v1.schema.json),
with a non-secret
[`model-only` example](../examples/swarm-workflow-execution-receipt.v1.json).
It links the origin intent, Workflow package and version, signed execution
envelope digest, node class and identity, provider/model, bounded checkpoints,
artifacts, approval references, terminal outcome, and replay state. The
contract deliberately stores references and digests instead of prompt bodies,
credentials, tenant identifiers supplied by clients, or local journal data.

## HTTP MCP

`./vaix setup` starts the HTTP MCP endpoint at:

```text
http://localhost:3333/mcp
```

Use that URL for the GrayMatter memory/context/evidence MCP connection. Configure
the peer Valkyr SWARM MCP separately when the host should register as a node and
execute signed remote Workflows. The GrayMatter endpoint targets the Lite
backend with its configured local credentials; connecting it alone never
registers the model as a SWARM node.

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

To become a `model-only` node, it additionally needs the Valkyr SWARM MCP,
successful tenant-scoped activation, a healthy loopback LM Studio or Ollama
provider probe, and the signed Workflow engine capability. Registration must
advertise `signed-workflow-only` and an empty native-capability set.

No OpenAI, Anthropic, or hosted embedding credential is required for Lite's
basic H2 text retrieval. Imported embeddings are never trusted across authority
boundaries and are marked for local regeneration.

Verify the server independently of a model:

```bash
./vaix doctor
curl --fail http://localhost:3333/health
```
