import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);

export async function verifyLocalSetupPrerequisites(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  let missing: string;
  try {
    const result = await exec("/bin/bash", ["-c", 'for tool in curl tar jq zip; do command -v "$tool" >/dev/null 2>&1 || printf "%s " "$tool"; done'], { env, timeout: 5000, maxBuffer: 4096 });
    missing = result.stdout.trim();
  } catch {
    throw new Error("Local GrayMatter Lite requires Bash on the extension host. Use macOS/Linux or a WSL/remote Linux VS Code host, then retry Connect Local GrayMatter Lite.");
  }
  if (missing) throw new Error(`Local GrayMatter Lite needs these tools on the extension host: ${missing}. Install the missing tools using your operating system's package manager, then retry Connect Local GrayMatter Lite. Java, Maven and Node are installed privately when needed; no hosted signup is required.`);
}

/** Prepare shipped, licensed source in writable extension storage. */
export async function ensureBundledLiteSource(extensionRoot: string, storageRoot: string): Promise<string> {
  const descriptor = JSON.parse(await fs.readFile(path.join(extensionRoot, "lite-source.json"), "utf8")) as { version: number; sha256: string; sizeBytes: number };
  if (descriptor.version !== 1 || !/^[a-f0-9]{64}$/.test(descriptor.sha256) || !Number.isSafeInteger(descriptor.sizeBytes) || descriptor.sizeBytes < 1 || descriptor.sizeBytes > 32 * 1024 * 1024) {
    throw new Error("The bundled Lite source is invalid. Reinstall Valkyr GrayMatter from the verified VSIX, then retry local setup.");
  }
  const target = path.join(storageRoot, "lite", descriptor.sha256);
  const marker = path.join(target, ".graymatter-source-complete");
  if (await fs.readFile(marker, "utf8").catch(() => "") === descriptor.sha256) return target;
  if (await fs.lstat(target).catch(() => undefined)) throw new Error(`The private Lite source cache is incomplete at ${target}. Restore or rename that cache folder before retrying; existing local memory has been preserved.`);
  const archive = path.join(extensionRoot, "lite-source.tar.gz");
  const bytes = await fs.readFile(archive);
  if (bytes.length !== descriptor.sizeBytes || createHash("sha256").update(bytes).digest("hex") !== descriptor.sha256) {
    throw new Error("The bundled Lite source checksum did not match. Reinstall Valkyr GrayMatter from the verified VSIX, then retry local setup.");
  }
  const parent = path.dirname(target); await fs.mkdir(parent, { recursive: true, mode: 0o700 });
  const stage = await fs.mkdtemp(path.join(parent, ".staging-")); await fs.chmod(stage, 0o700);
  try {
    await exec("tar", ["-xzf", archive, "-C", stage], { timeout: 30000, maxBuffer: 1024 * 1024 });
    for (const relative of ["vaix", "scripts/gm-connection.mjs", "scripts/gm-mcp-launcher.mjs", "templates/graymatter-light-bootstrap/local-server/pom.xml", "LICENSE"]) await fs.access(path.join(stage, relative));
    await fs.chmod(path.join(stage, "vaix"), 0o755);
    await fs.writeFile(path.join(stage, ".graymatter-source-complete"), descriptor.sha256, { mode: 0o600 });
    try { await fs.rename(stage, target); }
    catch (error) {
      if (await fs.readFile(marker, "utf8").catch(() => "") !== descriptor.sha256) throw error;
    }
    return target;
  } catch (error) {
    throw new Error("Lite source preparation did not complete. Retry Connect Local GrayMatter Lite. " + (error instanceof Error ? error.message : String(error)));
  } finally { await fs.rm(stage, { recursive: true, force: true }); }
}
