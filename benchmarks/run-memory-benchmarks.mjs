#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const BENCHMARK_VERSION = 'graymatter-memory-benchmarks/v1';
const LOCOMO_REVISION = '3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376';
const LONGMEMEVAL_REVISION = '98d7416c24c778c2fee6e6f3006e7a073259d48f';
const LOCOMO_URL = `https://raw.githubusercontent.com/snap-research/locomo/${LOCOMO_REVISION}/data/locomo10.json`;
const LONGMEMEVAL_URL = `https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/${LONGMEMEVAL_REVISION}/longmemeval_s_cleaned.json`;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUTPUT = resolve(ROOT, 'artifacts', 'benchmarks', 'memory-benchmark-latest.json');
const DEFAULT_CACHE = resolve(ROOT, 'artifacts', 'benchmarks', 'cache');

const args = parseArgs(process.argv.slice(2));
const seed = integer(args.seed, 20260826, 1, 0x7fffffff);
const topK = integer(args['top-k'], 10, 1, 100);
const limit = integer(args.limit, 3, 1, 500);
const outputPath = resolve(args.output || DEFAULT_OUTPUT);
const cacheDir = resolve(args.cache || DEFAULT_CACHE);
const runRef = `gmbench-${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}`;
const selectedSuites = new Set(String(args.suite || 'all').split(',').map((value) => value.trim().toLowerCase()));
const keep = Boolean(args.keep);

await mkdir(cacheDir, { recursive: true });
await mkdir(dirname(outputPath), { recursive: true });

const client = new McpClient(resolve(ROOT, 'mcp-server', 'index.js'));
const startedAt = new Date().toISOString();
const suiteReports = [];
let fatalError = null;
try {
  await client.start();
  for (const suite of await loadSuites()) {
    suiteReports.push(await runSuite(client, suite));
  }
} catch (error) {
  fatalError = error instanceof Error ? error.message : String(error);
} finally {
  await client.close();
}

const report = {
  schemaVersion: BENCHMARK_VERSION,
  runRef,
  startedAt,
  completedAt: new Date().toISOString(),
  seed,
  topK,
  requestedCaseLimitPerPublicSuite: limit,
  mode: 'retrieval_and_context_assembly_without_answer_model_or_llm_judge',
  fatalError,
  environment: {
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    grayMatterGitRevision: gitRevision(ROOT),
    serverEntry: 'mcp-server/index.js',
    auth: 'GrayMatter client runtime credential; no credential captured'
  },
  suites: suiteReports,
  aggregate: aggregate(suiteReports),
  methodology: {
    recall: `evidence-session Recall@${topK} from tenant-scoped memory_query`,
    context: 'get_context CONVERSATION_CONTEXT call with receipt and ContextPage prompt projection',
    tokens: 'ceil(prompt UTF-16 character count / 4), estimateVersion=chars-per-token/v1',
    cost: 'server-reported estimatedCredits when present; no answer-model or judge USD spend',
    reliability: 'successful ingestion, scoped retrieval, and get_context operations divided by attempted operations',
    cleanup: keep ? 'benchmark memories retained by explicit --keep' : 'written benchmark memories forgotten after each corpus group'
  }
};
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ outputPath, fatalError, aggregate: report.aggregate }, null, 2)}\n`);
process.exitCode = fatalError ? 1 : 0;

async function loadSuites() {
  const suites = [];
  if (selectedSuites.has('all') || selectedSuites.has('locomo')) {
    const path = args.locomo || resolve(cacheDir, 'locomo10.json');
    await ensureDownload(path, LOCOMO_URL);
    const raw = JSON.parse(await readFile(path, 'utf8'));
    suites.push(locomoSuite(raw, path));
  }
  if (selectedSuites.has('all') || selectedSuites.has('longmemeval')) {
    const path = args.longmemeval || resolve(cacheDir, 'longmemeval_s_cleaned.json');
    await ensureDownload(path, LONGMEMEVAL_URL);
    const raw = JSON.parse(await readFile(path, 'utf8'));
    suites.push(longMemEvalSuite(raw, path));
  }
  if (selectedSuites.has('all') || selectedSuites.has('valkyr')) {
    const path = args.valkyr || resolve(ROOT, 'benchmarks', 'fixtures', 'valkyr-workflow-kyc.json');
    const raw = JSON.parse(await readFile(path, 'utf8'));
    suites.push(valkyrSuite(raw, path));
  }
  if (suites.length === 0) throw new Error('No benchmark suite selected');
  return suites;
}

function locomoSuite(raw, path) {
  const conversations = shuffled(raw, seed).slice(0, 1);
  const groups = conversations.map((conversation) => {
    const sessions = Object.entries(conversation.conversation)
      .filter(([key, value]) => /^session_\d+$/.test(key) && Array.isArray(value))
      .sort(([left], [right]) => sessionNumber(left) - sessionNumber(right))
      .map(([id, turns]) => ({
        id,
        date: conversation.conversation[`${id}_date_time`] || null,
        text: turns.map((turn) => `${turn.speaker}: ${turn.text}`).join('\n')
      }));
    const questions = shuffled(conversation.qa.filter((item) => Number(item.category) !== 5), seed)
      .slice(0, limit)
      .map((item, index) => ({
        id: `${conversation.sample_id}-q${index + 1}`,
        question: item.question,
        answer: String(item.answer ?? ''),
        evidence: [...new Set((item.evidence || []).map((id) => `session_${String(id).match(/^D(\d+):/)?.[1] || ''}`))]
      }));
    return { id: conversation.sample_id, sessions, questions };
  });
  return suiteDescriptor('locomo', path, LOCOMO_URL, LOCOMO_REVISION, groups,
    'ACL 2024 LoCoMo QA; deterministic subset; image payloads excluded');
}

function longMemEvalSuite(raw, path) {
  const selected = stratified(raw, limit, seed, (item) => item.question_type);
  const groups = selected.map((item) => ({
    id: item.question_id,
    sessions: item.haystack_sessions.map((turns, index) => ({
      id: item.haystack_session_ids[index],
      date: item.haystack_dates[index],
      text: turns.map((turn) => `${turn.role}: ${turn.content}`).join('\n')
    })),
    questions: [{
      id: item.question_id,
      question: item.question,
      answer: String(item.answer ?? ''),
      evidence: item.answer_session_ids || [],
      category: item.question_type
    }]
  }));
  return suiteDescriptor('longmemeval', path, LONGMEMEVAL_URL, LONGMEMEVAL_REVISION, groups,
    'ICLR 2025 LongMemEval-S cleaned; deterministic question-type-stratified subset');
}

function valkyrSuite(raw, path) {
  return suiteDescriptor('valkyr-workflow-kyc', path, `file:${basename(path)}`, raw.version,
    [{ id: raw.version, sessions: raw.sessions, questions: raw.questions }],
    'Synthetic workflow, approval, deployment, KYC update, temporal-caveat, and human-gate cases');
}

function suiteDescriptor(name, path, source, revision, groups, notes) {
  return { name, path, source, revision, checksum: sha256File(path), groups, notes };
}

async function runSuite(mcp, suite) {
  const cases = [];
  const operationCounts = { attempted: 0, succeeded: 0 };
  let cleanupAttempted = 0;
  let cleanupSucceeded = 0;
  for (const group of suite.groups) {
    const sourceChannel = `benchmark:${suite.name}:${runRef}:${safeToken(group.id)}`.slice(0, 128);
    const scopeMarker = `[benchmark-scope:${sourceChannel}]`;
    const items = group.sessions.map((session) => ({
      type: 'episodic',
      title: `${suite.name}:${group.id}:${session.id}`.slice(0, 255),
      text: `${scopeMarker}\nsessionId: ${session.id}\ndate: ${session.date || 'unknown'}\n${session.text}`,
      sourceChannel,
      tags: ['benchmark', suite.name, safeToken(group.id)],
      metadata: { benchmarkVersion: BENCHMARK_VERSION, benchmarkRunRef: runRef, sessionId: session.id }
    }));
    operationCounts.attempted++;
    let written;
    try {
      written = await mcp.call('memory_put_batch', { items, maxBatch: 100 });
      operationCounts.succeeded++;
    } catch (error) {
      for (const question of group.questions) {
        cases.push(failedCase(question, group.id, 'ingestion_failed', error));
      }
      continue;
    }
    const responses = Array.isArray(written?.results) ? written.results : [];
    const idBySession = new Map();
    group.sessions.forEach((session, index) => {
      const id = firstUuid(responses[index]);
      if (id) idBySession.set(session.id, id);
    });
    for (const question of group.questions) {
      cases.push(await runCase(mcp, suite.name, group, question, sourceChannel, scopeMarker,
        idBySession, operationCounts));
    }
    if (!keep) {
      for (const memoryRef of idBySession.values()) {
        cleanupAttempted++;
        try {
          await mcp.call('omega_forget', {
            memoryRef,
            idempotencyKey: `gmbench-forget-${memoryRef}`,
            reason: `benchmark_cleanup:${runRef}`
          });
          cleanupSucceeded++;
        } catch {
          // Cleanup is reported independently and never rewrites benchmark measurements.
        }
      }
    }
  }
  return {
    suite: suite.name,
    source: suite.source,
    revision: suite.revision,
    datasetSha256: suite.checksum,
    notes: suite.notes,
    groupCount: suite.groups.length,
    ingestedSessionCount: suite.groups.reduce((sum, group) => sum + group.sessions.length, 0),
    cases,
    metrics: aggregateCases(cases, operationCounts),
    operations: operationCounts,
    cleanup: { attempted: cleanupAttempted, succeeded: cleanupSucceeded }
  };
}

async function runCase(mcp, suite, group, question, sourceChannel, scopeMarker, idBySession, counts) {
  const expectedIds = question.evidence.map((id) => idBySession.get(id)).filter(Boolean);
  let queryResult = null;
  let contextResult = null;
  let queryError = null;
  let contextError = null;
  const queryStarted = performance.now();
  counts.attempted++;
  try {
    queryResult = await mcp.call('memory_query', {
      query: question.question,
      sourceChannel,
      limit: topK,
      type: 'episodic'
    });
    counts.succeeded++;
  } catch (error) {
    queryError = error instanceof Error ? error.message : String(error);
  }
  const queryLatencyMs = Math.round(performance.now() - queryStarted);
  const contextStarted = performance.now();
  counts.attempted++;
  try {
    contextResult = await mcp.call('get_context', {
      query: `${scopeMarker} ${question.question}`,
      recentTurns: group.sessions.slice(-4).map((session) => `${session.date || 'unknown'} ${session.text.slice(0, 800)}`),
      idempotencyKey: `gmbench-${safeToken(suite)}-${safeToken(question.id)}-${runRef}`.slice(0, 200),
      maxTokens: 2400,
      includeEvaluator: true
    });
    counts.succeeded++;
  } catch (error) {
    contextError = error instanceof Error ? error.message : String(error);
  }
  const contextLatencyMs = Math.round(performance.now() - contextStarted);
  const retrievedEntries = normalizeEntries(queryResult);
  const retrievedIds = retrievedEntries.map((entry) => firstUuid(entry)).filter(Boolean).slice(0, topK);
  const evidenceRecallAtK = expectedIds.length > 0
    ? expectedIds.filter((id) => retrievedIds.includes(id)).length / expectedIds.length
    : answerTokenCoverage(question.answer, JSON.stringify(retrievedEntries));
  const promptText = firstPrompt(contextResult);
  const answerCoverage = answerTokenCoverage(question.answer, `${JSON.stringify(retrievedEntries)}\n${promptText}`);
  const receiptPresent = hasReceiptReference(contextResult);
  return {
    id: question.id,
    category: question.category || null,
    groupId: group.id,
    expectedEvidenceCount: question.evidence.length,
    boundExpectedEvidenceCount: expectedIds.length,
    retrievedCount: retrievedEntries.length,
    evidenceRecallAtK: round(evidenceRecallAtK),
    answerTokenCoverage: round(answerCoverage),
    queryLatencyMs,
    contextLatencyMs,
    contextReceiptPresent: receiptPresent,
    policyAuthority: contextResult?.policyAuthority || null,
    estimatedContextTokens: Math.ceil(promptText.length / 4),
    contextPromptCharacters: promptText.length,
    estimatedCredits: round(sumNumericKeys(contextResult, /estimatedCredits?|creditsEstimated/i)),
    querySucceeded: !queryError,
    contextSucceeded: !contextError,
    queryError,
    contextError,
    passed: !queryError && !contextError && receiptPresent && evidenceRecallAtK >= 0.5,
    resultEvidenceHash: sha256(JSON.stringify({
      id: question.id, expectedIds, retrievedIds, receiptPresent,
      contextPageRef: findFirstKey(contextResult, /contextPageRef/i)
    }))
  };
}

function failedCase(question, groupId, code, error) {
  return {
    id: question.id, category: question.category || null, groupId, passed: false,
    querySucceeded: false, contextSucceeded: false, contextReceiptPresent: false,
    evidenceRecallAtK: 0, answerTokenCoverage: 0, queryLatencyMs: 0, contextLatencyMs: 0,
    estimatedContextTokens: 0, contextPromptCharacters: 0, estimatedCredits: 0,
    errorCode: code, error: error instanceof Error ? error.message : String(error)
  };
}

function aggregateCases(cases, operations) {
  const latencies = cases.map((item) => item.contextLatencyMs).filter(Number.isFinite).sort((a, b) => a - b);
  return {
    caseCount: cases.length,
    passedCount: cases.filter((item) => item.passed).length,
    meanEvidenceRecallAtK: mean(cases.map((item) => item.evidenceRecallAtK)),
    meanAnswerTokenCoverage: mean(cases.map((item) => item.answerTokenCoverage)),
    receiptRate: mean(cases.map((item) => item.contextReceiptPresent ? 1 : 0)),
    reliabilityRate: operations.attempted ? round(operations.succeeded / operations.attempted) : 0,
    p50ContextLatencyMs: percentile(latencies, 0.50),
    p95ContextLatencyMs: percentile(latencies, 0.95),
    totalEstimatedContextTokens: cases.reduce((sum, item) => sum + (item.estimatedContextTokens || 0), 0),
    totalEstimatedCredits: round(cases.reduce((sum, item) => sum + (item.estimatedCredits || 0), 0)),
    measuredExternalLlmUsd: 0,
    externalLlmCostBasis: 'No answer model or LLM judge was invoked'
  };
}

function aggregate(suites) {
  const cases = suites.flatMap((suite) => suite.cases || []);
  const operations = suites.reduce((value, suite) => ({
    attempted: value.attempted + (suite.operations?.attempted || 0),
    succeeded: value.succeeded + (suite.operations?.succeeded || 0)
  }), { attempted: 0, succeeded: 0 });
  return aggregateCases(cases, operations);
}

class McpClient {
  constructor(serverPath) {
    this.serverPath = serverPath;
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = '';
  }

  async start() {
    this.child = spawn(process.execPath, [this.serverPath, '--stdio'], {
      cwd: dirname(this.serverPath), env: process.env, stdio: ['pipe', 'pipe', 'pipe']
    });
    let buffer = '';
    this.child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        const newline = buffer.indexOf('\n');
        if (newline < 0) break;
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        const pending = this.pending.get(String(message.id));
        if (!pending) continue;
        this.pending.delete(String(message.id));
        if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
        else pending.resolve(message.result);
      }
    });
    this.child.stderr.on('data', (chunk) => {
      this.stderr = `${this.stderr}${chunk.toString('utf8')}`.slice(-12000);
    });
    this.child.on('exit', (code) => {
      for (const pending of this.pending.values()) pending.reject(new Error(`MCP server exited ${code}: ${this.stderr}`));
      this.pending.clear();
    });
    await this.rpc('initialize', {});
  }

  async call(name, arguments_) {
    const result = await this.rpc('tools/call', { name, arguments: arguments_ });
    const text = result?.content?.find((item) => item.type === 'text')?.text;
    if (!text) return result;
    try { return JSON.parse(text); } catch { return { text }; }
  }

  rpc(method, params) {
    const id = String(this.nextId++);
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(new Error(`MCP timeout for ${method}: ${this.stderr}`));
      }, 120000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolvePromise(value); },
        reject: (error) => { clearTimeout(timer); rejectPromise(error); }
      });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  async close() {
    if (!this.child) return;
    this.child.stdin.end();
    await Promise.race([
      new Promise((resolvePromise) => this.child.once('exit', resolvePromise)),
      new Promise((resolvePromise) => setTimeout(resolvePromise, 500))
    ]);
    if (!this.child.killed) this.child.kill();
  }
}

async function ensureDownload(path, url) {
  if (existsSync(path)) return;
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Dataset download failed ${response.status} ${url}`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.from(await response.arrayBuffer()));
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (!value.startsWith('--')) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    if (next && !next.startsWith('--')) parsed[key] = values[++index];
    else parsed[key] = true;
  }
  return parsed;
}

function shuffled(values, seedValue) {
  const copy = [...values];
  let state = seedValue >>> 0;
  for (let index = copy.length - 1; index > 0; index--) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    const target = (state >>> 0) % (index + 1);
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

function stratified(values, count, seedValue, category) {
  const buckets = new Map();
  for (const value of shuffled(values, seedValue)) {
    const key = category(value) || 'unknown';
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(value);
  }
  const selected = [];
  const keys = [...buckets.keys()].sort();
  while (selected.length < count && keys.length) {
    for (let index = keys.length - 1; index >= 0 && selected.length < count; index--) {
      const item = buckets.get(keys[index]).shift();
      if (item) selected.push(item);
      if (buckets.get(keys[index]).length === 0) keys.splice(index, 1);
    }
  }
  return selected;
}

function normalizeEntries(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of ['results', 'content', 'items', 'data', 'records']) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
}

function firstUuid(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) { const found = firstUuid(item); if (found) return found; }
  } else if (typeof value === 'object') {
    for (const key of ['id', 'memoryId', 'memoryRef']) {
      const found = firstUuid(value[key]); if (found) return found;
    }
    for (const item of Object.values(value)) { const found = firstUuid(item); if (found) return found; }
  }
  return null;
}

function firstPrompt(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(firstPrompt).find(Boolean) || '';
  if (typeof value === 'object') {
    for (const key of ['prompt', 'compiledPrompt', 'text', 'content']) {
      if (typeof value[key] === 'string') return value[key];
    }
    for (const item of Object.values(value)) { const found = firstPrompt(item); if (found) return found; }
  }
  return '';
}

function hasReceiptReference(value) {
  return findFirstKey(value, /(^|_)(receipt(Id|Ref)?|searchReceiptRef)$/i) != null
    || findFirstKey(value, /contextPageRef/i) != null;
}

function findFirstKey(value, pattern) {
  if (!value || typeof value !== 'object') return null;
  for (const [key, item] of Object.entries(value)) {
    if (pattern.test(key) && item != null && item !== '') return item;
    const nested = findFirstKey(item, pattern);
    if (nested != null) return nested;
  }
  return null;
}

function sumNumericKeys(value, pattern) {
  if (!value || typeof value !== 'object') return 0;
  let total = 0;
  for (const [key, item] of Object.entries(value)) {
    if (pattern.test(key) && Number.isFinite(Number(item))) total += Number(item);
    else total += sumNumericKeys(item, pattern);
  }
  return total;
}

function answerTokenCoverage(answer, haystack) {
  const ignored = new Set(['the', 'and', 'that', 'with', 'from', 'this', 'after', 'before', 'were', 'was', 'for', 'into']);
  const terms = [...new Set(String(answer).toLowerCase().split(/[^a-z0-9]+/u)
    .filter((term) => term.length > 2 && !ignored.has(term)))];
  if (terms.length === 0) return 1;
  const target = String(haystack).toLowerCase();
  return terms.filter((term) => target.includes(term)).length / terms.length;
}

function percentile(sorted, quantile) {
  if (!sorted.length) return 0;
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)];
}

function mean(values) {
  const measured = values.filter(Number.isFinite);
  return measured.length ? round(measured.reduce((sum, value) => sum + value, 0) / measured.length) : 0;
}

function round(value) { return Math.round(Number(value || 0) * 10000) / 10000; }
function safeToken(value) { return String(value || 'unknown').replace(/[^A-Za-z0-9._:-]/g, '-'); }
function sessionNumber(value) { return Number(String(value).match(/(\d+)/)?.[1] || 0); }
function integer(value, fallback, min, max) { const parsed = Number(value); return Number.isInteger(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback; }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function sha256File(path) { return spawnSync('shasum', ['-a', '256', path], { encoding: 'utf8' }).stdout.split(/\s+/)[0] || ''; }
function gitRevision(path) { return spawnSync('git', ['rev-parse', 'HEAD'], { cwd: path, encoding: 'utf8' }).stdout.trim() || 'unavailable'; }
