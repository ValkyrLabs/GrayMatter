"use strict";

// Only the owning Cloud operations admit and revalidate graph proof. This adapter
// checks that their bounded responses agree; it never grants endpoint authority.
const { createHash } = require('node:crypto');
const { readHydrationResponse } = require('./public-context-compile.cjs');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const REF = /^[a-z0-9][a-z0-9._:-]{0,127}$/iu;
const HEX = /^[0-9a-f]{64}$/u;
const VERSION_HASH = /^sha256:[0-9a-f]{64}$/u;
const PATH = 'ContentMediaLink.contentData.ContentData';
const RELATION = 'ContentMediaLink.contentData->ContentData';
const FILE_PATH = {
  seed: 'ContentMediaLink', target: 'ContentData', direction: 'OUTBOUND',
  marker: 'graph_query_discovery=omegarag-query-path/v1'
};
const BODY_PATH = {
  seed: 'ContentData', target: 'ContentMediaLink', direction: 'INBOUND',
  marker: 'graph_query_discovery=omegarag-query-body/v1'
};
const CLAIM = 'typed_path_and_endpoint_projection_only';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = () => Object.assign(new Error('The current typed path receipt could not be verified.'), {
  name: 'PublicTypedPathContractError'
});
const argument = message => Object.assign(new Error(message), { name: 'PublicArgumentError' });

function input(args) {
  if (!record(args) || Object.keys(args).some(key => !['query', 'seedSource', 'maxLatencyMs', 'maxCredits'].includes(key))) {
    throw argument('Only query, seedSource, maxLatencyMs and maxCredits are supported.');
  }
  const seedSource = args.seedSource === undefined ? 'media_filename' : args.seedSource;
  if (seedSource !== 'media_filename' && seedSource !== 'content_body') {
    throw argument('seedSource must be media_filename or content_body.');
  }
  if (typeof args.query !== 'string' || !args.query.trim() || args.query.length > 255
      || /[\u0000-\u001f\u007f-\u009f]/u.test(args.query)
      || Buffer.from(args.query, 'utf8').toString('utf8') !== args.query) {
    throw argument('query must be valid Unicode, nonblank, at most 255 UTF-16 units and contain no control characters.');
  }
  const maxLatencyMs = args.maxLatencyMs === undefined ? 10000 : args.maxLatencyMs;
  const maxCredits = args.maxCredits === undefined ? 5 : args.maxCredits;
  if (!Number.isInteger(maxLatencyMs) || maxLatencyMs < 1000 || maxLatencyMs > 30000) {
    throw argument('maxLatencyMs must be an integer between 1000 and 30000.');
  }
  if (typeof maxCredits !== 'number' || !Number.isFinite(maxCredits) || maxCredits < 0 || maxCredits > 100) {
    throw argument('maxCredits must be a finite number between 0 and 100.');
  }
  const planning = { query: args.query.trim(), mode: 'BALANCED', recipe: 'ENTITY_NEIGHBORHOOD', budgets: {
    maxLatencyMs, maxCredits, maxContextTokens: 4000, maxGraphHops: 1, maxProviderCalls: 8, maxCandidates: 8
  } };
  return { planning, selection: seedSource === 'content_body' ? BODY_PATH : FILE_PATH };
}

function planBinding(response, request) {
  const plan = response?.plan;
  const steps = response?.steps;
  // Matches the owning planner's normalizedQuery + RetrievalExecutionTrace.inputHash.
  const queryHash = createHash('sha256').update(request.query.replace(/[ \t\n\v\f\r]+/gu, ' ') + '\n').digest('hex');
  const graphSteps = Array.isArray(steps) ? steps.filter(step => step?.tool === 'graph_expand') : [];
  if (!record(plan) || !REF.test(plan.planId || '') || !UUID.test(plan.id || '')
      || !UUID.test(plan.ownerId || '') || typeof plan.tenantId !== 'string' || !plan.tenantId
      || plan.trashed === true || plan.state !== 'planned' || plan.mode !== 'BALANCED'
      || plan.queryHash !== queryHash || !Number.isFinite(Date.parse(plan.expiresAt))
      || Date.parse(plan.expiresAt) <= Date.now() || plan.maxGraphHops !== 1
      || !Number.isInteger(plan.maxCandidates) || plan.maxCandidates < 2 || plan.maxCandidates > 8
      || !Number.isFinite(plan.maxLatencyMs) || plan.maxLatencyMs <= 0 || plan.maxLatencyMs > request.budgets.maxLatencyMs
      || !Number.isFinite(plan.maxCredits) || plan.maxCredits < 0 || plan.maxCredits > request.budgets.maxCredits
      || graphSteps.length !== 1 || graphSteps[0].state !== 'planned'
      || graphSteps[0].planId !== plan.planId || graphSteps[0].tenantId !== plan.tenantId
      || graphSteps[0].ownerId !== plan.ownerId || graphSteps[0].channel !== 'graph'
      || !Number.isInteger(graphSteps[0].maxResults) || graphSteps[0].maxResults < 1
      || graphSteps[0].maxGraphHops !== 1) throw fail();
  return { planRef: plan.planId, ownerId: plan.ownerId, tenantId: plan.tenantId, query: request.query };
}

function entity(value, schema) {
  if (!record(value) || value.schemaName !== schema || !UUID.test(value.entityId || '')
      || value.trashed === true) throw fail();
  return schema + ':' + value.entityId.toLowerCase();
}

function receiptBinding(receipt, expected, selection, transportRedaction = false) {
  const notes = receipt?.policy?.policyNotes;
  const scopes = Array.isArray(notes) ? notes.filter(note => typeof note === 'string' && note.startsWith('graph_evidence_claim_scope=')) : [];
  const counts = Array.isArray(notes) ? notes.filter(note => typeof note === 'string' && note.startsWith('generated_graph_proof_items=')) : [];
  if (!record(receipt) || !UUID.test(receipt.id || '') || !REF.test(receipt.receiptId || '')
      || receipt.trashed === true || receipt.ownerId !== expected.ownerId || receipt.tenantId !== expected.tenantId
      || receipt.planRef !== expected.planRef || typeof receipt.query !== 'string' || receipt.query.trim() !== expected.query
      || receipt.answerPolicy !== 'ALLOW_WITH_CAVEAT' || receipt.recommendedAction !== 'ANSWER_WITH_CAVEAT'
      || !['OK', 'PARTIAL_COVERAGE'].includes(receipt.retrievalStatus)
      || receipt.policy?.rbacDecision !== 'ALLOW' || receipt.policy?.tenantScopeVerified !== true
      || scopes.length !== 1 || scopes[0] !== 'graph_evidence_claim_scope=' + CLAIM
      || counts.length !== 1 || counts[0] !== 'generated_graph_proof_items=1'
      || !Array.isArray(receipt.items) || receipt.items.length !== 1) throw fail();
  const item = receipt.items[0];
  const paths = item?.graphPathCitations;
  if (!record(item) || item.trashed === true || typeof item.redacted !== 'boolean'
      || item.redacted && !transportRedaction || item.rank !== 1
      || String(item.sourceType || '').split('|retrieval:', 1)[0] !== 'thorapi-generated-graph/v2'
      || item.entityType !== selection.target || !UUID.test(item.entityId || '') || !HEX.test(item.textHash || '')
      || typeof item.fieldName !== 'string' || !item.fieldName || item.fieldName.length > 4096
      || !HEX.test(item.evidenceDescriptorHash || '') || !Array.isArray(paths) || paths.length !== 1) throw fail();
  const path = paths[0];
  if (!record(path) || path.trashed === true || path.queryMode !== 'PATH' || path.hopCount !== 1
      || path.graphAbiVersion !== 'thorapi-object-graph/v1'
      || path.relationshipNormalizationVersion !== 'thorapi-generated-relationship-normalization/v1'
      || !VERSION_HASH.test(path.graphSchemaVersion || '') || !VERSION_HASH.test(path.graphPolicyVersion || '')
      || !HEX.test(path.pathHash || '') || !REF.test(path.citationId || '')
      || !Array.isArray(path.nodes) || path.nodes.length !== 2
      || !Array.isArray(path.edges) || path.edges.length !== 1) throw fail();
  const seed = entity(path.seed, selection.seed);
  const target = entity(path.target, selection.target);
  const edge = path.edges[0];
  if (entity(path.nodes[0], selection.seed) !== seed || entity(path.nodes[1], selection.target) !== target
      || !record(edge) || edge.trashed === true || edge.canonicalPath !== PATH || edge.relationshipId !== RELATION
      || edge.direction !== selection.direction || entity(edge.source, selection.seed) !== seed
      || entity(edge.target, selection.target) !== target || target !== selection.target + ':' + item.entityId.toLowerCase()
      || path.exactPath !== seed + ' -[' + selection.direction + ' ' + RELATION + ']-> ' + target) throw fail();
  // Business/proof fields only; generated audit timestamps and secure-text omission
  // legitimately differ between tool POST and current owning receipt GET.
  return JSON.stringify([receipt.id, receipt.receiptId, expected, receipt.answerPolicy, receipt.recommendedAction,
    receipt.retrievalStatus, item.id, item.sourceType, item.entityType, item.entityId, item.rank, item.textHash,
    item.fieldName, item.evidenceDescriptorHash, path.citationId, path.pathHash, path.exactPath,
    path.graphAbiVersion, path.relationshipNormalizationVersion, path.graphSchemaVersion, path.graphPolicyVersion,
    seed, target, edge.relationshipId, edge.canonicalPath, edge.direction]);
}

async function discover(request, args) {
  const { planning, selection } = input(args);
  const expected = planBinding(await request('POST', 'graymatter/omega/plan', planning), planning);
  const result = await request('POST', 'graymatter/omega/tools/graph-expand', {
    planId: expected.planRef, query: planning.query, queryMode: 'PATH', discoverPathFromQuery: true,
    objectTypes: [selection.seed], graphPaths: [PATH], direction: selection.direction,
    maxHops: 1, maxNodes: 2, maxEdges: 1, maxResults: 1
  });
  const flags = result?.policyFlags;
  const discovery = Array.isArray(flags) ? flags.filter(flag => typeof flag === 'string' && flag.startsWith('graph_query_discovery=')) : [];
  if (!record(result) || result.retrievalReceipt != null || result.tool !== 'GRAPH_EXPAND'
      || result.planRef !== expected.planRef || result.receiptRef !== result.receipt?.receiptId
      || result.status !== result.receipt?.retrievalStatus || discovery.length !== 1 || discovery[0] !== selection.marker
      || !flags.includes('raw_receipt_text_redacted_from_tool_response')) throw fail();
  // The owning tool intentionally redacts its transport receipt after assembly.
  // Only the separately authorized current GET may establish nonredacted evidence.
  const initial = receiptBinding(result.receipt, expected, selection, true);
  const readback = await request('GET', 'graymatter-retrieval-receipts/' + encodeURIComponent(result.receiptRef));
  if (!record(readback) || readback.retrievalReceipt != null
      || receiptBinding(readback.receipt, expected, selection) !== initial) throw fail();
  return {
    status: 'current_typed_path_receipt', query: planning.query, retrievalReceiptRef: readback.receipt.receiptId,
    evidenceClaimScope: CLAIM,
    graymatterPolicy: {
      answerPolicy: 'ALLOW_WITH_CAVEAT', retrievalStatus: readback.receipt.retrievalStatus,
      recommendedAction: 'ANSWER_WITH_CAVEAT', answerAllowed: false, caveatRequired: true
    },
    typedPathEndpoints: { count: 2, projection: 'not_returned', requiresOwningCompileAndHydration: true }
  };
}

async function readResponse(response, url) {
  try { return await readHydrationResponse(response, url); }
  catch (error) { if (error?.name === 'PublicContextContractError') throw fail(); throw error; }
}

module.exports = { discover, readResponse };
