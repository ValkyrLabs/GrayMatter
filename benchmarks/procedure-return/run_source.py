#!/usr/bin/env python3
"""Execute the source-only control in a contained, throwaway H2 application."""
import argparse
import base64
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile

from corpus import build, sha

HERE = Path(__file__).resolve().parent
NATIVE = HERE.parents[1] / "tests/native-handoff"
sys.path.insert(0, str(NATIVE))
from run import network_wrapper


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ("build", "dependencies", "jdk", "console", "agent", "output", "log"):
        parser.add_argument("--" + key, type=Path, required=True)
    parser.add_argument("--woven-overlay", type=Path)
    parser.add_argument("--already-network-isolated", action="store_true")
    args = parser.parse_args()
    if args.output.exists() or args.log.exists():
        parser.error("Use new observation and log files.")
    tasks, oracle = build()
    frozen = json.loads((HERE / "frozen.json").read_text())
    if sha(tasks) != frozen["tasksSha256"] or sha(oracle) != frozen["oracleSha256"]:
        parser.error("Corpus or oracle differs from the frozen manifest.")
    base = args.build.resolve()
    deps = [Path(p) for p in args.dependencies.read_text().strip().split(os.pathsep) if p.endswith(".jar")]
    if not deps or any(not p.is_absolute() or not p.is_file() for p in deps):
        parser.error("Use a self-contained resolved test dependency classpath.")
    with tempfile.TemporaryDirectory(prefix="graymatter-task-return-") as tmp:
        work = Path(tmp)
        guard = network_wrapper(work, args.already_network_isolated)
        classes = work / "classes"
        classes.mkdir()
        tasks_file = work / "tasks.json"
        tasks_file.write_text(json.dumps(tasks))
        roots = [classes] + ([args.woven_overlay.resolve()] if args.woven_overlay else [])
        cp = os.pathsep.join(map(str, [*roots, base / "classes", base / "test-classes", *deps]))
        jdk = args.jdk.resolve() / "bin"
        subprocess.run([jdk / "javac", "--release", "17", "-proc:none", "-parameters", "-cp", cp, "-d", classes,
                        HERE / "ProcedureReturnProbe.java", NATIVE / "CausalGrayMatterNativeHandoffJpaTest.java",
                        HERE / "SourceProcedureReturnJpaTest.java"], check=True, cwd=work)
        key = base64.b64encode(secrets.token_bytes(32)).decode()
        env = dict(PATH="/usr/bin:/bin", LANG="en_US.UTF-8", HOME=str(work), AWS_EC2_METADATA_DISABLED="true",
                   THORAPI_SECRET_KEY=key, JWT_SECRET=key, THORAPI_LEGACY_SECRET_KEYS="")
        command = [*guard, jdk / "java", "-Xms640m", "-Xmx4g", "-XX:ActiveProcessorCount=4",
                   "-XX:MaxMetaspaceSize=1024m", "--add-opens=java.base/java.lang=ALL-UNNAMED",
                   f"-Duser.home={work}", f"-Djava.io.tmpdir={work}", f"-Dvalkyrai.file-service.local-root={work}/files",
                   f"-Dvalkyrai.runtime.classesDir={base}/classes", f"-Djwt.secret={key}", f"-DTHORAPI_SECRET_KEY={key}",
                   "-Dserver.address=127.0.0.1", "-Dhttp.proxyHost=127.0.0.1", "-Dhttp.proxyPort=9",
                   "-Dhttps.proxyHost=127.0.0.1", "-Dhttps.proxyPort=9", "-Dhttp.nonProxyHosts=localhost|127.*|[::1]", "-Dspring.main.web-application-type=servlet",
                   "-Dspring.output.ansi.enabled=never", f"-Dgraymatter.return.tasks={tasks_file}",
                   f"-Dgraymatter.return.observations={args.output.resolve()}", f"-javaagent:{args.agent.resolve()}",
                   "-cp", str(args.console.resolve()) + os.pathsep + cp,
                   "org.junit.platform.console.ConsoleLauncher", "execute", "--disable-banner", "--details=summary",
                   "--select-method", "com.valkyrlabs.valkyrai.sagechat.SourceProcedureReturnJpaTest#sourceOnly"]
        with args.log.open("x") as log:
            result = subprocess.run(command, cwd=work, env=env, stdout=log, stderr=subprocess.STDOUT)
        return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
