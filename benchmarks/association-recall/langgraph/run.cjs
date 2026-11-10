'use strict';

// All ranking below is performed by the installed upstream InMemoryStore.
// The local encoder and one-hop adapter are explicitly benchmark application code.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { createRequire } = require('node:module');

const here = __dirname;
const sdkRequire = createRequire(path.join(here, '../../store-context-probe/package.json'));
const { InMemoryStore } = sdkRequire('@langchain/langgraph-checkpoint');
const sdk = sdkRequire('@langchain/langgraph-checkpoint/package.json');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fileHash = file => sha(fs.readFileSync(file));
const clone = value => JSON.parse(JSON.stringify(value));
const protocol = JSON.parse(fs.readFileSync(path.join(here, 'protocol.json')));
assert.equal(fileHash(path.join(here, 'protocol.json')),
  'ed56d37780998b21f3e33751c5f7b2ea760021f031459736fa15950a5197258e');
const fixturePath = path.join(here, protocol.fixture);
assert.equal(fileHash(fixturePath), protocol.fixtureSha256);
const fixture = JSON.parse(fs.readFileSync(fixturePath));
assert.equal(sdk.version, protocol.sdk.version);
const litePath = path.join(here, protocol.liteObservation);
assert.equal(fileHash(litePath), protocol.liteObservationSha256);

const tokens = text => text.toLowerCase().match(/[a-z0-9]+/g) || [];
const vocabulary = [...new Set(fixture.cases.flatMap(c =>
  [c.query, ...c.rows.map(row => row.text)].flatMap(tokens)))].sort();
const positions = new Map(vocabulary.map((term, index) => [term, index]));
function encode(text) {
  const values = Array(vocabulary.length).fill(0);
  for (const term of tokens(text)) if (positions.has(term)) values[positions.get(term)]++;
  return values;
}
const embeddings = {
  embedQuery: async text => encode(text),
  embedDocuments: async texts => texts.map(encode)
};

async function seed(scenario) {
  const store = new InMemoryStore({index: {dims: vocabulary.length, fields: ['text'], embeddings}});
  const sources = ['association-benchmark', scenario.id, 'sources'];
  const edges = ['association-benchmark', scenario.id, 'edges'];
  const sourceChannel = 'association-recall:' + scenario.id;
  const filter = {sourceChannel, type: 'context'};
  for (const row of scenario.rows) {
    await store.put(sources, row.key, {
      text: row.text, tags: row.tags || [], type: row.type || 'context',
      sourceChannel: sourceChannel + (row.sourceSuffix ? ':' + row.sourceSuffix : '')
    });
  }
  for (const [index, edge] of scenario.links.entries()) {
    await store.put(edges, 'edge-' + index,
      {fromId: edge.from, toId: edge.to, relation: edge.relation}, false);
  }
  return {store, sources, edges, filter, scenario};
}

function nativeSearch(state, limit) {
  return state.store.search(state.sources, {
    query: state.scenario.query, filter: state.filter, limit
  });
}

async function applicationOneHop(state) {
  const rawSeeds = await nativeSearch(state, fixture.retrieval.topK);
  const seeds = rawSeeds.filter(item => item.score > 0).slice(0, 8);
  const items = [...seeds];
  const seen = new Set(items.map(item => item.key));
  const edgeReads = [];
  const targetReads = [];
  let scanned = 0;
  let added = 0;
  let truncated = false;
  for (const seed of seeds) {
    const found = await state.store.search(state.edges, {
      filter: {fromId: seed.key}, limit: 65 - scanned
    });
    edgeReads.push({fromId: seed.key, items: clone(found)});
    for (const edge of found) {
      if (scanned >= 64 || added >= 8) { truncated = true; break; }
      scanned++;
      const target = await state.store.get(state.sources, edge.value.toId);
      targetReads.push({edgeKey: edge.key, target: clone(target)});
      if (!target || seen.has(target.key)) continue;
      if (!Object.entries(state.filter).every(([key, value]) => target.value[key] === value)) continue;
      seen.add(target.key);
      items.push(target);
      added++;
    }
    if (truncated) break;
  }
  return {rawSeeds: clone(rawSeeds), edgeReads, targetReads, items: clone(items), truncated};
}

function observation(items, scenario) {
  const context = items.map(item => item.value.text).join('\n\n');
  const keys = items.map(item => item.key);
  const required = scenario.oracle.requiredAnswerKeys;
  return {
    keys, scores: items.map(item => item.score ?? null),
    returnedBodyUtf8Bytes: Buffer.byteLength(context),
    liteBudgetReference: scenario.tokenBudget || fixture.retrieval.tokenBudget,
    nativeTokenBudgetApplied: false, nativeAnswerPolicy: null,
    requiredEvidencePresent: required ? required.every(key => keys.includes(key)) &&
      context.includes(scenario.oracle.answerText) : null,
    items: clone(items)
  };
}

async function measure(state, arm) {
  const trials = [];
  let first;
  for (let i = 0; i < protocol.resourceBoundary.warmups + protocol.resourceBoundary.measuredRepetitions; i++) {
    const start = performance.now();
    const raw = arm === 'applicationOneHop' ? await applicationOneHop(state) :
      await nativeSearch(state, fixture.retrieval.topK + (arm === 'nativeWide' ? 8 : 0));
    const elapsedMs = performance.now() - start;
    if (i < protocol.resourceBoundary.warmups) continue;
    const value = observation(arm === 'applicationOneHop' ? raw.items : raw, state.scenario);
    if (!first) first = {...value, ...(arm === 'applicationOneHop' ? {trace: raw} : {})};
    trials.push({elapsedMs, keys: value.keys, scores: value.scores,
      returnedBodyUtf8Bytes: value.returnedBodyUtf8Bytes});
  }
  const ordered = trials.map(value => value.elapsedMs).sort((a, b) => a - b);
  return {first, trials, medianMs: ordered[Math.floor(ordered.length / 2)],
    p95NearestRankMs: ordered[Math.ceil(ordered.length * 0.95) - 1]};
}

async function lifecycle(kind) {
  const scenario = fixture.cases.find(value => value.id === 'linked-detail');
  const state = await seed(scenario);
  const before = await applicationOneHop(state);
  const liveGetObject = await state.store.get(state.sources, 'anchor');
  const detachedGetSnapshot = clone(liveGetObject);
  if (kind === 'correct-anchor') {
    await state.store.put(state.sources, 'anchor',
      {...liveGetObject.value, text: 'This source was corrected and retired.'});
  } else if (kind === 'delete-anchor') {
    await state.store.delete(state.sources, 'anchor');
  } else {
    await state.store.delete(state.edges, 'edge-0');
  }
  return {kind, before, detachedGetSnapshot, liveGetObjectAfter: clone(liveGetObject),
    currentSource: clone(await state.store.get(state.sources, 'anchor')),
    currentEdge: clone(await state.store.get(state.edges, 'edge-0')),
    currentNative: clone(await nativeSearch(state, fixture.retrieval.topK)),
    currentApplication: await applicationOneHop(state),
    receipt: null, note: 'Only native source/edge primitives and application traversal were exercised.'};
}

async function main() {
  const output = process.argv[2];
  assert.ok(output, 'Pass a new observation path');
  assert.ok(!fs.existsSync(output), 'Refuse to overwrite an existing observation');
  const startedUtc = new Date().toISOString();
  const cases = [];
  for (const scenario of fixture.cases) {
    const state = await seed(scenario);
    const arms = {};
    for (const arm of Object.keys(protocol.arms)) arms[arm] = await measure(state, arm);
    cases.push({id: scenario.id, query: scenario.query, filter: state.filter, arms});
  }
  const mutations = [];
  for (const kind of protocol.lifecycle.mutations) mutations.push(await lifecycle(kind));
  const loadedRuntimeFiles = {};
  for (const file of Object.keys(require.cache).sort()) {
    if (file.includes('/benchmarks/store-context-probe/node_modules/')) {
      loadedRuntimeFiles[path.relative(path.join(here, '../../store-context-probe/node_modules'), file)] = fileHash(file);
    }
  }
  const report = {version: protocol.version, startedUtc, finishedUtc: new Date().toISOString(),
    protocolSha256: fileHash(path.join(here, 'protocol.json')),
    fixtureSha256: fileHash(fixturePath), driverSha256: fileHash(__filename),
    sdk: {name: sdk.name, version: sdk.version, packageLockSha256: fileHash(path.join(here, protocol.sdk.lock)), loadedRuntimeFiles},
    runtime: {node: process.version, executable: process.execPath, executableSha256: fileHash(process.execPath),
      flags: process.execArgv, os: process.platform, architecture: process.arch,
      networkPolicySha256: fileHash(path.join(here, 'offline.sb')), embeddingModel: null, answerModel: null},
    encoder: {dimensions: vocabulary.length, vocabulary, vocabularySha256: sha(JSON.stringify(vocabulary))},
    cases, lifecycle: mutations,
    matchedLite: {observationSha256: fileHash(litePath), jarSha256: JSON.parse(fs.readFileSync(litePath)).jarSha256,
      timingComparable: false, nativePolicyComparable: false, note: 'Existing pinned same-input release capture; no new Lite execution in this run.'}};
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify({output, sha256: fileHash(output), cases: cases.length,
    lifecycle: mutations.length, sdk: sdk.version, dimensions: vocabulary.length}));
}

main().catch(error => { console.error(error.stack); process.exitCode = 1; });
