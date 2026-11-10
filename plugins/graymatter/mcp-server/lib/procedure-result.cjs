'use strict';
const { createHash } = require('node:crypto');

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const HEX = /^[a-f0-9]{64}$/;
const CONTRACT = 'invoice-customer-reconciliation/v1';
const digest = text => createHash('sha256').update(text, 'utf8').digest('hex');
const contractHash = digest(JSON.stringify({ contract: CONTRACT, field: 'reconciliationReport' }));
const fields = ['customerCount', 'invoiceCount', 'matchedCount', 'snapshotRef', 'unmatchedCount', 'unmatchedInvoiceIds'];
const isUUID = value => typeof value === 'string' && UUID.test(value);

function resultError(invalid) {
  const code = invalid ? 'INVALID_RESULT_INPUT' : 'PROCEDURE_RESULT_UNAVAILABLE';
  const message = invalid ? 'Supply the execution and workflow version UUIDs from the original dispatch.'
    : 'A bounded result for that execution and workflow version could not be verified.';
  return Object.assign(new Error(message), { code });
}

async function readProcedureResult(request, executionId, workflowVersionId) {
  if (!isUUID(executionId) || !isUUID(workflowVersionId)) throw resultError(true);
  try {
    const value = await request('GET', `/vaiworkflow/engineering/executions/${executionId}/business-result`);
    if (!value || !isUUID(value.executionId) || !isUUID(value.workflowVersionId)
        || value.executionId.toLowerCase() !== executionId.toLowerCase()
        || value.workflowVersionId.toLowerCase() !== workflowVersionId.toLowerCase()
        || !['available', 'pending', 'unsuccessful', 'unavailable'].includes(value.status)) throw resultError();
    const identity = { executionId, workflowVersionId, status: value.status };
    if (value.status !== 'available') {
      if (value.result != null || value.resultChecksum != null || value.correctness !== 'unverified') throw resultError();
      return { ...identity, correctness: 'unverified' };
    }
    const report = value.result;
    if (value.contractId !== CONTRACT || value.contractHash !== contractHash || !HEX.test(value.definitionSnapshotHash)
        || !['unverified', 'matches-fixture', 'differs-from-fixture'].includes(value.correctness)
        || !report || Array.isArray(report) || Object.keys(report).sort().join(',') !== fields.join(',')
        || typeof report.snapshotRef !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(report.snapshotRef)) throw resultError();
    for (const key of ['customerCount', 'invoiceCount', 'matchedCount', 'unmatchedCount']) {
      if (!Number.isSafeInteger(report[key]) || report[key] < 0 || report[key] > 128) throw resultError();
    }
    const ids = report.unmatchedInvoiceIds;
    if (!Array.isArray(ids) || ids.length !== report.unmatchedCount || !ids.every(isUUID)
        || new Set(ids.map(id => id.toLowerCase())).size !== ids.length
        || report.matchedCount + ids.length !== report.invoiceCount) throw resultError();
    const result = Object.fromEntries(fields.map(key => [key, report[key]]));
    if (digest(JSON.stringify(result)) !== value.resultChecksum) throw resultError();
    return { ...identity, definitionSnapshotHash: value.definitionSnapshotHash, contractId: CONTRACT, contractHash,
      resultChecksum: value.resultChecksum, correctness: value.correctness, result };
  } catch { throw resultError(); }
}

module.exports = { readProcedureResult, resultError };
