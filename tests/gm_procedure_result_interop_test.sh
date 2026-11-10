#!/usr/bin/env bash
set -euo pipefail
# Optional private-backend interoperability check; public CI has no ValkyrAI
# checkout or compiled test classpath. An explicit invocation still fails closed.
if [[ $# -eq 0 ]]; then
  echo 'gm_procedure_result_interop_test: SKIP (pass a compiled ValkyrAI test classpath file to run this optional check)'
  exit 0
fi
[[ $# -eq 1 && -r "$1" ]] || { echo 'Usage: gm_procedure_result_interop_test.sh /path/to/valkyrai-test-classpath.txt' >&2; exit 2; }
root="$(cd "$(dirname "$0")/.." && pwd)"
backend="$(cd "${VALKYRAI_BACKEND:-$root/../ValkyrAI/valkyrai}" && pwd)"
dep_cp="$(cat "${1:?Pass the compiled ValkyrAI test classpath file}")"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"
IFS=: read -r -a deps <<< "$dep_cp"
mock_agent=''
for file in "${deps[@]}"; do
  case "$file" in */mockito-core-*.jar) mock_agent="$file"; break;; esac
done
[[ -f "$mock_agent" ]] || { echo "Mockito agent missing from ValkyrAI test classpath" >&2; exit 1; }
cp_sources="$backend/src/main/java/com/valkyrlabs/workflow"
cp_runtime="$work:$backend/src/main/resources:$backend/target/classes:$backend/target/test-classes:$dep_cp"
javac --release 21 -proc:none -cp "$cp_runtime" -d "$work" \
  "$cp_sources/modules/operations/InvoiceReferenceSnapshot.java" \
  "$cp_sources/modules/operations/InvoiceReferenceReportModule.java" \
  "$cp_sources/service/WorkflowBusinessResultService.java" \
  "$root/tests/GrayMatterProcedureResultInterop.java"
java -javaagent:"$mock_agent" -cp "$cp_runtime" GrayMatterProcedureResultInterop "$work/result.json"
node - "$root" "$work/result.json" <<'JS'
const { readProcedureResult } = require(process.argv[2] + '/mcp-server/lib/procedure-result.cjs');
const { verifyProcedureEvidence } = require(process.argv[2] + '/mcp-server/lib/procedure-evidence.cjs');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const f = JSON.parse(require('node:fs').readFileSync(process.argv[3]));
(async () => {
  const read = await readProcedureResult(async (method, path) => {
    assert.equal(method, 'GET');
    assert.equal(path, '/vaiworkflow/engineering/executions/' + f.executionId + '/business-result');
    return f.response;
  }, f.executionId, f.workflowVersionId);
  assert.equal(read.status, 'available');
  assert.equal(read.definitionSnapshotHash, f.definitionSnapshotHash);
  assert.deepEqual(read.result, f.expected);
  assert.equal(read.result.matchedCount, 1);
  assert.deepEqual(read.result.unmatchedInvoiceIds, ['00000000-0000-0002-0000-000000000002']);
  const ordered = Object.fromEntries(Object.entries(f.expected).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const oracle = createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
  assert.equal(read.resultChecksum, oracle);
  // The result is native ValkyrAI output. The other three hosted read boundaries
  // use fixture records here (no staging dispatch or credentials required).
  const routeId = '00000000-0000-0003-0000-000000000004', trace = 'interop';
  const trigger = { _skillOptMechanizedProcedure: true, _workflowVersionBoundProcedure: true,
    _skillOptRouteReceiptRef: 'route:1', _skillOptProcedureRef: 'procedure:1', _skillOptMechanizationReceiptRef: 'mechanize:1',
    _workflowVersionId: f.workflowVersionId, _workflowDefinitionSnapshotHash: f.definitionSnapshotHash };
  const hash = 'b'.repeat(64);
  const trajectory = { trajectoryId: trace, traceId: trace, planRef: 'plan:1', receiptRef: 'rec:1',
    contextPageRef: 'page:1', providerRouteHash: hash, policyVersion: 'p1', receiptBindingHash: hash, policyDecision: 'ALLOW_ANSWER' };
  const records = new Map([
    ['/WorkflowExecution/' + f.executionId, { id: f.executionId, state: 'SUCCESS', testMode: false, workflowId: f.workflowId,
      workflowVersionId: f.workflowVersionId, definitionSnapshotHash: f.definitionSnapshotHash, triggerPayload: JSON.stringify(trigger) }],
    ['/SkillOptRouteReceipt/' + routeId, { id: routeId, recommendedRoute: 'run_procedure', receiptRef: 'route:1',
      procedure: { procedureRef: 'procedure:1', mechanizationReceiptRef: 'mechanize:1', workflowId: f.workflowId,
        workflowVersionId: f.workflowVersionId, workflowContentHash: f.definitionSnapshotHash }, contextPage: { pageRef: 'page:1' } }],
    ['/graymatter/omega/trajectories/' + trace, { trajectory, bifrostReceiptChain: { version: 'omegarag-bifrost-receipt/v1',
      complete: true, missingLinks: [], chainRef: 'bifrost:' + trace, chainHash: hash, trajectoryRef: trace, traceId: trace,
      planRef: 'plan:1', retrievalReceiptRef: 'rec:1', contextPageRef: 'page:1', providerRouteHash: hash, policyVersion: 'p1',
      receiptBindingHash: hash, answerPolicyDecision: 'ALLOW_ANSWER' } }],
    ['/vaiworkflow/engineering/executions/' + f.executionId + '/business-result', f.response]
  ]);
  const result = await verifyProcedureEvidence(async (method, path, body, options) => {
    assert.equal(method, 'GET'); assert.equal(body, undefined); assert.equal(options.expectedStatus, 200);
    assert.ok(records.has(path)); return records.get(path);
  }, { executionId: f.executionId, routeReceiptId: routeId, trajectoryId: trace, expectedResult: {
    workflowVersionId: f.workflowVersionId, definitionSnapshotHash: f.definitionSnapshotHash,
    contractId: 'invoice-customer-reconciliation/v1', resultChecksum: oracle } });
  assert.equal(result.status, 'linked'); assert.equal(result.resultVerification.status, 'matches_expectation');
  assert.equal(result.businessOutcome, 'unverified'); assert.ok(!JSON.stringify(result).includes(read.result.unmatchedInvoiceIds[0]));
  console.log('gm_procedure_result_interop_test: ok');
})().catch(error => { console.error(error); process.exitCode = 1; });
JS
