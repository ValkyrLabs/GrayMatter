#!/usr/bin/env python3
"""Validate the frozen inputs or score native execution receipts against the independent SQL oracle."""
import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path
import re
from statistics import median
from uuid import UUID

from corpus import build, canonical, sha


def identity(value):
    try:
        return str(UUID(value)) == value
    except (ValueError, AttributeError, TypeError):
        return False


def frozen():
    tasks, expected = build()
    manifest = json.loads(Path(__file__).with_name("frozen.json").read_text())
    if sha(tasks) != manifest["tasksSha256"] or sha(expected) != manifest["oracleSha256"]:
        raise ValueError("Input or SQL oracle digest differs from the frozen manifest")
    return tasks, expected, manifest


def score(rows):
    tasks, expected, manifest = frozen()
    arms = ("source", "procedure")
    indexed = defaultdict(list)
    executions = Counter(r["executionId"] for r in rows if r.get("executionId"))
    for row in rows:
        if row.get("id") not in expected or row.get("arm") not in arms:
            raise ValueError("Unexpected trial identifier or arm")
        indexed[(row["id"], row["arm"])].append(row)

    def single_field(key, selected):
        values = [r.get(key) for r in selected]
        return len(set(values)) == 1 and bool(values) and bool(values[0])

    global_fields = ("ownerId", "sourceVersion", "sourceDeploymentId")
    consistent = all(single_field(k, rows) for k in global_fields)
    proc = [r for r in rows if r["arm"] == "procedure" and r.get("candidateRef")]
    same_release = not proc or all(single_field(k, proc) for k in (
        "candidateRef", "experimentRef", "candidateVersion", "mechanizationRef", "procedureRef"))
    outcomes, elapsed = {}, {}
    all_reasons = {a: Counter() for a in arms}
    for task in tasks:
        key = task["id"]
        for arm in arms:
            pair = key, arm
            candidates = indexed[pair]
            outcome = "missing" if not candidates else "duplicate"
            if len(candidates) == 1:
                r = candidates[0]
                outcome = r.get("status") or "missing-status"
                if outcome == "available":
                    proof = (
                        consistent and same_release and identity(r.get("ownerId")) and
                        identity(r.get("executionId")) and executions[r["executionId"]] == 1
                        and r.get("executionOwner") == r["ownerId"] and r.get("testMode") is False
                        and r.get("triggerTaskMatches") is True and r.get("trigger") == "MANUAL" and r.get("state") == "SUCCESS"
                        and r.get("contract") == task["task"]["contract"]
                        and r.get("inputSnapshotRef") == task["task"]["snapshotRef"]
                        and bool(re.fullmatch(r"[a-f0-9]{64}", r.get("definitionHash") or ""))
                        and identity(r.get("sourceVersion")) and identity(r.get("sourceDeploymentId"))
                        and type(r.get("elapsedNs")) is int and r["elapsedNs"] > 0)
                    if arm == "source":
                        proof = proof and r.get("executionVersion") == r["sourceVersion"] and (
                            r.get("executionDeployment") == r["sourceDeploymentId"])
                    else:
                        proof = proof and r.get("triggerProcedureBindingMatches") is True and bool(proc) and identity(r.get("candidateVersion")) and (
                            r.get("executionVersion") == r["candidateVersion"] != r["sourceVersion"]
                            and all(isinstance(r.get(k), str) and r[k] for k in
                                    ("routeReceipt", "candidateRef", "experimentRef", "mechanizationRef", "procedureRef")))
                    output_matches = canonical(r.get("result")) == canonical(expected[key]) and (
                        r.get("resultChecksum") == sha(expected[key]))
                    outcome = "invalid-execution-proof" if not proof else "exact" if output_matches else "incorrect-report"
                    if outcome == "exact":
                        elapsed[pair] = r["elapsedNs"] / 1_000_000
            outcomes[pair] = outcome
            all_reasons[arm][outcome] += 1
    schedule = [(t["id"], a) for t in tasks for a in (
        t["first"], "procedure" if t["first"] == "source" else "source")]
    ordered = [(r["id"], r["arm"]) for r in rows] == schedule
    matched = [t["id"] for t in tasks if all(outcomes[t["id"], a] == "exact" for a in arms)]
    observations = {a: dict(all_reasons[a]) for a in arms}
    result = {"cohort": manifest["cohort"], "tasksSha256": manifest["tasksSha256"], "oracleSha256": manifest["oracleSha256"],
              "assignedPerArm": len(tasks), "outcomes": observations,
              "exactTaskReturn": {a: {"earned": all_reasons[a]["exact"], "assigned": len(tasks)} for a in arms},
              "bothExact": len(matched), "frozenOrderObserved": ordered,
              "sourceOnlyExact": [t["id"] for t in tasks if outcomes[t["id"], "source"] == "exact" and t["id"] not in matched],
              "procedureOnlyExact": [t["id"] for t in tasks if outcomes[t["id"], "procedure"] == "exact" and t["id"] not in matched],
              "pairedExactMedianElapsedMs": {a: median(elapsed[k, a] for k in matched) if matched and ordered else None for a in arms},
              "nativeStage": "paired-attempted" if proc else "no-qualified-procedure-evaluated",
              "credits": None, "planningTokens": None}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--emit-inputs", type=Path)
    group.add_argument("--score", type=Path)
    args = parser.parse_args()
    if args.emit_inputs:
        with args.emit_inputs.open("x") as out:
            json.dump(frozen()[0], out)
    else:
        rows = [json.loads(line) for line in args.score.read_text().splitlines() if line.strip()]
        print(json.dumps(score(rows), indent=2))


if __name__ == "__main__":
    main()
