'use strict';
const { scanMemoryEntries } = require('./memory-scan.cjs');
const { plainRequest } = require('./procedure-execution.cjs');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const HASH = /^[0-9a-f]{64}$/u;
const KEYS = new Set(['query', 'limit', 'offset', 'enabledOnly', 'minimumConfidence']);

function discoveryError(code) {
  return Object.assign(new Error(code === 'INVALID_SEARCH_INPUT'
    ? 'Provide a bounded search query and valid result filters; authority overrides are not accepted.'
    : 'Procedure discovery could not be verified. Check authentication and API availability; no absence or execution authority was inferred.'), { code });
}

function prepare(args, options) {
  try {
    const value = plainRequest(args);
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !KEYS.has(k))) throw Error();
    const query = typeof value.query === 'string' ? value.query.trim().toLowerCase() : '';
    const limit = Object.hasOwn(value, 'limit') ? value.limit : 10;
    const offset = Object.hasOwn(value, 'offset') ? value.offset : 0;
    const enabledOnly = Object.hasOwn(value, 'enabledOnly') ? value.enabledOnly : true;
    const minimumConfidence = Object.hasOwn(value, 'minimumConfidence') ? value.minimumConfidence : 0;
    const maxPages = options.maxPages ?? 10, maxMs = options.maxMs ?? 15000;
    if (!query || value.query.length > 2000 || !Number.isInteger(limit) || limit < 1 || limit > 20
        || !Number.isInteger(offset) || offset < 0 || offset > 10000 || typeof enabledOnly !== 'boolean'
        || !Number.isFinite(minimumConfidence) || minimumConfidence < 0 || minimumConfidence > 1
        || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100
        || !Number.isInteger(maxMs) || maxMs < 1 || maxMs > 300000) throw Error();
    return { query, limit, offset, enabledOnly, minimumConfidence, maxPages, maxMs };
  } catch { throw discoveryError('INVALID_SEARCH_INPUT'); }
}

// Only inspect named, own JSON fields. Never retain arbitrary evidence,
// ownership, policy, metadata or input-contract blobs in discovery results.
function field(row, name) {
  const descriptor = Object.getOwnPropertyDescriptor(row, name);
  if (!descriptor) return undefined;
  if (!Object.hasOwn(descriptor, 'value')) throw Error('Invalid Procedure response');
  return descriptor.value;
}

function text(row, name, max, required = false) {
  const value = field(row, name);
  if (value == null && !required) return null;
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw Error('Invalid Procedure response');
  return value;
}

function project(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw Error('Invalid Procedure response');
  const id = text(row, 'id', 36, true).toLowerCase();
  if (!UUID.test(id)) throw Error('Invalid Procedure response');
  const name = text(row, 'name', 256, true), procedureRef = text(row, 'procedureRef', 128, true);
  const description = text(row, 'description', 12000) || '';
  const taskType = text(row, 'taskType', 128), procedureFamilyRef = text(row, 'procedureFamilyRef', 128);
  const enabled = field(row, 'enabled'), confidence = field(row, 'confidence'), deterministic = field(row, 'deterministic');
  if ((enabled != null && typeof enabled !== 'boolean') || (deterministic != null && typeof deterministic !== 'boolean')
      || (confidence != null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1))) throw Error('Invalid Procedure response');
  const summary = { id, procedureRef, procedureFamilyRef, name, taskType,
    description: description.slice(0, 512), descriptionTruncated: description.length > 512,
    enabled: enabled ?? null, deterministic: deterministic ?? null, confidence: confidence ?? null,
    lifecycleStatus: text(row, 'lifecycleStatus', 128), workflowBindingStatus: text(row, 'workflowBindingStatus', 128) };
  for (const key of ['workflowId', 'workflowVersionId', 'workflowContentHash', 'workflowAbiHash']) {
    const value = text(row, key, key.endsWith('Id') ? 36 : 64);
    if (value !== null && !(key.endsWith('Id') ? UUID : HASH).test(value)) throw Error('Invalid Procedure response');
    summary[key] = value === null ? null : value.toLowerCase();
  }
  return { id, summary, searchable: [name, procedureRef, procedureFamilyRef, description, taskType].filter(Boolean).join('\n').toLowerCase() };
}

async function searchProcedures(request, args, options = {}) {
  const config = prepare(args, options);
  const started = Date.now();
  let scanned;
  try {
    scanned = await scanMemoryEntries(async route => {
      const remaining = config.maxMs - (Date.now() - started);
      if (remaining < 1) throw Error('Scan budget expired');
      const response = await request('GET', `/${route.replace(/^MemoryEntry\?/, 'Procedure?')}`, undefined,
        { timeoutMs: remaining, readStatus: true });
      if (!Array.isArray(response) || response.length > 100) throw Error('Invalid Procedure list');
      return response.map(project);
    }, { maxPages: config.maxPages, maxMs: config.maxMs, concurrency: 1 });
  } catch { throw discoveryError('PROCEDURE_SEARCH_UNAVAILABLE'); }
  const coverage = { ...scanned.coverage };
  // Overlapping pages can hide a moving collection; ID deduplication does not
  // establish a complete snapshot. Preserve the scanner's stronger stop reason.
  if (coverage.complete && coverage.duplicates > 0) {
    coverage.complete = false; coverage.reason = 'duplicate_records';
  }
  const matches = scanned.entries.filter(p => (!config.enabledOnly || p.summary.enabled === true)
    && (p.summary.confidence ?? 0) >= config.minimumConfidence && p.searchable.includes(config.query));
  const procedures = matches.slice(config.offset, config.offset + config.limit).map(p => p.summary);
  const knownMore = matches.length > config.offset + procedures.length;
  return { contractVersion: 'graymatter-procedure-discovery/v1', operation: 'search',
    status: coverage.complete ? 'complete' : 'partial', matchPolicy: 'case_insensitive_substring',
    resultKind: 'candidate_summaries', executionAuthorization: 'server_recheck_required',
    procedures, coverage, observedMatches: matches.length, offset: config.offset, limit: config.limit,
    hasMore: knownMore ? true : (coverage.complete ? false : null),
    nextOffset: knownMore ? config.offset + procedures.length : null };
}

module.exports = { searchProcedures, discoveryError, projectProcedure: project };
