#!/usr/bin/env node
'use strict';

// Usage: node tests/gm_lite_lifecycle_mcp_test.cjs /path/to/graymatter-local-server.jar
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createHash, randomBytes } = require('node:crypto');
const { once } = require('node:events');
const { copyFile, mkdtemp, realpath, rm } = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { setTimeout: sleep } = require('node:timers/promises');
const { createGrayMatterMcpServer } = require('../mcp-server/index.js');
const mcp = require.resolve('../mcp-server/index.js');
const names = ['lite_memory_revise', 'lite_memory_forget', 'lite_context_refresh'];
const hash = /^[0-9a-f]{64}$/;

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, 'close');
  child.kill('SIGTERM');
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
  try { await closed; } finally { clearTimeout(timeout); }
}

async function withStdio(environment, test, blockNetwork = false) {
  // A negative catalog probe must fail if it tries to make an upstream request.
  const args = blockNetwork ? ['--import', 'data:text/javascript,globalThis.fetch=()=>{process.exit(84)}'] : [];
  const child = spawn(process.execPath, [...args, mcp, '--stdio'], { env: environment, cwd: environment.HOME,
    stdio: ['pipe', 'pipe', 'ignore'] });
  const lines = readline.createInterface({input: child.stdout});
  const replies = lines[Symbol.asyncIterator]();
  let id = 0;
  async function rpc(method, params) {
    const request = {jsonrpc: '2.0', id: ++id, method, params};
    child.stdin.write(JSON.stringify(request) + '\n');
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(Error(method + ' timed out')), 30_000); });
    let line;
    try { line = await Promise.race([replies.next(), timeout]); } finally { clearTimeout(timer); }
    assert.ok(!line.done, 'MCP terminated before ' + method);
    const response = JSON.parse(line.value);
    assert.equal(response.id, request.id);
    if (response.error) throw Error(response.error.message);
    return response.result;
  }
  async function call(name, args) {
    const result = await rpc('tools/call', {name, arguments: args});
    assert.ok(!result.isError, name + ' tool error');
    return JSON.parse(result.content[0].text);
  }
  try {
    const initialized = await rpc('initialize', {
      protocolVersion: '2024-11-05', capabilities: {}, clientInfo: {name: 'lite-acceptance', version: '1'}
    });
    assert.equal(initialized.serverInfo.name, 'graymatter');
    child.stdin.write(JSON.stringify({jsonrpc: '2.0', method: 'notifications/initialized'}) + '\n');
    const list = await rpc('tools/list', {});
    return await test(new Set(list.tools.map(t => t.name)), call);
  } finally {
    lines.close(); child.stdin.end(); await stop(child);
  }
}

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return 'http://127.0.0.1:' + server.address().port;
}
async function close(server) {
  const closed = once(server, 'close');
  server.close(); server.closeAllConnections();
  await closed;
}

async function checkHiddenCatalogs(baseEnv) {
  const catalogAbsent = list => {
    assert.ok(list.has('memory_read'), 'private catalog missing its established tool');
    for (const name of names) assert.ok(!list.has(name), 'unexpected capability ' + name);
  };
  await withStdio({...baseEnv, VALKYR_API_BASE: 'https://upstream.invalid/v1'}, catalogAbsent, true);
  await withStdio({...baseEnv, GRAYMATTER_PROFILE_MODE: 'blend'}, catalogAbsent, true);
  await withStdio({...baseEnv, VALKYR_AUTH_TOKEN: 'synthetic-token'}, catalogAbsent, true);

  let upstream = 0;
  const server = createGrayMatterMcpServer({
    apiBase: 'https://upstream.invalid/v1', deploymentMode: 'hosted-multi-tenant', publicApp: true,
    publicResource: 'https://public.invalid', oauthIssuer: 'https://issuer.invalid',
    tokenVerifier: () => ({claims: {sub: 'synthetic', organizationId: 'test-org', tenantId: 'acceptance', scope: 'memory:read'}}),
    fetch: async () => { upstream++; throw Error('public catalog made an upstream call'); }
  });
  const local = await listen(server);
  try {
    const response = await fetch(local + '/graymatter/mcp', {method: 'POST', redirect: 'error',
      headers: {authorization: 'Bearer synthetic', 'content-type': 'application/json'},
      body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/list', params: {}})});
    assert.equal(response.status, 200);
    const listed = new Set((await response.json()).result.tools.map(t => t.name));
    assert.ok(listed.has('memory_forget'));
    for (const name of names) assert.ok(!listed.has(name));
    assert.equal(upstream, 0);
  } finally { await close(server); }
}

async function checkRedirect(baseEnv) {
  let redirectedCalls = 0, originalCalls = 0;
  const target = http.createServer((req, res) => { redirectedCalls++; res.writeHead(204); res.end(); });
  const destination = await listen(target);
  const redirect = http.createServer((req, res) => {
    originalCalls++; res.writeHead(307, {location: destination + '/would-mutate'}); res.end();
  });
  try {
    const local = await listen(redirect);
    await withStdio({...baseEnv, VALKYR_API_BASE: local + '/v1'}, async (list, call) => {
      assert.ok(list.has(names[1]));
      await assert.rejects(call('lite_memory_forget', {id: '00000000-0000-4000-8000-000000000001',
        expectedSourceHash: 'a'.repeat(64), confirmed: true}));
    });
    assert.equal(originalCalls, 1); assert.equal(redirectedCalls, 0);
  } finally { await close(redirect); await close(target); }
}

async function checkLifecycle(baseEnv) {
  return withStdio(baseEnv, async (list, call) => {
    for (const name of names) assert.ok(list.has(name), name + ' missing on local Basic profile');
    const base = {type: 'context', sourceChannel: 'acceptance-mcp', tags: ['active']};
    const created = await call('memory_write', {...base, text: 'Parcel counter opens at nine.'});
    assert.match(created.sourceHash, hash);
    const first = await call('memory_read', {id: created.id});
    assert.equal(first.id, created.id); assert.equal(first.sourceHash, created.sourceHash);
    const search = {query: 'Parcel counter', retrievalMode: 'KEYWORD', topK: 2, includeText: true,
      filters: {source: base.sourceChannel, tags: base.tags}};
    const parent = await call('graymatter_retrieval_context', search);
    assert.equal(parent.answerPolicy, 'ALLOW_ANSWER');
    assert.deepEqual(parent.items.map(item => item.memoryId), [created.id]);
    const edit = {id: created.id, expectedSourceHash: first.sourceHash, text: 'Parcel counter opens at ten.', tags: ['active','verified']};
    const updated = await call('lite_memory_revise', edit);
    assert.deepEqual(Object.keys(updated).sort(), ['id','sourceHash','tags','text']);
    assert.match(updated.sourceHash, hash); assert.notEqual(updated.sourceHash, first.sourceHash);
    assert.equal(updated.id, first.id); assert.equal(updated.text, edit.text); assert.equal(updated.tags, 'active,verified');
    await assert.rejects(call('lite_memory_revise', {...edit, text: 'A late client attempted to overwrite the source.'}), /412|changed|stale|revision|source hash/i);
    await assert.rejects(call('lite_memory_forget', {id: created.id, expectedSourceHash: first.sourceHash, confirmed: true}), /412|changed|stale|revision|source hash/i);
    const preserved = await call('memory_read', {id: created.id});
    assert.equal(preserved.sourceHash, updated.sourceHash); assert.equal(preserved.text, edit.text);
    assert.equal(preserved.tags, updated.tags); assert.equal(preserved.sourceChannel, base.sourceChannel);

    // A new in-scope dispute did not exist in the parent's original source set.
    const dispute = await call('memory_write', {...base, tags: ['active','unresolved'], text: 'Parcel counter opens at noon.'});
    const withheld = await call('retrieval_receipt_get', {receiptId: parent.receiptId});
    assert.equal(withheld.receiptId, parent.receiptId);
    assert.equal(withheld.retrievalStatus, 'STALE_CONTEXT');
    assert.equal(withheld.answerPolicy, 'DO_NOT_ANSWER_CONFIDENTLY');
    const refresh = {...search, receiptId: parent.receiptId};
    await assert.rejects(call('lite_context_refresh', {...refresh, filters: {source: 'different-scope'}}), /409|scope|original|selection/i);
    const fresh = await call('lite_context_refresh', refresh);
    assert.equal(fresh.sourceSelection, 'FRESH_SEARCH'); assert.equal(fresh.parentReceiptId, parent.receiptId);
    assert.notEqual(fresh.receiptId, parent.receiptId); assert.equal(fresh.retrievalStatus, 'CONFLICTING_CONTEXT');
    assert.equal(fresh.answerPolicy, 'DO_NOT_ANSWER_CONFIDENTLY'); assert.ok(!fresh.context && !fresh.contextPageRef && !fresh.contextHash);
    assert.deepEqual(fresh.items || [], []);
    assert.deepEqual(fresh.conflictRefs, [dispute.id]);
    for (const text of [created.text, updated.text, dispute.text]) assert.ok(!JSON.stringify(fresh).includes(text));

    const deletion = {id: created.id, expectedSourceHash: updated.sourceHash};
    await assert.rejects(call('lite_memory_forget', {...deletion, confirmed: false}), /confirm/i);
    assert.equal((await call('memory_read', {id: created.id})).sourceHash, updated.sourceHash);
    assert.deepEqual(await call('lite_memory_forget', {...deletion, confirmed: true}), {id: created.id, forgotten: true});
    await assert.rejects(call('memory_read', {id: created.id}), /404|not found/i);
    assert.equal((await call('memory_read', {id: dispute.id})).sourceHash, dispute.sourceHash);
    return {original: {id: parent.receiptId, issued: parent.retrievalStatus, rechecked: withheld.retrievalStatus},
      fresh: {id: fresh.receiptId, parent: fresh.parentReceiptId, selection: fresh.sourceSelection,
        status: fresh.retrievalStatus, answerPolicy: fresh.answerPolicy}};
  });
}

async function checkAssociations(environment) {
  return withStdio(environment, async (catalog, call) => {
    assert.ok(catalog.has('memory_link'));
    const source = {type: 'context', sourceChannel: 'synthetic-association', tags: ['navigation-control']};
    const left = await call('memory_write', {...source, text: 'Quartz dock policy A.'});
    const right = await call('memory_write', {...source, text: 'Quartz dock policy B.'});
    const query = {query: 'Quartz dock policy', filters: {source: source.sourceChannel}, retrievalMode: 'KEYWORD', topK: 2};
    const before = await call('graymatter_retrieval_context', query);
    const tuple = {fromId: left.id, toId: right.id, relation: 'supersedes'};
    const first = await call('memory_link', tuple);
    assert.equal(first.status, 'linked'); assert.equal(first.replayed, false);
    assert.deepEqual(await call('memory_link', tuple), {...first, replayed: true});
    const reverse = await call('memory_link', {fromId: right.id, toId: left.id, relation: tuple.relation});
    assert.notEqual(reverse.associationRef, first.associationRef); assert.notEqual(reverse.tupleHash, first.tupleHash);
    const reread = await call('retrieval_receipt_get', {receiptId: before.receiptId});
    assert.equal(reread.retrievalStatus, before.retrievalStatus);
    assert.equal(reread.answerPolicy, before.answerPolicy);
    const afterLink = await call('graymatter_retrieval_context', query);
    assert.equal(afterLink.retrievalStatus, before.retrievalStatus);
    assert.equal(afterLink.answerPolicy, before.answerPolicy);
    assert.deepEqual(afterLink.items.map(i => i.memoryId), before.items.map(i => i.memoryId));
    assert.deepEqual(new Set(afterLink.items.map(i => i.memoryId)), new Set([left.id, right.id]));
    const revision = await call('lite_memory_revise', {id: left.id, expectedSourceHash: left.sourceHash, text: 'Quartz dock policy A revised.'});
    assert.deepEqual(await call('memory_link', tuple), {...first, replayed: true});
    assert.deepEqual(await call('lite_memory_forget', {id: left.id, expectedSourceHash: revision.sourceHash, confirmed: true}), {id:left.id, forgotten:true});
    for (const ref of [first.associationRef, reverse.associationRef]) {
      const response = await fetch(environment.VALKYR_API_BASE + '/graymatter/memory/associations/' + ref, {
        headers:{authorization:'Basic ' + Buffer.from(environment.GRAYMATTER_LIGHT_USERNAME + ':' + environment.GRAYMATTER_LIGHT_PASSWORD).toString('base64')},
        redirect:'error', signal:AbortSignal.timeout(5000)});
      assert.equal(response.status, 404); await response.body?.cancel();
    }
    await assert.rejects(call('memory_link', tuple), /tool error/u);
    assert.equal((await call('memory_read', {id: right.id})).sourceHash, right.sourceHash);
    return {firstRef: first.associationRef, reverseRef: reverse.associationRef, tupleHash: first.tupleHash, authoredRetrievalUnaffected: true,
      correctionPreservedIdentity: true, forgottenIncidentReads: [404, 404]};
  });
}

async function checkAssociationRecall(environment) {
  return withStdio(environment, async (catalog, call) => {
    for (const name of ['memory_retrieve_with_receipt', 'memory_link', 'lite_context_refresh']) {
      assert.ok(catalog.has(name), 'missing private recall entrypoint ' + name);
    }
    const source = {type: 'context', sourceChannel: 'synthetic-associated-recall'};
    const anchor = await call('memory_write', {...source,
      text: 'Aster courier dispatch. Aster courier route information follows. Aster courier pickup details are in an attached note.'});
    const detail = await call('memory_write', {...source,
      text: 'Courier pickup code is cobalt-seven. Bring a canvas pouch.'});
    const distractor = await call('memory_write', {...source,
      text: 'Mural restoration uses gold leaf and soft brushes.'});
    // memory_retrieve_with_receipt has no tokenBudget input; preserve its default on refresh.
    const query = {query: 'Aster courier', retrievalMode: 'KEYWORD', topK: 1,
      includeText: true, filters: {source: source.sourceChannel}};
    const ordinary = await call('graymatter_retrieval_context', query);
    assert.deepEqual(ordinary.items.map(item => item.memoryId), [anchor.id]);
    assert.ok(!ordinary.associationPolicyVersion);
    const empty = await call('memory_retrieve_with_receipt', {...query, includeAssociations: true});
    assert.equal(empty.associationPolicyVersion, 'graymatter-association-recall/v1');
    assert.deepEqual(empty.associationRefs, []);
    const link = await call('memory_link', {fromId: anchor.id, toId: detail.id, relation: 'has detail'});
    await call('memory_link', {fromId: anchor.id, toId: distractor.id, relation: 'supersedes'});
    const staleEmpty = await call('retrieval_receipt_get', {receiptId: empty.receiptId});
    assert.equal(staleEmpty.retrievalStatus, 'STALE_CONTEXT');
    assert.deepEqual(staleEmpty.associationRefs ?? [], []);
    const refreshArgs = {...query, receiptId: empty.receiptId, includeAssociations: true};
    await assert.rejects(call('lite_context_refresh', {...refreshArgs, includeAssociations: false}), /409|original|scope|selection/i);
    const fresh = await call('lite_context_refresh', refreshArgs);
    assert.equal(fresh.parentReceiptId, empty.receiptId);
    assert.equal(fresh.answerPolicy, 'ALLOW_ANSWER');
    assert.deepEqual(new Set(fresh.items.map(item => item.memoryId)), new Set([anchor.id, detail.id]));
    assert.ok(fresh.context.includes('cobalt-seven'));
    assert.ok(!fresh.context.includes(distractor.text));
    assert.equal(fresh.associationRefs.length, 1);
    const trace = fresh.associationRefs[0];
    assert.deepEqual(Object.keys(trace).sort(), ['associationRef', 'anchorId', 'memoryId',
      'associationHash', 'anchorSourceHash', 'sourceHash'].sort());
    assert.equal(trace.associationRef, link.associationRef);
    assert.equal(trace.anchorId, anchor.id); assert.equal(trace.memoryId, detail.id);
    assert.equal(trace.anchorSourceHash, anchor.sourceHash); assert.equal(trace.sourceHash, detail.sourceHash);
    assert.match(trace.associationHash, hash);
    assert.equal(fresh.associationTruncated, false);
    const revised = await call('lite_memory_revise', {id: anchor.id, expectedSourceHash: anchor.sourceHash,
      text: anchor.text + ' Checkpoint revised.'});
    const withheld = await call('retrieval_receipt_get', {receiptId: fresh.receiptId});
    assert.equal(withheld.retrievalStatus, 'STALE_CONTEXT');
    assert.deepEqual(withheld.associationRefs ?? [], []);
    const replacement = await call('lite_context_refresh', {...query, receiptId: fresh.receiptId, includeAssociations: true});
    assert.equal(replacement.parentReceiptId, fresh.receiptId);
    assert.equal(replacement.associationRefs[0].anchorSourceHash, revised.sourceHash);
    assert.equal(replacement.answerPolicy, 'ALLOW_ANSWER');
    await call('lite_memory_forget', {id: detail.id, expectedSourceHash: detail.sourceHash, confirmed: true});
    const forgotten = await call('retrieval_receipt_get', {receiptId: replacement.receiptId});
    assert.equal(forgotten.retrievalStatus, 'STALE_CONTEXT');
    assert.deepEqual(forgotten.associationRefs ?? [], []);
    return {emptyReceipt: empty.receiptId, freshReceipt: fresh.receiptId,
      refreshedParent: fresh.parentReceiptId, associationRef: link.associationRef,
      selectedSourceIds: [anchor.id, detail.id], excludedSourceId: distractor.id,
      correctedReceipt: replacement.receiptId, correctedParent: replacement.parentReceiptId,
      priorReceiptAfterCorrection: withheld.retrievalStatus, afterForget: forgotten.retrievalStatus,
      exactSourceHashesVerified: true, toggledRefreshRejected: true};
  });
}

async function main() {
  const associationRecall = process.argv[3] === '--association-recall';
  const associations = process.argv[3] === '--associations' || associationRecall;
  assert.equal(process.argv.length, associations ? 4 : 3,
    'Pass a local Lite JAR and optionally --associations or --association-recall');
  const requestedJar = await realpath(process.argv[2]);
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'gm-lifecycle-mcp-'));
  const jar = path.join(scratch, 'verified-server.jar');
  await copyFile(requestedJar, jar);
  const password = randomBytes(32).toString('hex');
  const environment = {HOME: scratch, PATH: process.env.PATH, TMPDIR: scratch};
  const runtime = spawn('java', ['-Djava.io.tmpdir=' + scratch, '-jar', jar, '--server.address=127.0.0.1', '--server.port=0'],
    {cwd: scratch, env: {...environment, GRAYMATTER_ADMIN_USERNAME: 'admin', GRAYMATTER_ADMIN_PASSWORD: password,
      GRAYMATTER_DATA_DIR: scratch, GRAYMATTER_DB_URL: 'jdbc:h2:mem:mcp_lifecycle;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE'},
      stdio: ['ignore','pipe','pipe']});
  let port, startupError;
  runtime.on('error', error => { startupError = error; });
  const readLog = chunk => {
    const match = /Tomcat started on port (\d+)/.exec(chunk.toString());
    if (match) port = Number(match[1]);
  };
  runtime.stdout.on('data', readLog); runtime.stderr.on('data', readLog);
  const halt = () => runtime.kill('SIGTERM');
  process.once('SIGINT', halt); process.once('SIGTERM', halt);
  try {
    const end = Date.now() + 120_000;
    let local;
    while (Date.now() < end && runtime.exitCode === null && !runtime.signalCode && !startupError) {
      if (port) {
        const address = 'http://127.0.0.1:' + port;
        const healthy = await fetch(address + '/actuator/health', {redirect: 'error', signal: AbortSignal.timeout(2000)})
          .then(response => response.ok, () => false);
        if (healthy) { local = address; break; }
      }
      await sleep(100);
    }
    assert.ok(local, 'isolated Lite server did not become healthy');
    const baseEnv = {...environment, VALKYR_API_BASE: local + '/v1', GRAYMATTER_LIGHT_USERNAME: 'admin',
      GRAYMATTER_LIGHT_PASSWORD: password, GRAYMATTER_PROFILE_MODE: 'single', GRAYMATTER_SCHEMA_REFRESH_COMMAND: '/usr/bin/false',
      GRAYMATTER_LOGIN_COMMAND: '/usr/bin/false', GRAYMATTER_API_COMMAND: '/usr/bin/false'};
    await checkHiddenCatalogs(baseEnv);
    await checkRedirect(baseEnv);
    const receipts = await checkLifecycle(baseEnv);
    const associationResult = associations ? await checkAssociations(baseEnv) : undefined;
    const recallResult = associationRecall ? await checkAssociationRecall(baseEnv) : undefined;
    async function digest(file) {
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(file)) hash.update(chunk);
      return hash.digest('hex');
    }
    const [jarSha256, runnerSha256, adapterSha256, lifecycleSha256] = await Promise.all(
      [jar, __filename, mcp, require.resolve('../mcp-server/lib/lite-lifecycle.cjs')].map(digest));
    console.log(JSON.stringify({passed: true, jarSha256, runnerSha256, adapterSha256, lifecycleSha256,
      rejectedRedirects: 1, hiddenCatalogs: ['remote', 'blend', 'bearer', 'public'],
      receipts, exactDeletionVerified: true, associations: associationResult, associationRecall: recallResult}, null, 2));
  } finally {
    process.removeListener('SIGINT', halt); process.removeListener('SIGTERM', halt);
    await stop(runtime); await rm(scratch, {recursive: true, force: true});
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
