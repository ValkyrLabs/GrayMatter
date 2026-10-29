'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const { createGrayMatterMcpServer } = require('../index');

const MEMORY_ID = '11111111-1111-4111-8111-111111111111';
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = server => new Promise(resolve => {
  server.closeAllConnections();
  server.close(resolve);
});

async function publicClient(t, apiBase) {
  const server = createGrayMatterMcpServer({
    apiBase, publicApp: true, deploymentMode: 'hosted-multi-tenant',
    publicResource: 'https://graymatter.example.test', oauthIssuer: 'https://identity.example.test',
    tokenVerifier: token => ({ claims: {
      sub: 'onboarding-user', tenantId: 'onboarding-tenant', organizationId: 'onboarding-org',
      scope: token === 'read-only' ? 'memory:read context:read' : 'memory:read memory:write context:read'
    } })
  });
  t.after(() => close(server));
  const port = await listen(server);
  const call = async (name, args, token = 'write-enabled') => {
    const response = await fetch(`http://127.0.0.1:${port}/graymatter/mcp`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
    });
    assert.equal(response.status, 200);
    return (await response.json()).result;
  };
  return { server, call };
}

test('a new account saves a real preference, verifies it, and recalls it through a fresh MCP session', async t => {
  let memory;
  let writes = 0;
  const api = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/MemoryEntry/query') return res.end(JSON.stringify(memory ? [memory] : []));
    if (req.url === '/v1/MemoryEntry/write') {
      writes++;
      memory = { id: MEMORY_ID, ...body };
      return res.end(JSON.stringify(memory));
    }
    if (req.url === `/v1/MemoryEntry/${MEMORY_ID}` && memory) return res.end(JSON.stringify(memory));
    res.writeHead(404); res.end('{}');
  });
  t.after(() => close(api));
  const apiBase = `http://127.0.0.1:${await listen(api)}/v1`;
  const first = await publicClient(t, apiBase);
  const empty = await first.call('memory_search', { query: 'communication preference' });
  assert.equal(empty.structuredContent.ok, true);
  assert.deepEqual(empty.structuredContent.data, []);
  assert.equal(writes, 0);

  const preference = { content: 'Start answers with the decision and keep them concise.', type: 'preference', title: 'Communication preference' };
  const denied = await first.call('memory_save', preference, 'read-only');
  assert.equal(denied.isError, true);
  assert.equal(writes, 0, 'read-only onboarding must never create a memory');

  const saved = await first.call('memory_save', preference);
  assert.equal(saved.structuredContent.data.id, MEMORY_ID);
  const verified = await first.call('memory_get', { id: MEMORY_ID });
  assert.equal(verified.structuredContent.data.text, preference.content);
  await close(first.server);

  const nextSession = await publicClient(t, apiBase);
  const recalled = await nextSession.call('memory_search', { query: 'communication preference' });
  assert.equal(recalled.structuredContent.data[0].id, MEMORY_ID);
  assert.equal(recalled.structuredContent.data[0].text, preference.content);
  assert.equal(writes, 1, 'recalling in a new session must not duplicate onboarding data');
});

test('successful HTTP transport cannot turn invalid upstream bodies into saved memory or empty recall', async t => {
  let payload = '';
  const api = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(payload);
  });
  t.after(() => close(api));
  const { call } = await publicClient(t, `http://127.0.0.1:${await listen(api)}/v1`);
  for (const value of ['', '<html>sign in</html>', 'null', 'true', '{}',
    '{"ok":false,"error":{"message":"database secret must-not-leak"}}',
    '{"success":false,"id":"11111111-1111-4111-8111-111111111111"}']) {
    payload = value;
    for (const [name, args] of [
      ['memory_save', { content: 'Remember this preference.' }],
      ['memory_search', { query: 'preference' }],
      ['context_compile', { task: 'Use my communication preference.' }]
    ]) {
      const result = await call(name, args);
      assert.equal(result.isError, true, `${name} accepted ${value}`);
      assert.equal(result.structuredContent.ok, false);
      assert.doesNotMatch(JSON.stringify(result), /must-not-leak|Durable memory saved|Found 0 authorized/);
    }
  }
});

test('upstream body stalls are bounded even after response headers arrive', { timeout: 5000 }, async t => {
  const previous = process.env.GRAYMATTER_MCP_REQUEST_TIMEOUT_MS;
  process.env.GRAYMATTER_MCP_REQUEST_TIMEOUT_MS = '100';
  t.after(() => {
    if (previous === undefined) delete process.env.GRAYMATTER_MCP_REQUEST_TIMEOUT_MS;
    else process.env.GRAYMATTER_MCP_REQUEST_TIMEOUT_MS = previous;
  });
  const api = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{"items":[');
    // Deliberately never finish the body; the request signal must cancel it.
  });
  t.after(() => close(api));
  const { call } = await publicClient(t, `http://127.0.0.1:${await listen(api)}/v1`);
  const started = Date.now();
  const result = await call('memory_search', { query: 'communication preference' });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.ok, false);
  assert.ok(Date.now() - started < 2000);
});

test('procedure discovery finds older matches and paginates after filtering without skipping', async t => {
  const rows = Array.from({ length: 220 }, (_, index) => ({
    id: `procedure-${String(index).padStart(4, '0')}`,
    name: [25, 150, 181].includes(index) ? 'Release review' : 'Another procedure',
    enabled: true, confidence: 0.9
  }));
  rows[4] = { ...rows[4], name: 'Release review', enabled: false };
  rows[105] = { ...rows[105], name: 'Release review', confidence: 0.1 };
  const requests = [];
  const api = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    requests.push(url);
    const page = Number(url.searchParams.get('page'));
    const size = Number(url.searchParams.get('size'));
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ content: rows.slice(page * size, (page + 1) * size), last: (page + 1) * size >= rows.length }));
  });
  t.after(() => close(api));
  const { call } = await publicClient(t, `http://127.0.0.1:${await listen(api)}/v1`);
  const query = { query: 'release review', minimumConfidence: 0.5, limit: 2 };
  const first = await call('procedure_search', query);
  assert.deepEqual(first.structuredContent.data.map(row => row.id), ['procedure-0025', 'procedure-0150']);
  assert.equal(first.structuredContent.nextOffset, 2);
  assert.deepEqual(first.structuredContent.coverage, { complete: true, scanned: 220, pages: 3, reason: 'end_of_list' });
  const last = await call('procedure_search', { ...query, offset: first.structuredContent.nextOffset });
  assert.deepEqual(last.structuredContent.data.map(row => row.id), ['procedure-0181']);
  assert.equal(last.structuredContent.nextOffset, undefined);
  const noMatch = await call('procedure_search', { query: 'absent phrase' });
  assert.deepEqual(noMatch.structuredContent.data, []);
  assert.equal(noMatch.structuredContent.coverage.complete, true);
  assert.ok(requests.every(url => url.searchParams.get('sort') === 'id,asc'));
});

test('bounded procedure discovery reports incomplete absence at its scan cap', async t => {
  let requests = 0;
  const api = http.createServer((req, res) => {
    const page = Number(new URL(req.url, 'http://localhost').searchParams.get('page'));
    requests++;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(Array.from({ length: 100 }, (_, index) => ({
      id: `procedure-${page * 100 + index}`, name: 'Unrelated', enabled: true
    }))));
  });
  t.after(() => close(api));
  const { call } = await publicClient(t, `http://127.0.0.1:${await listen(api)}/v1`);
  const result = await call('procedure_search', { query: 'release review' });
  assert.equal(requests, 10);
  assert.deepEqual(result.structuredContent.data, []);
  assert.equal(result.structuredContent.coverage.complete, false);
  assert.equal(result.structuredContent.coverage.reason, 'page_budget');
  assert.equal(result.structuredContent.nextOffset, undefined, 'unknown further matches are not a fabricated result cursor');
  assert.match(result.content[0].text, /Coverage is incomplete/);
});

test('public list validation and extraction share the same supported envelopes', async t => {
  let payload;
  const api = http.createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(payload));
  });
  t.after(() => close(api));
  const { call } = await publicClient(t, `http://127.0.0.1:${await listen(api)}/v1`);
  const records = [{ id: MEMORY_ID, text: 'Useful preference' }];
  for (const key of ['content', 'items', 'data', 'results', 'records', 'memoryEntries', 'entries']) {
    payload = { [key]: records };
    const result = await call('memory_search', { query: 'preference' });
    assert.deepEqual(result.structuredContent.data, records, `${key} must not turn into empty recall`);
  }
  for (const invalid of [[null], ['not a memory'], { items: [true] }]) {
    payload = invalid;
    const result = await call('memory_search', { query: 'preference' });
    assert.equal(result.isError, true, 'invalid list rows must not silently disappear');
  }
});
