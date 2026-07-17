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
- explicit Light, Cloud, and plugin limitations from the versioned release policy.

Without both a current production capability manifest and complete signature history, the decision is `HOLD`. A valid manifest with any `DEGRADED` or `UNAVAILABLE` capability also remains `HOLD`. The strongest result is `ELIGIBLE_FOR_HUMAN_REVIEW`; `releaseAuthorized`, `claimPromotionAuthorized`, `mergeAuthorized`, and `productionDeploymentAuthorized` always remain false.

## Run from source or an installed cache

```bash
scripts/gm-release-evidence \
  --capability-manifest artifacts/omegarag-capabilities.json \
  --signature-history artifacts/omegarag-signature-history.json \
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

Run the deterministic contract with:

```bash
bash tests/gm_release_evidence_test.sh
```

After a human-approved package release, rerun the generator from the installed cache. Source evidence does not prove the marketplace cache was updated.
