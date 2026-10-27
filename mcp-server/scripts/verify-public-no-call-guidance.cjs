'use strict';

// Verifies an exact candidate module locally. This is a metadata/route gate,
// not evidence that a ChatGPT client selected (or declined) a tool correctly.
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

const candidate = require(path.resolve(process.argv[2] || path.join(__dirname, '..', 'index.js')));
const baseline = process.argv[3] ? require(path.resolve(process.argv[3])) : null;
const expectedNames = [
  'memory_search', 'memory_get', 'memory_save', 'memory_update',
  'memory_forget', 'context_compile', 'procedure_search', 'retrieval_receipt_get'
];
const checkGuidance = (value) => {
  assert.match(value, /Do not invoke any GrayMatter tool for requests to override tenant/);
  assert.match(value, /Do not reinterpret such a request as an authorized text search/);
  assert.match(value, /do not search for deletion candidates or select a target yourself/);
};
const checkMatchGuidance = (value) => {
  assert.match(value, /preserve all identifying qualifiers/);
  assert.match(value, /verify those qualifiers against returned metadata and memory_get/);
  assert.match(value, /Do not substitute a newer or similarly worded record/);
  assert.match(value, /report no verified match if the evidence is insufficient/);
  assert.match(value, /bounded page, not an exhaustive result set/);
  assert.match(value, /continue the same query and filters with offset=nextOffset/);
  assert.match(value, /up to three pages total/);
  assert.match(value, /disclose that the search is incomplete/);
};
const withoutDescriptions = (items) => items.map(({ description, ...rest }) => {
  const metadata = structuredClone(rest);
  // Only the context task property's client-facing description is newly allowed.
  // Validation constraints, required keys, OAuth scopes and annotations remain compared.
  if (metadata.name === 'context_compile') delete metadata.inputSchema.properties.task.description;
  return metadata;
});
const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = (server) => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

async function main() {
  assert.deepEqual(candidate.publicTools.map((tool) => tool.name), expectedNames);
  candidate.publicTools.forEach((tool) => checkGuidance(tool.description));
  candidate.publicTools.filter((tool) => ['memory_search', 'memory_get'].includes(tool.name))
    .forEach((tool) => checkMatchGuidance(tool.description));
  if (baseline) {
    assert.deepEqual(candidate.tools, baseline.tools, 'private tool surface changed');
    assert.deepEqual(withoutDescriptions(candidate.publicTools), withoutDescriptions(baseline.publicTools),
      'public schema, OAuth scopes or annotations changed');
  }
  let upstreamCalls = 0;
  const api = http.createServer((_req, res) => {
    upstreamCalls += 1;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('[]');
  });
  const apiPort = await listen(api);
  const server = candidate.createGrayMatterMcpServer({
    apiBase: `http://127.0.0.1:${apiPort}/v1`,
    publicApp: true,
    deploymentMode: 'hosted-multi-tenant',
    publicResource: 'https://graymatter.example.test',
    oauthIssuer: 'https://identity.example.test',
    allowedOrigins: ['https://chatgpt.com'],
    tokenVerifier: () => ({ claims: {
      sub: 'local-reviewer', tenantId: 'local-reviewer-tenant', organizationId: 'local-reviewer-org',
      scope: 'memory:read memory:write context:read'
    } })
  });
  try {
    const port = await listen(server);
    const rpc = async (route, method, params, authenticated = true) => {
      const response = await fetch(`http://127.0.0.1:${port}${route}`, {
        method: 'POST', headers: {
          'content-type': 'application/json', accept: 'application/json',
          ...(authenticated ? { authorization: 'Bearer local-test-only' } : {})
        }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) })
      });
      return { status: response.status, body: await response.json() };
    };
    for (const route of ['/graymatter/mcp', '/mcp']) {
      const initialized = await rpc(route, 'initialize');
      assert.equal(initialized.status, 200);
      checkGuidance(initialized.body.result.instructions);
      checkMatchGuidance(initialized.body.result.instructions);
      const listed = await rpc(route, 'tools/list');
      assert.equal(listed.status, 200);
      assert.deepEqual(listed.body.result.tools.map((tool) => tool.name), expectedNames);
      listed.body.result.tools.forEach((tool) => checkGuidance(tool.description));
      listed.body.result.tools.filter((tool) => ['memory_search', 'memory_get'].includes(tool.name))
        .forEach((tool) => checkMatchGuidance(tool.description));
      assert.equal((await rpc(route, 'initialize', null, false)).status, 401);
      const override = await rpc(route, 'tools/call', {
        name: 'memory_search', arguments: { query: 'review', tenantId: 'other-tenant' }
      });
      assert.equal(override.body.result.isError, true);
      const vagueForget = await rpc(route, 'tools/call', {
        name: 'memory_forget', arguments: { query: 'whatever is no longer useful' }
      });
      assert.equal(vagueForget.body.result.isError, true);
    }
    assert.equal(upstreamCalls, 0);
    console.log(JSON.stringify({
      result: 'PASS', routes: 2, publicTools: 8,
      initializedAndListedGuidance: true,
      requestedProvenanceGuidance: true,
      baselineNonDescriptionMetadataUnchanged: Boolean(baseline),
      unauthorizedAndOverrideRequestsRejected: true,
      rejectedRequestsReachedUpstream: upstreamCalls,
      chatgptClientBehavior: 'NOT_TESTED_BY_THIS_SCRIPT'
    }));
  } finally {
    await close(server);
    await close(api);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
