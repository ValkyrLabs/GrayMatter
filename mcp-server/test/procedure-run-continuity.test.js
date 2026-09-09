'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readProcedureExecution, executeProcedure } = require('../lib/procedure-execution.cjs');
const executionId = '6b5f4311-bf51-448a-83c8-e391c435314e';
const workflowId = '4d7b1763-71e6-4e8e-a1ee-b3cc39d6c671';
const workflowVersionId = 'bfdeef65-350b-46af-a4ad-4bc82586fc4c';

test('status retains exact workflow and immutable version references without hydrating their records', async () => {
  const calls = [];
  const result = await readProcedureExecution(async (...args) => {
    calls.push(args);
    return { id: executionId, state: 'WAITING_FOR_APPROVAL', workflowId, workflowVersionId,
      inputs: { secret: 'private' }, workflow: { ownerId: 'private' }, errorStack: 'private' };
  }, executionId);
  assert.deepEqual(calls, [['GET', '/WorkflowExecution/' + executionId]]);
  assert.deepEqual(result.workflow, { id: executionId, state: 'WAITING_FOR_APPROVAL',
    terminal: false, succeeded: false, workflowId, workflowVersionId });
  assert.doesNotMatch(JSON.stringify(result), /private|ownerId|errorStack|inputs/);
});

test('execution references survive the initial procedure dispatch projection', async () => {
  const result = await executeProcedure(async () => ({
    status: 'procedure_started', deterministicAttempted: true, agentExecutionPerformed: false,
    procedureRef: 'procedure:review:v1', workflowVersionId,
    workflowExecution: { id: executionId, state: 'RUNNING', workflowId, workflowVersionId },
    route: { recommendedRoute: 'run_procedure', receipt: { receiptRef: 'route:review' } }
  }), { taskType: 'workflow', traceId: 'review:v1', inputs: {} });
  assert.equal(result.workflow.workflowId, workflowId);
  assert.equal(result.workflow.workflowVersionId, workflowVersionId);
  assert.equal(result.workflow.succeeded, false);
});

test('legacy or malformed workflow references never become navigation targets', async () => {
  for (const value of [undefined, null, '', '../private', { id: workflowId }]) {
    const result = await readProcedureExecution(async () => ({ id: executionId, state: 'RUNNING',
      workflowId: value }), executionId);
    assert.equal(Object.hasOwn(result.workflow, 'workflowId'), false);
    assert.equal(Object.hasOwn(result.workflow, 'workflowVersionId'), false);
    assert.equal(result.workflow.id, executionId);
  }
});

test('missing version stays unknown while supplied malformed version evidence is rejected', async () => {
  for (const workflowVersionId of [undefined, null]) {
    const result = await readProcedureExecution(async () => ({ id: executionId, state: 'RUNNING',
      workflowId, workflowVersionId }), executionId);
    assert.equal(result.workflow.workflowId, workflowId);
    assert.equal(Object.hasOwn(result.workflow, 'workflowVersionId'), false);
  }
  for (const workflowVersionId of ['', '../private', { id: workflowId }]) {
    await assert.rejects(readProcedureExecution(async () => ({ id: executionId, state: 'RUNNING',
      workflowId, workflowVersionId }), executionId), { code: 'EXECUTION_STATUS_UNAVAILABLE' });
  }
});
