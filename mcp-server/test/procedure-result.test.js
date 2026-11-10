'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { readProcedureResult } = require('../lib/procedure-result.cjs');
const id = randomUUID(), version = randomUUID(), hex = 'f'.repeat(64);
const hash = obj => createHash('sha256').update(JSON.stringify(obj)).digest('hex');
const result = { customerCount: 0, invoiceCount: 1, matchedCount: 0, snapshotRef: 'sha256:' + hex,
  unmatchedCount: 1, unmatchedInvoiceIds: [randomUUID()] };
const contractId = 'invoice-customer-reconciliation/v1';
const response = { status: 'available', executionId: id, workflowVersionId: version, definitionSnapshotHash: hex,
  contractId, contractHash: hash({contract:contractId,field:'reconciliationReport'}), resultChecksum: hash(result),
  correctness:'unverified', result };
test('one private read returns a checksum-checked report on the original execution and version', async () => {
  const calls = [];
  const read = async (...args) => { calls.push(args); return { ...response, contextData: 'secret' }; };
  const projected = await readProcedureResult(read,id,version);
  assert.deepEqual(projected.result,result); assert.equal(projected.correctness,'unverified');
  assert.deepEqual(calls,[['GET',`/vaiworkflow/engineering/executions/${id}/business-result`]]);
  assert.equal(projected.contextData,undefined);
});
test('rejects drifted evidence, wrong contract, extra fields, wrong checksum and access errors', async () => {
  for (const delta of [{executionId:randomUUID()}, {workflowVersionId:randomUUID()}, {resultChecksum:hex},
    {contractHash:hex}, {definitionSnapshotHash:'bad'}, {correctness:'verified'}, {result:{...result,token:'secret'}},
    {result:{...result,unmatchedCount:0}}, {status:'pending'}]) {
    await assert.rejects(readProcedureResult(async () => ({...response,...delta}),id,version), {code:'PROCEDURE_RESULT_UNAVAILABLE'});
  }
  await assert.rejects(readProcedureResult(async () => { throw new Error('secret'); },id,version), {code:'PROCEDURE_RESULT_UNAVAILABLE'});
  await assert.rejects(readProcedureResult(() => assert.fail('invalid input must make no request'),'../private',version), {code:'INVALID_RESULT_INPUT'});
});
test('unavailable is distinct from a valid empty result', async () => {
  assert.deepEqual(await readProcedureResult(async()=>({status:'unavailable',executionId:id,workflowVersionId:version,correctness:'unverified'}),id,version),
    {status:'unavailable',executionId:id,workflowVersionId:version,correctness:'unverified'});
  const empty={...result,invoiceCount:0,unmatchedCount:0,unmatchedInvoiceIds:[]};
  assert.deepEqual((await readProcedureResult(async()=>({...response,result:empty,resultChecksum:hash(empty)}),id,version)).result,empty);
});
