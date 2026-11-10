'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const { startStdioServer, publicTools } = require('../index.js');

const receipt = {
  receiptId: 'dddddddd-0000-4000-8000-000000000001',
  retrievalStatus: 'OK', answerPolicy: 'ALLOW_ANSWER', recommendedAction: 'ANSWER',
  associationPolicyVersion: 'graymatter-association-recall/v1', associationTruncated: false,
  associationRefs: [{
    associationRef: 'dddddddd-0000-4000-8000-000000000002',
    anchorId: 'aaaaaaaa-0000-4000-8000-000000000003', memoryId: 'bbbbbbbb-0000-4000-8000-000000000004',
    associationHash: 'a'.repeat(64), anchorSourceHash: 'b'.repeat(64), sourceHash: 'c'.repeat(64)
  }]
};

function client(t, responses, profile = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  const calls = [];
  startStdioServer({input, output, profileMode: 'single', apiBase: 'https://fixture.invalid/v1',
    token: 'test-token', ...profile,
    fetch: async (url, init) => {
      calls.push({path: new URL(url).pathname, body: JSON.parse(init.body)});
      assert.ok(responses.length, 'unexpected upstream request');
      return new Response(JSON.stringify(responses.shift()), {headers: {'content-type': 'application/json'}});
    }});
  t.after(() => { input.end(); output.destroy(); });
  return {calls, async call(name, args) {
    const next = once(output, 'data');
    input.write(JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name, arguments: args}}) + '\n');
    return JSON.parse((await next)[0]);
  }};
}

test('private retrieval entrypoints forward the opt-in and preserve verified references', async t => {
  const routes = [
    ['memory_retrieve_with_receipt', '/v1/graymatter-retrieval-receipts', receipt],
    ['graymatter_retrieval_context', '/v1/graymatter/retrieval-context', receipt],
    ['omega_recall', '/v1/graymatter/omega/recall', {receipt}],
    ['graymatter_recall', '/v1/graymatter/omega/recall', {receipt}],
    ['graymatter_omega_query', '/v1/graymatter/omega/query', {receipt}]
  ];
  const c = client(t, routes.map(route => route[2]));
  for (const [name, path] of routes) {
    const out = await c.call(name, {query: 'public synthetic query', includeAssociations: true});
    assert.equal(out.error, undefined);
    const value = JSON.parse(out.result.content[0].text);
    assert.deepEqual((value.receipt ?? value).associationRefs, receipt.associationRefs);
    assert.deepEqual(c.calls.at(-1), {path, body: {query: 'public synthetic query', includeAssociations: true}});
  }
  assert.ok(publicTools.every(tool => !Object.hasOwn(tool.inputSchema.properties ?? {}, 'includeAssociations')));
});

test('an old backend or malformed graph proof cannot acknowledge the opt-in', async t => {
  const legacy = {receiptId: receipt.receiptId, retrievalStatus: 'OK', answerPolicy: 'ALLOW_ANSWER', context: 'withheld fixture text'};
  const invalid = {...receipt, associationRefs: [{...receipt.associationRefs[0], relation: 'withheld fixture text'}]};
  const c = client(t, [legacy, invalid, legacy]);
  for (let i = 0; i < 2; i++) {
    const reply = await c.call('memory_retrieve_with_receipt', {query: 'fixture', includeAssociations: true});
    assert.match(reply.error.message, /did not confirm/);
    assert.ok(!JSON.stringify(reply).includes('withheld fixture text'));
  }
  assert.match((await c.call('memory_retrieve_with_receipt', {query: 'fixture', includeAssociations: 'true'})).error.message, /must be a boolean/);
  assert.equal(c.calls.length, 2);
  assert.equal((await c.call('memory_retrieve_with_receipt', {query: 'fixture', includeAssociations: false})).error, undefined);
  assert.deepEqual(c.calls.at(-1).body, {query: 'fixture'});
});

test('Lite refresh forwards the original opt-in and requires the fresh receipt marker', async t => {
  const fresh = {...receipt, receiptId: 'dddddddd-0000-4000-8000-000000000005',
    parentReceiptId: receipt.receiptId, sourceSelection: 'FRESH_SEARCH'};
  const c = client(t, [fresh], {apiBase: 'http://127.0.0.1:8765/v1', token: '', lightUser: 'synthetic', lightPassword: 'synthetic'});
  const out = await c.call('lite_context_refresh', {receiptId: receipt.receiptId, query: 'fixture', includeAssociations: true});
  assert.equal(out.error, undefined);
  assert.deepEqual(c.calls, [{path: `/v1/graymatter/retrieval-context/${receipt.receiptId}/refresh`,
    body: {query: 'fixture', includeAssociations: true}}]);
});
