'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');

const sdkRequire = createRequire(require.resolve('../store-context-probe/package.json'));
const { InMemoryStore } = sdkRequire('@langchain/langgraph-checkpoint');
const sdk = sdkRequire('@langchain/langgraph-checkpoint/package.json');
const fixture = require('./fixture.json');
const frozen = '2e756dea797d42b826c65eaca0ce54d7189434dfef620c9091556c78cc5f1c1a';
const labels = new Map(Object.entries(fixture.rows).map(([label, text]) => [text, label]));
const hashPattern = /^[0-9a-f]{64}$/;
const [portArg, jarPath, expectedBuild] = process.argv.slice(2);
const port = Number(portArg);
assert.ok(Number.isInteger(port) && port >= 1 && port <= 65535);
assert.ok(['before', 'after'].includes(expectedBuild), 'expected build profile: before or after');
assert.equal(sdk.version, '1.2.2');

async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function label(text) {
  assert.ok(labels.has(text), 'observed text outside frozen fixture');
  return labels.get(text);
}

function value(scenario, key, version) {
  return { type: fixture.type, text: fixture.rows[version], sourceChannel: scenario, tags: [...fixture.tags, key] };
}

async function http(method, route, body) {
  const response = await fetch('http://127.0.0.1:' + port + '/v1/' + route, {
    method, redirect: 'error', signal: AbortSignal.timeout(20_000),
    headers: { authorization: 'Basic ' + Buffer.from('admin:' + process.env.GRAYMATTER_ADMIN_PASSWORD).toString('base64'),
      'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body)
  });
  const bytes = await response.text();
  return { status: response.status, body: bytes ? JSON.parse(bytes) : null };
}

function ok(response, status = 200) {
  assert.equal(response.status, status, 'unexpected HTTP status on an established surface');
  return response.body;
}

class SdkStore {
  constructor(scenario) {
    this.store = new InMemoryStore();
    this.ns = [...fixture.namespace, scenario];
    this.scenario = scenario;
  }
  async write(key, version) { await this.store.put(this.ns, key, value(this.scenario, key, version)); }
  async read(key) {
    const item = await this.store.get(this.ns, key);
    return { version: item ? label(item.value.text) : null, originalValue: item?.value };
  }
  async search() {
    const items = await this.store.search(this.ns, { query: fixture.query, filter: {sourceChannel: this.scenario}, limit: fixture.topK });
    return items.map(item => item.key + '/' + label(item.value.text)).sort();
  }
  async revise(observation, version) {
    // Native put replaces by key. A stale client still has its previous observation.
    await this.write('target', version);
    return 'resolved';
  }
  async forget(observation) {
    await this.store.delete(this.ns, 'target');
    return 'resolved';
  }
  async issueReceipt() { return null; }
}

class LiteStore {
  constructor(scenario) { this.scenario = scenario; this.ids = new Map(); }
  async write(key, version) {
    const row = ok(await http('POST', 'MemoryEntry/write', value(this.scenario, key, version)));
    assert.equal(label(row.text), version);
    assert.ok(row.id);
    this.ids.set(key, row.id);
  }
  async hits() {
    return ok(await http('POST', 'memory/semantic-index/search', { query: fixture.query, retrievalMode: 'KEYWORD',
      limit: fixture.topK, filters: {source: this.scenario} })).results;
  }
  async read(key) {
    const id = this.ids.get(key);
    const response = await http('GET', 'MemoryEntry/' + id);
    if (response.status === 404) return { version: null };
    const row = ok(response);
    assert.equal(row.id, id);
    // Pre-upgrade direct GET had no hash. The public ranked search already emitted the fingerprint.
    const hash = row.sourceHash ?? (await this.hits()).find(hit => hit.memoryEntry.id === id)?.sourceHash;
    assert.match(hash, hashPattern);
    return { version: label(row.text), originalValue: row, hash, hashOnExactRead: Boolean(row.sourceHash) };
  }
  async search() {
    return (await this.hits()).map(hit => {
      const row = hit.memoryEntry;
      assert.equal(row.sourceChannel, this.scenario);
      const key = [...this.ids].find(([,id]) => id === row.id)?.[0];
      assert.ok(key, 'ranked source outside scenario');
      return key + '/' + label(row.text);
    }).sort();
  }
  async revise(observation, version) {
    const response = await http('POST', 'graymatter/memory/' + this.ids.get('target') + '/revise',
      {expectedSourceHash: observation.hash, text: fixture.rows[version]});
    if (response.status === 200) {
      assert.equal(response.body.id, this.ids.get('target'));
      assert.equal(label(response.body.text), version);
      assert.match(response.body.sourceHash, hashPattern);
    }
    return response.status;
  }
  async forget(observation) {
    return (await http('POST', 'graymatter/memory/' + this.ids.get('target') + '/forget',
      {expectedSourceHash: observation.hash, confirmed: true})).status;
  }
  async issueReceipt(key) {
    const response = ok(await http('POST', 'graymatter/retrieval-context', {query: fixture.query,
      retrievalMode: 'KEYWORD', topK: fixture.topK, tokenBudget: fixture.receiptBudget,
      filters: {source: this.scenario, ...(key ? {tags: [key]} : {})}}));
    assert.equal(response.answerPolicy, 'ALLOW_ANSWER');
    assert.ok(response.receiptId);
    const included = response.items.map(item => item.memoryId).sort();
    assert.deepEqual(included, (key ? [this.ids.get(key)] : [...this.ids.values()]).sort());
    return response.receiptId;
  }
  async receiptAt(receipt, keys) {
    const status = ok(await http('GET', 'graymatter-retrieval-receipts/' + receipt));
    const hydration = {};
    for (const key of keys) {
      const result = await http('GET', 'graymatter/retrieval-context/' + receipt + '/hydrate/' + this.ids.get(key));
      hydration[key] = {http: result.status, returned: result.status === 200 ? label(result.body.excerpt) : null};
      if (result.status !== 200) {
        assert.ok(!result.body?.excerpt);
        for (const text of Object.values(fixture.rows)) assert.ok(!JSON.stringify(result.body).includes(text));
      }
    }
    const recompressed = ok(await http('POST', 'graymatter/retrieval-context/' + receipt + '/recompress',
      {query: fixture.query, tokenBudget: fixture.receiptBudget}));
    assert.equal(recompressed.parentReceiptId, receipt);
    assert.notEqual(recompressed.receiptId, receipt);
    const excerpts = recompressed.items.map(item => label(item.excerpt)).sort();
    if (recompressed.answerPolicy !== 'ALLOW_ANSWER') {
      assert.deepEqual(excerpts, []);
      assert.ok(!recompressed.context && !recompressed.contextPageRef && !recompressed.contextHash);
    }
    assert.equal(status.retrievalStatus, recompressed.retrievalStatus);
    return { recorded: status.recordedRetrievalStatus, current: status.retrievalStatus,
      staleKeys: [...this.ids].filter(([,id]) => status.staleRefs.includes(id)).map(([key]) => key).sort(),
      hydration, fork: {policy: recompressed.answerPolicy, delivered: excerpts} };
  }
}

async function snapshot(store) {
  return { exactTarget: (await store.read('target')).version, search: await store.search() };
}

async function lifecycle(store) {
  await store.write('target', 'original'); await store.write('neighbor', 'neighbor');
  const first = await store.read('target');
  const initial = await snapshot(store);
  const original = await store.issueReceipt();
  const independent = await store.issueReceipt('neighbor');
  const corrected = await store.revise(first, 'corrected');
  const afterCorrection = await snapshot(store);
  const originalAfterCorrection = original ? await store.receiptAt(original, ['target', 'neighbor']) : null;
  const second = await store.read('target');
  const atSecondRead = await store.issueReceipt();
  const deleted = await store.forget(second);
  const afterDeletion = await snapshot(store);
  const originalAfterDeletion = original ? await store.receiptAt(original, ['target', 'neighbor']) : null;
  const secondAfterDeletion = atSecondRead ? await store.receiptAt(atSecondRead, ['target', 'neighbor']) : null;
  const independentAfterDeletion = independent ? await store.receiptAt(independent, ['neighbor']) : null;
  const neighbor = await store.read('neighbor');
  return {initial, correction: corrected, afterCorrection, originalAfterCorrection, deletion: deleted, afterDeletion,
    originalAfterDeletion, secondAfterDeletion, independentAfterDeletion, neighbor: neighbor.version,
    retainedClientCopy: label(first.originalValue.text), ...(first.hash ? {hashOnExactRead: first.hashOnExactRead} : {})};
}

async function interference(store, scenario) {
  await store.write('target', 'original');
  const first = await store.read('target'), late = await store.read('target');
  if (scenario === 'two-writers') {
    const writes = await Promise.all([store.revise(first, 'corrected'), store.revise(late, 'late')]);
    return {writes, final: await snapshot(store)};
  }
  const receipt = scenario === 'restore-identical' ? await store.issueReceipt() : null;
  const preceding = await store.revise(first, 'corrected');
  const afterFirst = await store.read('target');
  if (scenario === 'restore-identical') {
    const restored = await store.revise(afterFirst, 'original');
    const afterRestore = await store.read('target');
    const originalReceipt = receipt ? await store.receiptAt(receipt, ['target']) : null;
    const delayed = await store.revise(late, 'late');
    return {preceding, afterFirst: afterFirst.version, restored, afterRestore: afterRestore.version,
      originalHashMatchesRestored: first.hash ? first.hash === afterRestore.hash : null, originalReceipt,
      delayed, final: await snapshot(store)};
  }
  const delayed = scenario === 'stale-correction' ? await store.revise(late, 'late') : await store.forget(late);
  return {preceding, afterFirst: afterFirst.version, delayed, final: await snapshot(store)};
}

async function observe(Adapter) {
  const results = {};
  for (const scenario of Object.keys(fixture.scenarios)) {
    const store = new Adapter(scenario);
    results[scenario] = scenario === 'correction-deletion' ? await lifecycle(store) : await interference(store, scenario);
  }
  return results;
}

async function main() {
  assert.equal(await digest(path.join(__dirname, 'fixture.json')), frozen, 'frozen fixture changed');
  const report = { capturedAt: new Date().toISOString(), node: process.version, sdk: sdk.name + '@' + sdk.version,
    fixtureSha256: frozen, driverSha256: await digest(__filename), jarSha256: await digest(jarPath),
    expectedBuild, langgraph: await observe(SdkStore), lite: await observe(LiteStore) };
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  require('./check.cjs').check(report);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
