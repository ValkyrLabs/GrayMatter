import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const vaix = fileURLToPath(new URL("../vaix", import.meta.url));
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";

async function fixture(options, check) {
  const root = await mkdtemp(path.join(tmpdir(), "vaix-java-"));
  try {
    const bin = path.join(root, "bin"), state = path.join(root, "state");
    await mkdir(bin); await mkdir(state);
    for (const name of ["awk", "cat", "readlink", "dirname", "find", "sort", "head", "uname", "mktemp", "mkdir", "tar", "rm", "cp"]) {
      const located = spawnSync("/usr/bin/which", [name], { encoding: "utf8" });
      assert.equal(located.status, 0, name);
      await symlink(located.stdout.trim(), path.join(bin, name));
    }
    const java = async (name, major) => {
      const home = path.join(root, name); await mkdir(path.join(home, "bin"), { recursive: true });
      await writeFile(path.join(home, "bin/java"), `#!/bin/sh
printf '%s\\n' 'openjdk version "${major}.0.1"' >&2
case "$1" in -XshowSettings:properties)
 current_java="$0"
 while [ -L "$current_java" ]; do current_java="$(readlink "$current_java")"; done
 current_home="$(cd "$(dirname "$current_java")/.." && pwd)"
 printf '    java.home = %s\\n' "$current_home" >&2 ;;
esac
`, { mode: 0o755 });
      return home;
    };
    const envHome = options.envMajor === undefined ? "" : await java("environment JDK", options.envMajor);
    if (options.pathMajor !== undefined) {
      const target = path.join(await java("path-jdk", options.pathMajor), "bin/java");
      if (options.shim) await writeFile(path.join(bin, "java"), `#!/bin/sh\nexec ${quote(target)} "$@"\n`, { mode: 0o755 });
      else await symlink(target, path.join(bin, "java"));
    }
    const macHome = options.macMajor === undefined ? "" : await java("mac JDK", options.macMajor);
    for (const [index, major] of (options.cache || []).entries()) {
      const home = await java(`state/runtime/jdk-${options.minimum || 17}/${index}-jdk`, major);
      assert(home.startsWith(state));
    }
    const downloadLog = path.join(root, "downloads.log");
    if (options.download) {
      const home = await java("archive/private-jdk", 17), archive = path.join(root, "jdk.tar.gz");
      const packed = spawnSync("/usr/bin/tar", ["-czf", archive, "-C", path.dirname(home), path.basename(home)]);
      assert.equal(packed.status, 0);
      await writeFile(path.join(bin, "curl"), `#!/bin/bash\nprintf 'download\\n' >>${quote(downloadLog)}\nwhile [[ $# -gt 0 ]]; do\n if [[ "$1" == --output ]]; then /bin/cp ${quote(archive)} "$2"; exit; fi\n shift\ndone\nexit 2\n`, { mode: 0o755 });
    }
    const env = { PATH: bin, JAVA_HOME: envHome, VAIX_STATE_DIR: state, TMPDIR: root, VAIX_JAVA_MAJOR: String(options.minimum || 17) };
    const script = `source ${quote(vaix)} help >/dev/null\nthor_macos_java_home() {\n if [[ "$1" == ${quote(String(options.macMajor || "none"))} ]]; then printf '%s\\n' ${quote(macHome)}; fi\n}\nthor_ensure_java${options.repeat ? "\nthor_ensure_java" : ""}`;
    const result = spawnSync("/bin/bash", ["-c", script], { env, encoding: "utf8", timeout: 10000 });
    await check({ result, root, state, envHome, macHome, downloadLog });
  } finally { await rm(root, { recursive: true, force: true }); }
}

for (const major of [17, 21, 24]) test(`uses a supported explicit JDK ${major}, including paths with spaces`, () => fixture({ envMajor: major }, ({ result, envHome }) => {
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), path.join(envHome, "bin/java"));
}));

for (const major of [16, 25, 26, 27]) test(`skips unsupported JDK ${major} for a supported PATH JDK`, () => fixture({ envMajor: major, pathMajor: 21 }, ({ result, root }) => {
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), path.join(root, "path-jdk/bin/java"));
}));

test("resolves a version-manager shim to its physical JDK before deriving JAVA_HOME", () => fixture({ envMajor: 26, pathMajor: 21, shim: true }, ({ result, root }) => {
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), path.join(root, "path-jdk/bin/java"));
}));

test("finds a supported macOS JDK beneath a newer default", () => fixture({ envMajor: 26, pathMajor: 27, macMajor: 21 }, ({ result, macHome }) => {
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), path.join(macHome, "bin/java"));
}));

test("uses a compatible private cache when system Java is unsupported", () => fixture({ envMajor: 26, cache: [17] }, ({ result, state }) => {
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), path.join(state, "runtime/jdk-17/0-jdk/bin/java"));
}));

test("skips an incompatible cached executable before accepting a valid one", () => fixture({ cache: [26, 17] }, ({ result, state }) => {
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), path.join(state, "runtime/jdk-17/1-jdk/bin/java"));
}));

test("recovers an absent cache, downloads privately, and reuses it on repetition", () => fixture({ envMajor: 26, download: true, repeat: true }, async ({ result, state, downloadLog }) => {
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split("\n"), Array(2).fill(path.join(state, "runtime/jdk-17/private-jdk/bin/java")));
  assert.equal(await readFile(downloadLog, "utf8"), "download\n");
  assert.equal((await readFile(path.join(state, "java-home"), "utf8")).trim(), path.join(state, "runtime/jdk-17/private-jdk"));
}));

test("repairs an interrupted incompatible cache without adopting its Java", () => fixture({ envMajor: 26, cache: [27], download: true }, ({ result, state }) => {
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), path.join(state, "runtime/jdk-17/private-jdk/bin/java"));
}));

for (const minimum of ["16", "25", "26", "latest", "17+", "17;false"]) test(`rejects unsupported VAIX_JAVA_MAJOR=${minimum} before a download`, () => fixture({ envMajor: 26, minimum, download: true }, async ({ result, downloadLog }) => {
  assert.notEqual(result.status, 0); assert.match(result.stderr, /VAIX_JAVA_MAJOR.*17.*24/);
  await assert.rejects(readFile(downloadLog));
}));

test("honors a supported higher minimum", () => fixture({ envMajor: 17, pathMajor: 20, minimum: 21, cache: [21] }, ({ result, state }) => {
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), path.join(state, "runtime/jdk-21/0-jdk/bin/java"));
}));

test("reports an actionable offline prerequisite when no compatible JDK or downloader exists", () => fixture({ envMajor: 26 }, ({ result }) => {
  assert.notEqual(result.status, 0); assert.match(result.stderr, /Java.*17.*24.*curl|curl.*Java.*17.*24/);
}));
