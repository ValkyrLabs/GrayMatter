const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { createGrayMatterMcpServer } = require('../index.js');

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function closeServers(...servers) {
  await Promise.all(servers.map(closeServer));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : null;
}

function createFakeApi(status, payload) {
  return http.createServer(async (req, res) => {
    await readBody(req);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  });
}

function createSlowApi(delayMs, payload = { ok: true }) {
  return http.createServer(async (req, res) => {
    await readBody(req);
    setTimeout(() => {
      if (!res.destroyed) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      }
    }, delayMs);
  });
}

async function postRpc(baseUrl, payload, headers = {}) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(payload)
  });
  return response.json();
}

async function withActivationEnv(env, fn) {
  const previous = {};
  for (const key of Object.keys(env)) {
    previous[key] = process.env[key];
    if (env[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = env[key];
    }
  }

  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test('blended-profile MCP federates safe memory reads and blocks writes', async () => {
  const calls = [];
  const server = createGrayMatterMcpServer({
    profileMode: 'blend',
    fetch: async () => {
      throw new Error('blended MCP must not bypass the profile router');
    },
    apiShellProvider: async (_context, method, endpoint, body) => {
      calls.push({ method, endpoint, body });
      return {
        mode: 'federated-read',
        results: [
          { profile: 'local', accountFingerprint: 'sha256:local', ok: true, data: { results: [{ id: 'local-memory' }] } },
          { profile: 'cloud', accountFingerprint: 'sha256:cloud', ok: true, data: { results: [{ id: 'cloud-memory' }] } }
        ],
        provenance: 'Each result was fetched independently under server-side RBAC.'
      };
    }
  });
  const baseUrl = await listen(server);

  try {
    const read = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'blend-read',
      method: 'tools/call',
      params: { name: 'memory_query', arguments: { query: 'release rule' } }
    });
    const payload = JSON.parse(read.result.content[0].text);
    assert.equal(payload.mode, 'federated-read');
    assert.deepEqual(payload.results.map((result) => result.profile), ['local', 'cloud']);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].endpoint, 'MemoryEntry/query');

    const write = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'blend-write',
      method: 'tools/call',
      params: { name: 'memory_write', arguments: { type: 'context', text: 'must not write' } }
    });
    assert.equal(write.result.structuredContent.reason, 'read_only_auth');
    assert.equal(write.result.structuredContent.retryable, false);
    assert.equal(calls.length, 1);
  } finally {
    await closeServer(server);
  }
});

test('memory_query returns neutral recovery for a usage limit without commerce actions', async () => {
  await withActivationEnv({
    VALKYR_HUMAN_SIGNUP_URL: undefined,
    GRAYMATTER_ACTIVATION_SOURCE: undefined,
    GRAYMATTER_INSTALL_ID: 'install-123'
  }, async () => {
    const fakeApi = createFakeApi(402, {
      code: 'INSUFFICIENT_FUNDS',
      message: 'usage limit reached',
      requiredCredits: 25,
      currentBalance: '0.00',
      traceId: 'trace-credits',
      workspaceId: 'workspace-7'
    });
    const apiBase = await listen(fakeApi);
    const server = createGrayMatterMcpServer({ apiBase: `${apiBase}/v1` });
    const baseUrl = await listen(server);

    try {
      const body = await postRpc(baseUrl, {
        jsonrpc: '2.0',
        id: 'credit',
        method: 'tools/call',
        params: { name: 'memory_query', arguments: { query: 'hello' } }
      });

      const out = body.result.structuredContent;
      assert.equal(out.reason, 'insufficient_credits');
      assert.equal(out.blockedOperation, 'memory_query');
      assert.equal(out.retryable, true);
      assert.equal(out.requiredCredits, '25');
      assert.equal(out.currentBalance, '0.00');
      assert.equal(out.traceId, 'trace-credits');
      assert.equal(out.workspaceId, 'workspace-7');
      assert.deepEqual(out.recoveryActions.map((action) => action.id), ['retry', 'sign_in']);
      assert.equal(out.recoveryActions[0].primary, true);
      assert.match(body.result.content[0].text, /usage limit has been reached/i);
      assert.doesNotMatch(JSON.stringify(out), /buy|purchase|payment|recharge|upgrade|checkout|billing/i);
      assert.match(body.result.content[0].text, /Current balance: 0\.00/);
    } finally {
      await closeServers(server, fakeApi);
    }
  });
});

test('memory_query keeps a missing starter grant recovery free of commerce actions', async () => {
  const fakeApi = createFakeApi(402, {
    code: 'STARTER_CREDITS_MISSING',
    message: 'starter credit grant missing',
    requiredCredits: 500,
    currentBalance: '0.00',
    accountId: 'acct-1'
  });
  const apiBase = await listen(fakeApi);
  const server = createGrayMatterMcpServer({ apiBase: `${apiBase}/v1` });
  const baseUrl = await listen(server);

  try {
    const body = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'starter',
      method: 'tools/call',
      params: { name: 'memory_query', arguments: { query: 'hello' } }
    });

    const out = body.result.structuredContent;
    assert.equal(out.reason, 'starter_credits_missing');
    assert.equal(out.retryable, true);
    assert.equal(out.accountId, 'acct-1');
    assert.deepEqual(out.recoveryActions.map((action) => action.id), ['retry', 'sign_in']);
    assert.match(body.result.content[0].text, /temporarily unavailable/i);
    assert.doesNotMatch(JSON.stringify(out), /buy|purchase|payment|recharge|upgrade|checkout|billing/i);
  } finally {
    await closeServers(server, fakeApi);
  }
});

test('memory_query falls back to lexical MemoryEntry list when embeddings quota is exhausted', async () => {
  const requests = [];
  const fakeApi = http.createServer(async (req, res) => {
    const body = await readBody(req);
    requests.push({ method: req.method, path: new URL(req.url, 'http://fake.local').pathname, body });

    if (req.method === 'POST' && req.url === '/v1/MemoryEntry/query') {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        disabled: true,
        unavailable: true,
        error: 'openai embeddings failed: 429 insufficient_quota',
        warning: 'Memory search is unavailable because the embedding provider quota is exhausted.'
      }));
      return;
    }

    if (req.method === 'GET' && req.url === '/v1/MemoryEntry') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        content: [
          { id: 'mem-1', type: 'context', text: 'Stainless sprint CRM warm leads need founder-led follow-up', sourceChannel: 'codex:workspace:crm' },
          { id: 'mem-2', type: 'todo', text: 'Unrelated billing cleanup', sourceChannel: 'codex:workspace:crm' },
          { id: 'mem-3', type: 'context', text: 'Stainless pricing objection notes', sourceChannel: 'codex:workspace:other' },
          { id: 'mem-4', type: 'decision', text: 'Stainless outreach contract is binding', tags: [{ name: 'invariant' }], sourceChannel: 'codex:workspace:crm' },
          { id: 'mem-5', type: 'decision', text: 'Stainless outreach draft', tags: ['draft'], sourceChannel: 'codex:workspace:crm' }
        ]
      }));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: 'not found' }));
  });
  const apiBase = await listen(fakeApi);
  const server = createGrayMatterMcpServer({ apiBase: `${apiBase}/v1` });
  const baseUrl = await listen(server);

  try {
    const body = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'quota',
      method: 'tools/call',
      params: {
        name: 'memory_query',
        arguments: {
          query: 'Stainless sprint CRM warm leads founder outreach',
          type: 'context',
          sourceChannel: 'codex:workspace:crm',
          limit: 5
        }
      }
    });

    const out = JSON.parse(body.result.content[0].text);
    assert.equal(out.degraded, true);
    assert.equal(out.reason, 'embedding_quota_exhausted');
    assert.equal(out.retrievalMode, 'lexical_fallback');
    assert.equal(out.count, 1);
    assert.equal(out.results[0].id, 'mem-1');
    assert.equal(requests[0].path, '/v1/MemoryEntry/query');
    assert.equal(requests[1].path, '/v1/MemoryEntry');

    const invariantBody = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'quota-invariant',
      method: 'tools/call',
      params: {
        name: 'memory_query',
        arguments: {
          query: 'Stainless outreach contract',
          type: 'INVARIANT',
          sourceChannel: 'codex:workspace:crm',
          limit: 5
        }
      }
    });
    const invariantOut = JSON.parse(invariantBody.result.content[0].text);
    assert.equal(invariantOut.count, 1);
    assert.equal(invariantOut.results[0].id, 'mem-4');
    assert.equal(requests[2].body.type, 'decision');
    assert.deepEqual(requests[2].body.tags, ['invariant']);
  } finally {
    await closeServers(server, fakeApi);
  }
});

test('unexpected endpoint failure performs one bounded schema resync and retries the live operation', async () => {
  let writeAttempts = 0;
  let resyncs = 0;
  const fakeApi = http.createServer(async (req, res) => {
    await readBody(req);
    if (req.method === 'POST' && req.url === '/v1/MemoryEntry/write') {
      writeAttempts += 1;
      if (writeAttempts === 1) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ code: 'ENDPOINT_NOT_FOUND', message: 'route changed' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'memory-after-resync' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
  const apiBase = await listen(fakeApi);
  const server = createGrayMatterMcpServer({
    apiBase: apiBase + '/v1',
    token: 'test-token',
    schemaRefreshProvider: async () => {
      resyncs += 1;
      return true;
    }
  });
  const baseUrl = await listen(server);

  try {
    const body = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'resync',
      method: 'tools/call',
      params: {
        name: 'memory_write',
        arguments: { type: 'context', text: 'retry after schema refresh' }
      }
    });
    assert.equal(body.result.content[0].text, JSON.stringify({ id: 'memory-after-resync' }));
    assert.equal(writeAttempts, 2);
    assert.equal(resyncs, 1);
  } finally {
    await closeServers(server, fakeApi);
  }
});

test('schema discovery falls back to a stale cache only during an api-0 outage', async () => {
  const fakeApi = createFakeApi(503, { message: 'api-0 unavailable' });
  const apiBase = await listen(fakeApi);
  const server = createGrayMatterMcpServer({
    apiBase: `${apiBase}/v1`,
    schemaCacheProvider: async () => ({
      info: { title: 'Cached API', version: '2026.06' },
      tags: [{ name: 'MemoryEntry' }],
      paths: { '/MemoryEntry': {}, '/MemoryEntry/{id}': {} }
    })
  });
  const baseUrl = await listen(server);

  try {
    const body = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'cached-schema',
      method: 'tools/call',
      params: { name: 'schema_summary', arguments: {} }
    });
    const summary = JSON.parse(body.result.content[0].text);
    assert.equal(summary.schemaSource, 'cached');
    assert.equal(summary.schemaCacheState, 'stale');
    assert.equal(summary.pathCount, 2);
    assert.deepEqual(summary.entities, ['MemoryEntry']);
  } finally {
    await closeServers(server, fakeApi);
  }
});

test('memory_query returns auth recovery for 401', async () => {
  const fakeApi = createFakeApi(401, { message: 'token expired' });
  const apiBase = await listen(fakeApi);
  const server = createGrayMatterMcpServer({
    apiBase: `${apiBase}/v1`,
    loginProvider: async () => '',
    apiShellProvider: null
  });
  const baseUrl = await listen(server);

  try {
    const body = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'auth',
      method: 'tools/call',
      params: { name: 'memory_query', arguments: { query: 'hello' } }
    });

    const out = body.result.structuredContent;
    assert.equal(out.reason, 'missing_auth');
    assert.equal(out.retryable, true);
    assert.match(out.loginUrl, /\/auth\/login$/);
    assert.deepEqual(out.recoveryActions.map((action) => action.id), ['sign_in', 'create_account']);
    assert.equal(out.recoveryActions[0].primary, true);
  } finally {
    await closeServers(server, fakeApi);
  }
});

test('memory_write returns read-only recovery for 403 write forbidden', async () => {
  const fakeApi = createFakeApi(403, { message: 'write forbidden for read-only token' });
  const apiBase = await listen(fakeApi);
  const server = createGrayMatterMcpServer({
    apiBase: `${apiBase}/v1`,
    loginProvider: async () => '',
    apiShellProvider: null
  });
  const baseUrl = await listen(server);

  try {
    const body = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'readonly',
      method: 'tools/call',
      params: { name: 'memory_write', arguments: { type: 'context', text: 'x' } }
    });

    const out = body.result.structuredContent;
    assert.equal(out.reason, 'read_only_auth');
    assert.equal(out.retryable, false);
    assert.deepEqual(out.recoveryActions.map((action) => action.id), ['sign_in']);
  } finally {
    await closeServers(server, fakeApi);
  }
});

test('receipt-backed retrieval times out with retryable recovery instead of hanging', async () => {
  await withActivationEnv({
    GRAYMATTER_RETRIEVAL_RECEIPT_TIMEOUT_MS: '25',
    GRAYMATTER_MCP_REQUEST_TIMEOUT_MS: undefined
  }, async () => {
    const fakeApi = createSlowApi(500);
    const apiBase = await listen(fakeApi);
    const server = createGrayMatterMcpServer({
      apiBase: `${apiBase}/v1`,
      loginProvider: async () => '',
      apiShellProvider: null
    });
    const baseUrl = await listen(server);

    try {
      const body = await postRpc(baseUrl, {
        jsonrpc: '2.0',
        id: 'receipt-timeout',
        method: 'tools/call',
        params: { name: 'memory_retrieve_with_receipt', arguments: { query: 'post-install recall' } }
      });

      const out = body.result.structuredContent;
      assert.equal(out.reason, 'request_timeout');
      assert.equal(out.blockedOperation, 'memory_retrieve_with_receipt');
      assert.equal(out.retryable, true);
      assert.deepEqual(out.recoveryActions.map((action) => action.id), ['retry', 'sign_in']);
      assert.match(body.result.content[0].text, /did not finish this operation before the client timeout/);
    } finally {
      await closeServers(server, fakeApi);
    }
  });
});

test('context_compile has its own bounded transport budget beyond ordinary MCP calls', async () => {
  await withActivationEnv({
    GRAYMATTER_CONTEXT_COMPILE_TIMEOUT_MS: '100',
    GRAYMATTER_MCP_REQUEST_TIMEOUT_MS: '25'
  }, async () => {
    const fakeApi = createSlowApi(50, {
      contextPage: { pageRef: 'ctxpg-review' },
      retrievalReceipt: { receiptId: 'gm_rr-review' }
    });
    const apiBase = await listen(fakeApi);
    const server = createGrayMatterMcpServer({
      apiBase: `${apiBase}/v1`,
      deploymentMode: 'hosted-multi-tenant',
      publicApp: true,
      publicResource: 'https://graymatter.example.test',
      oauthIssuer: 'https://identity.example.test',
      tokenVerifier: async () => ({
        claims: {
          sub: 'reviewer-1',
          organizationId: 'org-review',
          tenantId: 'tenant-review',
          scope: 'memory:read memory:write context:read'
        }
      })
    });
    const baseUrl = await listen(server);

    try {
      const body = await postRpc(
        baseUrl,
        {
          jsonrpc: '2.0',
          id: 'context-compile-timeout',
          method: 'tools/call',
          params: {
            name: 'context_compile',
            arguments: { task: 'Prepare the current release review.' }
          }
        },
        { authorization: 'Bearer reviewer-token' });

      assert.equal(body.result.structuredContent.ok, true);
      assert.equal(body.result.structuredContent.data.contextPage.pageRef, 'ctxpg-review');
    } finally {
      await closeServers(server, fakeApi);
    }
  });
});

test('success path remains plain toolResult content shape', async () => {
  const fakeApi = createFakeApi(200, { results: [{ id: 'mem-1' }] });
  const apiBase = await listen(fakeApi);
  const server = createGrayMatterMcpServer({ apiBase: `${apiBase}/v1` });
  const baseUrl = await listen(server);

  try {
    const body = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'ok',
      method: 'tools/call',
      params: { name: 'memory_query', arguments: { query: 'ok' } }
    });

    assert.equal(body.result.structuredContent, undefined);
    assert.deepEqual(JSON.parse(body.result.content[0].text), { results: [{ id: 'mem-1' }] });
  } finally {
    await closeServers(server, fakeApi);
  }
});
