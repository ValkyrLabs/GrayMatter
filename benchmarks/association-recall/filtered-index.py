"""Matched synthetic history pressure probe for generated GrayMatter Lite."""
import argparse
from collections import Counter
import json
import os
from pathlib import Path
import secrets
import shutil
import statistics
import subprocess
import sys
from zipfile import ZipFile

JAVA = "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home/bin/java"
FLAGS = ["-Xms128m", "-Xmx512m"]
HISTORY_COUNT = 6000
TRIALS = 15
WARMUP = 5
CHANNEL = "filtered-index-pressure:unrelated"
HERE = Path(__file__).resolve().parent

def h2(jar, directory, sql):
    driver = directory.parent / "h2.jar"
    if not driver.exists():
        with ZipFile(jar) as archive:
            name, = [n for n in archive.namelist() if n.startswith("BOOT-INF/lib/h2-") and n.endswith(".jar")]
            driver.write_bytes(archive.read(name))
    result = subprocess.run([JAVA, "-cp", str(driver), "org.h2.tools.Shell",
        "-url", f"jdbc:h2:file:{directory}/memory;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE",
        "-user", "sa", "-password", "", "-sql", sql],
        capture_output=True, check=True, text=True, timeout=90)
    if "Error:" in result.stdout or result.stderr:
        raise RuntimeError(result.stdout + result.stderr)
    return result.stdout

def prepare(harness, jar, scratch):
    seed = scratch / "seed"
    seed.mkdir()
    password = secrets.token_urlsafe(32)
    fixture = json.loads(harness.FIXTURE.read_bytes())
    case = next(c for c in fixture["cases"] if c["id"] == "linked-detail")
    with harness.runtime(jar, JAVA, seed, password, FLAGS, "seed") as request:
        state = harness.seed(request, case, ":index-pressure")
        outside = harness.success(request("MemoryEntry/write", {
            "text": "Greenhouse maintenance keeps irrigation pipes clean. " * 15,
            "type": "context", "tags": ["plants"], "sourceChannel": CHANNEL,
        }))
        result = harness.success(request(harness.CONTEXT, harness.query(fixture, case, state, True)))
        assert result["answerPolicy"] == "ALLOW_ANSWER" and len(result["associationRefs"]) == 1
    source_id = outside["id"]
    statement = """
        insert into memory_entry(id, principal_id, type, text, source_channel, tags, created_at, modified_at, revision_nonce)
        select random_uuid(), seed.principal_id, seed.type, seed.text, seed.source_channel, seed.tags,
               seed.created_at, seed.modified_at, seed.revision_nonce
        from memory_entry seed cross join system_range(1, {count}) where seed.id = '{source}';
        insert into memory_search_index(memory_id, principal_id, source_hash, hash_profile, hash_vector, semantic_profile, semantic_vector)
        select m.id, i.principal_id, i.source_hash, i.hash_profile, i.hash_vector, i.semantic_profile, i.semantic_vector
        from memory_entry m cross join memory_search_index i
        where m.source_channel = '{channel}' and m.id <> i.memory_id and i.memory_id = '{source}';
    """.format(count=HISTORY_COUNT, source=source_id, channel=CHANNEL)
    written = h2(jar, seed, statement)
    assert written.count(f"Update count: {HISTORY_COUNT}") == 2, written
    spec = {"password": password, "queries": {"filtered": harness.query(fixture, case, state, True),
              "unfiltered": {k: v for k, v in harness.query(fixture, case, state, True).items() if k != "source"}},
            "historyRows": HISTORY_COUNT + 1, "targetRows": len(state["rows"]), "fixtureSha256": harness.digest(harness.FIXTURE),
            "expectedNeighbor": state["rows"]["answer"]["id"], "seedDatabaseSha256": harness.digest(seed / "memory.mv.db")}
    with open(scratch / "seed.json", "x", opener=lambda path, flags: os.open(path, flags, 0o600)) as out:
        json.dump(spec, out)

def measure(harness, jar, scratch, role):
    spec = json.loads((scratch / "seed.json").read_bytes())
    seed_db = scratch / "seed" / "memory.mv.db"
    assert harness.digest(seed_db) == spec["seedDatabaseSha256"]
    directory = scratch / role
    directory.mkdir()
    shutil.copyfile(seed_db, directory / "memory.mv.db")
    timings = {case: [] for case in spec["queries"]}
    projections = {case: Counter() for case in spec["queries"]}
    with harness.runtime(jar, JAVA, directory, spec["password"], FLAGS, role) as request:
        for trial in range(TRIALS + WARMUP):
            for case, payload in spec["queries"].items():
                observed = request(harness.CONTEXT, payload)
                body = harness.success(observed)
                assert body["answerPolicy"] == "ALLOW_ANSWER", body["answerPolicy"]
                assert {x["memoryId"] for x in body["associationRefs"]} == {spec["expectedNeighbor"]}
                projection = {k: body[k] for k in ("answerPolicy", "retrievalStatus", "context", "sourceCount",
                              "tokenEstimate", "associationPolicyVersion", "associationRefs", "associationTruncated")}
                if trial >= WARMUP:
                    projections[case][json.dumps(projection, sort_keys=True)] += 1
                    timings[case].append(observed["elapsedMs"])
    assert all(len(variants) == 1 for variants in projections.values())
    result = {"jarSha256": harness.digest(jar), "seedDatabaseSha256": spec["seedDatabaseSha256"],
              "fixtureSha256": spec["fixtureSha256"], "historyRows": spec["historyRows"],
              "targetRows": spec["targetRows"], "warmupPerMode": WARMUP, "trialsPerMode": TRIALS,
              "runtimeFlags": FLAGS, "cases": {}}
    for case, samples in timings.items():
        result["cases"][case] = {"medianMs": statistics.median(samples), "p95Ms": sorted(samples)[-1],
                                  "trialsMs": samples, "projection": json.loads(next(iter(projections[case])))}
    with (scratch / (role + ".json")).open("x") as out:
        json.dump(result, out, indent=2)
        out.write("\n")
    print(json.dumps({"role": role, "medianMs": {k: v["medianMs"] for k, v in result["cases"].items()}}))

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=("prepare", "baseline", "candidate"))
    parser.add_argument("jar", type=Path)
    parser.add_argument("scratch", type=Path)
    parser.add_argument("--harness-dir", type=Path, default=HERE)
    args = parser.parse_args()
    sys.path.insert(0, str(args.harness_dir.resolve()))
    import run as harness
    jar = args.jar.resolve(strict=True)
    if args.phase == "prepare":
        prepare(harness, jar, args.scratch)
    else:
        measure(harness, jar, args.scratch, args.phase)
