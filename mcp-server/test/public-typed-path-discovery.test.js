'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const http = require('node:http');
const test = require('node:test');
const { discover, readResponse } = require('../lib/public-typed-path-discovery.cjs');
const { createGrayMatterMcpServer, publicTools } = require('../index');

// Protocol doubles only: these do not establish backend ACL, uniqueness or v2 proof validity.
const ids = ['10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000004',
  '50000000-0000-4000-8000-000000000005', '60000000-0000-4000-8000-000000000006'];
const query = 'Garnet shipment';
function fixtures(seedSource = 'media_filename') {
  const body = seedSource === 'content_body';
  const seed = body ? { schemaName: 'ContentData', entityId: ids[2] } : { schemaName: 'ContentMediaLink', entityId: ids[1] };
  const target = body ? { schemaName: 'ContentMediaLink', entityId: ids[1] } : { schemaName: 'ContentData', entityId: ids[2] };
  const direction = body ? 'INBOUND' : 'OUTBOUND';
  const relation = 'ContentMediaLink.contentData->ContentData';
  const citation = { citationId: 'GP-test', graphAbiVersion: 'thorapi-object-graph/v1',
    relationshipNormalizationVersion: 'thorapi-generated-relationship-normalization/v1',
    graphSchemaVersion: 'sha256:' + 'a'.repeat(64), graphPolicyVersion: 'sha256:' + 'b'.repeat(64),
    queryMode: 'PATH', hopCount: 1, pathHash: 'c'.repeat(64), seed, target, nodes: [seed, target],
    edges: [{ relationshipId: relation, canonicalPath: 'ContentMediaLink.contentData.ContentData', direction, source: seed, target }],
    exactPath: `${seed.schemaName}:${seed.entityId} -[${direction} ${relation}]-> ${target.schemaName}:${target.entityId}` };
  const receipt = { id: ids[3], receiptId: 'gm_rr_test', ownerId: ids[0], tenantId: 'org_synthetic',
    planRef: 'gm_plan_test', query, answerPolicy: 'ALLOW_WITH_CAVEAT', recommendedAction: 'ANSWER_WITH_CAVEAT',
    retrievalStatus: 'PARTIAL_COVERAGE', policy: { rbacDecision: 'ALLOW', tenantScopeVerified: true,
      policyNotes: ['graph_evidence_claim_scope=typed_path_and_endpoint_projection_only', 'generated_graph_proof_items=1'] },
    items: [{ id: ids[4], sourceType: 'thorapi-generated-graph/v2|retrieval:graph', entityType: target.schemaName,
      entityId: target.entityId, rank: 1, redacted: true, textHash: 'd'.repeat(64), evidenceDescriptorHash: 'e'.repeat(64),
      fieldName: 'test-only-descriptor-not-a-trusted-proof', graphPathCitations: [citation],
      text: 'SECRET ENDPOINT BODY', textPreview: 'SECRET PREVIEW' }] };
  const plan = { plan: { id: ids[5], planId: 'gm_plan_test', state: 'planned', mode: 'BALANCED',
    ownerId: ids[0], tenantId: 'org_synthetic', queryHash: createHash('sha256').update(query + '\n').digest('hex'),
    expiresAt: new Date(Date.now() + 60000).toISOString(), maxGraphHops: 1, maxCandidates: 8, maxCredits: 5, maxLatencyMs: 10000 },
    steps: [{ tool: 'graph_expand', state: 'planned', channel: 'graph', planId: 'gm_plan_test',
      tenantId: 'org_synthetic', ownerId: ids[0], maxResults: 3, maxGraphHops: 1 }] };
  const result = { tool: 'GRAPH_EXPAND', status: 'PARTIAL_COVERAGE', planRef: 'gm_plan_test', receiptRef: receipt.receiptId,
    policyFlags: [body ? 'graph_query_discovery=omegarag-query-body/v1' : 'graph_query_discovery=omegarag-query-path/v1',
      'raw_receipt_text_redacted_from_tool_response'], receipt,
    evidence: [{ snippet: 'SECRET GRAPH BODY' }] };
  const currentReceipt = structuredClone(receipt);
  currentReceipt.items[0].redacted = false;
  return [plan, result, { receipt: currentReceipt }];
}
function scripted(responses = fixtures()) {
  const calls = [];
  return { calls, responses, request: async (...call) => {
    calls.push(call);
    const next = responses[calls.length - 1];
    if (next instanceof Error) throw next;
    return next;
  } };
}
const unverified = error => error.name === 'PublicTypedPathContractError' && !/SECRET|org_|0000|Garnet/u.test(error.message);

test('query discovery fixes all owner routes and graph structure and returns no source content or identity', async () => {
  const s = scripted();
  const output = await discover(s.request, { query });
  assert.deepEqual(s.calls.map(c => c.slice(0, 2)), [['POST', 'graymatter/omega/plan'],
    ['POST', 'graymatter/omega/tools/graph-expand'], ['GET', 'graymatter-retrieval-receipts/gm_rr_test']]);
  assert.deepEqual(s.calls[0][2], { query, mode: 'BALANCED', recipe: 'ENTITY_NEIGHBORHOOD', budgets: {
    maxLatencyMs: 10000, maxCredits: 5, maxContextTokens: 4000, maxGraphHops: 1, maxProviderCalls: 8, maxCandidates: 8 } });
  assert.deepEqual(s.calls[1][2], { planId: 'gm_plan_test', query, queryMode: 'PATH', discoverPathFromQuery: true,
    objectTypes: ['ContentMediaLink'], graphPaths: ['ContentMediaLink.contentData.ContentData'], direction: 'OUTBOUND',
    maxHops: 1, maxNodes: 2, maxEdges: 1, maxResults: 1 });
  assert.equal(s.responses[1].receipt.items[0].redacted, true, 'owning tool intentionally redacts transport receipt');
  assert.equal(s.responses[2].receipt.items[0].redacted, false, 'owning GET must establish current nonredacted evidence');
  assert.equal(output.retrievalReceiptRef, 'gm_rr_test');
  assert.equal(output.graymatterPolicy.answerAllowed, false);
  assert.equal(output.graymatterPolicy.caveatRequired, true);
  assert.equal(output.typedPathEndpoints.projection, 'not_returned');
  assert.doesNotMatch(JSON.stringify(output), /SECRET|org_synthetic|0000-4000|gm_plan|descriptor|policyNotes/);
});

test('query discovery rejects unsupported graph, identity and authority arguments before any request', async () => {
  const invalid = [{ query, seedEntities: [] }, { query, filters: {} }, { query, planRef: 'gm_plan_other' },
    { query, tenantId: ids[0] }, { query, objectTypes: ['Customer'] }, { query, direction: 'INBOUND' },
    { query, maxLatencyMs: 999 }, { query, maxLatencyMs: 30001 }, { query, maxCredits: -1 }, { query, maxCredits: NaN },
    { query, maxCredits: '5' }, { query, maxCredits: 101 }, { query, seedSource: 'all' }, { query, seedSource: null },
    { query: '' }, { query: ' '.repeat(5) },
    { query: 'x'.repeat(256) }, { query: 'Garnet\nshipment' }, { query: '\ud800' }];
  for (const args of invalid) {
    const s = scripted();
    await assert.rejects(discover(s.request, args), { name: 'PublicArgumentError' });
    assert.equal(s.calls.length, 0);
  }
});

test('body discovery requires the fixed inbound path and matching current receipt', async () => {
  const args = { query, seedSource: 'content_body' };
  const s = scripted(fixtures(args.seedSource));
  assert.equal((await discover(s.request, args)).retrievalReceiptRef, 'gm_rr_test');
  assert.equal(s.calls[0][2].seedSource, undefined);
  assert.deepEqual(s.calls[1][2], { planId: 'gm_plan_test', query, queryMode: 'PATH', discoverPathFromQuery: true,
    objectTypes: ['ContentData'], graphPaths: ['ContentMediaLink.contentData.ContentData'], direction: 'INBOUND',
    maxHops: 1, maxNodes: 2, maxEdges: 1, maxResults: 1 });
  assert.deepEqual(s.calls[2], ['GET', 'graymatter-retrieval-receipts/gm_rr_test']);

  for (const [calls, mutate] of [
    [2, f => { f[1].policyFlags[0] = 'graph_query_discovery=omegarag-query-path/v1'; }],
    [2, f => { f[1].receipt.items[0].graphPathCitations[0].edges[0].direction = 'OUTBOUND'; }],
    [2, f => { f[1].receipt.items[0].entityType = 'ContentData'; }],
    [3, f => { f[2].receipt.items[0].redacted = true; }],
    [3, f => { f[2].receipt.items[0].graphPathCitations[0].pathHash = 'f'.repeat(64); }]
  ]) {
    const responses = fixtures(args.seedSource); mutate(responses);
    const changed = scripted(responses);
    await assert.rejects(discover(changed.request, args), unverified);
    assert.equal(changed.calls.length, calls);
  }
});

test('query discovery validates current same-query planned graph admission before expansion', async () => {
  const changes = [f => { f[0].plan.queryHash = 'f'.repeat(64); }, f => { f[0].steps = []; },
    f => { f[0].plan.expiresAt = new Date(0).toISOString(); }, f => { f[0].plan.state = 'completed'; },
    f => { f[0].steps[0].planId = 'gm_other'; }, f => { f[0].steps[0].ownerId = ids[1]; },
    f => { f[0].steps[0].tenantId = 'org_other'; }, f => { f[0].steps[0].maxResults = 0; },
    f => { f[0].steps.push(structuredClone(f[0].steps[0])); }, f => { f[0].plan.maxCandidates = 1; },
    f => { f[0].plan.maxGraphHops = 2; }, f => { f[0].plan.maxCredits = 100; }];
  for (const change of changes) {
    const f = fixtures(); change(f); const s = scripted(f);
    await assert.rejects(discover(s.request, { query }), unverified);
    assert.equal(s.calls.length, 1);
  }
});

test('query discovery method marker cannot substitute for typed policy, exact path or admitted query', async () => {
  const changes = [f => { f[1].policyFlags = []; },
    f => { f[1].policyFlags = ['graph_query_discovery=omegarag-query-path/v1']; },
    f => { f[1].policyFlags.push('graph_query_discovery=unknown'); },
    f => { f[1].receipt.items = []; }, f => { f[1].receipt.items.push(structuredClone(f[1].receipt.items[0])); },
    f => { f[1].receipt.query = 'different task'; }, f => { f[1].receipt.ownerId = ids[1]; },
    f => { f[1].receipt.tenantId = 'org_other'; }, f => { f[1].receipt.planRef = 'gm_other'; },
    f => { f[1].receipt.answerPolicy = 'ALLOW'; }, f => { f[1].receipt.answerPolicy = 'REQUIRE_CLARIFICATION'; },
    f => { f[1].receipt.policy.tenantScopeVerified = false; }, f => { f[1].receipt.policy.rbacDecision = 'DENY'; },
    f => { f[1].receipt.policy.policyNotes.push('graph_evidence_claim_scope=general'); },
    f => { f[1].receipt.items[0].sourceType = 'thorapi-generated-graph'; },
    f => { delete f[1].receipt.items[0].redacted; }, f => { f[1].receipt.items[0].graphPathCitations[0].queryMode = 'ENTITY'; },
    f => { f[1].receipt.items[0].graphPathCitations[0].edges[0].canonicalPath = 'Customer.any.Opportunity'; },
    f => { f[1].receipt.items[0].graphPathCitations[0].edges[0].direction = 'INBOUND'; },
    f => { f[1].receipt.items[0].graphPathCitations[0].nodes.reverse(); },
    f => { f[1].receipt.items[0].graphPathCitations[0].exactPath += ' arbitrary'; },
    f => { f[1].receipt.items[0].entityId = ids[1]; },
    f => { f[1].retrievalReceipt = f[1].receipt; }, f => { f[1].receiptRef = 'gm_other'; }];
  for (const change of changes) {
    const f = fixtures(); change(f); const s = scripted(f);
    await assert.rejects(discover(s.request, { query }), unverified);
    assert.equal(s.calls.length, 2);
  }
});

test('query discovery withholds readback mismatch, denial, stale proof and ambiguous wrappers', async () => {
  const changes = [f => { f[2].receipt.items[0].redacted = true; }, f => { delete f[2].receipt.items[0].redacted; },
    f => { f[2].receipt.id = ids[5]; }, f => { f[2].receipt.receiptId = 'gm_other'; },
    f => { f[2].receipt.items[0].textHash = 'f'.repeat(64); }, f => { f[2].receipt.items[0].fieldName += 'changed'; },
    f => { f[2].receipt.items[0].graphPathCitations[0].pathHash = 'f'.repeat(64); },
    f => { f[2].receipt.items[0].evidenceDescriptorHash = 'f'.repeat(64); },
    f => { f[2].receipt.ownerId = ids[1]; }, f => { f[2].receipt.tenantId = 'org_other'; },
    f => { f[2].receipt.answerPolicy = 'DENY'; }, f => { f[2].retrievalReceipt = f[2].receipt; }];
  for (const change of changes) {
    const f = fixtures(); change(f); const s = scripted(f);
    await assert.rejects(discover(s.request, { query }), unverified);
    assert.equal(s.calls.length, 3);
  }
  for (const status of [401, 403, 404, 409, 503]) {
    const f = fixtures(); f[2] = Object.assign(new Error('SECRET'), { status }); const s = scripted(f);
    await assert.rejects(discover(s.request, { query }), error => error.status === status);
    assert.equal(s.calls.length, 3);
  }
});

test('query discovery never retries either mutating operation on transport uncertainty', async () => {
  for (const stage of [0, 1]) {
    const f = fixtures(); const error = new TypeError('connection lost'); f[stage] = error;
    const s = scripted(f); await assert.rejects(discover(s.request, { query }), error);
    assert.equal(s.calls.length, stage + 1);
  }
});

test('query discovery ignores harmless audit and secure-body readback differences', async () => {
  const f = fixtures(); f[2].receipt.lastModifiedDate = '2030-01-01';
  delete f[2].receipt.items[0].text; delete f[2].receipt.items[0].textPreview;
  f[2].receipt.items[0].graphPathCitations[0].ownerId = ids[0];
  assert.equal((await discover(scripted(f).request, { query })).retrievalReceiptRef, 'gm_rr_test');
});

test('query discovery strict response reader rejects accepted, redirected, duplicate and oversized bodies', async () => {
  const url = 'https://api.example.test/v1/graymatter/omega/plan';
  for (const response of [new Response('{}', { status: 202, headers: { 'content-type': 'application/json' } }),
    new Response('{}', { headers: { 'content-type': 'text/plain' } }),
    new Response('{"receipt":{},"receipt":{}}', { headers: { 'content-type': 'application/json' } }),
    new Response(JSON.stringify({ x: 'x'.repeat(262144) }), { headers: { 'content-type': 'application/json' } }),
    new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } })]) {
    await assert.rejects(readResponse(response, url), unverified);
  }
  const redirected = new Response('{}', { headers: { 'content-type': 'application/json' } });
  Object.defineProperty(redirected, 'redirected', { value: true });
  await assert.rejects(readResponse(redirected, url), unverified);
  for (const status of [401, 403, 503]) {
    assert.equal(await readResponse(new Response('SECRET', { status }), url), '');
  }
});

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = server => new Promise(resolve => server.close(resolve));
async function invoke(port, args, token = 'actor-a') {
  const response = await fetch(`http://127.0.0.1:${port}/graymatter/mcp`, { method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'context_discover_typed_path', arguments: args } }) });
  return (await response.json()).result;
}
function serverOptions(fetchImpl) {
  return { apiBase: 'https://api.example.test/v1', publicApp: true, deploymentMode: 'hosted-multi-tenant',
    publicResource: 'https://graymatter.example.test', oauthIssuer: 'https://identity.example.test', fetch: fetchImpl,
    tokenVerifier: async token => ({ active: true, sub: token, scope: token === 'no-scope' ? 'memory:read' : 'context:read memory:read',
      claims: { sub: token, organizationId: 'org-test', tenantId: 'tenant-test', roles: ['ROLE_GRAYMATTER_USER'], scope: token === 'no-scope' ? 'memory:read' : 'context:read memory:read' } }) };
}

test('HTTP public discovery delegates the body route with current bearer and content-minimized output', async t => {
  const f = fixtures('content_body'); const seen = [];
  const server = createGrayMatterMcpServer(serverOptions(async (url, options) => {
    seen.push([url, options]);
    return new Response(JSON.stringify(f[seen.length - 1]), { headers: { 'content-type': 'application/json' } });
  })); t.after(() => close(server)); const port = await listen(server);
  const result = await invoke(port, { query, seedSource: 'content_body' });
  assert.equal(result.structuredContent.ok, true, JSON.stringify(result));
  assert.equal(seen.length, 3);
  assert.equal(JSON.parse(seen[1][1].body).direction, 'INBOUND');
  assert.deepEqual(JSON.parse(seen[1][1].body).objectTypes, ['ContentData']);
  for (const [url, options] of seen) {
    assert.match(url, /^https:\/\/api\.example\.test\/v1\/(?:graymatter\/omega\/(?:plan|tools\/graph-expand)|graymatter-retrieval-receipts\/gm_rr_test)$/);
    assert.equal(options.headers.authorization, 'Bearer actor-a'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers['X-Tenant-Id'], undefined); assert.equal(options.headers.cookie, undefined);
  }
  assert.doesNotMatch(JSON.stringify(result), /SECRET|org_synthetic|0000-4000|gm_plan|descriptor/);
  assert.equal(result.structuredContent.data.graymatterPolicy.answerAllowed, false);
  assert.deepEqual(publicTools.find(tool => tool.name === 'context_discover_typed_path').securitySchemes[0].scopes,
    ['context:read', 'memory:read']);
});

test('HTTP public discovery rejects wrong scopes and generic inputs before delegation', async t => {
  let count = 0;
  const server = createGrayMatterMcpServer(serverOptions(async () => { count++; throw new Error('not expected'); }));
  t.after(() => close(server)); const port = await listen(server);
  assert.equal((await invoke(port, { query, seedEntities: [] })).structuredContent.error.code, 'INVALID_ARGUMENT');
  assert.equal((await invoke(port, { query }, 'no-scope')).structuredContent.error.code, 'FORBIDDEN');
  assert.equal(count, 0);
});

test('HTTP public discovery returns no positive locator or source body on denial, old backend or dropped POST', async t => {
  for (const fault of ['denied', 'old', 'lost']) {
    const f = fixtures(); let calls = 0;
    const server = createGrayMatterMcpServer(serverOptions(async () => {
      const index = calls++;
      if (index === 1 && fault === 'lost') throw new TypeError('SECRET TRANSPORT');
      if (index === 2 && fault === 'denied') return new Response('SECRET DENIED', { status: 403 });
      if (index === 1 && fault === 'old') delete f[1].policyFlags;
      return new Response(JSON.stringify(f[index]), { headers: { 'content-type': 'application/json' } });
    })); const port = await listen(server);
    try {
      const result = await invoke(port, { query });
      assert.equal(result.isError, true); assert.equal(result.structuredContent.error.retryable, false);
      assert.equal(calls, fault === 'denied' ? 3 : 2, JSON.stringify(result));
      assert.doesNotMatch(JSON.stringify(result), /SECRET|gm_rr_test|0000-4000/);
      assert.equal(result.structuredContent.error.code, fault === 'denied' ? 'FORBIDDEN'
        : fault === 'old' ? 'TYPED_PATH_RESULT_UNVERIFIED' : 'UPSTREAM_UNAVAILABLE');
    } finally { await close(server); }
  }
});
