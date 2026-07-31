'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { createGrayMatterMcpServer, publicTools } = require('../index');

const FIXTURE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT_ID = '22222222-2222-4222-8222-222222222222';
const CREATED_ID = '33333333-3333-4333-8333-333333333333';
const RECEIPT_ID = 'review-receipt-1';

function listen(server) {
  return new Promise((resolve) => server.listen(
    0,
    '127.0.0.1',
    () => resolve(server.address().port)
  ));
}

function close(server) {
  return new Promise((resolve, reject) => server.close(
    (error) => error ? reject(error) : resolve()
  ));
}

function request(port, body, token = 'token-a') {
  return new Promise((resolve, reject) => {
    const raw = JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path: '/graymatter/mcp',
      headers: {
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(raw)
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(
        JSON.parse(Buffer.concat(chunks).toString('utf8'))
      ));
    });
    req.on('error', reject);
    req.write(raw);
    req.end();
  });
}

function rpc(method, params, id = 1) {
  return { jsonrpc: '2.0', id, method, ...(params ? { params } : {}) };
}

function verifier(token) {
  if (!['token-a', 'token-b'].includes(token)) {
    throw new Error('unknown local reviewer token');
  }
  const tenant = token === 'token-a' ? 'tenant-a' : 'tenant-b';
  return {
    claims: {
      sub: `user-${tenant}`,
      tenantId: tenant,
      organizationId: `org-${tenant}`,
      roles: ['ROLE_GRAYMATTER_USER'],
      permissions: ['MEMORY_READ', 'MEMORY_WRITE'],
      scope: 'memory:read memory:write context:read'
    }
  };
}

function createFixtureApi() {
  const memories = new Map([
    ['token-a', new Map([[
      FIXTURE_ID,
      {
        id: FIXTURE_ID,
        title: 'Current marketplace release review decision',
        text: 'Release review requires security and privacy checks.',
        type: 'decision',
        tags: ['release-review', 'seeded-reviewer-fixture'],
        sourceChannel: 'openai-review',
        tenantId: 'tenant-a',
        ownerId: 'user-tenant-a',
        debugTrace: 'must-not-leak'
      }
    ]])],
    ['token-b', new Map([[
      OTHER_TENANT_ID,
      {
        id: OTHER_TENANT_ID,
        title: 'Tenant B private onboarding plan',
        text: 'Unrelated private tenant B content.',
        type: 'context',
        tags: ['tenant-b-private'],
        tenantId: 'tenant-b',
        ownerId: 'user-tenant-b'
      }
    ]])]
  ]);
  const counts = {
    reads: 0,
    writes: 0,
    updates: 0,
    deletes: 0,
    compiles: 0,
    procedures: 0,
    receipts: 0
  };
  const violations = [];

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const tenantMemories = memories.get(token);
      if (!tenantMemories) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: 'unauthorized' }));
        return;
      }
      for (const header of ['x-tenant-id', 'x-organization-id', 'x-owner-id', 'cookie', 'valkyr_auth']) {
        if (req.headers[header] !== undefined) violations.push(header);
      }
      res.setHeader('content-type', 'application/json');

      if (req.method === 'POST' && req.url === '/v1/MemoryEntry/query') {
        counts.reads += 1;
        const terms = String(body.query || '').toLowerCase().split(/\s+/).filter(Boolean);
        const matches = [...tenantMemories.values()].filter((memory) => {
          const searchable = [
            memory.title,
            memory.text,
            ...(memory.tags || [])
          ].join(' ').toLowerCase();
          return terms.every((term) => searchable.includes(term));
        });
        res.end(JSON.stringify(matches));
        return;
      }

      if (req.method === 'POST' && req.url === '/v1/MemoryEntry/write') {
        counts.writes += 1;
        const value = {
          id: CREATED_ID,
          ...body,
          tenantId: token === 'token-a' ? 'tenant-a' : 'tenant-b',
          ownerId: `user-${token}`,
          accessToken: 'must-not-leak'
        };
        tenantMemories.set(CREATED_ID, value);
        res.end(JSON.stringify(value));
        return;
      }

      const memoryMatch = req.url.match(/^\/v1\/MemoryEntry\/([0-9a-f-]+)$/i);
      if (memoryMatch) {
        const id = memoryMatch[1];
        const existing = tenantMemories.get(id);
        if (!existing) {
          res.writeHead(404);
          res.end(JSON.stringify({ message: 'authorized record not found' }));
          return;
        }
        if (req.method === 'GET') {
          counts.reads += 1;
          res.end(JSON.stringify(existing));
          return;
        }
        if (req.method === 'PATCH') {
          counts.updates += 1;
          const updated = { ...existing, ...body };
          tenantMemories.set(id, updated);
          res.end(JSON.stringify(updated));
          return;
        }
        if (req.method === 'DELETE') {
          counts.deletes += 1;
          tenantMemories.delete(id);
          res.writeHead(204);
          res.end();
          return;
        }
      }

      if (req.method === 'POST' && req.url === '/v1/graymatter_ops/context_page/compile') {
        counts.compiles += 1;
        res.end(JSON.stringify({
          contextSummary: 'Use only the release decision and production review procedure.',
          tokenBudget: body.tokenBudget,
          receiptId: RECEIPT_ID,
          retrievalStatus: 'PARTIAL_COVERAGE',
          answerPolicy: 'ALLOW_WITH_CAVEAT',
          recommendedAction: 'ANSWER_WITH_CAVEAT',
          tenantId: 'must-not-leak'
        }));
        return;
      }

      if (req.method === 'GET' && req.url.startsWith('/v1/Procedure?')) {
        counts.procedures += 1;
        res.end(JSON.stringify([{
          id: 'procedure-release-review',
          name: 'Production release review',
          description: 'Run security, privacy, readiness, and rollback checks.',
          procedureRef: 'procedure:production-release-review:v1',
          confidence: 0.97,
          enabled: true,
          ownerId: 'must-not-leak'
        }]));
        return;
      }

      if (req.method === 'GET' && req.url === `/v1/graymatter-retrieval-receipts/${RECEIPT_ID}`) {
        counts.receipts += 1;
        res.end(JSON.stringify({
          receipt: {
            receiptId: RECEIPT_ID,
            provenance: ['memory:release-review', 'procedure:production-release-review:v1'],
            confidence: 0.74,
            coverage: 'partial',
            freshness: 'current',
            retrievalStatus: 'PARTIAL_COVERAGE',
            answerPolicy: 'ALLOW_WITH_CAVEAT',
            recommendedAction: 'ANSWER_WITH_CAVEAT',
            principalId: 'must-not-leak'
          }
        }));
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ message: 'route not found' }));
    });
  });

  return { server, memories, counts, violations };
}

function publicServer(apiBase) {
  return createGrayMatterMcpServer({
    apiBase,
    deploymentMode: 'hosted-multi-tenant',
    publicApp: true,
    publicResource: 'https://graymatter.example.test',
    oauthIssuer: 'https://identity.example.test',
    tokenVerifier: verifier,
    allowedOrigins: ['https://chatgpt.com']
  });
}

test('locked submission matrix passes all 8 positive and 3 negative reviewer cases locally', async (t) => {
  const fixture = createFixtureApi();
  t.after(() => close(fixture.server));
  const apiPort = await listen(fixture.server);
  const mcp = publicServer(`http://127.0.0.1:${apiPort}/v1`);
  t.after(() => close(mcp));
  const mcpPort = await listen(mcp);

  const tool = async (name, args, token = 'token-a') => {
    const response = await request(
      mcpPort,
      rpc('tools/call', { name, arguments: args }),
      token
    );
    return response.result;
  };

  const initialized = await request(mcpPort, rpc('initialize'));
  const instructions = initialized.result.instructions;

  await t.test('positive 1/8 memory_search sees the seeded reviewer fixture only in its tenant', async () => {
    const found = await tool('memory_search', {
      query: 'current release review decision',
      limit: 5
    });
    assert.equal(found.structuredContent.ok, true);
    assert.deepEqual(
      found.structuredContent.data.map((memory) => memory.id),
      [FIXTURE_ID]
    );
    assert.doesNotMatch(JSON.stringify(found), /tenantId|ownerId|debugTrace|must-not-leak/);

    const isolated = await tool('memory_search', {
      query: 'current release review decision',
      limit: 5
    }, 'token-b');
    assert.deepEqual(isolated.structuredContent.data, []);
  });

  await t.test('positive 2/8 memory_get retrieves the seeded authorized fixture by UUID', async () => {
    const found = await tool('memory_get', { id: FIXTURE_ID });
    assert.equal(found.structuredContent.data.id, FIXTURE_ID);
    const crossTenant = await tool('memory_get', { id: FIXTURE_ID }, 'token-b');
    assert.equal(crossTenant.structuredContent.error.code, 'NOT_FOUND');
    assert.equal(crossTenant.structuredContent.error.retryable, false);
  });

  await t.test('positive 3/8 memory_save creates a harmless tenant-derived decision', async () => {
    const saved = await tool('memory_save', {
      title: 'Marketplace release decision',
      content: 'Marketplace release candidates require a security and privacy review.',
      type: 'decision',
      source: 'openai-review'
    });
    assert.equal(saved.structuredContent.ok, true);
    assert.equal(saved.structuredContent.data.id, CREATED_ID);
    assert.doesNotMatch(JSON.stringify(saved), /tenantId|ownerId|accessToken|must-not-leak/);
  });

  await t.test('positive 4/8 memory_search plus memory_update revises only permitted fields', async () => {
    const searched = await tool('memory_search', {
      query: 'marketplace release candidates',
      limit: 5
    });
    assert.equal(searched.structuredContent.data[0].id, CREATED_ID);

    const updated = await tool('memory_update', {
      id: CREATED_ID,
      content: 'Marketplace release candidates require security, privacy, and reviewer-readiness checks.',
      tags: ['release-review', 'reviewer-readiness']
    });
    assert.equal(updated.structuredContent.ok, true);
    assert.match(updated.structuredContent.data.text, /reviewer-readiness/);
    assert.deepEqual(updated.structuredContent.data.tags, ['release-review', 'reviewer-readiness']);
    assert.equal(fixture.counts.updates, 1);
  });

  await t.test('positive 5/8 context_compile returns bounded context, receipt, and caveat policy', async () => {
    const compiled = await tool('context_compile', {
      task: 'Prepare the marketplace release review.',
      tokenBudget: 1200,
      includeProcedures: true,
      includeRatings: true
    });
    const data = compiled.structuredContent.data;
    assert.equal(data.tokenBudget, 1200);
    assert.equal(data.receiptId, RECEIPT_ID);
    assert.equal(data.retrievalStatus, 'PARTIAL_COVERAGE');
    assert.equal(data.answerPolicy, 'ALLOW_WITH_CAVEAT');
    assert.equal(data.graymatterPolicy.caveatRequired, true);
    assert.equal(data.graymatterPolicy.disposition, 'answer_with_caveat');
    assert.doesNotMatch(JSON.stringify(compiled), /tenantId|must-not-leak/);
  });

  await t.test('positive 6/8 procedure_search finds the production release-review procedure', async () => {
    const found = await tool('procedure_search', {
      query: 'production release review',
      limit: 5
    });
    assert.equal(found.structuredContent.data.length, 1);
    assert.equal(
      found.structuredContent.data[0].procedureRef,
      'procedure:production-release-review:v1'
    );
    assert.doesNotMatch(JSON.stringify(found), /ownerId|must-not-leak/);
  });

  await t.test('positive 7/8 retrieval_receipt_get exposes provenance and policy without identity', async () => {
    const found = await tool('retrieval_receipt_get', { receiptId: RECEIPT_ID });
    const receipt = found.structuredContent.data.receipt;
    assert.equal(receipt.receiptId, RECEIPT_ID);
    assert.equal(receipt.confidence, 0.74);
    assert.equal(receipt.coverage, 'partial');
    assert.equal(receipt.graymatterPolicy.caveatRequired, true);
    assert.match(receipt.provenance.join(' '), /release-review/);
    assert.doesNotMatch(JSON.stringify(found), /principalId|must-not-leak/);
  });

  await t.test('positive 8/8 memory_search plus confirmed memory_forget removes the exact test memory', async () => {
    const searched = await tool('memory_search', {
      query: 'marketplace release candidates reviewer-readiness',
      limit: 5
    });
    assert.equal(searched.structuredContent.data[0].id, CREATED_ID);

    const forgotten = await tool('memory_forget', {
      id: CREATED_ID,
      confirm: true,
      confirmationText: 'Forget the exact marketplace release decision created in this reviewer test.'
    });
    assert.equal(forgotten.structuredContent.ok, true);
    assert.deepEqual(forgotten.structuredContent.data, {
      id: CREATED_ID,
      forgotten: true
    });
    assert.equal(fixture.counts.deletes, 1);

    const missing = await tool('memory_get', { id: CREATED_ID });
    assert.equal(missing.structuredContent.error.code, 'NOT_FOUND');
  });

  await t.test('negative 1/3 OAuth-token persistence is forbidden and never reaches memory_save upstream', async () => {
    const writeCount = fixture.counts.writes;
    const saveDescriptor = publicTools.find((tool) => tool.name === 'memory_save');
    assert.match(saveDescriptor.description, /do not use for secrets/i);
    assert.match(instructions, /never store oauth tokens/i);

    const denied = await tool('memory_save', {
      content: 'Save my OAuth access token in GrayMatter so you can use it later.'
    });
    assert.equal(denied.structuredContent.error.code, 'INVALID_ARGUMENT');
    assert.match(denied.structuredContent.error.message, /secrets and credentials/i);
    assert.equal(fixture.counts.writes, writeCount);
  });

  await t.test('negative 2/3 caller-supplied tenant override is rejected before search', async () => {
    const readCount = fixture.counts.reads;
    const denied = await tool('memory_search', {
      query: 'release decision',
      tenantId: 'tenant-b'
    });
    assert.equal(denied.structuredContent.error.code, 'INVALID_ARGUMENT');
    assert.equal(fixture.counts.reads, readCount);
  });

  await t.test('negative 3/3 vague deletion without exact UUID and confirmation never reaches upstream', async () => {
    const deleteCount = fixture.counts.deletes;
    const forgetDescriptor = publicTools.find((tool) => tool.name === 'memory_forget');
    assert.match(forgetDescriptor.description, /exact memory UUID/i);
    assert.match(instructions, /exact memory UUID and explicit confirmation/i);

    const denied = await tool('memory_forget', {
      confirmationText: 'Delete whatever memory is no longer useful.'
    });
    assert.equal(denied.structuredContent.error.code, 'INVALID_ARGUMENT');
    assert.equal(fixture.counts.deletes, deleteCount);
  });

  assert.deepEqual(fixture.violations, []);
  assert.equal(fixture.counts.writes, 1);
  assert.equal(fixture.counts.updates, 1);
  assert.equal(fixture.counts.deletes, 1);
  assert.equal(fixture.counts.compiles, 1);
  assert.equal(fixture.counts.procedures, 1);
  assert.equal(fixture.counts.receipts, 1);
});

test('retryable upstream mapping distinguishes dependency failures from missing records', async (t) => {
  const api = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'POST' && req.url === '/v1/MemoryEntry/write') {
      res.writeHead(404);
      res.end(JSON.stringify({
        error: 'Missing referenced entity',
        message: 'Unable to find com.valkyrlabs.model.Tag with id secret-internal-id'
      }));
      return;
    }
    res.writeHead(404);
    res.end(JSON.stringify({ message: 'authorized record not found' }));
  });
  t.after(() => close(api));
  const apiPort = await listen(api);
  const mcp = publicServer(`http://127.0.0.1:${apiPort}/v1`);
  t.after(() => close(mcp));
  const mcpPort = await listen(mcp);

  const save = await request(mcpPort, rpc('tools/call', {
    name: 'memory_save',
    arguments: { content: 'Harmless release decision.' }
  }));
  assert.equal(save.result.structuredContent.error.code, 'UPSTREAM_UNAVAILABLE');
  assert.equal(save.result.structuredContent.error.retryable, true);
  assert.doesNotMatch(JSON.stringify(save), /Tag|secret-internal-id|Missing referenced entity/i);

  const get = await request(mcpPort, rpc('tools/call', {
    name: 'memory_get',
    arguments: { id: FIXTURE_ID }
  }));
  assert.equal(get.result.structuredContent.error.code, 'NOT_FOUND');
  assert.equal(get.result.structuredContent.error.retryable, false);
});
