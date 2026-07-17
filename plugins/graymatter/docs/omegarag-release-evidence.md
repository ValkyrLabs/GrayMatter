# OmegaRAG release evidence bundle

`scripts/gm-release-evidence` produces `graymatter-omegarag-release-evidence/v1`, a content-free source-to-installed release artifact for GrayMatter Light, Cloud discovery, the Codex/OpenClaw plugin, and portable MCP contracts.

The generator derives its result from the current package rather than accepting caller-supplied statuses. It binds:

- the Git source revision or installed `.graymatter-source-rev`;
- root, marketplace, ClawHub, and MCP package versions;
- the deterministic `graymatter.skill` SHA-256 when that archive applies;
- the submission-manifest target and root/marketplace checklist parity;
- hashes for the portable MCP, tool, memory, and OmegaRAG agent ABI contracts;
- root/marketplace release-script and policy parity;
- the local, non-mutating agent smoke matrix;
- an unexpired, authenticated production `omegarag-capability-manifest/v1`, projected without tenant names, content, balances, credentials, or provider responses;
- a policy-bound `omegarag-signature-history/v1` proving seven consecutive UTC days of the four Phase 0 signatures in staging and production;
- a production `omegabench-evidence-set/v1` containing public-release-eligible, content-free `omegabench-reproducibility/v1` manifests;
- a scope-bound `omegarag-objective-evidence/v1` proving the security, receipt-lineage, availability, latency, recovery, and deletion gates from authenticated api-0 responses;
- explicit Light, Cloud, and plugin limitations from the versioned release policy.

Without a current production capability manifest, complete signature history, a complete OmegaBench baseline matrix, and a complete objective-evidence bundle, the decision is `HOLD`. A valid capability manifest with any `DEGRADED` or `UNAVAILABLE` capability also remains `HOLD`. The strongest result is `ELIGIBLE_FOR_HUMAN_REVIEW`; `releaseAuthorized`, `claimPromotionAuthorized`, `mergeAuthorized`, and `productionDeploymentAuthorized` always remain false.

## Run from source or an installed cache

```bash
scripts/gm-release-evidence \
  --capability-manifest artifacts/omegarag-capabilities.json \
  --signature-history artifacts/omegarag-signature-history.json \
  --benchmark-evidence artifacts/omegabench-evidence.json \
  --objective-evidence artifacts/omegarag-objective-evidence.json \
  --out artifacts/graymatter-omegarag-release-evidence.json
```

The capability input must be exactly one JSON object, use the canonical manifest version, identify the production environment, include both Light and Cloud distribution profiles, and remain unexpired. Only bounded capability IDs, evidence states, evidence tiers, claim status, degraded reasons, safe next actions, scope hashes, versions, timestamps, counts, and distribution differences enter the output.

The signature-history input is also exactly one JSON object. Each observation uses this content-free shape:

```json
{
  "environment": "staging",
  "observedAt": "2026-07-17T12:00:00Z",
  "capabilityId": "graymatter.receipt.create",
  "passed": true,
  "httpStatus": 204,
  "contractVersion": "omegarag-signature-canary/v1",
  "evidenceRef": "signature-canary/staging/2026-07-17/graymatter.receipt.create",
  "evidenceHash": "64-lowercase-hex-characters",
  "scopeHash": "64-lowercase-hex-characters",
  "authorityHash": "64-lowercase-hex-characters"
}
```

The versioned policy, not caller flags, fixes the required environments, capability IDs, seven-day window, freshness bound, and maximum observation count. Every environment and capability must have at least one passing 2xx observation on each UTC day; any failed observation fails that cell. Scope and authority hashes must remain stable within each environment, and production hashes must match the current production capability manifest. Evidence references and individual observations do not enter the release artifact; it contains only bounded dates, counts, hashes, and coverage status.

Collect one freshly published and manifest-verified report without copying
query or response content into history:

```bash
scripts/graymatter-prod-acceptance.sh \
  --environment staging \
  --publish-capability-evidence \
  --artifact artifacts/staging-canary.json

scripts/gm-signature-history \
  --report artifacts/staging-canary.json \
  --history artifacts/omegarag-signature-history.json \
  --out artifacts/omegarag-signature-history.next.json
```

Omit `--history` for the first collected report.

The collector accepts at most 64 reports per invocation, rejects stale,
unpublished, unverified, relabeled, or extra-field reports, deduplicates exact
report observations, and caps retained observations using the release policy.
Promote the `.next.json` artifact through the normal reviewed artifact flow.

## Collect OmegaBench reproducibility evidence

Run the authenticated ValkyrAI benchmark endpoint and retain its complete
response with the matching licensed corpus package. The GrayMatter collector
accepts either that full report or an extracted `.reproducibilityManifest`; it
copies only the content-free manifest and records a hash of the source artifact.

```bash
scripts/gm-omegabench-evidence \
  --manifest artifacts/omegabench-memory-fixed-hybrid.json \
  --evidence artifacts/omegabench-evidence.json \
  --runtime-revision 0123456789abcdef0123456789abcdef01234567 \
  --out artifacts/omegabench-evidence.next.json \
  --format projection
```

Omit `--evidence` for the first manifest. The release policy requires one
coherent production result for every combination of the `MEMORY`,
`BUSINESS_GRAPH`, `ISOLATION`, `CONTEXT`, and `ECONOMICS` tracks with the six
mandatory reproducible baselines: lexical, vector, fixed hybrid, fixed
one-hop graph, fixed three-hop graph, and the current planner. Within each
track, corpus identity, version, checksum, and seed must remain identical so
the baseline comparison is meaningful.

Every accepted manifest must be `REPRODUCIBLE`, licensed for public use,
non-holdout, checksum-verified, SLO-measured and passing,
confidence-measured, free of missing evidence and release failures, and marked
`publicReleaseEligible`. The matrix must use one production scope and stable
runtime, schema, policy, index-manifest, planner, and graph-policy versions.
Freshness is calculated from api-0's hash-bound `runtimeEvidence.observedAt`,
never the collector clock or a caller-supplied timestamp.
The release generator additionally binds its scope hash to the current
production capability manifest. Missing cells or version/scope drift remain
`HOLD`; callers cannot weaken the matrix through flags.

## Collect security, correctness, and SLO objectives

Fetch the five authenticated, read-only api-0 objective responses for the same
principal and capability manifest. Each response carries the server-derived
`scopeHash`; the collector rejects mixed scopes, stale or non-current-month
evidence, missing security probe classes, non-production latency/recovery
evidence, failed objectives, extra fields, and concatenated JSON.

```bash
scripts/gm-objective-evidence \
  --security artifacts/security-objectives.json \
  --availability artifacts/availability-objectives.json \
  --latency artifacts/latency-objectives.json \
  --recovery artifacts/recovery-objectives.json \
  --deletion artifacts/deletion-slo.json \
  --out artifacts/omegarag-objective-evidence.json \
  --format projection
```

The bundle omits tenant identity, operation IDs, raw probes, queries, content,
and provider details. It retains bounded aggregate counts, objective targets and
observations, categorical coverage, timestamps, scope, and hashes. In
particular, `receipt_trajectory_coverage` must pass in test, staging, and
production; a production capability-scope mismatch remains `HOLD`.

Run the deterministic contract with:

```bash
bash tests/gm_release_evidence_test.sh
```

After a human-approved package release, rerun the generator from the installed cache. Source evidence does not prove the marketplace cache was updated.
