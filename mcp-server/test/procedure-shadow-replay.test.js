'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { startShadowReplay } = require('../lib/procedure-shadow-replay.cjs');

const input = { candidateRef: 'skillcand-frozen', baselineCapsuleRef: 'skillxp-holdout' };
const executionId = '11111111-1111-4111-8111-111111111111';
const versionId = '22222222-2222-4222-8222-222222222222';
const reply = () => ({ ...input, status: 'accepted', experimentRef: 'omega-exp-1',
  mechanizationReceiptRef: 'skillmech-1', routeReceiptRef: 'skillopt-original', selectedRoute: 'run_workflow',
  workflowExecutionId: executionId, workflowVersionId: versionId, taskDigest: 'a'.repeat(64) });

test('shadow replay submits only the frozen capsule to its candidate and minimizes admission', async () => {
  const calls = [];
  const value = await startShadowReplay(async (...args) => { calls.push(args); return { ...reply(), secret: 'private-secret' }; }, input);
  assert.deepEqual(calls, [['POST', '/skillopt_ops/candidates/skillcand-frozen/replay-executions',
    { baselineCapsuleRef: input.baselineCapsuleRef },
    { readStatus: true, expectedStatus: 200, timeoutMs: 65000, allowAuthRetry: false }]]);
  assert.equal(value.status, 'accepted');
  assert.equal(value.workflowExecutionId, executionId);
  assert.equal(value.routeReceiptRef, 'skillopt-original');
  for (const key of ['secret', 'succeeded', 'promoted', 'passed']) assert.equal(Object.hasOwn(value, key), false);
});

test('policy refusal has no execution and never dispatches a fallback', async () => {
  let calls = 0;
  const row = reply();
  for (const key of ['workflowExecutionId', 'workflowVersionId', 'taskDigest']) delete row[key];
  row.status = 'not_dispatched'; row.selectedRoute = 'stop_policy_denied';
  const result = await startShadowReplay(async () => { calls++; return row; }, input);
  assert.equal(result.status, 'not_dispatched');
  assert.equal(Object.hasOwn(result, 'workflowExecutionId'), false);
  assert.equal(calls, 1);
});

test('task, score, authority, route and invalid references are refused before transport', async () => {
  const invalid = [null, [], {}, { ...input, candidateRef: '../private' }, { ...input, baselineCapsuleRef: '' },
    { ...input, candidateRef: 'x'.repeat(129) }, ...['task', 'inputs', 'score', 'ownerId', 'tenantId',
      'routeReceiptRef', '_skillOptShadowReplay'].map(key => ({ ...input, [key]: 'untrusted' })),
    JSON.parse('{"candidateRef":"skillcand-frozen","baselineCapsuleRef":"skillxp-holdout","__proto__":{}}')];
  for (const row of invalid) await assert.rejects(startShadowReplay(() => assert.fail('No dispatch'), row),
    { code: 'INVALID_SHADOW_REPLAY_INPUT' });
  let evaluated = false;
  await assert.rejects(startShadowReplay(() => assert.fail('No dispatch'),
    { ...input, get task() { evaluated = true; return {}; } }), { code: 'INVALID_SHADOW_REPLAY_INPUT' });
  assert.equal(evaluated, false);
});

test('mismatched or incomplete admission and transport errors remain unknown with no retry', async () => {
  const rows = [null, [], { ...reply(), candidateRef: 'another-candidate' }, { ...reply(), baselineCapsuleRef: 'another-source' },
    { ...reply(), status: 'SUCCESS' }, { ...reply(), selectedRoute: 'run_procedure' },
    ...['experimentRef', 'mechanizationReceiptRef', 'routeReceiptRef', 'workflowExecutionId', 'workflowVersionId', 'taskDigest']
      .map(key => ({ ...reply(), [key]: null })),
    { ...reply(), taskDigest: 'A'.repeat(64) }, { ...reply(), status: 'not_dispatched' }];
  for (const row of rows) {
    let calls = 0;
    await assert.rejects(startShadowReplay(async () => { calls++; return row; }, input), { code: 'SHADOW_REPLAY_OUTCOME_UNKNOWN' });
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(startShadowReplay(async () => { calls++; throw new Error('Bearer private-secret'); }, input),
    error => error.code === 'SHADOW_REPLAY_OUTCOME_UNKNOWN' && !error.message.includes('private-secret'));
  assert.equal(calls, 1);
});

test('actual private CLI verifies HTTP receipt, forwards exact body and disables deferred dispatch', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-shadow-cli-'));
  const fake = path.join(dir, 'api.cjs'); const capture = path.join(dir, 'capture.json');
  fs.writeFileSync(fake, `#!${process.execPath}\nconst fs = require('node:fs');
fs.writeFileSync(process.env.CAPTURE, JSON.stringify({ args: process.argv.slice(2),
  skip: ['GRAYMATTER_SKIP_SELF_UPDATE','GRAYMATTER_SKIP_AUTO_REPLAY','GRAYMATTER_SKIP_DEFERRED','GRAYMATTER_SKIP_AUTH_REISSUE'].map(k=>process.env[k]) }));
if (process.env.GRAYMATTER_API_RESPONSE_STATUS && process.env.HTTP_STATUS) fs.writeFileSync(process.env.GRAYMATTER_API_RESPONSE_STATUS, process.env.HTTP_STATUS);
process.stdout.write(process.env.REPLY);\n`, { mode: 0o700 });
  const invoke = (body, status) => spawnSync(process.execPath, [path.resolve(__dirname, '../../scripts/gm-procedure-execute'), 'shadow-replay'],
    { input: JSON.stringify(body), encoding: 'utf8', timeout: 10000,
      env: { ...process.env, GRAYMATTER_API_COMMAND: fake, CAPTURE: capture, REPLY: JSON.stringify(reply()), HTTP_STATUS: status } });
  try {
    let result = invoke(input, '200');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, 'accepted');
    const captured = JSON.parse(fs.readFileSync(capture));
    assert.deepEqual(captured.args.slice(0, 2), ['POST', '/skillopt_ops/candidates/skillcand-frozen/replay-executions']);
    assert.deepEqual(JSON.parse(captured.args[2]), { baselineCapsuleRef: input.baselineCapsuleRef });
    assert.deepEqual(captured.skip, ['true', 'true', 'true', 'true']);
    for (const status of ['', '403', '409', '201']) {
      result = invoke(input, status);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.equal(JSON.parse(result.stderr).error.code, 'SHADOW_REPLAY_OUTCOME_UNKNOWN');
    }
    fs.rmSync(capture);
    result = invoke({ ...input, task: {} }, '200');
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stderr).error.code, 'INVALID_SHADOW_REPLAY_INPUT');
    assert.equal(fs.existsSync(capture), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
