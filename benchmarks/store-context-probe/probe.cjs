'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');
const { InMemoryStore } = require('@langchain/langgraph-checkpoint');
const sdk = require('@langchain/langgraph-checkpoint/package.json');
assert.equal(sdk.version, require('./package.json').dependencies[sdk.name], 'unexpected LangGraph version');

const query = 'Canary window';
const namespace = ['synthetic'];
const wednesday = { key: 'wed', text: 'Canary window is Wednesday.', tags: [] };
const thursday = { key: 'thu', text: 'Canary window is Thursday.', tags: [] };
const marked = { ...thursday, tags: ['unresolved'] };
const unrelated = { key: 'billing', text: 'Canary billing is quarterly.', tags: ['unresolved'] };
const exception = {
  key: 'exception',
  text: 'Canary window is Wednesday. ' + 'The calendar team supplied a note. '.repeat(80) +
    'Exception: this week the canary window is Thursday.',
  tags: []
};

const cases = [
  { name: 'single', rows: [wednesday], topK: 1 },
  { name: 'untagged-contradiction', rows: [wednesday, thursday], topK: 2 },
  { name: 'tagged-contradiction', rows: [wednesday, marked], topK: 2 },
  { name: 'tagged-below-cut', rows: [wednesday, marked], topK: 1 },
  { name: 'unrelated-marker', rows: [wednesday, unrelated], topK: 1 },
  { name: 'exception-beyond-budget', rows: [exception], topK: 1, budget: 128, retryBudget: 4096 }
];

async function sha256(file) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}

async function post(path, body) {
  const port = Number(process.argv[2]);
  assert.ok(Number.isInteger(port) && port >= 1 && port <= 65535, 'expected local probe port');
  const response = await fetch('http://127.0.0.1:' + port + '/v1/' + path, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Basic ' + Buffer.from('admin:' + process.env.GRAYMATTER_ADMIN_PASSWORD).toString('base64')
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(path + ' returned HTTP ' + response.status);
  return response.json();
}

function describeContext(result, byId) {
  assert.ok(result.receiptId, 'missing retrieval receipt');
  const keyForId = id => {
    assert.ok(byId.has(id), 'returned source outside the fixture');
    return byId.get(id).key;
  };
  for (const item of result.items) {
    assert.equal(item.excerpt, byId.get(item.memoryId)?.text, 'delivered text differed from complete source');
    assert.ok(result.context.includes(item.excerpt), 'delivered item absent from context');
  }
  if (result.answerPolicy !== 'ALLOW_ANSWER') {
    assert.equal(result.items.length, 0, 'withheld context leaked items');
    for (const value of [result.context, result.contextPageRef, result.contextHash]) {
      assert.ok(!value, 'withheld context leaked text or a usable pointer');
    }
  }
  return {
    status: result.retrievalStatus, policy: result.answerPolicy, action: result.recommendedAction,
    sources: result.sourceCount, delivered: result.items.map(item => keyForId(item.memoryId)).sort(),
    conflicts: result.conflictRefs.map(keyForId).sort(), truncated: result.truncatedRefs.map(keyForId).sort(),
    receipt: true, context: Boolean(result.context), page: Boolean(result.contextPageRef)
  };
}

async function runCase(store, {name, rows, topK, budget = 2000, retryBudget}) {
  const sourceChannel = 'probe:' + name;
  const byId = new Map();
  for (const row of rows) {
    const value = {text: row.text, tags: row.tags, type: 'context', sourceChannel};
    await store.put(namespace, name + '/' + row.key, value);
    const saved = await post('MemoryEntry/write', value);
    assert.ok(saved.id && !byId.has(saved.id));
    byId.set(saved.id, row);
  }
  // With no embedding index, the store applies the metadata filter and result limit.
  const hits = await store.search(namespace, {query, filter: {sourceChannel}, limit: topK});
  assert.equal(hits.length, topK);
  const rawStore = hits.map(hit => {
    const row = rows.find(candidate => hit.key === name + '/' + candidate.key);
    assert.deepEqual(hit.value, {text: row.text, tags: row.tags, type:'context', sourceChannel});
    return {key: row.key, bodyBytes: Buffer.byteLength(hit.value.text), tags: hit.value.tags};
  });
  const filters = {source: sourceChannel};
  const options = {query, filters, retrievalMode: 'KEYWORD'};
  const ranked = await post('memory/semantic-index/search', {...options, limit: topK});
  const rawLite = ranked.results.map(hit => byId.get(hit.memoryEntry.id).key);
  const result = await post('graymatter/retrieval-context', {...options, topK, tokenBudget: budget});
  const lite = describeContext(result, byId);
  const report = {name, topK, tokenBudget: budget, rawStore, rawLite, lite};
  if (retryBudget) {
    const retry = await post('graymatter/retrieval-context/' + result.receiptId + '/recompress',
      {query, tokenBudget: retryBudget});
    assert.notEqual(result.receiptId, retry.receiptId);
    assert.equal(retry.parentReceiptId, result.receiptId, 'retry changed receipt chain');
    report.retry = {tokenBudget: retryBudget, lite: describeContext(retry, byId)};
  }
  return report;
}

async function main() {
  const store = new InMemoryStore();
  const observations = [];
  for (const scenario of cases) observations.push(await runCase(store, scenario));
  const report = {
    capturedAt: new Date().toISOString(), node: process.version,
    sdk: sdk.name + '@' + sdk.version,
    jarSha256: await sha256(process.argv[3]), probeSha256: await sha256(__filename),
    query, retrievalMode: 'KEYWORD', storeIndex: 'none', observations
  };
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
