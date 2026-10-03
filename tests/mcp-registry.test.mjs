import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = JSON.parse(fs.readFileSync(path.join(root, 'server.json'), 'utf8'));
const publisher = server._meta['io.modelcontextprotocol.registry/publisher-provided'];

test('publication identifies the authorized organization and its own public repository', () => {
  assert.equal(server.name, 'io.github.ValkyrLabs/graymatter');
  assert.equal(server.repository.url, 'https://github.com/ValkyrLabs/GrayMatter');
  assert.equal(server.repository.source, 'github');
  assert.equal(publisher.publisher.url, 'https://github.com/ValkyrLabs');
});

test('gallery installation uses the canonical hosted Streamable HTTP resource', () => {
  assert.deepEqual(server.remotes, [{ type: 'streamable-http', url: 'https://api-0.valkyrlabs.com/graymatter/mcp' }]);
  assert.equal(publisher.authentication.type, 'oauth2');
  assert.equal(publisher.authentication.hostedAccountRequired, true);
});

test('local Lite remains separate from hosted authentication and unpublished packages', () => {
  assert.equal(publisher.localLite.hostedAccountRequired, false);
  assert.equal(publisher.localLite.registryPackagePublished, false);
  assert.equal(server.packages, undefined);
  assert.match(publisher.localLite.installation, /separate/i);
});

test('public listing contains no credential inputs, identities, or caller-supplied tenant scope', () => {
  assert.equal(server.remotes[0].headers, undefined);
  assert.equal(server.remotes[0].variables, undefined);
  const text = JSON.stringify(server);
  assert.doesNotMatch(text, /Bearer\s+|gh[pousr]_|-----BEGIN|principalId|organizationId|tenantId|VALKYR_AUTH_TOKEN|GRAYMATTER_LIGHT_PASSWORD/);
  assert.ok(Buffer.byteLength(JSON.stringify(publisher)) <= 4096);
});

test('auth discovery points to the same protected origin and docs distinguish OAuth from API sessions', () => {
  assert.equal(new URL(publisher.authentication.protectedResourceMetadataUrl).origin, new URL(server.remotes[0].url).origin);
  assert.equal(new URL(publisher.authentication.authorizationServerMetadataUrl).origin, new URL(server.remotes[0].url).origin);
  const docs = fs.readFileSync(path.join(root, 'docs/mcp-registry.md'), 'utf8');
  assert.match(docs, /ordinary api-0 login session is separate from an OAuth grant/i);
  assert.match(docs, /separately verify/);
  assert.match(docs, /No valkyrlabs\.com account is required/);
});
