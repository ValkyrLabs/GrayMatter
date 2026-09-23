# OmegaRAG PRD inventory

`scripts/gm-prd-inventory` derives a deterministic machine-readable inventory directly from the canonical `docs/prd-graymatter-omegarag.md` requirement tables.

The inventory is deliberately not a ticket board or implementation-status ledger. It contains requirement IDs, families, priorities, source lines, and SHA-256 commitments to each requirement and acceptance-evidence cell. Any text, priority, ID, ordering, duplicate, missing evidence cell, or source-file change alters or invalidates the artifact.

The current canonical PRD contains 128 requirements: 57 P0, 57 P1, and 14 P2. The 114 P0/P1 requirements are the population governed by the GA Definition of Done; this inventory proves which requirements that aggregate refers to without claiming that any requirement is implemented or live verified.

The checked-in `references/contracts/release/graymatter_omegarag_prd_inventory_v1.json` is the packaged canonical projection. The release policy pins its source, requirement-set, and inventory hashes; source tests require byte-for-byte parity with a fresh derivation before the standalone or marketplace package can pass.

Generate an inventory:

```bash
scripts/gm-prd-inventory --out artifacts/omegarag/prd-inventory.json
```

Validate an existing artifact against the current canonical PRD:

```bash
scripts/gm-prd-inventory \
  --validate artifacts/omegarag/prd-inventory.json \
  --format projection
```

Validation fails when the artifact is malformed, its self-hash is wrong, it contains duplicate IDs, a requirement row is incomplete, or its canonical projection no longer matches the PRD. The artifact carries no completion state and grants no claim, merge, release, or deployment authority.
