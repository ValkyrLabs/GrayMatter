'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const { createGrayMatterMcpServer } = require('../index');

async function client(t, upstream) {
  let calls = 0;
  const server = createGrayMatterMcpServer({
    apiBase: 'https://api.example.test/v1',
    publicApp: true, deploymentMode: 'hosted-multi-tenant',
    publicResource: 'https://graymatter.example.test', oauthIssuer: 'https://identity.example.test',
    tokenVerifier: () => ({ claims: { sub: 'new-user', tenantId: 'fixture-tenant', organizationId: 'fixture-org', roles: ['ROLE_GRAYMATTER_USER'], scope: 'memory:read memory:write context:read' } }),
    fetch: async (url, options) => {
      calls++;
      const response = upstream(url, options);
      return { ok: response.status === 200, status: response.status, headers: new Headers(), text: async () => JSON.stringify(response.body) };
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return {
    calls: () => calls,
    call: (name, args) => new Promise((resolve, reject) => {
      const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
      const req = http.request({ host: '127.0.0.1', port: server.address().port, path: '/graymatter/mcp', method: 'POST',
        headers: { authorization: 'Bearer fixture-token', 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
      }, res => {
        let text = ''; res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; });
        res.on('end', () => { const parsed = JSON.parse(text); if (!parsed.result) return reject(new Error(text)); resolve(parsed.result); });
      });
      req.on('error', reject); req.end(body);
    })
  };
}

function receipt(retrievalStatus, answerPolicy, recommendedAction) {
  return { retrievalReceipt: { receiptId: 'onboarding-fixture-receipt', retrievalStatus, answerPolicy, recommendedAction },
    contextPage: { summary: 'authorized useful context' } };
}

test('empty first search offers a useful next step without declaring the whole account empty or writing a demo', async t => {
  const app = await client(t, () => ({ status: 200, body: [] }));
  const result = await app.call('memory_search', { query: 'writing preferences' });
  assert.equal(result.structuredContent.ok, true);
  assert.deepEqual(result.structuredContent.data, []);
  assert.equal(app.calls(), 1);
  assert.match(result.content[0].text, /No matching memories/);
  assert.match(result.content[0].text, /actually shared/);
  assert.match(result.content[0].text, /does not establish that your memory is empty/);
});

test('usable caveated context is described as limited coverage, never falsely described as withheld', async t => {
  const app = await client(t, () => ({ status: 200, body: receipt('PARTIAL_COVERAGE', 'ALLOW_WITH_CAVEAT', 'ANSWER_WITH_CAVEAT') }));
  const result = await app.call('context_compile', { task: 'Help plan my next project.' });
  assert.equal(result.structuredContent.data.graymatterPolicy.caveatRequired, true);
  assert.match(result.content[0].text, /limited coverage/);
  assert.doesNotMatch(result.content[0].text, /withheld/);
  assert.equal(result.structuredContent.data.contextPage.summary, 'authorized useful context');
});

test('first-use NO_RESULTS explains how to continue without releasing withheld context', async t => {
  const app = await client(t, () => ({ status: 200, body: receipt('NO_RESULTS', 'DO_NOT_ANSWER_CONFIDENTLY', 'CLARIFY') }));
  const result = await app.call('context_compile', { task: 'Help plan my next project.' });
  assert.equal(result.structuredContent.data.graymatterPolicy.answerAllowed, false);
  assert.equal(result.structuredContent.data.contextPage, undefined);
  assert.match(result.content[0].text, /No usable stored context matched/);
  assert.match(result.content[0].text, /Respect the returned retrieval policy/);
  assert.match(result.content[0].text, /current conversation/);
});

test('DENY never receives the first-use continuation prompt even if status is NO_RESULTS', async t => {
  const app = await client(t, () => ({ status: 200, body: receipt('NO_RESULTS', 'DENY', 'DENY') }));
  const result = await app.call('context_compile', { task: 'Help plan my next project.' });
  assert.equal(result.structuredContent.data.contextPage, undefined);
  assert.match(result.content[0].text, /withheld/);
  assert.doesNotMatch(result.content[0].text, /first use|save and read back/i);
});

test('transient read failure can retry but an uncertain mutation must be verified before replay', async t => {
  const app = await client(t, () => ({ status: 503, body: { message: 'private database failure' } }));
  const read = await app.call('memory_search', { query: 'writing preferences' });
  assert.equal(read.structuredContent.error.retryable, true);
  assert.match(read.content[0].text, /Retry this same operation once/);
  for (const [name, args] of [
    ['memory_save', { content: 'I prefer concise answers.' }],
    ['memory_update', { id: 'f01dcffe-f589-4f15-a3db-9913b6c8adc3', content: 'I prefer detailed answers.' }],
    ['memory_forget', { id: 'f01dcffe-f589-4f15-a3db-9913b6c8adc3', confirm: true, confirmationText: 'Forget that exact preference.' }],
    ['context_compile', { task: 'Help plan my next project.' }]
  ]) {
    const result = await app.call(name, args);
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.error.code, 'UPSTREAM_UNAVAILABLE');
    assert.equal(result.structuredContent.error.retryable, false, name);
    assert.match(result.content[0].text, /may have completed/);
    assert.match(result.content[0].text, /before retrying/);
    assert.doesNotMatch(JSON.stringify(result), /private database/);
  }
  assert.equal(app.calls(), 5, 'the MCP layer never replays the failed writes');
});

test('importance correction preserves invariant and project tags, including existing tags beyond the public input bound', async t => {
  const id = 'f01dcffe-f589-4f15-a3db-9913b6c8adc3';
  const durableTags = ['invariant', 'project:launch', ...Array.from({ length: 22 }, (_, i) => `established-tag-${i}`)];
  let memory = { id, type: 'decision', text: 'Keep release checks enabled.', tags: [...durableTags, 'importance:low'] };
  const methods = [];
  const app = await client(t, (_url, options) => {
    methods.push(options.method);
    if (options.method === 'PATCH') memory = { ...memory, ...JSON.parse(options.body) };
    return { status: 200, body: memory };
  });
  const high = await app.call('memory_update', { id, importance: 'critical' });
  assert.equal(high.structuredContent.ok, true);
  assert.deepEqual(memory.tags, [...durableTags, 'importance:critical']);
  const normal = await app.call('memory_update', { id, importance: 'normal' });
  assert.equal(normal.structuredContent.ok, true);
  assert.deepEqual(memory.tags, durableTags);
  assert.deepEqual(methods, ['GET', 'PATCH', 'GET', 'PATCH']);
});

test('explicit replacement tags keep their intended semantics without reading the old tag set', async t => {
  const id = 'f01dcffe-f589-4f15-a3db-9913b6c8adc3';
  let patch;
  const app = await client(t, (_url, options) => {
    assert.equal(options.method, 'PATCH');
    patch = JSON.parse(options.body);
    return { status: 200, body: { id, ...patch } };
  });
  const result = await app.call('memory_update', { id, tags: ['corrected-project', 'importance:low'], importance: 'high' });
  assert.equal(result.structuredContent.ok, true);
  assert.deepEqual(patch.tags, ['corrected-project', 'importance:high']);
  assert.equal(app.calls(), 1);
});

test('an unreadable exact memory prevents an importance correction from overwriting tags', async t => {
  const app = await client(t, (_url, options) => {
    assert.equal(options.method, 'GET', 'no PATCH after a rejected read');
    return { status: 403, body: { message: 'not authorized' } };
  });
  const result = await app.call('memory_update', { id: 'f01dcffe-f589-4f15-a3db-9913b6c8adc3', importance: 'high' });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error.code, 'FORBIDDEN');
  assert.equal(app.calls(), 1);
});

test('saving twenty user tags does not silently discard the derived importance tag', async t => {
  let saved;
  const tags = Array.from({ length: 20 }, (_, i) => `tag-${i}`);
  const app = await client(t, (_url, options) => {
    saved = JSON.parse(options.body);
    return { status: 200, body: { id: 'f01dcffe-f589-4f15-a3db-9913b6c8adc3', ...saved } };
  });
  const result = await app.call('memory_save', { content: 'Keep release checks enabled.', tags, importance: 'high' });
  assert.equal(result.structuredContent.ok, true);
  assert.deepEqual(saved.tags, [...tags, 'importance:high']);
});

test('a full existing tag set is never truncated to make room for importance', async t => {
  const id = 'f01dcffe-f589-4f15-a3db-9913b6c8adc3';
  const app = await client(t, (_url, options) => {
    assert.equal(options.method, 'GET', 'a capacity failure must not PATCH');
    return { status: 200, body: { id, tags: ['invariant', ...Array.from({ length: 49 }, (_, i) => `tag-${i}`)] } };
  });
  const result = await app.call('memory_update', { id, importance: 'critical' });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error.code, 'INVALID_ARGUMENT');
  assert.match(result.content[0].text, /explicit replacement tag set/);
  assert.equal(app.calls(), 1);
});
