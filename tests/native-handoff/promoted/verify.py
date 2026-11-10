#!/usr/bin/env python3
"""Rebuild all invoice expectations and reconcile the H2 witness without the JVM."""

import hashlib
import json
from pathlib import Path
import sys
from uuid import UUID


def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def report_digest(ordinal):
    def uid(family, row):
        return str(UUID(int=((0x076A000000000000 + family + ordinal) << 64) + row + 1))

    customers = [uid(1, n) for n in range(1 + ordinal % 6)]
    invoices = [
        (uid(2, n), uid(3, n) if (n + ordinal) % (2 + ordinal % 4) == 0 else customers[n % len(customers)])
        for n in range(2 + ordinal % 11)
    ]
    missing = [i for i, c in invoices if c not in customers]
    snapshot = "invoice-customer-reconciliation/v1" + "".join(f"I{i}{c}" for i, c in invoices)
    snapshot += "".join(f"C{c}" for c in customers)
    result = {
        "customerCount": len(customers), "invoiceCount": len(invoices),
        "matchedCount": len(invoices) - len(missing), "snapshotRef": "sha256:" + sha(snapshot),
        "unmatchedCount": len(missing), "unmatchedInvoiceIds": missing,
    }
    return sha(json.dumps(result, sort_keys=True, separators=(",", ":")))


def verify(path):
    data = json.loads(path.read_text())
    expected = [report_digest(n) for n in range(96)]
    if len(set(expected)) != 96 or sha("|".join(expected)) != data["frozenExpectedDigest"]:
        raise ValueError("Generated population conflicts with the frozen expectations")
    sources = data["sources"]
    if len(sources) != 96 or [x["ordinal"] for x in sources] != list(range(96)):
        raise ValueError("Missing or repeated source input")
    for source, checksum in zip(sources, expected):
        if checksum != source["expectedReportSha256"] or checksum != source["actualReportSha256"]:
            raise ValueError(f"Incorrect report at source ordinal {source['ordinal']}")
    by_ref = {s["capsuleRef"]: s for s in sources}
    train = set(data["trainingCapsules"])
    holdout = set(data["holdoutCapsules"])
    pairs = data["pairs"]
    actual_pairs = {p["baselineCapsuleRef"] for p in pairs}
    if len(train) != 76 or len(holdout) != 20 or train & holdout or train | holdout != by_ref.keys():
        raise ValueError("Compiler split does not partition the source capsules")
    if len(pairs) != 20 or actual_pairs != holdout:
        raise ValueError("Replay histories do not reconcile to all 20 frozen fixtures")
    source_runs = {UUID(x["executionId"]) for x in sources}
    replay_runs = {UUID(p["compiledExecutionId"]) for p in pairs}
    if len(source_runs) != 96 or len(replay_runs) != 20 or source_runs & replay_runs:
        raise ValueError("Workflow runs repeat across source and candidate samples")
    for field in ("routeReceiptRef", "replayRef", "taskDigest"):
        if len({p[field] for p in pairs}) != 20:
            raise ValueError(f"Duplicate replay evidence for {field}")
    for pair in pairs:
        expected = by_ref[pair["baselineCapsuleRef"]]["expectedReportSha256"]
        if expected != pair["actualReportSha256"] or expected != pair["expectedReportSha256"]:
            raise ValueError("Candidate report differs from frozen task")
        if pair["baselineScore"] != pair["candidateScore"]:
            raise ValueError("Observed score differs from the recorded tie")
    if data["promotionAllowed"] or data["candidateStatus"] != "shadow":
        raise ValueError("Unexpected release of the tied candidate")
    if "fail:minimum_overall_score_delta" not in data["guardrails"]:
        raise ValueError("The expected release guardrail is missing")
    print("96 source reports and all 20 independent replay executions reconciled. Candidate remains SHADOW.")


if __name__ == "__main__":
    verify(Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).with_name("observed.json"))
