'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const { createGrayMatterMcpServer } = require('../index');

const MEMORY_ID = '11111111-1111-4111-8111-111111111111';
const HIDDEN = 'never-mirror-internal';
const PRIVATE_BODY = 'withheld-context-only';
const LEAKS = /never-mirror-internal|withheld-context-only/;
const BYTE_LIMIT = 16 * 1024;

function client(upstream) {
  const server = createGrayMatterMcpServer({
    apiBase: 'https://upstream.example.test/v1',
    deploymentMode: 'hosted-multi-tenant',
    publicApp: true,
    publicResource: 'https://graymatter.example.test',
    oauthIssuer: 'https://identity.example.test',
    tokenVerifier: () => ({ claims: {
      sub: 'synthetic-user', tenantId: 'synthetic-tenant', organizationId: 'synthetic-org',
      scope: 'memory:read memory:write context:read'
    } }),
    fetch: async (url, options) => {
      const route = new URL(url);
      assert.equal(route.origin, 'https://upstream.example.test');
      const { status = 200, body } = upstream(route, options.method, options.body && JSON.parse(options.body));
      return new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' }
      });
    }
  });
  // Exercise the real public HTTP request handler and dispatcher without a
  // bound socket, external network, or a real OAuth credential.
  const handleRequest = server.listeners('request')[0];
  return async (name, args) => {
    const raw = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
    const request = Object.assign(Readable.from([Buffer.from(raw)]), {
      method: 'POST',
      url: '/graymatter/mcp',
      headers: { 'content-type': 'application/json', authorization: 'Bearer synthetic-token' }
    });
    const response = new EventEmitter();
    response.writeHead = status => { response.statusCode = status; };
    response.end = body => { response.body = body; response.emit('finish'); };
    await handleRequest(request, response);
    assert.equal(response.statusCode, 200);
    const result = JSON.parse(response.body).result;
    assert.equal(result.structuredContent.ok, true, JSON.stringify(result));
    return result;
  };
}

function textEnvelope(result, summary) {
  assert.equal(result.content.length, 1, 'first text block carries the model-visible result');
  assert.equal(result.content[0].type, 'text');
  const text = result.content[0].text;
  assert.ok(Buffer.byteLength(text, 'utf8') <= BYTE_LIMIT);
  const divider = text.indexOf('\n');
  assert.ok(divider > 0);
  assert.match(text.slice(0, divider), summary);
  assert.doesNotMatch(text, LEAKS);
  return JSON.parse(text.slice(divider + 1));
}

test('public memory and procedure reads mirror sanitized data, continuation and coverage', async () => {
  const memory = { id: MEMORY_ID, title: 'Release check', text: 'Review security and privacy.',
    tags: ['review'], sourceChannel: 'review-fixture', ownerId: HIDDEN, accessToken: HIDDEN };
  const procedures = [
    { id: 'review-a', procedureRef: 'production-review', name: 'Production release review',
      steps: ['Verify artifact checksum'], enabled: true, debugTrace: HIDDEN },
    { id: 'review-b', name: 'Production release review follow-up', enabled: true }
  ];
  const call = client(route => {
    if (route.pathname.endsWith('/query')) return { body: [memory] };
    if (route.pathname.endsWith('/Procedure')) return {
      body: Number(route.searchParams.get('page')) === 0 ? procedures : []
    };
    return { body: memory };
  });

  const found = await call('memory_search', { query: 'release check', limit: 1 });
  const foundText = textEnvelope(found, /Found 1 authorized memor/);
  assert.deepEqual(foundText, found.structuredContent);
  assert.equal(foundText.nextOffset, 1);
  assert.equal(foundText.data[0].sourceChannel, 'review-fixture');

  const exact = await call('memory_get', { id: MEMORY_ID });
  const exactText = textEnvelope(exact, /Authorized memory retrieved/);
  assert.deepEqual(exactText, exact.structuredContent);
  assert.equal(exactText.data.text, memory.text);

  const procedure = await call('procedure_search', { query: 'production release review', limit: 1 });
  const procedureText = textEnvelope(procedure, /Found 1 authorized procedure/);
  assert.deepEqual(procedureText, procedure.structuredContent);
  assert.equal(procedureText.nextOffset, 1);
  assert.equal(procedureText.data[0].procedureRef, 'production-review');
  assert.deepEqual(procedureText.data[0].steps, ['Verify artifact checksum']);
});

test('oversize text-only search is valid bounded UTF-8 JSON and retains every row before its continuation', async () => {
  const memories = Array.from({ length: 28 }, (_, index) => ({
    id: 'fixture-' + index, title: 'Release decision ' + index,
    text: '🧠"\\\n'.repeat(600), sourceChannel: 'review-fixture', password: HIDDEN
  }));
  const call = client(() => ({ body: memories }));
  const result = await call('memory_search', { query: 'release', limit: 25, offset: 3 });
  const mirror = textEnvelope(result, /Found 25 authorized memor/);
  assert.equal(mirror.textPreviewTruncated, true);
  assert.equal(mirror.nextOffset, 28);
  assert.deepEqual(mirror.data.map(row => row.id), memories.slice(3).map(row => row.id));
  assert.ok(mirror.data.every(row => typeof row.text === 'string' && row.text.endsWith('…')));
  assert.ok(mirror.data.every(row => !/[\uD800-\uDFFF]/u.test(row.text)));
  assert.equal(result.structuredContent.data[0].text, memories[3].text);
});

test('text-only context and receipts preserve authorized evidence and do not release gated context', async () => {
  let gated = false;
  const call = client(route => {
    const receipt = {
      receiptId: gated ? 'gm_rr_gated' : 'gm_rr_allowed',
      retrievalStatus: gated ? 'CONFLICTING_CONTEXT' : 'OK',
      answerPolicy: gated ? 'DO_NOT_ANSWER_CONFIDENTLY' : 'ALLOW_ANSWER',
      recommendedAction: gated ? 'CLARIFY' : 'ANSWER',
      items: [{ memoryId: MEMORY_ID, sourceTitle: gated ? PRIVATE_BODY : 'Release decision',
        sourceType: 'MemoryEntry', selectionReason: 'Matches production review.' }],
      provenance: gated ? { sourceCount: 25, sourceTypes: Array(25).fill('🧠'.repeat(2000)) }
        : { sourceCount: 1, sourceTypes: ['MemoryEntry'] },
      policy: { rbacDecision: 'ALLOW', tenantScopeVerified: true },
      ownerId: HIDDEN
    };
    return { body: route.pathname.endsWith('/compile')
      ? { retrievalReceipt: receipt, contextPage: { summary: gated ? PRIVATE_BODY : 'Review the exact release decision.' },
        selectedItems: gated ? [{ text: PRIVATE_BODY }] : [], tokenBudget: 1600 }
      : { receipt } };
  });
  const original = { task: 'Prepare the production release review.', tokenBudget: 1600 };
  const compiled = await call('context_compile', original);
  const compact = textEnvelope(compiled, /context compiled/i);
  assert.deepEqual(compact, compiled.structuredContent);
  assert.equal(compact.data.contextPage.summary, 'Review the exact release decision.');
  assert.equal(compact.data.retrievalReceipt.items[0].memoryId, MEMORY_ID);

  const receipt = await call('retrieval_receipt_get', { receiptId: 'gm_rr_allowed' });
  assert.equal(textEnvelope(receipt, /receipt retrieved/i).data.receipt.receiptId, 'gm_rr_allowed');

  gated = true;
  const withheld = await call('context_compile', original);
  const blocked = textEnvelope(withheld, /withheld task context/i);
  assert.equal(blocked.textPreviewTruncated, true);
  assert.equal(blocked.data.retrievalReceipt.receiptId, 'gm_rr_gated');
  assert.equal(blocked.data.graymatterPolicy.retrievalStatus, 'CONFLICTING_CONTEXT');
  assert.equal(blocked.data.graymatterPolicy.answerPolicy, 'DO_NOT_ANSWER_CONFIDENTLY');
  assert.equal(blocked.data.graymatterPolicy.answerAllowed, false);
  assert.equal(blocked.data.contextPage, undefined);
  assert.equal(blocked.data.retrievalReceipt.items, undefined);
  assert.doesNotMatch(JSON.stringify(withheld), LEAKS);
});

test('model-facing mutation acknowledgment carries exact identity without echoing the record body', async () => {
  const call = client((_route, method, body) => method === 'DELETE'
    ? { status: 204 }
    : { body: { id: MEMORY_ID, ...body, rawResponse: HIDDEN } });
  const saved = await call('memory_save', { content: 'Disposable fixture for text compatibility.' });
  assert.equal(saved.structuredContent.data.text, 'Disposable fixture for text compatibility.');
  assert.deepEqual(textEnvelope(saved, /memory saved/i), { ok: true, data: { id: MEMORY_ID } });

  const updated = await call('memory_update', { id: MEMORY_ID, content: 'Updated fixture.' });
  assert.equal(updated.structuredContent.data.text, 'Updated fixture.');
  assert.deepEqual(textEnvelope(updated, /memory updated/i), { ok: true, data: { id: MEMORY_ID } });

  const forgotten = await call('memory_forget', { id: MEMORY_ID, confirm: true, confirmationText: 'Forget this synthetic test record.' });
  assert.deepEqual(textEnvelope(forgotten, /memory was forgotten/i), { ok: true, data: { id: MEMORY_ID, forgotten: true } });
});
