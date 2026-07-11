'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({
      code,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8')
    }));
  });
}

test('public MCP smoke script verifies the complete reviewer contract', async (t) => {
  const memories = new Map();
  const names = [
    'memory_search', 'memory_get', 'memory_save', 'memory_update',
    'memory_forget', 'context_compile', 'procedure_search', 'retrieval_receipt_get'
  ];
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/.well-known/oauth-protected-resource') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        resource: `http://127.0.0.1:${server.address().port}`,
        authorization_servers: ['https://identity.example.test'],
        scopes_supported: ['memory:read', 'memory:write', 'context:read']
      }));
      return;
    }
    const auth = String(req.headers.authorization || '');
    if (!auth.startsWith('Bearer ')) {
      res.writeHead(401, {
        'content-type': 'application/json',
        'www-authenticate': `Bearer resource_metadata="http://127.0.0.1:${server.address().port}/.well-known/oauth-protected-resource"`
      });
      res.end(JSON.stringify({ ok: false, error: { code: 'AUTH_REQUIRED' } }));
      return;
    }
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const message = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const token = auth.slice('Bearer '.length);
      let result;
      if (message.method === 'initialize') {
        result = { protocolVersion: '2025-06-18', serverInfo: { name: 'graymatter', version: 'test' } };
      } else if (message.method === 'tools/list') {
        result = { tools: names.map((name) => ({ name })) };
      } else {
        const { name, arguments: args } = message.params;
        if (name === 'memory_save') {
          const value = { id: '11111111-1111-4111-8111-111111111111', text: args.content };
          memories.set(token, value);
          result = { structuredContent: { ok: true, data: value } };
        } else if (name === 'memory_search' && Object.hasOwn(args, 'tenantId')) {
          result = { isError: true, structuredContent: { ok: false, error: { code: 'INVALID_ARGUMENT' } } };
        } else if (name === 'memory_search') {
          result = { structuredContent: { ok: true, data: memories.has(token) ? [memories.get(token)] : [] } };
        } else if (name === 'retrieval_receipt_get') {
          result = { structuredContent: { ok: true, data: { receiptId: args.receiptId } } };
        } else if (name === 'memory_forget' && args.confirm !== true) {
          result = { isError: true, structuredContent: { ok: false, error: { code: 'CONFIRMATION_REQUIRED' } } };
        } else if (name === 'memory_forget') {
          memories.delete(token);
          result = { structuredContent: { ok: true, data: { id: args.id, forgotten: true } } };
        } else {
          result = { structuredContent: { ok: true, data: {} } };
        }
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const script = path.resolve(__dirname, '../../scripts/smoke-test-public-mcp.sh');
  const outcome = await run('bash', [script], {
    cwd: path.resolve(__dirname, '../..'),
    env: {
      ...process.env,
      GRAYMATTER_MCP_URL: `http://127.0.0.1:${server.address().port}/graymatter/mcp`,
      GRAYMATTER_TENANT_A_TOKEN: 'fixture-token-a',
      GRAYMATTER_TENANT_B_TOKEN: 'fixture-token-b',
      GRAYMATTER_TEST_RECEIPT_ID: 'fixture-receipt'
    }
  });
  assert.equal(outcome.code, 0, outcome.stderr || outcome.stdout);
  assert.match(outcome.stdout, /GrayMatter public MCP smoke test passed/);
  assert.match(outcome.stdout, /cross_tenant/);
});

