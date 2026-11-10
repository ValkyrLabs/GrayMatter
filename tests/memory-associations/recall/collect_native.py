#!/usr/bin/env python3
"""Collect only a completed canonical native recall run; never infer a pass."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET

SUITE = "com.valkyrlabs.valkyrai.graymatter.memory.NativeMemoryAssociationRecallJpaTest"
METHODS = {
    "nativeRecallRechecksSourceAuthorityAndDurableProofOnEveryConsumer",
    "populatedOrdinaryReceiptSurvivesActualAdditiveSchemaUpgrade",
    "sourceCorrectionBetweenRealDiscoveryAndBindingRollsBackReceipt",
    "generatedSemanticCachesHaveNoRawIngress",
}
CHECKS = {
    "runtime-origins", "route-page-locator", "native-positive",
    "new-edge-within-admitted-pool", "source-read-revoked", "anchor-corrected",
    "receipt-body-fault", "missing-proof-fault", "outside-original-pool-boundary",
    "semantic-cache-ingress", "correction-before-binding-race",
    "selected-source-without-anchor-corrected", "selected-nonanchor-read-revoked",
    "populated-compatible-upgrade",
}


def file_ref(path):
    return {"path": str(path.resolve()), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def collect(args):
    log = args.log.read_text()
    if "BUILD SUCCESS" not in log or "BUILD FAILURE" in log:
        raise ValueError("Canonical command did not complete successfully")
    commands = [re.sub(r"\x1b\[[0-9;]*m", "", line).strip()
                for line in log.splitlines() if "Running: mvn " in line]
    if len(commands) != 1:
        raise ValueError("Require one canonical command log, not concatenated runs")
    if "test-compile surefire:test@default-test" not in commands[0]:
        raise ValueError("Unexpected canonical execution contract")
    root = ET.parse(args.report).getroot()
    counts = {key: int(root.attrib[key]) for key in ("tests", "failures", "errors", "skipped")}
    cases = root.findall("testcase")
    if root.attrib.get("name") != SUITE or {case.attrib["name"] for case in cases} != METHODS:
        raise ValueError("Native report must contain exactly the four owning methods")
    if counts != {"tests": 4, "failures": 0, "errors": 0, "skipped": 0}:
        raise ValueError("Native tests are not all passing")
    if any(case.find("failure") is not None or case.find("error") is not None
           or case.find("skipped") is not None for case in cases):
        raise ValueError("Native report contains a failed or skipped method")
    marker = "NATIVE_ASSOCIATION_RECALL_WITNESS "
    witnesses = [json.loads(line.split(marker, 1)[1]) for line in log.splitlines() if marker in line]
    checks = [w["check"] for w in witnesses]
    if len(checks) != len(set(checks)) or set(checks) != CHECKS:
        raise ValueError("Missing, duplicate, or unexpected native witnesses")
    witnesses_by_name = {w["check"]: w["observed"] for w in witnesses}
    report_stdout = "\n".join(node.text or "" for node in root.findall(".//system-out"))
    report_witnesses = [json.loads(line.split(marker, 1)[1])
                        for line in report_stdout.splitlines() if marker in line]
    if {w["check"]: w["observed"] for w in report_witnesses} != witnesses_by_name:
        raise ValueError("Report witnesses do not match this command log; reject stale reports")
    return {
        "status": "verified_native",
        "runtime": "Canonical vaix, AspectJ-woven Spring application, disposable H2",
        "run": {"canonicalCommand": commands[0], "log": file_ref(args.log),
                "nativeReport": file_ref(args.report), "nativeCounts": counts},
        "fixture": file_ref(args.fixture),
        "nativeWitnesses": witnesses_by_name,
        "boundaries": [
            "MockMvc requests from synthetic enrolled principals use real generated roles, ACLs, routing, persistence and owning HTTP handlers; no live network transport claim.",
            "Only startup outbound email/research are mocked; the race spy calls the real discovery method and delays its return.",
            "Receipt text and preview remain secured; upgrade compares a visible content hash and unchanged owning source text.",
            "Internal receipt-body and missing-proof controls are labeled persistence faults, not public mutation routes.",
            "Test-only inspection reads committed private pool identifiers before adding a distinct edge to an already-emitted neighbor; it does not fabricate or modify proof.",
            "Upgrade removes empty new tables and nullable columns from an authentic populated fixture; no old-process or restart claim.",
            "Currentness covers selected evidence and eligible edges in the original bounded admitted candidate pool, not all future corpus arrivals.",
            "No hosted writes, production-dialect qualification, latency comparison, model quality result or comparative product ranking.",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--log", required=True, type=Path)
    parser.add_argument("--report", required=True, type=Path)
    parser.add_argument("--fixture", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    value = collect(args)
    with args.output.open("x") as target:
        json.dump(value, target, indent=2)
        target.write("\n")
    print(json.dumps({"output": str(args.output), "nativeTests": 4,
                      "witnesses": len(value["nativeWitnesses"])}))


if __name__ == "__main__":
    main()
