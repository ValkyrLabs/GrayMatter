'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const { createGrayMatterMcpServer, publicTools } = require('../index');

async function fixture(t, overrides = {}) {
  let verified = 0;
  let upstream = 0;
  const server = createGrayMatterMcpServer({
    apiBase: 'https://upstream.invalid/v1',
    publicApp: true, deploymentMode: 'hosted-multi-tenant',
    publicResource: 'https://graymatter.example.test',
    oauthIssuer: 'https://identity.example.test',
    token: 'PROCESS-CREDENTIAL-MUST-NOT-BE-USED', tenantId: 'PROCESS-TENANT-MUST-NOT-LEAK',
    tokenVerifier: async token => {
      verified++;
      if (token !== 'synthetic-valid') throw new Error('Invalid synthetic token');
      return { claims: { sub: 'synthetic-user', organizationId: 'synthetic-org',
        tenantId: 'synthetic-tenant', scope: 'memory:read context:read' } };
    },
    fetch: async (_url, init) => {
      upstream++;
      assert.equal(new Headers(init.headers).get('authorization'), 'Bearer synthetic-valid');
      return new Response('[]', { status: 200 });
    },
    ...overrides,
  });
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (body, { path = '/graymatter/mcp', token, headers = {} } = {}) => {
    const r = await fetch(base + path, { method: 'POST', headers: {
      'content-type': 'application/json', ...(token === undefined ? {} : { authorization: `Bearer ${token}` }), ...headers,
    }, body: typeof body === 'string' ? body : JSON.stringify(body) });
    return { status: r.status, headers: r.headers, text: await r.text() };
  };
  return { base, post, counts: () => ({ verified, upstream }) };
}
const rpc = (method, params) => ({ jsonrpc: '2.0', id: 'discovery-test', method, ...(params ? { params } : {}) });

test('anonymous discovery returns the same static public catalog on both routes without credentials or upstream access', async t => {
  const { post, counts } = await fixture(t);
  for (const path of ['/graymatter/mcp', '/mcp']) {
    const initialized = await post(rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {},
      clientInfo: { name: 'synthetic-directory', version: '1' } }), { path });
    assert.equal(initialized.status, 200);
    assert.equal(JSON.parse(initialized.text).result.serverInfo.name, 'graymatter');
    const listed = await post(rpc('tools/list'), { path });
    assert.equal(listed.status, 200);
    assert.deepEqual(JSON.parse(listed.text).result.tools, publicTools);
    assert.doesNotMatch(initialized.text + listed.text, /PROCESS-CREDENTIAL|PROCESS-TENANT|synthetic-user|synthetic-org|synthetic-tenant/);
    const notified = await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, { path });
    assert.equal(notified.status, 204);
    assert.equal(notified.text, '');
  }
  assert.deepEqual(counts(), { verified: 0, upstream: 0 });
});

test('all tool calls, resources, unknown methods and mixed batches remain HTTP-401 protected', async t => {
  const { post, counts } = await fixture(t);
  for (const path of ['/graymatter/mcp', '/mcp']) {
    for (const body of [
      ...publicTools.map(tool => rpc('tools/call', { name: tool.name, arguments: {} })),
      rpc('tools/call', { name: 'unknown-tool' }), rpc('resources/list'),
      rpc('resources/read', { uri: 'ui://graymatter/app.html' }), rpc('unknown-method'),
      [rpc('initialize'), rpc('tools/call', { name: 'memory_search', arguments: { query: 'private' } })],
      { ...rpc('tools/list'), jsonrpc: '1.0' },
    ]) {
      const denied = await post(body, { path });
      assert.equal(denied.status, 401, JSON.stringify(body));
      assert.equal(JSON.parse(denied.text).error.code, 'AUTH_REQUIRED');
      assert.match(denied.headers.get('www-authenticate'), /oauth-protected-resource/);
    }
  }
  assert.deepEqual(counts(), { verified: 0, upstream: 0 });
});

test('a supplied invalid credential is not silently downgraded to anonymous discovery', async t => {
  const { post, counts } = await fixture(t);
  for (const method of ['initialize', 'tools/list']) {
    assert.equal((await post(rpc(method), { token: 'invalid' })).status, 401);
    assert.equal((await post(rpc(method), { headers: { authorization: 'Basic invalid' } })).status, 401);
  }
  assert.equal(counts().upstream, 0);
});

test('valid OAuth still gates scope and forwards only the per-request bearer', async t => {
  const { post, counts } = await fixture(t);
  const read = await post(rpc('tools/call', { name: 'memory_search', arguments: { query: 'synthetic' } }), { token: 'synthetic-valid' });
  assert.equal(read.status, 200);
  assert.equal(JSON.parse(read.text).result.structuredContent.ok, true);
  const write = await post(rpc('tools/call', { name: 'memory_save', arguments: { content: 'synthetic' } }), { token: 'synthetic-valid' });
  assert.equal(JSON.parse(write.text).result.structuredContent.error.code, 'FORBIDDEN');
  assert.deepEqual(counts(), { verified: 2, upstream: 1 });
});

test('anonymous discovery keeps identity-header and request-body size guards', async t => {
  const { post, counts } = await fixture(t);
  const override = await post(rpc('tools/list'), { headers: { 'x-tenant-id': 'forbidden-override' } });
  assert.equal(override.status, 400);
  const oversized = await post({ ...rpc('initialize'), params: { padding: 'x'.repeat(64 * 1024) } });
  assert.equal(oversized.status, 413);
  assert.deepEqual(counts(), { verified: 0, upstream: 0 });
});

test('anonymous incomplete bodies terminate at the configured shared deadline', async t => {
  const previous = process.env.GRAYMATTER_MCP_EXECUTION_TIMEOUT_MS;
  process.env.GRAYMATTER_MCP_EXECUTION_TIMEOUT_MS = '60';
  t.after(() => { if (previous === undefined) delete process.env.GRAYMATTER_MCP_EXECUTION_TIMEOUT_MS;
    else process.env.GRAYMATTER_MCP_EXECUTION_TIMEOUT_MS = previous; });
  const { base, counts } = await fixture(t);
  const result = await new Promise((resolve, reject) => {
    const req = http.request(base + '/graymatter/mcp', { method: 'POST', headers: { 'content-type': 'application/json' } }, res => {
      let text = ''; res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
    });
    req.setTimeout(2000, () => req.destroy(new Error('Anonymous body was not bounded')));
    req.on('error', reject);
    req.write('{"jsonrpc":"2.0",');
  });
  assert.equal(result.status, 504);
  assert.equal(result.body.error.code, 'EXECUTION_DEADLINE_EXHAUSTED');
  assert.equal(result.body.executionLimits.phase, 'request_body');
  assert.deepEqual(counts(), { verified: 0, upstream: 0 });
});
