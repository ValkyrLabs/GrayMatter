#!/usr/bin/env python3
"""Paired session retrieval against pinned LoCoMo, using a fresh loopback-only Lite server."""
import argparse
import base64
from collections import Counter
import hashlib
import json
import math
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError
from urllib.request import build_opener, ProxyHandler, Request

REVISION = "3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376"
DATA_SHA = "79fa87e90f04081343b8c8debecb80a9a6842b76a7aa537dc9fdf651ea698ff4"
SEED = 20260826
K = 3
PER_CONVERSATION = 10
TOKEN = re.compile(r"[^\W_]+", re.UNICODE)
EVIDENCE = re.compile(r"D(\d+):\d+")
LOCAL = build_opener(ProxyHandler({}))


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def select_questions(group, session_ids):
    eligible = []
    for index, question in enumerate(group["qa"]):
        if int(question["category"]) == 5:
            continue
        annotations = question.get("evidence", [])
        refs = [EVIDENCE.fullmatch(ref) for ref in annotations]
        expected = sorted({int(ref[1]) for ref in refs if ref})
        if not expected or not all(refs) or not set(expected) <= session_ids:
            continue
        key = f"{SEED}\0{group['sample_id']}\0{index}".encode("utf-8")
        eligible.append((hashlib.sha256(key).digest(), index, question, expected))
    if len(eligible) < 2 * PER_CONVERSATION:
        raise ValueError("Insufficient eligible questions in " + group["sample_id"])
    ranked = sorted(eligible)
    return ranked[:PER_CONVERSATION], ranked[PER_CONVERSATION:2 * PER_CONVERSATION], len(eligible)


class BM25:
    def __init__(self, sessions):
        self.terms = {sid: Counter(TOKEN.findall((text + " episodic").lower())) for sid, text in sessions.items()}
        self.length = {sid: sum(counts.values()) for sid, counts in self.terms.items()}
        self.average = sum(self.length.values()) / len(self.length)
        self.df = Counter(term for counts in self.terms.values() for term in counts)

    def rank(self, query):
        terms = set(TOKEN.findall(query.lower()))
        scored = []
        for sid, counts in self.terms.items():
            length_factor = 1.2 * (0.25 + 0.75 * self.length[sid] / self.average)
            score = 0.0
            for term in sorted(terms):
                tf = counts[term]
                if tf:
                    df = self.df[term]
                    idf = math.log1p((len(self.terms) - df + 0.5) / (df + 0.5))
                    score += idf * tf * 2.2 / (tf + length_factor)
            if score > 0:
                scored.append((-score, sid))
        return [sid for _, sid in sorted(scored)[:K]]


def evaluate(port, password, dataset, sample):
    auth = base64.b64encode(f"admin:{password}".encode()).decode()

    def post(route, body):
        request = Request(f"http://127.0.0.1:{port}/v1/{route}", data=json.dumps(body).encode(),
                          headers={"Authorization": "Basic " + auth, "Content-Type": "application/json"})
        with LOCAL.open(request, timeout=60) as response:
            if response.status != 200:
                raise RuntimeError(f"{route} HTTP {response.status}")
            return json.load(response)

    groups, cases = [], []
    for group in dataset:
        conversation = group["conversation"]
        sessions = {}
        for key, turns in conversation.items():
            if re.fullmatch(r"session_\d+", key):
                sid = int(key.split("_")[1])
                date = conversation[key + "_date_time"]
                sessions[sid] = f"Date: {date}\n" + "\n".join(f"{t['speaker']}: {t['text']}" for t in turns)
        initial, reserved, eligible = select_questions(group, set(sessions))
        questions = reserved if sample == "reserved" else initial
        by_id = {}
        source = f"locomo:{group['sample_id']}"
        for sid, text in sorted(sessions.items()):
            record = post("MemoryEntry/write", {"text": text, "type": "episodic", "sourceChannel": source, "tags": []})
            if record["text"] != text or record["sourceChannel"] != source or record["id"] in by_id:
                raise RuntimeError("Session write did not round-trip")
            by_id[record["id"]] = sid
        bm25 = BM25(sessions)
        for _, index, question, expected in questions:
            query = question["question"]
            response = post("memory/semantic-index/search",
                            {"query": query, "retrievalMode": "HYBRID", "source": source, "limit": K})
            if response["vectorProfile"] != "feature-hash-384-v1" or response["semanticDegraded"]:
                raise RuntimeError("Local search used an unexpected profile")
            lite = [by_id[hit["memoryEntry"]["id"]] for hit in response["results"]]
            lexical = bm25.rank(query)
            if len(lite) > K or len(set(lite)) != len(lite):
                raise RuntimeError("Unexpected result cap or duplicate")
            cases.append({"conversation": group["sample_id"], "qaIndex": index, "category": question["category"],
                          "questionSha256": hashlib.sha256(query.encode()).hexdigest(), "expected": expected,
                          "lite": lite, "bm25": lexical})
        groups.append({"id": group["sample_id"], "sessions": len(sessions), "eligible": eligible,
                       "sampled": len(questions), "reservedQaIndices": [index for _, index, _, _ in reserved]})
        print(f"{group['sample_id']}: {len(sessions)} sessions, {len(questions)} questions", file=sys.stderr, flush=True)
    return groups, cases


def metrics(cases, key):
    hits = [len(set(case[key]) & set(case["expected"])) for case in cases]
    counts = [len(case["expected"]) for case in cases]
    return {"matchedEvidence": sum(hits), "annotatedEvidence": sum(counts),
            "pooledRecall": sum(hits) / sum(counts),
            "meanQueryRecall": sum(h / n for h, n in zip(hits, counts)) / len(cases),
            "queriesWithAnyHit": sum(h > 0 for h in hits), "queriesWithAllEvidence": sum(h == n for h, n in zip(hits, counts)),
            "questions": len(cases)}


def run(args):
    jar = args.jar.resolve(strict=True)
    source_hash = sha256(args.corpus)
    if source_hash != DATA_SHA:
        raise ValueError("Pinned corpus digest mismatch")
    with tempfile.TemporaryDirectory(prefix="graymatter-locomo-") as temp:
        scratch = Path(temp)
        password = secrets.token_hex(24)
        env = {"PATH": os.environ["PATH"], "HOME": temp, "GRAYMATTER_DATA_DIR": temp,
               "GRAYMATTER_ADMIN_USERNAME": "admin", "GRAYMATTER_ADMIN_PASSWORD": password,
               "GRAYMATTER_DB_URL": "jdbc:h2:mem:locomo;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE"}
        cmd = [args.java, "-jar", str(jar), "--server.address=127.0.0.1", "--server.port=0",
               "--graymatter.starter-knowledge-pack.enabled=false"]
        logfile = scratch / "runtime.log"
        with logfile.open("w") as log:
            proc = subprocess.Popen(cmd, env=env, cwd=scratch, stdout=log, stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic() + 180
            while time.monotonic() < deadline:
                if proc.poll() is not None:
                    raise RuntimeError("Lite exited before startup: " + logfile.read_text()[-1200:])
                ports = re.findall(r"Tomcat started on port (\d+)", logfile.read_text())
                if ports:
                    port = int(ports[-1])
                    try:
                        with LOCAL.open(f"http://127.0.0.1:{port}/actuator/health", timeout=15) as response:
                            if json.load(response)["status"] == "UP":
                                break
                    except HTTPError as error:
                        if error.code != 503:
                            raise
                time.sleep(0.5)
            else:
                raise RuntimeError("Lite startup timed out")
            groups, cases = evaluate(port, password, json.loads(args.corpus.read_bytes()), args.sample)
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=20)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
    diffs = [len(set(c["lite"]) & set(c["expected"])) - len(set(c["bm25"]) & set(c["expected"])) for c in cases]
    return {"protocol": "locomo-local-session-recall/v1", "sample": args.sample, "seed": SEED, "topK": K, "samplesPerConversation": PER_CONVERSATION,
            "sourceRevision": REVISION, "corpusSha256": source_hash, "jarSha256": sha256(jar),
            "runnerSha256": sha256(Path(__file__)), "java": subprocess.check_output([args.java, "-version"],
                stderr=subprocess.STDOUT, text=True).splitlines()[0], "groups": groups, "sessions": sum(g["sessions"] for g in groups),
            "metrics": {key: metrics(cases, key) for key in ("lite", "bm25")},
            "pairedQueryCounts": {"liteHigher": sum(d > 0 for d in diffs), "bm25Higher": sum(d < 0 for d in diffs),
                                  "equal": diffs.count(0)}, "cases": cases}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--jar", type=Path, required=True)
    parser.add_argument("--corpus", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--sample", choices=("initial", "reserved"), default="initial")
    parser.add_argument("--java", default=shutil.which("java"))
    arguments = parser.parse_args()
    report = run(arguments)
    arguments.output.write_text(json.dumps(report, indent=2) + "\n")
