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

function stalledRequest(port, path, initialBody, headers = {}) {
  return new Promise((resolve, reject) => {
    let responseSeen = false;
    const req = http.request({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...headers
      }
    }, (res) => {
      responseSeen = true;
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, headers: res.headers, body: text ? JSON.parse(text) : null });
      });
    });
    req.on('error', (error) => {
      if (!responseSeen) reject(error);
    });
    req.write(initialBody);
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
  assert.equal(publicTools.find((tool) => tool.name === 'memory_update').annotations.destructiveHint, true);
  assert.equal(publicTools.find((tool) => tool.name === 'memory_search').annotations.readOnlyHint, true);
  assert.equal(publicTools.find((tool) => tool.name === 'memory_save').annotations.readOnlyHint, false);

  const contextCompile = publicTools.find((tool) => tool.name === 'context_compile');
  assert.equal(contextCompile.inputSchema.properties.filters, undefined);
  assert.equal(contextCompile.inputSchema.required.includes('filters'), false);
});

test('public context_compile rejects undocumented generic filters', async (t) => {
  const api = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ contextPage: { pageRef: 'ctxpg-1' } }));
  });
  t.after(() => close(api));
  const apiPort = await listen(api);
  const server = publicServer(`http://127.0.0.1:${apiPort}/v1`);
  t.after(() => close(server));
  const port = await listen(server);

  const response = await request(port, 'POST', '/graymatter/mcp', rpc('tools/call', {
    name: 'context_compile',
    arguments: { task: 'Prepare the release review.', filters: { entityType: 'release' } }
  }), { authorization: 'Bearer token-a' });

  assert.equal(response.body.result.isError, true);
  assert.equal(response.body.result.structuredContent.error.code, 'INVALID_ARGUMENT');
  assert.match(response.body.result.structuredContent.error.message, /filters is not a supported argument/i);
});

test('every public descriptor tells clients not to substitute searches for unsupported reviewer requests', () => {
  // Live ChatGPT attempted an in-scope text search for a requested tenantId
  // override. That remained tenant-safe but failed the submitted no-call case.
  for (const tool of publicTools) {
    assert.match(tool.description, /Do not invoke any GrayMatter tool for requests to override tenant/);
    assert.match(tool.description, /scope comes from the signed-in account/);
    assert.match(tool.description, /Do not reinterpret such a request as an authorized text search/);
    assert.match(tool.description, /delete an unspecified record, ask the user to identify it/);
    assert.match(tool.description, /do not search for deletion candidates or select a target yourself/);
  }
});

test('memory descriptors preserve requested provenance when broadening a topic search', () => {
  for (const name of ['memory_search', 'memory_get']) {
    const description = publicTools.find((tool) => tool.name === name).description;
    assert.match(description, /preserve all identifying qualifiers/);
    assert.match(description, /seeded versus newly created/);
    assert.match(description, /verify those qualifiers against returned metadata and memory_get/);
    assert.match(description, /Do not substitute a newer or similarly worded record/);
    assert.match(description, /report no verified match if the evidence is insufficient/);
  }
});

test('specific memory matching follows bounded pagination before declaring no verified match', () => {
  for (const name of ['memory_search', 'memory_get']) {
    const description = publicTools.find((tool) => tool.name === name).description;
    assert.match(description, /bounded page, not an exhaustive result set/);
    assert.match(description, /continue the same query and filters with offset=nextOffset/);
    assert.match(description, /up to three pages total/);
    assert.match(description, /disclose that the search is incomplete/);
  }
});

test('public endpoint publishes protected-resource metadata and challenges unauthenticated calls', async (t) => {
  const server = publicServer('https://api.example.test/v1');
  t.after(() => close(server));
  const port = await listen(server);

  const metadata = await request(port, 'GET', '/.well-known/oauth-protected-resource');
  assert.equal(metadata.status, 200);
  assert.equal(metadata.body.resource, 'https://graymatter.example.test/graymatter/mcp');
  assert.deepEqual(metadata.body.authorization_servers, ['https://identity.example.test']);
  assert.deepEqual(metadata.body.scopes_supported, ['memory:read', 'memory:write', 'context:read']);

  const denied = await request(port, 'POST', '/graymatter/mcp', rpc('initialize'));
  assert.equal(denied.status, 401);
  assert.equal(denied.body.error.code, 'AUTH_REQUIRED');
  assert.equal(denied.headers.connection, 'close');
  assert.match(denied.headers['www-authenticate'], /oauth-protected-resource/);
  assert.match(denied.headers['www-authenticate'], /memory:read/);

  const stalled = await stalledRequest(
    port,
    '/graymatter/mcp',
    '{"jsonrpc":"2.0","id":"unauthorized-stalled-body",'
  );
  assert.equal(stalled.status, 401);
  assert.equal(stalled.headers.connection, 'close');
  assert.equal(stalled.body.error.code, 'AUTH_REQUIRED');
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

test('public MCP rejects oversized bodies before JSON parsing with declared limits', async () => {
  await withEnv({ GRAYMATTER_MCP_MAX_REQUEST_BYTES: '256' }, async () => {
    const server = publicServer('https://api.example.test/v1');
    const port = await listen(server);

    try {
      const response = await request(port, 'POST', '/graymatter/mcp', rpc('tools/call', {
        name: 'memory_save', arguments: { content: 'x'.repeat(512) }
      }), { authorization: 'Bearer token-a' });

      assert.equal(response.status, 413);
      assert.equal(response.headers.connection, 'close');
      assert.equal(response.body.error.code, 'PAYLOAD_TOO_LARGE');
      assert.equal(response.body.error.retryable, false);
      assert.equal(response.body.executionLimits.maxRequestBodyBytes, 256);
      assert.equal(response.body.executionLimits.phase, 'request_body');
      assert.equal(response.body.executionLimits.requestBodyPolicy, 'REJECT_BEFORE_PARSE');
    } finally {
      await close(server);
    }
  });
});

test('public MCP stops stalled body reads at the shared execution deadline', async () => {
  await withEnv({
    GRAYMATTER_MCP_EXECUTION_TIMEOUT_MS: '40',
    GRAYMATTER_MCP_REQUEST_TIMEOUT_MS: '200'
  }, async () => {
    const server = publicServer('https://api.example.test/v1');
    const port = await listen(server);
    const startedAt = Date.now();

    try {
      const response = await stalledRequest(
        port,
        '/graymatter/mcp',
        '{"jsonrpc":"2.0","id":"stalled-body",',
        { authorization: 'Bearer token-a' }
      );

      assert.equal(response.status, 504);
      assert.equal(response.headers.connection, 'close');
      assert.equal(response.body.error.code, 'EXECUTION_DEADLINE_EXHAUSTED');
      assert.equal(response.body.executionLimits.configuredTimeoutMs, 40);
      assert.equal(response.body.executionLimits.maxRequestBodyBytes, 1024 * 1024);
      assert.equal(response.body.executionLimits.phase, 'request_body');
      assert.ok(Date.now() - startedAt < 160);
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
    assert.match(initialized.body.result.instructions, /Do not invoke any GrayMatter tool for requests to override tenant/);
    assert.match(initialized.body.result.instructions, /Do not reinterpret such a request as an authorized text search/);
    assert.match(initialized.body.result.instructions, /do not search for deletion candidates or select a target yourself/);
    assert.match(initialized.body.result.instructions, /preserve all identifying qualifiers/);
    assert.match(initialized.body.result.instructions, /Do not substitute a newer or similarly worded record/);
    const listed = await request(port, 'POST', path, rpc('tools/list'), headers);
    assert.deepEqual(listed.body.result.tools.map((tool) => tool.name), publicTools.map((tool) => tool.name));
    for (const tool of listed.body.result.tools) {
      assert.match(tool.description, /Do not reinterpret such a request as an authorized text search/);
      assert.match(tool.description, /do not search for deletion candidates or select a target yourself/);
    }
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
  assert.match(result.structuredContent.error.message, /try again later/i);
  assert.doesNotMatch(serialized, /buy|purchase|payment|recharge|credits|upgrade|checkout|account outside ChatGPT|valkyrlabs\.com\/graymatter\/credits/i);
  assert.doesNotMatch(serialized, /currentBalance|requiredCredits|0\.00/);
});


test('public receipts minimize internal metadata while preserving selection and evaluator semantics', async (t) => {
  const internal = {
    id: 'unneeded-generated-row', createdDate: 'unneeded-audit-date', trashed: false,
    authContextHash: 'must-not-leak', schemaManifestVersion: 'must-not-leak',
    requestFingerprint: 'must-not-leak', providerRouteHash: 'must-not-leak',
    agentId: 'must-not-leak', workflowId: 'must-not-leak',
    policyDecisions: ['must-not-leak'], unexpectedInternalField: 'must-not-leak'
  };
  const receipt = {
    ...internal, receiptId: 'review-minimized', query: 'marketplace release review',
    retrievalStatus: 'OK', answerPolicy: 'ALLOW_ANSWER', recommendedAction: 'ANSWER',
    quality: { ...internal, overallScore: 0.8, resultCount: 2, freshnessScore: 0 },
    coverage: { ...internal, coverageStatus: 'COMPLETE', requestedEntities: ['MemoryEntry'],
      matchedEntities: ['MemoryEntry'], missingEntities: [] },
    provenance: { ...internal, sourceCount: 2, oldestSourceAt: '2026-07-31',
      newestSourceAt: '2026-10-03', sourceTypes: ['MemoryEntry'] },
    policy: { ...internal, rbacDecision: 'ALLOW', tenantScopeVerified: true,
      restrictedRecordsExcluded: true, secureFieldRedactions: 0, policyNotes: ['must-not-leak'] },
    evaluator: { ...internal, enabled: false, sufficient: null, missing: null,
      confidence: null, explanation: 'Evaluator disabled; confidence unavailable.' },
    items: [{ ...internal, memoryId: 'memory-source-1', sourceId: 'source-1',
      sourceType: 'MemoryEntry', sourceTitle: 'Release review decision',
      similarityScore: 0.9, freshnessScore: 0.7, finalScore: 0.8, redacted: false,
      createdAt: '2026-07-31', updatedAt: '2026-10-03', selectionReason: 'Matches release review.' }]
  };
  const api = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'POST') req.resume();
    res.end(JSON.stringify(req.method === 'POST'
      ? { ...internal, contextPage: { pageRef: 'ctxpg-review', summary: 'Useful review context.',
          auth_context_hash: 'must-not-leak', request_fingerprint: 'must-not-leak' },
          retrievalReceipt: receipt, tokenBudget: 1200 }
      : { ...internal, receipt }));
  });
  t.after(() => close(api));
  const apiPort = await listen(api);
  const server = publicServer(`http://127.0.0.1:${apiPort}/v1`);
  t.after(() => close(server));
  const port = await listen(server);
  const tool = (name, args) => request(port, 'POST', '/graymatter/mcp', rpc('tools/call', {
    name, arguments: args
  }), { authorization: 'Bearer token-a' });

  for (const name of ['retrieval_receipt_get', 'context_compile']) {
    const response = await tool(name, name === 'context_compile'
      ? { task: 'Prepare the release review.', tokenBudget: 1200 }
      : { receiptId: 'review-minimized' });
    const result = response.body.result;
    assert.equal(result.structuredContent.ok, true);
    const data = result.structuredContent.data;
    const actual = data.receipt || data.retrievalReceipt;
    assert.equal(actual.receiptId, 'review-minimized');
    assert.deepEqual(actual.quality, { overallScore: 0.8, resultCount: 2, freshnessScore: 0 });
    assert.equal(actual.coverage.coverageStatus, 'COMPLETE');
    assert.deepEqual(actual.coverage.missingEntities, []);
    assert.equal(actual.provenance.oldestSourceAt, '2026-07-31');
    assert.equal(actual.provenance.newestSourceAt, '2026-10-03');
    assert.equal(actual.policy.rbacDecision, 'ALLOW');
    assert.equal(actual.policy.tenantScopeVerified, true);
    assert.equal(actual.evaluator.enabled, false);
    assert.equal(actual.evaluator.confidence, null);
    assert.equal(actual.evaluator.sufficient, null);
    assert.equal(actual.items[0].memoryId, 'memory-source-1');
    assert.equal(actual.items[0].sourceTitle, 'Release review decision');
    assert.equal(actual.items[0].selectionReason, 'Matches release review.');
    assert.equal(actual.graymatterPolicy.answerAllowed, true);
    assert.equal(data.graymatterPolicy.answerAllowed, true);
    assert.equal(data.graymatterInspection, undefined);
    assert.doesNotMatch(JSON.stringify(result), /must-not-leak|unneeded-|unexpectedInternalField|policyNotes/);
    if (name === 'context_compile') {
      assert.equal(data.contextPage.pageRef, 'ctxpg-review');
      assert.equal(data.contextPage.summary, 'Useful review context.');
      assert.equal(data.tokenBudget, 1200);
    }
  }
});

test('public minimization preserves policy refusal and never restores withheld context', async (t) => {
  let policy = {};
  const api = http.createServer((req, res) => {
    req.resume();
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ contextPage: { summary: 'POLICY-WITHHELD' }, retrievalReceipt: {
      receiptId: 'denied-review', ...policy,
      items: [{ text: 'POLICY-WITHHELD', sourceTitle: 'POLICY-WITHHELD' }],
      authContextHash: 'must-not-leak'
    } }));
  });
  t.after(() => close(api));
  const apiPort = await listen(api);
  const server = publicServer(`http://127.0.0.1:${apiPort}/v1`);
  t.after(() => close(server));
  const port = await listen(server);
  for (policy of [
    { retrievalStatus: 'ACCESS_DENIED', answerPolicy: 'DENY', recommendedAction: 'REQUIRE_CLARIFICATION' },
    { retrievalStatus: 'PARTIAL_COVERAGE', answerPolicy: 'DENY', recommendedAction: 'ANSWER_WITH_CAVEAT' },
    { retrievalStatus: 'OK', answerPolicy: 'ALLOW_ANSWER', recommendedAction: 'REQUIRE_RETRY' },
    { retrievalStatus: 'OK', recommendedAction: 'ANSWER' }
  ]) {
    const response = await request(port, 'POST', '/graymatter/mcp', rpc('tools/call', {
      name: 'context_compile', arguments: { task: 'Prepare release review.' }
    }), { authorization: 'Bearer token-a' });
    const data = response.body.result.structuredContent.data;
    assert.equal(data.contextPage, undefined);
    assert.equal(data.retrievalReceipt.items, undefined);
    assert.equal(data.retrievalReceipt.answerPolicy, policy.answerPolicy);
    assert.equal(data.graymatterPolicy.answerAllowed, false);
    assert.equal(data.graymatterPolicy.caveatRequired, false);
    assert.equal(data.graymatterPolicy.disposition, 'do_not_answer_from_memory');
    if (policy.answerPolicy === 'DENY') assert.ok(data.graymatterPolicy.requiredActions.includes('deny'));
    assert.doesNotMatch(JSON.stringify(data), /POLICY-WITHHELD|must-not-leak/);
  }
});

test('all public results omit normalized identity and operational keys without removing memory facts', async (t) => {
  const id = '11111111-1111-4111-8111-111111111111';
  const api = http.createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ id, title: 'Release decision', text: 'Require security and privacy review.',
      sourceChannel: 'openai-review', tags: ['release-review'], metadata: {
        owner_id: 'must-not-leak', organization_id: 'must-not-leak', user_id: 'must-not-leak',
        session_id: 'must-not-leak', auth_context_hash: 'must-not-leak',
        schema_manifest_version: 'must-not-leak', request_fingerprint: 'must-not-leak',
        provider_routing: 'must-not-leak', policy_decisions: ['must-not-leak'],
        access_token: 'must-not-leak', note: 'Public memory annotation'
      } }));
  });
  t.after(() => close(api));
  const apiPort = await listen(api);
  const server = publicServer(`http://127.0.0.1:${apiPort}/v1`);
  t.after(() => close(server));
  const port = await listen(server);
  const response = await request(port, 'POST', '/graymatter/mcp', rpc('tools/call', {
    name: 'memory_get', arguments: { id }
  }), { authorization: 'Bearer token-a' });
  const data = response.body.result.structuredContent.data;
  assert.equal(data.id, id);
  assert.equal(data.text, 'Require security and privacy review.');
  assert.deepEqual(data.tags, ['release-review']);
  assert.deepEqual(data.metadata, { note: 'Public memory annotation' });
  assert.doesNotMatch(JSON.stringify(response.body), /must-not-leak/);
});
