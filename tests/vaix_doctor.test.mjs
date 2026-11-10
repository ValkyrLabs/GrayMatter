import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const secret = 'ephemeral-doctor-fixture-not-for-output';
const basic = `Basic ${Buffer.from(`admin:${secret}`).toString('base64')}`;

async function executable(name) {
  for (const directory of (process.env.PATH || '').split(path.delimiter)) {
    const target = path.join(directory, name);
    try { await access(target, constants.X_OK); return target; } catch { /* next */ }
  }
  throw new Error(`Test requires ${name}`);
}

async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'graymatter-doctor-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bundle = path.join(directory, 'bundle');
  const bin = path.join(directory, 'bin');
  await mkdir(bundle); await mkdir(bin);
  await writeFile(path.join(bundle, 'admin.env'),
    `GRAYMATTER_LIGHT_USERNAME=admin\nGRAYMATTER_LIGHT_PASSWORD=${secret}\n`, { mode: 0o600 });
  const profile = path.join(directory, 'profiles.json');
  const profileBefore = '{"activeProfile":"existing-hosted","profiles":{}}\n';
  await writeFile(profile, profileBefore, { mode: 0o600 });
  // A fresh machine need not have jq. Keep only the commands vaix uses here.
  await symlink(process.execPath, path.join(bin, 'node'));
  for (const name of ['bash', 'dirname', 'cat', 'mkdir', 'curl', 'grep', 'head', 'sed', 'cut']) {
    await symlink(await executable(name), path.join(bin, name));
  }
  const methods = [];
  const apiRequests = [];
  const json = (response, status, value) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(value));
  };
  const api = http.createServer((request, response) => {
    apiRequests.push(request.url);
    if (request.url === '/actuator/health') return json(response, 200, { status: 'UP' });
    if (options.badCredentials || request.headers.authorization !== basic) {
      return json(response, 401, { error: secret });
    }
    if (request.url === '/v1/memory/status') {
      if (options.invalidStatus) {
        response.writeHead(200, { 'content-type': 'application/json' });
        return response.end('not JSON');
      }
      return json(response, 200, { metrics: [{ id: 'memory.entries', value: 12 }] });
    }
    if (request.url === '/v1/knowledge-packs') return json(response, 200, [{ id: 'starter-fixture' }]);
    return json(response, 404, {});
  });
  const mcp = http.createServer(async (request, response) => {
    if (request.url === '/health') return json(response, 200, { ok: true });
    let text = '';
    for await (const chunk of request) text += chunk;
    const message = JSON.parse(text);
    methods.push(message.method);
    if (options.stalledMcp) return;
    if (options.noMcp) return json(response, 200, { jsonrpc: '2.0', id: message.id,
      error: { code: -32601, message: secret } });
    if (message.method === 'initialize') {
      response.setHeader('mcp-session-id', 'ephemeral-fixture-session');
      return json(response, 200, { jsonrpc: '2.0', id: message.id, result: {
        protocolVersion: '2024-11-05', capabilities: { tools: {} },
        serverInfo: { name: 'doctor-fixture', version: '1' }
      } });
    }
    assert.equal(request.headers['mcp-session-id'], 'ephemeral-fixture-session');
    assert.equal(request.headers['mcp-protocol-version'], '2024-11-05');
    if (message.method === 'notifications/initialized') {
      response.writeHead(204); return response.end();
    }
    if (message.method === 'tools/list') {
      const names = options.missingQuery ? ['memory_put', 'memory_health'] : ['memory_put', 'memory_query', 'memory_health'];
      return json(response, 200, { jsonrpc: '2.0', id: message.id,
        result: { tools: names.map(name => ({ name })) } });
    }
    if (message.method === 'tools/call') {
      assert.equal(message.params.name, 'memory_health');
      return json(response, 200, { jsonrpc: '2.0', id: message.id, result: {
        isError: Boolean(options.toolDenied),
        ...(options.toolRecovery ? { structuredContent: { ok: false, reason: 'missing_auth' } } : {}),
        content: [{ type: 'text', text: options.toolDenied ? secret : '{"ok":true}' }]
      } });
    }
    return json(response, 404, {});
  });
  for (const server of [api, mcp]) {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  }
  const environment = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => !/^(GRAYMATTER_|VALKYR_|VAIX_)/.test(key)));
  Object.assign(environment, {
    PATH: options.hostPath ? process.env.PATH : bin,
    GRAYMATTER_LITE_BUNDLE_DIR: bundle,
    GRAYMATTER_PROFILES_FILE: profile,
    GRAYMATTER_LITE_PORT: String(api.address().port),
    GRAYMATTER_MCP_PORT: String(mcp.address().port),
    VAIX_STATE_DIR: path.join(directory, 'state')
  });
  return {
    methods, apiRequests, apiPort: api.address().port,
    useMcpPort(port) { environment.GRAYMATTER_MCP_PORT = String(port); },
    async run() {
      const child = spawn('/bin/bash', [path.join(root, 'vaix'), 'doctor'], { env: environment });
      let stdout = '', stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
      const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
      clearTimeout(timer);
      assert.equal(await readFile(profile, 'utf8'), profileBefore);
      assert.ok(!`${stdout}${stderr}`.includes(secret), 'Diagnostics must not include credentials or response text');
      return { code, stdout, stderr };
    }
  };
}

test('fresh local verification works without jq and preserves the existing hosted profile', async t => {
  const f = await fixture(t);
  const result = await f.run();
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /doctor: ready/);
  assert.ok(f.methods.includes('tools/call'), 'A real memory tool must complete before readiness');
  assert.ok(f.apiRequests.every(url => url.startsWith('/')));
  const repeated = await f.run();
  assert.equal(repeated.code, 0, repeated.stderr);
});

test('healthy HTTP endpoints cannot masquerade as a working MCP connection', async t => {
  const f = await fixture(t, { noMcp: true, hostPath: true });
  const result = await f.run();
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /MCP initialization/);
  assert.doesNotMatch(result.stdout, /doctor: ready/);
});

test('missing memory tools produce an actionable failure', async t => {
  const result = await (await fixture(t, { missingQuery: true })).run();
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /memory_query/);
});

test('MCP memory authentication failure does not report ready or print server content', async t => {
  const result = await (await fixture(t, { toolDenied: true })).run();
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /memory_health/);
  assert.doesNotMatch(result.stdout, /doctor: ready/);
});

test('an MCP sign-in recovery response is not a successful memory health check', async t => {
  const result = await (await fixture(t, { toolRecovery: true })).run();
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /memory_health/);
  assert.doesNotMatch(result.stdout, /doctor: ready/);
});

test('rejected local credentials explain how to recover without revealing them', async t => {
  const result = await (await fixture(t, { badCredentials: true })).run();
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /401/);
  assert.match(result.stderr, /vaix credentials/);
});

test('malformed backend status is identified instead of reporting a missing command', async t => {
  const result = await (await fixture(t, { invalidStatus: true })).run();
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /memory status.*JSON/i);
});

test('an unresponsive MCP request has a bounded connection check', { timeout: 18000 }, async t => {
  const started = Date.now();
  const result = await (await fixture(t, { stalledMcp: true })).run();
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /MCP initialization.*(timed out|connect)/);
  assert.ok(Date.now() - started < 15000, 'Verification must not stall indefinitely');
});

test('doctor verifies the real local MCP adapter with Basic auth and repeated connection', async t => {
  const saved = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => /^(GRAYMATTER_|VALKYR_)/.test(key)));
  for (const key of Object.keys(saved)) delete process.env[key];
  t.after(() => Object.assign(process.env, saved));
  const { createGrayMatterMcpServer } = createRequire(import.meta.url)('../mcp-server/index.js');
  const f = await fixture(t);
  const origin = `http://127.0.0.1:${f.apiPort}`;
  const unexpectedAuth = () => { throw new Error('Fixture must not contact hosted auth or a credential vault'); };
  const real = createGrayMatterMcpServer({
    publicApp: false, deploymentMode: 'local-dev', apiBase: `${origin}/v1`,
    lightUsername: 'admin', lightPassword: secret, apiShellProvider: null,
    loginProvider: unexpectedAuth, keychainReader: unexpectedAuth,
    fetch: (url, options) => {
      assert.equal(new URL(url).origin, origin, 'All adapter requests must remain on the owned loopback fixture');
      return fetch(url, options);
    }
  });
  await new Promise(resolve => real.listen(0, '127.0.0.1', resolve));
  t.after(() => { real.closeAllConnections(); return new Promise(resolve => real.close(resolve)); });
  f.useMcpPort(real.address().port);
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await f.run();
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /MCP memory tools verified/);
  }
  assert.equal(f.apiRequests.filter(url => url === '/v1/memory/status').length, 4,
    'Each connection must verify memory status through both direct local sign-in and the real MCP tool');
});
