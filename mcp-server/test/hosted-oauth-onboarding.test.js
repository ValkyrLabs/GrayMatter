'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const { createGrayMatterMcpServer } = require('../index');

const ORIGIN = 'https://api-0.valkyrlabs.com';
const MCP_RESOURCE = `${ORIGIN}/graymatter/mcp`;

function request(port, path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) }));
    }).on('error', reject);
  });
}

async function start(t, publicResource = ORIGIN) {
  const server = createGrayMatterMcpServer({
    publicApp: true, deploymentMode: 'hosted-multi-tenant', publicResource,
    oauthIssuer: ORIGIN, apiBase: 'http://127.0.0.1:1/v1',
    tokenVerifier: () => { throw new Error('No test credentials supplied'); },
    fetch: () => { throw new Error('Discovery must not contact an account API'); }
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

test('fresh and repeated VS Code discovery identify the exact protected MCP URL', async t => {
  const port = await start(t);
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/graymatter/mcp']) {
      const response = await request(port, path);
      assert.equal(response.status, 200);
      assert.equal(response.body.resource, MCP_RESOURCE);
      assert.deepEqual(response.body.authorization_servers, [ORIGIN]);
      assert.deepEqual(response.body.scopes_supported, ['memory:read', 'memory:write', 'context:read']);
    }
  }
});

test('unauthenticated discovery challenge points to canonical metadata without granting access', async t => {
  const port = await start(t);
  const denied = await request(port, '/graymatter/mcp');
  assert.equal(denied.status, 401);
  const match = /resource_metadata="([^"]+)"/.exec(denied.headers['www-authenticate']);
  assert.ok(match);
  assert.equal(match[1], `${ORIGIN}/.well-known/oauth-protected-resource/graymatter/mcp`);
  const metadata = await request(port, new URL(match[1]).pathname);
  assert.equal(metadata.body.resource, MCP_RESOURCE);
});

test('already canonical resource configuration does not duplicate the MCP path', async t => {
  const port = await start(t, MCP_RESOURCE);
  const response = await request(port, '/.well-known/oauth-protected-resource/graymatter/mcp');
  assert.equal(response.body.resource, MCP_RESOURCE);
});

test('local private MCP discovery stays available offline without hosted OAuth setup', async t => {
  const server = createGrayMatterMcpServer({
    publicApp: false, deploymentMode: 'local-dev', publicResource: 'unused-private-profile',
    token: 'local-fixture', apiBase: 'http://127.0.0.1:1/v1',
    fetch: () => { throw new Error('Local discovery must not contact hosted accounts'); }
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const response = await request(server.address().port, '/health');
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.mcpPath, '/mcp');
});
