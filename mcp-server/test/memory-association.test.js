'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const { startStdioServer, createGrayMatterMcpServer, publicTools } = require('../index.js');

const path = '/v1/graymatter/memory/associations';
const input = {fromId: 'AAAAAAAA-0000-4000-8000-000000000028', toId: 'BBBBBBBB-0000-4000-8000-000000000039', relation: 'Líen\u00a0→🔗'};
const normalized = {...input, fromId: input.fromId.toLowerCase(), toId: input.toId.toLowerCase()};
const capability = {contractVersion: 'graymatter-memory-association/v1', supported: true, semantics: 'record-identity-navigation',
  tupleHashAlgorithm: 'sha256-length-prefixed-utf8/v1', cascadeDelete: true, maxRelationCodePoints: 128, maxRelationUtf8Bytes: 512};
const saved = {...normalized, contractVersion: capability.contractVersion, status: 'recorded', associationRef: 'dddddddd-0000-4000-8000-00000000007d',
  tupleHash: '96facaf52ce5bb0bbbfe9883d40e4af05e43e0cb6f06eb1e0ea90b0dbe421662', recordedAt: '2024-02-29T23:58:09.123456+02:30', replayed: false};
const current = {...saved, replayed: true};
const json = (value, status = 200) => new Response(JSON.stringify(value), {status, headers: {'content-type':'application/json'}});

function client(t, options) {
  const upstream = new PassThrough();
  const downstream = new PassThrough();
  startStdioServer({input: upstream, output: downstream, profileMode: 'single', ...options});
  t.after(() => { upstream.end(); downstream.destroy(); });
  return async function call(args = input, raw) {
    const response = once(downstream, 'data');
    upstream.write((raw || JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name: 'memory_link', arguments: args}})) + '\n');
    return JSON.parse((await response)[0]);
  };
}

function scripted(t, replies, options = {}) {
  const calls = [];
  const call = client(t, {apiBase: 'https://fixture.invalid/v1', token: 'synthetic-private',
    loginProvider: () => assert.fail('No credential recovery'), apiShellProvider: () => assert.fail('No shell transport'),
    schemaRefreshProvider: () => assert.fail('No revision refresh'), ...options,
    fetch: async (url, init) => {
      calls.push({url, ...init});
      assert.equal(init.redirect, 'error');
      const reply = replies[calls.length - 1];
      if (reply instanceof Error || !reply) throw reply || Error('Unplanned request');
      return reply;
    }});
  return {call, calls};
}

function failure(reply, code) {
  assert.equal(reply.result.isError, true);
  assert.equal(reply.result.structuredContent.error.code, code);
  assert.equal(reply.result.structuredContent.error.retryable, false);
  for (const value of [input.relation, normalized.fromId, normalized.toId, saved.associationRef, 'should-stay-private']) {
    assert.equal(JSON.stringify(reply).includes(value), false);
  }
}

for (const replayed of [false, true]) {
  test(`verified ${replayed ? 'existing' : 'new'} association over the authenticated private contract`, async t => {
    const write = {...saved, replayed};
    const {call, calls} = scripted(t, [json(capability), json(write, replayed ? 200 : 201), json(current)]);
    const response = await call();
    assert.deepEqual(JSON.parse(response.result.content[0].text), {...write, status: 'linked'});
    assert.deepEqual(calls.map(c => [c.method, new URL(c.url).pathname]), [['GET', path + '/capabilities'], ['POST', path], ['GET', path + '/' + saved.associationRef]]);
    assert.deepEqual(JSON.parse(calls[1].body), normalized);
    assert.ok(calls.every(c => c.headers.authorization === 'Bearer synthetic-private' && new URL(c.url).origin === 'https://fixture.invalid'));
  });
}

test('invalid references, labels and ambiguous keys never make a capability request', async t => {
  const {call, calls} = scripted(t, []);
  for (const args of [{...input, fromId: input.toId}, {...input, fromId: 'one'}, {...input, extra: true},
    ...['', '\u0085', ' trailing', 'trailing\u00a0', 'a\u007fb', 'a\ud800b', 'a'.repeat(129), '🔗'.repeat(129)].map(relation => ({...input, relation}))]) {
    failure(await call(args), 'INVALID_MEMORY_LINK');
  }
  const raw = JSON.stringify({jsonrpc: '2.0', id: 1, method:'tools/call', params:{name:'memory_link',arguments: input}})
    .replace('"relation":', '"r\\u0065lation":"should-stay-private","relation":');
  assert.equal((await call(null, raw)).error.message, 'Invalid JSON-RPC message.');
  assert.equal(calls.length, 0);
});

test('portable clients agree with the shared versioned Unicode and hashing vectors', async t => {
  const vectors = require('../../tests/memory-associations/tuple-vectors.json');
  for (const vector of vectors.positive) {
    const write = {...saved, ...vector.canonical, tupleHash: vector.tupleHash};
    const {call, calls} = scripted(t, [json(capability), json(write, 201), json({...write, replayed:true})]);
    const response = await call(vector.request);
    assert.deepEqual(JSON.parse(response.result.content[0].text), {...write, status:'linked'}, vector.name);
    assert.deepEqual(JSON.parse(calls[1].body), vector.canonical, vector.name);
  }
  for (const vector of vectors.negative) {
    const {call, calls} = scripted(t, []);
    const response = await call(vector.request);
    assert.ok(response.error || response.result?.isError, vector.name);
    assert.equal(calls.length, 0, vector.name);
  }
});

test('unsupported and uncertain capability responses cannot initiate a write or leak arguments', async t => {
  for (const [support, code] of [[json({}, 404), 'MEMORY_LINK_UNSUPPORTED'], [json({...capability, supported:false}), 'MEMORY_LINK_UNSUPPORTED'],
    [json({...capability, contractVersion:'old'}), 'MEMORY_LINK_UNSUPPORTED'], [json({...capability, cascadeDelete:false}), 'MEMORY_LINK_CAPABILITY_UNVERIFIED'],
    [json({message:'should-stay-private'}, 401), 'MEMORY_LINK_CAPABILITY_UNVERIFIED'], [new Response('<html>'), 'MEMORY_LINK_CAPABILITY_UNVERIFIED']]) {
    const {call, calls} = scripted(t, [support]);
    failure(await call(), code);
    assert.equal(calls.length, 1);
  }
});

test('every write or readback ambiguity returns unverified without an auth/schema retry or sensitive echo', async t => {
  const duplicate = new Response(JSON.stringify(saved).replace('"tupleHash":', '"tupleHash":"wrong","tupleHash":'),
    {status: 201, headers:{'content-type':'application/json'}});
  const schemaChanged = new Response(JSON.stringify(saved), {status: 201, headers:{'content-type':'application/json','x-schema-revision':'new'}});
  const postFailures = [new Error('should-stay-private'), json({message:'should-stay-private'}, 401), json({}, 403), json({}, 409),
    json(saved, 202), json(saved), duplicate, schemaChanged, new Response(null, {status:204}), new Response('<html>',{status:201}),
    json({...saved, relation: input.relation.normalize('NFD')}, 201), json({...saved, tupleHash: '0'.repeat(64)}, 201),
    json({...saved, associationRef:'//different.invalid'}, 201), json({...saved, recordedAt:'2025-02-29T00:00:00Z'}, 201),
    json({...saved, text:'should-stay-private'}, 201), json({...saved, junk: 'a'.repeat(9000)}, 201)];
  for (const post of postFailures) {
    const {call, calls} = scripted(t, [json(capability), post], {schemaRevision:'old'});
    failure(await call(), 'MEMORY_LINK_UNVERIFIED');
    assert.equal(calls.length, 2);
  }
  for (const final of [json(saved), json({...current, associationRef: normalized.fromId}), json({...current, recordedAt: '2024-02-29T00:00:00Z'}),
    json({...current, fromId: normalized.toId}), json({}, 404), json(current, 201), new Error('should-stay-private')]) {
    const {call, calls} = scripted(t, [json(capability), json(saved,201), final]);
    failure(await call(), 'MEMORY_LINK_UNVERIFIED');
    assert.equal(calls.length, 3);
    assert.equal(calls.filter(c => c.method === 'POST').length, 1);
  }
});

test('public catalog, mixed mode, unsafe origins and missing selected credentials fail closed', async t => {
  assert.ok(!publicTools.some(tool => tool.name === 'memory_link'));
  for (const options of [{profileMode:'blend'}, {apiBase:'http://example.invalid/v1'}, {apiBase:'http://127.0.0.1/v1'},
    {apiBase:'https://user:secret@example.invalid/v1'}, {apiBase:'https://example.invalid/v1?token=fake'},
    {token:'', lightPassword:'synthetic-basic', apiBase:'https://example.invalid/v1'}]) {
    const {call, calls} = scripted(t, [], options);
    failure(await call(), 'MEMORY_LINK_PROFILE_REQUIRED');
    assert.equal(calls.length, 0);
  }
});

async function listen(t, handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  return 'http://127.0.0.1:' + server.address().port;
}

test('actual Basic loopback transport reads the saved receipt and refuses 307 on any phase', async t => {
  let targetCalls = 0;
  const target = await listen(t, (_req, res) => { targetCalls++; res.end(); });
  for (const redirectOn of [0, 1, 2, 3]) {
    const seen = [];
    const origin = await listen(t, (req, res) => {
      seen.push([req.method, req.url]);
      assert.equal(req.headers.authorization, 'Basic ' + Buffer.from('fixture:local').toString('base64'));
      if (seen.length === redirectOn) {res.writeHead(307,{location:target + '/must-not-receive'}); res.end(); return;}
      res.writeHead(req.method === 'POST' ? 201 : 200, {'content-type':'application/json'});
      res.end(JSON.stringify([capability, saved, current][seen.length - 1]));
    });
    const call = client(t, {apiBase:origin + '/v1', lightUsername:'fixture', lightPassword:'local'});
    const reply = await call();
    if (redirectOn) failure(reply, redirectOn === 1 ? 'MEMORY_LINK_CAPABILITY_UNVERIFIED' : 'MEMORY_LINK_UNVERIFIED');
    else assert.equal(JSON.parse(reply.result.content[0].text).status, 'linked');
    assert.equal(seen.length, redirectOn || 3);
    assert.equal(targetCalls, 0);
  }
});

test('hosted unauthenticated request cannot inherit process Basic or bearer credentials', async t => {
  let contacts = 0;
  const mcp = createGrayMatterMcpServer({apiBase:'https://test.invalid/v1', deploymentMode:'hosted-multi-tenant',
    token:'process-only', lightPassword:'process-basic', fetch:async () => {contacts++; throw Error();}});
  mcp.listen(0, '127.0.0.1');
  await once(mcp, 'listening');
  t.after(() => { mcp.closeAllConnections(); return new Promise(resolve => mcp.close(resolve)); });
  const rpc = {jsonrpc:'2.0', id:1, method:'tools/call', params:{name:'memory_link',arguments:input}};
  const reply = await fetch(`http://127.0.0.1:${mcp.address().port}`, {method:'POST', headers:{'content-type':'application/json'},body:JSON.stringify(rpc)});
  failure(await reply.json(), 'MEMORY_LINK_PROFILE_REQUIRED');
  assert.equal(contacts, 0);
});


test('direct helper rejects accessors and inherited objects without invoking a getter', async () => {
  const association = require('../lib/memory-association.cjs');
  let invoked = 0;
  const accessor = {...input};
  Object.defineProperty(accessor, 'relation', {get() {invoked++; throw Error('should-stay-private');}, enumerable:true});
  const context = {apiBase:'https://fixture.invalid/v1', token:'synthetic', profileMode:'single'};
  for (const args of [accessor, Object.assign(Object.create({ancestor:true}), input)]) {
    await assert.rejects(association.record(args, context, () => assert.fail('transport')), error => error.code === 'INVALID_MEMORY_LINK');
  }
  const unsafe = association.safeFailure(new Error('should-stay-private'));
  assert.equal(unsafe.code, 'MEMORY_LINK_UNVERIFIED');
  assert.ok(!unsafe.message.includes('should-stay-private'));
  assert.equal(invoked, 0);
});


test('vault-only saved login is loaded once before capability and pinned through readback', async t => {
  let reads = 0;
  const {call, calls} = scripted(t, [json(capability), json(saved, 201), json(current)], {
    apiBase: process.env.VALKYR_API_BASE || 'https://api-0.valkyrlabs.com/v1', token:'',
    keychainReader: () => {reads++; return 'synthetic-stored-session';}
  });
  assert.equal(JSON.parse((await call()).result.content[0].text).status, 'linked');
  assert.equal(reads, 1);
  assert.ok(calls.every(c => c.headers.authorization === 'Bearer synthetic-stored-session'));
});

test('a changed selected origin cannot borrow a saved process profile token', async t => {
  const {call, calls} = scripted(t, [], {token:'', apiBase:'https://other-profile.invalid/v1',
    keychainReader: () => assert.fail('cross-profile vault read')});
  failure(await call(), 'MEMORY_LINK_PROFILE_REQUIRED');
  assert.equal(calls.length, 0);
});

test('stdio rejects invalid UTF-8 without echo and preserves split multibyte inputs', async t => {
  const upstream = new PassThrough();
  const output = new PassThrough();
  let requests = 0;
  const replies = [capability, saved, current];
  startStdioServer({input:upstream, output, apiBase:'https://fixture.invalid/v1', token:'synthetic',
    fetch:async () => json(replies[requests], ++requests === 2 ? 201 : 200)});
  t.after(() => {upstream.end(); output.destroy();});
  const payload = JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'memory_link',arguments:input}});
  const raw = Buffer.from(payload + '\n');
  const bytes = Buffer.from('🔗');
  const offset = raw.indexOf(bytes);
  for (const invalid of [Buffer.from([0xc3, 0x28]), Buffer.from([0xed,0xa0,0x80]), Buffer.from([0xc0,0xaf])]) {
    const response = once(output, 'data');
    upstream.write(Buffer.concat([raw.subarray(0, offset), invalid, raw.subarray(offset + bytes.length)]));
    assert.deepEqual(JSON.parse((await response)[0]).error, {code:-32700,message:'Invalid JSON-RPC message.'});
    assert.equal(requests, 0);
  }
  const response = once(output, 'data');
  upstream.write(raw.subarray(0, offset + 1));
  await new Promise(resolve => setImmediate(resolve));
  upstream.write(raw.subarray(offset + 1, offset + 3));
  await new Promise(resolve => setImmediate(resolve));
  upstream.write(raw.subarray(offset + 3));
  const result = JSON.parse((await response)[0]);
  assert.equal(JSON.parse(result.result.content[0].text).relation, input.relation);
  assert.equal(requests, 3);
});

test('actual HTTP input rejects malformed UTF-8, duplicate keys and syntax without disclosure or write', async t => {
  let requests = 0;
  const server = createGrayMatterMcpServer({apiBase:'https://fixture.invalid/v1', deploymentMode:'hosted-multi-tenant',
    fetch:async () => {requests++; throw Error('No backend request expected');}});
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(() => {server.closeAllConnections(); return new Promise(resolve => server.close(resolve));});
  const body = Buffer.from(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'memory_link',arguments:input}}));
  const offset = body.indexOf(Buffer.from('🔗'));
  const invalid = Buffer.concat([body.subarray(0,offset),Buffer.from([0xc3,0x28]),body.subarray(offset+4)]);
  const duplicate = body.toString().replace('"relation":','"relation":"should-stay-private","relation":');
  for (const raw of [invalid, duplicate, '{"privateField":"should-stay-private",']) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}`, {method:'POST',
      headers:{authorization:'Bearer synthetic','content-type':'application/json'},body:raw});
    assert.equal(response.status,400);
    assert.deepEqual(await response.json(), {error:'Invalid JSON body.'});
    assert.equal(requests,0);
  }
});

test('real response loss after a committed write stays unverified and caller retry reuses the original identity', async t => {
  let posts = 0;
  const origin = await listen(t, (req, res) => {
    if (req.method === 'POST') {
      posts++;
      req.resume();
      req.on('end', () => {
        if (posts === 1) {req.socket.destroy(); return;}
        res.writeHead(200, {'content-type':'application/json'}); res.end(JSON.stringify(current));
      });
      return;
    }
    res.writeHead(200, {'content-type':'application/json'});
    res.end(JSON.stringify(req.url.endsWith('/capabilities') ? capability : current));
  });
  const call = client(t, {apiBase:origin + '/v1', lightUsername:'fixture', lightPassword:'local',
    loginProvider: () => assert.fail('No automatic login'), apiShellProvider: () => assert.fail('No fallback')});
  failure(await call(), 'MEMORY_LINK_UNVERIFIED');
  assert.equal(posts,1);
  const replay = JSON.parse((await call()).result.content[0].text);
  assert.equal(posts,2);
  assert.equal(replay.replayed,true);
  assert.equal(replay.associationRef,saved.associationRef);
});
