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
