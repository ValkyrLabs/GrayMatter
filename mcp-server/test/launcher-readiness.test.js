'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');

async function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-launcher-readiness-'));
  const scripts = path.join(directory, 'scripts');
  const bin = path.join(directory, 'bin');
  const eventsFile = path.join(directory, 'events');
  fs.mkdirSync(scripts); fs.mkdirSync(bin);
  for (const name of ['security', 'osascript', 'secret-tool']) {
    fs.writeFileSync(path.join(bin, name), `#!${process.execPath}\nrequire('node:fs').appendFileSync(process.env.FIXTURE_EVENTS, 'vault-lookup\\n');process.exit(44);\n`, { mode: 0o755 });
  }
  fs.copyFileSync(path.join(root, 'scripts/gm-mcp-launcher.mjs'), path.join(scripts, 'gm-mcp-launcher.mjs'));
  fs.copyFileSync(path.join(root, 'scripts/gm-connection.mjs'), path.join(scripts, 'gm-connection.mjs'));
  fs.cpSync(path.join(root, 'mcp-server'), path.join(directory, 'mcp-server'), {
    recursive: true, filter: file => !file.includes(`${path.sep}node_modules`) && !file.includes(`${path.sep}test`)
  });
  // This vault adapter fails or returns an ephemeral fixture. No real vault is accessed.
  fs.writeFileSync(path.join(scripts, 'gm-auth.mjs'), `
import { appendFileSync } from 'node:fs';
export function readStoredToken() {
  appendFileSync(process.env.FIXTURE_EVENTS, 'token-read\\n');
  if (process.env.FIXTURE_VAULT === 'blocked') throw new Error('Fixture credential vault is unavailable');
  return 'ephemeral-fixture-session';
}
`);
  fs.writeFileSync(path.join(scripts, 'gm-mcp-launcher'), `#!${process.execPath}\nrequire('node:fs').appendFileSync(process.env.FIXTURE_EVENTS, 'legacy-warmup\\n');setInterval(() => {}, 1000);\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(scripts, 'gm-login'), `#!${process.execPath}\nrequire('node:fs').appendFileSync(process.env.FIXTURE_EVENTS, 'interactive-login\\n');process.exit(4);\n`, { mode: 0o755 });

  let apiRequests = 0;
  let receivedAuthorization = '';
  const api = http.createServer((request, response) => {
    apiRequests++;
    receivedAuthorization = request.headers.authorization || '';
    if (options.stalledAuth) return;
    response.writeHead(options.deniedMemory ? 401 : 200, { 'content-type': 'application/json' });
    response.end(options.deniedMemory ? '{"message":"authentication required"}' : '{}');
  });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  const apiBase = `http://127.0.0.1:${api.address().port}/v1`;
  const registry = path.join(directory, 'profiles.json');
  const profile = { version: 1, mode: 'legacy', activeProfile: null, blendProfiles: [], profiles: {} };
  if (options.local) {
    const passwordFile = path.join(directory, 'local-password');
    fs.writeFileSync(passwordFile, 'ephemeral-local-fixture', { mode: 0o600 });
    Object.assign(profile, { mode: 'single', activeProfile: 'local-fixture' });
    profile.profiles['local-fixture'] = { kind: 'local', username: 'local-fixture', apiBase, passwordFile };
  }
  fs.writeFileSync(registry, JSON.stringify(profile), { mode: 0o600 });
  const profileBefore = fs.readFileSync(registry, 'utf8');
  const environment = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => !/^(GRAYMATTER_|VALKYR_|VAIX_)/.test(key)));
  Object.assign(environment, {
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    GRAYMATTER_STATE_DIR: path.join(directory, 'state'), GRAYMATTER_PROFILES_FILE: registry,
    VALKYR_API_BASE: apiBase, FIXTURE_EVENTS: eventsFile, FIXTURE_VAULT: options.blockedVault ? 'blocked' : 'available'
  });
  if (options.local) {
    environment.GRAYMATTER_PROFILE = 'local-fixture';
    environment.GRAYMATTER_LOCAL_ONLY = 'true';
    environment.VALKYR_AUTH_TOKEN = 'foreign-inherited-fixture-token';
  }
  if (options.interactive) environment.GRAYMATTER_PORTABLE_LAUNCH_ONLY = 'true';
  if (options.rejectHosted) environment.GRAYMATTER_LOCAL_ONLY = 'true';

  const child = spawn(process.execPath, [path.join(scripts, 'gm-mcp-launcher.mjs'), ...(options.interactive ? [] : ['--stdio'])], {
    cwd: directory, env: environment, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe']
  });
  const pending = new Map();
  let nextId = 0, stderr = '', invalidLines = 0;
  child.stderr.on('data', chunk => { stderr += chunk; });
  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', line => {
    let message;
    try { message = JSON.parse(line); } catch { invalidLines++; return; }
    const waiting = pending.get(message.id);
    if (waiting) { pending.delete(message.id); clearTimeout(waiting.timer); waiting.resolve(message); }
  });
  child.on('exit', code => {
    for (const waiting of pending.values()) {
      clearTimeout(waiting.timer); waiting.reject(new Error(`Launcher exited ${code}: ${stderr}`));
    }
    pending.clear();
  });
  child.stdin.on('error', () => {});
  t.after(async () => {
    child.stdin.end();
    const signal = name => { try { process.platform === 'win32' ? child.kill(name) : process.kill(-child.pid, name); } catch {} };
    signal('SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 100));
    signal('SIGKILL');
    lines.close(); api.closeAllConnections();
    await new Promise(resolve => api.close(resolve));
    assert.equal(fs.readFileSync(registry, 'utf8'), profileBefore, 'Starting MCP must preserve the chosen account profile');
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return {
    rpc(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP ${method} was blocked before readiness`)); }, 2500);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      });
    },
    async discover() {
      const initialized = await this.rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'native-launcher-regression', version: '1' } });
      assert.ok(initialized.result?.capabilities?.tools);
      const listed = await this.rpc('tools/list');
      assert.ok(listed.result?.tools.some(tool => tool.name === 'memory_health'));
      assert.equal(invalidLines, 0, 'MCP stdout must contain JSON-RPC only');
    },
    events: () => fs.existsSync(eventsFile) ? fs.readFileSync(eventsFile, 'utf8') : '',
    requests: () => apiRequests,
    authorization: () => receivedAuthorization
  };
}

test('stdio initialization works before an unavailable credential vault is consulted', async t => {
  const f = await fixture(t, { blockedVault: true });
  await f.discover();
  assert.equal(f.events(), ''); assert.equal(f.requests(), 0);
});

test('stdio discovery stays responsive when account validation would stall', async t => {
  const f = await fixture(t, { stalledAuth: true });
  await f.discover();
  assert.equal(f.events(), ''); assert.equal(f.requests(), 0);
});

test('stdio initialization does not wait for legacy release or schema warmups', async t => {
  const f = await fixture(t);
  await f.discover();
  assert.equal(f.events(), ''); assert.equal(f.requests(), 0);
});

test('local offline discovery and repeated launch preserve the local profile without hosted sign-in', async t => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const f = await fixture(t, { local: true, blockedVault: true });
    await f.discover();
    assert.equal(f.events(), ''); assert.equal(f.requests(), 0);
  }
});

test('metadata readiness does not authorize a rejected local memory request', async t => {
  const f = await fixture(t, { local: true, deniedMemory: true });
  await f.discover();
  const result = await f.rpc('tools/call', { name: 'memory_health', arguments: {} });
  assert.equal(result.result?.structuredContent?.ok, false);
  assert.equal(result.result.structuredContent.reason, 'missing_auth');
  assert.ok(f.requests() > 0, 'The real adapter must receive the backend authentication rejection');
  assert.equal(f.authorization(), `Basic ${Buffer.from('local-fixture:ephemeral-local-fixture').toString('base64')}`);
  assert.doesNotMatch(f.events(), /interactive-login/);
  assert.doesNotMatch(JSON.stringify(result), /https:\/\/valkyrlabs\.com/, 'Local recovery must not send the user to Cloud signup');
  assert.match(result.result.structuredContent.retryGuidance, /vaix doctor/);
});

test('explicit interactive launch retains existing session validation', async t => {
  const f = await fixture(t, { interactive: true });
  await f.discover();
  assert.match(f.events(), /token-read/); assert.equal(f.requests(), 1);
});

test('local-only routing continues to reject a hosted profile', async t => {
  const f = await fixture(t, { rejectHosted: true });
  await assert.rejects(f.discover(), /requires a local GrayMatter Lite profile/);
});
