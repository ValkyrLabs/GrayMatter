# Invoke a validated procedure from an agent

Source-only private adapter. It uses the existing authenticated GrayMatter transport and ValkyrAI SkillOptics runtime. It is not registered in the marketplace MCP catalog or included in the frozen release archive yet. A schema endpoint being available does not prove that this account has an applicable promoted procedure or permission to execute it.

An authorized agent can submit a task from the GrayMatter checkout:

```sh
scripts/gm-procedure-execute execute < task.json
```

First, discover candidate procedures through the same private adapter:

```sh
scripts/gm-procedure-execute search < search.json
```

```json
{ "query": "reconciliation", "limit": 10, "offset": 0, "enabledOnly": true, "minimumConfidence": 0.5 }
```

Search uses case-insensitive substring matching across bounded names, descriptions, references and task types returned by the generated authorized Procedure list. It continues past short pages, requires an explicit empty end page for complete coverage, deduplicates canonical UUIDs and reports overlap as incomplete. Defaults allow ten pages of 100 rows and a 15-second scan budget. Operators may set `GRAYMATTER_PROCEDURE_SCAN_MAX_PAGES` (1–100) or `GRAYMATTER_PROCEDURE_SCAN_MAX_MS` (1–300000); the transport receives the remaining time budget for each request, capped by its existing 65-second request timeout. No retry or write occurs.

Results contain bounded candidate summaries, observed match count and coverage. Descriptions are limited to 512 characters with a truncation flag; metadata, contraindication blobs, owner fields and raw evidence are omitted. These summaries are not complete execution contracts. `enabledOnly` requires explicit `true`, but enabled/confident does not prove an active compatible binding or permission to execute. Disabled or shadow records can be inspected with `enabledOnly:false`; discovery never promotes them.

`status:complete` means this best-effort authorized list scan reached its observed end. It is not an atomic snapshot, semantic-search completeness, or a guarantee that execution will still be permitted. `status:partial` means more candidates may exist; an empty partial result must not be interpreted as absence. `hasMore` is null when coverage is partial and no additional match is known. A non-null `nextOffset` is supplied only when another observed match exists; offsets apply after matching, and repeated calls can see a changed collection. Later 401/403 responses discard all partial results and return a sanitized `PROCEDURE_SEARCH_UNAVAILABLE` error. Current server execution checks remain authoritative.

This private discovery helper is ready for later integration into public `procedure_search`; the reviewer-frozen public handler still has its original first-page behavior. No public catalog, scope, manifest or archive change is implied by the private CLI.

Inspect the selected Procedure by its returned UUID before preparing business inputs:

```sh
scripts/gm-procedure-execute inspect <procedure-uuid>
```

Inspection makes one generated `GET /Procedure/{id}` and requires an HTTP 200 receipt, an exact matching identity and a response within the 15-second transport timeout. The result includes the same minimized summary, the compiler receipt reference, and a bounded projection of the existing `metadataJson.procedureContract`: version, required input keys, input types, aliases and object references. Optional maps use the canonical empty-map defaults. Metadata is limited to 64 KiB with the existing plain-JSON byte/node/depth bounds; declarations are limited to 50 required keys or map entries and 20 aliases per key. Declarations must be reference-shaped strings. These conservative client limits may exclude a larger server-valid contract.

`inputContract.status:available` means the declarations were projected, including for disabled or shadow Procedures. `unavailable` includes a content-free reason for missing, unsupported, malformed or unprojectable metadata; it never invents an empty contract for a legacy Procedure. Inspection omits arbitrary metadata, policy text, contraindications and evidence. Unknown contract fields are not interpreted as permissions or side-effect guarantees.

The Procedure's version and hashes are references read from that record. `workflowVersionValidation:not_checked` and `launchInputSchema.status:not_retrieved` make that boundary explicit: the current live 0.9.27 schema has no exposed WorkflowVersion read path, and the adapter does not synthesize a nested input schema. Server routing must still validate the current exact version, inputs and authority. A top-level `task:object` declaration alone does not explain or validate its nested business fields. If those fields are unavailable, use the canonical Workflow review path before relying on the capability. `PROCEDURE_INSPECTION_UNAVAILABLE` reports an unverified read with no partial result; it does not assert that the object does not exist.

Example `task.json` (replace the hint and business inputs with the selected procedure's contract):

```json
{
  "taskType": "workflow",
  "traceId": "reconcile-case-42-v1",
  "procedureHints": ["reconciliation"],
  "inputs": { "caseRef": "case-42" }
}
```

Use a stable trace ID for one logical task. It must be 1–128 characters, start with a letter or digit, and contain only letters, digits, `.`, `_`, `:`, `/` or `-`. Never generate a fresh ID simply because a request timed out. Retry the same ID with unchanged inputs, including `taskId` when present. The server owns exact-artifact idempotency and conflict detection; the client does not promise exactly-once effects in an external system.

The request requires `taskType`, `traceId` and an `inputs` object. `taskType` uses the live SkillOptTaskType enum, including `procedure`, `workflow` and `validation`. Optional `applicationId`, `projectId` and `contextPageId` are UUID references resolved by the server; optional `procedureHints` contains at most 25 reference-shaped hints. The complete request is limited to 64 KiB, 10,000 values and 16 levels of nesting. Unknown request fields, identity/policy overrides, prototype keys and runtime-owned `_skillOpt*`/`_workflowExecutionRef` inputs are rejected before transport. Ordinary business fields remain subject to the selected procedure's input contract and generated authorization.

Interpret the JSON result:

| Result | Meaning | Next step |
| --- | --- | --- |
| `procedure_started` | The server returned an exact procedure version and execution. | Read its state by the returned `workflow.id`. Acceptance alone is not success. |
| `fallback_required` | No suitable deterministic execution was started. | Use the explicit fallback route through the caller's existing authorized process. This client launches no agent. |
| `blocked` | Policy, credits or approval prevented dispatch. | Follow the canonical policy/approval flow. A returned route is not approval. |
| `DISPATCH_OUTCOME_UNKNOWN` error | The response or transport could not establish the result. | Inspect a known execution or retry the same logical task and unchanged inputs. Do not assume nothing ran. |

Read an exact execution:

```sh
scripts/gm-procedure-execute status <workflow-execution-uuid>
```

This makes one generated ACL-checked GET and validates the returned ID. It exposes `state`, `terminal` and `succeeded`, without workflow inputs, logs, stack traces, credentials or arbitrary server explanation text. `SUCCESS` is the only successful terminal state; `FAILED`, `CANCELLED` and `TIMEOUT` are terminal failures. Waiting, paused and quarantined states are not completion. This projection reports the server's execution state; independently verifying a business artifact remains a separate check.

The command returns exit code 0 for a verified typed result, including blocked/fallback. Consumers must inspect the JSON status. Invalid input, unavailable status and unverified dispatch return exit code 1 with a content-free JSON error on stderr. No partial result is emitted as success.

Authentication, profiles and generated ACLs use `scripts/graymatter_api.sh`. The client disables self-update, deferred writes and automatic replay for this action boundary, and adds no retry loop or model calls. Keep credentials in the existing credential vault; pass business parameters and secured record references, not credentials. This adapter inherits the shared transport's process-local request handling.

Pending product proof: public discovery integration and private MCP registration after the reviewer freeze, packaged/installed mirror parity, authenticated execution and isolation canaries, arbitrary trace ingestion, held-out procedure validation, independent agent discovery/reuse and measured lifetime cost. This adapter alone does not establish those outcomes or token savings.
