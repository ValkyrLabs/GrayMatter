'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { executeProcedure, readProcedureExecution, prepareProcedureRequest } = require('../lib/procedure-execution.cjs');

const executionId = '6b5f4311-bf51-448a-83c8-e391c435314e';
const versionId = 'bfdeef65-350b-46af-a4ad-4bc82586fc4c';
const request = () => ({ taskType: 'workflow', traceId: 'reconcile-case-42-v1', inputs: { amount: 42 } });
const response = () => ({
  status: 'procedure_started', deterministicAttempted: true, agentExecutionPerformed: false,
  procedureRef: 'procedure:reconcile:v1', workflowVersionId: versionId,
  workflowExecution: { id: executionId, state: 'RUNNING', inputs: { token: 'private-secret' }, errorStack: 'private-stack' },
  route: { recommendedRoute: 'run_procedure', receipt: { receiptRef: 'route:42', account: { secret: 'private-account' } } },
  fallbackRoute: 'call_hosted_cheap_model'
});

test('dispatch uses the existing identity-free endpoint and projects started separately from success', async () => {
  const calls = [];
  const result = await executeProcedure(async (...args) => { calls.push(args); return response(); }, {
    ...request(), applicationId: versionId, projectId: executionId, contextPageId: versionId, procedureHints: ['reconcile']
  });
  assert.deepEqual(calls, [['POST', '/skillopt_ops/execute', {
    routeRequest: { taskType: 'workflow', traceId: 'reconcile-case-42-v1', application: { id: versionId },
      project: { id: executionId }, contextPage: { id: versionId }, procedureHints: ['reconcile'] }, inputs: { amount: 42 }
  }]]);
  assert.equal(result.status, 'procedure_started');
  assert.deepEqual(result.workflow, { id: executionId, state: 'RUNNING', terminal: false, succeeded: false });
  assert.equal(result.workflowVersionId, versionId);
  assert.equal(result.routeReceiptRef, 'route:42');
  assert.equal(result.agentExecutionPerformed, false);
  assert.doesNotMatch(JSON.stringify(result), /private-|errorStack|inputs|account/);
});

test('same logical task remains stable on explicit retry and input data is not mutated', async () => {
  const source = request(); const before = JSON.stringify(source); const calls = [];
  const send = async (...args) => { calls.push(args); return response(); };
  await executeProcedure(send, source); await executeProcedure(send, source);
  assert.deepEqual(calls[0], calls[1]); assert.equal(JSON.stringify(source), before);
});

test('blocked and fallback replies do not dispatch a model or pretend there is an execution', async () => {
  for (const [status, route] of [['blocked', 'ask_human_approval'], ['fallback_required', 'call_hosted_cheap_model']]) {
    let count = 0;
    const result = await executeProcedure(async () => { count++; return {
      status, deterministicAttempted: true, agentExecutionPerformed: false, fallbackRoute: route,
      fallbackReason: 'private-secret', route: { recommendedRoute: route, receipt: { receiptRef: 'route:42' } }
    }; }, request());
    assert.equal(count, 1); assert.equal(result.status, status); assert.equal(result.workflow, null);
    assert.equal(result.agentExecutionPerformed, false); assert.doesNotMatch(JSON.stringify(result), /private-secret/);
  }
});

test('missing identity, authority overrides, invalid references and reserved runtime fields fail before transport', async () => {
  const invalid = [ {}, { ...request(), traceId: '' }, { ...request(), traceId: ' x ' },
    { ...request(), traceId: 'x'.repeat(129) }, { ...request(), taskType: 'made_up' },
    { ...request(), tenantId: 'someone-else' }, { ...request(), requestedRoute: 'run_procedure' },
    { ...request(), metadata: { approved: true } }, { ...request(), applicationId: '../secret' },
    { ...request(), procedureHints: ['x\nsecret'] }, { ...request(), procedureHints: Array(26).fill('x') },
    { ...request(), inputs: { _workflowExecutionRef: 'other-task' } },
    { ...request(), inputs: { _skillOptMechanizedProcedure: true } },
    { ...request(), inputs: { nested: JSON.parse('{"__proto__":{"admin":true}}') } }
  ];
  for (const value of invalid) await assert.rejects(executeProcedure(() => assert.fail('must not dispatch'), value), { code: 'INVALID_INPUT' });
});

test('only bounded plain JSON enters the workflow, preserving ordinary business fields', () => {
  let nested = {}; for (let i = 0; i < 20; i++) nested = { child: nested };
  const cycle = {}; cycle.child = cycle;
  for (const inputs of [new Date(), [], { x: NaN }, { x: Infinity }, { x: 1n }, { x: undefined }, { x: () => 1 },
    { x: 'x'.repeat(65537) }, { x: Array(10001).fill(0) }, nested, cycle]) {
    assert.throws(() => prepareProcedureRequest({ ...request(), inputs }), { code: 'INVALID_INPUT' });
  }
  let called = false;
  const accessor = {}; Object.defineProperty(accessor, 'secret', { enumerable: true, get() { called = true; return 'secret'; } });
  assert.throws(() => prepareProcedureRequest({ ...request(), inputs: accessor }), { code: 'INVALID_INPUT' });
  assert.equal(called, false);
  assert.deepEqual(prepareProcedureRequest({ ...request(), inputs: { ownerId: 'business-record', note: 'hello', lines: [0, false, null] } }).inputs,
    { ownerId: 'business-record', note: 'hello', lines: [0, false, null] });
});

test('untrusted or inconsistent dispatch replies remain unknown and never get reported as success', async () => {
  const mutations = [r => { r.status = 'complete'; }, r => { r.agentExecutionPerformed = true; },
    r => { delete r.agentExecutionPerformed; }, r => { r.workflowExecution.id = 'other'; },
    r => { r.workflowExecution.state = 'COMPLETED'; }, r => { delete r.workflowVersionId; },
    r => { r.route.recommendedRoute = 'stop_policy_denied'; }, r => { r.status = 'blocked'; },
    r => { r.route.receipt.receiptRef = 'private secret'; }, r => { r.deterministicAttempted = false; }
  ];
  for (const mutate of mutations) {
    const value = response(); mutate(value);
    await assert.rejects(executeProcedure(async () => value, request()), { code: 'DISPATCH_OUTCOME_UNKNOWN' });
  }
  let calls = 0;
  await assert.rejects(executeProcedure(async () => { calls++; throw new Error('Bearer private-secret'); }, request()),
    error => error.code === 'DISPATCH_OUTCOME_UNKNOWN' && !error.message.includes('private-secret'));
  assert.equal(calls, 1);
});

test('aggregate byte limit stops traversal before inspecting the rest of an oversized request', () => {
  let tailVisited = false;
  const tail = new Proxy({}, { getPrototypeOf(target) { tailVisited = true; return Reflect.getPrototypeOf(target); } });
  assert.throws(() => prepareProcedureRequest({ ...request(), inputs: {
    first: 'x'.repeat(40000), second: 'y'.repeat(40000), tail
  } }), { code: 'INVALID_INPUT' });
  assert.equal(tailVisited, false, 'the byte limit must stop work before traversing the remaining input');
});

test('status uses one exact generated read, validates identity and projects terminal and waiting states', async () => {
  for (const [state, terminal, succeeded] of [['SUCCESS', true, true], ['FAILED', true, false], ['CANCELLED', true, false],
    ['TIMEOUT', true, false], ['WAITING_FOR_APPROVAL', false, false], ['QUARANTINED', false, false]]) {
    const calls = [];
    const result = await readProcedureExecution(async (...args) => { calls.push(args); return { id: executionId, state,
      inputs: { token: 'private-secret' }, errorStack: 'private-stack' }; }, executionId);
    assert.deepEqual(calls, [['GET', `/WorkflowExecution/${executionId}`]]);
    assert.deepEqual(result.workflow, { id: executionId, state, terminal, succeeded });
    assert.doesNotMatch(JSON.stringify(result), /private-|errorStack|inputs/);
  }
});

test('dispatch rejects a conflicting or malformed execution version without replay or fallback', async () => {
  for (const workflowVersionId of [executionId, 'not-a-version', '', 42]) {
    let calls = 0;
    const value = response(); value.workflowExecution.workflowVersionId = workflowVersionId;
    await assert.rejects(executeProcedure(async () => { calls++; return value; }, request()),
      { code: 'DISPATCH_OUTCOME_UNKNOWN' });
    assert.equal(calls, 1);
  }
});

test('dispatch preserves a matching execution version and keeps legacy absence explicit', async () => {
  const value = response(); value.workflowExecution.workflowVersionId = versionId.toUpperCase();
  const result = await executeProcedure(async () => value, request());
  assert.equal(result.workflow.workflowVersionId, versionId.toUpperCase());
  for (const missing of [undefined, null]) {
    value.workflowExecution.workflowVersionId = missing;
    const legacy = await executeProcedure(async () => value, request());
    assert.equal(Object.hasOwn(legacy.workflow, 'workflowVersionId'), false);
  }
});

test('exact status preserves the observed version and rejects malformed version evidence', async () => {
  const value = { id: executionId, state: 'SUCCESS', workflowVersionId: versionId };
  const result = await readProcedureExecution(async () => value, executionId);
  assert.equal(result.workflow.workflowVersionId, versionId);
  for (const malformed of ['not-a-version', '', 42, {}]) {
    await assert.rejects(readProcedureExecution(async () => ({ ...value, workflowVersionId: malformed }), executionId),
      { code: 'EXECUTION_STATUS_UNAVAILABLE' });
  }
});

test('invalid status targets and unavailable or mismatched status never fabricate an outcome', async () => {
  await assert.rejects(readProcedureExecution(() => assert.fail('must not fetch'), '../id'), { code: 'INVALID_INPUT' });
  for (const value of [{ id: versionId, state: 'SUCCESS' }, { id: executionId, status: 'SUCCESS' }, null]) {
    await assert.rejects(readProcedureExecution(async () => value, executionId), { code: 'EXECUTION_STATUS_UNAVAILABLE' });
  }
  await assert.rejects(readProcedureExecution(async () => { throw new Error('private-secret'); }, executionId),
    error => error.code === 'EXECUTION_STATUS_UNAVAILABLE' && !error.message.includes('private-secret'));
});

function cliFixture(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-procedure-test-'));
  const fake = path.join(directory, 'api.cjs');
  const capture = path.join(directory, 'request.json');
  fs.writeFileSync(fake, `#!${process.execPath}\n'use strict';
const fs = require('node:fs');
fs.writeFileSync(process.env.THOR_CAPTURE, JSON.stringify({
  args: process.argv.slice(2), skipDeferred: process.env.GRAYMATTER_SKIP_DEFERRED,
  skipReplay: process.env.GRAYMATTER_SKIP_AUTO_REPLAY, skipUpdate: process.env.GRAYMATTER_SKIP_SELF_UPDATE
}));
if (process.env.THOR_FAIL === 'true') { process.stderr.write('Bearer private-secret'); process.exit(1); }
process.stdout.write(process.env.THOR_REPLY);
`, { mode: 0o700 });
  const invoke = (args, input, reply = response(), extraEnv = {}) => spawnSync(process.execPath,
    [path.join(__dirname, '../../scripts/gm-procedure-execute'), ...args], {
      input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', timeout: 10000,
      env: { ...process.env, GRAYMATTER_API_COMMAND: fake, THOR_CAPTURE: capture,
        THOR_REPLY: typeof reply === 'string' ? reply : JSON.stringify(reply), ...extraEnv }
    });
  try { run({ invoke, capture }); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test('actual CLI forwards exact execution/status contracts and disables deferred action replay', () => cliFixture(({ invoke, capture }) => {
  const started = invoke(['execute'], request());
  assert.equal(started.status, 0, started.stderr);
  assert.equal(JSON.parse(started.stdout).status, 'procedure_started');
  let sent = JSON.parse(fs.readFileSync(capture));
  assert.deepEqual(sent.args.slice(0, 2), ['POST', '/skillopt_ops/execute']);
  assert.deepEqual(JSON.parse(sent.args[2]), prepareProcedureRequest(request()));
  assert.equal(sent.skipDeferred, 'true'); assert.equal(sent.skipReplay, 'true'); assert.equal(sent.skipUpdate, 'true');
  const status = invoke(['status', executionId], '', { id: executionId, state: 'SUCCESS', inputs: { token: 'private-secret' } });
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).workflow.succeeded, true);
  sent = JSON.parse(fs.readFileSync(capture));
  assert.deepEqual(sent.args, ['GET', `/WorkflowExecution/${executionId}`]);
  assert.doesNotMatch(started.stdout + status.stdout, /private-/);
}));

test('actual CLI rejects malformed, oversized and authority-shaped inputs without a transport call', () => cliFixture(({ invoke, capture }) => {
  for (const [args, input] of [[['execute'], '{'], [['execute'], 'x'.repeat(65537)],
    [['execute'], { ...request(), ownerId: 'someone-else' }], [['execute', '--force'], request()],
    [['status', '../private'], '']]) {
    const result = invoke(args, input);
    assert.equal(result.status, 1); assert.equal(result.stdout, '');
    assert.equal(JSON.parse(result.stderr).error.code, 'INVALID_INPUT');
    assert.equal(fs.existsSync(capture), false);
  }
}));

test('actual CLI hides transport details and reports unknown dispatch instead of launching fallback', () => cliFixture(({ invoke }) => {
  for (const [reply, env] of [['not-json private-secret', {}], [response(), { THOR_FAIL: 'true' }]]) {
    const result = invoke(['execute'], request(), reply, env);
    assert.equal(result.status, 1); assert.equal(result.stdout, '');
    assert.equal(JSON.parse(result.stderr).error.code, 'DISPATCH_OUTCOME_UNKNOWN');
    assert.doesNotMatch(result.stderr, /private-secret|Bearer/);
  }
}));
