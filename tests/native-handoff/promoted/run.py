#!/usr/bin/env python3
"""Exercise the real shadow procedure lifecycle against a private, empty H2 database."""

import argparse
import base64
import json
import os
from pathlib import Path
import platform
import secrets
import shutil
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ("build", "dependencies", "jdk", "console", "agent", "witness"):
        parser.add_argument(f"--{flag}", required=True, type=Path)
    parser.add_argument("--already-network-isolated", action="store_true")
    args = parser.parse_args()
    witness = args.witness.resolve()
    if witness.exists() or not witness.parent.is_dir():
        parser.error("Choose a new witness path in an existing directory.")
    jars = [p for p in args.dependencies.read_text().strip().split(os.pathsep) if p.endswith(".jar")]
    if not jars or any(not Path(p).is_absolute() or not Path(p).is_file() for p in jars):
        parser.error("Supply the actual Maven test-scope JAR classpath.")
    classes = args.build.resolve() / "classes"
    manifest = classes / "valkyr/data-plane/api0-data-plane-manifest.json"
    if not manifest.is_file() or "startSkillCandidateShadowReplay" not in manifest.read_text():
        parser.error("Generate and compile the reviewed private backend first.")
    source = Path(__file__).with_name("NativeProcedureShadowReplayJpaTest.java").resolve()
    jdk = args.jdk.resolve() / "bin"
    with tempfile.TemporaryDirectory(prefix="graymatter-native-shadow-") as temp:
        work = Path(temp)
        test_classes = work / "test-classes"
        test_classes.mkdir()
        cp = os.pathsep.join(map(str, [test_classes, classes, args.build.resolve() / "test-classes", *jars]))
        subprocess.run([jdk / "javac", "--release", "17", "-parameters", "-cp", cp, "-d", test_classes, source], check=True)
        command = []
        if not args.already_network_isolated:
            sandbox = shutil.which("sandbox-exec")
            if platform.system() != "Darwin" or not sandbox:
                parser.error("Use an isolated network namespace and pass --already-network-isolated.")
            policy = Path(__file__).resolve().parents[2] / "memory-associations/recall/loopback.sb"
            command.extend([sandbox, "-f", str(policy)])
        key = base64.b64encode(secrets.token_bytes(32)).decode()
        env = {"PATH": os.defpath, "LANG": "en_US.UTF-8", "HOME": temp, "AWS_EC2_METADATA_DISABLED": "true",
               "JWT_SECRET": key, "THORAPI_SECRET_KEY": key, "THORAPI_LEGACY_SECRET_KEYS": ""}
        command.extend([jdk / "java", "-Xms768m", "-Xmx4096m", "-XX:MaxMetaspaceSize=1024m", "-XX:ActiveProcessorCount=4",
                        "--add-opens=java.base/java.lang=ALL-UNNAMED", f"-Duser.home={temp}", f"-Djava.io.tmpdir={temp}",
                        f"-Dvalkyrai.runtime.classesDir={classes}", f"-Dvalkyrai.file-service.local-root={work / 'files'}",
                        f"-Dgraymatter.shadow.witness={witness}", "-Dserver.address=127.0.0.1",
                        f"-javaagent:{args.agent.resolve()}", "-cp", str(args.console.resolve()) + os.pathsep + cp,
                        "org.junit.platform.console.ConsoleLauncher", "execute", "--disable-banner", "--details=summary",
                        "--select-class=com.valkyrlabs.valkyrai.sagechat.NativeProcedureShadowReplayJpaTest"])
        log = work / "test.log"
        with log.open("w") as out:
            result = subprocess.run(command, cwd=work, env=env, stdout=out, stderr=subprocess.STDOUT)
        if result.returncode:
            print("\n".join(log.read_text().splitlines()[-36:]))
            raise SystemExit(result.returncode)
    data = json.loads(witness.read_text())
    print(f"{len(data['sources'])} source executions, {len(data['pairs'])} holdout pairs, {data['candidateStatus']}; witness {witness}")


if __name__ == "__main__":
    main()
