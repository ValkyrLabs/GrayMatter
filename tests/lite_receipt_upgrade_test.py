#!/usr/bin/env python3
"""Check a v2 -> v3 receipt policy upgrade against the same disposable, on-disk Lite database."""
import argparse
import base64
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import build_opener, HTTPRedirectHandler, ProxyHandler, Request


class LocalOnly(HTTPRedirectHandler):
    def redirect_request(self, *unused):
        return None


@contextmanager
def runtime(jar, java, path, password):
    # Supply no host credentials or model configuration. Both processes open the same file.
    env = dict(PATH=os.environ["PATH"], HOME=str(path), GRAYMATTER_DATA_DIR=str(path),
               GRAYMATTER_ADMIN_USERNAME="admin", GRAYMATTER_ADMIN_PASSWORD=password,
               GRAYMATTER_DB_URL=f"jdbc:h2:file:{path}/memory;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE")
    opener = build_opener(ProxyHandler({}), LocalOnly())
    log = path / "boot.log"
    with log.open("w") as stream:
        proc = subprocess.Popen([java, "-jar", str(jar), "--server.address=127.0.0.1", "--server.port=0",
                                 "--graymatter.starter-knowledge-pack.enabled=false"],
                                env=env, cwd=path, stdout=stream, stderr=subprocess.STDOUT)
    try:
        deadline = time.monotonic() + 180
        while proc.poll() is None and time.monotonic() < deadline:
            ports = re.findall(r"Tomcat started on port (\d+)", log.read_text())
            if ports:
                url = "http://127.0.0.1:" + ports[-1]
                try:
                    with opener.open(url + "/actuator/health", timeout=4) as response:
                        if json.load(response)["status"] == "UP":
                            break
                except URLError:
                    pass
            time.sleep(0.25)
        else:
            raise RuntimeError("Lite did not start")
        auth = "Basic " + base64.b64encode(("admin:" + password).encode()).decode()

        def request(endpoint, body=None, expected=200):
            req = Request(url + "/v1/" + endpoint, data=json.dumps(body).encode() if body is not None else None,
                          headers={"Authorization": auth, "Content-Type": "application/json"})
            try:
                response = opener.open(req, timeout=15)
            except HTTPError as err:
                response = err
            with response:
                if response.status != expected:
                    reasons = [line.strip() for line in log.read_text().splitlines()
                               if "SQL Error:" in line or "not permitted for column" in line
                               or "Value not permitted" in line or "constraint violation" in line]
                    raise RuntimeError(f"{endpoint.split('/')[0]}: expected {expected}, received {response.status}; "
                                       + "; ".join(reasons[-2:])[:400])
                return json.load(response) if expected == 200 else None

        yield request
    finally:
        proc.terminate()
        try:
            proc.wait(20)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()


def check(before, after, java):
    args = dict(query="Telemetry window", topK=2, retrievalMode="KEYWORD", source="upgrade:test")
    password = secrets.token_urlsafe(24)
    with tempfile.TemporaryDirectory(prefix="gm-receipt-upgrade-") as tmp:
        path = Path(tmp)
        with runtime(before, java, path, password) as http:
            ids = [http("MemoryEntry/write", {"text": f"Telemetry window is {day}.", "sourceChannel": args["source"]})["id"]
                   for day in ["Tuesday", "Sunday"]]
            previous = http("graymatter/retrieval-context", args)
            assert previous["policyVersion"] == "bifrost-lite-context/v2" and previous["answerPolicy"] == "ALLOW_ANSWER"
            original = previous["receiptId"]
        with runtime(after, java, path, password) as http:
            audit = http("graymatter-retrieval-receipts/" + original)
            assert audit["recordedRetrievalStatus"] == "OK" and audit["answerPolicy"] != "ALLOW_ANSWER"
            http(f"graymatter/retrieval-context/{original}/hydrate/{ids[0]}", expected=409)
            http(f"graymatter/retrieval-context/{original}/fork", {"query": args["query"]}, expected=409)
            current = http("graymatter/retrieval-context", args)
            assert current["policyVersion"] in {"bifrost-lite-context/v3", "bifrost-lite-context/v4"}
            assert current["retrievalStatus"] == "AMBIGUOUS_WEEKDAY"
            assert sorted(current["ambiguousRefs"]) == sorted(ids) and current["items"] == [] and not current.get("contextPageRef")
        with runtime(after, java, path, password) as http:
            fresh = http("graymatter-retrieval-receipts/" + current["receiptId"])
            assert sorted(fresh["ambiguousRefs"]) == sorted(ids) and fresh["recordedRetrievalStatus"] == current["retrievalStatus"]
    return {"oldReceiptNow": audit["retrievalStatus"], "oldHydrate": 409, "oldFork": 409,
            "freshReceipt": fresh["retrievalStatus"], "v3ReceiptReloadedAfterRestart": True,
            "witnesses": len(fresh["ambiguousRefs"])}


def check_discovery_upgrade(before, after, java):
    query = {"query": "Observatory approval", "filters": {"source": "upgrade:observatory"}, "retrievalMode": "KEYWORD"}
    password = secrets.token_urlsafe(24)
    with tempfile.TemporaryDirectory(prefix="gm-discovery-upgrade-") as tmp:
        path = Path(tmp)
        with runtime(before, java, path, password) as http:
            pointer = http("MemoryEntry/write", {"text": "Observatory approval was granted.", "sourceChannel": "upgrade:observatory"})["id"]
            previous = http("graymatter/retrieval-context", query)
            assert previous["policyVersion"] == "bifrost-lite-context/v3" and previous["answerPolicy"] == "ALLOW_ANSWER"
            assert "sourceSelection" not in previous
        with runtime(after, java, path, password) as http:
            old = previous["receiptId"]
            audit = http("graymatter-retrieval-receipts/" + old)
            assert audit["recordedRetrievalStatus"] == "OK" and audit["answerPolicy"] == "DO_NOT_ANSWER_CONFIDENTLY"
            http(f"graymatter/retrieval-context/{old}/hydrate/{pointer}", expected=409)
            http(f"graymatter/retrieval-context/{old}/refresh", query, expected=409)
            page = http("graymatter/retrieval-context", query)
            assert page["policyVersion"] == "bifrost-lite-context/v4"
            assert page["sourceSelection"] == "FRESH_SEARCH" and page["answerPolicy"] == "ALLOW_ANSWER"
        with runtime(after, java, path, password) as http:
            before_change = http("graymatter-retrieval-receipts/" + page["receiptId"])
            assert before_change["answerPolicy"] == "ALLOW_ANSWER"
            dispute = http("MemoryEntry/write", {"text":"Observatory approval is disputed.", "tags":["unresolved"],
                                                  "sourceChannel":"upgrade:observatory"})
            now = http("graymatter-retrieval-receipts/" + page["receiptId"])
            assert now["recordedRetrievalStatus"] == "OK" and now["retrievalStatus"] == "STALE_CONTEXT"
            http("graymatter/retrieval-context/" + page["receiptId"] + "/hydrate/" + pointer, expected=409)
            child = http("graymatter/retrieval-context/" + page["receiptId"] + "/refresh", query)
            assert child["sourceSelection"] == "FRESH_SEARCH" and child["parentReceiptId"] == page["receiptId"]
            assert child["retrievalStatus"] == "CONFLICTING_CONTEXT" and child["conflictRefs"] == [dispute["id"]]
            assert not child["items"] and not child.get("contextPageRef")
    return {"legacyRecorded":audit["recordedRetrievalStatus"], "legacyEffective":audit["retrievalStatus"],
            "legacyHydrate":409, "legacyRefresh":409, "persistedBeforeChange":before_change["retrievalStatus"],
            "afterNewDispute":now["retrievalStatus"], "newDisputeHydrate":409, "freshChild":child["retrievalStatus"]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("before", type=Path)
    parser.add_argument("after", type=Path)
    parser.add_argument("--java", default="java")
    parser.add_argument("--discovery", action="store_true", help="upgrade from v3 without a candidate-state record")
    args = parser.parse_args()
    paths = [f.resolve(strict=True) for f in (args.before, args.after)]
    report = (check_discovery_upgrade if args.discovery else check)(*paths, args.java)
    for role, path in zip(("before", "after"), paths):
        with path.open("rb") as stream:
            report[role + "Sha256"] = hashlib.file_digest(stream, "sha256").hexdigest()
    print(json.dumps(report, indent=2))
