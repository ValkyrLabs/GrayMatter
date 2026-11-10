'use strict';
const { plainRequest, workflowProjection, MAX_REQUEST_BYTES } = require('./procedure-execution.cjs');
const { readProcedureResult } = require('./procedure-result.cjs');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATH_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const REF = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const BIFROST_VERSION = 'omegarag-bifrost-receipt/v1';
const READ = Object.freeze({ readStatus: true, expectedStatus: 200, timeoutMs: 15000 });
const RESULT_CONTRACT = 'invoice-customer-reconciliation/v1';

function evidenceError(code) {
  const message = code === 'INVALID_EVIDENCE_INPUT'
    ? 'Provide the execution UUID. If supplying evidence references, provide both routeReceiptId and trajectoryId.'
    : 'The authorized record links could not be checked. Verify access and references.';
  return Object.assign(new Error(message), { code });
}

function object(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error('Invalid record');
  return value;
}

function identifiers(input) {
  try {
    const value = object(plainRequest(input));
    const exact = Object.hasOwn(value, 'routeReceiptId') || Object.hasOwn(value, 'trajectoryId');
    if (Object.keys(value).some(k => !['executionId','routeReceiptId','trajectoryId','expectedResult'].includes(k)) || !valid(value.executionId, UUID)
        || (exact && (!valid(value.routeReceiptId, UUID) || !valid(value.trajectoryId, PATH_ID)))) throw Error();
    let expectedResult;
    if (Object.hasOwn(value, 'expectedResult')) {
      const pin = object(value.expectedResult);
      if (Object.keys(pin).length !== 4 || pin.contractId !== RESULT_CONTRACT || !valid(pin.workflowVersionId, UUID)
          || !valid(pin.definitionSnapshotHash, HASH) || !valid(pin.resultChecksum, HASH)) throw Error();
      expectedResult = { ...pin, workflowVersionId: pin.workflowVersionId.toLowerCase() };
    }
    return { executionId: value.executionId.toLowerCase(), routeReceiptId: exact ? value.routeReceiptId.toLowerCase() : null,
      trajectoryId: exact ? value.trajectoryId : null, expectedResult };
  } catch { throw evidenceError('INVALID_EVIDENCE_INPUT'); }
}

function valid(value, pattern) {
  return typeof value === 'string' && pattern.test(value);
}

// A missing legacy field reduces coverage. Any two *present* commitments that
// disagree invalidate the report, even when a third member of that join is absent.
function compare(missing, name, pattern, ...values) {
  const supplied = values.filter(value => value != null);
  if (supplied.some(value => !valid(value, pattern))) throw Error('Invalid evidence field');
  const normalized = pattern === UUID ? supplied.map(value => value.toLowerCase()) : supplied;
  if (new Set(normalized).size > 1) throw Error('Contradictory evidence');
  if (supplied.length !== values.length) missing.add(name);
}

function triggerFields(execution, missing) {
  const raw = execution.triggerPayload;
  if (raw == null || raw === '') return {};
  if (typeof raw !== 'string') throw Error('Invalid workflow input record');
  if (Buffer.byteLength(raw) > MAX_REQUEST_BYTES) {
    missing.add('trigger_projection_limit');
    return {};
  }
  // Only the named runtime markers below enter comparisons. The trigger also
  // contains business inputs, which must never enter output, logs, or errors.
  return object(JSON.parse(raw));
}

function procedureLinks(missing, execution, route) {
  const trigger = triggerFields(execution, missing);
  const procedure = object(route.procedure ?? {});
  for (const flag of ['_skillOptMechanizedProcedure', '_workflowVersionBoundProcedure']) {
    if (trigger[flag] == null) missing.add('procedure_trigger');
    else if (trigger[flag] !== true) throw Error('Contradictory workflow markers');
  }
  if (route.recommendedRoute == null) missing.add('procedure_route');
  else if (route.recommendedRoute !== 'run_procedure') throw Error('Contradictory route');
  compare(missing, 'route_reference', REF, route.receiptRef, trigger._skillOptRouteReceiptRef);
  compare(missing, 'procedure_reference', REF, procedure.procedureRef, trigger._skillOptProcedureRef);
  compare(missing, 'mechanization_receipt', REF, procedure.mechanizationReceiptRef, trigger._skillOptMechanizationReceiptRef);
  compare(missing, 'workflow_identity', UUID, execution.workflowId, procedure.workflowId);
  compare(missing, 'workflow_version', UUID, execution.workflowVersionId, procedure.workflowVersionId, trigger._workflowVersionId);
  compare(missing, 'workflow_snapshot', HASH, execution.definitionSnapshotHash, procedure.workflowContentHash, trigger._workflowDefinitionSnapshotHash);
}

function retrievalLinks(missing, route, envelope, trajectoryId, requireReceipt = false) {
  const trajectory = object(envelope.trajectory);
  if (trajectory.trajectoryId !== trajectoryId) throw Error('Wrong trajectory');
  const page = object(route.contextPage ?? {});
  compare(missing, 'route_context_page', REF, page.pageRef, trajectory.contextPageRef);

  // Generated responses can omit the nested association. When exposed, its
  // domain receiptId (distinct from its generated id) binds this page to the retrieval.
  const pageReceipt = object(page.retrievalReceipt ?? {});
  if (requireReceipt || pageReceipt.trajectoryRef != null) compare(missing, 'receipt_trajectory', PATH_ID, pageReceipt.trajectoryRef, trajectoryId);
  const chain = object(envelope.bifrostReceiptChain ?? {});
  const knownChain = chain.version === BIFROST_VERSION;
  // The runtime copies these commitments from the retrieval receipt to the
  // trajectory. Check every copy that is exposed, even on older envelopes.
  for (const [label, pattern, receiptField, trajectoryField, chainField] of [
    ['retrieval_receipt', REF, 'receiptId', 'receiptRef', 'retrievalReceiptRef'],
    ['receipt_binding', HASH, 'bindingHash', 'receiptBindingHash', 'receiptBindingHash'],
    ['provider_route', HASH, 'providerRouteHash', 'providerRouteHash', 'providerRouteHash'],
    ['plan', REF, 'planRef', 'planRef', 'planRef'],
    ['retrieval_trace', /^[^\r\n]{1,128}$/, 'traceId', 'traceId', 'traceId'],
    ['policy_version', /^[^\r\n]{1,256}$/, 'policyVersion', 'policyVersion', 'policyVersion']
  ]) {
    const values = [trajectory[trajectoryField]];
    if (knownChain) values.push(chain[chainField]);
    if (requireReceipt || pageReceipt[receiptField] != null) values.push(pageReceipt[receiptField]);
    compare(missing, label, pattern, ...values);
  }
  if (!knownChain) {
    missing.add('supported_bifrost_chain');
    return null;
  }
  if (chain.complete != null && typeof chain.complete !== 'boolean') throw Error('Malformed completeness');
  if (chain.missingLinks != null && (!Array.isArray(chain.missingLinks) || chain.missingLinks.length > 32
      || chain.missingLinks.some(link => typeof link !== 'string' || link.length > 128))) throw Error('Malformed coverage');
  if (chain.complete === true && chain.missingLinks?.length > 0) throw Error('Contradictory coverage');
  if (chain.complete !== true || !chain.missingLinks) missing.add('complete_bifrost_chain');

  compare(missing, 'bifrost_trajectory', PATH_ID, chain.trajectoryRef, trajectoryId);
  if (chain.chainRef == null) missing.add('bifrost_identity');
  else if (chain.chainRef !== 'bifrost:' + trajectoryId) throw Error('Wrong Bifrost chain');
  compare(missing, 'bifrost_commitment', HASH, chain.chainHash);
  compare(missing, 'bifrost_context_page', REF, page.pageRef, trajectory.contextPageRef, chain.contextPageRef);
  compare(missing, 'retrieval_policy', /^[^\r\n]{1,4000}$/, trajectory.policyDecision, chain.answerPolicyDecision);
  return chain.chainHash ?? null;
}

async function resolveRoute(request, stableRef) {
  if (!valid(stableRef, REF)) throw Error('Invalid recorded route');
  const query = '&size=1&example=' + encodeURIComponent(JSON.stringify({ receiptRef: stableRef }));
  const page = async n => {
    const rows = await request('GET', '/SkillOptRouteReceipt?page=' + n + query, undefined, READ);
    if (!Array.isArray(rows) || rows.length > 1) throw Error('Unexpected receipt list');
    if (rows.length && (!valid(rows[0]?.id, UUID) || rows[0].receiptRef !== stableRef)) throw Error('Nonexact route lookup');
    return rows;
  };
  const first = await page(0);
  if (!first.length) return null;
  if ((await page(1)).length) throw Error('Ambiguous route reference');
  return first[0].id.toLowerCase();
}

// Compare every exposed copy before following a locator. These are record links,
// not caller-supplied authority; each owning GET still authorizes the signed-in user.
function commitments(records, fields) {
  const result = {};
  for (const [key, pattern] of fields) {
    const values = records.map(record => record[key]).filter(value => value != null);
    if (!values.length) continue;
    compare(new Set(), key, pattern, ...values);
    result[key] = pattern === UUID ? values[0].toLowerCase() : values[0];
  }
  return result;
}

const PAGE_FIELDS = [['id', UUID], ['pageRef', REF], ['ownerId', UUID], ['tenantId', /^[^\r\n]{1,128}$/]];
const RECEIPT_FIELDS = [['id', UUID], ['receiptId', REF], ['trajectoryRef', PATH_ID],
  ['bindingHash', HASH], ['providerRouteHash', HASH], ['planRef', REF],
  ['traceId', /^[^\r\n]{1,128}$/], ['policyVersion', /^[^\r\n]{1,256}$/],
  ['ownerId', UUID], ['tenantId', /^[^\r\n]{1,128}$/]];

async function resolvePage(request, route, owningRoute) {
  if (route.contextPage == null) return { route, requireReceipt: false };
  const original = object(route.contextPage);
  const originalPage = commitments([original], PAGE_FIELDS);
  let page = originalPage;
  const receiptCopies = original.retrievalReceipt == null ? [] : [object(original.retrievalReceipt)];
  // Preserve expanded historical responses. Modern route responses expose only
  // an id; never substitute a page discovered by trace or by a broad list search.
  const readPage = owningRoute || (originalPage.id != null && originalPage.pageRef == null);
  if (readPage) {
    if (!originalPage.id) throw Error('Missing page identity');
    const response = object(await request('GET', '/graymatter_ops/context_page/' + originalPage.id, undefined, READ));
    const current = object(response.contextPage);
    if (!valid(current.id, UUID) || current.id.toLowerCase() !== originalPage.id || !valid(current.pageRef, REF)) {
      throw Error('Wrong context page');
    }
    page = commitments([original, current], PAGE_FIELDS);
    const currentCopies = [];
    if (current.retrievalReceipt != null) currentCopies.push(object(current.retrievalReceipt));
    if (response.retrievalReceipt != null) currentCopies.push(object(response.retrievalReceipt));
    const currentIdentity = commitments(currentCopies, RECEIPT_FIELDS);
    if (!currentIdentity.id && !currentIdentity.receiptId) throw Error('Missing current page receipt link');
    receiptCopies.push(...currentCopies);
  }
  let receipt = commitments(receiptCopies, RECEIPT_FIELDS);
  const readReceipt = readPage || (receipt.id != null && receipt.receiptId == null);
  if (readReceipt) {
    const ref = receipt.receiptId ?? receipt.id;
    if (ref == null) throw Error('Missing retrieval receipt identity');
    const response = object(await request('GET', '/graymatter-retrieval-receipts/' + encodeURIComponent(ref), undefined, READ));
    const current = object(response.receipt);
    if (!valid(current.receiptId, REF) || !valid(current.id, UUID)) throw Error('Missing current receipt identity');
    commitments([...receiptCopies, current], RECEIPT_FIELDS);
    // Do not fill a missing current proof field from a historical nested copy.
    receipt = commitments([current], RECEIPT_FIELDS);
  }
  return { route: { ...route, contextPage: { ...page, retrievalReceipt: receipt } }, requireReceipt: readReceipt };
}

async function verifyProcedureEvidence(request, input) {
  const ids = identifiers(input);
  const { executionId, expectedResult } = ids;
  let { routeReceiptId, trajectoryId } = ids;
  try {
    const execution = object(await request('GET', '/WorkflowExecution/' + executionId, undefined, READ));
    const workflow = workflowProjection(execution, executionId);
    if (execution.testMode != null && typeof execution.testMode !== 'boolean') throw Error('Invalid test flag');
    workflow.testMode = execution.testMode ?? null;

    const missing = new Set();
    const trigger = triggerFields(execution, missing);
    if (execution.ownerId != null && !valid(execution.ownerId, UUID)) throw Error('Invalid execution owner');
    const owningRoute = execution.ownerId != null && trigger._skillOptMechanizedProcedure === true
      && trigger._workflowVersionBoundProcedure === true && trigger._skillOptRouteReceiptRef != null;
    let route;
    if (owningRoute) {
      if (!valid(trigger._skillOptRouteReceiptRef, REF)) throw Error('Invalid recorded route');
      route = object(await request('GET', '/skillopt_ops/' + execution.ownerId.toLowerCase()
        + '/route_receipts/' + encodeURIComponent(trigger._skillOptRouteReceiptRef), undefined, READ));
      if (!valid(route.id, UUID) || !valid(route.ownerId, UUID)
          || route.ownerId.toLowerCase() !== execution.ownerId.toLowerCase()
          || route.receiptRef !== trigger._skillOptRouteReceiptRef
          || (routeReceiptId != null && route.id.toLowerCase() !== routeReceiptId)) throw Error('Wrong owned route');
      routeReceiptId = route.id.toLowerCase();
    } else {
      if (!routeReceiptId) {
        if (trigger._skillOptMechanizedProcedure === true && trigger._workflowVersionBoundProcedure === true
            && trigger._skillOptRouteReceiptRef != null) routeReceiptId = await resolveRoute(request, trigger._skillOptRouteReceiptRef);
      }
      route = routeReceiptId ? object(await request('GET', '/SkillOptRouteReceipt/' + routeReceiptId, undefined, READ)) : {};
    }
    if (routeReceiptId && (!valid(route.id, UUID) || route.id.toLowerCase() !== routeReceiptId)) throw Error('Wrong route receipt');
    if (!routeReceiptId) missing.add('route_receipt_id');
    procedureLinks(missing, execution, route);
    const resolved = await resolvePage(request, route, owningRoute);
    route = resolved.route;
    const recordedTrajectory = route.contextPage?.retrievalReceipt?.trajectoryRef;
    if (trajectoryId && recordedTrajectory != null) {
      compare(missing, 'receipt_trajectory', PATH_ID, recordedTrajectory, trajectoryId);
    }
    if (!trajectoryId) {
      const ref = recordedTrajectory;
      if (ref != null && !valid(ref, PATH_ID)) throw Error('Invalid recorded trajectory');
      trajectoryId = ref ?? null;
    }
    let chainHash = null;
    if (trajectoryId) {
      const envelope = object(await request('GET', '/graymatter/omega/trajectories/' + encodeURIComponent(trajectoryId), undefined, READ));
      chainHash = retrievalLinks(missing, route, envelope, trajectoryId, resolved.requireReceipt);
    } else missing.add('trajectory_reference');
    const report = { contractVersion: 'graymatter-procedure-evidence/v1', operation: 'evidence',
      status: missing.size ? 'incomplete' : 'linked', workflow, routeReceiptId, trajectoryId,
      bifrostChainHash: chainHash, missingEvidence: [...missing],
      executionOrigin: 'unattested', businessOutcome: 'unverified' };
    if (expectedResult) {
      // An independently prepared expectation must refer to this exact workflow
      // version and snapshot. Do not consult a different execution or version.
      if ((execution.workflowVersionId != null && execution.workflowVersionId.toLowerCase() !== expectedResult.workflowVersionId)
          || (execution.definitionSnapshotHash != null && execution.definitionSnapshotHash !== expectedResult.definitionSnapshotHash))
        throw Error('Wrong pinned version');
      if (missing.size || !workflow.succeeded) {
        report.resultVerification = { status: 'not_checked', reason: missing.size ? 'incomplete_links' : 'execution_not_successful' };
      } else {
        const result = await readProcedureResult((method, path) => request(method, path, undefined, READ),
          executionId, expectedResult.workflowVersionId);
        if (result.status === 'unavailable') {
          report.resultVerification = { status: 'not_checked', reason: 'result_unavailable' };
        } else {
          if (result.status !== 'available' || result.contractId !== expectedResult.contractId
              || result.definitionSnapshotHash !== expectedResult.definitionSnapshotHash
              || (result.correctness !== 'unverified' && workflow.testMode !== true)) throw Error('Inconsistent result');
          report.resultVerification = { status: result.resultChecksum === expectedResult.resultChecksum
            ? 'matches_expectation' : 'differs_from_expectation', contractId: result.contractId,
            resultChecksum: result.resultChecksum, serverFixtureVerdict: result.correctness };
        }
      }
    }
    return report;
  } catch { throw evidenceError('PROCEDURE_EVIDENCE_UNAVAILABLE'); }
}

module.exports = { verifyProcedureEvidence, evidenceError };
