const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const { createGrayMatterMcpServer } = require('../index.js');

async function thor_inspect(thor_apiBase, thor_receipt) {
  let thor_apiCalls = 0;
  const thor_server = createGrayMatterMcpServer({
    apiBase: thor_apiBase,
    token: 'synthetic-inspection-test',
    fetch: async () => {
      thor_apiCalls++;
      return new Response(JSON.stringify({ receipt: thor_receipt }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    },
  });
  await new Promise((thor_resolve) => thor_server.listen(0, '127.0.0.1', thor_resolve));
  try {
    const thor_payload = await new Promise((thor_resolve, thor_reject) => {
      const thor_request = http.request({
        host: '127.0.0.1', port: thor_server.address().port, path: '/', method: 'POST',
        headers: { 'content-type': 'application/json' },
      }, (thor_response) => {
        let thor_raw = '';
        thor_response.on('data', (thor_chunk) => { thor_raw += thor_chunk; });
        thor_response.on('end', () => thor_resolve(JSON.parse(thor_raw)));
      });
      thor_request.on('error', thor_reject);
      thor_request.end(JSON.stringify({ jsonrpc: '2.0', id: 'inspection', method: 'tools/call',
        params: { name: 'retrieval_receipt_get', arguments: { receiptId: 'receipt-test' } } }));
    });
    assert.equal(thor_apiCalls, 1, 'inspection metadata must not perform another request');
    assert.equal(thor_payload.result.isError, undefined);
    return JSON.parse(thor_payload.result.content[0].text);
  } finally {
    await new Promise((thor_resolve) => thor_server.close(thor_resolve));
  }
}

test('cloud receipts link to exact authenticated evidence without copying payload or identity fields', async () => {
  const thor_result = await thor_inspect('https://api-0.valkyrlabs.com/v1', {
    receiptId: 'retrieval:123', traceId: 'trace-456', answerPolicy: 'ALLOW_ANSWER',
    query: 'Private customer question', principalId: 'private-principal', token: 'private-token',
  });
  const thor_link = new URL(thor_result.graymatterInspection.url);
  assert.equal(thor_link.origin, 'https://valkyrlabs.com');
  assert.equal(thor_link.pathname, '/dashboard');
  assert.deepEqual(Object.fromEntries(thor_link.searchParams), {
    open: 'graymatter-memory', receiptRef: 'retrieval:123', traceId: 'trace-456',
  });
  assert.equal(thor_result.graymatterInspection.requiresAuthentication, true);
  assert.equal(thor_result.graymatterPolicy.answerAllowed, true);
});

test('an inspection link never relaxes a denied answer policy', async () => {
  const thor_result = await thor_inspect('https://api-0.valkyrlabs.com/v1/', {
    receiptId: 'receipt-denied', answerPolicy: 'DENY', retrievalStatus: 'DENIED',
  });
  assert.equal(thor_result.graymatterPolicy.answerAllowed, false);
  assert.equal(thor_result.receipt.answerPolicy, 'DENY');
  assert.match(thor_result.graymatterInspection.url, /receiptRef=receipt-denied/);
});

for (const thor_apiBase of [
  'http://localhost:8080/v1', 'https://api.bank.example/v1',
  'http://api-0.valkyrlabs.com/v1', 'https://api-0.valkyrlabs.com.evil.example/v1',
  'https://api-0.valkyrlabs.com/private-tenant/v1',
]) {
  test(`does not export private deployment references from ${thor_apiBase}`, async () => {
    const thor_result = await thor_inspect(thor_apiBase, { receiptId: 'private-receipt' });
    assert.equal(thor_result.graymatterInspection, undefined);
  });
}

for (const thor_reference of [undefined, '../../other', 'receipt\nprivate', 'x'.repeat(257)]) {
  test(`omits malformed or unbounded receipt reference ${String(thor_reference).slice(0, 25)}`, async () => {
    const thor_result = await thor_inspect('https://api-0.valkyrlabs.com/v1', { receiptId: thor_reference });
    assert.equal(thor_result.graymatterInspection, undefined);
  });
}

// The local GrayMatter server (bifrost-lite-context/v1) does not emit the OpenAPI enum
// (ALLOW_ANSWER / OK). It emits SUFFICIENT_CONTEXT, PARTIAL_COVERAGE and NO_MATCHES with
// ANSWER_WITH_CITATIONS or DO_NOT_ANSWER_CONFIDENTLY.
test('a sufficient bifrost-lite receipt authorizes a cited answer', async () => {
  const thor_result = await thor_inspect('http://localhost:8787/v1', {
    receiptId: 'receipt-bifrost-ok', policyVersion: 'bifrost-lite-context/v1',
    retrievalStatus: 'SUFFICIENT_CONTEXT', answerPolicy: 'ANSWER_WITH_CITATIONS',
    recommendedAction: 'use_context',
  });
  assert.equal(thor_result.graymatterPolicy.answerAllowed, true);
  assert.equal(thor_result.graymatterPolicy.disposition, 'answer_from_memory_allowed');
  assert.deepEqual(thor_result.graymatterPolicy.requiredActions, []);
  assert.equal(thor_result.graymatterPolicy.warning, undefined);
});

test('a bifrost-lite receipt with no matches does not authorize an answer', async () => {
  const thor_result = await thor_inspect('http://localhost:8787/v1', {
    receiptId: 'receipt-bifrost-none', policyVersion: 'bifrost-lite-context/v1',
    retrievalStatus: 'NO_MATCHES', answerPolicy: 'DO_NOT_ANSWER_CONFIDENTLY',
    recommendedAction: 'retry_retrieval_or_inspect_sources',
  });
  assert.equal(thor_result.graymatterPolicy.answerAllowed, false);
  assert.equal(thor_result.graymatterPolicy.disposition, 'do_not_answer_from_memory');
  assert.ok(thor_result.graymatterPolicy.requiredActions.includes('handle_no_matches'));
  assert.ok(thor_result.graymatterPolicy.requiredActions.includes('do_not_answer_confidently'));
});

test('a partial bifrost-lite receipt never authorizes a confident answer', async () => {
  const thor_result = await thor_inspect('http://localhost:8787/v1', {
    receiptId: 'receipt-bifrost-partial', policyVersion: 'bifrost-lite-context/v1',
    retrievalStatus: 'PARTIAL_COVERAGE', answerPolicy: 'DO_NOT_ANSWER_CONFIDENTLY',
    recommendedAction: 'retry_retrieval_or_inspect_sources',
  });
  assert.equal(thor_result.graymatterPolicy.answerAllowed, false);
  assert.equal(thor_result.graymatterPolicy.caveatRequired, true);
  assert.ok(thor_result.graymatterPolicy.requiredActions.includes('do_not_answer_confidently'));
});

test('an allowing policy paired with a blocking status still fails closed', async () => {
  for (const thor_status of ['NO_MATCHES', 'PARTIAL_COVERAGE', 'STALE_CONTEXT', 'ERROR']) {
    const thor_result = await thor_inspect('http://localhost:8787/v1', {
      receiptId: `receipt-${thor_status}`, retrievalStatus: thor_status,
      answerPolicy: 'ANSWER_WITH_CITATIONS',
    });
    assert.equal(thor_result.graymatterPolicy.answerAllowed, false, thor_status);
  }
});

test('an unrecognised answer policy fails closed even with sufficient context', async () => {
  const thor_result = await thor_inspect('http://localhost:8787/v1', {
    receiptId: 'receipt-unknown-policy', retrievalStatus: 'SUFFICIENT_CONTEXT',
    answerPolicy: 'SOMETHING_NEW',
  });
  assert.equal(thor_result.graymatterPolicy.answerAllowed, false);
});
