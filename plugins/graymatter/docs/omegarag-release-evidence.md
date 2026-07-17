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
- an optional unexpired, authenticated `omegarag-capability-manifest/v1`, projected without tenant names, content, balances, credentials, or provider responses;
- explicit Light, Cloud, and plugin limitations from the versioned release policy.

Without a current capability manifest the decision is `HOLD`. A valid manifest with any `DEGRADED` or `UNAVAILABLE` capability also remains `HOLD`. The strongest result is `ELIGIBLE_FOR_HUMAN_REVIEW`; `releaseAuthorized`, `claimPromotionAuthorized`, `mergeAuthorized`, and `productionDeploymentAuthorized` always remain false.

## Run from source or an installed cache

```bash
scripts/gm-release-evidence \
  --capability-manifest artifacts/omegarag-capabilities.json \
  --out artifacts/graymatter-omegarag-release-evidence.json
```

The capability input must be exactly one JSON object, use the canonical manifest version, include both Light and Cloud distribution profiles, and remain unexpired. Only bounded capability IDs, evidence states, evidence tiers, claim status, degraded reasons, safe next actions, scope hashes, versions, timestamps, counts, and distribution differences enter the output.

Run the deterministic contract with:

```bash
bash tests/gm_release_evidence_test.sh
```

After a human-approved package release, rerun the generator from the installed cache. Source evidence does not prove the marketplace cache was updated.
