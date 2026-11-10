#!/usr/bin/env python3
"""Run the native GrayMatter handoff against a new in-memory H2 database."""

import argparse
import base64
import hashlib
import os
from pathlib import Path
import platform
import secrets
import shutil
import subprocess
import tempfile

from report_oracle import expected_checksum


def network_wrapper(already_isolated):
    if already_isolated:
        return []
    sandbox = shutil.which("sandbox-exec")
    if platform.system() != "Darwin" or not sandbox:
        raise SystemExit("Run inside an isolated network namespace and use --already-network-isolated.")
    policy = Path(__file__).resolve().parents[1] / "memory-associations/recall/loopback.sb"
    return [sandbox, "-f", str(policy)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build", type=Path, required=True, help="Compiled application with classes and test-classes")
    parser.add_argument("--dependencies", type=Path, required=True, help="Maven test-scope classpath file")
    parser.add_argument("--console", type=Path, required=True, help="JUnit Platform Console standalone JAR")
    parser.add_argument("--agent", type=Path, required=True, help="Byte Buddy agent JAR used by Mockito")
    parser.add_argument("--jdk", type=Path, required=True, help="JDK home used by the owning build")
    parser.add_argument("--woven-overlay", type=Path, help="Optional reviewed woven classes for a pre-installation run")
    parser.add_argument("--already-network-isolated", action="store_true", help="Use the caller's isolated network sandbox")
    args = parser.parse_args()

    here = Path(__file__).resolve().parent
    build = args.build.resolve()
    dependencies = [p for p in args.dependencies.read_text().strip().split(os.pathsep) if p.endswith(".jar")]
    if not dependencies or any(not Path(p).is_absolute() or not Path(p).is_file() for p in dependencies):
        parser.error("The test dependency classpath must contain absolute paths to existing JARs.")
    manifest = build / "classes/valkyr/data-plane/api0-data-plane-manifest.json"
    if not manifest.is_file() or "InvoiceReferenceCheckController" not in manifest.read_text():
        parser.error("Regenerate and compile the application's api-0 data-plane manifest before running.")

    expected = expected_checksum()
    print("Independent invoice report SHA-256", expected, flush=True)
    with tempfile.TemporaryDirectory(prefix="graymatter-native-handoff-") as directory:
        work = Path(directory)
        wrapper = network_wrapper(args.already_network_isolated)
        classes = work / "classes"
        templates = classes / "workflows/graph-templates"
        templates.mkdir(parents=True)
        shutil.copy(here / "synthetic-handoff.json", templates)
        shutil.copy(here.parents[1] / "examples/workflows/graph-templates/graymatter-receipt-observation.json", templates)
        application_dirs = [build / "classes", build / "test-classes"]
        if args.woven_overlay:
            application_dirs.insert(0, args.woven_overlay.resolve())
        classpath = os.pathsep.join(map(str, [classes, *application_dirs, *dependencies]))
        javac = args.jdk.resolve() / "bin/javac"
        subprocess.run(
            [javac, "-parameters", "-cp", classpath, "-d", classes, here / "CausalGrayMatterNativeHandoffJpaTest.java"],
            cwd=work, check=True,
        )

        ephemeral_key = base64.b64encode(secrets.token_bytes(32)).decode()
        env = {
            "PATH": "/usr/bin:/bin",
            "LANG": "en_US.UTF-8",
            "HOME": str(work),
            "AWS_EC2_METADATA_DISABLED": "true",
            "THORAPI_SECRET_KEY": ephemeral_key,
            "JWT_SECRET": ephemeral_key,
            "THORAPI_LEGACY_SECRET_KEYS": "",
        }
        java_args = [
            *wrapper, args.jdk.resolve() / "bin/java",
            "-Xms768m", "-Xmx4g", "-XX:ActiveProcessorCount=4", "-XX:MaxMetaspaceSize=1024m",
            "--add-opens=java.base/java.lang=ALL-UNNAMED",
            f"-Duser.home={work}", f"-Djava.io.tmpdir={work}",
            f"-Dvalkyrai.file-service.local-root={work / 'files'}",
            f"-Dvalkyrai.runtime.classesDir={build / 'classes'}",
            f"-Djwt.secret={ephemeral_key}", f"-DTHORAPI_SECRET_KEY={ephemeral_key}",
            "-Dserver.address=127.0.0.1",
            "-Dhttp.proxyHost=127.0.0.1", "-Dhttp.proxyPort=9",
            "-Dhttps.proxyHost=127.0.0.1", "-Dhttps.proxyPort=9",
            "-Dhttp.nonProxyHosts=localhost|127.*|[::1]", "-Dspring.output.ansi.enabled=never",
            f"-javaagent:{args.agent.resolve()}", "-cp", os.pathsep.join([str(args.console.resolve()), classpath]),
            "org.junit.platform.console.ConsoleLauncher", "execute", "--disable-banner", "--details=summary",
            "--select-method", "com.valkyrlabs.valkyrai.sagechat.CausalGrayMatterNativeHandoffJpaTest#canonicalReceiptToSkillObservation",
        ]
        log = work / "junit.log"
        with log.open("w") as output:
            result = subprocess.run(java_args, cwd=work, env=env, stdout=output, stderr=subprocess.STDOUT)
        print("api-0 manifest SHA-256", hashlib.sha256(manifest.read_bytes()).hexdigest())
        observed = None
        for line in log.read_text().splitlines():
            if line.startswith("NATIVE_STAGE invoiceReportComparedToPrecommittedIndependentDigest "):
                fields = dict(pair.split("=", 1) for pair in line.split()[2:])
                observed = fields.get("resultChecksum")
            if line.startswith("NATIVE_STAGE ") or "tests successful" in line or "tests failed" in line:
                print(line)
        if result.returncode == 0 and observed != expected:
            raise SystemExit("The returned invoice checksum disagrees with the independent oracle.")
        return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
