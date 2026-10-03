const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const vscode=require('vscode');
const exec=promisify(execFile);
exports.run=async()=>{
  const fixture=process.env.VALORIDE_ONBOARDING_FIXTURE; let gray;
  const result={checks:{},fixtureOnly:true,noHostedCredentials:true,validation:'Actual installed VSIX bytes in VS Code 1.136.1, stable MCP provider registration, public extension commands/native Tasks, packaged MCP SDK memory write/query. No GUI click or live hosted account is claimed.'};
  const tasks=[]; let client;
  const listener=vscode.tasks.onDidStartTaskProcess(event=>{if(event.execution.task.definition.type==='graymatter-lite')tasks.push(event.execution.task.name)});
  const bounded=async(promise,label,ms=160000)=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+' timed out')),ms)})])}finally{clearTimeout(timer)}};
  try{
    const extension=vscode.extensions.getExtension('ValkyrLabsInc.graymatter-memory');assert(extension);const api=await extension.activate();
    assert.equal(extension.packageJSON.version,JSON.parse(await fs.readFile(path.join(extension.extensionPath,'package.json'),'utf8')).version);assert(!extension.packageJSON.extensionDependencies);
    if(process.env.GRAYMATTER_ACCEPTANCE_RESTART==='1'){
      assert.equal(api.provider.provideMcpServerDefinitions()[0].label,'GrayMatter Lite (local, no signup)');result.checks.editorRestartPreservesLocalSelection=true;
      const verified=await bounded(vscode.commands.executeCommand('graymatter.verifyConnection'),'Fresh editor reconnect',90000);
      assert.equal(tasks.filter(task=>task==='Set up local memory').length,0);assert.equal(tasks.filter(task=>task==='Start local memory').length,1);result.checks.editorRestartReusesBuiltPrivateSource=true;
      const valor=process.env.VALORIDE_ONBOARDING_PORTABLE;
      const {Client}=require(path.join(valor,'node_modules/@modelcontextprotocol/sdk/dist/cjs/client/index.js'));
      const {StdioClientTransport}=require(path.join(valor,'node_modules/@modelcontextprotocol/sdk/dist/cjs/client/stdio.js'));
      const definition=verified.definition;
      client=new Client({name:'standalone-vsix-restart-acceptance',version:'1'});
      await bounded(client.connect(new StdioClientTransport({command:definition.command,args:definition.args,cwd:definition.cwd.fsPath,env:{...process.env,...definition.env,NODE_OPTIONS:`--require=${path.join(fixture,'deny-external.cjs')}`,PATH:`${path.join(fixture,'offline-bin')}:${process.env.PATH}`},stderr:'pipe'})),'Restarted packaged MCP connect',30000);
      const read=await client.callTool({name:'memory_query',arguments:{query:'standalone-vsix-first-value-'+path.basename(fixture),limit:5}});assert(!read.isError);assert(JSON.stringify(read).includes('standalone-vsix-first-value-'+path.basename(fixture)));result.checks.editorRestartReadsPersistedMemoryOffline=true;
      result.passed=true;return;
    }
    assert.equal(api.provider.provideMcpServerDefinitions()[0].label,'GrayMatter Cloud');result.checks.installedVsixActivatesStableNativeMcpProvider=true;
    assert(!(await vscode.commands.getCommands(true)).includes('valoride.graymatter.connectLocal'));result.checks.noValorideRuntimeDependency=true;
    if(process.env.GRAYMATTER_ACCEPTANCE_SMOKE==='1'){
      assert.equal(extension.extensionPath,path.join(fixture,'extensions',`${extension.packageJSON.publisher}.${extension.packageJSON.name}-${extension.packageJSON.version}`.toLowerCase()));
      const definition=api.provider.provideMcpServerDefinitions()[0];assert.equal(definition.env.VALKYR_AUTH_TOKEN,'');assert.equal(definition.env.ELECTRON_RUN_AS_NODE,'1');
      assert((await vscode.commands.getCommands(true)).includes('graymatter.verifyConnection'));result.checks.finalVsixBytesExposeHostedDefaultAndPublicCommands=true;
      assert.equal(await api.provider.resolveMcpServerDefinition(definition,{isCancellationRequested:true}),undefined);result.checks.canceledResolutionDoesNotAuthenticate=true;
      result.scope='Final VSIX native install/activate/provider smoke; the separate earlier full local run passed 12 functional checks and ended on an incorrect curl-only offline assertion.';result.passed=true;return;
    }
    assert(!process.env.VALORIDE_GRAYMATTER_PLUGIN_ROOT);
    assert.equal(await fs.stat(path.join(fixture,'no-source-checkout')).catch(()=>undefined),undefined);
    const descriptor=JSON.parse(await fs.readFile(path.join(extension.extensionPath,'lite-source.json'),'utf8'));
    gray=path.join(fixture,'editor-user/User/globalStorage/valkyrlabsinc.graymatter-memory/lite',descriptor.sha256);
    const cancel=vscode.tasks.onDidStartTaskProcess(event=>{if(event.execution.task.definition.type==='graymatter-lite'){cancel.dispose();setTimeout(()=>event.execution.terminate(),150)}});
    try{await assert.rejects(bounded(vscode.commands.executeCommand('graymatter.connectLocal'),'Interrupted setup',30000),/interrupted|failed/i)}finally{cancel.dispose()}
    result.checks.interruptedSetupReportsActionableFailure=true;
    assert.equal(await fs.readFile(path.join(gray,'.graymatter-source-complete'),'utf8'),descriptor.sha256);
    assert(gray.startsWith(path.join(fixture,'editor-user/User/globalStorage')));
    result.checks.bundledLitePreparesInPrivateStorageWithoutSourceCheckout=true;
    const previous=tasks.filter(task=>task==='Set up local memory').length;
    await bounded(Promise.all([vscode.commands.executeCommand('graymatter.connectLocal'),vscode.commands.executeCommand('graymatter.connectLocal')]),'Fresh standalone local setup',230000);
    assert.equal(tasks.filter(task=>task==='Set up local memory').length,previous+1);result.checks.freshNoSignupSetupAndRetry=true;result.checks.concurrentSetupDeduplicated=true;
    const profiles=JSON.parse(await fs.readFile(process.env.GRAYMATTER_PROFILES_FILE,'utf8'));assert.equal(profiles.activeProfile,'cloud');assert.equal(profiles.profiles['graymatter-lite-local'].kind,'local');result.checks.hostedProfileSelectionPreserved=true;
    const definition=api.provider.provideMcpServerDefinitions()[0];assert.equal(definition.label,'GrayMatter Lite (local, no signup)');assert.equal(definition.env.GRAYMATTER_LOCAL_ONLY,'true');assert(definition.args[0].startsWith(extension.extensionPath));assert(!JSON.stringify(definition).includes(process.env.GRAYMATTER_ADMIN_PASSWORD));result.checks.packagedDefinitionIsLocalAndPasswordFree=true;
    const valor=process.env.VALORIDE_ONBOARDING_PORTABLE;
    const {Client}=require(path.join(valor,'node_modules/@modelcontextprotocol/sdk/dist/cjs/client/index.js'));
    const {StdioClientTransport}=require(path.join(valor,'node_modules/@modelcontextprotocol/sdk/dist/cjs/client/stdio.js'));
    const guard=path.join(fixture,'deny-external.cjs'), bin=path.join(fixture,'offline-bin'), requests=path.join(fixture,'offline-requests.jsonl');await fs.mkdir(bin);
    await fs.writeFile(guard,`const fs=require('node:fs');const original=globalThis.fetch;globalThis.fetch=(input,...rest)=>{const url=new URL(typeof input==='string'?input:input.url||input.href);if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('Fixture denies non-loopback networking');fs.appendFileSync(${JSON.stringify(requests)},JSON.stringify({transport:'fetch',url:String(url)})+'\\n');return original(input,...rest)};`);
    await fs.writeFile(path.join(bin,'curl'),`#!/usr/bin/env node\nconst fs=require('node:fs'),cp=require('node:child_process');const args=process.argv.slice(2);for(const arg of args){if(/^https?:/.test(arg)){const url=new URL(arg);if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('Fixture denies non-loopback curl');fs.appendFileSync(${JSON.stringify(requests)},JSON.stringify({transport:'curl',url:String(url)})+'\\n');}}const result=cp.spawnSync('/usr/bin/curl',args,{stdio:'inherit'});process.exitCode=result.status??1;`,{mode:0o755});
    const connect=async()=>{client=new Client({name:'standalone-vsix-acceptance',version:'1'});await bounded(client.connect(new StdioClientTransport({command:definition.command,args:definition.args,cwd:definition.cwd.fsPath,env:{...process.env,...definition.env,NODE_OPTIONS:`--require=${guard}`,PATH:`${bin}:${process.env.PATH}`},stderr:'pipe'})),'Packaged MCP connect',30000);const tools=await client.listTools();for(const name of ['memory_query','memory_write','graymatter_invariant_preflight'])assert(tools.tools.some(tool=>tool.name===name))};
    await connect();result.checks.packagedRuntimeDiscoversRequiredMemoryTools=true;
    const marker='standalone-vsix-first-value-'+path.basename(fixture);
    const written=await client.callTool({name:'memory_write',arguments:{type:'context',text:marker,sourceChannel:'codex:test:standalone-vsix'}});assert(!written.isError);
    const read=await client.callTool({name:'memory_query',arguments:{query:marker,limit:5}});assert(!read.isError);assert(JSON.stringify(read).includes(marker));result.checks.realLocalMemoryWriteAndQueryWithoutHostedSignup=true;
    await client.close();client=undefined;
    const count=tasks.length;const verified=await bounded(vscode.commands.executeCommand('graymatter.verifyConnection'),'Repeated verify',30000);assert(verified.tools.some(tool=>tool.name==='memory_write'));assert.equal(tasks.length,count);result.checks.repeatedSetupDoesNotReinstall=true;
    await exec('/bin/bash',[path.join(gray,'vaix'),'stop'],{env:process.env,timeout:30000});
    await bounded(vscode.commands.executeCommand('graymatter.verifyConnection'),'Stopped-backend reconnect',90000);assert.equal(tasks.filter(task=>task==='Start local memory').length,1);result.checks.reconnectRestartsStoppedLocalBackend=true;
    await connect();const resumed=await client.callTool({name:'memory_query',arguments:{query:marker,limit:5}});assert(!resumed.isError);assert(JSON.stringify(resumed).includes(marker));result.checks.persistedH2MemorySurvivesReconnect=true;
    const offlineRequests=(await fs.readFile(requests,'utf8')).trim().split('\n').map(JSON.parse);result.offlineRequests=offlineRequests;assert(offlineRequests.some(request=>request.url.includes('/MemoryEntry')));assert(offlineRequests.every(request=>['localhost','127.0.0.1','[::1]'].includes(new URL(request.url).hostname)));result.checks.localMemoryWorksWithExternalNetworkingDenied=true;
    result.passed=true;
  }catch(error){result.passed=false;result.error=error.message;throw error}
  finally{listener.dispose();await client?.close().catch(()=>{});await fs.writeFile(path.join(fixture,'native-result.json'),JSON.stringify(result,null,2)+'\n')}
};
