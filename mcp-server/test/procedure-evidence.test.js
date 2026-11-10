'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyProcedureEvidence } = require('../lib/procedure-evidence.cjs');
const { executeProcedure } = require('../lib/procedure-execution.cjs');

const uuid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const input = { executionId: uuid(1), routeReceiptId: uuid(2), trajectoryId: 'gm_traj_' + uuid(3) };
const hash = 'a'.repeat(64);
function fixture() {
  const trigger = { _skillOptRouteReceiptRef: 'skillopt-42', _skillOptProcedureRef: 'procedure:review',
    _skillOptMechanizedProcedure: true, _skillOptMechanizationReceiptRef: 'mechanize:42',
    _workflowVersionBoundProcedure: true, _workflowVersionId: uuid(5),
    _workflowDefinitionSnapshotHash: hash, businessInput: 'private-input' };
  const execution = { id: uuid(1), state: 'SUCCESS', workflowId: uuid(4), workflowVersionId: uuid(5),
    testMode: false, definitionSnapshotHash: hash, triggerPayload: JSON.stringify(trigger),
    errorMessage: 'private-error' };
  const route = { id: uuid(2), receiptRef: 'skillopt-42', traceId: 'different-task-trace',
    recommendedRoute: 'run_procedure', routeExplanation: 'private-route',
    procedure: { procedureRef: 'procedure:review', workflowVersionId: uuid(5), workflowId: uuid(4),
      workflowContentHash: hash, mechanizationReceiptRef: 'mechanize:42' },
    contextPage: { id: uuid(6), pageRef: 'ctxpg-42', retrievalReceipt: { receiptId: 'receipt:42' }, compressedSummary: 'private-summary' } };
  const trajectory = { trajectoryId: input.trajectoryId, traceId: 'memory-trace', contextPageRef: 'ctxpg-42',
    receiptRef: 'receipt:42', receiptBindingHash: hash, providerRouteHash: hash,
    planRef: 'plan:42', policyVersion: 'policy/v1', policyDecision: 'ANSWER_WITH_CITATIONS' };
  const chain = { version: 'omegarag-bifrost-receipt/v1', complete: true, missingLinks: [], chainHash: hash,
    chainRef: 'bifrost:' + input.trajectoryId, trajectoryRef: input.trajectoryId, traceId: trajectory.traceId,
    retrievalReceiptRef: trajectory.receiptRef, contextPageRef: 'ctxpg-42', receiptBindingHash: hash,
    providerRouteHash: hash, planRef: trajectory.planRef, policyVersion: trajectory.policyVersion,
    answerPolicyDecision: trajectory.policyDecision };
  return { execution, route, envelope: { trajectory, bifrostReceiptChain: chain }, trigger };
}
const paths = ['/WorkflowExecution/' + input.executionId, '/SkillOptRouteReceipt/' + input.routeReceiptId,
  '/graymatter/omega/trajectories/' + input.trajectoryId];
function reader(f, calls = []) {
  return async (method, endpoint, body, options) => {
    calls.push(endpoint);
    assert.equal(method, 'GET'); assert.equal(body, undefined);
    assert.deepEqual(options, { readStatus: true, expectedStatus: 200, timeoutMs: 15000 });
    return [f.execution, f.route, f.envelope][paths.indexOf(endpoint)];
  };
}

function owningFixture() {
  const f = fixture();
  f.execution.ownerId = uuid(40);
  f.route.ownerId = uuid(40);
  // Workflow billing may nominate a different account; route ownership remains
  // the actual execution actor, not the payer.
  f.route.accountId = uuid(41);
  f.page = { contextPage: { ...f.route.contextPage, retrievalReceipt: { id: uuid(7) } },
    retrievalReceipt: { id: uuid(7), receiptId: 'receipt:42', trajectoryRef: input.trajectoryId } };
  f.route.contextPage = { id: uuid(6) };
  f.receipt = { receipt: { ...f.page.retrievalReceipt, bindingHash: hash, providerRouteHash: hash,
    planRef: 'plan:42', traceId: 'memory-trace', policyVersion: 'policy/v1', text: 'private-receipt' } };
  f.paths = [paths[0], '/skillopt_ops/' + uuid(40) + '/route_receipts/skillopt-42',
    '/graymatter_ops/context_page/' + uuid(6), '/graymatter-retrieval-receipts/receipt%3A42', paths[2]];
  return f;
}

function owningReader(f, calls = []) {
  return async (method, endpoint, body, options) => {
    calls.push(endpoint);
    assert.equal(method, 'GET'); assert.equal(body, undefined);
    assert.deepEqual(options, { readStatus: true, expectedStatus: 200, timeoutMs: 15000 });
    const index = f.paths.indexOf(endpoint);
    assert.notEqual(index, -1, 'No generic fallback, list search or inferred authority');
    return [f.execution, f.route, f.page, f.receipt, f.envelope][index];
  };
}

test('follows current owning route, ID-only page and receipt wrappers without inferring origin', async () => {
  for (const request of [input, { executionId: input.executionId }]) {
    const f = owningFixture(), calls = [];
    const result = await verifyProcedureEvidence(owningReader(f, calls), request);
    assert.deepEqual(calls, f.paths);
    assert.equal(result.status, 'linked');
    assert.deepEqual(result.missingEvidence, []);
    assert.equal(result.routeReceiptId, input.routeReceiptId);
    assert.equal(result.trajectoryId, input.trajectoryId);
    assert.equal(result.businessOutcome, 'unverified');
    assert.equal(result.executionOrigin, 'unattested');
    assert.doesNotMatch(JSON.stringify(result), /private-|ownerId|accountId|compressedSummary|businessInput/);
  }
});

test('resolves a page receipt UUID locator and legacy generic route with a current page locator', async () => {
  const f = owningFixture(), calls = [];
  delete f.execution.ownerId;
  f.paths[1] = paths[1];
  delete f.page.retrievalReceipt;
  f.paths[3] = '/graymatter-retrieval-receipts/' + uuid(7);
  const result = await verifyProcedureEvidence(owningReader(f, calls), input);
  assert.equal(result.status, 'linked');
  assert.deepEqual(calls, f.paths);
});

test('rejects ambiguous owning route, page and receipt identities or commitments without fallback', async () => {
  const changes = [
    f => { f.execution.ownerId = '../owner'; },
    f => { delete f.route.ownerId; }, f => { f.route.ownerId = uuid(99); },
    f => { f.route.id = uuid(99); }, f => { f.route.receiptRef = 'other'; },
    f => { f.route.contextPage.id = '../page'; },
    f => { f.route.contextPage.pageRef = 'contradictory'; },
    f => { f.page.contextPage.id = uuid(99); }, f => { delete f.page.contextPage.pageRef; },
    f => { f.page.contextPage = []; }, f => { f.page.contextPage.retrievalReceipt.id = uuid(99); },
    f => { f.page.contextPage.retrievalReceipt.receiptId = 'other'; },
    f => { f.page.contextPage.retrievalReceipt.bindingHash = 'b'.repeat(64); },
    f => { f.page.contextPage.retrievalReceipt.trajectoryRef = 'other'; },
    f => { f.page.retrievalReceipt = []; },
    f => { delete f.page.retrievalReceipt; delete f.page.contextPage.retrievalReceipt; },
    f => {
      f.route.contextPage.retrievalReceipt = { ...f.receipt.receipt };
      delete f.page.retrievalReceipt; delete f.page.contextPage.retrievalReceipt;
    },
    f => { f.receipt.receipt.id = uuid(99); }, f => { f.receipt.receipt.receiptId = 'other'; },
    f => { f.receipt.receipt.trajectoryRef = 'other'; },
    f => { f.receipt.receipt.providerRouteHash = 'b'.repeat(64); },
    f => { f.receipt.receipt = []; }, f => { f.receipt = f.receipt.receipt; }
  ];
  for (const change of changes) {
    const f = owningFixture(), calls = []; change(f);
    await assert.rejects(verifyProcedureEvidence(owningReader(f, calls), input),
      { code: 'PROCEDURE_EVIDENCE_UNAVAILABLE' });
    assert.ok(calls.every(path => f.paths.includes(path)));
  }
});

test('current receipt proof omissions remain incomplete and every denied owning read discards partial evidence', async () => {
  for (const field of ['bindingHash', 'providerRouteHash', 'planRef', 'traceId', 'policyVersion', 'trajectoryRef']) {
    const f = owningFixture();
    // An earlier expanded copy cannot fill an omitted current commitment.
    f.page.retrievalReceipt[field] = f.receipt.receipt[field];
    delete f.receipt.receipt[field];
    const result = await verifyProcedureEvidence(owningReader(f), input);
    assert.equal(result.status, 'incomplete', field);
    assert.ok(result.missingEvidence.length);
  }
  for (let denied = 1; denied < 5; denied++) {
    const f = owningFixture(), calls = [], read = owningReader(f, calls);
    await assert.rejects(verifyProcedureEvidence(async (...args) => {
      const result = await read(...args);
      if (calls.length === denied + 1) throw Object.assign(Error('private-denial'), { status: 403 });
      return result;
    }, input), error => error.code === 'PROCEDURE_EVIDENCE_UNAVAILABLE' && !error.cause && !/private/.test(error.message));
    assert.deepEqual(calls, f.paths.slice(0, denied + 1));
  }
});

test('reads three exact ACL-governed records and reports the observed execution and linked page', async () => {
  const calls = [], f = fixture();
  const result = await verifyProcedureEvidence(reader(f, calls), input);
  assert.deepEqual(calls, paths);
  assert.equal(result.status, 'linked');
  assert.equal(result.workflow.id, input.executionId);
  assert.equal(result.workflow.state, 'SUCCESS');
  assert.equal(result.workflow.terminal, true);
  assert.deepEqual(result.missingEvidence, []);
  assert.equal(result.businessOutcome, 'unverified');
  assert.equal(result.executionOrigin, 'unattested');
  assert.doesNotMatch(JSON.stringify(result), /private-|triggerPayload|routeExplanation|compressedSummary/);
});

test('one execution ID follows only its recorded unique route and the route receipt’s own trajectory', async () => {
  const f = fixture(), calls = [];
  f.route.contextPage.retrievalReceipt.trajectoryRef = input.trajectoryId;
  const baseRead = reader(f, calls);
  const read = async (method, path, body, options) => {
    if (!path.startsWith('/SkillOptRouteReceipt?')) return baseRead(method, path, body, options);
    assert.equal(method, 'GET'); assert.equal(body, undefined); assert.equal(options.expectedStatus, 200);
    const search = new URL(path, 'https://example.invalid').searchParams;
    assert.deepEqual(JSON.parse(search.get('example')), { receiptRef: f.route.receiptRef });
    assert.equal(search.get('size'), '1');
    calls.push(path);
    return search.get('page') === '0' ? [{ id: f.route.id, receiptRef: f.route.receiptRef }] : [];
  };
  const single = { executionId: input.executionId };
  const report = await verifyProcedureEvidence(read, single);
  assert.equal(report.status, 'linked'); assert.equal(report.routeReceiptId, input.routeReceiptId);
  assert.equal(report.trajectoryId, input.trajectoryId); assert.equal(calls.length, 5);
  delete f.route.contextPage.retrievalReceipt.trajectoryRef;
  calls.length = 0;
  const partial = await verifyProcedureEvidence(read, single);
  assert.equal(partial.status, 'incomplete'); assert.ok(partial.missingEvidence.includes('trajectory_reference'));
  assert.equal(calls.length, 4);
  for (const other of [
    (method, path, ...args) => path.includes('?page=1') ? [{ id: uuid(77), receiptRef: f.route.receiptRef }] : read(method, path, ...args),
    (method, path, ...args) => path.includes('?page=0') ? [{ id: uuid(77), receiptRef: 'other' }] : read(method, path, ...args),
    (method, path, ...args) => path.includes('?page=1') ? Promise.reject(Error('denied')) : read(method, path, ...args)
  ]) await assert.rejects(verifyProcedureEvidence(other, single), { code: 'PROCEDURE_EVIDENCE_UNAVAILABLE' });
  f.route.contextPage.retrievalReceipt.trajectoryRef = 'forged_ref';
  await assert.rejects(verifyProcedureEvidence(reader(f), input), { code: 'PROCEDURE_EVIDENCE_UNAVAILABLE' });
  delete f.execution.triggerPayload; delete f.execution.workflowVersionId; delete f.execution.definitionSnapshotHash;
  calls.length = 0;
  const legacy = await verifyProcedureEvidence(read, single);
  assert.deepEqual(calls, [paths[0]]);
  assert.equal(legacy.workflow.succeeded, true); assert.equal(legacy.status, 'incomplete');
  assert.equal(legacy.routeReceiptId, null); assert.equal(legacy.trajectoryId, null);
  assert.ok(legacy.missingEvidence.includes('workflow_snapshot')); assert.equal(legacy.businessOutcome, 'unverified');
  f.execution.triggerPayload = JSON.stringify({ _skillOptRouteReceiptRef: 'unbound:business-input' });
  calls.length = 0;
  assert.equal((await verifyProcedureEvidence(read, single)).status, 'incomplete');
  assert.deepEqual(calls, [paths[0]]);
});

test('pending, failed, canceled and test executions retain their observed state separately from joins', async () => {
  for (const state of ['WAITING_FOR_APPROVAL','RUNNING','FAILED','CANCELLED','TIMEOUT']) {
    const f = fixture(); f.execution.state = state; f.execution.testMode = true;
    const result = await verifyProcedureEvidence(reader(f), input);
    assert.equal(result.workflow.state, state);
    assert.equal(result.workflow.terminal, ['FAILED','CANCELLED','TIMEOUT'].includes(state));
    assert.equal(result.workflow.testMode, true);
    assert.equal(result.businessOutcome, 'unverified');
  }
});

test('compares a linked reconciliation report with an independently pinned expectation without exposing report rows', async () => {
  const checksum = value => require('node:crypto').createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const expected = { customerCount: 2, invoiceCount: 3, matchedCount: 2, snapshotRef: 'sha256:' + hash,
    unmatchedCount: 1, unmatchedInvoiceIds: [uuid(77)] };
  const pin = { contractId: 'invoice-customer-reconciliation/v1', workflowVersionId: uuid(5),
    definitionSnapshotHash: hash, resultChecksum: checksum(expected) };
  const artifact = { executionId: input.executionId, workflowVersionId: pin.workflowVersionId,
    status: 'available', definitionSnapshotHash: hash, contractId: pin.contractId,
    contractHash: checksum({ contract: pin.contractId, field: 'reconciliationReport' }), result: expected,
    resultChecksum: checksum(expected), correctness: 'unverified' };
  const f = fixture(), calls = [];
  const check = (delta = {}, readback = artifact) => {
    calls.length = 0;
    const read = reader(f, calls);
    return verifyProcedureEvidence((method, path, body, options) => {
      if (!path.endsWith('/business-result')) return read(method, path, body, options);
      assert.equal(method, 'GET'); assert.equal(body, undefined);
      assert.equal(path, '/vaiworkflow/engineering/executions/' + input.executionId + '/business-result');
      assert.deepEqual(options, { readStatus: true, expectedStatus: 200, timeoutMs: 15000 });
      calls.push(path);
      if (readback instanceof Error) throw readback;
      return readback;
    }, { ...input, expectedResult: { ...pin, ...delta } });
  };
  let report = await check();
  assert.equal(calls.length, 4);
  assert.equal(report.resultVerification.status, 'matches_expectation');
  assert.equal(report.businessOutcome, 'unverified');
  assert.ok(!JSON.stringify(report).includes(uuid(77)));
  assert.equal((await check({ resultChecksum: 'b'.repeat(64) })).resultVerification.status, 'differs_from_expectation');
  for (const delta of [{ workflowVersionId: uuid(9) }, { definitionSnapshotHash: 'c'.repeat(64) }]) {
    await assert.rejects(check(delta), { code: 'PROCEDURE_EVIDENCE_UNAVAILABLE' });
    assert.equal(calls.length, 3);
  }
  await assert.rejects(check({ ownerId: uuid(8) }), { code: 'INVALID_EVIDENCE_INPUT' });
  assert.equal(calls.length, 0);
  await assert.rejects(check({}, { ...artifact, definitionSnapshotHash: 'b'.repeat(64) }), { code: 'PROCEDURE_EVIDENCE_UNAVAILABLE' });
  await assert.rejects(check({}, { ...artifact, correctness: 'matches-fixture' }), { code: 'PROCEDURE_EVIDENCE_UNAVAILABLE' });
  await assert.rejects(check({}, Error('private revocation')), { code: 'PROCEDURE_EVIDENCE_UNAVAILABLE' });
  const unavailable = { executionId: input.executionId, workflowVersionId: pin.workflowVersionId,
    status: 'unavailable', correctness: 'unverified' };
  assert.deepEqual((await check({}, unavailable)).resultVerification, { status: 'not_checked', reason: 'result_unavailable' });
  f.execution.state = 'RUNNING';
  assert.equal((await check()).resultVerification.reason, 'execution_not_successful'); assert.equal(calls.length, 3);
  f.execution.state = 'SUCCESS'; delete f.route.contextPage;
  assert.equal((await check()).resultVerification.reason, 'incomplete_links'); assert.equal(calls.length, 3);
});

test('missing historical fields and partial Bifrost coverage cannot establish a complete join', async () => {
  for (const change of [
    f => { delete f.route.contextPage; }, f => { delete f.route.procedure; },
    f => { delete f.execution.triggerPayload; }, f => { f.execution.triggerPayload = '{}'; },
    f => { delete f.route.procedure.workflowContentHash; },
    f => { f.envelope.bifrostReceiptChain.complete = false; f.envelope.bifrostReceiptChain.missingLinks = ['unknown-secret']; },
    f => { delete f.envelope.bifrostReceiptChain; }
  ]) {
    const f = fixture(); change(f);
    const result = await verifyProcedureEvidence(reader(f), input);
    assert.equal(result.status, 'incomplete');
    assert.ok(result.missingEvidence.length);
    assert.equal(result.businessOutcome, 'unverified');
    assert.doesNotMatch(JSON.stringify(result), /unknown-secret|private-/);
  }
});

test('wrong identity, route, compiler, version, page or Bifrost commitments discard every partial record', async () => {
  for (const change of [
    f => { f.execution.id = uuid(9); }, f => { f.route.id = uuid(9); },
    f => { f.envelope.trajectory.trajectoryId = 'different'; },
    f => { f.route.recommendedRoute = 'ask_human_approval'; },
    f => { f.route.procedure.workflowId = uuid(8); }, f => { f.route.procedure.workflowVersionId = uuid(8); },
    f => { f.route.procedure.workflowContentHash = 'b'.repeat(64); }, f => { f.route.receiptRef = 'other-receipt'; },
    f => { f.route.procedure.mechanizationReceiptRef = 'other-mechanization'; },
    f => { f.route.procedure.procedureRef = 'other-procedure'; },
    f => { f.route.contextPage.pageRef = uuid(6); },
    f => { f.route.contextPage.retrievalReceipt.receiptId = 'unrelated'; },
    f => { f.route.contextPage.retrievalReceipt.bindingHash = 'b'.repeat(64); },
    f => { f.route.contextPage.retrievalReceipt.providerRouteHash = 'b'.repeat(64); },
    f => { f.route.contextPage.retrievalReceipt.traceId = 'unrelated'; },
    f => { f.route.contextPage.retrievalReceipt.planRef = 'plan:unrelated'; },
    f => { f.route.contextPage.retrievalReceipt.policyVersion = 'policy/other'; },
    f => { f.envelope.bifrostReceiptChain.trajectoryRef = 'other'; },
    f => { f.envelope.bifrostReceiptChain.retrievalReceiptRef = 'other'; },
    f => { f.envelope.bifrostReceiptChain.chainHash = 'short'; },
    f => { f.envelope.bifrostReceiptChain.receiptBindingHash = 'b'.repeat(64); },
    f => { delete f.route.contextPage; f.envelope.bifrostReceiptChain.contextPageRef = 'wrong'; },
    f => { delete f.route.procedure.workflowVersionId; f.execution.workflowVersionId = uuid(8); },
    f => { f.execution.triggerPayload = JSON.stringify({ ...f.trigger, _skillOptMechanizedProcedure: false }); },
    f => { f.execution.triggerPayload = 'private-malformed-json'; }
  ]) {
    const f = fixture(); change(f);
    await assert.rejects(verifyProcedureEvidence(reader(f), input), { code: 'PROCEDURE_EVIDENCE_UNAVAILABLE' });
  }
});

test('checks an optional page receipt by its receiptId and never implies downstream attribution', async () => {
  const f = fixture();
  delete f.route.contextPage.retrievalReceipt;
  f.envelope.trajectory.workflowExecutionRef = 'workflow_execution:' + uuid(9);
  const result = await verifyProcedureEvidence(reader(f), input);
  assert.equal(result.status, 'linked');
  assert.equal(result.businessOutcome, 'unverified');
  assert.ok(!JSON.stringify(result).includes(uuid(9)));
});

test('late authorization failure returns a sanitized error and no evidence', async () => {
  const calls = [], read = reader(fixture(), calls);
  await assert.rejects(verifyProcedureEvidence(async (...args) => {
    const value = await read(...args);
    if (calls.length === 3) throw Object.assign(Error('private-server-content'), { status: 403 });
    return value;
  }, input), error => error.code === 'PROCEDURE_EVIDENCE_UNAVAILABLE' && !error.cause && !/private/.test(error.message));
});

test('rejects malformed input, path traversal, authority overrides and accessors before transport', async () => {
  for (const args of [null, {}, {...input, tenantId: uuid(9)}, {...input, executionId: 'bad'},
    {...input, routeReceiptId: '../2'}, {...input, trajectoryId: 'bad/../route'},
    {...input, trajectoryId: 'x%2f..'}, {...input, get executionId() { throw Error('private-getter'); }}]) {
    let calls = 0;
    await assert.rejects(verifyProcedureEvidence(() => calls++, args), { code: 'INVALID_EVIDENCE_INPUT' });
    assert.equal(calls, 0);
  }
});

test('dispatch returns the optional generated receipt UUID for exact inspection, separately from its stable reference', async () => {
  const f = fixture();
  const args = { taskType: 'workflow', traceId: 'task-42', inputs: {} };
  const reply = { status: 'procedure_started', deterministicAttempted: true, agentExecutionPerformed: false,
    route: { recommendedRoute: 'run_procedure', receipt: f.route }, procedureRef: f.route.procedure.procedureRef,
    workflowVersionId: f.execution.workflowVersionId, workflowExecution: f.execution };
  assert.equal((await executeProcedure(async () => reply, args)).routeReceiptId, input.routeReceiptId);
  delete f.route.id;
  assert.equal(Object.hasOwn(await executeProcedure(async () => reply, args), 'routeReceiptId'), false);
  f.route.id = 'not-a-uuid';
  await assert.rejects(executeProcedure(async () => reply, args), {code: 'DISPATCH_OUTCOME_UNKNOWN'});
});

test('verify CLI distinguishes linked, incomplete and revoked evidence at the transport boundary', t => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'gm-verify-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const command = path.join(dir, 'read-fixture.cjs');
  const rows = path.join(dir, 'rows.json');
  const calls = path.join(dir, 'calls');
  fs.writeFileSync(command, `#!/usr/bin/env node
const fs = require('node:fs');
const [method, path] = process.argv.slice(2);
if (method !== 'GET' || process.argv.length !== 4 || process.env.GRAYMATTER_SKIP_AUTO_REPLAY !== 'true') process.exit(1);
const record = JSON.parse(fs.readFileSync(process.env.FIXTURE_ROWS))[path];
fs.appendFileSync(process.env.CALLS, path + '\\n');
fs.writeFileSync(process.env.GRAYMATTER_API_RESPONSE_STATUS, String(record.status));
process.stdout.write(JSON.stringify(record.body));
`, { mode: 0o700 });
  const verify = (data, records) => {
    fs.writeFileSync(rows, JSON.stringify(Array.isArray(records)
      ? Object.fromEntries(paths.map((p, i) => [p, records[i]])) : records));
    return spawnSync(process.execPath, [path.resolve(__dirname, '../../scripts/gm-procedure-execute'), 'verify'], {
      input: data, timeout: 10000, encoding: 'utf8',
      env: { ...process.env, GRAYMATTER_API_COMMAND: command, FIXTURE_ROWS: rows, CALLS: calls }
    });
  };
  const f = fixture();
  const records = [f.execution, f.route, f.envelope].map(body => ({ status: 200, body }));
  const invalid = verify('{', records);
  assert.equal(invalid.status, 1);
  assert.equal(JSON.parse(invalid.stderr).error.code, 'INVALID_EVIDENCE_INPUT');
  assert.equal(fs.existsSync(calls), false);
  const request = JSON.stringify(input);
  const linked = verify(request, records);
  assert.equal(linked.status, 0, linked.stderr);
  assert.equal(JSON.parse(linked.stdout).status, 'linked');
  assert.deepEqual(fs.readFileSync(calls, 'utf8').trim().split('\n'), paths);
  delete f.route.contextPage;
  const partial = verify(request, records);
  assert.equal(partial.status, 0);
  assert.equal(JSON.parse(partial.stdout).status, 'incomplete');
  records[2].status = 403;
  const denied = verify(request, records);
  assert.equal(denied.status, 1);
  assert.equal(denied.stdout, '');
  assert.equal(JSON.parse(denied.stderr).error.code, 'PROCEDURE_EVIDENCE_UNAVAILABLE');
  assert.doesNotMatch(denied.stderr, /private-|triggerPayload|contextPage/);

  const current = owningFixture();
  const currentRows = Object.fromEntries(current.paths.map((p, i) => [p,
    { status: 200, body: [current.execution, current.route, current.page, current.receipt, current.envelope][i] }]));
  fs.writeFileSync(calls, '');
  const located = verify(JSON.stringify({ executionId: input.executionId }), currentRows);
  assert.equal(located.status, 0, located.stderr);
  assert.equal(JSON.parse(located.stdout).status, 'linked');
  assert.deepEqual(fs.readFileSync(calls, 'utf8').trim().split('\n'), current.paths);
  for (const status of [202, 302, 401, 403, 404, 500]) {
    currentRows[current.paths[3]].status = status;
    fs.writeFileSync(calls, '');
    const unavailable = verify(JSON.stringify({ executionId: input.executionId }), currentRows);
    assert.equal(unavailable.status, 1);
    assert.equal(unavailable.stdout, '');
    assert.equal(JSON.parse(unavailable.stderr).error.code, 'PROCEDURE_EVIDENCE_UNAVAILABLE');
    assert.doesNotMatch(unavailable.stderr, /private-|receipt:42/);
    assert.deepEqual(fs.readFileSync(calls, 'utf8').trim().split('\n'), current.paths.slice(0, 4));
  }
});
