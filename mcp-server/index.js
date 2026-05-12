#!/usr/bin/env node
'use strict';

const http = require('node:http');
const readline = require('node:readline');
const { URL } = require('node:url');

const DEFAULT_API_BASE = 'https://api-0.valkyrlabs.com/v1';
const DEFAULT_PORT = 3333;

const tools = [
  {
    name: 'memory_write',
    description: 'Write a durable GrayMatter MemoryEntry.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['decision', 'todo', 'context', 'artifact', 'preference'] },
        text: { type: 'string' },
        sourceChannel: { type: 'string' },
        tags: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] }
      },
      required: ['type', 'text']
    }
  },
  {
    name: 'memory_read',
    description: 'Read a durable GrayMatter MemoryEntry by id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id']
    }
  },
  {
    name: 'memory_query',
    description: 'Semantic search across GrayMatter memory.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100 }
      },
      required: ['query']
    }
  },
  {
    name: 'graph_get',
    description: 'Inspect the SwarmOps shared object graph.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Optional graph subpath.' }
      }
    }
  },
  {
    name: 'entity_list',
    description: 'List live ValkyrAI business entities by type.',
    inputSchema: {
      type: 'object',
      properties: {
        entityType: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 500 },
        offset: { type: 'integer', minimum: 0 }
      },
      required: ['entityType']
    }
  },
  {
    name: 'entity_get',
    description: 'Fetch one live ValkyrAI business entity by type and id.',
    inputSchema: {
      type: 'object',
      properties: {
        entityType: { type: 'string' },
        id: { type: 'string' }
      },
      required: ['entityType', 'id']
    }
  },
  {
    name: 'entity_create',
    description: 'Create one live ValkyrAI business entity when RBAC permits it.',
    inputSchema: {
      type: 'object',
      properties: {
        entityType: { type: 'string' },
        body: { type: 'object' }
      },
      required: ['entityType', 'body']
    }
  },
  {
    name: 'schema_summary',
    description: 'Summarize the live ValkyrAI OpenAPI schema.',
    inputSchema: { type: 'object', properties: {} }
  }
];

function createGrayMatterMcpServer(options = {}) {
  const apiBase = withoutTrailingSlash(options.apiBase || process.env.VALKYR_API_BASE || DEFAULT_API_BASE);
  const fetchImpl = options.fetch || globalThis.fetch;

  if (typeof fetchImpl !== 'function') {
    throw new Error('Global fetch is required. Use Node 20 or newer.');
  }

  return http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url, 'http://127.0.0.1');

      if (req.method === 'OPTIONS') {
        sendNoContent(res);
        return;
      }

      if (req.method === 'GET' && requestUrl.pathname === '/health') {
        sendJson(res, 200, {
          ok: true,
          apiBase,
          tools: tools.map((tool) => tool.name)
        });
        return;
      }

      if (req.method === 'GET' && requestUrl.pathname === '/sse') {
        openSseStream(req, res);
        return;
      }

      if (req.method === 'POST' && (requestUrl.pathname === '/' || requestUrl.pathname === '/message')) {
        const rpcRequest = await readJson(req);
        const rpcResponse = await handleRpc(rpcRequest, {
          apiBase,
          fetchImpl,
          token: authTokenFrom(req)
        });

        if (rpcResponse === null) {
          sendNoContent(res);
          return;
        }

        sendJson(res, 200, rpcResponse);
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
  });
}

function createRpcContext(options = {}) {
  const apiBase = withoutTrailingSlash(options.apiBase || process.env.VALKYR_API_BASE || DEFAULT_API_BASE);
  const fetchImpl = options.fetch || globalThis.fetch;

  if (typeof fetchImpl !== 'function') {
    throw new Error('Global fetch is required. Use Node 20 or newer.');
  }

  return {
    apiBase,
    fetchImpl,
    token: options.token || process.env.VALKYR_AUTH_TOKEN || process.env.VALKYR_JWT_SESSION || ''
  };
}

function startStdioServer(options = {}) {
  const context = createRpcContext(options);
  const lines = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity
  });

  lines.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    try {
      const message = JSON.parse(trimmed);
      const response = await handleRpc(message, context);
      if (response !== null) {
        process.stdout.write(`${JSON.stringify(response)}\n`);
      }
    } catch (error) {
      process.stdout.write(`${JSON.stringify(jsonRpcError(null, -32700, `Invalid JSON-RPC message: ${error.message}`))}\n`);
    }
  });
}

async function handleRpc(message, context) {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return jsonRpcError(null, -32600, 'Invalid JSON-RPC request');
  }

  const id = Object.prototype.hasOwnProperty.call(message, 'id') ? message.id : null;

  if (!Object.prototype.hasOwnProperty.call(message, 'id')) {
    if (message.method === 'notifications/initialized') {
      return null;
    }
    return null;
  }

  try {
    switch (message.method) {
      case 'initialize':
        return jsonRpcResult(id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: {
            name: 'graymatter',
            version: '0.1.0'
          }
        });
      case 'tools/list':
        return jsonRpcResult(id, { tools });
      case 'tools/call':
        return jsonRpcResult(id, await callTool(message.params || {}, context));
      default:
        return jsonRpcError(id, -32601, `Unknown method: ${message.method}`);
    }
  } catch (error) {
    return jsonRpcError(id, -32000, error.message);
  }
}

async function callTool(params, context) {
  const name = params.name;
  const args = params.arguments || {};

  switch (name) {
    case 'memory_write':
      return toolResult(await apiRequest(context, 'POST', 'MemoryEntry', args));
    case 'memory_read':
      requireString(args.id, 'id');
      return toolResult(await apiRequest(context, 'GET', `MemoryEntry/${encodeURIComponent(args.id)}`));
    case 'memory_query':
      requireString(args.query, 'query');
      return toolResult(await apiRequest(context, 'POST', 'MemoryEntry/query', args));
    case 'graph_get': {
      const graphPath = args.path ? `SwarmOps/graph/${trimSlashes(args.path)}` : 'SwarmOps/graph';
      return toolResult(await apiRequest(context, 'GET', graphPath));
    }
    case 'entity_list': {
      requireEntityType(args.entityType);
      const query = new URLSearchParams();
      if (args.limit !== undefined) query.set('limit', String(args.limit));
      if (args.offset !== undefined) query.set('offset', String(args.offset));
      const suffix = query.toString() ? `?${query}` : '';
      return toolResult(await apiRequest(context, 'GET', `${args.entityType}${suffix}`));
    }
    case 'entity_get':
      requireEntityType(args.entityType);
      requireString(args.id, 'id');
      return toolResult(await apiRequest(context, 'GET', `${args.entityType}/${encodeURIComponent(args.id)}`));
    case 'entity_create':
      requireEntityType(args.entityType);
      if (!args.body || typeof args.body !== 'object' || Array.isArray(args.body)) {
        throw new Error('body must be an object');
      }
      return toolResult(await apiRequest(context, 'POST', args.entityType, args.body));
    case 'schema_summary':
      return toolResult(summarizeOpenApi(await apiRequest(context, 'GET', 'api-docs')));
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function apiRequest(context, method, endpoint, body) {
  const headers = {
    accept: 'application/json'
  };

  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  if (context.token) {
    headers.authorization = `Bearer ${context.token}`;
    headers.VALKYR_AUTH = context.token;
    headers.cookie = `VALKYR_AUTH=${context.token}`;
  }

  const response = await context.fetchImpl(apiUrl(context.apiBase, endpoint), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const raw = await response.text();
  const payload = raw ? parseJson(raw) : null;

  if (!response.ok) {
    const message = payload && typeof payload.message === 'string'
      ? payload.message
      : `api-0 request failed with HTTP ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

function summarizeOpenApi(spec) {
  const entities = new Set();
  for (const tag of spec.tags || []) {
    if (tag && typeof tag.name === 'string' && isEntityName(tag.name)) {
      entities.add(tag.name);
    }
  }

  const paths = spec.paths || {};
  for (const path of Object.keys(paths)) {
    const firstSegment = path.split('/').filter(Boolean)[0];
    if (firstSegment && isEntityName(firstSegment)) {
      entities.add(firstSegment);
    }
  }

  return {
    title: spec.info && spec.info.title ? spec.info.title : 'ValkyrAI API',
    version: spec.info && spec.info.version ? spec.info.version : null,
    pathCount: Object.keys(paths).length,
    entities: Array.from(entities)
  };
}

function authTokenFrom(req) {
  const headerToken = req.headers['x-valkyr-token'];
  if (Array.isArray(headerToken)) {
    return headerToken[0] || process.env.VALKYR_AUTH_TOKEN || '';
  }
  return headerToken || process.env.VALKYR_AUTH_TOKEN || '';
}

function apiUrl(apiBase, endpoint) {
  const base = `${withoutTrailingSlash(apiBase)}/`;
  const cleanEndpoint = endpoint.replace(/^\/+/, '');
  return new URL(cleanEndpoint, base).toString();
}

function openSseStream(req, res) {
  res.writeHead(200, {
    'access-control-allow-origin': '*',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'content-type': 'text/event-stream'
  });
  res.write('event: endpoint\n');
  res.write('data: /message\n\n');
  const keepAlive = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 25000);
  req.on('close', () => clearInterval(keepAlive));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('error', reject);
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error(`Invalid JSON body: ${error.message}`));
      }
    });
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type,x-valkyr-token',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'content-type': 'application/json'
  });
  res.end(JSON.stringify(payload));
}

function sendNoContent(res) {
  res.writeHead(204, {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type,x-valkyr-token',
    'access-control-allow-methods': 'GET,POST,OPTIONS'
  });
  res.end();
}

function toolResult(value) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(value)
      }
    ]
  };
}

function jsonRpcResult(id, result) {
  return {
    jsonrpc: '2.0',
    id,
    result
  };
}

function jsonRpcError(id, code, message) {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message }
  };
}

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function requireString(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
}

function requireEntityType(value) {
  requireString(value, 'entityType');
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(value)) {
    throw new Error('entityType must be a simple schema type name');
  }
}

function isEntityName(value) {
  return /^[A-Z][A-Za-z0-9_]*$/.test(value);
}

function trimSlashes(value) {
  return String(value).replace(/^\/+|\/+$/g, '');
}

function withoutTrailingSlash(value) {
  return String(value).replace(/\/+$/g, '');
}

module.exports = {
  createGrayMatterMcpServer,
  startStdioServer,
  tools
};

if (require.main === module) {
  if (process.argv.includes('--stdio')) {
    startStdioServer();
  } else {
    const port = Number(process.env.PORT || DEFAULT_PORT);
    const server = createGrayMatterMcpServer();
    server.listen(port, () => {
      process.stdout.write(`GrayMatter MCP server listening on http://localhost:${port}\n`);
    });
  }
}
