#!/usr/bin/env python3
"""Upgrade a populated legacy Lite H2 file, then verify authenticated association lifecycle."""
import argparse
import hashlib
import json
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile

from lite_receipt_upgrade_test import runtime


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def check(before, after, java, logs):
    base = "graymatter/memory/associations"
    report = {}
    with tempfile.TemporaryDirectory(prefix="gm-association-upgrade-") as directory:
        path = Path(directory)
        snapshots = [path / "before.jar", path / "after.jar"]
        for source, snapshot in zip((before, after), snapshots):
            shutil.copyfile(source, snapshot)
        report["beforeJarSha256"], report["afterJarSha256"] = map(sha256, snapshots)
        password = secrets.token_urlsafe(24)
        with runtime(snapshots[0], java, path, password) as http:
            http(base + "/capabilities", expected=404)
            created = [http("MemoryEntry/write", dict(text="Migration ledger " + fact, sourceChannel="association-upgrade"))
                       for fact in ("uses the blue folder.", "has two reviewers.", "requires an owner signature.")]
            ids = [row["id"] for row in created]
            originals = [http("graymatter/memory/" + ref) for ref in ids]
            context = http("graymatter/retrieval-context",
                           dict(query="Migration ledger", source="association-upgrade", retrievalMode="KEYWORD", topK=3))
            assert context["retrievalStatus"] == "OK" and context["answerPolicy"] == "ALLOW_ANSWER"
            assert {row["memoryId"] for row in context["items"]} == set(ids)
            audit_path = "graymatter-retrieval-receipts/" + context["receiptId"]
            audit = http(audit_path)
            hydration_path = f"graymatter/retrieval-context/{context['receiptId']}/hydrate/{ids[0]}"
            hydration = http(hydration_path)
            assert hydration["sourceHash"] == originals[0]["sourceHash"]
        if logs:
            shutil.copyfile(path / "boot.log", logs / "before.log")

        with runtime(snapshots[1], java, path, password) as http:
            capability = http(base + "/capabilities")
            assert capability["supported"] and capability["cascadeDelete"]
            assert [http("graymatter/memory/" + ref) for ref in ids] == originals
            assert http(audit_path) == audit and http(hydration_path) == hydration
            pairs = [dict(fromId=ids[a], toId=ids[b], relation="upgrade_navigation")
                     for a, b in [(0, 1), (1, 0), (1, 2)]]
            edges = []
            for pair in pairs:
                http(base, pair, expected=201)
                edge = http(base, pair)
                assert edge["replayed"] and http(base + "/" + edge["associationRef"]) == edge
                edges.append(edge)
            assert http(audit_path) == audit
        if logs:
            shutil.copyfile(path / "boot.log", logs / "upgraded.log")

        with runtime(snapshots[1], java, path, password) as http:
            assert [http("graymatter/memory/" + ref) for ref in ids] == originals
            assert http(audit_path) == audit and http(hydration_path) == hydration
            for pair, edge in zip(pairs, edges):
                assert http(base, pair) == edge and http(base + "/" + edge["associationRef"]) == edge
            http("graymatter/memory/" + ids[0] + "/forget",
                 dict(expectedSourceHash=originals[0]["sourceHash"], confirmed=True), expected=204)
            http("graymatter/memory/" + ids[0], expected=404)
            for pair, edge in zip(pairs[:2], edges[:2]):
                http(base + "/" + edge["associationRef"], expected=404)
                http(base, pair, expected=404)
            assert http(base + "/" + edges[2]["associationRef"]) == edges[2]
            assert [http("graymatter/memory/" + ref) for ref in ids[1:]] == originals[1:]
            stale = http(audit_path)
            assert stale["recordedRetrievalStatus"] == "OK" and stale["retrievalStatus"] == "STALE_CONTEXT"
            http(hydration_path, expected=404)
            http(f"graymatter/retrieval-context/{context['receiptId']}/hydrate/{ids[1]}", expected=409)
        if logs:
            shutil.copyfile(path / "boot.log", logs / "upgraded-restart.log")

    report.update(
        passed=True, runtime="File-based H2, three sequential local JVMs, authenticated HTTP",
        javaVersion=subprocess.run([java, "-version"], check=True, capture_output=True, text=True).stderr.strip().splitlines(),
        originalMemoryIds=ids, originalSourceHashes=[row["sourceHash"] for row in originals],
        originalReceiptId=audit["receiptId"], originalReceiptPolicy=audit["policyVersion"],
        originalMemorySnapshotsPreserved=True, originalReceiptAuditPreserved=True, originalHydrationPreserved=True,
        freshAssociationsCreated=3, associationReceiptsPreservedAfterUpgradeRestart=True,
        deletedIncidentReceiptStatuses=[404, 404], deletedIncidentReplayStatuses=[404, 404],
        unaffectedAssociationReadStatus=200, remainingOriginalEntries=2,
        originalReceiptAfterDelete=stale["retrievalStatus"], deletedSourceHydrationAfterDelete=404,
        remainingSourceHydrationThroughStaleReceipt=409,
        baselineAssociationCapabilityStatus=404, upgradedCapability=capability,
        associationRefs=[edge["associationRef"] for edge in edges],
        scope="One populated legacy Lite H2 schema and the exact recorded JAR pair. All fixtures and mutations use HTTP.",
    )
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("before", type=Path)
    parser.add_argument("after", type=Path)
    parser.add_argument("--java", default="java")
    parser.add_argument("--logs", type=Path)
    args = parser.parse_args()
    if args.logs:
        args.logs.mkdir(parents=True, exist_ok=True)
    print(json.dumps(check(args.before.resolve(strict=True), args.after.resolve(strict=True), args.java, args.logs), indent=2))
