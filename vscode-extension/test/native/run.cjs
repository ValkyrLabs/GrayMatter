const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const task = path.resolve(__dirname, '../..');
const pkg = require(path.join(task, 'package.json'));
const evidence = path.resolve(process.env.GRAYMATTER_ACCEPTANCE_EVIDENCE_DIR || path.join(task, 'output/native-acceptance'));
const editorCandidates = [process.env.GRAYMATTER_ACCEPTANCE_VSCODE_EXECUTABLE, '/Applications/Visual Studio Code.app/Contents/MacOS/Code', path.resolve(task, '../../ValorIDE/.vscode-test/vscode-darwin-arm64-1.136.1/Visual Studio Code.app/Contents/MacOS/Code')].filter(Boolean);
const valor = process.env.GRAYMATTER_ACCEPTANCE_SDK_ROOT || task;
const vsix = process.env.GRAYMATTER_ACCEPTANCE_VSIX || path.join(task, 'output', `${pkg.name}-${pkg.version}.vsix`);

(async () => {
  await fs.mkdir(evidence, {recursive:true});
  let editor; for (const candidate of editorCandidates) { if (await fs.stat(candidate).catch(()=>undefined)) {editor=candidate;break;} }
  if (!editor) throw new Error('Set GRAYMATTER_ACCEPTANCE_VSCODE_EXECUTABLE to a supported VS Code executable before running native acceptance.');
  const editorCli = process.env.GRAYMATTER_ACCEPTANCE_VSCODE_CLI || (editor.endsWith('/Contents/MacOS/Code') ? path.resolve(editor, '../../Resources/app/bin/code') : editor);
  const fixture = await fs.mkdtemp('/tmp/gm-vsix-native-'); await fs.chmod(fixture, 0o700);
  const gray = path.join(fixture, 'no-source-checkout');
  const freePort = async () => { const listener = net.createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve)); const port = listener.address().port; await new Promise(resolve => listener.close(resolve)); return port; };
  const env = { ...process.env, GRAYMATTER_LITE_BUNDLE_DIR: path.join(fixture, 'bundle'), VAIX_STATE_DIR: path.join(fixture, 'vaix'), GRAYMATTER_STATE_DIR: path.join(fixture, 'state'), GRAYMATTER_PROFILES_FILE: path.join(fixture, 'profiles.json'), GRAYMATTER_DATA_DIR: path.join(fixture, 'h2'), GRAYMATTER_ADMIN_USERNAME: 'native-local-fixture', GRAYMATTER_ADMIN_PASSWORD: 'disposable-native-fixture-only', GRAYMATTER_LITE_PORT: String(await freePort()), GRAYMATTER_MCP_PORT: String(await freePort()), VALKYR_AUTH_TOKEN: '', VALKYR_JWT_SESSION: '', VALKYR_AUTH: '', VALORIDE_GRAYMATTER_PLUGIN_ROOT: gray, VALORIDE_ONBOARDING_FIXTURE: fixture, VALORIDE_ONBOARDING_PORTABLE: valor, ...(process.env.JAVA_HOME ? {JAVA_HOME:process.env.JAVA_HOME} : process.platform === 'darwin' ? {JAVA_HOME:'/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home'} : {}) };
  env.VALORIDE_GRAYMATTER_PLUGIN_ROOT = '';
  const timeout = setTimeout(() => { console.error('Standalone VSIX fixture exceeded the bounded deadline'); process.exitCode = 1; }, 300000);
  let failure, firstRun;
  try {
    env.TMPDIR = path.join(fixture, 'test-tmp'); await fs.mkdir(env.TMPDIR);
    // Capture only vaix task output; installed VSIX/source bytes stay unchanged.
    env.BASH_ENV = path.join(fixture, 'task-log-env.sh');
    await fs.writeFile(env.BASH_ENV, 'case "$0" in */vaix) exec > >(tee -a "${VALORIDE_ONBOARDING_FIXTURE}/task-output.log") 2>&1 ;; esac\n');
    if(process.env.GRAYMATTER_ACCEPTANCE_SMOKE!=='1'){
      const repository = path.join(fixture, 'maven-cache'); await exec('/bin/cp', [process.platform === 'darwin' ? '-cR' : '-a', path.join(os.homedir(), '.m2/repository'), repository], { timeout: 90000 });
      env.MAVEN_ARGS = `-o -Dmaven.repo.local=${repository}`;
    }
    await fs.writeFile(env.GRAYMATTER_PROFILES_FILE, JSON.stringify({ version: 1, mode: 'single', activeProfile: 'cloud', blendProfiles: [], profiles: { cloud: { kind: 'hosted', username: 'unused-fixture-cloud', apiBase: 'https://api-0.valkyrlabs.com/v1' } } }));
    const user = path.join(fixture, 'editor-user/User'); await fs.mkdir(user, { recursive: true });
    await fs.writeFile(path.join(user, 'settings.json'), JSON.stringify({ 'telemetry.telemetryLevel': 'off', 'update.mode': 'none', 'extensions.autoUpdate': false, 'extensions.autoCheckUpdates': false, 'workbench.startupEditor': 'none', 'window.confirmBeforeClose': 'never', 'terminal.integrated.confirmOnExit': 'never', 'terminal.integrated.env.osx': {BASH_ENV:env.BASH_ENV,VALORIDE_ONBOARDING_FIXTURE:fixture}, 'terminal.integrated.env.linux': {BASH_ENV:env.BASH_ENV,VALORIDE_ONBOARDING_FIXTURE:fixture}, 'valoride.webview.useDevServer': false }));
    const workspace = path.join(fixture, 'Onboarding Acceptance'); await fs.mkdir(workspace); await fs.writeFile(path.join(workspace, 'README.txt'), 'Disposable native onboarding acceptance. No hosted account.');
    const extensions = path.join(fixture,'extensions');
    const cli = editorCli;
    const install = await exec(cli,['--install-extension',vsix,`--user-data-dir=${path.join(fixture,'editor-user')}`,`--extensions-dir=${extensions}`],{env,timeout:60000});
    if (!/successfully installed/i.test(install.stdout)) throw new Error('VSIX installation did not confirm success.');
    const folder=(await fs.readdir(extensions)).find(name=>name.startsWith(`${pkg.publisher}.${pkg.name}-${pkg.version}`.toLowerCase()));
    if (!folder) throw new Error('Installed VSIX folder missing.');
    const installed=path.join(extensions,folder);
    // VS Code intentionally uses in-memory globalState whenever extensionTestsPath is set.
    // A disposable API-only driver runs in a normal development host so profile storage survives quit/reopen.
    const driver=path.join(fixture,'acceptance-driver');await fs.mkdir(driver);
    await fs.writeFile(path.join(driver,'package.json'),JSON.stringify({name:'graymatter-onboarding-acceptance',publisher:'disposable-fixture',version:'0.0.0',engines:{vscode:'^1.103.0'},activationEvents:['onStartupFinished'],main:'./driver.cjs'}));
    await fs.writeFile(path.join(driver,'driver.cjs'),`const vscode=require('vscode');exports.activate=()=>{setTimeout(async()=>{try{await require(${JSON.stringify(path.join(__dirname,'runner.cjs'))}).run()}catch(error){console.error('Native acceptance failed: '+error.message)}finally{await vscode.commands.executeCommand('workbench.action.quit')}},0)};`);
    console.log(JSON.stringify({fixture,stage:'Actual VSIX installed into disposable persistent profile; launch stable MCP provider',dependencyCached:true,storageHarness:'Normal VS Code host with API-only driver; no extensionTestsPath'}));
    const runEditor = async () => {
      const result=await exec(editor,[workspace,`--extensionDevelopmentPath=${installed}`,`--extensionDevelopmentPath=${driver}`,'--disable-extensions','--disable-workspace-trust','--skip-welcome','--skip-release-notes','--disable-telemetry',`--user-data-dir=${path.join(fixture,'editor-user')}`,`--shared-data-dir=${path.join(fixture,'editor-shared')}`,`--extensions-dir=${extensions}`],{env,timeout:260000,maxBuffer:4*1024*1024});
      console.log(result.stdout);console.error(result.stderr);
      const acceptance=JSON.parse(await fs.readFile(path.join(fixture,'native-result.json'),'utf8'));if(!acceptance.passed)throw new Error(acceptance.error||'Native acceptance failed.');
    };
    await runEditor();
    if(process.env.GRAYMATTER_ACCEPTANCE_SMOKE!=='1'){
      firstRun=JSON.parse(await fs.readFile(path.join(fixture,'native-result.json'),'utf8')); if(!firstRun.passed)throw new Error('First installed-editor run did not pass.');
      const descriptor=JSON.parse(await fs.readFile(path.join(installed,'lite-source.json'),'utf8'));
      const sourceRoot=path.join(fixture,'editor-user/User/globalStorage/valkyrlabsinc.graymatter-memory/lite',descriptor.sha256);
      await exec('/bin/bash',[path.join(sourceRoot,'vaix'),'stop'],{env,timeout:30000});
      env.GRAYMATTER_ACCEPTANCE_RESTART='1';
      console.log(JSON.stringify({stage:'Reopen the same editor profile with Lite stopped; verify saved selection, private cache and offline memory'}));
      await runEditor();
    }
  } catch (error) { failure = error; }
  finally {
    clearTimeout(timeout);
    // Process arguments, not remembered PIDs, establish ownership. The source, JAR and editor profile paths are all fixture-specific.
    const before = await exec('/bin/ps', ['-axo', 'pid,ppid,command']);
    const lines = before.stdout.split('\n'); let stopped = 0;
    for (const line of lines) { const match = line.match(/^\s*(\d+)\s+\d+\s+(.+)$/); if (match && match[2].includes(fixture) && /(?:Code|Electron|graymatter-local-server\.jar|mcp-server\/index\.js|gm-mcp-launcher\.mjs|chrome_crashpad_handler)/.test(match[2])) { try { process.kill(Number(match[1]), 'SIGTERM'); stopped++; } catch {} } }
    let result;
    try { result = JSON.parse(await fs.readFile(path.join(fixture, 'native-result.json'), 'utf8')); }
    catch { result = { passed: false, error: failure?.message || 'Native runner did not publish a result', checks: {} }; }
    const diagnostic = await fs.readFile(path.join(fixture, 'task-output.log'), 'utf8').catch(() => 'No fixture task output.');
    await fs.writeFile(path.join(evidence, 'native-task-output.log'), diagnostic.replaceAll(env.GRAYMATTER_ADMIN_PASSWORD, '[disposable password redacted]'));
    if(firstRun){result={...firstRun,...result,checks:{...firstRun.checks,...result.checks},editorRestart:true};}
    result.fixtureCleanup = { processIdentityVerified: true, stopped, credentialsAndH2Removed: false };
    const resultFile=path.join(evidence, 'native-result.json');await fs.writeFile(resultFile,JSON.stringify(result,null,2)+'\n');
    // H2's final shutdown write may race recursive removal immediately after editor quit.
    await fs.rm(fixture, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
    result.fixtureCleanup.credentialsAndH2Removed=true;
    await fs.writeFile(resultFile, JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result, null, 2));
  }
  if (failure) throw failure;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
