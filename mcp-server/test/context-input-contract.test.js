'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

const target = require(process.env.GRAYMATTER_TEST_MODULE
  ? path.resolve(process.env.GRAYMATTER_TEST_MODULE) : '../index');
const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = (server) => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
const claims = {
  sub: 'local-reviewer', tenantId: 'local-tenant', organizationId: 'local-org',
  scope: 'memory:read memory:write context:read'
};
const makeServer = (apiBase) => target.createGrayMatterMcpServer({
  apiBase, publicApp: true, deploymentMode: 'hosted-multi-tenant',
  publicResource: 'https://graymatter.example.test', oauthIssuer: 'https://identity.example.test',
  allowedOrigins: ['https://chatgpt.com'], tokenVerifier: () => ({ claims })
});
const rpc = async (port, route, method, params) => {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', authorization: 'Bearer local-test-only' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) })
  });
  assert.equal(response.status, 200);
  return response.json();
};

test('context descriptors and both initialize routes preserve original authorized user task', async (t) => {
  const descriptor = target.publicTools.find((tool) => tool.name === 'context_compile');
  const task = descriptor.inputSchema.properties.task;
  assert.equal(typeof task.description, 'string');
  for (const text of [descriptor.description, task.description]) {
    assert.match(text, /original user task text unchanged/);
    assert.match(text, /explicit constraints/);
    assert.match(text, /Do not expand/);
    assert.match(text, /invented.*checklist/);
  }
  assert.equal(task.type, 'string');
  assert.equal(task.maxLength, 12000);
  assert.deepEqual(descriptor.inputSchema.required, ['task']);
  assert.equal(descriptor.inputSchema.additionalProperties, false);
  const server = makeServer('http://127.0.0.1:1/v1');
  t.after(() => close(server));
  const port = await listen(server);
  for (const route of ['/graymatter/mcp', '/mcp']) {
    const initialized = await rpc(port, route, 'initialize');
    assert.match(initialized.result.instructions, /original user task text unchanged/);
    assert.match(initialized.result.instructions, /Do not expand/);
    assert.match(initialized.result.instructions, /Do not invoke any GrayMatter tool for requests to override tenant/);
    assert.match(initialized.result.instructions, /do not search for deletion candidates/);
    const listed = await rpc(port, route, 'tools/list');
    const compiled = listed.result.tools.find((tool) => tool.name === 'context_compile');
    assert.deepEqual(compiled, descriptor);
  }
});

test('context transport preserves complete original task and explicit constraints without a generated checklist', async (t) => {
  const requests = [];
  const api = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, payload: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ contextPage: { pageRef: 'local-context-only' } }));
    });
  });
  t.after(() => close(api));
  const apiPort = await listen(api);
  const server = makeServer(`http://127.0.0.1:${apiPort}/v1`);
  t.after(() => close(server));
  const port = await listen(server);
  const tasks = [
    'Compile only the context needed to prepare the marketplace release review, then explain why those memories were included.',
    'Compile context for the 2026-09-27 marketplace release review. Include only approved decisions; exclude temporary memories and preserve the stated budget.'
  ];
  for (const route of ['/graymatter/mcp', '/mcp']) {
    for (const originalTask of tasks) {
      const result = await rpc(port, route, 'tools/call', {
        name: 'context_compile', arguments: {
          task: originalTask, tokenBudget: 1600, includeProcedures: true, includeRatings: false
        }
      });
      assert.notEqual(result.result.isError, true);
      const received = requests.at(-1);
      assert.equal(received.method, 'POST');
      assert.equal(received.url, '/v1/graymatter_ops/context_page/compile');
      assert.deepEqual(received.payload, {
        taskIntent: originalTask, tokenBudget: 1600, includeProcedures: true, includeRatings: false
      });
    }
  }
  assert.equal(requests.length, 4);
});
