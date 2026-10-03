import * as vscode from "vscode";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
// Build-time bundle of the already-tested host adapter; no ValorIDE runtime dependency.
import { connectLocalGrayMatterCommand } from "../shared/onboarding.cjs";
import { ensureBundledLiteSource, verifyLocalSetupPrerequisites } from "./liteSource";
const exec = promisify(execFile);
const requiredTools = ["memory_query", "memory_write", "graymatter_invariant_preflight"];
const LABEL_HOSTED = "GrayMatter Cloud";
const LABEL_LOCAL = "GrayMatter Lite (local, no signup)";
type Config = { command: string; args?: string[]; env?: Record<string, string>; timeout?: number };
type Connection = { kind: string; apiBase: string; profileName?: string; username?: string };

export async function activate(context: vscode.ExtensionContext) {
  const changes = new vscode.EventEmitter<void>();
  const output = vscode.window.createOutputChannel("GrayMatter");
  context.subscriptions.push(changes, output);
  const runtime = context.asAbsolutePath("runtime");
  // Indirection keeps the canonical portable modules as shipped source rather than duplicating auth logic.
  const dynamicImport = (uri: string) => import(uri);
  const connectionApi = await dynamicImport(pathToFileURL(path.join(runtime, "scripts/gm-connection.mjs")).href);
  const profilesFile = () => connectionApi.registryFile(process.env) as string;
  const cleanEnv = (): Record<string, string> => ({
    GRAYMATTER_PROFILES_FILE: profilesFile(), GRAYMATTER_STATE_DIR: path.dirname(profilesFile()),
    GRAYMATTER_PORTABLE_LAUNCH_ONLY: "true", GRAYMATTER_SKIP_SELF_UPDATE: "true",
    GRAYMATTER_PROFILE: "", GRAYMATTER_ACTIVE_PROFILE: "", GRAYMATTER_PROFILES: "", GRAYMATTER_BLEND_PROFILES: "", GRAYMATTER_PROFILE_MODE: "single", GRAYMATTER_PROFILE_RESOLVED: "",
    GRAYMATTER_LIGHT_MODE: "", GRAYMATTER_LIGHT_USERNAME: "", GRAYMATTER_LIGHT_PASSWORD: "", GRAYMATTER_USERNAME: "", VALKYR_USERNAME: "",
    GRAYMATTER_PASSWORD: "", VALKYR_PASSWORD: "", VALKYR_KEYCHAIN_SERVICE: "", VALKYR_USERNAME_KEYCHAIN_SERVICE: "", GRAYMATTER_XSRF_TOKEN: "",
    GRAYMATTER_SKIP_STARTUP_AUTH: "", GRAYMATTER_KEYCHAIN_UPDATE_DEFAULT: "1",
    VALKYR_AUTH_TOKEN: "", VALKYR_JWT_SESSION: "", VALKYR_AUTH: "", VALKYR_API_BASE: "",
    ELECTRON_RUN_AS_NODE: "1",
  });
  const cloudBase = () => connectionApi.normalizeApiBase(vscode.workspace.getConfiguration("graymatter").get<string>("hostedApiBase", "https://api-0.valkyrlabs.com/v1")) as string;
  const mode = () => context.globalState.get<"hosted" | "local">("graymatter.mode", "hosted");
  const nodeDefinition = (label: string, launcher: string, env: Record<string, string>) => {
    const definition = new vscode.McpStdioServerDefinition(label, process.execPath, [launcher, "--stdio"], { ...cleanEnv(), ...env, ELECTRON_RUN_AS_NODE: "1" }, "0.1.0");
    definition.cwd = vscode.Uri.file(path.dirname(path.dirname(launcher)));
    return definition;
  };
  const hostedDefinition = (connection?: Connection) => nodeDefinition(LABEL_HOSTED, path.join(runtime, "scripts/gm-mcp-launcher.mjs"), {
    VALKYR_API_BASE: connection?.profileName ? "" : cloudBase(), GRAYMATTER_LOCAL_ONLY: "",
    ...(connection?.profileName ? { GRAYMATTER_PROFILE: connection.profileName, GRAYMATTER_ACTIVE_PROFILE: connection.profileName, GRAYMATTER_PROFILE_RESOLVED: "" } : {}),
  });
  const localDefinition = () => nodeDefinition(LABEL_LOCAL, path.join(runtime, "scripts/gm-mcp-launcher.mjs"), {
    GRAYMATTER_PROFILE: "graymatter-lite-local", GRAYMATTER_ACTIVE_PROFILE: "graymatter-lite-local", GRAYMATTER_LOCAL_ONLY: "true",
  });
  const verify = async (definition: vscode.McpStdioServerDefinition) => {
    const client = new Client({ name: "graymatter-vscode-verification", version: "0.1.0" });
    const env = Object.fromEntries(Object.entries({ ...process.env, ...definition.env }).filter(([, value]) => typeof value === "string")) as Record<string, string>;
    const transport = new StdioClientTransport({ command: definition.command, args: definition.args, cwd: definition.cwd?.fsPath, env, stderr: "pipe" });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const tools = await Promise.race([(async () => { await client.connect(transport); return client.listTools(); })(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("MCP connection timed out. Verify the selected server is running, then retry.")), 25000); })]);
      if (!requiredTools.every(name => tools.tools.some(tool => tool.name === name))) throw new Error("The server connected but required GrayMatter memory tools are missing. Update GrayMatter, then verify again.");
      return tools.tools.map(tool => ({ name: tool.name }));
    } catch (error) { throw new Error(`GrayMatter memory tools did not connect. ${error instanceof Error ? error.message : String(error)} Run GrayMatter: Verify Connection or inspect the server in MCP: List Servers.`); }
    finally { if (timer) clearTimeout(timer); await client.close().catch(() => {}); }
  };
  const servers: Array<{ name: string; status: string; tools: Array<{ name: string }> }> = [];
  const hub = {
    async upsertServerConfig(name: string, config: Config) {
      // Verify with the shared source launcher first. Definitions subsequently use the identical packaged runtime.
      const definition = nodeDefinition(LABEL_LOCAL, config.command, config.env || {});
      const tools = await verify(definition);
      servers.splice(0, servers.length, { name, status: "connected", tools });
    },
    getServers: () => servers,
    async restartConnection() { await verify(localDefinition()); },
  };
  let pending: Promise<vscode.McpStdioServerDefinition> | undefined;
  const connectLocal = () => {
    if (pending) return pending;
    pending = (async () => {
      if (!vscode.workspace.isTrusted) throw new Error("Trust this workspace before running local GrayMatter source setup. Hosted memory is available separately.");
      if (process.platform === "win32") throw new Error("Local source setup uses Bash. Set up Lite in WSL or another supported environment, then use that environment's VS Code extension host.");
      await verifyLocalSetupPrerequisites();
      const root = context.globalState.get<string>("grayMatterLiteRoot") || await ensureBundledLiteSource(context.extensionPath, context.globalStorageUri.fsPath);
      // Supply a managed default without persisting selection before verification.
      const localContext = Object.create(context) as vscode.ExtensionContext;
      Object.defineProperty(localContext, "globalState", { value: {
        get: (key: string, fallback?: unknown) => context.globalState.get(key, key === "grayMatterLiteRoot" ? root : fallback),
        update: (key: string, value: unknown) => context.globalState.update(key, value),
      } });
      await connectLocalGrayMatterCommand(localContext, hub);
      const definition = localDefinition(); await verify(definition);
      await context.globalState.update("graymatter.mode", "local"); changes.fire();
      return definition;
    })().finally(() => { pending = undefined; });
    return pending;
  };
  const savedHostedConnection = (): Connection | undefined => {
    const name = context.globalState.get<string>("graymatter.hostedProfile");
    const connection = connectionApi.resolveConnection({ ...process.env, ...cleanEnv(), ...(name ? { GRAYMATTER_PROFILE: name, GRAYMATTER_ACTIVE_PROFILE: name } : {}) });
    return connection.kind === "hosted" && connection.apiBase === cloudBase() ? connection : undefined;
  };
  const hostedAccountVerified = async (connection?: Connection) => {
    if (!connection) return false;
    const result = await exec(process.execPath, [path.join(runtime, "scripts/gm-auth.mjs"), "read-token"], { env: { ...process.env, ...cleanEnv(), ...hostedDefinition(connection).env } as NodeJS.ProcessEnv, timeout: 15000, maxBuffer: 1024 * 1024 });
    const token = result.stdout.trim(); if (!token) return false;
    let response: Response;
    try { response = await fetch(`${connection.apiBase}/auth/me`, { headers: { Authorization: `Bearer ${token}` }, redirect: "manual", signal: AbortSignal.timeout(8000) }); }
    catch { throw new Error(`Cannot reach hosted GrayMatter at ${connection.apiBase}. Check the connection and selected server, then retry Verify Connection.`); }
    if (response.status === 401 || response.status === 403) return false;
    if (!response.ok) throw new Error(`Hosted GrayMatter at ${connection.apiBase} returned HTTP ${response.status}. Check the service and configured API URL, then retry Verify Connection.`);
    let session: { authenticated?: boolean; username?: string };
    try { session = await response.json(); }
    catch { throw new Error(`Hosted GrayMatter at ${connection.apiBase} did not return a valid sign-in response. Check the configured API URL, then retry Verify Connection.`); }
    return session.authenticated === true && Boolean(connection.username) && session.username?.toLowerCase() === connection.username!.toLowerCase();
  };
  const identifyHostedAccount = async (connection?: Connection): Promise<Connection | undefined> => {
    if (!connection || connection.username) return connection;
    const auth = await dynamicImport(pathToFileURL(path.join(runtime, "scripts/gm-auth.mjs")).href);
    return { ...connection, username: auth.readCredential(`${connectionApi.resolveConnection({ ...process.env, ...cleanEnv(), VALKYR_API_BASE: connection.apiBase }).keychainService}_USERNAME`, "default") };
  };
  const resolveHosted = async (interactive: boolean) => {
    let connection = await identifyHostedAccount(savedHostedConnection());
    if (!await hostedAccountVerified(connection)) {
      if (!interactive) throw new Error("Hosted GrayMatter is not authenticated for this account/server. Run GrayMatter: Connect Hosted Memory to sign in, then verify again.");
      const username = await vscode.window.showInputBox({ title: "Connect hosted GrayMatter", prompt: `Username for ${cloudBase()}. Use GrayMatter: Open Setup Guide to create or recover an account.`, value: connection?.username || "", ignoreFocusOut: true, validateInput: value => value.trim() ? undefined : "Enter your account username." });
      if (username === undefined) throw new Error("Hosted sign-in was canceled. Retry Connect Hosted Memory when ready, or choose local Lite without signup.");
      const password = await vscode.window.showInputBox({ title: "Connect hosted GrayMatter", prompt: `Password for ${username.trim()} at ${cloudBase()}. It is used only to sign in and is not saved.`, password: true, ignoreFocusOut: true, validateInput: value => value ? undefined : "Enter your account password." });
      if (password === undefined) throw new Error("Hosted sign-in was canceled. Retry Connect Hosted Memory when ready, or choose local Lite without signup.");
      // Existing portable auth performs login and vault storage; inputs stay out of settings and command arguments.
      try { await exec(process.execPath, [path.join(runtime, "scripts/gm-auth.mjs"), "keychain"], { env: { ...process.env, ...cleanEnv(), VALKYR_API_BASE: cloudBase(), GRAYMATTER_USERNAME: username.trim(), GRAYMATTER_PASSWORD: password }, timeout: 180000, maxBuffer: 1024 * 1024 }); }
      catch (error) { throw new Error((error as { stderr?: string }).stderr?.trim() || "Hosted sign-in did not complete. Check the selected server and account, then retry Connect Hosted Memory."); }
      connection = await identifyHostedAccount(connectionApi.resolveConnection({ ...process.env, ...cleanEnv() }, { preferSaved: true }));
    }
    if (connection?.kind !== "hosted" || connection.apiBase !== cloudBase()) throw new Error("The selected sign-in belongs to another server. Choose the configured hosted server/account, or use Connect Local GrayMatter Lite.");
    if (!await hostedAccountVerified(connection)) throw new Error("The hosted service did not verify the configured account. Reconnect the original server/account before retrying; local signup is not required.");
    // Pin the verified account before MCP launch, including the legacy default Cloud vault route.
    if (!connection.profileName) {
      connection = { ...connection, profileName: `vscode-hosted-${createHash("sha256").update(`${connection.apiBase}:${connection.username}`).digest("hex").slice(0, 12)}` };
      connectionApi.saveConnection(connection, { ...process.env, ...cleanEnv(), GRAYMATTER_KEYCHAIN_UPDATE_DEFAULT: "0" });
    }
    const definition = hostedDefinition(connection); await verify(definition);
    if (connection.profileName) await context.globalState.update("graymatter.hostedProfile", connection.profileName);
    return definition;
  };
  const provider: vscode.McpServerDefinitionProvider<vscode.McpStdioServerDefinition> = {
    onDidChangeMcpServerDefinitions: changes.event,
    provideMcpServerDefinitions: () => [mode() === "local" ? localDefinition() : hostedDefinition(savedHostedConnection())],
    resolveMcpServerDefinition: async (definition, token) => {
      if (token.isCancellationRequested) return undefined;
      if (definition.label === LABEL_LOCAL) { await connectLocal(); return localDefinition(); }
      return resolveHosted(true);
    },
  };
  context.subscriptions.push(vscode.lm.registerMcpServerDefinitionProvider("graymatter.memory", provider));
  const command = (name: string, action: () => Promise<unknown>) => {
    context.subscriptions.push(vscode.commands.registerCommand(name, async () => {
      try { return await action(); }
      catch (error) {
        const message = (error instanceof Error ? error.message : String(error)).replaceAll("ValorIDE", "VS Code");
        output.appendLine(message); output.show(true); void vscode.window.showErrorMessage(message);
        throw new Error(message);
      }
    }));
  };
  command("graymatter.connectLocal", connectLocal);
  command("graymatter.connectHosted", async () => {
    const definition = await resolveHosted(true);
    await context.globalState.update("graymatter.mode", "hosted"); changes.fire();
    void vscode.window.showInformationMessage("Hosted GrayMatter is verified. Enable GrayMatter tools in your agent's tool picker."); return definition;
  });
  command("graymatter.verifyConnection", async () => {
    const definition = mode() === "local" ? await connectLocal() : await resolveHosted(false);
    const tools = await verify(definition); void vscode.window.showInformationMessage("GrayMatter account and memory tools are verified."); return { definition, tools };
  });
  command("graymatter.openSetup", async () => vscode.env.openExternal(vscode.Uri.parse("https://valkyrlabs.com/graymatter/install")));
  command("graymatter.getStarted", async () => {
    const choice = await vscode.window.showQuickPick([{ label: "Hosted GrayMatter (recommended)", description: "Connect your valkyrlabs.com account", value: "hosted" }, { label: "Local GrayMatter Lite", description: "Set up included Lite; no hosted signup or source checkout", value: "local" }], { title: "Choose your GrayMatter memory" });
    if (choice) return vscode.commands.executeCommand(choice.value === "local" ? "graymatter.connectLocal" : "graymatter.connectHosted");
  });
  return { provider };
}
