#!/usr/bin/env python3
"""Verify generated Lite record associations with two real JVMs and the same disposable H2 file."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import secrets
import shutil
import subprocess
from uuid import UUID
from zipfile import ZipFile
import tempfile

from lite_receipt_upgrade_test import runtime


def seed_vector_endpoints(jar, java, directory, vectors):
    # The shared protocol vectors pin four UUIDs. Insert these fixture sources while the JVM is stopped.
    with ZipFile(jar) as archive:
        driver, = [name for name in archive.namelist()
                   if name.startswith("BOOT-INF/lib/h2-") and name.endswith(".jar")]
        with archive.open(driver) as source, (directory / "h2.jar").open("wb") as dest:
            shutil.copyfileobj(source, dest)
    ids = {UUID(vector["request"][key]) for vector in vectors["positive"] for key in ("fromId", "toId")}
    inserts = [f"insert into memory_entry(id,principal_id,type,text,source_channel,created_at,modified_at) "
               f"select '{ref}', id, 'context', 'Vector fixture', 'test', current_timestamp, current_timestamp "
               f"from principal where username='admin'" for ref in sorted(ids)]
    completed = subprocess.run([java, "-cp", str(directory / "h2.jar"), "org.h2.tools.Shell",
                                "-url", f"jdbc:h2:file:{directory}/memory;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE",
                                "-user", "sa", "-password", "", "-sql", "; ".join(inserts)],
                               check=True, capture_output=True, text=True, timeout=20)
    if "Error:" in completed.stdout or completed.stdout.count("Update count: 1") != len(ids):
        raise RuntimeError("Could not create pinned source fixtures")


def check(jar, java):
    base = "graymatter/memory/associations"
    with tempfile.TemporaryDirectory(prefix="gm-association-restart-") as directory:
        path = Path(directory)
        snapshot = path / "runtime.jar"
        shutil.copyfile(jar, snapshot)
        with snapshot.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        password = secrets.token_urlsafe()
        with runtime(snapshot, java, path, password) as http:
            capabilities = http(base + "/capabilities")
            assert capabilities["supported"] and capabilities["cascadeDelete"]
            first, second = [http("MemoryEntry/write", {"text": text}) for text in ("First note", "Second note")]
            pair = dict(fromId=first["id"], toId=second["id"], relation="Résumé 🎯")
            http(base, pair, expected=201)
            with ThreadPoolExecutor(max_workers=4) as pool:
                receipts = list(pool.map(lambda _: http(base, pair), range(8)))
            receipt = receipts[0]
            assert all(r == receipt and r["replayed"] for r in receipts)
            fields = [capabilities["contractVersion"], first["id"], second["id"], pair["relation"]]
            framed = b"".join(len(f.encode()).to_bytes(4, "big") + f.encode() for f in fields)
            assert receipt["tupleHash"] == hashlib.sha256(framed).hexdigest()
            receipt_path = base + "/" + receipt["associationRef"]
            assert http(receipt_path) == receipt
        vector_file = Path(__file__).parent / "memory-associations" / "tuple-vectors.json"
        vectors = json.loads(vector_file.read_bytes())
        seed_vector_endpoints(snapshot, java, path, vectors)
        with runtime(snapshot, java, path, password) as http:
            for vector in vectors["positive"]:
                http(base, vector["request"], expected=201)
                replay = http(base, vector["request"])
                assert {key: replay[key] for key in vector["canonical"]} == vector["canonical"], vector["name"]
                assert replay["tupleHash"] == vector["tupleHash"], vector["name"]
            for vector in vectors["negative"]:
                http(base, vector["request"], expected=400)
            assert http(receipt_path) == receipt and http(base, pair) == receipt
            memory_path = "graymatter/memory/" + first["id"]
            edit = http(memory_path + "/revise", {"text": "Corrected note", "expectedSourceHash": first["sourceHash"]})
            assert edit["sourceHash"] != first["sourceHash"] and http(receipt_path) == receipt
            http(memory_path + "/forget", {"expectedSourceHash": edit["sourceHash"], "confirmed": True}, expected=204)
            http(receipt_path, expected=404)
            http(base, pair, expected=404)
    return dict(jarSha256=digest, concurrentExactReplays=8, receiptPreservedAfterRestart=True,
                receiptPreservedAfterCorrection=True, forgottenEndpointRead=404, forgottenEndpointReplay=404,
                matchingProtocolVectors=len(vectors["positive"]), rejectedProtocolVectors=len(vectors["negative"]),
                vectorSha256=hashlib.sha256(vector_file.read_bytes()).hexdigest())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("jar", type=Path)
    parser.add_argument("--java", default="java")
    args = parser.parse_args()
    print(json.dumps(check(args.jar.resolve(strict=True), args.java), indent=2))
