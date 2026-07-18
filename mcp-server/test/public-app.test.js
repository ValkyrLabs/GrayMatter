'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { createGrayMatterMcpServer, publicTools } = require('../index');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function request(port, method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const raw = body === undefined ? '' : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path,
      headers: {
        accept: 'application/json, text/event-stream',
        ...(raw ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(raw) } : {}),
        ...headers
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, headers: res.headers, body: text ? JSON.parse(text) : null });
      });
    });
    req.on('error', reject);
    if (raw) req.write(raw);
    req.end();
  });
}

function rpc(method, params, id = 1) {
  return { jsonrpc: '2.0', id, method, ...(params ? { params } : {}) };
}

async function withEnv(values, operation) {
  const previous = {};
  for (const [name, value] of Object.entries(values)) {
    previous[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return await operation();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function signedShapeJwt(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'RS256', typ: 'JWT', kid: 'public-key-1' })}.${encode(payload)}.c2lnbmF0dXJl`;
}

function verifier(token) {
  const tenant = token === 'token-b' ? 'tenant-b' : 'tenant-a';
  return {
    claims: {
      sub: `user-${tenant}`,
      organizationId: `org-${tenant}`,
      tenantId: tenant,
      roles: ['ROLE_GRAYMATTER_USER'],
      permissions: ['MEMORY_READ', 'MEMORY_WRITE'],
      scope: 'memory:read memory:write context:read'
    }
  };
}

function publicServer(apiBase, options = {}) {
  return createGrayMatterMcpServer({
    apiBase,
    deploymentMode: 'hosted-multi-tenant',
    publicApp: true,
    publicResource: 'https://graymatter.example.test',
    oauthIssuer: 'https://identity.example.test',
    tokenVerifier: verifier,
    allowedOrigins: ['https://chatgpt.com'],
    ...options
  });
}

test('public tool surface is exact, strict, OAuth-scoped, and correctly annotated', () => {
  assert.deepEqual(publicTools.map((tool) => tool.name), [
    'memory_search',
    'memory_get',
    'memory_save',
    'memory_update',
    'memory_forget',
    'context_compile',
    'procedure_search',
    'retrieval_receipt_get'
  ]);
  for (const tool of publicTools) {
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(tool.securitySchemes[0].type, 'oauth2');
    assert.ok(tool.securitySchemes[0].scopes.length > 0);
    assert.equal(typeof tool.annotations.readOnlyHint, 'boolean');
    assert.equal(typeof tool.annotations.openWorldHint, 'boolean');
    assert.equal(typeof tool.annotations.destructiveHint, 'boolean');
  }
  assert.equal(publicTools.find((tool) => tool.name === 'memory_forget').annotations.destructiveHint, true);
  assert.equal(publicTools.find((tool) => tool.name === 'memory_search').annotations.readOnlyHint, true);
  assert.equal(publicTools.find((tool) => tool.name === 'memory_save').annotations.readOnlyHint, false);
});

test('public endpoint publishes protected-resource metadata and challenges unauthenticated calls', async (t) => {
  const server = publicServer('https://api.example.test/v1');
  t.after(() => close(server));
  const port = await listen(server);

  const metadata = await request(port, 'GET', '/.well-known/oauth-protected-resource');
  assert.equal(metadata.status, 200);
  assert.equal(metadata.body.resource, 'https://graymatter.example.test');
  assert.deepEqual(metadata.body.authorization_servers, ['https://identity.example.test']);
  assert.deepEqual(metadata.body.scopes_supported, ['memory:read', 'memory:write', 'context:read']);

  const denied = await request(port, 'POST', '/graymatter/mcp', rpc('initialize'));
  assert.equal(denied.status, 401);
  assert.equal(denied.body.error.code, 'AUTH_REQUIRED');
  assert.match(denied.headers['www-authenticate'], /oauth-protected-resource/);
  assert.match(denied.headers['www-authenticate'], /memory:read/);
});

test('public GET verification aborts JWKS fetches at the shared execution deadline', async () => {
  await withEnv({
    GRAYMATTER_MCP_EXECUTION_TIMEOUT_MS: '40',
    GRAYMATTER_MCP_REQUEST_TIMEOUT_MS: '200'
  }, async () => {
    let fetchAborted = false;
    const server = publicServer('https://api.example.test/v1', {
      tokenVerifier: undefined,
      oauthJwksUri: 'https://identity.example.test/oauth2/jwks',
      fetch: async (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          fetchAborted = true;
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      })
    });
    const port = await listen(server);
    const token = signedShapeJwt({
      iss: 'https://identity.example.test',
      aud: 'https://graymatter.example.test',
      exp: Math.floor(Date.now() / 1000) + 300,
      sub: 'user-a',
      organizationId: 'org-a',
      tenantId: 'tenant-a',
      scope: 'memory:read'
    });
    const startedAt = Date.now();

    try {
      const response = await request(port, 'GET', '/graymatter/mcp', undefined, {
        authorization: `Bearer ${token}`
      });

      assert.equal(response.status, 504);
      assert.equal(response.body.error.code, 'EXECUTION_DEADLINE_EXHAUSTED');
      assert.equal(response.body.executionLimits.configuredTimeoutMs, 40);
      assert.equal(response.body.executionLimits.sharedAcrossRequests, true);
      assert.equal(response.body.executionLimits.onExhaustion, 'FAIL_CLOSED');
      assert.equal(response.body.executionLimits.phase, 'oauth_principal_verification');
      assert.equal(fetchAborted, true);
      assert.ok(Date.now() - startedAt < 160);
    } finally {
      await close(server);
    }
  });
});

test('public tool timeout preserves machine-readable shared execution limits', async () => {
  await withEnv({
    GRAYMATTER_MCP_EXECUTION_TIMEOUT_MS: '40',
    GRAYMATTER_MCP_REQUEST_TIMEOUT_MS: '200'
  }, async () => {
    let fetchAborted = false;
    const server = publicServer('https://api.example.test/v1', {
      fetch: async (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          fetchAborted = true;
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      })
    });
    const port = await listen(server);

    try {
      const response = await request(port, 'POST', '/graymatter/mcp', rpc('tools/call', {
        name: 'memory_search', arguments: { query: 'bounded public search' }
      }), { authorization: 'Bearer token-a' });

      const out = response.body.result.structuredContent;
      assert.equal(response.status, 200);
      assert.equal(out.error.code, 'EXECUTION_DEADLINE_EXHAUSTED');
      assert.equal(out.error.retryable, true);
      assert.equal(out.executionLimits.configuredTimeoutMs, 40);
      assert.equal(out.executionLimits.sharedAcrossRequests, true);
      assert.equal(out.executionLimits.onExhaustion, 'FAIL_CLOSED');
      assert.equal(fetchAborted, true);
    } finally {
      await close(server);
    }
  });
});

test('canonical and compatibility MCP routes initialize and discover only public tools', async (t) => {
  const server = publicServer('https://api.example.test/v1');
  t.after(() => close(server));
  const port = await listen(server);
  const headers = { authorization: 'Bearer token-a' };

  for (const path of ['/graymatter/mcp', '/mcp']) {
    const initialized = await request(port, 'POST', path, rpc('initialize'), headers);
    assert.equal(initialized.status, 200);
    assert.equal(initialized.body.result.protocolVersion, '2025-06-18');
    const listed = await request(port, 'POST', path, rpc('tools/list'), headers);
    assert.deepEqual(listed.body.result.tools.map((tool) => tool.name), publicTools.map((tool) => tool.name));
  }
});

test('public proxy derives tenancy from validated bearer context and rejects every override channel', async (t) => {
  const seen = [];
  const api = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      seen.push({ headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') });
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify([{ id: token === 'token-b' ? 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' : 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', text: token }]));
    });
  });
  t.after(() => close(api));
  const apiPort = await listen(api);
  const server = publicServer(`http://127.0.0.1:${apiPort}/v1`);
  t.after(() => close(server));
  const port = await listen(server);

  const call = (token, args, headers = {}) => request(port, 'POST', '/graymatter/mcp', rpc('tools/call', {
    name: 'memory_search', arguments: args
  }), { authorization: `Bearer ${token}`, ...headers });

  const tenantA = await call('token-a', { query: 'handoff' });
  const tenantB = await call('token-b', { query: 'handoff' });
  assert.equal(tenantA.body.result.structuredContent.data[0].text, 'token-a');
  assert.equal(tenantB.body.result.structuredContent.data[0].text, 'token-b');
  assert.equal(seen[0].headers['x-tenant-id'], undefined);
  assert.equal(seen[1].headers['x-tenant-id'], undefined);
  assert.equal(seen[0].headers.cookie, undefined);
  assert.equal(seen[0].headers.valkyr_auth, undefined);

  const modelOverride = await call('token-a', { query: 'handoff', tenantId: 'tenant-b' });
  assert.equal(modelOverride.body.result.structuredContent.error.code, 'INVALID_ARGUMENT');
  assert.equal(seen.length, 2);

  const headerOverride = await call('token-a', { query: 'handoff' }, { 'x-tenant-id': 'tenant-b' });
  assert.equal(headerOverride.status, 400);
  assert.equal(headerOverride.body.error.code, 'INVALID_ARGUMENT');
  assert.equal(seen.length, 2);
});

test('public save/search round-trip and receipt retrieval use existing api-0 paths', async (t) => {
  const memories = new Map();
  const api = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      res.setHeader('content-type', 'application/json');
      if (req.method === 'POST' && req.url === '/v1/MemoryEntry/write') {
        const value = { id: '11111111-1111-4111-8111-111111111111', ...body };
        memories.set(token, value);
        res.end(JSON.stringify(value));
        return;
      }
      if (req.method === 'POST' && req.url === '/v1/MemoryEntry/query') {
        res.end(JSON.stringify(memories.has(token) ? [memories.get(token)] : []));
        return;
      }
      if (req.method === 'GET' && req.url === '/v1/graymatter-retrieval-receipts/rr-1') {
        res.end(JSON.stringify({ receipt: { receiptId: 'rr-1', answerPolicy: 'ALLOW_ANSWER' } }));
        return;
      }
      res.writeHead(404);
      res.end(JSON.stringify({ message: 'not found' }));
    });
  });
  t.after(() => close(api));
  const apiPort = await listen(api);
  const server = publicServer(`http://127.0.0.1:${apiPort}/v1`);
  t.after(() => close(server));
  const port = await listen(server);
  const headers = { authorization: 'Bearer token-a' };
  const tool = (name, args) => request(port, 'POST', '/graymatter/mcp', rpc('tools/call', { name, arguments: args }), headers);

  const saved = await tool('memory_save', { content: 'Ship the public app', title: 'Launch', importance: 'high', scope: 'codex:workspace:GrayMatter' });
  assert.equal(saved.body.result.structuredContent.ok, true);
  assert.equal(saved.body.result.structuredContent.data.text, 'Ship the public app');
  assert.ok(saved.body.result.structuredContent.data.tags.includes('importance:high'));

  const searched = await tool('memory_search', { query: 'public app' });
  assert.equal(searched.body.result.structuredContent.data[0].title, 'Launch');

  const receipt = await tool('retrieval_receipt_get', { receiptId: 'rr-1' });
  assert.equal(receipt.body.result.structuredContent.data.receipt.receiptId, 'rr-1');
});

test('forget requires confirmation, payload limits fail closed, and upstream details are sanitized', async (t) => {
  let deleteCount = 0;
  const api = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'DELETE') {
      deleteCount += 1;
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(500);
    res.end(JSON.stringify({ message: 'database secret password=never-leak' }));
  });
  t.after(() => close(api));
  const apiPort = await listen(api);
  const server = publicServer(`http://127.0.0.1:${apiPort}/v1`);
  t.after(() => close(server));
  const port = await listen(server);
  const headers = { authorization: 'Bearer token-a' };
  const tool = (name, args) => request(port, 'POST', '/graymatter/mcp', rpc('tools/call', { name, arguments: args }), headers);
  const id = '11111111-1111-4111-8111-111111111111';

  const unconfirmed = await tool('memory_forget', { id, confirm: false, confirmationText: 'not confirmed' });
  assert.equal(unconfirmed.body.result.structuredContent.error.code, 'CONFIRMATION_REQUIRED');
  assert.equal(deleteCount, 0);

  const confirmed = await tool('memory_forget', { id, confirm: true, confirmationText: 'Forget Launch memory' });
  assert.equal(confirmed.body.result.structuredContent.ok, true);
  assert.equal(deleteCount, 1);

  const oversized = await tool('memory_save', { content: 'x'.repeat(12001) });
  assert.equal(oversized.body.result.structuredContent.error.code, 'INVALID_ARGUMENT');

  const failed = await tool('memory_search', { query: 'trigger upstream error' });
  assert.equal(failed.body.result.structuredContent.error.code, 'UPSTREAM_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(failed.body), /never-leak|database secret|password=/);
});

test('public credit exhaustion returns a neutral usage-limit error without commerce actions', async (t) => {
  const api = http.createServer((_req, res) => {
    res.writeHead(402, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      code: 'INSUFFICIENT_FUNDS',
      message: 'Buy credits at https://valkyrlabs.com/graymatter/credits',
      currentBalance: '0.00',
      requiredCredits: 25
    }));
  });
  t.after(() => close(api));
  const apiPort = await listen(api);
  const server = publicServer(`http://127.0.0.1:${apiPort}/v1`);
  t.after(() => close(server));
  const port = await listen(server);

  const response = await request(port, 'POST', '/graymatter/mcp', rpc('tools/call', {
    name: 'memory_search', arguments: { query: 'handoff' }
  }), { authorization: 'Bearer token-a' });
  const result = response.body.result;
  const serialized = JSON.stringify(result);

  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error.code, 'USAGE_LIMIT_REACHED');
  assert.equal(result.structuredContent.error.retryable, false);
  assert.match(result.structuredContent.error.message, /manage the account outside ChatGPT/i);
  assert.doesNotMatch(serialized, /buy|recharge|credits|valkyrlabs\.com\/graymatter\/credits/i);
  assert.doesNotMatch(serialized, /currentBalance|requiredCredits|0\.00/);
});
