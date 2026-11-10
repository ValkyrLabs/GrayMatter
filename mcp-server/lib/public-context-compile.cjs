'use strict';

// This adapter accepts locators, never caller-authored receipt bodies or proof.
// Current authority and revision checks belong to the owning Cloud compile operation.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const REF = /^[a-z0-9][a-z0-9._:-]{0,127}$/iu;
const CLAIM = 'typed_path_and_endpoint_projection_only';
const SOURCE = 'thorapi-generated-graph/v2';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function argumentError(message) {
  return Object.assign(new Error(message), { name: 'PublicArgumentError' });
}

function compileOptions(args) {
  const ref = args.retrievalReceiptRef;
  if (ref !== undefined && (typeof ref !== 'string' || !REF.test(ref))) {
    throw argumentError('retrievalReceiptRef must be one existing receipt UUID or business reference.');
  }
  if (args.includeTypedPathEndpoints !== undefined && typeof args.includeTypedPathEndpoints !== 'boolean') {
    throw argumentError('includeTypedPathEndpoints must be a boolean.');
  }
  if (args.includeTypedPathEndpoints === true && ref === undefined) {
    throw argumentError('includeTypedPathEndpoints requires retrievalReceiptRef.');
  }
  return {
    ...(ref === undefined ? {} : { retrievalReceipt: UUID.test(ref) ? { id: ref.toLowerCase() } : { receiptId: ref } }),
    ...(args.includeTypedPathEndpoints === true ? { includeTypedPathEndpoints: true } : {})
  };
}

function unverified() {
  // A 2xx response may follow a committed compilation on an older backend.
  // Report uncertainty without exposing its unverified context or encouraging a retry.
  return Object.assign(new Error('The requested typed endpoint context was not verified.'), {
    name: 'PublicContextContractError'
  });
}

function receiptMatches(receipt, ref) {
  return record(receipt) && (UUID.test(ref)
    ? typeof receipt.id === 'string' && receipt.id.toLowerCase() === ref.toLowerCase()
    : receipt.receiptId === ref);
}

function typedPairProjection(response, args, statuses = ['compiled']) {
  if (args.retrievalReceiptRef === undefined) return null;
  const receipt = response?.retrievalReceipt;
  if (response?.receipt != null || !receiptMatches(receipt, args.retrievalReceiptRef)) throw unverified();
  if (args.includeTypedPathEndpoints !== true) return null;
  const page = response?.contextPage;
  const notes = receipt?.policy?.policyNotes;
  const scopeNotes = Array.isArray(notes) ? notes.filter(note => typeof note === 'string'
    && note.startsWith('graph_evidence_claim_scope=')) : [];
  const countNotes = Array.isArray(notes) ? notes.filter(note => typeof note === 'string'
    && note.startsWith('generated_graph_proof_items=')) : [];
  if (!record(page) || typeof page.pageRef !== 'string' || !REF.test(page.pageRef)
      || !statuses.includes(page.status) || typeof page.policy !== 'string'
      || !/^typed_path_endpoints\/v1=[0-9a-f]{64};/u.test(page.policy)
      || page.taskIntent !== args.task.trim()
      || typeof receipt.query !== 'string' || receipt.query.trim() !== page.taskIntent
      || receipt.answerPolicy !== 'ALLOW_WITH_CAVEAT'
      || !['OK', 'PARTIAL_COVERAGE'].includes(receipt.retrievalStatus)
      || receipt.recommendedAction !== 'ANSWER_WITH_CAVEAT'
      || receipt.policy?.rbacDecision !== 'ALLOW' || receipt.policy?.tenantScopeVerified !== true
      || scopeNotes.length !== 1 || scopeNotes[0] !== 'graph_evidence_claim_scope=' + CLAIM
      || countNotes.length !== 1 || countNotes[0] !== 'generated_graph_proof_items=1'
      || !Array.isArray(receipt.items) || receipt.items.length !== 1
      || receipt.items[0]?.redacted === true
      || String(receipt.items[0]?.sourceType || '').split('|retrieval:', 1)[0] !== SOURCE
      || !Array.isArray(page.items) || page.items.length !== 2
      || !Array.isArray(page.hydrationPointers) || page.hydrationPointers.length !== 2) throw unverified();
  const ids = new Set();
  const refs = new Set();
  for (const item of page.items) {
    if (!record(item) || item.sourceType !== 'generated_domain_record' || item.retained !== true
        || typeof item.sourceId !== 'string' || !/^[a-z][a-z0-9_]*:[0-9a-f-]{36}$/u.test(item.sourceId)
        || !UUID.test(item.sourceId.slice(item.sourceId.indexOf(':') + 1))
        || typeof item.itemRef !== 'string' || !REF.test(item.itemRef)
        || typeof item.summary !== 'string' || !item.summary.trim()
        || ids.has(item.sourceId) || refs.has(item.itemRef)) throw unverified();
    ids.add(item.sourceId);
    refs.add(item.itemRef);
  }
  const pointerIds = new Set();
  for (const pointer of page.hydrationPointers) {
    if (!record(pointer) || pointer.targetType !== 'generated_domain_record'
        || !ids.has(pointer.targetId) || pointerIds.has(pointer.targetId)
        || !/^graph-projection:[0-9a-f]{64}$/u.test(pointer.sourceVersion || '')) throw unverified();
    pointerIds.add(pointer.targetId);
  }
  const target = receipt.items[0];
  if (typeof target.entityType !== 'string' || !UUID.test(target.entityId || '')
      || !ids.has(target.entityType.toLowerCase() + ':' + target.entityId.toLowerCase())
      || !/^[0-9a-f]{64}$/u.test(target.textHash || '')
      || !page.hydrationPointers.some(pointer => pointer.targetId === target.entityType.toLowerCase() + ':' + target.entityId.toLowerCase()
        && pointer.sourceVersion === 'graph-projection:' + target.textHash)) throw unverified();
  return {
    evidenceClaimScope: CLAIM,
    typedPathEndpoints: { count: 2, projection: 'compact_preview', exactProjectionRequiresOwningHydration: true },
    contextPage: {
      pageRef: page.pageRef, status: page.status, taskIntent: page.taskIntent,
      items: page.items.map(item => ({ itemRef: item.itemRef, sourceType: item.sourceType,
        sourceId: item.sourceId, summary: item.summary }))
    }
  };
}

const PAIR_STATES = ['compiled', 'hydrated', 'recompressed', 'forked'];
const MAX_BODY_BYTES = 262144;
const MAX_EXACT_CHARS = 4000;

function hydrationInput(args) {
  if (typeof args.contextPageRef !== 'string' || !REF.test(args.contextPageRef)) {
    throw argumentError('contextPageRef must be an existing page UUID or business reference.');
  }
  const maxTokens = args.maxTokens === undefined ? 4000 : args.maxTokens;
  if (!Number.isInteger(maxTokens) || maxTokens < 256 || maxTokens > 16000) {
    throw argumentError('maxTokens must be an integer between 256 and 16000.');
  }
  return { contextPageRef: args.contextPageRef, maxItems: 2, maxTokens };
}

function hydrationSnapshot(response, ref) {
  const page = response?.contextPage;
  const receipt = response?.retrievalReceipt;
  if (!record(page) || (UUID.test(ref) ? String(page.id || '').toLowerCase() !== ref.toLowerCase() : page.pageRef !== ref)
      || !UUID.test(page.ownerId || '') || receipt?.ownerId !== page.ownerId
      || typeof page.tenantId !== 'string' || !page.tenantId || receipt?.tenantId !== page.tenantId
      || typeof page.taskIntent !== 'string') throw unverified();
  const receiptRef = UUID.test(receipt?.id || '') ? receipt.id : receipt?.receiptId;
  if (typeof receiptRef !== 'string' || !REF.test(receiptRef)) throw unverified();
  const projection = typedPairProjection(response, {
    retrievalReceiptRef: receiptRef, includeTypedPathEndpoints: true, task: page.taskIntent
  }, PAIR_STATES);
  // Response identities are consistency commitments only. The owning GET/POST enforce
  // actual actor ownership; no client-supplied owner or OAuth-sub inference grants access.
  const binding = JSON.stringify([
    page.id, page.pageRef, page.ownerId, page.tenantId, page.taskIntent,
    page.policy.split(';', 1)[0], receipt.id, receipt.receiptId, receipt.query,
    page.items.map(item => [item.itemRef, item.sourceId]).sort(),
    page.hydrationPointers.map(pointer => [pointer.targetId, pointer.sourceVersion]).sort()
  ]);
  return { binding, projection };
}

async function readHydrationResponse(response, requestUrl) {
  if (!response.ok) {
    await response.body?.cancel();
    return ''; // Preserve HTTP authorization status, discard any error-body source content.
  }
  if (response.status !== 200 || response.redirected || response.url && response.url !== requestUrl
      || !/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type') || '')) {
    await response.body?.cancel();
    throw unverified();
  }
  const reader = response.body?.getReader();
  if (!reader) throw unverified();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) throw unverified();
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  let raw;
  // Reuse strict duplicate-member detection; parseJson alone would hide contradictions.
  try {
    raw = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    JSON.parse(raw);
    require('./memory-association.cjs').requireUniqueKeys(raw);
  } catch { throw unverified(); }
  return raw;
}

async function hydratePair(request, args) {
  const body = hydrationInput(args);
  const before = await request('GET', 'graymatter_ops/context_page/' + encodeURIComponent(body.contextPageRef));
  const expected = hydrationSnapshot(before, body.contextPageRef);
  const after = await request('POST', 'graymatter_ops/context_page/hydrate', body);
  const actual = hydrationSnapshot(after, body.contextPageRef);
  if (actual.binding !== expected.binding || after.contextPage.status !== 'hydrated') throw unverified();
  const endpoints = after.contextPage.hydrationPointers.map(pointer => {
    const item = after.contextPage.items.find(candidate => candidate.sourceId === pointer.targetId);
    if (pointer.status !== 'hydrated' || typeof pointer.summary !== 'string' || !pointer.summary.trim()
        || pointer.summary.length > MAX_EXACT_CHARS || item?.summary !== pointer.summary
        || item.hydrated !== true) throw unverified();
    return { sourceType: 'generated_domain_record', sourceId: pointer.targetId,
      sourceVersion: pointer.sourceVersion, text: pointer.summary };
  });
  return {
    response: after,
    projection: {
      evidenceClaimScope: CLAIM,
      typedPathEndpoints: { count: 2, projection: 'exact_authorized_projection' },
      contextPage: { pageRef: after.contextPage.pageRef, status: 'hydrated' },
      endpoints
    }
  };
}

module.exports = { compileOptions, typedPairProjection, hydratePair, readHydrationResponse };
