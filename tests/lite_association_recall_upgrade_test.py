#!/usr/bin/env python3
"""Verify association recall across a populated v4→graph→v4→graph file-H2 upgrade.

Both arguments are immutable snapshots before launch. Four local JVMs use one
isolated database, synthetic inputs, and fresh Basic credentials. No configured
model, host credential, or external service is used. The older JAR must support
identity associations and v4 receipts but predate association-assisted recall.
"""
import argparse
from contextlib import contextmanager
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


def check(before, after, java, logs=None):
    query = dict(query="Aster courier", source="native-upgrade", retrievalMode="KEYWORD", topK=1, tokenBudget=1024)
    api = "graymatter/retrieval-context"
    edges = "graymatter/memory/associations"
    audit = lambda receipt: "graymatter-retrieval-receipts/" + receipt["receiptId"]
    hydrate = lambda receipt, memory: api + "/" + receipt["receiptId"] + "/hydrate/" + memory["id"]
    with tempfile.TemporaryDirectory(prefix="gm-association-recall-upgrade-") as directory:
        path = Path(directory)
        snapshots = [path / "before.jar", path / "after.jar"]
        for source, snapshot in zip((before, after), snapshots):
            shutil.copyfile(source, snapshot)
        report = dict(beforeJarSha256=sha256(snapshots[0]), afterJarSha256=sha256(snapshots[1]))
        password = secrets.token_urlsafe(32)

        @contextmanager
        def stage(jar, name):
            try:
                with runtime(jar, java, path, password) as http:
                    yield http
            finally:
                if logs and (path / "boot.log").exists():
                    shutil.copyfile(path / "boot.log", logs / (name + ".log"))

        with stage(snapshots[0], "before") as http:
            sources = [http("MemoryEntry/write", dict(text=text, type="context", sourceChannel=query["source"]))
                       for text in ["Aster courier manifest.", "Courier pickup code is P7."]]
            anchor, neighbor = sources
            pair = dict(fromId=anchor["id"], toId=neighbor["id"], relation="supersedes")
            http(edges, pair, expected=201)
            edge = http(edges, pair)
            ordinary = http(api, query)
            assert ordinary["retrievalStatus"] == "OK"
            assert [item["memoryId"] for item in ordinary["items"]] == [anchor["id"]]
            old_audit, old_hydration = http(audit(ordinary)), http(hydrate(ordinary, anchor))
            assert old_audit["policyVersion"] == "bifrost-lite-context/v4"
            assert not old_audit.get("associationPolicyVersion")

        with stage(snapshots[1], "upgrade") as http:
            current = http(audit(ordinary))
            assert all(current[key] == value for key, value in old_audit.items())
            assert current["associationRefs"] == [] and current["associationTruncated"] is False
            assert "associationPolicyVersion" not in current
            assert http(hydrate(ordinary, anchor)) == old_hydration
            graph = http(api, dict(query, includeAssociations=True))
            assert graph["retrievalStatus"] == "OK"
            assert [item["memoryId"] for item in graph["items"]] == [anchor["id"], neighbor["id"]]
            assert graph["associationPolicyVersion"] == "graymatter-association-recall/v1"
            assert graph["associationRefs"][0]["associationRef"] == edge["associationRef"]
            child = http(api + "/" + graph["receiptId"] + "/recompress", dict(query=query["query"]))
            assert child["associationRefs"] == graph["associationRefs"] and child["retrievalStatus"] == "OK"
            assert http(hydrate(graph, neighbor))["sourceHash"] == neighbor["sourceHash"]

        with stage(snapshots[0], "downgrade") as http:
            downgraded = http(audit(graph))
            assert downgraded["recordedRetrievalStatus"] == "OK"
            assert downgraded["retrievalStatus"] == "RETRY_REQUIRED"
            http(hydrate(graph, neighbor), expected=409)
            http(api + "/" + graph["receiptId"] + "/recompress", dict(query=query["query"]), expected=409)
            assert http(audit(ordinary))["retrievalStatus"] == "OK"

        with stage(snapshots[1], "reupgrade") as http:
            restored = http(audit(graph))
            assert restored["retrievalStatus"] == "OK" and restored["associationRefs"] == graph["associationRefs"]
            assert http(audit(child))["associationRefs"] == child["associationRefs"]
            assert http(hydrate(graph, neighbor))["sourceHash"] == neighbor["sourceHash"]
            updated = http("graymatter/memory/" + anchor["id"] + "/revise",
                           dict(expectedSourceHash=anchor["sourceHash"], text="Aster courier updated manifest."))
            stale = http(audit(graph))
            assert stale["retrievalStatus"] == "STALE_CONTEXT" and stale["associationRefs"] == []
            assert http(audit(child))["retrievalStatus"] == "STALE_CONTEXT"
            http(hydrate(graph, neighbor), expected=409)
            assert http(edges + "/" + edge["associationRef"])["associationRef"] == edge["associationRef"]
            refreshed = http(api + "/" + graph["receiptId"] + "/refresh", dict(query, includeAssociations=True))
            assert refreshed["retrievalStatus"] == "OK"
            assert refreshed["associationRefs"][0]["anchorSourceHash"] == updated["sourceHash"]
            assert refreshed["associationRefs"][0]["anchorSourceHash"] != graph["associationRefs"][0]["anchorSourceHash"]
            http("graymatter/memory/" + anchor["id"] + "/forget",
                 dict(expectedSourceHash=updated["sourceHash"], confirmed=True), expected=204)
            http(edges + "/" + edge["associationRef"], expected=404)
            deleted = http(audit(refreshed))
            assert deleted["retrievalStatus"] == "STALE_CONTEXT" and deleted["associationRefs"] == []
            http(hydrate(refreshed, neighbor), expected=409)

    report.update(
        passed=True,
        javaVersion=subprocess.run([java, "-version"], check=True, capture_output=True, text=True).stderr.splitlines(),
        runtime="Four sequential local JVMs; same populated file H2; authenticated loopback HTTP; no external services",
        originalMemoryIds=[entry["id"] for entry in sources], originalReceiptId=ordinary["receiptId"],
        graphReceiptId=graph["receiptId"], childReceiptId=child["receiptId"], associationRef=edge["associationRef"],
        originalReceiptPreserved=True, originalHydrationPreserved=True, graphReceiptAndProofsSurviveRestart=True,
        oldBinaryGraphStatus=downgraded["retrievalStatus"], oldBinaryHydration=409, oldBinaryRecompress=409,
        correctionGraphStatus=stale["retrievalStatus"], correctionKeepsIdentityLink=True,
        refreshGraphStatus=refreshed["retrievalStatus"], deletedGraphStatus=deleted["retrievalStatus"],
        deletedEdgeGet=404, unchangedNeighborHydrationThroughStaleReceipt=409,
        limits="Synthetic two-record fixture proves migration/restart/downgrade authority behavior, not recall quality or hosted parity",
    )
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("before", type=Path)
    parser.add_argument("after", type=Path)
    parser.add_argument("--java", default="java")
    parser.add_argument("--logs", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.logs:
        args.logs.mkdir(parents=True, exist_ok=True)
    report = check(args.before.resolve(strict=True), args.after.resolve(strict=True), args.java, args.logs)
    report["runnerSha256"] = sha256(Path(__file__))
    report["invocation"] = ["python3", "tests/lite_association_recall_upgrade_test.py", str(args.before), str(args.after), "--java", args.java]
    content = json.dumps(report, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(content)
    print(content, end="")
