const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const { once } = require('node:events');
const path = require('node:path');
const test = require('node:test');

const { createGrayMatterMcpServer } = require('../index.js');

test.after(async () => {
  try {
    const { getGlobalDispatcher } = require('undici');
    await Promise.race([
      getGlobalDispatcher().close(),
      new Promise((resolve) => setTimeout(resolve, 250))
    ]);
  } catch {
    // Node versions without public undici exports do not need this teardown.
  }
  for (const handle of process._getActiveHandles()) {
    if (handle && handle.constructor && handle.constructor.name === 'Server' && typeof handle.close === 'function') {
      handle.close();
    }
    if (handle && handle.constructor && handle.constructor.name === 'Socket' && typeof handle.destroy === 'function') {
      if (handle.localPort || handle.remotePort) {
        handle.destroy();
      }
    }
  }
  setImmediate(() => process.exit(process.exitCode || 0));
});

async function listen(server) {
  if (!server.__grayMatterTrackedSockets) {
    const sockets = new Set();
    const close = server.close.bind(server);
    server.__grayMatterTrackedSockets = sockets;
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    server.close = (callback) => {
      for (const socket of sockets) {
        socket.destroy();
      }
      return close(callback);
    };
  }
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : null;
}

function createFakeApi(handler) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const body = await readBody(req);
    const record = {
      method: req.method,
      path: new URL(req.url, 'http://fake.local').pathname,
      query: new URL(req.url, 'http://fake.local').searchParams,
      headers: req.headers,
      body
    };
    requests.push(record);
    await handler(req, res, record);
  });
  return { server, requests };
}

async function postRpc(baseUrl, payload, headers = {}, path = '/') {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers
    },
    body: JSON.stringify(payload)
  });
  return {
    status: response.status,
    body: await response.json()
  };
}

function unsignedJwt(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.`;
}

async function readSsePreamble(baseUrl) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${baseUrl}/sse`, (res) => {
      let raw = '';
      res.on('data', (chunk) => {
        raw += chunk.toString('utf8');
        if (raw.includes('\n\n')) {
          req.destroy();
          resolve({ status: res.statusCode, body: raw });
        }
      });
    });
    req.on('error', (error) => {
      if (error.code !== 'ECONNRESET') {
        reject(error);
      }
    });
    req.setTimeout(2000, () => {
      req.destroy();
      reject(new Error('SSE preamble timed out'));
    });
  });
}

function readJsonLine(stream) {
  return new Promise((resolve, reject) => {
    let raw = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('stdio response timed out'));
    }, 2000);

    function cleanup() {
      clearTimeout(timer);
      stream.off('data', onData);
      stream.off('error', onError);
    }

    function onError(error) {
      cleanup();
      reject(error);
    }

    function onData(chunk) {
      raw += chunk.toString('utf8');
      const newlineIndex = raw.indexOf('\n');
      if (newlineIndex === -1) {
        return;
      }

      const line = raw.slice(0, newlineIndex);
      cleanup();
      try {
        resolve(JSON.parse(line));
      } catch (error) {
        reject(new Error(`Invalid JSON line from stdio server: ${line}`));
      }
    }

    stream.on('data', onData);
    stream.on('error', onError);
  });
}

test('health reports server readiness without api-0 auth', async () => {
  const server = createGrayMatterMcpServer({ apiBase: 'https://api-0.example.test/v1' });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.apiBase, 'https://api-0.example.test/v1');
    assert.ok(body.tools.includes('memory_write'));
    assert.ok(body.tools.includes('schema_summary'));
  } finally {
    server.close();
  }
});

test('stdio mode exposes the GrayMatter MCP tools for Codex plugin launch', async () => {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'index.js'), '--stdio'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      VALKYR_API_BASE: 'https://api-0.example.test/v1',
      VALKYR_AUTH_TOKEN: ['stdio', 'credential'].join('-')
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  try {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 'init', method: 'initialize' })}\n`);
    const init = await readJsonLine(child.stdout);
    assert.equal(init.id, 'init');
    assert.equal(init.result.serverInfo.name, 'graymatter');

    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 'tools', method: 'tools/list' })}\n`);
    const listed = await readJsonLine(child.stdout);
    assert.deepEqual(
      listed.result.tools.map((tool) => tool.name),
      [
        'memory_write',
        'memory_put',
        'memory_read',
        'memory_get',
        'memory_query',
        'memory_put_batch',
        'memory_link',
        'memory_health',
        'memory_replay_deferred',
        'memory_retrieve_with_receipt',
        'omega_remember',
        'omega_plan',
        'omega_recall',
        'omega_forget',
        'omega_trajectory_get',
        'omega_evaluate',
        'retrieval_receipt_get',
        'retrieval_receipt_query',
        'graph_get',
        'graymatter_status',
        'graymatter_semantic_search',
        'graymatter_semantic_reindex',
        'graymatter_object_graph_shape',
        'graymatter_retrieval_tools',
        'graymatter_retrieval_context',
        'graymatter_invariant_preflight',
        'graymatter_activation_bridge',
        'graymatter_mcp_bundle',
        'entity_list',
        'entity_get',
        'entity_create',
        'show_graymatter_overview',
        'schema_summary'
      ]
    );
  } finally {
    child.stdin.end();
    child.kill();
    await Promise.race([
      once(child, 'exit'),
      new Promise((resolve) => setTimeout(resolve, 250))
    ]);
    child.stdout.destroy();
    child.stderr.destroy();
  }
});

test('initialize works through the paired message endpoint', async () => {
  const server = createGrayMatterMcpServer({ apiBase: 'https://api-0.example.test/v1' });
  const baseUrl = await listen(server);

  try {
    const response = await fetch(`${baseUrl}/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'init-1',
        method: 'initialize'
      })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.id, 'init-1');
    assert.equal(body.result.serverInfo.name, 'graymatter');
    assert.deepEqual(body.result.capabilities, { tools: {}, resources: {} });
  } finally {
    server.close();
  }
});

test('initialize works through the Apps SDK /mcp endpoint', async () => {
  const server = createGrayMatterMcpServer({ apiBase: 'https://api-0.example.test/v1' });
  const baseUrl = await listen(server);

  try {
    const result = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'init-apps-sdk',
      method: 'initialize'
    }, {}, '/mcp');

    assert.equal(result.status, 200);
    assert.equal(result.body.id, 'init-apps-sdk');
    assert.equal(result.body.result.serverInfo.name, 'graymatter');
  } finally {
    server.close();
  }
});

test('sse announces the paired message endpoint', async () => {
  const server = createGrayMatterMcpServer({ apiBase: 'https://api-0.example.test/v1' });
  const baseUrl = await listen(server);

  try {
    const response = await readSsePreamble(baseUrl);

    assert.equal(response.status, 200);
    assert.match(response.body, /event: endpoint/);
    assert.match(response.body, /data: \/message/);
  } finally {
    server.close();
  }
});

test('tools/list exposes Apps SDK metadata required for review', async () => {
  const server = createGrayMatterMcpServer({ apiBase: 'https://api-0.example.test/v1' });
  const baseUrl = await listen(server);

  try {
    const result = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list'
    });

    assert.equal(result.status, 200);

    for (const tool of result.body.result.tools) {
      assert.equal(typeof tool.title, 'string', `${tool.name} title`);
      assert.ok(tool.title.length > 0, `${tool.name} title`);
      assert.deepEqual(tool.securitySchemes, [
        { type: 'apiKey', in: 'header', name: 'X-Valkyr-Token' },
        { type: 'http', scheme: 'bearer' }
      ]);
      assert.deepEqual(tool._meta.securitySchemes, tool.securitySchemes);
      assert.equal(typeof tool._meta['openai/toolInvocation/invoking'], 'string', `${tool.name} invoking text`);
      assert.equal(typeof tool._meta['openai/toolInvocation/invoked'], 'string', `${tool.name} invoked text`);
      assert.equal(typeof tool.annotations.readOnlyHint, 'boolean', `${tool.name} readOnlyHint`);
      assert.equal(typeof tool.annotations.destructiveHint, 'boolean', `${tool.name} destructiveHint`);
      assert.equal(typeof tool.annotations.openWorldHint, 'boolean', `${tool.name} openWorldHint`);
    }

    const overview = result.body.result.tools.find((tool) => tool.name === 'show_graymatter_overview');
    assert.ok(overview, 'show_graymatter_overview is present');
    assert.equal(overview._meta.ui.resourceUri, 'ui://graymatter/overview.html');
    assert.equal(overview._meta['openai/outputTemplate'], 'ui://graymatter/overview.html');
  } finally {
    server.close();
  }
});

test('resources expose the GrayMatter Apps SDK overview widget', async () => {
  const server = createGrayMatterMcpServer({
    apiBase: 'https://api-0.example.test/v1',
    widgetDomain: 'https://graymatter.example.test'
  });
  const baseUrl = await listen(server);

  try {
    const listed = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'resources',
      method: 'resources/list'
    });

    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body.result.resources, [
      {
        uri: 'ui://graymatter/overview.html',
        name: 'GrayMatter overview',
        title: 'GrayMatter overview',
        description: 'Overview card for GrayMatter durable memory, retrieval receipts, and schema tools.',
        mimeType: 'text/html;profile=mcp-app'
      }
    ]);

    const read = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'resource',
      method: 'resources/read',
      params: { uri: 'ui://graymatter/overview.html' }
    });

    assert.equal(read.status, 200);
    assert.equal(read.body.result.contents.length, 1);
    assert.equal(read.body.result.contents[0].uri, 'ui://graymatter/overview.html');
    assert.equal(read.body.result.contents[0].mimeType, 'text/html;profile=mcp-app');
    assert.match(read.body.result.contents[0].text, /GrayMatter/);
    assert.deepEqual(read.body.result.contents[0]._meta.ui.csp.connectDomains, [
      'https://api-0.valkyrlabs.com'
    ]);
    assert.equal(read.body.result.contents[0]._meta.ui.domain, 'https://graymatter.example.test');
    assert.equal(read.body.result.contents[0]._meta['openai/widgetDomain'], 'https://graymatter.example.test');
  } finally {
    server.close();
  }
});

test('tools/list exposes the GrayMatter tool surface', async () => {
  const server = createGrayMatterMcpServer({ apiBase: 'https://api-0.example.test/v1' });
  const baseUrl = await listen(server);

  try {
    const result = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list'
    });

    assert.equal(result.status, 200);
    assert.deepEqual(
      result.body.result.tools.map((tool) => tool.name),
      [
        'memory_write',
        'memory_put',
        'memory_read',
        'memory_get',
        'memory_query',
        'memory_put_batch',
        'memory_link',
        'memory_health',
        'memory_replay_deferred',
        'memory_retrieve_with_receipt',
        'omega_remember',
        'omega_plan',
        'omega_recall',
        'omega_forget',
        'omega_trajectory_get',
        'omega_evaluate',
        'retrieval_receipt_get',
        'retrieval_receipt_query',
        'graph_get',
        'graymatter_status',
        'graymatter_semantic_search',
        'graymatter_semantic_reindex',
        'graymatter_object_graph_shape',
        'graymatter_retrieval_tools',
        'graymatter_retrieval_context',
        'graymatter_invariant_preflight',
        'graymatter_activation_bridge',
        'graymatter_mcp_bundle',
        'entity_list',
        'entity_get',
        'entity_create',
        'show_graymatter_overview',
        'schema_summary'
      ]
    );
  } finally {
    server.close();
  }
});

test('OmegaRAG MCP tools use governed plan, recall, forget, trajectory, and evaluation contracts without client identity', async () => {
  const fakeApi = createFakeApi(async (_req, res, record) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    if (record.path === '/v1/graymatter/omega/remember' && record.method === 'POST') {
      assert.equal(record.body.text, 'remember this decision');
      assert.equal(record.body.type, 'decision');
      assert.equal(record.body.idempotencyKey, 'remember-1');
      assert.equal(record.body.ownerId, undefined);
      assert.equal(record.body.tenantId, undefined);
      res.end(JSON.stringify({ memoryRef: 'mem-1', receiptRef: 'rr-remember-1', replayed: false }));
      return;
    }
    if (record.path === '/v1/graymatter/omega/recall' && record.method === 'POST') {
      assert.equal(record.body.query, 'what changed');
      assert.equal(record.body.mode, 'BALANCED');
      assert.equal(record.body.idempotencyKey, 'recall-1');
      assert.equal(record.body.ownerId, undefined);
      assert.equal(record.body.tenantId, undefined);
      res.end(JSON.stringify({ receiptRef: 'rr-1', trajectoryRef: 'traj-1', scopeHash: 'a'.repeat(64) }));
      return;
    }
    if (record.path === '/v1/graymatter/omega/plan' && record.method === 'POST') {
      assert.equal(record.body.query, 'what changed');
      assert.equal(record.body.mode, 'DEEP');
      assert.equal(record.body.idempotencyKey, 'plan-1');
      assert.equal(record.body.ownerId, undefined);
      assert.equal(record.body.tenantId, undefined);
      res.end(JSON.stringify({ plan: { planId: 'plan-1' }, steps: [], replayed: false, warnings: [] }));
      return;
    }
    if (record.path === '/v1/graymatter/omega/forget' && record.method === 'POST') {
      assert.equal(record.body.memoryRef, '11111111-1111-4111-8111-111111111111');
      assert.equal(record.body.idempotencyKey, 'forget-1');
      assert.equal(record.body.ownerId, undefined);
      assert.equal(record.body.tenantId, undefined);
      res.end(JSON.stringify({ memoryRef: record.body.memoryRef, deletionStatus: 'deleted', replayed: false }));
      return;
    }
    if (record.path === '/v1/graymatter/omega/trajectories/traj-1' && record.method === 'GET') {
      res.end(JSON.stringify({ trajectory: { trajectoryId: 'traj-1' }, steps: [] }));
      return;
    }
    if (record.path === '/v1/graymatter/omega/evaluate' && record.method === 'POST') {
      assert.equal(record.body.trajectoryId, 'traj-1');
      assert.equal(record.body.profile, 'MEMORY_RECALL');
      assert.equal(record.body.ownerId, undefined);
      assert.equal(record.body.tenantId, undefined);
      res.end(JSON.stringify({ evaluation: { evaluationId: 'eval-1' }, replayed: false }));
      return;
    }
    throw new Error(`Unexpected ${record.method} ${record.path}`);
  });

  const apiBase = await listen(fakeApi.server);
  const server = createGrayMatterMcpServer({ apiBase: `${apiBase}/v1` });
  const baseUrl = await listen(server);

  try {
    const remember = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'omega-remember',
      method: 'tools/call',
      params: {
        name: 'omega_remember',
        arguments: { text: 'remember this decision', type: 'decision', idempotencyKey: 'remember-1' }
      }
    });
    const plan = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'omega-plan',
      method: 'tools/call',
      params: {
        name: 'omega_plan',
        arguments: { query: 'what changed', mode: 'DEEP', idempotencyKey: 'plan-1' }
      }
    });
    const recall = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'omega-recall',
      method: 'tools/call',
      params: {
        name: 'omega_recall',
        arguments: { query: 'what changed', mode: 'BALANCED', idempotencyKey: 'recall-1' }
      }
    });
    const forget = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'omega-forget',
      method: 'tools/call',
      params: {
        name: 'omega_forget',
        arguments: {
          memoryRef: '11111111-1111-4111-8111-111111111111',
          idempotencyKey: 'forget-1',
          reason: 'user requested deletion'
        }
      }
    });
    const trajectory = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'omega-trajectory',
      method: 'tools/call',
      params: { name: 'omega_trajectory_get', arguments: { trajectoryId: 'traj-1' } }
    });
    const evaluation = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'omega-evaluate',
      method: 'tools/call',
      params: {
        name: 'omega_evaluate',
        arguments: { trajectoryId: 'traj-1', profile: 'MEMORY_RECALL' }
      }
    });

    assert.deepEqual(JSON.parse(remember.body.result.content[0].text), {
      memoryRef: 'mem-1', receiptRef: 'rr-remember-1', replayed: false
    });
    assert.deepEqual(JSON.parse(plan.body.result.content[0].text), {
      plan: { planId: 'plan-1' }, steps: [], replayed: false, warnings: []
    });
    assert.deepEqual(JSON.parse(recall.body.result.content[0].text), {
      receiptRef: 'rr-1', trajectoryRef: 'traj-1', scopeHash: 'a'.repeat(64)
    });
    assert.deepEqual(JSON.parse(forget.body.result.content[0].text), {
      memoryRef: '11111111-1111-4111-8111-111111111111', deletionStatus: 'deleted', replayed: false
    });
    assert.deepEqual(JSON.parse(trajectory.body.result.content[0].text), {
      trajectory: { trajectoryId: 'traj-1' }, steps: []
    });
    assert.deepEqual(JSON.parse(evaluation.body.result.content[0].text), {
      evaluation: { evaluationId: 'eval-1' }, replayed: false
    });
    assert.equal(fakeApi.requests.length, 6);
  } finally {
    server.close();
    fakeApi.server.close();
  }
});

test('memory_read, memory_query, and graph_get route to api-0', async () => {
  const fakeApi = createFakeApi(async (_req, res, record) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    if (record.path === '/v1/MemoryEntry/mem-42') {
      res.end(JSON.stringify({ id: 'mem-42', text: 'remembered' }));
      return;
    }
    if (record.path === '/v1/MemoryEntry/query') {
      assert.equal(record.method, 'POST');
      assert.equal(record.body.query, 'remember');
      res.end(JSON.stringify({ results: [{ id: 'mem-42' }] }));
      return;
    }
    if (record.path === '/v1/swarm-ops/graph') {
      res.end(JSON.stringify({ nodes: [], edges: [] }));
      return;
    }
    throw new Error(`Unexpected path ${record.path}`);
  });

  const apiBase = await listen(fakeApi.server);
  const server = createGrayMatterMcpServer({ apiBase: `${apiBase}/v1` });
  const baseUrl = await listen(server);

  try {
    const readResult = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'read',
      method: 'tools/call',
      params: { name: 'memory_read', arguments: { id: 'mem-42' } }
    });
    const queryResult = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'query',
      method: 'tools/call',
      params: { name: 'memory_query', arguments: { query: 'remember', limit: 5 } }
    });
    const graphResult = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'graph',
      method: 'tools/call',
      params: { name: 'graph_get', arguments: {} }
    });

    assert.deepEqual(JSON.parse(readResult.body.result.content[0].text), { id: 'mem-42', text: 'remembered' });
    assert.deepEqual(JSON.parse(queryResult.body.result.content[0].text), { results: [{ id: 'mem-42' }] });
    assert.deepEqual(JSON.parse(graphResult.body.result.content[0].text), { nodes: [], edges: [] });
    assert.equal(fakeApi.requests.length, 3);
  } finally {
    server.close();
    fakeApi.server.close();
  }
});

test('memory_query accepts small-model query aliases and raw string arguments', async () => {
  const seenQueries = [];
  const fakeApi = createFakeApi(async (_req, res, record) => {
    assert.equal(record.path, '/v1/MemoryEntry/query');
    assert.equal(record.method, 'POST');
    seenQueries.push(record.body.query);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ results: [] }));
  });

  const apiBase = await listen(fakeApi.server);
  const server = createGrayMatterMcpServer({ apiBase: `${apiBase}/v1` });
  const baseUrl = await listen(server);

  try {
    await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'prompt-alias',
      method: 'tools/call',
      params: { name: 'memory_query', arguments: { prompt: 'launch plan', limit: 3 } }
    });
    await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'raw-string',
      method: 'tools/call',
      params: { name: 'memory_query', arguments: 'handoff notes' }
    });

    assert.deepEqual(seenQueries, ['launch plan', 'handoff notes']);
  } finally {
    server.close();
    fakeApi.server.close();
  }
});

test('GrayMatter capability tools expose the server-side memory and graph power surface', async () => {
  const fakeApi = createFakeApi(async (_req, res, record) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    if (record.path === '/v1/memory/status') {
      res.end(JSON.stringify({ ready: true }));
      return;
    }
    if (record.path === '/v1/memory/semantic-index/search') {
      assert.equal(record.method, 'POST');
      assert.equal(record.body.query, 'customer memory');
      assert.equal(record.body.limit, 3);
      res.end(JSON.stringify({ matches: [] }));
      return;
    }
    if (record.path === '/v1/memory/reindex') {
      assert.equal(record.method, 'POST');
      assert.equal(record.body.dryRun, true);
      assert.deepEqual(record.body.entryTypes, ['context']);
      res.end(JSON.stringify({ action: 'reindex', entriesAffected: 2 }));
      return;
    }
    if (record.path === '/v1/memory/semantic-index/reindex') {
      assert.equal(record.method, 'POST');
      assert.equal(record.body.estimateOnly, true);
      assert.equal(record.body.tenantScope, 'tenant-alpha');
      assert.equal(record.body.sources[0].targetType, 'MemoryEntry');
      assert.equal(record.body.sources[0].targetId, 'mem-1');
      assert.equal(record.body.sources[0].sourceText, 'source evidence');
      res.end(JSON.stringify({ accepted: true }));
      return;
    }
    if (record.path === '/v1/graymatter/object-graph/shape') {
      res.end(JSON.stringify({ nodes: ['Customer', 'MemoryEntry'] }));
      return;
    }
    if (record.path === '/v1/graymatter/retrieval-tools') {
      res.end(JSON.stringify({ tools: ['hybrid'] }));
      return;
    }
    if (record.path === '/v1/graymatter/retrieval-context') {
      assert.equal(record.method, 'POST');
      assert.equal(record.body.query, 'invoice context');
      res.end(JSON.stringify({ receiptId: 'ctx-1' }));
      return;
    }
    if (record.path === '/v1/graymatter/activation/bridge/event') {
      assert.equal(record.method, 'POST');
      assert.equal(record.body.event, 'login-ready');
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (record.path === '/v1/graymatter/mcp/bundles/bundle-1') {
      res.end(JSON.stringify({ bundleId: 'bundle-1' }));
      return;
    }
    throw new Error(`Unexpected ${record.method} ${record.path}`);
  });

  const apiBase = await listen(fakeApi.server);
  const server = createGrayMatterMcpServer({ apiBase: `${apiBase}/v1` });
  const baseUrl = await listen(server);

  try {
    const calls = [
      { name: 'graymatter_status', arguments: { surface: 'memory_status' } },
      { name: 'graymatter_semantic_search', arguments: { query: 'customer memory', limit: 3 } },
      { name: 'graymatter_semantic_reindex', arguments: { dryRun: true, entryTypes: ['context'] } },
      {
        name: 'graymatter_semantic_reindex',
        arguments: {
          estimateOnly: true,
          tenantScope: 'tenant-alpha',
          sources: [
            {
              targetType: 'MemoryEntry',
              targetId: 'mem-1',
              sourceText: 'source evidence'
            }
          ]
        }
      },
      { name: 'graymatter_object_graph_shape', arguments: {} },
      { name: 'graymatter_retrieval_tools', arguments: {} },
      { name: 'graymatter_retrieval_context', arguments: { query: 'invoice context' } },
      { name: 'graymatter_activation_bridge', arguments: { action: 'event', body: { event: 'login-ready' } } },
      { name: 'graymatter_mcp_bundle', arguments: { action: 'get', bundleId: 'bundle-1' } }
    ];

    for (const [index, tool] of calls.entries()) {
      const result = await postRpc(baseUrl, {
        jsonrpc: '2.0',
        id: `gm-cap-${index}`,
        method: 'tools/call',
        params: tool
      });
      assert.equal(result.status, 200);
      assert.ok(result.body.result.content[0].text.length > 0);
    }

    assert.equal(fakeApi.requests.length, calls.length);
  } finally {
    server.close();
    fakeApi.server.close();
  }
});

test('graymatter_invariant_preflight returns binding decisions from direct memory scan', async () => {
  const fakeApi = createFakeApi(async (_req, res, record) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    if (record.path === '/v1/memory/status') {
      res.end(JSON.stringify({ ready: true }));
      return;
    }
    if (record.path === '/v1/MemoryEntry') {
      res.end(JSON.stringify([
        {
          id: 'acl-rule',
          type: 'decision',
          text: 'Rule: ValkyrAI ACL enforcement must use generated ThorAPI service paths.',
          sourceChannel: 'codex:workspace:ValkyrAI',
          tags: ['invariant', 'acl', 'thorapi']
        },
        {
          id: 'casual-note',
          type: 'context',
          text: 'ValkyrAI casual note that should not bind the agent.',
          sourceChannel: 'codex:workspace:ValkyrAI',
          tags: ['context']
        },
        {
          id: 'other-product',
          type: 'decision',
          text: 'Rule: Other product invariant.',
          sourceChannel: 'codex:workspace:OtherProduct',
          tags: ['invariant']
        }
      ]));
      return;
    }
    throw new Error(`Unexpected ${record.method} ${record.path}`);
  });

  const apiBase = await listen(fakeApi.server);
  const server = createGrayMatterMcpServer({ apiBase: `${apiBase}/v1` });
  const baseUrl = await listen(server);

  try {
    const result = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'invariant-preflight',
      method: 'tools/call',
      params: {
        name: 'graymatter_invariant_preflight',
        arguments: {
          workspaceKey: 'ValkyrAI',
          keywords: ['signup', 'acl'],
          limit: 5
        }
      }
    });

    assert.equal(result.status, 200);
    const payload = JSON.parse(result.body.result.content[0].text);
    assert.equal(payload.sourceChannel, 'codex:workspace:ValkyrAI');
    assert.equal(payload.status.state, 'ready');
    assert.equal(payload.failClosed, true);
    assert.equal(payload.count, 1);
    assert.equal(payload.entries[0].id, 'acl-rule');
    assert.equal(payload.entries[0].preflightScore > 0, true);
  } finally {
    server.close();
    fakeApi.server.close();
  }
});

test('retrieval receipt tools route to the ThorAPI receipt surface', async () => {
  const fakeApi = createFakeApi(async (_req, res, record) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    if (record.path === '/v1/graymatter-retrieval-receipts' && record.method === 'POST') {
      assert.equal(record.body.query, 'current pricing');
      assert.equal(record.body.topK, 8);
      assert.equal(record.body.retrievalMode, 'HYBRID');
      assert.equal(record.body.qualityProfile, 'DEFAULT');
      assert.equal(record.body.includeItems, true);
      assert.equal(record.body.includeText, false);
      assert.deepEqual(record.body.filters, { entityTypes: ['pricing_strategy'] });
      res.end(JSON.stringify({
        receipt: {
          receiptId: 'gm_rr_123',
          traceId: 'gm_trace_123',
          retrievalStatus: 'OK',
          answerPolicy: 'ALLOW_ANSWER',
          recommendedAction: 'ANSWER'
        }
      }));
      return;
    }
    if (record.path === '/v1/graymatter-retrieval-receipts/gm_rr_123' && record.method === 'GET') {
      res.end(JSON.stringify({ receipt: { receiptId: 'gm_rr_123' } }));
      return;
    }
    if (record.path === '/v1/graymatter-retrieval-receipts' && record.method === 'GET') {
      assert.equal(record.query.get('retrievalStatus'), 'LOW_CONFIDENCE');
      assert.equal(record.query.get('agentId'), 'agent-1');
      assert.equal(record.query.get('limit'), '5');
      res.end(JSON.stringify([{ receiptId: 'gm_rr_low' }]));
      return;
    }
    throw new Error(`Unexpected ${record.method} ${record.path}`);
  });

  const apiBase = await listen(fakeApi.server);
  const server = createGrayMatterMcpServer({ apiBase: `${apiBase}/v1` });
  const baseUrl = await listen(server);

  try {
    const createResult = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'receipt-create',
      method: 'tools/call',
      params: {
        name: 'memory_retrieve_with_receipt',
        arguments: {
          query: 'current pricing',
          topK: 8,
          retrievalMode: 'HYBRID',
          qualityProfile: 'DEFAULT',
          includeItems: true,
          includeText: false,
          filters: { entityTypes: ['pricing_strategy'] }
        }
      }
    });
    const getResult = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'receipt-get',
      method: 'tools/call',
      params: { name: 'retrieval_receipt_get', arguments: { receiptId: 'gm_rr_123' } }
    });
    const queryResult = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'receipt-query',
      method: 'tools/call',
      params: {
        name: 'retrieval_receipt_query',
        arguments: { retrievalStatus: 'LOW_CONFIDENCE', agentId: 'agent-1', limit: 5 }
      }
    });

    const createPayload = JSON.parse(createResult.body.result.content[0].text);
    assert.equal(createPayload.receipt.answerPolicy, 'ALLOW_ANSWER');
    assert.equal(createPayload.graymatterPolicy.answerAllowed, true);
    assert.equal(createPayload.graymatterPolicy.disposition, 'answer_from_memory_allowed');
    assert.equal(createPayload.receipt.graymatterPolicy.answerAllowed, true);
    assert.deepEqual(JSON.parse(getResult.body.result.content[0].text), { receipt: { receiptId: 'gm_rr_123' } });
    assert.deepEqual(JSON.parse(queryResult.body.result.content[0].text), [{ receiptId: 'gm_rr_low' }]);
    assert.equal(fakeApi.requests.length, 3);
  } finally {
    server.close();
    fakeApi.server.close();
  }
});

test('retrieval receipt MCP results include fail-closed GrayMatter policy guidance', async () => {
  const fakeApi = createFakeApi(async (_req, res, record) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    if (record.path === '/v1/graymatter-retrieval-receipts' && record.method === 'POST') {
      res.end(JSON.stringify({
        receipt: {
          receiptId: 'gm_rr_denied',
          traceId: 'gm_trace_denied',
          retrievalStatus: 'LOW_CONFIDENCE',
          answerPolicy: 'REQUIRE_RETRY',
          recommendedAction: 'RETRY_WITH_EXPANDED_QUERY'
        }
      }));
      return;
    }
    if (record.path === '/v1/graymatter-retrieval-receipts/gm_rr_denied' && record.method === 'GET') {
      res.end(JSON.stringify({
        receipt: {
          receiptId: 'gm_rr_denied',
          traceId: 'gm_trace_denied',
          retrievalStatus: 'LOW_CONFIDENCE',
          answerPolicy: 'REQUIRE_RETRY',
          recommendedAction: 'RETRY_WITH_EXPANDED_QUERY'
        }
      }));
      return;
    }
    if (record.path === '/v1/graymatter-retrieval-receipts' && record.method === 'GET') {
      res.end(JSON.stringify([
        {
          receiptId: 'gm_rr_denied',
          traceId: 'gm_trace_denied',
          retrievalStatus: 'LOW_CONFIDENCE',
          answerPolicy: 'REQUIRE_RETRY',
          recommendedAction: 'RETRY_WITH_EXPANDED_QUERY'
        }
      ]));
      return;
    }
    throw new Error(`Unexpected ${record.method} ${record.path}`);
  });

  const apiBase = await listen(fakeApi.server);
  const server = createGrayMatterMcpServer({ apiBase: `${apiBase}/v1` });
  const baseUrl = await listen(server);

  try {
    const createResult = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'receipt-denied-create',
      method: 'tools/call',
      params: {
        name: 'memory_retrieve_with_receipt',
        arguments: { query: 'weak context', topK: 4 }
      }
    });
    const getResult = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'receipt-denied-get',
      method: 'tools/call',
      params: { name: 'retrieval_receipt_get', arguments: { receiptId: 'gm_rr_denied' } }
    });
    const queryResult = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'receipt-denied-query',
      method: 'tools/call',
      params: { name: 'retrieval_receipt_query', arguments: { retrievalStatus: 'LOW_CONFIDENCE' } }
    });

    for (const payload of [
      JSON.parse(createResult.body.result.content[0].text),
      JSON.parse(getResult.body.result.content[0].text)
    ]) {
      assert.equal(payload.graymatterPolicy.answerAllowed, false);
      assert.equal(payload.graymatterPolicy.caveatRequired, false);
      assert.equal(payload.graymatterPolicy.disposition, 'do_not_answer_from_memory');
      assert.match(payload.graymatterPolicy.warning, /does not authorize/);
      assert.deepEqual(payload.graymatterPolicy.requiredActions, [
        'require_retry',
        'handle_low_confidence',
        'recommended_retry_with_expanded_query'
      ]);
      assert.equal(payload.receipt.graymatterPolicy.disposition, 'do_not_answer_from_memory');
    }

    const listed = JSON.parse(queryResult.body.result.content[0].text);
    assert.equal(listed[0].graymatterPolicy.answerAllowed, false);
    assert.equal(listed[0].graymatterPolicy.disposition, 'do_not_answer_from_memory');
  } finally {
    server.close();
    fakeApi.server.close();
  }
});

test('memory_write forwards per-request auth to api-0 MemoryEntry', async () => {
  const credential = unsignedJwt({
    sub: 'agent-1',
    roles: ['VALKYR_AGENT'],
    authorities: ['MEMORYENTRY_WRITE']
  });
  const fakeApi = createFakeApi(async (_req, res, record) => {
    assert.equal(record.method, 'POST');
    assert.equal(record.path, '/v1/MemoryEntry/write');
    assert.equal(record.headers.authorization, `Bearer ${credential}`);
    assert.equal(record.headers.valkyr_auth, credential);
    assert.equal(record.headers.cookie, `VALKYR_AUTH=${credential}`);
    assert.equal(record.headers['x-tenant-id'], 'main');
    assert.equal(record.body.type, 'decision');
    assert.equal(record.body.text, 'ship the MCP server');
    assert.deepEqual(record.body.tags, ['mcp', 'graymatter']);

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'mem-1', ...record.body }));
  });

  const apiBase = await listen(fakeApi.server);
  const server = createGrayMatterMcpServer({ apiBase: `${apiBase}/v1` });
  const baseUrl = await listen(server);

  try {
    const result = await postRpc(
      baseUrl,
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'memory_write',
          arguments: {
            type: 'decision',
            text: 'ship the MCP server',
            tags: ['mcp', 'graymatter']
          }
        }
      },
      { 'X-Valkyr-Token': credential }
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.result.content[0].type, 'text');
    assert.deepEqual(JSON.parse(result.body.result.content[0].text), {
      id: 'mem-1',
      type: 'decision',
      text: 'ship the MCP server',
      content: 'ship the MCP server',
      tags: [
        'mcp',
        'graymatter'
      ]
    });
    assert.equal(fakeApi.requests.length, 1);
  } finally {
    server.close();
    fakeApi.server.close();
  }
});

test('memory_query forwards explicit tenant context ahead of JWT fallback', async () => {
  const credential = unsignedJwt({
    sub: 'agent-1',
    roles: ['VALKYR_AGENT']
  });
  const fakeApi = createFakeApi(async (_req, res, record) => {
    assert.equal(record.method, 'POST');
    assert.equal(record.path, '/v1/MemoryEntry/query');
    assert.equal(record.headers['x-tenant-id'], 'tenant-abc');
    assert.equal(record.body.query, 'tenant scoped');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ results: [] }));
  });

  const apiBase = await listen(fakeApi.server);
  const server = createGrayMatterMcpServer({ apiBase: `${apiBase}/v1`, tenantId: 'tenant-abc' });
  const baseUrl = await listen(server);

  try {
    const result = await postRpc(
      baseUrl,
      {
        jsonrpc: '2.0',
        id: 'tenant-query',
        method: 'tools/call',
        params: {
          name: 'memory_query',
          arguments: {
            query: 'tenant scoped'
          }
        }
      },
      { Authorization: `Bearer ${credential}` }
    );

    assert.equal(result.status, 200);
    assert.equal(fakeApi.requests.length, 1);
  } finally {
    server.close();
    fakeApi.server.close();
  }
});

test('memory_write sends scope as metadata instead of inline text headers', async () => {
  const fakeApi = createFakeApi(async (_req, res, record) => {
    assert.equal(record.method, 'POST');
    assert.equal(record.path, '/v1/MemoryEntry/write');
    assert.equal(record.body.type, 'context');
    assert.equal(record.body.text, 'handoff state');
    assert.equal(record.body.sourceChannel, 'codex:automation:mcp-and-skill-hunter');
    assert.equal(record.body.ownerId, undefined);
    assert.equal(record.body.createdDate, undefined);
    assert.ok(!record.body.text.includes('[graymatter-scope]'));
    assert.deepEqual(JSON.parse(record.body.metadata), {
      runtime: 'codex',
      scope: 'automation',
      automationId: 'mcp-and-skill-hunter',
      artifactPath: '/Users/john/.codex/automations/mcp-and-skill-hunter/memory.md',
      sourceChannel: 'codex:automation:mcp-and-skill-hunter',
      priority: 'high'
    });

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'mem-scope', ...record.body }));
  });

  const apiBase = await listen(fakeApi.server);
  const server = createGrayMatterMcpServer({ apiBase: `${apiBase}/v1` });
  const baseUrl = await listen(server);

  try {
    const result = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'memory-scope',
      method: 'tools/call',
      params: {
        name: 'memory_write',
        arguments: {
          type: 'context',
          text: 'handoff state',
          scopePath: '/Users/john/.codex/automations/mcp-and-skill-hunter/memory.md',
          metadata: { priority: 'high', ownerId: 'client-owner', createdDate: '2026-06-05T00:00:00Z' }
        }
      }
    });

    assert.equal(result.status, 200);
    assert.equal(fakeApi.requests.length, 1);
  } finally {
    server.close();
    fakeApi.server.close();
  }
});

test('Apps SDK bearer auth is accepted on /mcp and forwarded to api-0', async () => {
  const fakeApi = createFakeApi(async (_req, res, record) => {
    assert.equal(record.method, 'GET');
    assert.equal(record.path, '/v1/MemoryEntry/mem-99');
    assert.equal(record.headers.authorization, 'Bearer apps-sdk-token');

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'mem-99' }));
  });

  const apiBase = await listen(fakeApi.server);
  const server = createGrayMatterMcpServer({ apiBase: `${apiBase}/v1` });
  const baseUrl = await listen(server);

  try {
    const result = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'bearer-auth',
      method: 'tools/call',
      params: { name: 'memory_read', arguments: { id: 'mem-99' } }
    }, { authorization: 'Bearer apps-sdk-token' }, '/mcp');

    assert.equal(result.status, 200);
    assert.equal(result.body.result.content[0].text, JSON.stringify({ id: 'mem-99' }));
    assert.equal(fakeApi.requests.length, 1);
  } finally {
    server.close();
    fakeApi.server.close();
  }
});

test('MCP process auth reauthenticates once on SESSION_EXPIRED and retries', async () => {
  const fakeApi = createFakeApi(async (_req, res, record) => {
    if (fakeApi.requests.length === 1) {
      assert.equal(record.headers.authorization, 'Bearer expired-process-token');
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        error: 'SESSION_EXPIRED',
        message: 'Session expired or replaced by another login. Please sign in again to obtain a fresh token.'
      }));
      return;
    }

    assert.equal(record.headers.authorization, 'Bearer refreshed-process-token');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'mem-99', recovered: true }));
  });

  const apiBase = await listen(fakeApi.server);
  const server = createGrayMatterMcpServer({
    apiBase: `${apiBase}/v1`,
    token: 'expired-process-token',
    loginProvider: async () => 'refreshed-process-token'
  });
  const baseUrl = await listen(server);

  try {
    const result = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'reauth',
      method: 'tools/call',
      params: { name: 'memory_read', arguments: { id: 'mem-99' } }
    }, {}, '/mcp');

    assert.equal(result.status, 200);
    assert.equal(result.body.result.content[0].text, JSON.stringify({ id: 'mem-99', recovered: true }));
    assert.equal(fakeApi.requests.length, 2);
  } finally {
    server.close();
    fakeApi.server.close();
  }
});

test('MCP process auth hydrates from local credential reader before first local request', async () => {
  let keychainCalls = 0;
  const fakeApi = createFakeApi(async (_req, res, record) => {
    assert.equal(record.headers.authorization, 'Bearer keychain-token');
    assert.equal(record.path, '/v1/MemoryEntry/write');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'mem-hydrated' }));
  });

  const apiBase = await listen(fakeApi.server);
  const server = createGrayMatterMcpServer({
    apiBase: `${apiBase}/v1`,
    token: '',
    keychainReader: () => {
      keychainCalls += 1;
      return 'keychain-token';
    }
  });
  const baseUrl = await listen(server);

  try {
    const result = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'hydrate-auth',
      method: 'tools/call',
      params: { name: 'memory_write', arguments: { type: 'context', text: 'hello' } }
    }, {}, '/mcp');

    assert.equal(result.status, 200);
    assert.equal(result.body.result.content[0].text, JSON.stringify({ id: 'mem-hydrated' }));
    assert.equal(keychainCalls, 1);
    assert.equal(fakeApi.requests.length, 1);
  } finally {
    server.close();
    fakeApi.server.close();
  }
});

test('MCP process auth refreshes once when a stale keychain token receives write-scope denial', async () => {
  let loginCalls = 0;
  const fakeApi = createFakeApi(async (_req, res, record) => {
    if (fakeApi.requests.length === 1) {
      assert.equal(record.headers.authorization, 'Bearer stale-keychain-token');
      assert.equal(record.path, '/v1/MemoryEntry/write');
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        message: 'Authenticated token cannot perform this action. Verify required write scopes or role permissions.'
      }));
      return;
    }

    assert.equal(record.headers.authorization, 'Bearer write-capable-token');
    assert.equal(record.path, '/v1/MemoryEntry/write');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'mem-refreshed-write' }));
  });

  const apiBase = await listen(fakeApi.server);
  const server = createGrayMatterMcpServer({
    apiBase: `${apiBase}/v1`,
    token: '',
    keychainReader: () => 'stale-keychain-token',
    loginProvider: async () => {
      loginCalls += 1;
      return 'write-capable-token';
    }
  });
  const baseUrl = await listen(server);

  try {
    const result = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'refresh-write-denial',
      method: 'tools/call',
      params: { name: 'memory_write', arguments: { type: 'context', text: 'hello' } }
    }, {}, '/mcp');

    assert.equal(result.status, 200);
    assert.equal(result.body.result.content[0].text, JSON.stringify({ id: 'mem-refreshed-write' }));
    assert.equal(loginCalls, 1);
    assert.equal(fakeApi.requests.length, 2);
  } finally {
    server.close();
    fakeApi.server.close();
  }
});

test('MCP process auth can fall back to stateful shell transport for write denials', async () => {
  let loginCalls = 0;
  let shellCalls = 0;
  const fakeApi = createFakeApi(async (_req, res, record) => {
    if (fakeApi.requests.length === 1) {
      assert.equal(record.headers.authorization, 'Bearer stale-keychain-token');
    } else {
      assert.equal(record.headers.authorization, 'Bearer refreshed-bearer-token');
    }
    assert.equal(record.path, '/v1/MemoryEntry/write');
    res.writeHead(403, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      message: 'Authenticated token cannot perform this action. Verify required write scopes or role permissions.'
    }));
  });

  const apiBase = await listen(fakeApi.server);
  const server = createGrayMatterMcpServer({
    apiBase: `${apiBase}/v1`,
    token: '',
    keychainReader: () => 'stale-keychain-token',
    loginProvider: async () => {
      loginCalls += 1;
      return 'refreshed-bearer-token';
    },
    apiShellProvider: async (_context, method, endpoint, body) => {
      shellCalls += 1;
      assert.equal(method, 'POST');
      assert.equal(endpoint, 'MemoryEntry/write');
      assert.deepEqual(body, {
        type: 'context',
        text: 'stateful fallback please',
        content: 'stateful fallback please'
      });
      return { id: 'mem-stateful-shell' };
    }
  });
  const baseUrl = await listen(server);

  try {
    const result = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'shell-fallback-write-denial',
      method: 'tools/call',
      params: { name: 'memory_write', arguments: { type: 'context', text: 'stateful fallback please' } }
    }, {}, '/mcp');

    assert.equal(result.status, 200);
    assert.equal(result.body.result.content[0].text, JSON.stringify({ id: 'mem-stateful-shell' }));
    assert.equal(loginCalls, 1);
    assert.equal(shellCalls, 1);
    assert.equal(fakeApi.requests.length, 2);
  } finally {
    server.close();
    fakeApi.server.close();
  }
});

test('MCP per-request auth does not reauthenticate into a shared process token', async () => {
  let loginCalls = 0;
  const fakeApi = createFakeApi(async (_req, res, record) => {
    assert.equal(record.headers.authorization, 'Bearer expired-user-token');
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      error: 'SESSION_EXPIRED',
      message: 'Session expired for this caller.'
    }));
  });

  const apiBase = await listen(fakeApi.server);
  const server = createGrayMatterMcpServer({
    apiBase: `${apiBase}/v1`,
    token: 'process-token',
    loginProvider: async () => {
      loginCalls += 1;
      return 'refreshed-process-token';
    }
  });
  const baseUrl = await listen(server);

  try {
    const result = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'request-scoped-expired',
      method: 'tools/call',
      params: { name: 'memory_read', arguments: { id: 'mem-99' } }
    }, { authorization: 'Bearer expired-user-token' }, '/mcp');

    assert.equal(result.status, 200);
    assert.equal(result.body.result.structuredContent.reason, 'missing_auth');
    assert.equal(loginCalls, 0);
    assert.equal(fakeApi.requests.length, 1);
  } finally {
    server.close();
    fakeApi.server.close();
  }
});

test('MCP per-request auth does not fall back to shared stateful shell transport', async () => {
  let shellCalls = 0;
  const fakeApi = createFakeApi(async (_req, res, record) => {
    assert.equal(record.headers.authorization, 'Bearer user-scoped-token');
    assert.equal(record.path, '/v1/MemoryEntry/write');
    res.writeHead(403, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      message: 'Authenticated token cannot perform this action. Verify required write scopes or role permissions.'
    }));
  });

  const apiBase = await listen(fakeApi.server);
  const server = createGrayMatterMcpServer({
    apiBase: `${apiBase}/v1`,
    token: 'process-token',
    apiShellProvider: async () => {
      shellCalls += 1;
      return { id: 'must-not-use-shared-shell' };
    }
  });
  const baseUrl = await listen(server);

  try {
    const result = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'request-scoped-shell-blocked',
      method: 'tools/call',
      params: { name: 'memory_write', arguments: { type: 'context', text: 'hello' } }
    }, { authorization: 'Bearer user-scoped-token' }, '/mcp');

    assert.equal(result.status, 200);
    assert.equal(result.body.result.structuredContent.reason, 'missing_auth');
    assert.equal(shellCalls, 0);
    assert.equal(fakeApi.requests.length, 1);
  } finally {
    server.close();
    fakeApi.server.close();
  }
});

test('memory tools derive scoped sourceChannel from Codex hierarchy metadata', async () => {
  const automationPath = '/tmp/codex-home/.codex/automations/mcp-and-skill-hunter/memory.md';
  const fakeApi = createFakeApi(async (_req, res, record) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    if (record.path === '/v1/MemoryEntry/write') {
      assert.equal(record.body.type, 'context');
      assert.equal(record.body.sourceChannel, 'codex:automation:mcp-and-skill-hunter');
      assert.equal(record.body.text, 'Research complete');
      assert.deepEqual(JSON.parse(record.body.metadata), {
        runtime: 'codex',
        user: 'codex-user',
        scope: 'automation',
        automationId: 'mcp-and-skill-hunter',
        artifactPath: '/tmp/codex-home/.codex/automations/mcp-and-skill-hunter/memory.md',
        sourceChannel: 'codex:automation:mcp-and-skill-hunter'
      });
      res.end(JSON.stringify({ id: 'mem-scoped', ...record.body }));
      return;
    }
    if (record.path === '/v1/MemoryEntry/query') {
      assert.equal(record.body.query, 'Research complete');
      assert.equal(record.body.source, 'codex:automation:mcp-and-skill-hunter');
      assert.equal(record.body.type, 'context');
      res.end(JSON.stringify({ results: [{ id: 'mem-scoped' }] }));
      return;
    }
    throw new Error(`Unexpected path ${record.path}`);
  });

  const apiBase = await listen(fakeApi.server);
  const server = createGrayMatterMcpServer({ apiBase: `${apiBase}/v1` });
  const baseUrl = await listen(server);

  try {
    const writeResult = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'scoped-write',
      method: 'tools/call',
      params: {
        name: 'memory_write',
        arguments: {
          type: 'context',
          text: 'Research complete',
          scopePath: automationPath,
          user: 'codex-user'
        }
      }
    });
    const queryResult = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'scoped-query',
      method: 'tools/call',
      params: {
        name: 'memory_query',
        arguments: {
          query: 'Research complete',
          type: 'context',
          scopePath: automationPath
        }
      }
    });

    assert.equal(writeResult.status, 200);
    assert.equal(queryResult.status, 200);
    assert.equal(fakeApi.requests.length, 2);
  } finally {
    server.close();
    fakeApi.server.close();
  }
});

test('entity tools route list, get, and create calls with RBAC-scoped auth', async () => {
  const credential = ['entity', 'credential'].join('-');
  const fakeApi = createFakeApi(async (_req, res, record) => {
    assert.equal(record.headers.authorization, `Bearer ${credential}`);
    res.writeHead(200, { 'content-type': 'application/json' });
    if (record.path === '/v1/Customer' && record.method === 'GET') {
      assert.equal(record.query.get('limit'), '2');
      res.end(JSON.stringify([{ id: 'cust-1' }]));
      return;
    }
    if (record.path === '/v1/Customer/cust-1' && record.method === 'GET') {
      res.end(JSON.stringify({ id: 'cust-1', name: 'Acme' }));
      return;
    }
    if (record.path === '/v1/Task' && record.method === 'POST') {
      assert.equal(record.body.title, 'Follow up');
      res.end(JSON.stringify({ id: 'task-1', ...record.body }));
      return;
    }
    throw new Error(`Unexpected ${record.method} ${record.path}`);
  });

  const apiBase = await listen(fakeApi.server);
  const server = createGrayMatterMcpServer({ apiBase: `${apiBase}/v1` });
  const baseUrl = await listen(server);
  const headers = { 'X-Valkyr-Token': credential };

  try {
    const listResult = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'entity-list',
      method: 'tools/call',
      params: { name: 'entity_list', arguments: { entityType: 'Customer', limit: 2 } }
    }, headers);
    const getResult = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'entity-get',
      method: 'tools/call',
      params: { name: 'entity_get', arguments: { entityType: 'Customer', id: 'cust-1' } }
    }, headers);
    const createResult = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'entity-create',
      method: 'tools/call',
      params: { name: 'entity_create', arguments: { entityType: 'Task', body: { title: 'Follow up' } } }
    }, headers);

    assert.deepEqual(JSON.parse(listResult.body.result.content[0].text), [{ id: 'cust-1' }]);
    assert.deepEqual(JSON.parse(getResult.body.result.content[0].text), { id: 'cust-1', name: 'Acme' });
    assert.deepEqual(JSON.parse(createResult.body.result.content[0].text), { id: 'task-1', title: 'Follow up' });
    assert.equal(fakeApi.requests.length, 3);
  } finally {
    server.close();
    fakeApi.server.close();
  }
});

test('entity_create normalizes ContentData into schema fields before posting', async () => {
  const credential = ['contentdata', 'credential'].join('-');
  const fakeApi = createFakeApi(async (_req, res, record) => {
    assert.equal(record.method, 'POST');
    assert.equal(record.path, '/v1/ContentData');
    assert.equal(record.headers.authorization, `Bearer ${credential}`);
    assert.equal(record.body.ownerId, undefined);
    assert.equal(record.body.createdDate, undefined);
    assert.equal(record.body.category, 'memory');
    assert.equal(record.body.contentType, 'plaintext');
    assert.equal(record.body.status, 'DRAFT');
    assert.equal(record.body.contentData, 'user: cleanup the junk please');
    assert.deepEqual(JSON.parse(record.body.metadata), {
      classification: 'conversation_summary',
      sourceSurface: 'sagechat',
      memoryScope: 'session'
    });
    assert.deepEqual(record.body.tags, [
      { name: 'conversation_summary', type: 'category' },
      { name: 'surface:sagechat', type: 'other' },
      { name: 'memory', type: 'keyword' }
    ]);

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'content-1', ...record.body }));
  });

  const apiBase = await listen(fakeApi.server);
  const server = createGrayMatterMcpServer({ apiBase: `${apiBase}/v1` });
  const baseUrl = await listen(server);

  try {
    const result = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'contentdata-create',
      method: 'tools/call',
      params: {
        name: 'entity_create',
        arguments: {
          entityType: 'ContentData',
          body: {
            ownerId: 'client-owner',
            createdDate: '2026-06-05T00:00:00Z',
            contentData: 'conversation_summary sourceSurface: sagechat memoryScope: session\nuser: cleanup the junk please'
          }
        }
      }
    }, { 'X-Valkyr-Token': credential });

    assert.equal(result.status, 200);
    assert.equal(fakeApi.requests.length, 1);
  } finally {
    server.close();
    fakeApi.server.close();
  }
});

test('schema_summary fetches and summarizes live OpenAPI metadata', async () => {
  const fakeApi = createFakeApi(async (_req, res, record) => {
    assert.equal(record.method, 'GET');
    assert.equal(record.path, '/v1/api-docs');

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      info: { title: 'ValkyrAI API', version: '2026.05' },
      tags: [{ name: 'Customer' }, { name: 'MemoryEntry' }],
      paths: {
        '/Customer': {},
        '/Customer/{id}': {},
        '/v1/MemoryEntry': {},
        '/v1/swarm-ops/graph': {}
      }
    }));
  });

  const apiBase = await listen(fakeApi.server);
  const server = createGrayMatterMcpServer({ apiBase: `${apiBase}/v1` });
  const baseUrl = await listen(server);

  try {
    const result = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'schema_summary',
        arguments: {}
      }
    });

    const summary = JSON.parse(result.body.result.content[0].text);
    assert.equal(summary.title, 'ValkyrAI API');
    assert.equal(summary.version, '2026.05');
    assert.equal(summary.pathCount, 4);
    assert.deepEqual(summary.entities, ['Customer', 'MemoryEntry']);
  } finally {
    server.close();
    fakeApi.server.close();
  }
});

test('entity_create rejects known api-0 truncated long strategy and note fields before posting', async () => {
  const fakeApi = createFakeApi(async () => {
    throw new Error('entity_create validation should not call api-0');
  });

  const apiBase = await listen(fakeApi.server);
  const server = createGrayMatterMcpServer({ apiBase: `${apiBase}/v1` });
  const baseUrl = await listen(server);

  try {
    const strategyResult = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'long-strategy',
      method: 'tools/call',
      params: {
        name: 'entity_create',
        arguments: { entityType: 'StrategicPriority', body: { description: 's'.repeat(256) } }
      }
    });
    const noteResult = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'long-note',
      method: 'tools/call',
      params: {
        name: 'entity_create',
        arguments: { entityType: 'Note', body: { content: 'n'.repeat(256) } }
      }
    });

    assert.equal(strategyResult.status, 200);
    assert.equal(strategyResult.body.error.code, -32000);
    assert.match(strategyResult.body.error.message, /StrategicPriority\.description is 256 characters/);
    assert.match(strategyResult.body.error.message, /SQL truncation 500/);
    assert.equal(noteResult.status, 200);
    assert.equal(noteResult.body.error.code, -32000);
    assert.match(noteResult.body.error.message, /Note\.content is 256 characters/);
    assert.equal(fakeApi.requests.length, 0);
  } finally {
    server.close();
    fakeApi.server.close();
  }
});

test('tool errors return JSON-RPC errors instead of HTTP failures', async () => {
  const server = createGrayMatterMcpServer({ apiBase: 'https://api-0.example.test/v1' });
  const baseUrl = await listen(server);

  try {
    const result = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'bad-tool',
      method: 'tools/call',
      params: {
        name: 'entity_get',
        arguments: { entityType: '../Customer', id: 'cust-1' }
      }
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.error.code, -32000);
    assert.match(result.body.error.message, /entityType/);
  } finally {
    server.close();
  }
});

test('hosted mode restricts CORS to configured connector origins', async () => {
  const server = createGrayMatterMcpServer({
    apiBase: 'https://api-0.example.test/v1',
    deploymentMode: 'hosted-multi-tenant',
    allowedOrigins: ['https://chatgpt.com', 'https://graymatter.example.test']
  });
  const baseUrl = await listen(server);

  try {
    const allowed = await fetch(`${baseUrl}/health/auth`, {
      headers: { origin: 'https://chatgpt.com' }
    });
    const allowedBody = await allowed.json();
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://chatgpt.com');
    assert.equal(allowedBody.deploymentMode, 'hosted-multi-tenant');
    assert.equal(allowedBody.xValkyrTokenAccepted, false);
    assert.equal(allowedBody.processTokenAccepted, false);

    const denied = await fetch(`${baseUrl}/health/auth`, {
      headers: { origin: 'https://evil.example.test' }
    });
    assert.equal(denied.status, 200);
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
  } finally {
    server.close();
  }
});

test('hosted mode rejects X-Valkyr-Token while preserving bearer auth', async () => {
  const fakeApi = createFakeApi(async (_req, res, record) => {
    assert.equal(record.headers.authorization, 'Bearer hosted-bearer');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'mem-hosted' }));
  });

  const apiBase = await listen(fakeApi.server);
  const server = createGrayMatterMcpServer({
    apiBase: `${apiBase}/v1`,
    deploymentMode: 'hosted-multi-tenant',
    allowedOrigins: ['https://chatgpt.com'],
    token: 'process-token-must-not-be-used'
  });
  const baseUrl = await listen(server);

  try {
    const rejected = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'unsafe-header-token',
      method: 'tools/call',
      params: { name: 'memory_read', arguments: { id: 'mem-hosted' } }
    }, { 'X-Valkyr-Token': 'raw-header-token', origin: 'https://chatgpt.com' }, '/mcp');

    assert.equal(rejected.status, 401);
    assert.match(rejected.body.error, /X-Valkyr-Token is disabled/);
    assert.equal(rejected.body.error.includes('raw-header-token'), false);
    assert.equal(fakeApi.requests.length, 0);

    const accepted = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'bearer-hosted',
      method: 'tools/call',
      params: { name: 'memory_read', arguments: { id: 'mem-hosted' } }
    }, { authorization: 'Bearer hosted-bearer', origin: 'https://chatgpt.com' }, '/mcp');

    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.result.content[0].text, JSON.stringify({ id: 'mem-hosted' }));
    assert.equal(fakeApi.requests.length, 1);
  } finally {
    server.close();
    fakeApi.server.close();
  }
});

test('hosted multi-tenant mode does not fall back to a process-wide token', async () => {
  const fakeApi = createFakeApi(async (_req, res, record) => {
    assert.equal(record.headers.authorization, undefined);
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: 'missing auth' }));
  });

  const apiBase = await listen(fakeApi.server);
  const server = createGrayMatterMcpServer({
    apiBase: `${apiBase}/v1`,
    deploymentMode: 'hosted-multi-tenant',
    allowedOrigins: ['https://chatgpt.com'],
    token: 'shared-process-token'
  });
  const baseUrl = await listen(server);

  try {
    const result = await postRpc(baseUrl, {
      jsonrpc: '2.0',
      id: 'no-process-token',
      method: 'tools/call',
      params: { name: 'memory_read', arguments: { id: 'mem-hosted' } }
    }, { origin: 'https://chatgpt.com' }, '/mcp');

    assert.equal(result.status, 200);
    assert.equal(result.body.result.structuredContent.reason, 'missing_auth');
    assert.equal(fakeApi.requests.length, 1);
  } finally {
    server.close();
    fakeApi.server.close();
  }
});
