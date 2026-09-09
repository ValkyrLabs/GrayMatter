# Retrieval coverage and contribution evidence

GrayMatter capture, discovery, declared reuse, and measured impact are different
things. An entry count or successful write readback is not a productivity metric.

## Complete discovery, bounded output

`gm-invariant-preflight` and the MCP preflight scan paginated, authenticated
MemoryEntry results before ranking. They request 100 rows per page, tolerate
smaller server page caps, deduplicate IDs, and detect non-advancing pagination.
They stop at an explicit last page or empty page, with a default budget of 100
pages / 60 seconds between request windows. Up to four read-only page requests
run concurrently; results are consumed in page order. `requestedPages` includes
speculative requests past the first empty page, whose rows are never returned.
This is a best-effort paginated read, not a transactional
snapshot while other users are writing.

Inspect `coverage.complete`, `coverage.reason`, `matchingInvariants`, and
`omittedInvariants`. `--limit` controls output, not scan coverage. The CLI returns
exit 2 when coverage or the displayed invariant set is incomplete. Increase the
output limit when needed; do not interpret a bounded shortlist as all rules.
CLI scan budgets can be set using `GRAYMATTER_SCAN_MAX_PAGES` (1–1000) and
`GRAYMATTER_SCAN_MAX_MS` (1–300000) and `GRAYMATTER_SCAN_CONCURRENCY` (1–4).
In-flight calls retain their transport timeout. No owner/tenant filters are invented by clients.

Empty semantic results and embedding-quota failures trigger paginated lexical
discovery. This fallback is labeled; lexical matches are not semantic similarity
scores. Shell fallback preserves the result-array contract, reports coverage on
stderr, and exits 2 on partial coverage. Set `GRAYMATTER_QUERY_EMPTY_FALLBACK=false`
to explicitly disable empty-result fallback. Nonempty semantic queries do not
incur a collection scan.

Only explicit lifecycle metadata (trashed, supersededByRef, retracted/superseded
status or lifecycle tags) suppresses an obsolete entry. Prose saying “supersedes”
is not sufficient to mutate or silently suppress another rule. Use governed
temporal supersession/review to resolve a conflict, preserving its predecessor.

## Task and artifact attribution

Use canonical fields rather than putting metadata in memory text:

```sh
scripts/gm-write decision 'Use the canonical ACL-aware graph reader.' \
  --workspace-key GrayMatter --chat-key TASK_REFERENCE \
  --source-message-id TASK_REFERENCE \
  --source-url https://github.com/OWNER/REPOSITORY/commit/COMMIT
```

The MCP `memory_write` accepts `sourceMessageId` and `sourceUrl`; `chatKey` or
`sessionKey` supplies the message reference if it is not explicit. These are
external provenance references, not generated Task/Run IDs or authorization.
The companion api-0 repair persists and returns them. Older servers may ignore
these fields: verify the returned ID and provenance after write. Never claim
they persisted solely because POST succeeded.

Existing generated Task/Run/Project/Application links are projected as ID-only
references after current schema visibility and each target's generated ACL are
checked. Hidden links stay absent. This does not auto-create relationships for
older records. For new governed relationships use `omega_remember.objectLinks`;
the existing server-owned resolver decides whether a link is attached or remains
a candidate. Generic memory writes cannot grant relationship authority.

## Read verification is not reuse

```sh
scripts/gm-read MEMORY_ID --purpose write_verification --task-ref TASK_REFERENCE
scripts/gm-read OLDER_MEMORY_ID --purpose reuse --task-ref LATER_TASK_REFERENCE
```

The JSON result includes `graymatterReadObservation`, with a unique observation
ID. The same options exist on MCP `memory_read`. These observations remain in the
calling execution trace; the read operation does not silently write a telemetry
record. Omitted purpose remains unclassified/inspection, not assumed reuse.

## Evidence chain report

Use a receipt-backed retrieval (`omega_recall` / `graymatter_omega_query`) and
retain its trajectory. Once the work has actually completed, use `omega_outcome`
to persist content-free `actionRef` (decision/action), `outcomeRef` (artifact),
`testRef` (verification), outcome, and optional workflow execution reference.
The existing server checks trajectory access and handles idempotent outcome
replay. Do not invent references or label an unrun test successful.

`memory_contribution_report` accepts up to 25 trajectory IDs and 200 explicit
read observations. It rereads each authorized trajectory and presents:

`retrieval receipt → evidence references → decision/action → artifact → test/outcome`

The CLI uses the same report engine:

```sh
scripts/gm-contribution-report TRAJECTORY_ID
# Or pipe a JSON object containing trajectoryIds and observations to stdin.
```

Observation IDs are deduplicated; conflicting purposes for the same observation
fail. Counts distinguish inspection, write verification, and caller-declared reuse.
Missing observations remain unknown. A linked chain means stored references are
present—not that artifact content, influence, or causality was independently
verified. Reports deliberately leave time, token, cost, and defect savings null.
Quantifying those requires baseline/matched-task measurements and source-backed
outcome verification. This report is the evidence layer, not a causal dashboard.
