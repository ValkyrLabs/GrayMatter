'use strict';

// Usage: node schedule-controls.cjs [--check] /absolute/path/to/graymatter-local-server.jar
// --check additionally exits unsuccessfully when a primary oracle decision differs.
// stdout contains one JSON report. The runtime has an empty, temporary H2 database.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createHash, randomBytes } = require('node:crypto');
const { createReadStream } = require('node:fs');
const { mkdtemp, realpath, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');

// These expectations were written before inspecting the weekday matcher. Both worlds
// attached to exact-bare send identical HTTP input. Count their decisions separately.
const manifest = {
  version: 1,
  query: 'Canary window',
  retrievalMode: 'KEYWORD',
  tokenBudget: 4096,
  topK: 'all fixture rows',
  cases: [
    {"id": "scope-in-channel", "expected": "permit", "rows": [{"text": "Canary window is Wednesday.", "source": "prod"}, {"text": "Canary window is Thursday.", "source": "stage"}]},
    {"id": "single", "expected": "permit", "rows": [{"text": "Canary window is Wednesday."}]},
    {"id": "exact-bare", "expected": "clarify", "rows": [{"text": "Canary window is Wednesday."}, {"text": "Canary window is Thursday."}], "alternate": {"world": "recurring-two-day-window", "expected": "permit"}},
    {"id": "same-normalized-day", "expected": "permit", "rows": [{"text": "Canary window is Wed."}, {"text": "Canary window is Wednesday."}]},
    {"id": "distinct-start-end", "expected": "permit", "rows": [{"text": "Canary window starts Wednesday."}, {"text": "Canary window ends Thursday."}]},
    {"id": "range-and-member", "expected": "permit", "rows": [{"text": "Canary window is Wednesday through Thursday."}, {"text": "Canary window is Thursday."}]},
    {"id": "enumeration-and-member", "expected": "permit", "rows": [{"text": "Canary window is Wednesday and Thursday."}, {"text": "Canary window is Thursday."}]},
    {"id": "sequential-steps", "expected": "permit", "rows": [{"text": "Canary window preparation is Wednesday."}, {"text": "Canary window deployment is Thursday."}]},
    {"id": "regions", "expected": "permit", "rows": [{"text": "EU canary window is Wednesday."}, {"text": "US canary window is Thursday."}]},
    {"id": "production-staging", "expected": "permit", "rows": [{"text": "Production canary window is Wednesday."}, {"text": "Staging canary window is Thursday."}]},
    {"id": "different-tenses", "expected": "permit", "rows": [{"text": "Last week's canary window was Wednesday."}, {"text": "This week's canary window is Thursday."}]},
    {"id": "conditional-exception", "expected": "permit", "rows": [{"text": "Canary window is Wednesday."}, {"text": "Canary window is Thursday if Wednesday is a holiday."}]},
    {"id": "explicit-recurrence", "expected": "permit", "rows": [{"text": "Canary window is Wednesday."}, {"text": "Canary window is Thursday."}, {"text": "Canary window runs on both Wednesday and Thursday each week."}]},
    {"id": "environments-in-metadata", "expected": "permit", "rows": [{"text": "Canary window is Wednesday.", "tags": ["production"]}, {"text": "Canary window is Thursday.", "tags": ["staging"]}]},
    {"id": "time-in-metadata", "expected": "permit", "rows": [{"text": "Canary window is Wednesday.", "tags": ["week-42"]}, {"text": "Canary window is Thursday.", "tags": ["week-43"]}]},
    {"id": "different-value-types", "expected": "permit", "rows": [{"text": "Canary window is Wednesday."}, {"text": "Canary window is one hour."}]},
    {"id": "unrelated-source", "expected": "permit", "rows": [{"text": "Canary window is Wednesday."}, {"text": "Billing window is Thursday."}]},
    {"id": "revised-resolved", "expected": "permit", "rows": [{"text": "Canary window is Wednesday."}, {"text": "Canary window is Thursday."}, {"text": "The final decision supersedes Wednesday: this week's canary window is Thursday."}]},
  ]
};
const pinnedManifestSha256 = 'ee9176a83a871163968a365c8c32422f244f8fb597e0a0f5d3590989a76ed1db';

async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function runProbe(port, password) {
  const authorization = 'Basic ' + Buffer.from('admin:' + password).toString('base64');
  const base = 'http://127.0.0.1:' + port + '/v1/';
  async function post(path, payload) {
    const response = await fetch(base + path, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: {authorization, 'content-type': 'application/json'}, body: JSON.stringify(payload)
    });
    if (!response.ok) throw Error(path + ' returned HTTP ' + response.status);
    return response.json();
  }

  const results = [];
  // The cross-channel control must run first, while the temporary DB contains only its two records.
  assert.equal(manifest.cases[0].id, 'scope-in-channel');
  for (const scenario of manifest.cases) {
    const channel = 'schedule-controls:' + scenario.id;
    const crossChannel = scenario.rows.some(row => row.source);
    assert.equal(crossChannel, results.length === 0);
    const seeded = new Map();
    for (const [index, row] of scenario.rows.entries()) {
      const saved = await post('MemoryEntry/write', {
        text: row.text, type: 'context', sourceChannel: row.source || channel, tags: row.tags || []
      });
      assert.ok(typeof saved.id === 'string' && saved.id && !seeded.has(saved.id), 'fixture identity');
      seeded.set(saved.id, {key: 's' + (index + 1), text: row.text});
    }
    function keys(ids) {
      assert.ok(Array.isArray(ids) && ids.every(id => seeded.has(id)), scenario.id + ' returned sources outside the fixture');
      assert.equal(new Set(ids).size, ids.length, scenario.id + ' duplicate source');
      return ids.map(id => seeded.get(id).key).sort();
    }
    const search = {query: manifest.query, retrievalMode: manifest.retrievalMode};
    if (!crossChannel) search.filters = {source: channel};
    const ranked = await post('memory/semantic-index/search', {...search, limit: seeded.size});
    const eligible = keys(ranked.results.map(hit => hit.memoryEntry.id));
    assert.equal(eligible.length, seeded.size, scenario.id + ' did not retrieve both sides of the control');
    const reply = await post('graymatter/retrieval-context', {
      ...search, topK: seeded.size, tokenBudget: manifest.tokenBudget, includeText: true
    });
    assert.ok(reply.receiptId, scenario.id + ' missing receipt');
    assert.equal(reply.sourceCount, seeded.size, scenario.id + ' incomplete source set');
    const delivered = keys(reply.items.map(item => item.memoryId));
    const conflictRefs = keys(reply.conflictRefs);
    const ambiguousRefs = keys(reply.ambiguousRefs ?? []); // Older policy versions lacked this field.
    assert.equal(keys(reply.truncatedRefs).length, 0, scenario.id + ' budget confound');
    let decision;
    if (reply.answerPolicy === 'ALLOW_ANSWER') {
      decision = 'permit';
      assert.ok(reply.retrievalStatus === 'OK' && reply.recommendedAction === 'ANSWER', 'inconsistent permitted receipt');
      assert.deepEqual(delivered, eligible);
      assert.ok(reply.context && reply.contextHash && reply.contextPageRef, 'incomplete permitted context');
      assert.equal(conflictRefs.length + ambiguousRefs.length, 0);
      for (const item of reply.items) {
        assert.ok(item.excerpt === seeded.get(item.memoryId).text && reply.context.includes(item.excerpt), 'changed source text');
      }
    } else {
      assert.equal(reply.answerPolicy, 'DO_NOT_ANSWER_CONFIDENTLY', 'unknown answer policy');
      assert.ok(!delivered.length && !reply.context && !reply.contextHash && !reply.contextPageRef, 'withheld context exposed content');
      if (reply.retrievalStatus === 'AMBIGUOUS_WEEKDAY') {
        assert.equal(reply.recommendedAction, 'REQUIRE_CLARIFICATION');
        assert.ok(ambiguousRefs.length >= 2 && !conflictRefs.length, 'missing ambiguity witnesses');
        decision = 'clarify';
      } else if (reply.retrievalStatus === 'CONFLICTING_CONTEXT') {
        assert.equal(reply.recommendedAction, 'REQUIRE_CLARIFICATION');
        assert.ok(conflictRefs.length, 'missing conflict witnesses');
        decision = 'conflict';
      } else {
        assert.ok(['NO_RESULTS', 'PARTIAL_COVERAGE', 'STALE_CONTEXT', 'RETRY_REQUIRED'].includes(reply.retrievalStatus)
          && reply.recommendedAction === 'RETRY_RETRIEVAL', 'unknown withheld receipt');
        decision = 'retry';
      }
    }
    results.push({
      id: scenario.id, expected: scenario.expected, decision, status: reply.retrievalStatus,
      matched: decision === scenario.expected, eligible, delivered, ambiguousRefs, conflictRefs
    });
  }
  return results;
}

async function inTemporaryServer(jar) {
  const scratch = await mkdtemp(join(tmpdir(), 'graymatter-schedule-controls-'));
  const password = randomBytes(24).toString('hex');
  let child;
  let closed;
  let port;
  let stopping = false;
  function stop() {
    stopping = true;
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
  try {
    child = spawn('java', ['-jar', jar, '--server.address=127.0.0.1', '--server.port=0'], {
      cwd: scratch, stdio: ['ignore', 'pipe', 'pipe'], env: {
        PATH: process.env.PATH, HOME: process.env.HOME, GRAYMATTER_DATA_DIR: scratch,
        GRAYMATTER_ADMIN_USERNAME: 'admin', GRAYMATTER_ADMIN_PASSWORD: password,
        GRAYMATTER_DB_URL: 'jdbc:h2:mem:schedules;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE'
      }
    });
    let launchFailed = false;
    child.on('error', () => { launchFailed = true; });
    closed = new Promise(resolve => child.once('close', resolve));
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    // Spring logging configurations may send the startup announcement to either stream.
    for (const stream of [child.stdout, child.stderr]) {
      let tail = '';
      stream.on('data', chunk => {
        if (port) return;
        tail = (tail + chunk.toString()).slice(-32_768);
        const match = /Tomcat started on port (\d+)\s/.exec(tail);
        if (match) port = Number(match[1]);
      });
    }
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      if (stopping || launchFailed || child.exitCode !== null || child.signalCode !== null) {
        throw Error('Isolated Lite runtime failed to start or was interrupted');
      }
      if (port) {
        const healthy = await fetch('http://127.0.0.1:' + port + '/actuator/health',
          {redirect: 'error', signal: AbortSignal.timeout(1000)}).then(r => r.ok, () => false);
        if (healthy) return await runProbe(port, password);
      }
      await wait(125);
    }
    throw Error(port ? 'Local health check timed out' : 'Local runtime did not announce its port');
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    stop();
    if (child && closed) {
      const forceExit = setTimeout(() => child.kill('SIGKILL'), 5000);
      try { await closed; } finally { clearTimeout(forceExit); }
    }
    await rm(scratch, {recursive: true, force: true});
  }
}

async function main() {
  const args = process.argv.slice(2);
  const check = args[0] === '--check';
  if (check) args.shift();
  if (args.length !== 1 || args[0].startsWith('-')) throw Error('Usage: node schedule-controls.cjs [--check] /path/to/graymatter-local-server.jar');
  const jar = await realpath(args[0]);
  const manifestSha256 = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  assert.equal(manifestSha256, pinnedManifestSha256, 'Schedule-control manifest changed');
  const jarSha256 = await hashFile(jar);
  const driverSha256 = await hashFile(__filename);
  const cases = await inTemporaryServer(jar);
  const shouldPermit = cases.filter(row => row.expected === 'permit');
  const shouldClarify = cases.filter(row => row.expected === 'clarify');
  const alternate = manifest.cases.find(row => row.alternate);
  const observed = cases.find(row => row.id === alternate.id);
  const report = {
    manifestSha256, driverSha256, jarSha256, retrievalMode: manifest.retrievalMode, primaryCases: cases.length,
    falsePermissions: {count: shouldClarify.filter(row => row.decision === 'permit').length, denominator: shouldClarify.length},
    falseRefusals: {count: shouldPermit.filter(row => row.decision !== 'permit').length, denominator: shouldPermit.length},
    requiredClarifications: {matched: shouldClarify.filter(row => row.matched).length, denominator: shouldClarify.length},
    alternateInterpretation: {inputCase: alternate.id, world: alternate.alternate.world,
      expected: alternate.alternate.expected, decision: observed.decision, falseRefusals: {count: Number(observed.decision !== 'permit'), denominator: 1}},
    cases
  };
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (check && cases.some(row => !row.matched)) process.exitCode = 1;
}
main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
