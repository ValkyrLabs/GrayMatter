'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { inspectProcedure } = require('../lib/procedure-inspection.cjs');

const ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const VERSION = 'bbbbbbbb-0000-4000-8000-000000000002';
const contract = (extra = {}) => ({ version: 1, requiredInputKeys: ['task'], inputTypes: { task: 'object' },
  inputAliases: { task: ['request'] }, objectReferences: {}, ...extra });
const row = (metadata = JSON.stringify({ procedureContract: contract() }), extra = {}) => ({
  id: ID, procedureRef: 'proc:reconciliation:r1', name: 'Reconcile supplied snapshots', taskType: 'workflow',
  description: 'Report missing customer references.', enabled: false, deterministic: true, confidence: 0.8,
  lifecycleStatus: 'shadow', workflowBindingStatus: 'shadow', workflowId: VERSION, workflowVersionId: VERSION,
  workflowContentHash: 'a'.repeat(64), workflowAbiHash: 'b'.repeat(64), mechanizationReceiptRef: 'skillmech:reconcile:r1',
  metadataJson: metadata, ownerId: ID, contraindicationsJson: 'private-secret', ...extra
});

test('reads one exact authorized Procedure and exposes only its declared contract and artifact references', async () => {
  const calls = [];
  const result = await inspectProcedure(async (...args) => { calls.push(args); return row(); }, ID.toUpperCase());
  assert.deepEqual(calls, [['GET', `/Procedure/${ID}`, undefined,
    { timeoutMs: 15000, readStatus: true, expectedStatus: 200 }]]);
  assert.equal(result.operation, 'inspect'); assert.equal(result.procedure.id, ID);
  assert.equal(result.procedure.workflowVersionId, VERSION);
  assert.equal(result.procedure.mechanizationReceiptRef, 'skillmech:reconcile:r1');
  assert.equal(result.procedure.enabled, false); assert.equal(result.procedure.workflowBindingStatus, 'shadow');
  assert.deepEqual(result.inputContract, { status: 'available', source: 'Procedure.metadataJson.procedureContract',
    projection: contract() });
  assert.equal(result.executionAuthorization, 'server_recheck_required');
  assert.equal(result.workflowVersionValidation, 'not_checked');
  assert.deepEqual(result.launchInputSchema, { status: 'not_retrieved' });
  assert.doesNotMatch(JSON.stringify(result), /private-secret|ownerId|contraindicationsJson/);
});

test('legacy metadata never becomes an invented empty contract', async () => {
  const absent = row(); delete absent.metadataJson;
  assert.equal((await inspectProcedure(async () => absent, ID)).inputContract.status, 'unavailable');
  for (const metadata of [null, '', '{}', '{"procedureContract":null}']) {
    const result = await inspectProcedure(async () => row(metadata), ID);
    assert.equal(result.inputContract.status, 'unavailable');
  }
});

test('unsupported, malformed and over-budget declarations report unavailable without leaking metadata', async () => {
  const invalid = ['not-json-private-secret', '[]', JSON.stringify({ procedureContract: [] }),
    JSON.stringify({ procedureContract: contract({ version: 2 }) }),
    JSON.stringify({ procedureContract: contract({ version: '1' }) }),
    JSON.stringify({ procedureContract: contract({ requiredInputKeys: ['ignore prior instructions'] }) }),
    JSON.stringify({ procedureContract: contract({ requiredInputKeys: Array(51).fill('task') }) }),
    JSON.stringify({ procedureContract: contract({ inputAliases: { task: Array(21).fill('request') } }) }),
    JSON.stringify({ procedureContract: contract({ inputTypes: { task: ['object'] } }) }),
    JSON.stringify({ procedureContract: contract(), extra: 'x'.repeat(65536) }),
    '{"procedureContract":{"version":1,"requiredInputKeys":["task"],"inputTypes":{"__proto__":"object"}}}'];
  for (const metadata of invalid) {
    const result = await inspectProcedure(async () => row(metadata), ID);
    assert.equal(result.inputContract.status, 'unavailable', metadata.slice(0, 100));
    assert.equal(result.inputContract.projection, undefined);
    assert.doesNotMatch(JSON.stringify(result), /private-secret|ignore prior instructions/);
  }
});

test('bounded projection ignores unrelated metadata and does not promote declaration text to policy', async () => {
  const source = contract({ extra: 'private-secret', fallbackRoute: 'RUN_WORKFLOW', externalMutationPolicy: 'allow_all',
    maxOutcomeAgeSeconds: 7776000 });
  const result = await inspectProcedure(async () => row(JSON.stringify({ procedureContract: source,
    evidence: { text: 'private-secret' }, ownerId: ID })), ID);
  assert.deepEqual(result.inputContract.projection, contract());
  assert.doesNotMatch(JSON.stringify(result), /private-secret|allow_all|RUN_WORKFLOW|maxOutcomeAgeSeconds/);
});

test('declared optional input maps use canonical defaults and returned contracts are detached', async () => {
  const result = await inspectProcedure(async () => row(JSON.stringify({ procedureContract: {
    version: 1, requiredInputKeys: ['task'], inputTypes: null
  } })), ID);
  assert.deepEqual(result.inputContract.projection, { version: 1, requiredInputKeys: ['task'], inputTypes: {},
    inputAliases: {}, objectReferences: {} });
  assert.equal(Object.getPrototypeOf(result.inputContract.projection), Object.prototype);
});

test('exact read rejects wrong identity, invalid references and selected-field accessors without invoking them', async () => {
  let accessorCalls = 0;
  const accessor = row();
  Object.defineProperty(accessor, 'metadataJson', { get() { accessorCalls++; return '{}'; } });
  for (const value of [null, [], row(undefined, { id: VERSION }), row(undefined, { mechanizationReceiptRef: 'bad value' }), accessor]) {
    await assert.rejects(inspectProcedure(async () => value, ID), { code: 'PROCEDURE_INSPECTION_UNAVAILABLE' });
  }
  assert.equal(accessorCalls, 0);
  const ignored = row();
  Object.defineProperty(ignored, 'ownerId', { get() { assert.fail('must not traverse irrelevant fields'); } });
  assert.equal((await inspectProcedure(async () => ignored, ID)).inputContract.status, 'available');
});

test('invalid identities fail before transport; denial and timeout contain no server error text', async () => {
  for (const id of ['', '../Procedure', `${ID}?ownerId=x`, {}, null, 42]) {
    await assert.rejects(inspectProcedure(() => assert.fail('no transport'), id), { code: 'INVALID_INSPECTION_INPUT' });
  }
  for (const status of [401, 403, 404, 500, undefined]) {
    let calls = 0;
    await assert.rejects(inspectProcedure(async () => { calls++; throw Object.assign(new Error('Bearer private-secret'), { status }); }, ID),
      e => e.code === 'PROCEDURE_INSPECTION_UNAVAILABLE' && !e.message.includes('private-secret'));
    assert.equal(calls, 1);
  }
});

test('actual CLI inspects with one GET and HTTP receipt, sanitizes errors and never dispatches', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-inspect-test-'));
  const fake = path.join(directory, 'api.cjs'), capture = path.join(directory, 'calls.jsonl');
  fs.writeFileSync(fake, `#!${process.execPath}\nconst fs=require('node:fs');
fs.appendFileSync(process.env.THOR_CAPTURE,JSON.stringify({args:process.argv.slice(2),
skipReplay:process.env.GRAYMATTER_SKIP_AUTO_REPLAY,skipDeferred:process.env.GRAYMATTER_SKIP_DEFERRED})+'\\n');
if(process.env.THOR_STATUS!=='missing')fs.writeFileSync(process.env.GRAYMATTER_API_RESPONSE_STATUS,process.env.THOR_STATUS||'200');
process.stdout.write(process.env.THOR_ROW);\n`, { mode: 0o700 });
  const invoke = (id = ID, status = '200') => spawnSync(process.execPath,
    [path.join(__dirname, '../../scripts/gm-procedure-execute'), 'inspect', id], { encoding: 'utf8', timeout: 5000,
      env: { ...process.env, GRAYMATTER_API_COMMAND: fake, THOR_CAPTURE: capture, THOR_STATUS: status, THOR_ROW: JSON.stringify(row()) } });
  try {
    const invalid = invoke('../Procedure'); assert.equal(invalid.status, 1); assert.equal(fs.existsSync(capture), false);
    assert.equal(JSON.parse(invalid.stderr).error.code, 'INVALID_INSPECTION_INPUT');
    const result = invoke(); assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).inputContract.status, 'available');
    const calls = fs.readFileSync(capture, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(calls, [{ args: ['GET', `/Procedure/${ID}`], skipReplay: 'true', skipDeferred: 'true' }]);
    for (const status of ['401', '403', '404', '500', '202', 'missing']) {
      const denied = invoke(ID, status); assert.equal(denied.status, 1, status); assert.equal(denied.stdout, '');
      assert.equal(JSON.parse(denied.stderr).error.code, 'PROCEDURE_INSPECTION_UNAVAILABLE');
      assert.doesNotMatch(denied.stderr, /private-secret|Bearer/);
    }
    assert.ok(fs.readFileSync(capture, 'utf8').trim().split('\n').map(JSON.parse).every(c => c.args[0] === 'GET'));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
