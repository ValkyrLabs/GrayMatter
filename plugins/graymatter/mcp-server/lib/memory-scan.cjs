'use strict';

// One pagination contract for the shell helpers and MCP. The API owns tenant/ACL
// selection; this scanner never accepts an owner or tenant override.
function entriesOf(thor_payload) {
  if (Array.isArray(thor_payload)) return thor_payload;
  for (const thor_key of ['content', 'items', 'data', 'results', 'records', 'memoryEntries', 'entries']) {
    if (Array.isArray(thor_payload?.[thor_key])) return thor_payload[thor_key];
  }
  throw new Error('MemoryEntry returned an unrecognized list response');
}

async function scanMemoryEntries(thor_fetch, thor_options = {}) {
  const thor_pageSize = 100;
  const thor_maxPages = thor_options.maxPages ?? 100;
  const thor_maxMs = thor_options.maxMs ?? 60000;
  const thor_concurrency = thor_options.concurrency ?? 4;
  const thor_type = thor_options.type;
  if (thor_type !== undefined && !['configuration', 'preference', 'decision', 'todo', 'context', 'artifact'].includes(thor_type)) {
    throw new Error('Invalid MemoryEntry type filter');
  }
  const thor_filter = thor_type ? `&example=${encodeURIComponent(JSON.stringify({ type: thor_type }))}` : '';
  if (!Number.isInteger(thor_maxPages) || thor_maxPages < 1 || thor_maxPages > 1000
      || !Number.isFinite(thor_maxMs) || thor_maxMs < 1 || thor_maxMs > 300000
      || !Number.isInteger(thor_concurrency) || thor_concurrency < 1 || thor_concurrency > 4) {
    throw new Error('Invalid MemoryEntry scan budget');
  }
  const thor_started = Date.now();
  const thor_entries = new Map();
  const thor_coverage = {
    complete: false, pages: 0, scanned: 0, duplicates: 0, pageSize: thor_pageSize,
    maxPages: thor_maxPages, requestedPages: 0, concurrency: thor_concurrency,
    reason: 'page_budget', consistency: 'best_effort_paginated_read',
    ...(thor_type ? { requestedType: thor_type, serverFilterHonored: true } : {})
  };
  let thor_window = [];
  for (let thor_page = 0; thor_page < thor_maxPages; thor_page += 1) {
    if (thor_page % thor_concurrency === 0) {
      if (Date.now() - thor_started >= thor_maxMs) {
        thor_coverage.reason = 'time_budget';
        break;
      }
      const thor_windowSize = Math.min(thor_concurrency, thor_maxPages - thor_page);
      thor_coverage.requestedPages += thor_windowSize;
      // Keep at most four read-only requests in flight, then consume in page
      // order. Do not return rows speculatively fetched beyond the first end.
      thor_window = await Promise.allSettled(Array.from({ length: thor_windowSize }, (_, thor_index) =>
        Promise.resolve().then(() => thor_fetch(
          `MemoryEntry?page=${thor_page + thor_index}&size=${thor_pageSize}&sort=id,asc${thor_filter}`))));
      const thor_denial = thor_window.find(thor_result => thor_result.status === 'rejected'
        && [401, 403].includes(thor_result.reason?.status));
      if (thor_denial) throw thor_denial.reason;
    }
    let thor_payload;
    let thor_batch;
    try {
      const thor_result = thor_window[thor_page % thor_concurrency];
      if (thor_result.status === 'rejected') throw thor_result.reason;
      thor_payload = thor_result.value;
      thor_batch = entriesOf(thor_payload);
    } catch (thor_error) {
      // Authentication/transport errors never silently become an empty result.
      if (thor_page === 0 || [401, 403].includes(thor_error.status)) throw thor_error;
      thor_coverage.reason = 'page_failed';
      break;
    }
    thor_coverage.pages += 1;
    if (thor_batch.length === 0) {
      thor_coverage.complete = true;
      thor_coverage.reason = 'end_of_list';
      break;
    }
    let thor_added = 0;
    for (const thor_entry of thor_batch) {
      // Older servers ignore example. Preserve their full scan and expose the
      // overfetch; callers still apply their existing invariant predicate.
      if (thor_type && thor_entry?.type !== thor_type) thor_coverage.serverFilterHonored = false;
      if (!thor_entry || typeof thor_entry.id !== 'string' || !thor_entry.id) {
        thor_coverage.reason = 'invalid_entry';
        return { entries: [...thor_entries.values()], coverage: { ...thor_coverage, scanned: thor_entries.size, durationMs: Date.now() - thor_started } };
      }
      if (thor_entries.has(thor_entry.id)) thor_coverage.duplicates += 1;
      else thor_added += 1;
      thor_entries.set(thor_entry.id, thor_entry);
    }
    if (thor_added === 0) {
      thor_coverage.reason = 'pagination_not_advancing';
      break;
    }
    // Do not infer completion from a short page: servers can cap size below 100.
    if (thor_payload?.last === true || thor_payload?.hasNext === false) {
      thor_coverage.complete = true;
      thor_coverage.reason = 'end_of_list';
      break;
    }
  }
  thor_coverage.scanned = thor_entries.size;
  thor_coverage.durationMs = Date.now() - thor_started;
  return { entries: [...thor_entries.values()], coverage: thor_coverage };
}

function isActiveMemory(thor_entry) {
  const thor_tags = (thor_entry.tags || []).map(thor_tag => String(thor_tag?.name || thor_tag).toLowerCase());
  return thor_entry.trashed !== true
    && !thor_entry.supersededByRef
    && !['superseded', 'retracted', 'archived', 'obsolete'].includes(String(thor_entry.status || '').toLowerCase())
    && !thor_tags.some(thor_tag => ['superseded', 'retracted', 'obsolete', 'status:superseded', 'status:retracted'].includes(thor_tag));
}

module.exports = { scanMemoryEntries, entriesOf, isActiveMemory };

if (require.main === module) {
  const { execFile } = require('node:child_process');
  const { promisify } = require('node:util');
  const thor_exec = promisify(execFile);
  const thor_path = require('node:path');
  const thor_command = process.env.GRAYMATTER_API_COMMAND || thor_path.join(__dirname, '..', '..', 'scripts', 'graymatter_api.sh');
  scanMemoryEntries(async thor_endpoint => {
    const thor_result = await thor_exec(thor_command, ['GET', `/${thor_endpoint}`], {
      encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 65000,
      env: { ...process.env, GRAYMATTER_SKIP_SELF_UPDATE: 'true', GRAYMATTER_SKIP_AUTO_REPLAY: 'true' }
    });
    return JSON.parse(thor_result.stdout);
  }, {
    maxPages: Number(process.env.GRAYMATTER_SCAN_MAX_PAGES || 100),
    maxMs: Number(process.env.GRAYMATTER_SCAN_MAX_MS || 60000),
    concurrency: Number(process.env.GRAYMATTER_SCAN_CONCURRENCY || 4),
    type: process.env.GRAYMATTER_SCAN_TYPE || undefined
  }).then(thor_result => process.stdout.write(`${JSON.stringify(thor_result)}\n`))
    .catch(() => { process.stderr.write('GrayMatter list scan failed; check authentication and API availability.\n'); process.exitCode = 1; });
}
