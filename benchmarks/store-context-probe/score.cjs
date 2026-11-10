#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const oracle = require('./policy-oracle.json');

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const statuses = new Map([
  ['OK', ['ALLOW_ANSWER', 'ANSWER']],
  ['CONFLICTING_CONTEXT', ['DO_NOT_ANSWER_CONFIDENTLY', 'REQUIRE_CLARIFICATION']],
  ['AMBIGUOUS_WEEKDAY', ['DO_NOT_ANSWER_CONFIDENTLY', 'REQUIRE_CLARIFICATION']],
  ...['NO_RESULTS', 'PARTIAL_COVERAGE', 'STALE_CONTEXT', 'RETRY_REQUIRED']
    .map(status => [status, ['DO_NOT_ANSWER_CONFIDENTLY', 'RETRY_RETRIEVAL']])
]);

function classify(lite, sourceKeys, location) {
  assert.ok(lite && statuses.has(lite.status), location + ': missing or unknown receipt status');
  assert.deepEqual([lite.policy, lite.action], statuses.get(lite.status), location + ': inconsistent policy or action');
  assert.equal(lite.receipt, true, location + ': receipt required');
  assert.ok(Number.isInteger(lite.sources) && lite.sources >= 0 && lite.sources <= sourceKeys.length,
    location + ': invalid source count');
  for (const field of ['delivered', 'conflicts', 'truncated']) {
    const refs = lite[field];
    assert.ok(Array.isArray(refs) && refs.length <= lite.sources && new Set(refs).size === refs.length
      && refs.every(ref => sourceKeys.includes(ref)), location + ': invalid ' + field);
  }
  const permit = lite.policy === 'ALLOW_ANSWER';
  assert.equal(lite.context, permit, location + ': inconsistent context visibility');
  assert.equal(lite.page, permit, location + ': inconsistent page visibility');
  assert.equal(lite.delivered.length > 0, permit, location + ': inconsistent source delivery');
  if (permit) {
    assert.equal(lite.conflicts.length + lite.truncated.length, 0, location + ': incomplete permission');
    assert.equal(lite.delivered.length, lite.sources, location + ': permitted receipt omitted a source');
  }
  if (lite.status === 'CONFLICTING_CONTEXT') assert.ok(lite.conflicts.length > 0, location + ': missing conflict');
  if (lite.status === 'AMBIGUOUS_WEEKDAY') {
    // The pinned probe predates ambiguousRefs. It records the source count,
    // decision and explicit conflict IDs. The schema acceptance checks the exact witness pair.
    assert.ok(lite.sources >= 2, location + ': ambiguous decision needs two sources');
    assert.equal(lite.conflicts.length, 0, location + ': ambiguity reported as an explicit dispute');
  }
  return permit ? 'permit' : 'withhold';
}

function score(capture) {
  assert.equal(capture.probeSha256, oracle.probeSha256, 'different fixture or probe implementation');
  assert.equal(capture.query, 'Canary window');
  assert.equal(capture.retrievalMode, 'KEYWORD');
  assert.equal(capture.storeIndex, 'none');
  assert.equal(capture.sdk, '@langchain/langgraph-checkpoint@1.2.2');
  assert.match(capture.node, /^v\d+\.\d+\.\d+$/);
  assert.match(capture.jarSha256, /^[a-f0-9]{64}$/);
  const byName = new Map(capture.observations.map(row => [row.name, row]));
  assert.equal(capture.observations.length, oracle.cases.length, 'unexpected number of observations');
  assert.equal(byName.size, oracle.cases.length, 'duplicate observations');
  const decisions = [];
  const retry = [];
  for (const label of oracle.cases) {
    assert.ok(['permit', 'withhold'].includes(label.expected), 'invalid oracle label');
    const row = byName.get(label.name);
    assert.ok(row, 'missing ' + label.name);
    assert.deepEqual([row.topK, row.tokenBudget], [label.topK, label.tokenBudget], label.name + ': unmatched initial request');
    assert.ok(Array.isArray(row.rawStore) && row.rawStore.every(hit => Number.isSafeInteger(hit.bodyBytes)
      && hit.bodyBytes > 0 && Array.isArray(hit.tags)), label.name + ': invalid raw-store record');
    for (const hits of [row.rawStore.map(hit => hit.key), row.rawLite]) {
      assert.ok(Array.isArray(hits) && hits.length === label.topK && new Set(hits).size === hits.length
        && hits.every(key => label.sourceKeys.includes(key)), label.name + ': invalid raw result keys');
    }
    const actual = classify(row.lite, label.sourceKeys, label.name);
    decisions.push({ name: label.name, expected: label.expected, actual });
    assert.equal(Object.hasOwn(row, 'retry'), Boolean(label.retry), label.name + ': missing or unexpected retry');
    if (label.retry) {
      assert.equal(row.retry.tokenBudget, label.retry.tokenBudget, label.name + ': unmatched retry budget');
      const retryDecision = classify(row.retry.lite, label.sourceKeys, label.name + ' retry');
      const recovered = row.lite.status === 'PARTIAL_COVERAGE' && row.lite.truncated.includes(label.retry.requiredSource)
        && retryDecision === label.retry.expected && row.retry.lite.delivered.includes(label.retry.requiredSource);
      retry.push({ name: label.name, tokenBudget: row.retry.tokenBudget, recovered });
    }
  }
  const errors = expected => {
    const eligible = decisions.filter(row => row.expected === expected);
    return { count: eligible.filter(row => row.actual !== expected).length, denominator: eligible.length };
  };
  return { jarSha256: capture.jarSha256, decisions, falsePermissions: errors('withhold'), falseRefusals: errors('permit'),
    budgetRetry: { recovered: retry.filter(row => row.recovered).length, denominator: retry.length, cases: retry } };
}

function readCapture(role, file) {
  const pin = oracle.captures[role];
  const bytes = readFileSync(file || path.join(__dirname, 'observations', pin.file));
  if (!file) assert.equal(sha256(bytes), pin.sha256, 'pinned ' + role + ' capture changed');
  return JSON.parse(bytes);
}

function main(args) {
  assert.ok(args.length === 0 || args.length === 2, 'Usage: node score.cjs [before.json after.json]');
  assert.equal(sha256(readFileSync(path.join(__dirname, 'probe.cjs'))), oracle.probeSha256, 'probe changed; review the oracle');
  assert.equal(new Set(oracle.cases.map(label => label.name)).size, oracle.cases.length, 'duplicate oracle cases');
  const before = readCapture('before', args[0]);
  const after = readCapture('current', args[1]);
  const result = { before: score(before), after: score(after) };
  assert.equal(before.node, after.node, 'Node version differs between captures');
  assert.notEqual(before.jarSha256, after.jarSha256, 'expected two different Lite builds');
  for (const row of before.observations) {
    const other = after.observations.find(candidate => candidate.name === row.name);
    assert.deepEqual(row.rawStore, other.rawStore, row.name + ': raw-store control differs');
  }
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
