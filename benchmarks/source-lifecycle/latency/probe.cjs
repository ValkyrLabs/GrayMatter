'use strict';
// Usage: node probe.cjs v3|v4 /path/to/pinned.jar > result.json
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { createHash, randomBytes } = require('node:crypto');
const { createReadStream } = require('node:fs');
const { mkdtemp, realpath, rm } = require('node:fs/promises');
const os = require('node:os');
const { join } = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');
const { performance } = require('node:perf_hooks');
const fixturePath = join(__dirname, 'fixture.json');
const fixture = require(fixturePath);

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}

function quantiles(rows) {
  const ordered = [...rows].sort((a, b) => a - b);
  const rank = q => ordered[Math.ceil(q * ordered.length) - 1];
  return { n: rows.length, p50Us: rank(0.50), p95Us: rank(0.95) };
}

async function measure(base, password, profile) {
  const basic = p => 'Basic ' + Buffer.from('admin:' + p).toString('base64');
  const auth = basic(password);
  const policy = 'bifrost-lite-context/' + profile;
  async function http(route, options = {}) {
    const start = performance.now();
    const response = await fetch(base + route, { ...options, signal: AbortSignal.timeout(30000), redirect: 'error' });
    const bytes = await response.arrayBuffer();
    const us = Math.round((performance.now() - start) * 1000);
    return { status: response.status, bytes: Buffer.from(bytes), us };
  }
  async function post(route, body) {
    const response = await http(route, { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 200, route);
    return JSON.parse(response.bytes);
  }
  assert.equal((await http('/actuator/health', { headers: { authorization: basic('synthetic-wrong-password') } })).status, 401);
  const ids = new Set();
  let expectedPointer;
  const stages = [];
  for (const count of fixture.scales) {
    const first = ids.size;
    async function seed(i) {
      const tags = i < fixture.narrowRows ? [fixture.wideTag, fixture.narrowTag] : [fixture.wideTag];
      const text = i === 0 ? fixture.target : fixture.fillerPrefix + i;
      const row = await post('/v1/MemoryEntry/write', { type: fixture.type, text, sourceChannel: fixture.source, tags });
      assert.match(row.id, /^[0-9a-f-]{36}$/i);
      assert.equal(row.text, text);
      assert.equal(row.sourceChannel, fixture.source);
      assert.equal(row.type, fixture.type);
      assert.deepEqual(row.tags.split(',').sort(), [...tags].sort());
      assert.ok(!ids.has(row.id));
      ids.add(row.id);
      if (i === 0) expectedPointer = row.id;
    }
    let next = first;
    await Promise.all(Array.from({ length: fixture.seedConcurrency }, async () => {
      while (next < count) await seed(next++);
    }));
    assert.equal(ids.size, count);
    const targets = {};
    for (const [name, tag] of Object.entries({ narrow: fixture.narrowTag, wide: fixture.wideTag })) {
      const receipt = await post('/v1/graymatter/retrieval-context', {
        query: fixture.query, topK: fixture.topK, tokenBudget: fixture.tokenBudget, retrievalMode: fixture.retrievalMode,
        filters: { source: fixture.source, type: fixture.type, tags: [tag] }
      });
      assert.equal(receipt.policyVersion, policy);
      assert.equal(receipt.retrievalStatus, 'OK');
      assert.deepEqual(receipt.items.map(row => row.memoryId), [expectedPointer]);
      targets[name] = receipt.receiptId;
    }
    const routes = ['narrow', 'wide', 'healthBasic', 'healthAnonymous'];
    const rawUs = Object.fromEntries(routes.map(route => [route, []]));
    for (let cycle = 0; cycle < fixture.warmupCycles + fixture.measuredCycles; cycle++) {
      // Rotate first position, reversing direction every four cycles to spread fixed-order bias.
      const direction = Math.floor(cycle / routes.length) % 2 ? -1 : 1;
      for (let i = 0; i < routes.length; i++) {
        const name = routes[(cycle + direction * i + routes.length) % routes.length];
        const id = targets[name];
        const route = id ? '/v1/graymatter-retrieval-receipts/' + id : '/actuator/health';
        const req = await http(route, name === 'healthAnonymous' ? {} : { headers: { authorization: auth } });
        assert.equal(req.status, 200, name);
        const result = JSON.parse(req.bytes);
        if (id) {
          assert.equal(result.receiptId, id);
          assert.equal(result.policyVersion, policy);
          assert.equal(result.recordedRetrievalStatus, 'OK');
          assert.equal(result.retrievalStatus, 'OK');
          assert.equal(result.answerPolicy, 'ALLOW_ANSWER');
          assert.equal(result.sourceCount, 1);
        } else assert.equal(result.status, 'UP');
        if (cycle >= fixture.warmupCycles) rawUs[name].push(req.us);
      }
    }
    for (const times of Object.values(rawUs)) assert.equal(times.length, fixture.measuredCycles);
    stages.push({ ownerRows: count, eligibleRows: { narrow: Math.min(count, fixture.narrowRows), wide: count },
      stats: Object.fromEntries(Object.entries(rawUs).map(([name, rows]) => [name, quantiles(rows)])), rawUs });
  }
  return stages;
}

async function run(profile, jarPath) {
  assert.ok(['v3', 'v4'].includes(profile) && jarPath, 'Usage: node probe.cjs v3|v4 /path/to/pinned.jar');
  const jar = await realpath(jarPath);
  const digest = await sha256(jar);
  assert.equal(digest, fixture.artifacts[profile], 'unexpected artifact');
  const scratch = await mkdtemp(join(os.tmpdir(), 'gm-inspection-latency-'));
  const password = randomBytes(24).toString('hex');
  const java = process.env.JAVA || 'java';
  const flags = [...fixture.heap, '-Djava.io.tmpdir=' + scratch];
  const startedAt = new Date().toISOString();
  let child, closed, stopping = false;
  const stop = () => { stopping = true; if (child && child.exitCode === null && !child.signalCode) child.kill('SIGTERM'); };
  try {
    child = spawn(java, [...flags, '-jar', jar, '--server.address=127.0.0.1', '--server.port=0', '--graymatter.starter-knowledge-pack.enabled=false'], {
      cwd: scratch, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, HOME: scratch,
        GRAYMATTER_DATA_DIR: scratch, GRAYMATTER_ADMIN_USERNAME: 'admin', GRAYMATTER_ADMIN_PASSWORD: password,
        GRAYMATTER_EMBEDDING_PROVIDER: 'feature-hash', GRAYMATTER_DB_URL: 'jdbc:h2:mem:latency;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE' }
    });
    let launchFailed = false, port;
    child.on('error', () => { launchFailed = true; });
    closed = new Promise(resolve => child.once('close', resolve));
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, stop);
    for (const stream of [child.stdout, child.stderr]) {
      let tail = '';
      stream.on('data', chunk => {
        if (port) return;
        tail = (tail + chunk.toString()).slice(-16000);
        const match = /Tomcat started on port (\d+)\s/.exec(tail);
        if (match) port = Number(match[1]);
      });
    }
    const deadline = Date.now() + 120000;
    let ready = false;
    while (!ready && Date.now() < deadline && !stopping && !launchFailed && child.exitCode === null && !child.signalCode) {
      if (port) ready = await fetch('http://127.0.0.1:' + port + '/actuator/health', { signal: AbortSignal.timeout(1000), redirect: 'error' })
        .then(async response => response.ok && (await response.json()).status === 'UP', () => false);
      if (!ready) await wait(150);
    }
    assert.ok(ready, 'isolated runtime failed to become healthy');
    const stages = await measure('http://127.0.0.1:' + port, password, profile);
    return { profile, jarSha256: digest, fixtureSha256: await sha256(fixturePath), runnerSha256: await sha256(__filename),
      startedAt, finishedAt: new Date().toISOString(), node: process.version, java: execFileSync(java, ['--version'], { encoding: 'utf8' }).trim(),
      os: os.type() + ' ' + os.release() + ' ' + os.arch(), cpu: os.cpus()[0].model, unit: 'microseconds',
      percentile: 'nearest-rank', warmupPerRoute: fixture.warmupCycles, measuredPerRoute: fixture.measuredCycles, stages };
  } finally {
    for (const signal of ['SIGTERM', 'SIGINT']) process.removeListener(signal, stop);
    stop();
    if (closed) {
      const force = setTimeout(() => child.kill('SIGKILL'), 5000);
      try { await closed; } finally { clearTimeout(force); }
    }
    await rm(scratch, { recursive: true, force: true });
  }
}
run(...process.argv.slice(2)).then(result => console.log(JSON.stringify(result, null, 2)))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
