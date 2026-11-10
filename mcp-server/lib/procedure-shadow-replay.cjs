'use strict';

const { plainRequest } = require('./procedure-execution.cjs');
const REFERENCE = /^[a-z0-9][a-z0-9._:-]{0,127}$/iu;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
const ROUTES = new Set(['use_cached_context', 'hydrate_context', 'recompress_context', 'run_procedure',
  'run_thorapi_generation', 'run_workflow', 'call_local_model', 'call_hosted_cheap_model',
  'call_hosted_premium_model', 'ask_human_approval', 'stop_insufficient_credits', 'stop_policy_denied']);

function shadowReplayError(code) {
  return Object.assign(new Error(code === 'INVALID_SHADOW_REPLAY_INPUT'
    ? 'Provide only candidateRef and baselineCapsuleRef from an authorized frozen holdout.'
    : 'The shadow replay dispatch could not be verified. Inspect any known execution; retry only the same candidate and baseline capsule. No fallback or promotion was requested.'), { code });
}

function prepareShadowReplay(args) {
  try {
    const value = plainRequest(args);
    if (value === null || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).length !== 2
        || !['candidateRef', 'baselineCapsuleRef'].every(key => typeof value[key] === 'string' && REFERENCE.test(value[key]))
        || Object.keys(value).some(key => !['candidateRef', 'baselineCapsuleRef'].includes(key))) throw new Error();
    return value;
  } catch {
    throw shadowReplayError('INVALID_SHADOW_REPLAY_INPUT');
  }
}

function projectShadowReplay(response, input) {
  const value = plainRequest(response);
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || !['accepted', 'not_dispatched'].includes(value.status)
      || value.candidateRef !== input.candidateRef || value.baselineCapsuleRef !== input.baselineCapsuleRef
      || !['experimentRef', 'mechanizationReceiptRef', 'routeReceiptRef'].every(key =>
        typeof value[key] === 'string' && REFERENCE.test(value[key]))
      || !ROUTES.has(value.selectedRoute)) throw new Error('Invalid shadow replay response');
  const accepted = value.status === 'accepted';
  if (accepted ? (value.selectedRoute !== 'run_workflow'
      || !['workflowExecutionId', 'workflowVersionId'].every(key => typeof value[key] === 'string' && UUID.test(value[key]))
      || typeof value.taskDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(value.taskDigest))
    : ['workflowExecutionId', 'workflowVersionId', 'taskDigest'].some(key => value[key] != null)) {
    throw new Error('Inconsistent shadow replay response');
  }
  return {
    contractVersion: 'graymatter-procedure-shadow-replay/v1', operation: 'shadow-replay',
    status: value.status, candidateRef: value.candidateRef, baselineCapsuleRef: value.baselineCapsuleRef,
    experimentRef: value.experimentRef, mechanizationReceiptRef: value.mechanizationReceiptRef,
    routeReceiptRef: value.routeReceiptRef, selectedRoute: value.selectedRoute,
    ...(accepted ? { workflowExecutionId: value.workflowExecutionId.toLowerCase(),
      workflowVersionId: value.workflowVersionId.toLowerCase(), taskDigest: value.taskDigest } : {})
  };
}

async function startShadowReplay(request, args) {
  const input = prepareShadowReplay(args);
  try {
    const response = await request('POST', `/skillopt_ops/candidates/${encodeURIComponent(input.candidateRef)}/replay-executions`,
      { baselineCapsuleRef: input.baselineCapsuleRef },
      { readStatus: true, expectedStatus: 200, timeoutMs: 65000, allowAuthRetry: false });
    return projectShadowReplay(response, input);
  } catch {
    throw shadowReplayError('SHADOW_REPLAY_OUTCOME_UNKNOWN');
  }
}

module.exports = { startShadowReplay, prepareShadowReplay, shadowReplayError };
