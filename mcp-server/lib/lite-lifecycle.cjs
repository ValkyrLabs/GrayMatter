'use strict';

const {recallOption, verifyRecall} = require('./memory-association.cjs');

const uuid = { type: 'string', format: 'uuid' };
const hash = { type: 'string', pattern: '^[0-9a-f]{64}$' };
const tagList = { type: 'array', maxItems: 50, items: { type: 'string', minLength: 1, maxLength: 128 } };
const filter = { type: 'object', additionalProperties: false, properties: {
  type: { type: 'string' }, source: { type: 'string' }, sourceChannel: { type: 'string' }, tags: tagList
} };
const descriptors = [
  { name: 'lite_memory_revise', title: 'Correct a Lite memory',
    description: 'Correct the exact owned Lite memory previously read. Pass its current sourceHash. A stale hash requires reading the current revision before deciding whether to retry.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { id: uuid, expectedSourceHash: hash,
      text: { type: 'string', minLength: 1, maxLength: 16000 }, tags: tagList }, required: ['id', 'expectedSourceHash'],
      anyOf: [{ required: ['text'] }, { required: ['tags'] }] },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: false },
    invoking: 'Checking and correcting Lite memory', invoked: 'Lite correction checked' },
  { name: 'lite_memory_forget', title: 'Forget a Lite memory',
    description: 'Forget an exact owned Lite memory when the user has confirmed that record. Use the sourceHash from the version they reviewed.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { id: uuid, expectedSourceHash: hash, confirmed: { const: true } },
      required: ['id', 'expectedSourceHash', 'confirmed'] },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: false },
    invoking: 'Checking the confirmed Lite revision', invoked: 'Lite deletion checked' },
  { name: 'lite_context_refresh', title: 'Refresh a Lite retrieval receipt',
    description: 'Repeat the original Lite search before acting. Pass the same query, filters, limits, mode and protected IDs. The child receipt evaluates the current candidate memories.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { receiptId: uuid, query: { type: 'string', minLength: 1, maxLength: 1000 },
      filters: filter, type: { type: 'string' }, source: { type: 'string' }, tags: tagList,
      topK: { type: 'integer', minimum: 1, maximum: 100 }, tokenBudget: { type: 'integer', minimum: 128, maximum: 16000 },
      protectedRefs: { type: 'array', maxItems: 100, items: uuid }, includeText: { type: 'boolean' }, retrievalMode: { type: 'string' }, includeAssociations: { type: 'boolean' } }, required: ['receiptId', 'query'] },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false },
    invoking: 'Repeating the original Lite search', invoked: 'Lite search refreshed' }
];

const ids = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const hashes = /^[0-9a-f]{64}$/;
const byName = new Map(descriptors.map(d => [d.name, d]));

function available({apiBase, lightPassword, profileMode, token, publicApp, requestScopedToken}) {
  if (!lightPassword || token || publicApp || requestScopedToken || profileMode === 'blend') return false;
  try {
    const url = new URL(apiBase);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      && !url.search && !url.hash && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch { return false; }
}

async function execute(name, args, request, decorate) {
  const descriptor = byName.get(name);
  if (!descriptor || !args || Object.keys(args).some(k => !Object.hasOwn(descriptor.inputSchema.properties, k))) {
    throw new Error('Unsupported Lite request field.');
  }
  if (name === 'lite_context_refresh') {
    const {receiptId, ...body} = args;
    if (typeof receiptId !== 'string' || !ids.test(receiptId) || typeof body.query !== 'string' || !body.query.trim()) throw new Error('A receipt ID and its original query are required.');
    recallOption(body.includeAssociations);
    const response = await request('graymatter/retrieval-context/' + receiptId + '/refresh', body);
    const r = response.body;
    if (response.status !== 200 || typeof r?.receiptId !== 'string' || !ids.test(r.receiptId) || r.receiptId.toLowerCase() === receiptId.toLowerCase()
        || typeof r.parentReceiptId !== 'string' || r.parentReceiptId.toLowerCase() !== receiptId.toLowerCase()
        || r.sourceSelection !== 'FRESH_SEARCH') {
      throw new Error('Fresh retrieval receipt could not be verified.');
    }
    verifyRecall(body, r);
    const verified = {...decorate(r), parentReceiptId: r.parentReceiptId, sourceSelection: r.sourceSelection};
    // A fresh local search supplies current owner-visible witnesses. Forward IDs only.
    const witness = {CONFLICTING_CONTEXT: 'conflictRefs', AMBIGUOUS_WEEKDAY: 'ambiguousRefs'}[r.retrievalStatus];
    if (witness && r.answerPolicy === 'DO_NOT_ANSWER_CONFIDENTLY' && r.recommendedAction === 'REQUIRE_CLARIFICATION') {
      const refs = r[witness];
      if (!Array.isArray(refs) || refs.length < 1 || refs.length > 101 ||
          refs.some(id => typeof id !== 'string' || !ids.test(id))) throw new Error('Invalid Lite witness references.');
      verified[witness] = [...new Set(refs)];
    }
    return verified;
  }
  const {id, ...body} = args;
  if (typeof id !== 'string' || !ids.test(id) || typeof body.expectedSourceHash !== 'string' || !hashes.test(body.expectedSourceHash)) {
    throw new Error('Supply the exact memory ID and sourceHash returned by Lite.');
  }
  const endpoint = 'graymatter/memory/' + id;
  if (name === 'lite_memory_forget') {
    if (body.confirmed !== true) throw new Error('Confirmation for this exact memory is required.');
    const response = await request(endpoint + '/forget', body);
    if (response.status !== 204 || response.body != null) throw new Error('Deletion outcome unverified. Inspect the exact memory before retrying.');
    return {id, forgotten: true};
  }
  if (body.text === undefined && body.tags === undefined) throw new Error('Supply replacement text or tags.');
  if (body.text !== undefined && (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 16000)) throw new Error('Invalid replacement text.');
  if (body.tags !== undefined && (!Array.isArray(body.tags) || body.tags.length > 50
      || body.tags.some(t => typeof t !== 'string' || !t.trim() || t.includes(',') || t.length > 128))) throw new Error('Invalid replacement tags.');
  const response = await request(endpoint + '/revise', body);
  const r = response.body;
  const expectedTags = body.tags && [...new Set(body.tags.map(t => t.trim()))].join(',');
  if (response.status !== 200 || typeof r?.id !== 'string' || r.id.toLowerCase() !== id.toLowerCase() || r.memoryId !== r.id
      || typeof r.sourceHash !== 'string' || !hashes.test(r.sourceHash)
      || (body.text !== undefined && r.text !== body.text) || (body.tags !== undefined && r.tags !== expectedTags)) {
    throw new Error('Correction outcome unverified. Read the exact memory before retrying.');
  }
  return {id: r.id, sourceHash: r.sourceHash, text: r.text, tags: r.tags};
}

module.exports = {descriptors, available, execute};
