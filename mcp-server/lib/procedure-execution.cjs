'use strict';

const CONTRACT_VERSION = 'graymatter-procedure-execution/v1';
const MAX_REQUEST_BYTES = 64 * 1024;
const TASK_TYPES = new Set(['app_generation', 'context_compile', 'context_hydration', 'context_recompression',
  'procedure', 'workflow', 'model_call', 'validation', 'billing', 'swarm_command', 'other']);
const ROUTES = new Set(['use_cached_context', 'hydrate_context', 'recompress_context', 'run_procedure',
  'run_thorapi_generation', 'run_workflow', 'call_local_model', 'call_hosted_cheap_model',
  'call_hosted_premium_model', 'ask_human_approval', 'stop_insufficient_credits', 'stop_policy_denied']);
const BLOCKED_ROUTES = new Set(['ask_human_approval', 'stop_insufficient_credits', 'stop_policy_denied']);
const STATES = new Set(['PENDING', 'RUNNING', 'PAUSED', 'WAITING_FOR_USER', 'WAITING_FOR_APPROVAL',
  'WAITING_UNTIL', 'QUARANTINED', 'SUCCESS', 'FAILED', 'CANCELLED', 'TIMEOUT']);
const TERMINAL_STATES = new Set(['SUCCESS', 'FAILED', 'CANCELLED', 'TIMEOUT']);
const REQUEST_KEYS = new Set(['taskType', 'traceId', 'inputs', 'applicationId', 'projectId', 'contextPageId', 'procedureHints']);
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const REFERENCE = /^[a-z0-9][a-z0-9._:/-]{0,127}$/iu;

function clientError(code) {
  const messages = {
    INVALID_INPUT: 'Provide a bounded plain JSON task with taskType, a stable traceId, and business inputs; identity and policy overrides are not accepted.',
    DISPATCH_OUTCOME_UNKNOWN: 'The dispatch outcome could not be verified. Inspect any known execution; retry only with the original traceId and unchanged task inputs. No agent fallback was launched.',
    EXECUTION_STATUS_UNAVAILABLE: 'The exact execution status could not be verified. Check authentication, access and the execution ID; no outcome was inferred.'
  };
  return Object.assign(new Error(messages[code]), { code });
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

// Detach data before transport. Reject accessors rather than invoking user code
// during validation, and enforce size/depth/work limits before serialization.
function plainRequest(value) {
  let nodes = 0;
  let bytes = 0;
  const ancestors = new Set();
  function addBytes(count) {
    bytes += count;
    if (bytes > MAX_REQUEST_BYTES) throw clientError('INVALID_INPUT');
  }
  function copy(item, depth) {
    if (++nodes > 10000 || depth > 16) throw clientError('INVALID_INPUT');
    if (item === null || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))
        || (typeof item === 'string' && Buffer.byteLength(item) <= MAX_REQUEST_BYTES)) {
      addBytes(Buffer.byteLength(JSON.stringify(item)));
      return item;
    }
    if (typeof item !== 'object' || (!Array.isArray(item) && !isObject(item)) || ancestors.has(item)) {
      throw clientError('INVALID_INPUT');
    }
    ancestors.add(item);
    // Bound the property inventory before allocating descriptors for every key.
    const ownKeys = Reflect.ownKeys(item);
    if (ownKeys.length > 10001 || ownKeys.some(key => typeof key !== 'string')) throw clientError('INVALID_INPUT');
    const descriptors = Object.getOwnPropertyDescriptors(item);
    const array = Array.isArray(item);
    if (array && (item.length > 10000 || Object.keys(descriptors).length !== item.length + 1)) {
      throw clientError('INVALID_INPUT');
    }
    addBytes(2); // Container delimiters.
    const result = array ? [] : {};
    let fields = 0;
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (array && key === 'length') continue;
      if (UNSAFE_KEYS.has(key) || key.length > 256 || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')
          || (array && (!/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= item.length))) {
        throw clientError('INVALID_INPUT');
      }
      if (fields++) addBytes(1);
      if (!array) addBytes(Buffer.byteLength(JSON.stringify(key)) + 1);
      result[key] = copy(descriptor.value, depth + 1);
    }
    ancestors.delete(item);
    return result;
  }
  const detached = copy(value, 0);
  if (Buffer.byteLength(JSON.stringify(detached)) > MAX_REQUEST_BYTES) throw clientError('INVALID_INPUT');
  return detached;
}

function prepareProcedureRequest(args) {
  const value = plainRequest(args);
  if (!isObject(value) || Object.keys(value).some(key => !REQUEST_KEYS.has(key))
      || !TASK_TYPES.has(value.taskType) || typeof value.traceId !== 'string' || !REFERENCE.test(value.traceId)
      || !isObject(value.inputs)) throw clientError('INVALID_INPUT');
  if (Object.keys(value.inputs).some(key => /^_skillOpt/iu.test(key) || key === '_workflowExecutionRef')) {
    throw clientError('INVALID_INPUT');
  }
  const routeRequest = { taskType: value.taskType, traceId: value.traceId };
  for (const [field, target] of [['applicationId', 'application'], ['projectId', 'project'], ['contextPageId', 'contextPage']]) {
    if (Object.hasOwn(value, field)) {
      if (typeof value[field] !== 'string' || !UUID.test(value[field])) throw clientError('INVALID_INPUT');
      routeRequest[target] = { id: value[field] };
    }
  }
  if (Object.hasOwn(value, 'procedureHints')) {
    if (!Array.isArray(value.procedureHints) || value.procedureHints.length > 25
        || value.procedureHints.some(hint => typeof hint !== 'string' || !REFERENCE.test(hint))) {
      throw clientError('INVALID_INPUT');
    }
    routeRequest.procedureHints = value.procedureHints;
  }
  return { routeRequest, inputs: value.inputs };
}

function workflowProjection(value, expectedId, expectedVersionId) {
  if (!isObject(value) || typeof value.id !== 'string' || !UUID.test(value.id) || !STATES.has(value.state)
      || (value.workflowVersionId != null && (typeof value.workflowVersionId !== 'string' || !UUID.test(value.workflowVersionId)
        || (expectedVersionId && value.workflowVersionId.toLowerCase() !== expectedVersionId.toLowerCase())))
      || (expectedId && value.id.toLowerCase() !== expectedId.toLowerCase())) throw new Error('Invalid execution contract');
  return { id: value.id, state: value.state, terminal: TERMINAL_STATES.has(value.state), succeeded: value.state === 'SUCCESS',
    ...(typeof value.workflowId === 'string' && UUID.test(value.workflowId) ? { workflowId: value.workflowId } : {}),
    ...(typeof value.workflowVersionId === 'string' && UUID.test(value.workflowVersionId) ? { workflowVersionId: value.workflowVersionId } : {}) };
}

function projectDispatch(response, traceId) {
  const status = response?.status;
  const route = response?.route;
  if (!isObject(response) || !['procedure_started', 'fallback_required', 'blocked'].includes(status)
      || response.deterministicAttempted !== true || response.agentExecutionPerformed !== false
      || !isObject(route) || !ROUTES.has(route.recommendedRoute)
      || typeof route.receipt?.receiptRef !== 'string' || !REFERENCE.test(route.receipt.receiptRef)
      || (response.fallbackRoute != null && !ROUTES.has(response.fallbackRoute))) throw new Error('Invalid dispatch contract');
  let workflow = null;
  if (status === 'procedure_started') {
    if (route.recommendedRoute !== 'run_procedure' || typeof response.procedureRef !== 'string'
        || !REFERENCE.test(response.procedureRef) || typeof response.workflowVersionId !== 'string'
        || !UUID.test(response.workflowVersionId)) throw new Error('Invalid started contract');
    workflow = workflowProjection(response.workflowExecution, undefined, response.workflowVersionId);
  } else if (response.workflowExecution != null || response.workflowVersionId != null || response.procedureRef != null
      || (status === 'blocked') !== BLOCKED_ROUTES.has(route.recommendedRoute)
      || (status === 'blocked' && response.fallbackRoute !== route.recommendedRoute)) {
    throw new Error('Inconsistent fallback contract');
  }
  return {
    contractVersion: CONTRACT_VERSION, operation: 'execute', traceId, status,
    procedureRef: response.procedureRef ?? null, workflowVersionId: response.workflowVersionId ?? null, workflow,
    recommendedRoute: route.recommendedRoute, fallbackRoute: response.fallbackRoute ?? null,
    routeReceiptRef: route.receipt.receiptRef, deterministicAttempted: true, agentExecutionPerformed: false
  };
}

async function executeProcedure(request, args) {
  const payload = prepareProcedureRequest(args);
  try {
    // No client retry, deferred queue, fallback dispatch or status polling here.
    return projectDispatch(await request('POST', '/skillopt_ops/execute', payload), payload.routeRequest.traceId);
  } catch {
    // A timeout or malformed reply cannot prove that the server did not start.
    throw clientError('DISPATCH_OUTCOME_UNKNOWN');
  }
}

async function readProcedureExecution(request, executionId) {
  if (typeof executionId !== 'string' || !UUID.test(executionId)) throw clientError('INVALID_INPUT');
  try {
    const workflow = workflowProjection(await request('GET', `/WorkflowExecution/${executionId}`), executionId);
    return { contractVersion: CONTRACT_VERSION, operation: 'status', workflow };
  } catch {
    throw clientError('EXECUTION_STATUS_UNAVAILABLE');
  }
}

module.exports = { executeProcedure, readProcedureExecution, prepareProcedureRequest, clientError, MAX_REQUEST_BYTES, plainRequest };
