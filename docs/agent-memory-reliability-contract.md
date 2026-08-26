# GrayMatter Agent Memory Reliability Contract

GrayMatter is the primary durable-memory and coordination layer for every
supported agent host. This contract applies equally to Codex, ChatGPT, Claude,
OpenClaw, Pi, and any MCP-compatible harness.

## Required lifecycle

1. Before project work, verify authentication, authorized schema access,
   invariant retrieval, and the local deferred-write spool.
2. Before claiming a durable write succeeded, read it back through the
   authorized API path. A queued write is explicitly degraded, not persisted.
3. On authentication, network, credit, or schema failure, preserve the write
   in the protected local queue; expose the exact failed boundary and continue
   only under the documented degraded policy.
4. Once connectivity returns, replay queued records idempotently, verify each
   accepted record, and retain failed records without duplication or loss.
5. Run the same health contract at install, activation, session startup, and
   recovery. Hosts must not replace it with private memory conventions.

## Identity and recovery

- Core identities are valid without a tenant selection. A tenant-context
  diagnostic is valid only after successful authentication proves that a
  tenant-scoped operation requires one.
- Named profiles require a non-empty account binding. Missing legacy metadata
  must fail closed with a repair path; clients must never look up credentials
  using a synthetic or null account.
- Credentials remain in the platform credential store. No runtime may copy a
  password or token into a repository, log, profile registry, fallback queue,
  or agent prompt.
- If interactive OS unlock is genuinely required, report that exact boundary;
  do not report a misleading tenant or service outage.

## Release acceptance

Every distributed package and MCP entrypoint must ship the same profile,
health, queue, replay, and diagnostic behavior. Package parity tests are a
release gate. A runtime may add ergonomics, but may not weaken this contract.
