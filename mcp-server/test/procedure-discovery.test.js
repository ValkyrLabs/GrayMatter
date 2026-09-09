'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { searchProcedures } = require('../lib/procedure-discovery.cjs');

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const row = (n, extra = {}) => ({ id: uuid(n), procedureRef: `proc:case:${n}`, name: 'Reconcile references',
  description: 'Find customer references absent from a supplied snapshot.', taskType: 'workflow', enabled: true,
  confidence: 0.8, deterministic: true, lifecycleStatus: 'active', workflowBindingStatus: 'active',
  workflowId: uuid(500), workflowVersionId: uuid(501), workflowContentHash: 'a'.repeat(64),
  workflowAbiHash: 'b'.repeat(64), metadataJson: 'private-secret', ownerId: uuid(999), ...extra });
const pages = (rows, calls = []) => async (method, route, payload, options) => {
  calls.push({ method, route, payload, options });
  const page = Number(new URL(route, 'https://example.invalid').searchParams.get('page'));
  return rows[page] || [];
};

test('finds a later-page match through short pages and returns minimized candidate summaries', async () => {
  const calls = [];
  const result = await searchProcedures(pages([[row(1, { name: 'Different', description: '' })],
    [row(2)], []], calls), { query: 'reconcile' });
  assert.equal(calls.length, 3);
  assert.ok(calls.every(c => c.method === 'GET' && c.payload === undefined && c.route.startsWith('/Procedure?')));
  assert.ok(calls.every(c => c.route.includes('size=100&sort=id,asc') && c.options.timeoutMs > 0));
  assert.equal(result.status, 'complete'); assert.equal(result.coverage.complete, true);
  assert.deepEqual(result.procedures.map(p => p.id), [uuid(2)]);
  assert.equal(result.procedures[0].workflowVersionId, uuid(501));
  assert.equal(result.executionAuthorization, 'server_recheck_required');
  assert.doesNotMatch(JSON.stringify(result), /private-secret|ownerId|metadataJson|contraindicationsJson/);
});

test('result offsets apply after matching and nextOffset requires a known additional match', async () => {
  const get = pages([[row(1), row(2, { name: 'Other', description: '' }), row(3)], [row(4)], []]);
  const first = await searchProcedures(get, { query: 'reconcile', limit: 2 });
  assert.deepEqual(first.procedures.map(p => p.id), [uuid(1), uuid(3)]);
  assert.equal(first.observedMatches, 3); assert.equal(first.hasMore, true); assert.equal(first.nextOffset, 2);
  const last = await searchProcedures(get, { query: 'reconcile', limit: 1, offset: 2 });
  assert.deepEqual(last.procedures.map(p => p.id), [uuid(4)]);
  assert.equal(last.hasMore, false); assert.equal(last.nextOffset, null);
});

test('page budgets report partial coverage rather than claiming no matching procedure exists', async () => {
  const result = await searchProcedures(pages([[row(1, { name: 'Other', description: '' })], [row(2)]]),
    { query: 'reconcile' }, { maxPages: 1 });
  assert.equal(result.status, 'partial'); assert.equal(result.coverage.reason, 'page_budget');
  assert.deepEqual(result.procedures, []); assert.equal(result.hasMore, null); assert.equal(result.nextOffset, null);
});

test('enabled and confidence filtering use explicit typed data and do not assert executable eligibility', async () => {
  const get = pages([[row(1, { enabled: false }), row(2, { enabled: null }), row(3, { confidence: 0.1 }),
    row(4, { lifecycleStatus: 'shadow', workflowBindingStatus: 'shadow' })], []]);
  const result = await searchProcedures(get, { query: 'reconcile', minimumConfidence: 0.5 });
  assert.deepEqual(result.procedures.map(p => p.id), [uuid(4)]);
  assert.equal(result.procedures[0].lifecycleStatus, 'shadow');
  const all = await searchProcedures(get, { query: 'reconcile', enabledOnly: false });
  assert.equal(all.procedures.length, 4);
});

test('later authorization denial discards earlier results and sanitizes the error', async () => {
  for (const status of [401, 403]) {
    let calls = 0;
    await assert.rejects(searchProcedures(async () => {
      if (calls++ === 0) return [row(1)];
      throw Object.assign(new Error('Bearer private-secret'), { status });
    }, { query: 'reconcile' }), e => e.code === 'PROCEDURE_SEARCH_UNAVAILABLE' && !e.message.includes('private-secret'));
    assert.equal(calls, 2);
  }
});

test('malformed later pages and duplicate IDs keep coverage incomplete', async () => {
  const bad = await searchProcedures(pages([[row(1)], [null]]), { query: 'reconcile' });
  assert.equal(bad.status, 'partial'); assert.equal(bad.coverage.reason, 'page_failed');
  const repeated = await searchProcedures(pages([[row(1)], [row(1)], []]), { query: 'reconcile' });
  assert.equal(repeated.status, 'partial'); assert.equal(repeated.procedures.length, 1);
  assert.equal(repeated.coverage.reason, 'pagination_not_advancing');
  const overlap = await searchProcedures(pages([[row(1)], [row(1), row(2)], []]), { query: 'reconcile' });
  assert.equal(overlap.coverage.complete, false); assert.equal(overlap.coverage.reason, 'duplicate_records');
});

test('transport timeout receives the remaining budget and cannot imply complete coverage', async () => {
  let timeout;
  await assert.rejects(searchProcedures(async (_method, _route, _payload, options) => {
    timeout = options.timeoutMs; throw Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
  }, { query: 'reconcile' }, { maxMs: 25 }), { code: 'PROCEDURE_SEARCH_UNAVAILABLE' });
  assert.ok(timeout > 0 && timeout <= 25);
});

test('invalid input and budgets are rejected before any request', async () => {
  for (const input of [{}, { query: '' }, { query: 'x'.repeat(2001) }, { query: 'x', offset: -1 },
    { query: 'x', limit: 0 }, { query: 'x', minimumConfidence: '0.5' }, { query: 'x', enabledOnly: 'true' },
    { query: 'x', ownerId: uuid(1) }, { query: 'x', tenantId: 'other' },
    ...['limit', 'offset', 'enabledOnly', 'minimumConfidence'].map(k => ({ query: 'x', [k]: null }))]) {
    await assert.rejects(searchProcedures(() => assert.fail('no request'), input), { code: 'INVALID_SEARCH_INPUT' });
  }
  for (const options of [{ maxPages: 0 }, { maxPages: 101 }, { maxMs: 0 }, { maxMs: 300001 }]) {
    await assert.rejects(searchProcedures(() => assert.fail('no request'), { query: 'x' }, options), { code: 'INVALID_SEARCH_INPUT' });
  }
});

test('empty complete lists and bounded descriptions remain distinguishable from incomplete search', async () => {
  const empty = await searchProcedures(pages([[]]), { query: 'reconcile' });
  assert.equal(empty.status, 'complete'); assert.equal(empty.hasMore, false); assert.equal(empty.observedMatches, 0);
  const found = await searchProcedures(pages([[row(1, { description: 'x'.repeat(900) + 'needle' })], []]), { query: 'needle' });
  assert.equal(found.procedures.length, 1); assert.equal(found.procedures[0].descriptionTruncated, true);
  assert.ok(found.procedures[0].description.length <= 512);
});

test('canonical UUID identity detects duplicate casing and untrusted metadata is never traversed', async () => {
  const first = row(1, { id: 'aaaaaaaa-0000-4000-8000-000000000001' });
  Object.defineProperty(first, 'metadataJson', { get() { assert.fail('must not inspect metadata'); } });
  const result = await searchProcedures(pages([[first], [row(2, { id: first.id.toUpperCase() })], []]), { query: 'reconcile' });
  assert.equal(result.procedures.length, 1); assert.equal(result.coverage.complete, false);
});

test('actual private CLI searches with GET only, preserves status denial and rejects invalid input without calls', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-discovery-test-'));
  const fake = path.join(directory, 'api.cjs'), capture = path.join(directory, 'calls.jsonl');
  fs.writeFileSync(fake, `#!${process.execPath}\nconst fs=require('fs');
const args=process.argv.slice(2);fs.appendFileSync(process.env.THOR_CAPTURE,JSON.stringify(args)+'\\n');
const page=Number(new URL(args[1],'https://example.invalid').searchParams.get('page'));
if(process.env.GRAYMATTER_API_RESPONSE_STATUS)fs.writeFileSync(process.env.GRAYMATTER_API_RESPONSE_STATUS,page===1&&process.env.THOR_DENY==='true'?'403':'200');
if(page===1&&process.env.THOR_DENY==='true'&&process.env.THOR_DENY_EXIT_ZERO!=='true'){process.stderr.write('Bearer private-secret');process.exit(1);}
const reply=()=>process.stdout.write(JSON.stringify(page===0?[JSON.parse(process.env.THOR_ROW)]:[]));
if(process.env.THOR_DELAY==='true')setTimeout(reply,10000);else reply();\n`, { mode: 0o700 });
  const invoke = (input, deny = false, extraEnv = {}) => spawnSync(process.execPath,
    [path.join(__dirname, '../../scripts/gm-procedure-execute'), 'search'], { encoding: 'utf8', timeout: 10000,
      input: JSON.stringify(input), env: { ...process.env, GRAYMATTER_API_COMMAND: fake, THOR_CAPTURE: capture,
        THOR_ROW: JSON.stringify(row(1)), THOR_DENY: String(deny), ...extraEnv } });
  try {
    const invalid = invoke({ query: 'reconcile', tenantId: 'other' });
    assert.equal(invalid.status, 1); assert.equal(fs.existsSync(capture), false);
    const good = invoke({ query: 'reconcile' }); assert.equal(good.status, 0, good.stderr);
    assert.equal(JSON.parse(good.stdout).procedures[0].id, uuid(1));
    assert.ok(fs.readFileSync(capture, 'utf8').trim().split('\n').every(l => JSON.parse(l)[0] === 'GET'));
    const denied = invoke({ query: 'reconcile' }, true); assert.equal(denied.status, 1); assert.equal(denied.stdout, '');
    assert.equal(JSON.parse(denied.stderr).error.code, 'PROCEDURE_SEARCH_UNAVAILABLE');
    assert.doesNotMatch(denied.stderr, /private-secret|Bearer/);
    const statusDenied = invoke({ query: 'reconcile' }, true, { THOR_DENY_EXIT_ZERO: 'true' });
    assert.equal(statusDenied.status, 1); assert.equal(statusDenied.stdout, '');
    assert.equal(JSON.parse(statusDenied.stderr).error.code, 'PROCEDURE_SEARCH_UNAVAILABLE');
    const started = Date.now();
    const timeout = invoke({ query: 'reconcile' }, false,
      { THOR_DELAY: 'true', GRAYMATTER_PROCEDURE_SCAN_MAX_MS: '200' });
    assert.equal(timeout.status, 1); assert.equal(timeout.stdout, '');
    assert.equal(JSON.parse(timeout.stderr).error.code, 'PROCEDURE_SEARCH_UNAVAILABLE');
    assert.ok(Date.now() - started < 3000, 'the private transport honors the remaining search budget');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
