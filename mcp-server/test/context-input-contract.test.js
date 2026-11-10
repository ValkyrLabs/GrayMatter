'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

const target = require(process.env.GRAYMATTER_TEST_MODULE
  ? path.resolve(process.env.GRAYMATTER_TEST_MODULE) : '../index');
const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = (server) => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
const claims = {
  sub: 'local-reviewer', tenantId: 'local-tenant', organizationId: 'local-org',
  scope: 'memory:read memory:write context:read'
};
const makeServer = (apiBase) => target.createGrayMatterMcpServer({
  apiBase, publicApp: true, deploymentMode: 'hosted-multi-tenant',
  publicResource: 'https://graymatter.example.test', oauthIssuer: 'https://identity.example.test',
  allowedOrigins: ['https://chatgpt.com'], tokenVerifier: () => ({ claims })
});
const rpc = async (port, route, method, params) => {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', authorization: 'Bearer local-test-only' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) })
  });
  assert.equal(response.status, 200);
  return response.json();
};

test('factual context task contract and both initialize routes preserve the original authorized user task', async (t) => {
  const descriptor = target.publicTools.find((tool) => tool.name === 'context_compile');
  const task = descriptor.inputSchema.properties.task;
  assert.equal(typeof task.description, 'string');
  assert.match(task.description, /Original user task text, unchanged/);
  assert.match(task.description, /explicit constraints/);
  assert.doesNotMatch(task.description, /Do not expand|invented.*checklist/);
  assert.match(descriptor.description, /Writes a ContextPage and a retrieval receipt for fresh retrieval/);
  assert.doesNotMatch(descriptor.description, /call before|Prefer this|Do not expand/i);
  assert.equal(task.type, 'string');
  assert.equal(task.maxLength, 12000);
  assert.deepEqual(descriptor.inputSchema.required, ['task']);
  assert.equal(descriptor.inputSchema.additionalProperties, false);
  const server = makeServer('http://127.0.0.1:1/v1');
  t.after(() => close(server));
  const port = await listen(server);
  for (const route of ['/graymatter/mcp', '/mcp']) {
    const initialized = await rpc(port, route, 'initialize');
    assert.match(initialized.result.instructions, /original user task text unchanged/);
    assert.match(initialized.result.instructions, /Do not expand/);
    assert.match(initialized.result.instructions, /Do not invoke any GrayMatter tool for requests to override tenant/);
    assert.match(initialized.result.instructions, /do not search for deletion candidates/);
    const listed = await rpc(port, route, 'tools/list');
    const compiled = listed.result.tools.find((tool) => tool.name === 'context_compile');
    assert.deepEqual(compiled, descriptor);
  }
});

const receiptUuid = '10000000-0000-4000-8000-000000000001';
const seedUuid = '20000000-0000-4000-8000-000000000002';
const targetUuid = '30000000-0000-4000-8000-000000000003';
const typedTask = 'Quartz courier';
const claimScope = 'typed_path_and_endpoint_projection_only';

function typedResponse() {
  const sourceIds = ['contentmedialink:' + seedUuid, 'contentdata:' + targetUuid];
  return {
    summary: 'DO_NOT_RELEASE_DUPLICATE_TOP_BODY',
    selectedItems: [{ summary: 'DO_NOT_RELEASE_ALTERNATE_BODY' }],
    retrievalReceipt: {
      id: receiptUuid, receiptId: 'receipt-pair-1', query: typedTask,
      retrievalStatus: 'PARTIAL_COVERAGE', answerPolicy: 'ALLOW_WITH_CAVEAT', recommendedAction: 'ANSWER_WITH_CAVEAT',
      policy: { rbacDecision: 'ALLOW', tenantScopeVerified: true,
        policyNotes: ['graph_evidence_claim_scope=' + claimScope, 'generated_graph_proof_items=1', 'PRIVATE_NOTE'] },
      items: [{ entityType: 'ContentData', entityId: targetUuid, sourceType: 'thorapi-generated-graph/v2|retrieval:graph',
        textHash: 'b'.repeat(64), redacted: false }]
    },
    contextPage: {
      pageRef: 'ctxpg-pair-1', taskIntent: typedTask, status: 'compiled',
      policy: 'typed_path_endpoints/v1=' + 'a'.repeat(64) + '; policy-private',
      compactSummary: 'DO_NOT_RELEASE_DUPLICATE_BODY',
      items: sourceIds.map((sourceId, i) => ({ itemRef: 'ctxitem-' + sourceId, sourceId,
        sourceType: 'generated_domain_record', retained: true, summary: i ? 'Target preview' : 'Anchor preview',
        retrievalReceiptItem: { text: 'DO_NOT_RELEASE_NESTED_BODY' } })),
      hydrationPointers: sourceIds.map((targetId, i) => ({ targetId, targetType: 'generated_domain_record',
        sourceVersion: 'graph-projection:' + (i ? 'b' : 'c').repeat(64), summary: 'DO_NOT_RELEASE_POINTER_BODY' }))
    }
  };
}

async function typedHarness(t) {
  const requests = [];
  let response = typedResponse();
  const api = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(response));
    });
  });
  t.after(() => close(api));
  const server = makeServer(`http://127.0.0.1:${await listen(api)}/v1`);
  t.after(() => close(server));
  const port = await listen(server);
  return { requests, setResponse: value => { response = value; },
    call: async args => (await rpc(port, '/graymatter/mcp', 'tools/call', {
      name: 'context_compile', arguments: { task: typedTask, ...args }
    })).result };
}

test('existing receipt locator delegates only to owning Cloud compile and preserves typed claim scope', async t => {
  const h = await typedHarness(t);
  for (const ref of [receiptUuid, 'receipt-pair-1']) {
    const result = await h.call({ retrievalReceiptRef: ref, includeTypedPathEndpoints: true });
    assert.equal(result.structuredContent.ok, true);
    const request = h.requests.at(-1);
    assert.deepEqual(request, { method: 'POST', url: '/v1/graymatter_ops/context_page/compile',
      authorization: 'Bearer local-test-only', body: {
        taskIntent: typedTask, tokenBudget: 4000, includeProcedures: true, includeRatings: true,
        retrievalReceipt: ref === receiptUuid ? { id: receiptUuid } : { receiptId: ref }, includeTypedPathEndpoints: true
      } });
    const data = result.structuredContent.data;
    assert.equal(data.evidenceClaimScope, claimScope);
    assert.equal(data.graymatterPolicy.evidenceClaimScope, claimScope);
    assert.equal(data.graymatterPolicy.answerAllowed, false);
    assert.equal(data.graymatterPolicy.caveatRequired, true);
    assert.deepEqual(data.typedPathEndpoints, { count: 2, projection: 'compact_preview', exactProjectionRequiresOwningHydration: true });
    assert.equal(data.contextPage.items.length, 2);
    assert.equal(data.contextPage.pageRef, 'ctxpg-pair-1');
    assert.match(result.content[0].text, /does not authorize execution or arbitrary joined claims/);
    assert.doesNotMatch(JSON.stringify(result), /DO_NOT_RELEASE|PRIVATE_NOTE|graph-projection|policy-private/);
  }
  assert.equal(h.requests.length, 2, 'no receipt search, new retrieval, hydration or fallback calls');
  const ordinary = await h.call({ retrievalReceiptRef: 'receipt-pair-1', includeTypedPathEndpoints: false });
  assert.equal(ordinary.structuredContent.ok, true);
  assert.equal(h.requests.at(-1).body.includeTypedPathEndpoints, undefined);
});

test('typed endpoint input rejects missing locator, nonboolean, body passthrough and authority overrides before request', async t => {
  const h = await typedHarness(t);
  for (const args of [
    { includeTypedPathEndpoints: true },
    { retrievalReceiptRef: 'receipt-pair-1', includeTypedPathEndpoints: 'true' },
    { retrievalReceiptRef: '../receipt-pair-1', includeTypedPathEndpoints: true },
    { retrievalReceiptRef: ' receipt-pair-1', includeTypedPathEndpoints: true },
    { retrievalReceipt: { id: receiptUuid }, includeTypedPathEndpoints: true },
    { retrievalReceiptRef: receiptUuid, includeTypedPathEndpoints: true, ownerId: seedUuid },
    { retrievalReceiptRef: receiptUuid, includeTypedPathEndpoints: true, endpoint: '/MemoryEntry' }
  ]) {
    const result = await h.call(args);
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.ok, false);
  }
  assert.equal(h.requests.length, 0);
});

test('typed endpoint replies fail closed on ignored opt-in, inconsistent identities and unavailable policy proof', async t => {
  const h = await typedHarness(t);
  const mutations = [
    value => { value.receipt = { ...value.retrievalReceipt, id: seedUuid }; },
    value => { delete value.contextPage.policy; },
    value => { value.retrievalReceipt.id = seedUuid; },
    value => { value.contextPage.taskIntent = 'Different task'; },
    value => { value.retrievalReceipt.query = 'Different receipt query'; },
    value => { value.retrievalReceipt.policy.policyNotes = ['optional user prose ' + claimScope]; },
    value => { value.retrievalReceipt.policy.policyNotes.push('graph_evidence_claim_scope=' + claimScope); },
    value => { value.retrievalReceipt.policy.policyNotes.push('generated_graph_proof_items=2'); },
    value => { value.retrievalReceipt.items[0].sourceType = 'thorapi-generated-graph'; },
    value => { value.retrievalReceipt.items[0].redacted = true; },
    value => { value.retrievalReceipt.answerPolicy = 'ALLOW_ANSWER'; },
    value => { value.retrievalReceipt.retrievalStatus = 'RETRY_REQUIRED'; },
    value => { value.retrievalReceipt.policy.rbacDecision = 'DENY'; },
    value => { delete value.retrievalReceipt.policy.tenantScopeVerified; },
    value => { value.contextPage.items[1] = value.contextPage.items[0]; },
    value => { value.contextPage.items.pop(); },
    value => { value.contextPage.hydrationPointers.pop(); },
    value => { value.contextPage.hydrationPointers[1].sourceVersion = 'graph-projection:' + 'd'.repeat(64); },
    value => { value.retrievalReceipt.items[0].entityId = seedUuid; }
  ];
  for (const mutate of mutations) {
    const response = typedResponse();
    mutate(response);
    h.setResponse(response);
    const result = await h.call({ retrievalReceiptRef: receiptUuid, includeTypedPathEndpoints: true });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.error.code, 'CONTEXT_RESULT_UNVERIFIED');
    assert.equal(result.structuredContent.error.retryable, false);
    assert.equal(result.structuredContent.data, undefined);
    assert.doesNotMatch(JSON.stringify(result), /preview|DO_NOT_RELEASE|PRIVATE_NOTE|ctxpg-pair/);
  }
  assert.equal(h.requests.length, mutations.length);
});

function hydrationResponses() {
  const before = typedResponse();
  before.contextPage.id = '40000000-0000-4000-8000-000000000004';
  before.contextPage.ownerId = before.retrievalReceipt.ownerId = '50000000-0000-4000-8000-000000000005';
  before.contextPage.tenantId = before.retrievalReceipt.tenantId = 'org_synthetic';
  const after = structuredClone(before);
  after.contextPage.status = 'hydrated';
  after.contextPage.hydrationPointers.forEach((pointer, i) => {
    pointer.status = 'hydrated';
    pointer.summary = i ? 'Target field alpha\nTarget field beta' : 'Anchor field alpha\nAnchor field beta';
    after.contextPage.items[i].summary = pointer.summary;
    after.contextPage.items[i].hydrated = true;
  });
  return { before, after };
}

async function hydrationHarness(t) {
  const requests = [];
  let state = hydrationResponses();
  const api = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const post = req.method === 'POST';
      requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization,
        body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined });
      if (post && state.disconnect) { req.socket.destroy(); return; }
      res.writeHead((post ? state.postStatus : state.getStatus) || 200, { 'content-type': 'application/json',
        ...(state.redirect ? { location: '/must-not-follow' } : {}) });
      res.end((post ? state.postRaw : state.getRaw) || JSON.stringify(post ? state.after : state.before));
    });
  });
  t.after(() => close(api));
  const server = makeServer(`http://127.0.0.1:${await listen(api)}/v1`);
  t.after(() => close(server));
  const port = await listen(server);
  return { requests, set: value => { state = value; },
    call: async (args = {}) => (await rpc(port, '/graymatter/mcp', 'tools/call', {
      name: 'context_hydrate', arguments: { contextPageRef: 'ctxpg-pair-1', ...args }
    })).result };
}

test('public paired hydration uses owning current reads and returns both exact LF projections and versions', async t => {
  const h = await hydrationHarness(t);
  const result = await h.call({ maxTokens: 1024 });
  assert.equal(result.structuredContent.ok, true);
  const data = result.structuredContent.data;
  assert.deepEqual(h.requests, [
    { method: 'GET', url: '/v1/graymatter_ops/context_page/ctxpg-pair-1', authorization: 'Bearer local-test-only', body: undefined },
    { method: 'POST', url: '/v1/graymatter_ops/context_page/hydrate', authorization: 'Bearer local-test-only',
      body: { contextPageRef: 'ctxpg-pair-1', maxItems: 2, maxTokens: 1024 } }
  ]);
  assert.equal(data.evidenceClaimScope, claimScope);
  assert.equal(data.graymatterPolicy.answerAllowed, false);
  assert.equal(data.graymatterPolicy.caveatRequired, true);
  assert.equal(data.typedPathEndpoints.projection, 'exact_authorized_projection');
  assert.deepEqual(data.endpoints.map(endpoint => endpoint.text),
    ['Anchor field alpha\nAnchor field beta', 'Target field alpha\nTarget field beta']);
  assert.deepEqual(data.endpoints.map(endpoint => endpoint.sourceVersion),
    ['graph-projection:' + 'c'.repeat(64), 'graph-projection:' + 'b'.repeat(64)]);
  assert.doesNotMatch(JSON.stringify(result), /DO_NOT_RELEASE|PRIVATE_NOTE|org_synthetic|ownerId|policyNotes/);
});

test('public paired hydration checks owner denial and rejects nonpair or ambiguous preflight before writing', async t => {
  const h = await hydrationHarness(t);
  for (const status of [401, 403]) {
    h.set({ ...hydrationResponses(), getStatus: status });
    const start = h.requests.length;
    const result = await h.call();
    assert.equal(result.isError, true);
    assert.equal(h.requests.length - start, 1);
    assert.equal(h.requests.at(-1).method, 'GET');
    assert.equal(result.structuredContent.data, undefined);
  }
  for (const mutate of [
    before => { delete before.contextPage.policy; },
    before => { before.contextPage.pageRef = 'ctxpg-other'; },
    before => { before.retrievalReceipt.query = 'Different receipt query'; },
    before => { before.retrievalReceipt.ownerId = seedUuid; }
  ]) {
    const state = hydrationResponses(); mutate(state.before); h.set(state);
    const start = h.requests.length;
    const result = await h.call();
    assert.equal(result.structuredContent.error.code, 'CONTEXT_RESULT_UNVERIFIED');
    assert.equal(h.requests.length - start, 1);
  }
  for (const args of [{ pointerRefs: ['one'] }, { maxItems: 1 }, { maxTokens: 1 }, { contextPageRef: '../elsewhere' }]) {
    const start = h.requests.length;
    assert.equal((await h.call(args)).isError, true);
    assert.equal(h.requests.length, start);
  }
});

test('public paired hydration withholds the whole pair on postflight mismatch, partial output or body bounds', async t => {
  const h = await hydrationHarness(t);
  const changes = [
    state => { state.after.contextPage.ownerId = seedUuid; },
    state => { state.after.retrievalReceipt.query = 'Other query'; },
    state => { state.after.contextPage.hydrationPointers[0].sourceVersion = 'graph-projection:' + 'd'.repeat(64); },
    state => { state.after.contextPage.hydrationPointers[0].status = 'denied'; },
    state => { state.after.contextPage.items[0].summary = 'Different item body'; },
    state => { state.after.contextPage.hydrationPointers[0].summary = state.after.contextPage.items[0].summary = 'x'.repeat(4001); },
    state => { state.postRaw = JSON.stringify({ ...state.after, padding: 'x'.repeat(262144) }); },
    state => { state.postRaw = JSON.stringify(state.after).slice(0, -1) + ',"contextPage":null}'; },
    state => { state.postStatus = 202; }
  ];
  for (const change of changes) {
    const state = hydrationResponses(); change(state); h.set(state);
    const start = h.requests.length;
    const result = await h.call();
    assert.equal(result.structuredContent.error.code, 'CONTEXT_RESULT_UNVERIFIED');
    assert.equal(result.structuredContent.error.retryable, false);
    assert.equal(result.structuredContent.data, undefined);
    assert.doesNotMatch(JSON.stringify(result), /Anchor field|Target field|DO_NOT_RELEASE/);
    assert.equal(h.requests.length - start, 2);
  }
});

test('public paired hydration never retries denied, redirected or uncertain business POSTs', async t => {
  const h = await hydrationHarness(t);
  for (const extension of [{ postStatus: 401 }, { postStatus: 403 }, { disconnect: true }, { postStatus: 302, redirect: true }]) {
    h.set({ ...hydrationResponses(), ...extension });
    const start = h.requests.length;
    const result = await h.call();
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.data, undefined);
    assert.equal(h.requests.length - start, 2);
    assert.equal(h.requests.slice(start).filter(request => request.method === 'POST').length, 1);
    if (extension.disconnect || extension.redirect) {
      assert.equal(result.structuredContent.error.retryable, false);
      assert.match(result.structuredContent.error.message, /Hydration may have completed/);
    }
    assert.doesNotMatch(JSON.stringify(result), /Anchor field|Target field|DO_NOT_RELEASE/);
  }
});

test('context transport preserves complete original task and explicit constraints without a generated checklist', async (t) => {
  const requests = [];
  const api = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, payload: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ contextPage: { pageRef: 'local-context-only' } }));
    });
  });
  t.after(() => close(api));
  const apiPort = await listen(api);
  const server = makeServer(`http://127.0.0.1:${apiPort}/v1`);
  t.after(() => close(server));
  const port = await listen(server);
  const tasks = [
    'Compile only the context needed to prepare the marketplace release review, then explain why those memories were included.',
    'Compile context for the 2026-09-27 marketplace release review. Include only approved decisions; exclude temporary memories and preserve the stated budget.'
  ];
  for (const route of ['/graymatter/mcp', '/mcp']) {
    for (const originalTask of tasks) {
      const result = await rpc(port, route, 'tools/call', {
        name: 'context_compile', arguments: {
          task: originalTask, tokenBudget: 1600, includeProcedures: true, includeRatings: false
        }
      });
      assert.notEqual(result.result.isError, true);
      const received = requests.at(-1);
      assert.equal(received.method, 'POST');
      assert.equal(received.url, '/v1/graymatter_ops/context_page/compile');
      assert.deepEqual(received.payload, {
        taskIntent: originalTask, tokenBudget: 1600, includeProcedures: true, includeRatings: false
      });
    }
  }
  assert.equal(requests.length, 4);
});
