'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scanMemoryEntries, entriesOf, isActiveMemory } = require('../lib/memory-scan.cjs');

test('decision preflight filters at the API before pagination without changing its eligible set', async () => {
  const thor_rows = Array.from({ length: 4188 }, (_, thor_i) => ({
    id: `memory-${thor_i}`, type: thor_i % 5 === 0 ? 'decision' : 'context'
  }));
  const thor_fetch = async thor_endpoint => {
    const thor_params = new URL(thor_endpoint, 'https://test/').searchParams;
    const thor_type = JSON.parse(thor_params.get('example') || '{}').type;
    const thor_eligible = thor_type ? thor_rows.filter(row => row.type === thor_type) : thor_rows;
    const thor_page = Number(thor_params.get('page'));
    return thor_eligible.slice(thor_page * 100, (thor_page + 1) * 100);
  };
  const thor_full = await scanMemoryEntries(thor_fetch);
  const thor_filtered = await scanMemoryEntries(thor_fetch, { type: 'decision' });
  assert.deepEqual(thor_filtered.entries, thor_full.entries.filter(row => row.type === 'decision'));
  assert.equal(thor_filtered.coverage.complete, true);
  assert.equal(thor_filtered.coverage.serverFilterHonored, true);
  assert.equal(thor_filtered.coverage.requestedType, 'decision');
  assert.ok(thor_filtered.coverage.pages < thor_full.coverage.pages / 3);
});

test('legacy servers ignoring example still receive a complete scan with visible overfetch', async () => {
  const thor_rows = [{ id: 'rule', type: 'decision' }, { id: 'context', type: 'context' }];
  const thor_scan = await scanMemoryEntries(async endpoint =>
    new URL(endpoint, 'https://test/').searchParams.get('page') === '0' ? thor_rows : [], { type: 'decision' });
  assert.deepEqual(thor_scan.entries, thor_rows);
  assert.equal(thor_scan.coverage.complete, true);
  assert.equal(thor_scan.coverage.serverFilterHonored, false);
});

test('scans beyond the first 20 even when the server caps pages below requested size', async () => {
  const thor_rows = Array.from({ length: 1238 }, (_, thor_i) => ({ id: `memory-${thor_i}` }));
  const thor_calls = [];
  const thor_result = await scanMemoryEntries(async thor_endpoint => {
    const thor_page = Number(new URL(thor_endpoint, 'https://test/').searchParams.get('page'));
    thor_calls.push(thor_page);
    return thor_rows.slice(thor_page * 20, thor_page * 20 + 20);
  });
  assert.equal(thor_result.entries.length, 1238);
  assert.equal(thor_result.coverage.complete, true);
  assert.equal(thor_result.coverage.pages, 63);
  assert.equal(thor_result.entries.at(-1).id, 'memory-1237');
});

test('bounded scans expose truncation, never claim complete', async () => {
  const thor_result = await scanMemoryEntries(async thor_endpoint => [{ id: thor_endpoint }], { maxPages: 2 });
  assert.equal(thor_result.coverage.complete, false);
  assert.equal(thor_result.coverage.reason, 'page_budget');
});

test('detects servers ignoring pagination and deduplicates overlapping windows', async () => {
  const thor_result = await scanMemoryEntries(async () => [{ id: 'same' }]);
  assert.equal(thor_result.entries.length, 1);
  assert.equal(thor_result.coverage.reason, 'pagination_not_advancing');
  assert.equal(thor_result.coverage.complete, false);
  assert.equal(thor_result.coverage.duplicates, 1);
});

test('supports list envelopes and explicit last-page evidence', async () => {
  for (const thor_key of ['content', 'items', 'data', 'results', 'records', 'memoryEntries', 'entries']) {
    const thor_result = await scanMemoryEntries(async () => ({ [thor_key]: [{ id: 'a' }], last: true }));
    assert.equal(thor_result.coverage.complete, true);
    assert.equal(thor_result.coverage.pages, 1);
  }
  assert.throws(() => entriesOf({ error: 'denied' }));
});

test('first-page and authorization failures propagate, later failures expose partial coverage', async () => {
  await assert.rejects(scanMemoryEntries(async () => { throw new Error('offline'); }));
  let thor_count = 0;
  const thor_result = await scanMemoryEntries(async () => {
    if (thor_count++ === 0) return [{ id: 'a' }];
    throw new Error('offline');
  });
  assert.equal(thor_result.coverage.reason, 'page_failed');
  assert.equal(thor_result.coverage.complete, false);
  thor_count = 0;
  await assert.rejects(scanMemoryEntries(async () => {
    if (thor_count++ === 0) return [{ id: 'a' }];
    throw Object.assign(new Error('denied'), { status: 403 });
  }));
});

test('only explicit lifecycle evidence suppresses rules; prose alone never does', () => {
  assert.equal(isActiveMemory({ text: 'This rule SUPERSEDES an older rule' }), true);
  assert.equal(isActiveMemory({ tags: [{ name: 'status:superseded' }] }), false);
  assert.equal(isActiveMemory({ trashed: true }), false);
  assert.equal(isActiveMemory({ status: 'retracted' }), false);
});

test('malformed records and zero-progress/time budgets cannot pass coverage', async () => {
  const thor_result = await scanMemoryEntries(async () => [{ text: 'missing ID' }]);
  assert.equal(thor_result.coverage.reason, 'invalid_entry');
  assert.equal(thor_result.coverage.complete, false);
  await assert.rejects(scanMemoryEntries(async () => [], { maxPages: -1 }));
});

test('parallel reads stay bounded, preserve page order, and discard speculative rows beyond the end', async () => {
  let thor_active = 0;
  let thor_peak = 0;
  const thor_result = await scanMemoryEntries(async thor_endpoint => {
    const thor_page = Number(new URL(thor_endpoint, 'https://test/').searchParams.get('page'));
    thor_active += 1;
    thor_peak = Math.max(thor_peak, thor_active);
    await new Promise(thor_resolve => setTimeout(thor_resolve, (4 - thor_page) * 2));
    thor_active -= 1;
    return thor_page === 2 ? [] : [{ id: `page-${thor_page}` }];
  });
  assert.equal(thor_peak, 4);
  assert.equal(thor_result.coverage.pages, 3);
  assert.equal(thor_result.coverage.requestedPages, 4);
  assert.deepEqual(thor_result.entries.map(thor_entry => thor_entry.id), ['page-0', 'page-1']);
});
