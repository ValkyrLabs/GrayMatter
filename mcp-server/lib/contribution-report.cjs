'use strict';

const READ_PURPOSES = ['inspection', 'write_verification', 'reuse'];
const CONTRIBUTION_INPUT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    trajectoryIds: { type: 'array', maxItems: 25, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 128 } },
    observations: { type: 'array', maxItems: 200, items: {
      type: 'object', additionalProperties: false,
      properties: {
        observationId: { type: 'string', minLength: 1, maxLength: 128 },
        memoryId: { type: 'string', minLength: 1, maxLength: 128 },
        purpose: { type: 'string', enum: READ_PURPOSES },
        taskRef: { type: 'string', maxLength: 256 }
      }, required: ['observationId', 'memoryId', 'purpose']
    } }
  }
};

async function contributionReport(thor_fetch, thor_args = {}) {
  const thor_observations = thor_args.observations || [];
  if (!Array.isArray(thor_args.trajectoryIds || [])) throw new Error('trajectoryIds must be an array');
  const thor_ids = [...new Set(thor_args.trajectoryIds || [])];
  if (!Array.isArray(thor_observations) || thor_observations.length > 200 || thor_ids.length > 25) {
    throw new Error('Contribution reports are bounded to 200 observations and 25 trajectories');
  }
  const thor_unique = new Map();
  for (const thor_observation of thor_observations) {
    if (!thor_observation || !READ_PURPOSES.includes(thor_observation.purpose)
        || !boundedRef(thor_observation.observationId, 128) || !boundedRef(thor_observation.memoryId, 128)
        || (thor_observation.taskRef !== undefined && !boundedRef(thor_observation.taskRef, 256))) {
      throw new Error('Each read observation requires a bounded ID, memory ID, and explicit purpose');
    }
    const thor_previous = thor_unique.get(thor_observation.observationId);
    if (thor_previous && (thor_previous.memoryId !== thor_observation.memoryId
        || thor_previous.purpose !== thor_observation.purpose || thor_previous.taskRef !== thor_observation.taskRef)) {
      throw new Error('Conflicting observations reuse the same observationId');
    }
    thor_unique.set(thor_observation.observationId, {
      observationId: thor_observation.observationId, memoryId: thor_observation.memoryId,
      purpose: thor_observation.purpose,
      ...(thor_observation.taskRef === undefined ? {} : { taskRef: thor_observation.taskRef })
    });
  }
  const thor_chains = [];
  for (const thor_id of thor_ids) {
    if (!boundedRef(thor_id, 128)) throw new Error('Invalid trajectory reference');
    // Never accept a caller-provided URL or a caller-supplied trajectory body.
    const thor_response = await thor_fetch(`graymatter/omega/trajectories/${encodeURIComponent(thor_id)}`);
    const thor_trajectory = thor_response?.trajectory;
    if (!thor_trajectory || thor_trajectory.trajectoryId !== thor_id) throw new Error('Invalid authorized trajectory response');
    const thor_refs = [...new Set((thor_response.steps || []).flatMap(thor_step => thor_step.evidenceRefs || []))];
    thor_chains.push({
      trajectoryId: thor_id, receiptRef: thor_trajectory.receiptRef || null,
      contextPageRef: thor_trajectory.contextPageRef || null,
      evidenceRefs: thor_refs,
      decisionOrActionRef: thor_trajectory.actionRef || null,
      artifactOrOutcomeRef: thor_trajectory.outcomeRef || null,
      verificationRef: thor_trajectory.testRef || null,
      workflowExecutionRef: thor_trajectory.workflowExecutionRef || null,
      outcome: thor_trajectory.outcome || null,
      outcomeHash: thor_trajectory.outcomeHash || null,
      outcomeAt: thor_trajectory.outcomeAt || null,
      linked: Boolean(thor_trajectory.receiptRef && thor_refs.length && thor_trajectory.actionRef
        && thor_trajectory.outcomeRef && thor_trajectory.testRef && thor_trajectory.outcomeHash),
      evidenceLevel: 'authorized_stored_references_not_independent_artifact_verification'
    });
  }
  const thor_reads = [...thor_unique.values()];
  const thor_counts = Object.fromEntries(READ_PURPOSES.map(thor_purpose =>
    [thor_purpose, thor_reads.filter(thor_read => thor_read.purpose === thor_purpose).length]));
  return {
    contractVersion: 'graymatter-contribution-report/v1',
    observationBasis: 'explicit_caller_supplied_read_observations',
    scope: 'only_supplied_observations_and_authorized_trajectory_ids',
    observedReadCounts: thor_counts,
    distinctMemoryIds: new Set(thor_reads.map(thor_read => thor_read.memoryId)).size,
    duplicateObservationsRemoved: thor_observations.length - thor_reads.length,
    authorizedTrajectories: thor_chains.length,
    linkedEvidenceChains: thor_chains.filter(thor_chain => thor_chain.linked).length,
    chains: thor_chains, observations: thor_reads,
    measuredImpact: { timeSaved: null, tokensSaved: null, costSaved: null, defectsPrevented: null },
    limitations: [
      'Read purpose is declared by the caller; write verification is never classified as reuse.',
      'A stored outcome or successful test reference is not independent proof of influence or causality.',
      'Missing observations are unknown, not zero activity. This report is not a collection-wide usage counter.',
      'Savings and defect reduction require baseline or matched-control measurements; none are inferred here.'
    ]
  };
}

function boundedRef(thor_value, thor_limit) {
  return typeof thor_value === 'string' && thor_value.length > 0 && thor_value.length <= thor_limit
    && !/[\u0000-\u001f\u007f]/u.test(thor_value);
}

module.exports = { contributionReport, CONTRIBUTION_INPUT_SCHEMA, READ_PURPOSES };
