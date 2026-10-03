const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const Module = require('node:module');
const test = require('node:test');

test('standalone provider uses the shipped MCP runtime and scoped hosted account', async t => {
  const root = path.resolve(__dirname, '..');
  const fixture = await fs.mkdtemp('/tmp/gm-provider-'); await fs.chmod(fixture, 0o700);
  const priorEnv = { ...process.env };
  const commands = new Map(), state = new Map(), output = [], registrations = [];
  const inputs = [], prompts = [];
  let base = 'https://api-0.valkyrlabs.com/v1', account = 'fixture-hosted', loginCount = 0;
  let authStatus = 200, badJson = false;
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', data => body += data); req.on('end', () => {
      requests.push({ url: req.url, authorization: req.headers.authorization, body });
      res.setHeader('Content-Type','application/json');
      if (req.url === '/v1/auth/login') { loginCount++; res.end('{"token":"disposable-hosted-session"}'); }
      else if (req.url === '/v1/auth/me') { res.statusCode=authStatus; if(authStatus===302)res.setHeader('Location','https://another.invalid/v1/auth/me');res.end(badJson?'not-json':JSON.stringify({ authenticated: true, username: account })); }
      else { res.statusCode = 404; res.end('{}'); }
    });
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const hostedFixtureBase = `http://127.0.0.1:${server.address().port}/v1`;
  let context;
  const vscode = {
    EventEmitter: class { event = () => ({dispose(){}}); fire(){} dispose(){} },
    McpStdioServerDefinition: class { constructor(label, command, args, env, version) { Object.assign(this,{label,command,args,env,version}); } },
    Uri: {file: fsPath => ({fsPath}), parse: value => ({value})},
    workspace: { isTrusted: false, workspaceFolders: [], getConfiguration: () => ({get: () => base}) },
    window: { createOutputChannel: () => ({appendLine:value=>output.push(value),show(){},dispose(){}}), showErrorMessage:async()=>{}, showInformationMessage:async()=>{}, showQuickPick:async()=>undefined, showInputBox:async options=>{prompts.push(options);return inputs.shift();} },
    lm: {registerMcpServerDefinitionProvider:(id,provider)=>{registrations.push({id,provider});return {dispose(){}}}},
    commands: {registerCommand:(name,fn)=>{commands.set(name,fn);return {dispose(){}}}, executeCommand:async name=>commands.get(name)()},
    env:{openExternal:async()=>true},
  };
  try {
    const runtime = path.join(fixture,'runtime'); await fs.cp(path.join(root,'runtime'),runtime,{recursive:true});
    // Exercise the canonical legacy Cloud vault branch against loopback, without a live account.
    const connectionFile = path.join(runtime,'scripts/gm-connection.mjs');
    await fs.writeFile(connectionFile,(await fs.readFile(connectionFile,'utf8')).replace("export const CLOUD_API_BASE = 'https://api-0.valkyrlabs.com/v1';",`export const CLOUD_API_BASE = ${JSON.stringify(hostedFixtureBase)};`));
    const bin = path.join(fixture,'bin'); await fs.mkdir(bin);
    const vault = path.join(fixture,'vault.json');
    await fs.writeFile(path.join(bin,'security'), `#!${process.execPath}\nconst fs=require('node:fs');const args=process.argv.slice(2),file=${JSON.stringify(vault)};const get=key=>args[args.indexOf(key)+1];let value={};try{value=JSON.parse(fs.readFileSync(file,'utf8'))}catch{};const key=get('-s')+':'+get('-a');if(args[0]==='find-generic-password'){if(value[key])process.stdout.write(value[key]);else process.exitCode=44;}else if(args[0]==='add-generic-password'){value[key]=get('-w');fs.writeFileSync(file,JSON.stringify(value),{mode:0o600});}else if(args[0]==='delete-generic-password'){delete value[key];fs.writeFileSync(file,JSON.stringify(value),{mode:0o600});}\n`,{mode:0o755});
    Object.assign(process.env,{GRAYMATTER_STATE_DIR:path.join(fixture,'state'),GRAYMATTER_PROFILES_FILE:path.join(fixture,'profiles.json'),GRAYMATTER_TEST_PLATFORM:'darwin',PATH:`${bin}:${priorEnv.PATH}`,VALKYR_AUTH_TOKEN:'ambient-token-must-not-route',VALKYR_JWT_SESSION:'ambient-token-must-not-route',VALKYR_API_BASE:'https://unselected.invalid/v1',VALKYR_KEYCHAIN_SERVICE:'unselected-vault',GRAYMATTER_MAX_INTERACTIVE_ATTEMPTS:'1'});
    context={subscriptions:[],asAbsolutePath:relative=>path.join(fixture,relative),globalState:{get:(key,fallback)=>state.has(key)?state.get(key):fallback,update:async(key,value)=>{state.set(key,value);}}};
    const load = Module._load;
    let extension;
    try { Module._load=function(name,...rest){return name==='vscode'?vscode:load.call(this,name,...rest)}; extension=require('../dist/extension.cjs'); }
    finally {Module._load=load;}
    const {provider} = await extension.activate(context);
    await t.test('registers the stable native provider and command surfaces',()=>{
      assert.equal(registrations[0].id,'graymatter.memory'); assert.equal(commands.size,5);
    });
    await t.test('listing is hosted by default and does not access credentials or the network',async()=>{
      const [definition]=provider.provideMcpServerDefinitions(); assert.equal(definition.label,'GrayMatter Cloud');
      assert.equal(definition.env.VALKYR_API_BASE,base); assert.equal(definition.command,process.execPath);
      assert.equal(definition.env.VALKYR_AUTH_TOKEN,''); assert.equal(definition.env.VALKYR_KEYCHAIN_SERVICE,'');
      assert.equal(definition.env.ELECTRON_RUN_AS_NODE,'1'); assert.equal(requests.length,0);
      assert.equal(await fs.stat(vault).catch(()=>undefined),undefined);
    });
    await t.test('canceled provider resolution has no login side effects',async()=>{
      assert.equal(await provider.resolveMcpServerDefinition(provider.provideMcpServerDefinitions()[0],{isCancellationRequested:true}),undefined);
      assert.equal(loginCount,0);
    });
    await t.test('untrusted local setup gives an actionable error before executing source',async()=>{
      await assert.rejects(commands.get('graymatter.connectLocal')(),/Trust this workspace/);
      assert.equal(state.get('graymatter.mode'),undefined);
    });
    base=hostedFixtureBase;
    await t.test('noninteractive hosted verification requires sign-in and does not prompt',async()=>{
      await assert.rejects(commands.get('graymatter.verifyConnection')(),/Connect Hosted Memory/); assert.equal(loginCount,0);assert.equal(prompts.length,0);
    });
    await t.test('canceling hosted sign-in does not create credentials or change selection',async()=>{
      await assert.rejects(commands.get('graymatter.connectHosted')(),/sign-in was canceled/);assert.equal(loginCount,0);assert.equal(state.get('graymatter.mode'),undefined);
    });
    inputs.push('fixture-hosted','disposable-password');
    let definition;
    await t.test('interactive hosted setup verifies account and real packaged MCP tools',async()=>{
      definition=await commands.get('graymatter.connectHosted')(); assert.equal(loginCount,1);
      assert.equal(state.get('graymatter.mode'),'hosted'); assert.match(definition.env.GRAYMATTER_PROFILE,/^vscode-hosted-/);
      assert.equal(JSON.parse(requests.find(r=>r.url==='/v1/auth/login').body).username,'fixture-hosted');
      assert.equal(prompts.at(-1).password,true); assert(prompts.at(-1).prompt.includes(base));
    });
    await t.test('legacy Cloud vault identity becomes an account-bound profile without changing selection',async()=>{
      const registry=JSON.parse(await fs.readFile(process.env.GRAYMATTER_PROFILES_FILE,'utf8'));
      assert.equal(registry.mode,'legacy'); assert.equal(registry.activeProfile,null);
      assert.equal(registry.profiles[definition.env.GRAYMATTER_PROFILE].username,'fixture-hosted');
      assert.equal(registry.profiles[definition.env.GRAYMATTER_PROFILE].apiBase,base);
    });
    await t.test('tokens and passwords are absent from definitions, global state and output',()=>{
      assert.doesNotMatch(JSON.stringify({definition,state:[...state],output}),/disposable-hosted-session|disposable-password|ambient-token-must-not-route/);
    });
    await t.test('repeated hosted connect reuses scoped credentials and verifies without login',async()=>{
      const connected=await commands.get('graymatter.verifyConnection')();
      for(const name of ['memory_query','memory_write','graymatter_invariant_preflight']) assert(connected.tools.some(tool=>tool.name===name));
      await commands.get('graymatter.connectHosted')(); assert.equal(loginCount,1);
    });
    await t.test('a different authenticated account is rejected before exposing tools',async()=>{
      account='other-account'; await assert.rejects(commands.get('graymatter.verifyConnection')(),/not authenticated for this account/); assert.equal(loginCount,1); account='fixture-hosted';
    });
    await t.test('unavailable hosted service reports its status without another sign-in prompt',async()=>{
      const before=prompts.length;authStatus=503;await assert.rejects(commands.get('graymatter.verifyConnection')(),/HTTP 503.*Check the service/);assert.equal(prompts.length,before);assert.equal(loginCount,1);authStatus=200;
    });
    await t.test('auth redirects are rejected with an actionable configured-server error',async()=>{
      authStatus=302;await assert.rejects(commands.get('graymatter.verifyConnection')(),/HTTP 302.*configured API URL/);authStatus=200;
    });
    await t.test('invalid hosted sign-in response gives an API URL repair instruction',async()=>{
      badJson=true;await assert.rejects(commands.get('graymatter.verifyConnection')(),/valid sign-in response.*configured API URL/);badJson=false;
    });
    await t.test('changing hosted server does not carry over the original vault account',async()=>{
      const before=requests.length; base='https://another.invalid/v1';
      await assert.rejects(commands.get('graymatter.verifyConnection')(),/Connect Hosted Memory/); assert.equal(requests.length,before); base=hostedFixtureBase;
    });
    await t.test('canceling Get Started preserves the verified mode',async()=>{
      await commands.get('graymatter.getStarted')(); assert.equal(state.get('graymatter.mode'),'hosted');
    });
    await new Promise(resolve=>server.close(resolve));
    await t.test('unreachable hosted server names the connection and repair action',async()=>{
      await assert.rejects(commands.get('graymatter.verifyConnection')(),/Cannot reach hosted GrayMatter.*retry Verify Connection/);
    });
  } finally {
    server.close(); for(const disposable of context?.subscriptions||[])disposable.dispose();
    for(const key of Object.keys(process.env)) if(!(key in priorEnv)) delete process.env[key]; Object.assign(process.env,priorEnv);
    await fs.rm(fixture,{recursive:true,force:true});
  }
});
