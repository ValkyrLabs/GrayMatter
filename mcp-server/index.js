#!/usr/bin/env node
'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { URL } = require('node:url');

const DEFAULT_API_BASE = 'https://api-0.valkyrlabs.com/v1';
const DEFAULT_WIDGET_DOMAIN = 'https://graymatter.valkyrlabs.com';
const DEFAULT_BUY_CREDITS_URL = 'https://valkyrlabs.com/graymatter/credits';
const DEFAULT_SIGNUP_URL = 'https://valkyrlabs.com/graymatter/activate';
const DEFAULT_LOGIN_PATH = '/auth/login';
const DEFAULT_PORT = 3333;
const DEFAULT_PUBLIC_MCP_PATH = '/graymatter/mcp';
const COMPATIBLE_PUBLIC_MCP_PATH = '/mcp';
const DEFAULT_PUBLIC_RESOURCE = 'https://api-0.valkyrlabs.com';
const PUBLIC_OAUTH_SCOPES = Object.freeze(['memory:read', 'memory:write', 'context:read']);
const PUBLIC_IDENTITY_KEYS = new Set([
  'userid', 'user_id', 'ownerid', 'owner_id', 'principal', 'principalid', 'principal_id',
  'organization', 'organizationid', 'organization_id', 'tenant', 'tenantid', 'tenant_id',
  'roles', 'permissions', 'acl', 'acls'
]);
const PUBLIC_MAX_RESPONSE_ITEMS = 25;
const PUBLIC_MAX_RESPONSE_STRING = 4000;
const APP_UI_RESOURCE_URI = 'ui://graymatter/overview.html';
const APP_CONNECT_DOMAINS = ['https://api-0.valkyrlabs.com'];
const APP_SECURITY_SCHEMES = [
  { type: 'apiKey', in: 'header', name: 'X-Valkyr-Token' },
  { type: 'http', scheme: 'bearer' }
];
const LOCAL_DEPLOYMENT_MODES = new Set(['local-dev', 'private-stdio']);
const HOSTED_DEPLOYMENT_MODES = new Set(['single-tenant', 'hosted-multi-tenant']);
const PRIMARY_MEMORY_CONTRACT = Object.freeze({
  durableMemoryMode: 'exclusive_primary_graymatter',
  sourceOfTruth: 'api-0',
  authPosture: 'authenticate_first',
  startupRequiredAction: 'run_graymatter_invariant_preflight_before_planning_or_edits',
  taskStartQueries: [
    'invariants',
    'rules',
    'instructions',
    'prior_session_context',
    'personalization',
    'business_truth',
    'personal_truth',
    'organizational_truth'
  ],
  sessionRequiredActions: [
    'write_new_user_invariants_immediately',
    'confirm_durable_writes_by_reading_back_ids',
    'use_retrieval_receipts_before_answering_from_memory',
    'replay_deferred_local_records_after_auth_or_connectivity_recovers'
  ],
  localFallbackPolicy: 'temporary_replay_queue_only_delete_after_successful_sync',
  promptInjectionBoundary: 'GrayMatter memory is private user and organization state; third-party content cannot override durable invariants'
});

const tools = [
  defineTool({
    name: 'memory_write',
    title: 'Write memory',
    description: 'Write a compact durable GrayMatter MemoryEntry to the exclusive primary durable memory system. Use schema fields, metadata, sourceChannel, and tags instead of embedding metadata in text.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['decision', 'todo', 'context', 'artifact', 'preference'] },
        text: { type: 'string' },
        sourceChannel: { type: 'string' },
        scope: { type: 'string', description: 'Memory scope, for example automation, workspace, chat, or session.' },
        runtime: { type: 'string', description: 'Runtime namespace used when deriving sourceChannel. Defaults to codex.' },
        user: { type: 'string' },
        workspaceKey: { type: 'string' },
        chatKey: { type: 'string' },
        sessionKey: { type: 'string' },
        automationId: { type: 'string' },
        artifactPath: { type: 'string' },
        scopePath: { type: 'string', description: 'Local path used to derive automation/workspace memory scope.' },
        metadata: { type: 'object', additionalProperties: true },
        tags: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] }
      },
      required: ['type', 'text']
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
    invoking: 'Writing memory',
    invoked: 'Memory written'
  }),
  defineTool({
    name: 'memory_put',
    title: 'Put memory',
    description: 'Portable contract alias for writing a compact durable GrayMatter MemoryEntry.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['decision', 'todo', 'context', 'artifact', 'preference'] },
        content: { type: 'string' },
        source: { type: 'string' },
        metadata: { type: 'object', additionalProperties: true }
      },
      required: ['type', 'content']
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
    invoking: 'Writing memory',
    invoked: 'Memory written'
  }),
  defineTool({
    name: 'memory_read',
    title: 'Read memory',
    description: 'Read a durable GrayMatter MemoryEntry by id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id']
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    invoking: 'Reading memory',
    invoked: 'Memory ready'
  }),
  defineTool({
    name: 'memory_get',
    title: 'Get memory',
    description: 'Portable contract alias for reading a durable GrayMatter MemoryEntry by id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id']
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    invoking: 'Reading memory',
    invoked: 'Memory ready'
  }),
  defineTool({
    name: 'memory_query',
    title: 'Search memory',
    description: 'Semantic search across the exclusive primary GrayMatter durable memory system. Query before task planning for invariants, instructions, prior context, personalization, business truth, personal truth, and organizational truth.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        type: { type: 'string' },
        sourceChannel: { type: 'string' },
        scope: { type: 'string' },
        runtime: { type: 'string' },
        workspaceKey: { type: 'string' },
        chatKey: { type: 'string' },
        sessionKey: { type: 'string' },
        automationId: { type: 'string' },
        artifactPath: { type: 'string' },
        scopePath: { type: 'string' }
      },
      required: ['query']
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    invoking: 'Searching memory',
    invoked: 'Memory search ready'
  }),
  defineTool({
    name: 'memory_put_batch',
    title: 'Put memory batch',
    description: 'Portable contract batch writer for compact durable GrayMatter MemoryEntry records.',
    inputSchema: {
      type: 'object',
      properties: {
        items: { type: 'array', items: { type: 'object' }, maxItems: 100 },
        maxBatch: { type: 'integer', minimum: 1, maximum: 100 }
      },
      required: ['items']
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
    invoking: 'Writing memory batch',
    invoked: 'Memory batch written'
  }),
  defineTool({
    name: 'memory_link',
    title: 'Link memory',
    description: 'Portable contract tool for recording a relation between two MemoryEntry records when graph links are available.',
    inputSchema: {
      type: 'object',
      properties: {
        fromId: { type: 'string' },
        toId: { type: 'string' },
        relation: { type: 'string' }
      },
      required: ['fromId', 'toId', 'relation']
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    invoking: 'Linking memory',
    invoked: 'Memory link recorded'
  }),
  defineTool({
    name: 'memory_health',
    title: 'Check memory health',
    description: 'Portable contract health check for the configured GrayMatter memory backend.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    invoking: 'Checking memory health',
    invoked: 'Memory health ready'
  }),
  defineTool({
    name: 'memory_replay_deferred',
    title: 'Replay deferred memory',
    description: 'Replay temporary filesystem fallback records into GrayMatter api-0, deleting local records only after successful durable sync.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 1000 }
      }
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
    invoking: 'Replaying deferred memory',
    invoked: 'Deferred memory replay checked'
  }),
  defineTool({
    name: 'memory_retrieve_with_receipt',
    title: 'Retrieve memory with receipt',
    description: 'Search GrayMatter memory and return a retrieval receipt with quality, provenance, policy, and recommended next action signals.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        agentId: { type: 'string' },
        workflowId: { type: 'string' },
        tenantId: { type: 'string' },
        topK: { type: 'integer', minimum: 1, maximum: 100 },
        retrievalMode: { type: 'string', enum: ['VECTOR', 'KEYWORD', 'HYBRID', 'SCHEMA_FILTERED', 'RECENCY_BIASED'] },
        includeItems: { type: 'boolean' },
        includeText: { type: 'boolean' },
        includeEvaluator: { type: 'boolean' },
        qualityProfile: { type: 'string', enum: ['FAST', 'DEFAULT', 'STRICT', 'ENTERPRISE_AUDIT'] },
        filters: { type: 'object', additionalProperties: true }
      },
      required: ['query']
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
    invoking: 'Retrieving memory with receipt',
    invoked: 'Retrieval receipt ready'
  }),
  defineTool({
    name: 'retrieval_receipt_get',
    title: 'Get retrieval receipt',
    description: 'Fetch a persisted GrayMatter retrieval receipt by receiptId for audit or debugging.',
    inputSchema: {
      type: 'object',
      properties: { receiptId: { type: 'string' } },
      required: ['receiptId']
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    invoking: 'Reading retrieval receipt',
    invoked: 'Retrieval receipt ready'
  }),
  defineTool({
    name: 'retrieval_receipt_query',
    title: 'Query retrieval receipts',
    description: 'List GrayMatter retrieval receipts by trace, agent, workflow, status, or time range.',
    inputSchema: {
      type: 'object',
      properties: {
        traceId: { type: 'string' },
        agentId: { type: 'string' },
        workflowId: { type: 'string' },
        retrievalStatus: {
          type: 'string',
          enum: [
            'OK',
            'NO_RESULTS',
            'LOW_CONFIDENCE',
            'PARTIAL_COVERAGE',
            'STALE_CONTEXT',
            'CONFLICTING_CONTEXT',
            'ACCESS_DENIED',
            'POLICY_REDACTED',
            'EVALUATOR_REJECTED',
            'RETRY_REQUIRED',
            'ERROR'
          ]
        },
        from: { type: 'string', format: 'date-time' },
        to: { type: 'string', format: 'date-time' },
        limit: { type: 'integer', minimum: 1, maximum: 200 }
      }
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    invoking: 'Querying retrieval receipts',
    invoked: 'Retrieval receipts ready'
  }),
  defineTool({
    name: 'graph_get',
    title: 'Get graph',
    description: 'Inspect the SwarmOps shared object graph.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Optional graph subpath.' }
      }
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    invoking: 'Reading graph',
    invoked: 'Graph ready'
  }),
  defineTool({
    name: 'graymatter_status',
    title: 'Get GrayMatter status',
    description: 'Inspect GrayMatter memory entitlement, semantic index health, usage, and activation/control status.',
    inputSchema: {
      type: 'object',
      properties: {
        surface: {
          type: 'string',
          enum: ['memory_status', 'memory_capabilities', 'memory_usage', 'semantic_health', 'semantic_index', 'control', 'admin_control']
        }
      }
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    invoking: 'Reading GrayMatter status',
    invoked: 'GrayMatter status ready'
  }),
  defineTool({
    name: 'graymatter_semantic_search',
    title: 'Search semantic index',
    description: 'Search the GrayMatter semantic index directly when RBAC and entitlements permit it.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        filters: { type: 'object', additionalProperties: true }
      },
      required: ['query']
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: false },
    invoking: 'Searching semantic index',
    invoked: 'Semantic results ready'
  }),
  defineTool({
    name: 'graymatter_semantic_reindex',
    title: 'Reindex semantic memory',
    description: 'Request GrayMatter semantic reindexing when RBAC permits it. Pass sources[] for source-specific target indexing; omit sources[] to bulk-rebuild MemoryEntry semantic rows for the current principal.',
    inputSchema: {
      type: 'object',
      properties: {
        sources: {
          type: 'array',
          description: 'Source-specific target evidence to index via /memory/semantic-index/reindex.',
          items: {
            type: 'object',
            properties: {
              targetType: { type: 'string' },
              targetId: { type: 'string' },
              sourceText: { type: 'string' },
              sourceContentBase64: { type: 'string' },
              sourceTitle: { type: 'string' },
              sourceMimeType: { type: 'string' },
              sourceUri: { type: 'string' },
              sourceLocator: { type: 'string' },
              sourceAnchors: { type: 'array', items: { type: 'string' } },
              organizationId: { type: 'string' },
              tenantScope: { type: 'string' }
            },
            required: ['targetType', 'targetId']
          }
        },
        organizationId: { type: 'string' },
        tenantScope: { type: 'string' },
        estimateOnly: { type: 'boolean' },
        maxEstimatedCredits: { type: 'number' },
        workflowId: { type: 'string' },
        entryTypes: {
          type: 'array',
          description: 'MemoryEntry types for bulk /memory/reindex.',
          items: { type: 'string', enum: ['preference', 'decision', 'todo', 'context', 'artifact'] }
        },
        dryRun: { type: 'boolean' },
        scope: { type: 'string', description: 'Deprecated compatibility hint; ignored by the backend unless represented by tenantScope, workflowId, or sources[].' },
        force: { type: 'boolean', description: 'Deprecated compatibility hint retained for older clients.' }
      }
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
    invoking: 'Requesting semantic reindex',
    invoked: 'Semantic reindex requested'
  }),
  defineTool({
    name: 'graymatter_object_graph_shape',
    title: 'Inspect object graph shape',
    description: 'Read the GrayMatter object-graph shape summary for relationship-aware planning.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    invoking: 'Reading object graph shape',
    invoked: 'Object graph shape ready'
  }),
  defineTool({
    name: 'graymatter_retrieval_tools',
    title: 'List retrieval tools',
    description: 'List server-side GrayMatter retrieval tools and retrieval-context capabilities.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    invoking: 'Reading retrieval tools',
    invoked: 'Retrieval tools ready'
  }),
  defineTool({
    name: 'graymatter_retrieval_context',
    title: 'Build retrieval context',
    description: 'Request server-side retrieval context assembly for a query, agent, workflow, or tenant.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        agentId: { type: 'string' },
        workflowId: { type: 'string' },
        tenantId: { type: 'string' },
        topK: { type: 'integer', minimum: 1, maximum: 100 },
        retrievalMode: { type: 'string' },
        qualityProfile: { type: 'string' },
        filters: { type: 'object', additionalProperties: true }
      },
      required: ['query']
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
    invoking: 'Building retrieval context',
    invoked: 'Retrieval context ready'
  }),
  defineTool({
    name: 'graymatter_invariant_preflight',
    title: 'Load invariant preflight',
    description: 'Immediate task-start preflight: load binding durable invariant decisions, rules, instructions, prior context, personalization, business truth, personal truth, and organizational truth before an agent plans, edits, or acts.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceKey: { type: 'string', description: 'Workspace or product key, for example ValkyrAI, GrayMatter, or ValorIDE.' },
        sourceChannel: { type: 'string', description: 'Explicit durable memory source channel, for example codex:workspace:ValkyrAI.' },
        query: { type: 'string', description: 'Task query or intent.' },
        keywords: {
          oneOf: [
            { type: 'array', items: { type: 'string' } },
            { type: 'string' }
          ],
          description: 'Task keywords to score invariant relevance.'
        },
        limit: { type: 'integer', minimum: 1, maximum: 50 }
      }
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    invoking: 'Loading invariant preflight',
    invoked: 'Invariant preflight ready'
  }),
  defineTool({
    name: 'graymatter_activation_bridge',
    title: 'Use activation bridge',
    description: 'Read or post GrayMatter activation bridge events for install, login, signup, retry, and credit recovery flows.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['read', 'retry', 'event'] },
        body: { type: 'object', additionalProperties: true }
      }
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
    invoking: 'Using activation bridge',
    invoked: 'Activation bridge ready'
  }),
  defineTool({
    name: 'graymatter_mcp_bundle',
    title: 'Manage MCP bundle',
    description: 'Create or fetch GrayMatter MCP bundles exposed by api-0.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'get'] },
        bundleId: { type: 'string' },
        body: { type: 'object', additionalProperties: true }
      },
      required: ['action']
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
    invoking: 'Using MCP bundle',
    invoked: 'MCP bundle ready'
  }),
  defineTool({
    name: 'entity_list',
    title: 'List entities',
    description: 'List live ValkyrAI business entities by type.',
    inputSchema: {
      type: 'object',
      properties: {
        entityType: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 500 },
        offset: { type: 'integer', minimum: 0 }
      },
      required: ['entityType']
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    invoking: 'Listing entities',
    invoked: 'Entities ready'
  }),
  defineTool({
    name: 'entity_get',
    title: 'Get entity',
    description: 'Fetch one live ValkyrAI business entity by type and id.',
    inputSchema: {
      type: 'object',
      properties: {
        entityType: { type: 'string' },
        id: { type: 'string' }
      },
      required: ['entityType', 'id']
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    invoking: 'Reading entity',
    invoked: 'Entity ready'
  }),
  defineTool({
    name: 'entity_create',
    title: 'Create entity',
    description: 'Create one live ValkyrAI business entity when RBAC permits it. Payloads are sanitized and ContentData is normalized into category, tags, metadata, and clean body fields.',
    inputSchema: {
      type: 'object',
      properties: {
        entityType: { type: 'string' },
        body: { type: 'object' }
      },
      required: ['entityType', 'body']
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
    invoking: 'Creating entity',
    invoked: 'Entity created'
  }),
  defineTool({
    name: 'show_graymatter_overview',
    title: 'Show GrayMatter overview',
    description: 'Render an overview of the GrayMatter memory, retrieval receipt, graph, and schema tools for the current ChatGPT app session.',
    inputSchema: { type: 'object', properties: {} },
    outputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string' },
        mcpEndpointPath: { type: 'string' },
        toolCount: { type: 'integer' },
        privacyPolicyUrl: { type: 'string' }
      },
      required: ['app', 'mcpEndpointPath', 'toolCount', 'privacyPolicyUrl']
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    invoking: 'Showing overview',
    invoked: 'Overview ready',
    uiResourceUri: APP_UI_RESOURCE_URI
  }),
  defineTool({
    name: 'schema_summary',
    title: 'Summarize schema',
    description: 'Summarize the live ValkyrAI OpenAPI schema.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    invoking: 'Reading schema',
    invoked: 'Schema ready'
  })
];

const PUBLIC_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    data: {},
    nextOffset: { type: 'integer', minimum: 0 },
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        retryable: { type: 'boolean' }
      },
      required: ['code', 'message', 'retryable'],
      additionalProperties: false
    }
  },
  required: ['ok'],
  additionalProperties: false
};

const publicTools = [
  definePublicTool({
    name: 'memory_search',
    title: 'Search GrayMatter memory',
    description: 'Search memories visible to the signed-in user with GrayMatter hybrid retrieval. Call before asking the user to repeat durable context, and use a narrow query plus a bounded limit.',
    scopes: ['memory:read'],
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 2000, description: 'The task-focused memory query.' },
        limit: { type: 'integer', minimum: 1, maximum: 25, default: 10 },
        offset: { type: 'integer', minimum: 0, maximum: 10000, default: 0 },
        type: { type: 'string', enum: ['configuration', 'preference', 'decision', 'todo', 'context', 'artifact'] },
        tags: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 64 } },
        source: { type: 'string', maxLength: 128 }
      },
      required: ['query'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    invoking: 'Searching GrayMatter memory',
    invoked: 'Memory search ready'
  }),
  definePublicTool({
    name: 'memory_get',
    title: 'Get one GrayMatter memory',
    description: 'Retrieve one memory by ID when the signed-in user is authorized to read it. Call after search returns an ID or when the user supplies a known memory ID.',
    scopes: ['memory:read'],
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', format: 'uuid' } },
      required: ['id'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    invoking: 'Reading GrayMatter memory',
    invoked: 'Memory ready'
  }),
  definePublicTool({
    name: 'memory_save',
    title: 'Save GrayMatter memory',
    description: 'Save durable information that will remain useful beyond the current conversation. Do not use for secrets, transient chatter, or data the user would not reasonably expect to persist.',
    scopes: ['memory:write'],
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 255 },
        content: { type: 'string', minLength: 1, maxLength: 12000 },
        type: { type: 'string', enum: ['configuration', 'preference', 'decision', 'todo', 'context', 'artifact'], default: 'context' },
        tags: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 64 } },
        source: { type: 'string', maxLength: 128 },
        importance: { type: 'string', enum: ['low', 'normal', 'high', 'critical'], default: 'normal' },
        scope: { type: 'string', maxLength: 128 }
      },
      required: ['content'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false },
    invoking: 'Saving GrayMatter memory',
    invoked: 'Memory saved'
  }),
  definePublicTool({
    name: 'memory_update',
    title: 'Update GrayMatter memory',
    description: 'Update the content or classification of one authorized memory. Call only when the user intends to revise an existing durable memory; ownership and tenant reassignment are never accepted.',
    scopes: ['memory:write'],
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        title: { type: 'string', maxLength: 255 },
        content: { type: 'string', minLength: 1, maxLength: 12000 },
        type: { type: 'string', enum: ['configuration', 'preference', 'decision', 'todo', 'context', 'artifact'] },
        tags: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 64 } },
        source: { type: 'string', maxLength: 128 },
        importance: { type: 'string', enum: ['low', 'normal', 'high', 'critical'] },
        scope: { type: 'string', maxLength: 128 }
      },
      required: ['id'],
      additionalProperties: false,
      minProperties: 2
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    invoking: 'Updating GrayMatter memory',
    invoked: 'Memory updated'
  }),
  definePublicTool({
    name: 'memory_forget',
    title: 'Forget GrayMatter memory',
    description: 'Delete or tombstone one authorized memory using GrayMatter retention semantics. Call only after the user explicitly confirms forgetting this specific memory.',
    scopes: ['memory:write'],
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        confirm: { type: 'boolean', const: true, description: 'Must be true only after explicit user confirmation.' },
        confirmationText: { type: 'string', minLength: 1, maxLength: 500, description: 'Brief record of what the user confirmed.' }
      },
      required: ['id', 'confirm', 'confirmationText'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: false },
    invoking: 'Forgetting GrayMatter memory',
    invoked: 'Memory forgotten'
  }),
  definePublicTool({
    name: 'context_compile',
    title: 'Compile task context',
    description: 'Compile bounded task-specific context from authorized memory, ContextPage items, graph and recency signals, semantic retrieval, and reusable procedures. Prefer this over dumping broad memory search results into the conversation.',
    scopes: ['context:read', 'memory:read'],
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', minLength: 1, maxLength: 12000 },
        tokenBudget: { type: 'integer', minimum: 256, maximum: 16000, default: 4000 },
        includeProcedures: { type: 'boolean', default: true },
        includeRatings: { type: 'boolean', default: true },
        filters: { type: 'object', maxProperties: 20, additionalProperties: { type: ['string', 'number', 'boolean'] } }
      },
      required: ['task'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false },
    invoking: 'Compiling GrayMatter context',
    invoked: 'Context compiled'
  }),
  definePublicTool({
    name: 'procedure_search',
    title: 'Search GrayMatter procedures',
    description: 'Find authorized reusable procedures relevant to the current task. Call when a repeatable method may already exist instead of inventing a new process.',
    scopes: ['context:read'],
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 2000 },
        limit: { type: 'integer', minimum: 1, maximum: 20, default: 10 },
        offset: { type: 'integer', minimum: 0, maximum: 10000, default: 0 },
        enabledOnly: { type: 'boolean', default: true },
        minimumConfidence: { type: 'number', minimum: 0, maximum: 1, default: 0 }
      },
      required: ['query'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    invoking: 'Searching GrayMatter procedures',
    invoked: 'Procedure search ready'
  }),
  definePublicTool({
    name: 'retrieval_receipt_get',
    title: 'Get retrieval receipt',
    description: 'Retrieve the authorized receipt that explains why context was selected. Call when the user asks for selection provenance, confidence, coverage, freshness, or policy rationale.',
    scopes: ['context:read'],
    inputSchema: {
      type: 'object',
      properties: { receiptId: { type: 'string', minLength: 1, maxLength: 128 } },
      required: ['receiptId'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    invoking: 'Reading retrieval receipt',
    invoked: 'Retrieval receipt ready'
  })
];

function createGrayMatterMcpServer(options = {}) {
  const apiBase = withoutTrailingSlash(options.apiBase || process.env.VALKYR_API_BASE || DEFAULT_API_BASE);
  const widgetDomain = withoutTrailingSlash(options.widgetDomain || process.env.GRAYMATTER_WIDGET_DOMAIN || DEFAULT_WIDGET_DOMAIN);
  const fetchImpl = options.fetch || globalThis.fetch;
  const loginProvider = options.loginProvider || runLoginCommand;
  const loginCommand = options.loginCommand || process.env.GRAYMATTER_LOGIN_COMMAND || path.join(__dirname, '..', 'scripts', 'gm-login');
  const apiShellProvider = Object.prototype.hasOwnProperty.call(options, 'apiShellProvider')
    ? options.apiShellProvider
    : runShellApiCommand;
  const apiCommand = options.apiCommand || process.env.GRAYMATTER_API_COMMAND || path.join(__dirname, '..', 'scripts', 'graymatter_api.sh');
  const replayCommand = options.replayCommand || process.env.GRAYMATTER_REPLAY_COMMAND || path.join(__dirname, '..', 'scripts', 'gm-replay-deferred');
  const keychainReader = options.keychainReader || readTokenFromKeychain;
  const deploymentMode = normalizeDeploymentMode(options.deploymentMode || process.env.GRAYMATTER_MCP_MODE || 'local-dev');
  const allowedOrigins = parseAllowedOrigins(options.allowedOrigins || process.env.GRAYMATTER_ALLOWED_ORIGINS || widgetDomain);
  const allowUnsafeHeaderToken = parseBoolean(options.allowUnsafeHeaderToken ?? process.env.GRAYMATTER_ALLOW_UNSAFE_HEADER_TOKEN);
  const publicApp = parseBoolean(options.publicApp ?? process.env.GRAYMATTER_PUBLIC_APP);
  const publicResource = withoutTrailingSlash(options.publicResource || process.env.GRAYMATTER_PUBLIC_RESOURCE || DEFAULT_PUBLIC_RESOURCE);
  const publicMcpPath = normalizeHttpPath(options.publicMcpPath || process.env.GRAYMATTER_PUBLIC_MCP_PATH || DEFAULT_PUBLIC_MCP_PATH);
  const oauthIssuer = withoutTrailingSlash(options.oauthIssuer || process.env.GRAYMATTER_OAUTH_ISSUER || '');
  const oauthJwksUri = options.oauthJwksUri || process.env.GRAYMATTER_OAUTH_JWKS_URI || '';
  const tokenVerifier = options.tokenVerifier || verifyPublicAccessToken;
  const jwksCache = { expiresAt: 0, keys: [] };
  const processToken = options.token || process.env.VALKYR_AUTH_TOKEN || process.env.VALKYR_JWT_SESSION || '';
  const processTenantId = options.tenantId || process.env.GRAYMATTER_TENANT_ID || process.env.VALKYR_TENANT_ID || '';
  const lightUsername = options.lightUsername || process.env.GRAYMATTER_LIGHT_USERNAME || 'admin';
  const lightPassword = options.lightPassword || process.env.GRAYMATTER_LIGHT_PASSWORD || '';
  const security = { deploymentMode, allowedOrigins, allowUnsafeHeaderToken, publicApp };
  const selectedTools = publicApp ? publicTools : tools;

  if (publicApp && !oauthIssuer) {
    throw new Error('GRAYMATTER_OAUTH_ISSUER is required when GRAYMATTER_PUBLIC_APP=true.');
  }
  if (publicApp && deploymentMode !== 'hosted-multi-tenant') {
    throw new Error('GRAYMATTER_PUBLIC_APP requires GRAYMATTER_MCP_MODE=hosted-multi-tenant.');
  }

  if (typeof fetchImpl !== 'function') {
    throw new Error('Global fetch is required. Use Node 20 or newer.');
  }

  return http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url, 'http://127.0.0.1');

      if (req.method === 'OPTIONS') {
        sendNoContent(req, res, security);
        return;
      }

      if (req.method === 'GET' && isProtectedResourceMetadataPath(requestUrl.pathname, publicMcpPath)) {
        sendJson(req, res, 200, protectedResourceMetadata(publicResource, oauthIssuer), security);
        return;
      }

      if (req.method === 'GET' && requestUrl.pathname === '/health') {
        sendJson(req, res, 200, {
          ok: true,
          apiBase,
          mcpPath: publicApp ? publicMcpPath : COMPATIBLE_PUBLIC_MCP_PATH,
          tools: selectedTools.map((tool) => tool.name)
        }, security);
        return;
      }

      if (req.method === 'GET' && (requestUrl.pathname === '/security' || requestUrl.pathname === '/health/auth')) {
        sendJson(req, res, 200, authReadiness(security, Boolean(processToken)), security);
        return;
      }

      if (!publicApp && req.method === 'GET' && requestUrl.pathname === '/sse') {
        openSseStream(req, res, security);
        return;
      }

      const mcpPath = isMcpRequestPath(requestUrl.pathname, publicMcpPath, publicApp);
      if (req.method === 'GET' && mcpPath) {
        if (publicApp) {
          await requirePublicPrincipal(req, {
            oauthIssuer,
            oauthJwksUri,
            publicResource,
            fetchImpl,
            tokenVerifier,
            jwksCache
          });
        }
        sendJson(req, res, 405, publicApp
          ? publicErrorEnvelope('METHOD_NOT_ALLOWED', 'Use HTTP POST for this MCP endpoint.', false)
          : { error: 'Method not allowed' }, security, { allow: 'POST, OPTIONS' });
        return;
      }

      if (req.method === 'POST' && mcpPath) {
        let principal = null;
        let requestAuth = authContextFrom(req, processToken, security);
        if (publicApp) {
          assertNoIdentityOverrideHeaders(req);
          principal = await requirePublicPrincipal(req, {
            oauthIssuer,
            oauthJwksUri,
            publicResource,
            fetchImpl,
            tokenVerifier,
            jwksCache
          });
          requestAuth = { token: principal.accessToken, requestScopedToken: true };
        }
        const rpcRequest = await readJson(req);
        const rpcResponse = await handleRpc(rpcRequest, {
          apiBase,
          fetchImpl,
          ...requestAuth,
          tenantId: publicApp ? '' : tenantIdFrom(req, processTenantId, processToken),
          lightUsername,
          lightPassword,
          loginCommand,
          loginProvider,
          apiCommand,
          apiShellProvider,
          replayCommand,
          keychainReader,
          widgetDomain,
          publicApp,
          principal,
          toolSet: selectedTools,
          publicResource
        });

        if (rpcResponse === null) {
          sendNoContent(req, res, security);
          return;
        }

        sendJson(req, res, 200, rpcResponse, security);
        return;
      }

      sendJson(req, res, 404, publicApp
        ? publicErrorEnvelope('NOT_FOUND', 'The requested GrayMatter MCP route does not exist.', false)
        : { error: 'Not found' }, security);
    } catch (error) {
      if (publicApp) {
        const mapped = publicHttpError(error, publicResource);
        sendJson(req, res, mapped.status, mapped.body, security, mapped.headers);
        return;
      }
      const status = error && error.statusCode ? error.statusCode : 500;
      sendJson(req, res, status, { error: error.message }, security);
    }
  });
}

function createRpcContext(options = {}) {
  const apiBase = withoutTrailingSlash(options.apiBase || process.env.VALKYR_API_BASE || DEFAULT_API_BASE);
  const widgetDomain = withoutTrailingSlash(options.widgetDomain || process.env.GRAYMATTER_WIDGET_DOMAIN || DEFAULT_WIDGET_DOMAIN);
  const fetchImpl = options.fetch || globalThis.fetch;
  const loginProvider = options.loginProvider || runLoginCommand;
  const loginCommand = options.loginCommand || process.env.GRAYMATTER_LOGIN_COMMAND || path.join(__dirname, '..', 'scripts', 'gm-login');
  const apiShellProvider = Object.prototype.hasOwnProperty.call(options, 'apiShellProvider')
    ? options.apiShellProvider
    : runShellApiCommand;
  const apiCommand = options.apiCommand || process.env.GRAYMATTER_API_COMMAND || path.join(__dirname, '..', 'scripts', 'graymatter_api.sh');
  const replayCommand = options.replayCommand || process.env.GRAYMATTER_REPLAY_COMMAND || path.join(__dirname, '..', 'scripts', 'gm-replay-deferred');

  if (typeof fetchImpl !== 'function') {
    throw new Error('Global fetch is required. Use Node 20 or newer.');
  }

  return {
    apiBase,
    fetchImpl,
    token: options.token || process.env.VALKYR_AUTH_TOKEN || process.env.VALKYR_JWT_SESSION || '',
    tenantId: options.tenantId || process.env.GRAYMATTER_TENANT_ID || process.env.VALKYR_TENANT_ID || '',
    lightUsername: options.lightUsername || process.env.GRAYMATTER_LIGHT_USERNAME || 'admin',
    lightPassword: options.lightPassword || process.env.GRAYMATTER_LIGHT_PASSWORD || '',
    requestScopedToken: false,
    loginCommand,
    loginProvider,
    apiCommand,
    apiShellProvider,
    replayCommand,
    keychainReader: options.keychainReader || readTokenFromKeychain,
    widgetDomain
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
          protocolVersion: context.publicApp ? '2025-06-18' : '2024-11-05',
          capabilities: { tools: {}, resources: {} },
          serverInfo: {
            name: 'graymatter',
            version: context.publicApp ? '1.0.0' : '0.1.0'
          },
          instructions: context.publicApp
            ? 'Search durable memory before asking users to repeat known context. Compile bounded task context. Never request or supply tenant, owner, organization, ACL, or user overrides.'
            : undefined
        });
      case 'tools/list':
        return jsonRpcResult(id, { tools: context.toolSet || tools });
      case 'resources/list':
        return jsonRpcResult(id, { resources: [appResourceDescriptor()] });
      case 'resources/read':
        return jsonRpcResult(id, readResource(message.params || {}, context));
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
  if (context.publicApp) {
    return callPublicTool(params, context);
  }
  const args = normalizeToolArguments(name, params.arguments);

  const execute = async (operation, requestFn) => {
    try {
      return toolResult(await requestFn());
    } catch (error) {
      const recovery = buildRecoveryResult(error, operation, context);
      if (recovery) {
        return recovery;
      }
      throw error;
    }
  };

  switch (name) {
    case 'memory_put':
    case 'memory_write':
      return execute('memory_write', () => apiRequest(context, 'POST', 'MemoryEntry/write', buildMemoryWritePayload(args)));
    case 'memory_get':
    case 'memory_read':
      requireString(args.id, 'id');
      return execute('memory_read', () => apiRequest(context, 'GET', `MemoryEntry/${encodeURIComponent(args.id)}`));
    case 'memory_query':
      requireString(args.query, 'query');
      return execute('memory_query', () => apiRequest(context, 'POST', 'MemoryEntry/query', buildMemoryQueryPayload(args)));
    case 'memory_put_batch':
      return execute('memory_put_batch', async () => {
        if (!Array.isArray(args.items)) {
          throw new Error('items must be an array');
        }
        const maxBatch = Math.max(1, Math.min(args.maxBatch || args.items.length, 100));
        const selected = args.items.slice(0, maxBatch);
        const results = [];
        for (const item of selected) {
          results.push(await apiRequest(context, 'POST', 'MemoryEntry/write', buildMemoryWritePayload(item)));
        }
        return { accepted: results.length, deferred: 0, results };
      });
    case 'memory_link':
      requireString(args.fromId, 'fromId');
      requireString(args.toId, 'toId');
      requireString(args.relation, 'relation');
      return toolResult({
        status: 'linked',
        relation: args.relation,
        fromId: args.fromId,
        toId: args.toId,
        note: 'GrayMatter Light preserves the portable memory_link contract; durable graph-link persistence is a Cloud graph capability.'
      });
    case 'memory_health':
      return execute('memory_health', () => apiRequest(context, 'GET', 'memory/status'));
    case 'memory_replay_deferred':
      return execute('memory_replay_deferred', () => replayDeferredMemory(context, args));
    case 'memory_retrieve_with_receipt':
      requireString(args.query, 'query');
      return execute('memory_retrieve_with_receipt', async () => decorateRetrievalReceiptResult(
        await apiRequest(context, 'POST', 'graymatter-retrieval-receipts', buildRetrievalReceiptPayload(args))
      ));
    case 'retrieval_receipt_get':
      requireString(args.receiptId, 'receiptId');
      return execute('retrieval_receipt_get', async () => decorateRetrievalReceiptResult(
        await apiRequest(context, 'GET', `graymatter-retrieval-receipts/${encodeURIComponent(args.receiptId)}`)
      ));
    case 'retrieval_receipt_query':
      return execute('retrieval_receipt_query', async () => decorateRetrievalReceiptResult(
        await apiRequest(context, 'GET', buildRetrievalReceiptQueryEndpoint(args))
      ));
    case 'graph_get': {
      const graphPath = args.path ? `swarm-ops/graph/${trimSlashes(args.path)}` : 'swarm-ops/graph';
      return execute('graph_get', () => apiRequest(context, 'GET', graphPath));
    }
    case 'graymatter_status':
      return execute('graymatter_status', () => apiRequest(context, 'GET', grayMatterStatusEndpoint(args.surface)));
    case 'graymatter_semantic_search':
      requireString(args.query, 'query');
      return execute('graymatter_semantic_search', () => apiRequest(context, 'POST', 'memory/semantic-index/search', pickDefined({
        query: args.query,
        limit: args.limit,
        filters: args.filters
      })));
    case 'graymatter_semantic_reindex':
      return execute('graymatter_semantic_reindex', () => {
        if (Array.isArray(args.sources) && args.sources.length > 0) {
          return apiRequest(context, 'POST', 'memory/semantic-index/reindex', pickDefined({
            sources: args.sources,
            organizationId: args.organizationId,
            tenantScope: args.tenantScope,
            estimateOnly: args.estimateOnly,
            maxEstimatedCredits: args.maxEstimatedCredits
          }));
        }
        return apiRequest(context, 'POST', 'memory/reindex', pickDefined({
          workflowId: args.workflowId,
          entryTypes: args.entryTypes,
          dryRun: args.dryRun
        }));
      });
    case 'graymatter_object_graph_shape':
      return execute('graymatter_object_graph_shape', () => apiRequest(context, 'GET', 'graymatter/object-graph/shape'));
    case 'graymatter_retrieval_tools':
      return execute('graymatter_retrieval_tools', () => apiRequest(context, 'GET', 'graymatter/retrieval-tools'));
    case 'graymatter_retrieval_context':
      requireString(args.query, 'query');
      return execute('graymatter_retrieval_context', () => apiRequest(context, 'POST', 'graymatter/retrieval-context', buildRetrievalReceiptPayload(args)));
    case 'graymatter_invariant_preflight':
      return execute('graymatter_invariant_preflight', () => buildInvariantPreflight(context, args));
    case 'graymatter_activation_bridge':
      return execute('graymatter_activation_bridge', () => {
        const action = args.action || 'read';
        if (action === 'event') {
          return apiRequest(context, 'POST', 'graymatter/activation/bridge/event', args.body || {});
        }
        if (action === 'retry') {
          return apiRequest(context, 'GET', 'graymatter/activation/bridge/retry');
        }
        return apiRequest(context, 'GET', 'graymatter/activation/bridge');
      });
    case 'graymatter_mcp_bundle':
      if (args.action === 'get') {
        requireString(args.bundleId, 'bundleId');
        return execute('graymatter_mcp_bundle', () => apiRequest(context, 'GET', `graymatter/mcp/bundles/${encodeURIComponent(args.bundleId)}`));
      }
      if (args.action === 'create') {
        return execute('graymatter_mcp_bundle', () => apiRequest(context, 'POST', 'graymatter/mcp/bundles', args.body || {}));
      }
      throw new Error('action must be create or get');
    case 'entity_list': {
      requireEntityType(args.entityType);
      const query = new URLSearchParams();
      if (args.limit !== undefined) query.set('limit', String(args.limit));
      if (args.offset !== undefined) query.set('offset', String(args.offset));
      const suffix = query.toString() ? `?${query}` : '';
      return execute('entity_list', () => apiRequest(context, 'GET', `${args.entityType}${suffix}`));
    }
    case 'entity_get':
      requireEntityType(args.entityType);
      requireString(args.id, 'id');
      return execute('entity_get', () => apiRequest(context, 'GET', `${args.entityType}/${encodeURIComponent(args.id)}`));
    case 'entity_create':
      requireEntityType(args.entityType);
      if (!args.body || typeof args.body !== 'object' || Array.isArray(args.body)) {
        throw new Error('body must be an object');
      }
      return execute('entity_create', () => apiRequest(context, 'POST', args.entityType, normalizeEntityCreatePayload(args.entityType, args.body)));
    case 'show_graymatter_overview':
      return overviewToolResult();
    case 'schema_summary':
      return execute('schema_summary', async () => summarizeOpenApi(await apiRequest(context, 'GET', 'api-docs')));
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function callPublicTool(params, context) {
  const name = params && params.name;
  const rawArguments = params && params.arguments;
  const args = rawArguments && typeof rawArguments === 'object' && !Array.isArray(rawArguments)
    ? { ...rawArguments }
    : {};

  try {
    const descriptor = publicTools.find((tool) => tool.name === name);
    if (!descriptor) {
      return publicToolError('TOOL_NOT_FOUND', 'This tool is not available on the public GrayMatter app surface.', false);
    }
    assertNoPrincipalOverrides(args);
    requirePublicScopes(context.principal, descriptor.securitySchemes[0].scopes || []);

    switch (name) {
      case 'memory_search': {
        const query = boundedRequiredString(args.query, 'query', 2000);
        const limit = clampInteger(args.limit, 10, 1, 25);
        const offset = clampInteger(args.offset, 0, 0, 10000);
        const response = await apiRequest(context, 'POST', 'MemoryEntry/query', pickDefined({
          query,
          limit: limit + offset,
          type: args.type,
          tags: boundedStringArray(args.tags, 20, 64),
          source: boundedOptionalString(args.source, 128)
        }));
        const visible = extractList(response).slice(offset, offset + limit);
        return publicToolSuccess(visible, `Found ${visible.length} authorized memories.`, visible.length === limit ? offset + limit : undefined);
      }
      case 'memory_get': {
        const id = requireUuid(args.id, 'id');
        const response = await apiRequest(context, 'GET', `MemoryEntry/${encodeURIComponent(id)}`);
        return publicToolSuccess(response, 'Authorized memory retrieved.');
      }
      case 'memory_save': {
        const payload = buildPublicMemoryPayload(args, true);
        const response = await apiRequest(context, 'POST', 'MemoryEntry/write', payload);
        return publicToolSuccess(response, 'Durable memory saved.');
      }
      case 'memory_update': {
        const id = requireUuid(args.id, 'id');
        const payload = buildPublicMemoryPayload(args, false);
        if (Object.keys(payload).length === 0) {
          throw publicArgumentError('At least one memory field must be supplied for update.');
        }
        const response = await apiRequest(context, 'PATCH', `MemoryEntry/${encodeURIComponent(id)}`, payload);
        return publicToolSuccess(response, 'Durable memory updated.');
      }
      case 'memory_forget': {
        const id = requireUuid(args.id, 'id');
        if (args.confirm !== true || !hasNonEmptyString(args.confirmationText)) {
          return publicToolError('CONFIRMATION_REQUIRED', 'Explicit confirmation is required before forgetting this memory.', false);
        }
        boundedRequiredString(args.confirmationText, 'confirmationText', 500);
        await apiRequest(context, 'DELETE', `MemoryEntry/${encodeURIComponent(id)}`);
        return publicToolSuccess({ id, forgotten: true }, 'The confirmed memory was forgotten using GrayMatter retention semantics.');
      }
      case 'context_compile': {
        const taskIntent = boundedRequiredString(args.task, 'task', 12000);
        const response = await apiRequest(context, 'POST', 'graymatter_ops/context_page/compile', {
          taskIntent,
          tokenBudget: clampInteger(args.tokenBudget, 4000, 256, 16000),
          includeProcedures: args.includeProcedures !== false,
          includeRatings: args.includeRatings !== false,
          filters: sanitizePublicFilters(args.filters)
        });
        return publicToolSuccess(response, 'Task-specific GrayMatter context compiled.');
      }
      case 'procedure_search': {
        const query = boundedRequiredString(args.query, 'query', 2000).toLowerCase();
        const limit = clampInteger(args.limit, 10, 1, 20);
        const offset = clampInteger(args.offset, 0, 0, 10000);
        const fetchSize = Math.min(100, Math.max(limit + offset, 20));
        const response = await apiRequest(context, 'GET', `Procedure?page=0&size=${fetchSize}`);
        const minimumConfidence = Math.max(0, Math.min(Number(args.minimumConfidence) || 0, 1));
        const visible = extractList(response)
          .filter((procedure) => args.enabledOnly === false || procedure.enabled !== false)
          .filter((procedure) => Number(procedure.confidence || 0) >= minimumConfidence)
          .filter((procedure) => publicSearchableText(procedure).includes(query))
          .slice(offset, offset + limit);
        return publicToolSuccess(visible, `Found ${visible.length} authorized procedures.`, visible.length === limit ? offset + limit : undefined);
      }
      case 'retrieval_receipt_get': {
        const receiptId = boundedRequiredString(args.receiptId, 'receiptId', 128);
        const response = decorateRetrievalReceiptResult(
          await apiRequest(context, 'GET', `graymatter-retrieval-receipts/${encodeURIComponent(receiptId)}`)
        );
        return publicToolSuccess(response, 'Authorized retrieval receipt retrieved.');
      }
      default:
        return publicToolError('TOOL_NOT_FOUND', 'This tool is not available on the public GrayMatter app surface.', false);
    }
  } catch (error) {
    return publicToolErrorFromException(error, context.publicResource);
  }
}

function buildPublicMemoryPayload(args, requireContent) {
  const payload = {};
  if (requireContent || args.content !== undefined) {
    payload.text = boundedRequiredString(args.content, 'content', 12000);
  }
  if (args.title !== undefined) payload.title = boundedOptionalString(args.title, 255);
  if (requireContent || args.type !== undefined) payload.type = args.type || 'context';
  if (args.tags !== undefined || args.importance !== undefined) {
    const tags = boundedStringArray(args.tags, 20, 64);
    if (args.importance && args.importance !== 'normal') tags.push(`importance:${args.importance}`);
    payload.tags = uniqueStrings(tags).slice(0, 20);
  }
  if (args.source !== undefined || args.scope !== undefined) {
    payload.sourceChannel = boundedOptionalString(args.scope || args.source, 128);
  }
  return pickDefined(payload);
}

function publicSearchableText(value) {
  if (!value || typeof value !== 'object') return '';
  return [value.name, value.description, value.taskType, value.procedureRef]
    .filter((part) => typeof part === 'string')
    .join(' ')
    .toLowerCase();
}

function sanitizePublicFilters(filters) {
  if (filters === undefined) return undefined;
  if (!isPlainObject(filters)) throw publicArgumentError('filters must be an object.');
  assertNoPrincipalOverrides(filters);
  const entries = Object.entries(filters).slice(0, 20);
  const sanitized = {};
  for (const [key, value] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key)) {
      throw publicArgumentError('filters contains an invalid key.');
    }
    if (!['string', 'number', 'boolean'].includes(typeof value)) {
      throw publicArgumentError('filters values must be strings, numbers, or booleans.');
    }
    sanitized[key] = typeof value === 'string' ? value.slice(0, 512) : value;
  }
  return sanitized;
}

function publicArgumentError(message) {
  const error = new Error(message);
  error.name = 'PublicArgumentError';
  error.statusCode = 400;
  return error;
}

function boundedRequiredString(value, fieldName, maxLength) {
  if (!hasNonEmptyString(value)) throw publicArgumentError(`${fieldName} is required.`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw publicArgumentError(`${fieldName} exceeds its maximum length.`);
  return normalized;
}

function boundedOptionalString(value, maxLength) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw publicArgumentError('Expected a string value.');
  const normalized = value.trim();
  if (normalized.length > maxLength) throw publicArgumentError('A string field exceeds its maximum length.');
  return normalized || undefined;
}

function boundedStringArray(value, maxItems, maxLength) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw publicArgumentError('Expected an array of strings.');
  if (value.length > maxItems) throw publicArgumentError('Too many array items were supplied.');
  return value.map((item) => boundedRequiredString(item, 'array item', maxLength));
}

function requireUuid(value, fieldName) {
  const normalized = boundedRequiredString(value, fieldName, 64);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw publicArgumentError(`${fieldName} must be a UUID.`);
  }
  return normalized;
}

function normalizeToolArguments(name, rawArguments) {
  if (typeof rawArguments === 'string') {
    return queryArgumentTool(name) ? { query: rawArguments } : { text: rawArguments, content: rawArguments };
  }
  if (!rawArguments || typeof rawArguments !== 'object' || Array.isArray(rawArguments)) {
    return {};
  }
  const args = { ...rawArguments };
  if (queryArgumentTool(name) && !hasNonEmptyString(args.query)) {
    const query = firstDefined(
      args.q,
      args.search,
      args.keyword,
      args.question,
      args.prompt,
      args.text,
      args.content);
    if (query !== undefined) {
      args.query = query;
    }
  }
  return args;
}

function queryArgumentTool(name) {
  return [
    'memory_query',
    'memory_retrieve_with_receipt',
    'graymatter_retrieval_context',
    'graymatter_invariant_preflight',
    'graymatter_semantic_search'
  ].includes(name);
}

function hasNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function defineTool(tool) {
  const securitySchemes = cloneSecuritySchemes();
  const descriptor = {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    securitySchemes,
    annotations: tool.annotations,
    _meta: {
      securitySchemes,
      'openai/toolInvocation/invoking': tool.invoking,
      'openai/toolInvocation/invoked': tool.invoked
    }
  };

  if (tool.outputSchema) {
    descriptor.outputSchema = tool.outputSchema;
  }

  if (tool.uiResourceUri) {
    descriptor._meta.ui = {
      resourceUri: tool.uiResourceUri,
      visibility: ['model', 'app']
    };
    descriptor._meta['openai/outputTemplate'] = tool.uiResourceUri;
    descriptor._meta['openai/widgetAccessible'] = true;
  }

  return descriptor;
}

function definePublicTool(tool) {
  const securitySchemes = [{ type: 'oauth2', scopes: [...tool.scopes] }];
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: PUBLIC_RESULT_SCHEMA,
    securitySchemes,
    annotations: tool.annotations,
    _meta: {
      securitySchemes,
      'openai/toolInvocation/invoking': tool.invoking,
      'openai/toolInvocation/invoked': tool.invoked
    }
  };
}

function cloneSecuritySchemes() {
  return APP_SECURITY_SCHEMES.map((scheme) => ({ ...scheme }));
}

function appResourceDescriptor() {
  return {
    uri: APP_UI_RESOURCE_URI,
    name: 'GrayMatter overview',
    title: 'GrayMatter overview',
    description: 'Overview card for GrayMatter durable memory, retrieval receipts, and schema tools.',
    mimeType: 'text/html;profile=mcp-app'
  };
}

function readResource(params, context) {
  if (params.uri !== APP_UI_RESOURCE_URI) {
    throw new Error(`Unknown resource: ${params.uri || ''}`);
  }

  return {
    contents: [
      {
        uri: APP_UI_RESOURCE_URI,
        mimeType: 'text/html;profile=mcp-app',
        text: overviewWidgetHtml(),
        _meta: resourceMeta(context.widgetDomain)
      }
    ]
  };
}

function resourceMeta(widgetDomain) {
  return {
    ui: {
      prefersBorder: true,
      domain: widgetDomain,
      csp: {
        connectDomains: APP_CONNECT_DOMAINS,
        resourceDomains: [widgetDomain]
      }
    },
    'openai/widgetDescription': 'GrayMatter overview for durable memory, retrieval receipts, graph, and schema tools.',
    'openai/widgetPrefersBorder': true,
    'openai/widgetDomain': widgetDomain,
    'openai/widgetCSP': {
      connect_domains: APP_CONNECT_DOMAINS,
      resource_domains: [widgetDomain]
    }
  };
}

function overviewToolResult() {
  const structuredContent = {
    app: 'GrayMatter',
    mcpEndpointPath: '/mcp',
    toolCount: tools.length,
    privacyPolicyUrl: 'https://github.com/ValkyrLabs/GrayMatter/blob/main/docs/privacy-policy.md'
  };

  return {
    structuredContent,
    content: [
      {
        type: 'text',
        text: 'GrayMatter exposes durable memory, retrieval receipts, shared graph, and ValkyrAI schema tools through an Apps SDK-ready MCP endpoint.'
      }
    ]
  };
}

function overviewWidgetHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>GrayMatter Overview</title>
    <style>
      :root {
        color-scheme: light dark;
        --gm-bg: #f4f0e6;
        --gm-card: #fffaf0;
        --gm-ink: #15372f;
        --gm-muted: #5a6d65;
        --gm-line: #d9ccb5;
        --gm-accent: #245b4a;
      }
      body {
        margin: 0;
        background: var(--gm-bg);
        color: var(--gm-ink);
        font: 15px/1.45 Georgia, "Times New Roman", serif;
      }
      .card {
        border: 1px solid var(--gm-line);
        border-radius: 18px;
        background: linear-gradient(135deg, var(--gm-card), #eef4ec);
        padding: 20px;
      }
      h1 {
        margin: 0 0 8px;
        font-size: 24px;
      }
      p {
        margin: 0 0 14px;
        color: var(--gm-muted);
      }
      ul {
        display: grid;
        gap: 8px;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      li {
        border-left: 4px solid var(--gm-accent);
        background: rgba(255, 255, 255, 0.5);
        padding: 8px 10px;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --gm-bg: #10251f;
          --gm-card: #18362d;
          --gm-ink: #f6ead5;
          --gm-muted: #c0d0c8;
          --gm-line: #315f50;
          --gm-accent: #92ccb4;
        }
        li {
          background: rgba(0, 0, 0, 0.18);
        }
      }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>GrayMatter</h1>
      <p>Durable memory, retrieval receipts, graph context, and live ValkyrAI schema access for agent workflows.</p>
      <ul>
        <li>Store decisions, todos, preferences, context, and artifacts as MemoryEntry records.</li>
        <li>Retrieve memory with receipts so agents inspect confidence and answer policy before responding.</li>
        <li>Search prior memory semantically before acting in a new chat or automation.</li>
        <li>Inspect RBAC-scoped business entities and schema metadata through api-0.</li>
      </ul>
    </main>
  </body>
</html>`;
}

async function apiRequest(context, method, endpoint, body) {
  if (!context.requestScopedToken && !context.token) {
    hydrateLocalAuth(context);
  }
  try {
    return await apiRequestOnce(context, method, endpoint, body);
  } catch (error) {
    if (!isRefreshableAuthError(error)) {
      throw error;
    }

    let authError = error;
    if (await refreshAuth(context)) {
      try {
        return await apiRequestOnce(context, method, endpoint, body);
      } catch (retryError) {
        authError = retryError;
        if (!isRefreshableAuthError(retryError)) {
          throw retryError;
        }
      }
    }

    if (shouldUseShellApiFallback(context, method, authError)) {
      return context.apiShellProvider(context, method, endpoint, body);
    }

    throw authError;
  }
}

async function apiRequestOnce(context, method, endpoint, body) {
  const headers = {
    accept: 'application/json'
  };

  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  if (context.token) {
    headers.authorization = `Bearer ${context.token}`;
    if (!context.publicApp) {
      headers.VALKYR_AUTH = context.token;
      headers.cookie = `VALKYR_AUTH=${context.token}`;
    }
  } else if (context.lightPassword) {
    headers.authorization = `Basic ${Buffer.from(`${context.lightUsername || 'admin'}:${context.lightPassword}`).toString('base64')}`;
  }
  const tenantId = context.publicApp ? '' : (context.tenantId || tenantIdFromToken(context.token));
  if (!context.publicApp && tenantId) {
    headers['X-Tenant-Id'] = tenantId;
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
    const error = new Error(message);
    error.name = 'ApiRequestError';
    error.status = response.status;
    error.payload = payload;
    error.method = method;
    error.endpoint = endpoint;
    throw error;
  }

  return payload;
}

function hydrateLocalAuth(context) {
  if (!context || context.requestScopedToken || context.token || typeof context.keychainReader !== 'function') {
    return false;
  }

  try {
    const token = context.keychainReader(context);
    if (!token || typeof token !== 'string') {
      return false;
    }
    context.token = token.trim();
    return Boolean(context.token);
  } catch {
    return false;
  }
}

async function refreshAuth(context) {
  if (!context || context.requestScopedToken || typeof context.loginProvider !== 'function') {
    return false;
  }

  try {
    const token = await context.loginProvider(context);
    if (!token || typeof token !== 'string') {
      return false;
    }
    context.token = token;
    return true;
  } catch {
    return false;
  }
}

function isRefreshableAuthError(error) {
  if (!error || error.name !== 'ApiRequestError') {
    return false;
  }

  const payload = error.payload;
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
  if (error.status === 401) {
    return /SESSION_EXPIRED|TOKEN_EXPIRED|expired|missing auth|unauthorized/i.test(text);
  }
  if (error.status === 403) {
    if (/read-only|readonly/i.test(text)) {
      return false;
    }
    return /cannot perform this action|required write|write scope|write-capable|permission|forbidden|access denied/i.test(text);
  }
  return false;
}

function readTokenFromKeychain() {
  if (process.platform !== 'darwin') {
    return '';
  }

  const service = process.env.VALKYR_KEYCHAIN_SERVICE || 'VALKYR_AUTH';
  const accounts = [
    process.env.GRAYMATTER_USERNAME || process.env.VALKYR_USERNAME || '',
    'default'
  ].filter(Boolean);
  const services = [...new Set([service, 'VALKYR_AUTH', 'openclaw-valkyrai-admin-jwtSession'])];

  for (const account of accounts) {
    for (const candidateService of services) {
      try {
        const token = execFileSync('security', [
          'find-generic-password',
          '-a',
          account,
          '-s',
          candidateService,
          '-w'
        ], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 1000
        }).trim();
        if (token) {
          return token;
        }
      } catch {
        // Try the next account/service pair.
      }
    }
  }

  return '';
}

function runLoginCommand(context) {
  const loginCommand = context.loginCommand || process.env.GRAYMATTER_LOGIN_COMMAND || path.join(__dirname, '..', 'scripts', 'gm-login');
  const output = execFileSync(loginCommand, ['env'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      VALKYR_API_BASE: context.apiBase
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: Number(process.env.GRAYMATTER_LOGIN_TIMEOUT_MS || 30000)
  });
  return parseExportedToken(output);
}

function runShellApiCommand(context, method, endpoint, body) {
  const apiCommand = context.apiCommand || process.env.GRAYMATTER_API_COMMAND || path.join(__dirname, '..', 'scripts', 'graymatter_api.sh');
  const args = [
    method,
    endpoint
  ];
  if (body !== undefined) {
    args.push(JSON.stringify(body));
  }
  const output = execFileSync(apiCommand, args, {
    encoding: 'utf8',
    env: {
      ...process.env,
      VALKYR_API_BASE: context.apiBase,
      VALKYR_AUTH_TOKEN: context.token || process.env.VALKYR_AUTH_TOKEN || '',
      GRAYMATTER_SKIP_SELF_UPDATE: 'true'
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: Number(process.env.GRAYMATTER_API_COMMAND_TIMEOUT_MS || 90000)
  });
  return output ? parseJson(output) : null;
}

function shouldUseShellApiFallback(context, method, error) {
  if (!isStatefulShellFallbackError(error)) {
    return false;
  }
  return Boolean(context)
    && !context.requestScopedToken
    && typeof context.apiShellProvider === 'function'
    && methodRequiresStatefulFallback(method);
}

function isStatefulShellFallbackError(error) {
  if (!error || error.name !== 'ApiRequestError' || error.status !== 403) {
    return false;
  }
  const payload = error.payload;
  const text = (typeof payload === 'string' ? payload : JSON.stringify(payload || {})).toLowerCase();
  if (text.includes('read-only') || text.includes('readonly')) {
    return false;
  }
  return text.includes('cannot perform this action')
    || text.includes('required write')
    || text.includes('write scope')
    || text.includes('write-capable')
    || text.includes('role permission');
}

function methodRequiresStatefulFallback(method) {
  return /^(POST|PUT|PATCH|DELETE)$/i.test(String(method || ''));
}

function parseExportedToken(output) {
  const text = String(output || '');
  const patterns = [
    /^export\s+VALKYR_AUTH_TOKEN="([^"]+)"$/m,
    /^export\s+VALKYR_JWT_SESSION="([^"]+)"$/m,
    /^VALKYR_AUTH_TOKEN=([^\n]+)$/m,
    /^VALKYR_JWT_SESSION=([^\n]+)$/m
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return '';
}

function buildRecoveryResult(error, operation, context) {
  if (!error || error.name !== 'ApiRequestError') {
    return null;
  }

  const signal = classifyRecoveryReason(error);
  if (!signal) {
    return null;
  }

  const details = recoveryDetails(error.payload);
  const attribution = recoveryAttribution(error, operation, context, details);
  const buyCreditsUrl = attributedRecoveryUrl(process.env.VALKYR_BUY_CREDITS_URL || DEFAULT_BUY_CREDITS_URL, {
    ...attribution,
    intent: 'recharge'
  });
  const signupUrl = attributedRecoveryUrl(process.env.VALKYR_HUMAN_SIGNUP_URL || DEFAULT_SIGNUP_URL, {
    ...attribution,
    intent: signal.reason === 'starter_credits_missing' ? 'repair-starter-credits' : 'signup'
  });
  const loginUrl = apiUrl(context.apiBase, process.env.GRAYMATTER_LOGIN_PATH || DEFAULT_LOGIN_PATH);
  const retryable = signal.reason === 'insufficient_credits' || signal.reason === 'starter_credits_missing' || signal.reason === 'missing_auth';

  const recoveryActions = recoveryActionsFor(signal.reason, { buyCreditsUrl, signupUrl, loginUrl });
  const structuredContent = {
    ok: false,
    reason: signal.reason,
    blockedOperation: operation,
    message: signal.message,
    recoveryActions,
    buyCreditsUrl,
    signupUrl,
    loginUrl,
    currentBalance: details.currentBalance,
    requiredCredits: details.requiredCredits,
    traceId: details.traceId,
    workspaceId: details.workspaceId,
    accountId: details.accountId,
    retryGuidance: retryable ? 'Complete the recovery action, then call this tool again with the same arguments.' : 'Switch credentials or workspace access before retrying.',
    retryable
  };

  return {
    structuredContent,
    content: [
      {
        type: 'text',
        text: renderRecoveryText(structuredContent)
      }
    ],
    _meta: {
      openai: {
        recovery: {
          reason: signal.reason,
          blockedOperation: operation,
          retryable,
          actions: recoveryActions,
          urls: { buyCreditsUrl, signupUrl, loginUrl }
        },
        debug: {
          status: error.status,
          endpoint: error.endpoint,
          method: error.method,
          rawMessage: error.message
        }
      }
    }
  };
}

function activationContextUrl(baseUrl, intent, operation, context = {}) {
  const url = new URL(baseUrl);
  const params = {
    source: process.env.GRAYMATTER_ACTIVATION_SOURCE || 'graymatter',
    intent,
    operation: operation || 'memory_query',
    return_to: process.env.GRAYMATTER_ACTIVATION_RETURN_TO || 'graymatter://activation/return',
    api_base: context.apiBase || DEFAULT_API_BASE
  };

  const installId = process.env.GRAYMATTER_INSTALL_ID || process.env.OPENCLAW_INSTANCE_ID || '';
  if (installId) {
    params.install_id = installId;
  }

  for (const [key, value] of Object.entries(params)) {
    if (!url.searchParams.has(key) && value) {
      url.searchParams.set(key, value);
    }
  }

  return url.toString();
}

function recoveryActionsFor(reason, urls) {
  switch (reason) {
    case 'starter_credits_missing':
      return [
        { id: 'repair_starter_credits', label: 'Repair starter credits', url: urls.signupUrl, primary: true },
        { id: 'buy_credits', label: 'Buy GrayMatter credits', url: urls.buyCreditsUrl, primary: false },
        { id: 'sign_in', label: 'Sign in with a funded workspace', url: urls.loginUrl, primary: false }
      ];
    case 'insufficient_credits':
      return [
        { id: 'buy_credits', label: 'Buy GrayMatter credits', url: urls.buyCreditsUrl, primary: true },
        { id: 'create_account', label: 'Create or upgrade an account', url: urls.signupUrl, primary: false },
        { id: 'sign_in', label: 'Sign in with a funded workspace', url: urls.loginUrl, primary: false }
      ];
    case 'missing_auth':
      return [
        { id: 'sign_in', label: 'Sign in to GrayMatter', url: urls.loginUrl, primary: true },
        { id: 'create_account', label: 'Create an account', url: urls.signupUrl, primary: false }
      ];
    case 'read_only_auth':
      return [
        { id: 'sign_in', label: 'Switch to a write-capable account', url: urls.loginUrl, primary: true },
        { id: 'buy_credits', label: 'Buy credits for the target workspace', url: urls.buyCreditsUrl, primary: false }
      ];
    default:
      return [{ id: 'sign_in', label: 'Sign in to GrayMatter', url: urls.loginUrl, primary: true }];
  }
}

function renderRecoveryText(structuredContent) {
  const actions = (structuredContent.recoveryActions || [])
    .map((action) => `${action.label}: ${action.url}`)
    .join('\n');
  const facts = [
    structuredContent.currentBalance ? `Current balance: ${structuredContent.currentBalance}` : '',
    structuredContent.requiredCredits ? `Required credits: ${structuredContent.requiredCredits}` : '',
    structuredContent.workspaceId ? `Workspace: ${structuredContent.workspaceId}` : '',
    structuredContent.traceId ? `Trace: ${structuredContent.traceId}` : ''
  ].filter(Boolean).join('\n');
  const factBlock = facts ? `\n\n${facts}` : '';
  return `${structuredContent.message}${factBlock}\n\nRecovery actions:\n${actions}\n\n${structuredContent.retryGuidance}`;
}

function classifyRecoveryReason(error) {
  const payload = error.payload;
  const bodyText = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
  const upperText = bodyText.toUpperCase();
  const lowerText = bodyText.toLowerCase();

  if (upperText.includes('STARTER_CREDITS_MISSING') || lowerText.includes('starter') && lowerText.includes('credit') && lowerText.includes('missing')) {
    return {
      reason: 'starter_credits_missing',
      message: 'This account is missing its expected GrayMatter starter credits. Repair the starter grant or choose a funded workspace, then retry.'
    };
  }

  if (error.status === 402 || upperText.includes('INSUFFICIENT_FUNDS') || lowerText.includes('insufficient') && lowerText.includes('credit')) {
    return {
      reason: 'insufficient_credits',
      message: 'GrayMatter needs credits before this operation can continue. Buy credits or sign up, then retry.'
    };
  }

  if (error.status === 401) {
    return {
      reason: 'missing_auth',
      message: 'Authentication is missing or expired. Sign in, then retry.'
    };
  }

  if (error.status === 403) {
    if (lowerText.includes('read-only') || lowerText.includes('readonly') || lowerText.includes('write') && lowerText.includes('forbidden')) {
      return {
        reason: 'read_only_auth',
        message: 'This credential is read-only for the requested operation. Use a write-capable token.'
      };
    }
    return {
      reason: 'missing_auth',
      message: 'Access was denied. Sign in with the correct account or workspace access, then retry.'
    };
  }

  return null;
}

function recoveryDetails(payload) {
  const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const details = source.details && typeof source.details === 'object' ? source.details : {};
  return {
    currentBalance: firstDefined(source.currentBalance, source.balance, details.currentBalance, details.balance),
    requiredCredits: firstDefined(source.requiredCredits, source.required_credits, source.required, details.requiredCredits, details.required),
    traceId: firstDefined(source.traceId, source.trace_id, details.traceId, details.trace_id),
    workspaceId: firstDefined(source.workspaceId, source.workspace_id, source.organizationId, source.orgId, details.workspaceId, details.organizationId),
    accountId: firstDefined(source.accountId, source.account_id, source.principalId, details.accountId, details.principalId)
  };
}

function recoveryAttribution(error, operation, context, details) {
  return {
    source: process.env.GRAYMATTER_ACTIVATION_SOURCE || 'graymatter',
    operation,
    request_path: error.endpoint,
    api_base: context.apiBase,
    install_id: process.env.GRAYMATTER_INSTALL_ID || process.env.OPENCLAW_INSTANCE_ID || '',
    return_to: process.env.GRAYMATTER_ACTIVATION_RETURN_TO || 'graymatter://activation/return',
    required_credits: details.requiredCredits,
    current_balance: details.currentBalance,
    trace_id: details.traceId,
    workspace_id: details.workspaceId,
    account_id: details.accountId
  };
}

function attributedRecoveryUrl(baseUrl, params) {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value) !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value) !== '') {
      return String(value);
    }
  }
  return undefined;
}

function buildMemoryWritePayload(args) {
  requireString(args.type, 'type');
  const text = args.text || args.content;
  requireString(text, args.content ? 'content' : 'text');

  const metadata = memoryScopeMetadata(args);
  if (args.metadata && typeof args.metadata === 'object' && !Array.isArray(args.metadata)) {
    Object.assign(metadata, stripClientManagedFields(args.metadata));
  }
  const sourceChannel = args.sourceChannel || metadata.sourceChannel;
  if (sourceChannel) {
    metadata.sourceChannel = sourceChannel;
  }

  const payload = {
    type: args.type,
    text,
    content: text
  };

  if (sourceChannel || args.source) {
    payload.sourceChannel = sourceChannel || args.source;
    payload.source = sourceChannel || args.source;
  }

  if (Object.keys(metadata).length > 0) {
    payload.metadata = JSON.stringify(metadata);
  }

  if (args.tags !== undefined) {
    payload.tags = normalizeMemoryTagInput(args.tags);
  }

  return stripClientManagedFields(payload);
}

function buildMemoryQueryPayload(args) {
  const metadata = memoryScopeMetadata(args);
  const source = args.sourceChannel || metadata.sourceChannel;
  const payload = {
    query: args.query
  };

  if (args.limit !== undefined) {
    payload.limit = args.limit;
  }
  if (args.type !== undefined) {
    payload.type = args.type;
  }
  if (source) {
    payload.source = source;
  }

  return payload;
}

function buildRetrievalReceiptPayload(args) {
  const payload = pickDefined({
    query: args.query,
    agentId: args.agentId,
    workflowId: args.workflowId,
    tenantId: args.tenantId,
    topK: args.topK,
    retrievalMode: args.retrievalMode,
    includeItems: args.includeItems,
    includeText: args.includeText,
    includeEvaluator: args.includeEvaluator,
    qualityProfile: args.qualityProfile
  });

  if (args.filters !== undefined) {
    if (!args.filters || typeof args.filters !== 'object' || Array.isArray(args.filters)) {
      throw new Error('filters must be an object');
    }
    payload.filters = args.filters;
  }

  return payload;
}

function buildRetrievalReceiptQueryEndpoint(args) {
  const query = new URLSearchParams();
  for (const key of ['traceId', 'agentId', 'workflowId', 'retrievalStatus', 'from', 'to', 'limit']) {
    if (args[key] !== undefined && args[key] !== null && String(args[key]).length > 0) {
      query.set(key, String(args[key]));
    }
  }
  const suffix = query.toString() ? `?${query}` : '';
  return `graymatter-retrieval-receipts${suffix}`;
}

function decorateRetrievalReceiptResult(value) {
  if (Array.isArray(value)) {
    return value.map((item) => decorateRetrievalReceiptContainer(item));
  }
  return decorateRetrievalReceiptContainer(value);
}

function decorateRetrievalReceiptContainer(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  const receipt = value.receipt && typeof value.receipt === 'object' && !Array.isArray(value.receipt)
    ? value.receipt
    : value;
  const graymatterPolicy = retrievalReceiptPolicy(receipt);
  if (!graymatterPolicy) {
    return value;
  }
  if (receipt === value) {
    return { ...value, graymatterPolicy };
  }
  return {
    ...value,
    receipt: { ...receipt, graymatterPolicy },
    graymatterPolicy
  };
}

function retrievalReceiptPolicy(receipt) {
  const answerPolicy = firstDefined(receipt.answerPolicy, receipt.answer_policy);
  const retrievalStatus = firstDefined(receipt.retrievalStatus, receipt.retrieval_status);
  const recommendedAction = firstDefined(receipt.recommendedAction, receipt.recommended_action);
  const receiptId = firstDefined(receipt.receiptId, receipt.receipt_id, receipt.id);
  const traceId = firstDefined(receipt.traceId, receipt.trace_id);
  if (!answerPolicy && !retrievalStatus && !recommendedAction) {
    return null;
  }

  const blockedPolicy = new Set([
    'DO_NOT_ANSWER_CONFIDENTLY',
    'REQUIRE_RETRY',
    'REQUIRE_CLARIFICATION',
    'DENY'
  ]);
  const blockedStatus = new Set([
    'NO_RESULTS',
    'LOW_CONFIDENCE',
    'STALE_CONTEXT',
    'CONFLICTING_CONTEXT',
    'ACCESS_DENIED',
    'POLICY_REDACTED',
    'EVALUATOR_REJECTED',
    'RETRY_REQUIRED',
    'ERROR'
  ]);
  const caveatStatus = new Set(['PARTIAL_COVERAGE']);
  const requiredActions = [];

  if (!answerPolicy) {
    requiredActions.push('inspect_missing_answer_policy');
  }
  if (!retrievalStatus) {
    requiredActions.push('inspect_missing_retrieval_status');
  }
  if (blockedPolicy.has(answerPolicy)) {
    requiredActions.push(answerPolicy.toLowerCase());
  }
  if (blockedStatus.has(retrievalStatus)) {
    requiredActions.push(`handle_${retrievalStatus.toLowerCase()}`);
  }
  if (answerPolicy === 'ALLOW_WITH_CAVEAT' || caveatStatus.has(retrievalStatus)) {
    requiredActions.push('answer_with_caveat_and_provenance');
  }
  if (recommendedAction && recommendedAction !== 'ANSWER') {
    requiredActions.push(`recommended_${recommendedAction.toLowerCase()}`);
  }

  const answerAllowed = answerPolicy === 'ALLOW_ANSWER' && (!retrievalStatus || retrievalStatus === 'OK');
  const caveatRequired = answerPolicy === 'ALLOW_WITH_CAVEAT' || caveatStatus.has(retrievalStatus);
  const blocked = !answerAllowed && !caveatRequired;
  const disposition = answerAllowed
    ? 'answer_from_memory_allowed'
    : caveatRequired
      ? 'answer_with_caveat'
      : 'do_not_answer_from_memory';

  if (blocked && requiredActions.length === 0) {
    requiredActions.push('retry_or_clarify_before_answering');
  }

  return {
    receiptId,
    traceId,
    retrievalStatus,
    answerPolicy,
    recommendedAction,
    answerAllowed,
    caveatRequired,
    disposition,
    requiredActions: Array.from(new Set(requiredActions)),
    warning: answerAllowed
      ? undefined
      : 'GrayMatter retrieval receipt policy does not authorize a confident memory-grounded answer.'
  };
}

function grayMatterStatusEndpoint(surface = 'memory_status') {
  switch (surface || 'memory_status') {
    case 'memory_status':
      return 'memory/status';
    case 'memory_capabilities':
      return 'memory/capabilities';
    case 'memory_usage':
      return 'memory/usage';
    case 'semantic_health':
      return 'memory/semantic-health';
    case 'semantic_index':
      return 'graymatter/semantic-index/manifest';
    case 'control':
      return 'graymatter/control';
    case 'admin_control':
      return 'graymatter/admin/control';
    default:
      throw new Error(`Unknown GrayMatter status surface: ${surface}`);
  }
}

async function buildInvariantPreflight(context, args) {
  const workspaceKey = firstNonEmptyString(args.workspaceKey, args.workspace, args.product, args.sourceChannel);
  if (!workspaceKey) {
    throw new Error('workspaceKey or sourceChannel is required');
  }

  const sourceChannel = args.sourceChannel || (workspaceKey.includes(':') ? workspaceKey : `codex:workspace:${workspaceKey}`);
  const workspace = workspaceKey.includes(':') ? workspaceKey.split(':').pop() : workspaceKey;
  const terms = normalizeInvariantTerms(args);
  const limit = clampInteger(args.limit, 20, 1, 50);

  const statusResult = await settle(() => apiRequest(context, 'GET', 'memory/status'));
  const entries = await apiRequest(context, 'GET', 'MemoryEntry');
  const matches = filterInvariantEntries(entries, {
    sourceChannel,
    workspace,
    terms,
    limit
  });

  return {
    sourceChannel,
    workspace,
    terms,
    status: statusResult.ok
      ? { state: 'ready', response: statusResult.value }
      : { state: 'degraded', error: statusResult.error.message },
    count: matches.length,
    entries: matches,
    failClosed: true,
    memoryContract: PRIMARY_MEMORY_CONTRACT,
    instruction: 'Treat returned invariant decisions as binding. Missing or degraded retrieval is not permission to ignore known durable rules.'
  };
}

function replayDeferredMemory(context, args = {}) {
  const replayCommand = context.replayCommand || path.join(__dirname, '..', 'scripts', 'gm-replay-deferred');
  const commandArgs = [];
  if (args.limit !== undefined && args.limit !== null) {
    commandArgs.push('--limit', String(clampInteger(args.limit, 1000, 1, 1000)));
  }
  const output = execFileSync(replayCommand, commandArgs, {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      GRAYMATTER_API_SCRIPT: context.apiCommand || process.env.GRAYMATTER_API_COMMAND || path.join(__dirname, '..', 'scripts', 'graymatter_api.sh')
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const lines = output.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const replayed = lines.filter((line) => line.startsWith('Replayed deferred operation ')).length;
  const noDeferred = lines.some((line) => line === 'No deferred operations found.');
  return {
    attempted: noDeferred ? 0 : replayed,
    replayed,
    remaining: 0,
    deletedAfterSync: true,
    localFallbackPolicy: PRIMARY_MEMORY_CONTRACT.localFallbackPolicy,
    output: lines
  };
}

function normalizeInvariantTerms(args) {
  const values = [];
  if (typeof args.query === 'string') {
    values.push(...args.query.split(/\s+/u));
  }
  if (typeof args.keywords === 'string') {
    values.push(...args.keywords.split(/\s+/u));
  } else if (Array.isArray(args.keywords)) {
    values.push(...args.keywords);
  }
  return uniqueStrings([
    ...values,
    'invariant',
    'decision',
    'methodology',
    'security',
    'rbac',
    'acl',
    'thorapi',
    'aspectj',
    'generated-code',
    'testing'
  ]);
}

function filterInvariantEntries(response, options) {
  const entries = extractList(response);
  const workspaceLower = String(options.workspace || '').toLowerCase();
  const sourceChannel = String(options.sourceChannel || '');
  const terms = options.terms.map((term) => term.toLowerCase());

  return entries
    .filter((entry) => sourceMatchesInvariantScope(entry, sourceChannel, workspaceLower))
    .filter(isBindingInvariantEntry)
    .map((entry) => ({
      ...entry,
      preflightScore: scoreInvariantEntry(entry, terms)
    }))
    .sort((a, b) => {
      const scoreDelta = (b.preflightScore || 0) - (a.preflightScore || 0);
      if (scoreDelta !== 0) return scoreDelta;
      return String(a.sourceChannel || '').localeCompare(String(b.sourceChannel || ''))
        || String(a.createdDate || '').localeCompare(String(b.createdDate || ''));
    })
    .slice(0, options.limit);
}

function extractList(response) {
  if (Array.isArray(response)) return response.filter(isPlainObject);
  if (!isPlainObject(response)) return [];
  for (const key of ['content', 'items', 'data', 'results', 'records', 'memoryEntries', 'entries']) {
    if (Array.isArray(response[key])) {
      return response[key].filter(isPlainObject);
    }
  }
  return [];
}

function sourceMatchesInvariantScope(entry, sourceChannel, workspaceLower) {
  const tags = tagNames(entry);
  const searchable = invariantSearchableText(entry);
  return entry.sourceChannel === sourceChannel
    || entry.sourceChannel === 'codex:workspace:GrayMatter'
    || tags.includes(workspaceLower)
    || searchable.includes(workspaceLower);
}

function isBindingInvariantEntry(entry) {
  if (entry.type !== 'decision') {
    return false;
  }
  const tags = tagNames(entry);
  const searchable = invariantSearchableText(entry);
  return [
    'invariant',
    'agent-policy',
    'mandatory-preflight',
    'fail-closed',
    'security',
    'rbac',
    'acl',
    'generated-code',
    'aspectj',
    'vaix',
    'vai',
    'testing',
    'thorapi',
    'valkyrai',
    'valoride',
    'graymatter'
  ].some((tag) => tags.includes(tag))
    || searchable.includes('invariant')
    || /^Rule:/u.test(String(entry.text || entry.content || ''));
}

function scoreInvariantEntry(entry, terms) {
  const searchable = invariantSearchableText(entry);
  return terms.reduce((score, term) => score + (term && searchable.includes(term) ? 1 : 0), 0);
}

function invariantSearchableText(entry) {
  return [
    entry.text,
    entry.content,
    entry.title,
    entry.summary,
    entry.description,
    entry.sourceChannel,
    typeof entry.metadata === 'string' ? entry.metadata : undefined,
    tagNames(entry).join(' ')
  ]
    .filter((value) => value !== undefined && value !== null)
    .map((value) => String(value))
    .join(' ')
    .toLowerCase();
}

function tagNames(entry) {
  return (Array.isArray(entry.tags) ? entry.tags : [])
    .map((tag) => {
      if (typeof tag === 'string') return tag;
      if (tag && typeof tag === 'object') return tag.name || tag.id || '';
      return '';
    })
    .filter(Boolean)
    .map((tag) => String(tag).toLowerCase());
}

async function settle(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error };
  }
}

function memoryScopeMetadata(args) {
  if (!hasScopeSignal(args)) {
    return {};
  }

  const runtime = args.runtime || 'codex';
  const metadata = pickDefined({
    scope: args.scope,
    runtime,
    user: args.user,
    workspaceKey: args.workspaceKey,
    chatKey: args.chatKey,
    sessionKey: args.sessionKey,
    automationId: args.automationId,
    artifactPath: args.artifactPath || args.scopePath
  });

  if (!metadata.scope && args.scopePath) {
    metadata.scope = scopeFromPath(args.scopePath);
  }
  if (!metadata.automationId && args.scopePath) {
    metadata.automationId = automationIdFromPath(args.scopePath);
  }
  if (!metadata.workspaceKey && args.scopePath) {
    metadata.workspaceKey = workspaceKeyFromPath(args.scopePath);
  }

  const sourceChannel = deriveSourceChannel({ ...args, ...metadata, runtime });
  if (sourceChannel) {
    metadata.sourceChannel = sourceChannel;
  }

  return pickDefined(metadata);
}

function hasScopeSignal(args) {
  return Boolean(
    args.scope ||
    args.runtime ||
    args.user ||
    args.workspaceKey ||
    args.chatKey ||
    args.sessionKey ||
    args.automationId ||
    args.artifactPath ||
    args.scopePath ||
    args.sourceChannel
  );
}

function deriveSourceChannel(values) {
  const runtime = values.runtime || 'codex';
  if (values.sourceChannel) return values.sourceChannel;
  if (values.chatKey) return scopedKey(runtime, 'chat', values.chatKey);
  if (values.sessionKey) return scopedKey(runtime, 'session', values.sessionKey);
  if (values.automationId) return scopedKey(runtime, 'automation', values.automationId);
  if (values.workspaceKey) return scopedKey(runtime, 'workspace', values.workspaceKey);
  return '';
}

function scopedKey(runtime, kind, value) {
  const raw = String(value || '');
  return raw.includes(':') ? raw : `${runtime}:${kind}:${raw}`;
}

function scopeFromPath(pathValue) {
  if (automationIdFromPath(pathValue)) return 'automation';
  if (workspaceKeyFromPath(pathValue)) return 'workspace';
  return '';
}

function automationIdFromPath(pathValue) {
  const match = String(pathValue || '').match(/\.codex\/automations\/([^/]+)/);
  return match ? match[1] : '';
}

function workspaceKeyFromPath(pathValue) {
  const match = String(pathValue || '').match(/\/Documents\/Codex\/([^/]+)\/([^/]+)/);
  return match ? `${match[1]}/${match[2]}` : '';
}

function pickDefined(values) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined && value !== null && String(value).length > 0)
  );
}

function normalizeEntityCreatePayload(entityType, body) {
  const sanitized = stripClientManagedFields(body || {});
  if (String(entityType || '').toLowerCase() === 'contentdata') {
    return normalizeContentDataPayload(sanitized);
  }
  return sanitized;
}

function normalizeContentDataPayload(body) {
  const payload = { ...body };
  const metadata = parseMetadataObject(payload.metadata);
  const extractedTags = [];

  normalizeInlineContentData(payload, metadata, extractedTags);

  if (!payload.contentType) {
    payload.contentType = inferContentType(payload);
  }
  if (!payload.category) {
    payload.category = 'other';
  }
  if (!payload.status) {
    payload.status = 'DRAFT';
  }

  payload.tags = normalizeTagInput([...(Array.isArray(payload.tags) ? payload.tags : []), ...extractedTags, payload.category]);
  payload.metadata = Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : payload.metadata;
  return stripClientManagedFields(payload);
}

function normalizeInlineContentData(payload, metadata, extractedTags) {
  if (typeof payload.contentData !== 'string' || payload.contentData.trim().length === 0) {
    return;
  }

  const body = payload.contentData.trimStart();
  if (body.startsWith('---')) {
    const match = body.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
    if (match) {
      const extracted = parseMetadataLines(match[1].split(/\r?\n/));
      applyContentDataMetadata(payload, metadata, extractedTags, extracted);
      payload.contentData = body.slice(match[0].length).trimStart();
    }
    return;
  }

  const lines = body.split(/\r?\n/);
  let consumed = 0;
  const firstLine = lines[0] || '';
  const classifier = firstLine.trim().split(/\s+/, 1)[0];
  if (/^(conversation_summary|user_preference|user_profile)$/i.test(classifier)) {
    metadata.classification ||= classifier;
    payload.category = 'memory';
    extractedTags.push({ name: classifier, type: 'category' });
    const remainder = firstLine.trim().slice(classifier.length).trim();
    applyContentDataMetadata(payload, metadata, extractedTags, extractInlinePairs(remainder));
    consumed = 1;
  }

  while (consumed < lines.length) {
    const extracted = extractInlinePairs(lines[consumed]);
    if (Object.keys(extracted).length === 0) {
      break;
    }
    applyContentDataMetadata(payload, metadata, extractedTags, extracted);
    consumed += 1;
  }

  if (consumed > 0) {
    payload.contentData = lines.slice(consumed).join('\n').trimStart();
  }
}

function parseMetadataLines(lines) {
  const metadata = {};
  for (const line of lines) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const key = normalizeMetadataKey(line.slice(0, separator));
    const value = line.slice(separator + 1).trim();
    if (key && value) {
      metadata[key] = value;
    }
  }
  return metadata;
}

function extractInlinePairs(line) {
  const text = String(line || '');
  const keyPattern = /([A-Za-z][A-Za-z0-9_-]*)\s*:\s*/g;
  const matches = [];
  let match;
  while ((match = keyPattern.exec(text)) !== null) {
    const key = normalizeMetadataKey(match[1]);
    if (isContentDataMetadataKey(key)) {
      matches.push({ key, start: match.index, valueStart: keyPattern.lastIndex });
    }
  }

  const extracted = {};
  for (let i = 0; i < matches.length; i += 1) {
    const current = matches[i];
    const end = i + 1 < matches.length ? matches[i + 1].start : text.length;
    const value = text.slice(current.valueStart, end).trim();
    if (value) {
      extracted[current.key] = value;
    }
  }
  return extracted;
}

function applyContentDataMetadata(payload, metadata, extractedTags, extracted) {
  for (const [key, value] of Object.entries(extracted || {})) {
    if (key === 'category') {
      payload.category = normalizeCategory(value);
    } else if (key === 'contenttype') {
      payload.contentType = normalizeContentType(value);
    } else if (key === 'status') {
      payload.status = normalizeStatus(value);
    } else if (key === 'tags') {
      for (const name of value.split(',')) {
        extractedTags.push(name);
      }
    } else {
      metadata[metadataNameForKey(key)] ||= value;
      if (key === 'sourcesurface') {
        extractedTags.push({ name: `surface:${value}`, type: 'other' });
      } else if (key === 'source' || key === 'sourcepackage' || key === 'sourcelane') {
        extractedTags.push({ name: `source:${value}`, type: 'other' });
      } else if (key === 'agent') {
        extractedTags.push({ name: `agent:${value}`, type: 'other' });
      } else if (key === 'lane') {
        extractedTags.push({ name: `lane:${value}`, type: 'other' });
      } else if (key === 'preferencetype') {
        extractedTags.push({ name: `preference:${value}`, type: 'topic' });
      }
    }
  }
}

function parseMetadataObject(raw) {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return stripClientManagedFields(raw);
  if (typeof raw !== 'string') return { legacyMetadata: String(raw) };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return stripClientManagedFields(parsed);
    }
  } catch {
    return { legacyMetadata: raw.trim() };
  }
  return {};
}

function normalizeTagInput(tags) {
  const rawTags = Array.isArray(tags) ? tags : String(tags || '').split(',');
  const normalized = new Map();
  for (const tag of rawTags) {
    const rawName = typeof tag === 'string' ? tag : tag && tag.name;
    const name = normalizeTagName(rawName);
    if (!name || normalized.has(name)) continue;
    const rawType = typeof tag === 'object' && tag ? tag.type : '';
    normalized.set(name, {
      name,
      type: normalizeTagType(rawType || tagTypeForName(name))
    });
  }
  return Array.from(normalized.values());
}

function normalizeMemoryTagInput(tags) {
  const rawTags = Array.isArray(tags) ? tags : String(tags || '').split(',');
  const normalized = new Set();
  for (const tag of rawTags) {
    const name = normalizeTagName(typeof tag === 'string' ? tag : tag && tag.name);
    if (name) normalized.add(name);
  }
  return Array.from(normalized);
}

function normalizeTagName(name) {
  return String(name || '').trim().replace(/\s+/g, '-').toLowerCase();
}

function normalizeTagType(type) {
  const normalized = String(type || '').trim().toLowerCase();
  return ['category', 'keyword', 'topic', 'genre', 'audience', 'score_band', 'other'].includes(normalized)
    ? normalized
    : 'keyword';
}

function tagTypeForName(name) {
  if (/^(conversation_summary|user_preference|user_profile)$/i.test(name)) return 'category';
  if (name.startsWith('preference:')) return 'topic';
  if (/^(surface|source|agent|lane):/.test(name)) return 'other';
  return 'keyword';
}

function normalizeCategory(value) {
  const normalized = String(value || '').trim();
  if (/^(conversation_summary|user_preference|user_profile)$/i.test(normalized)) return 'memory';
  return normalized || 'other';
}

function normalizeContentType(value) {
  return String(value || '').trim() || 'plaintext';
}

function normalizeStatus(value) {
  return String(value || '').trim() || 'DRAFT';
}

function inferContentType(payload) {
  const body = String(payload.contentData || '').trim();
  const source = String(payload.fileName || payload.contentUrl || '').toLowerCase().split('?')[0];
  if (body.startsWith('{') || body.startsWith('[') || source.endsWith('.json')) return 'json';
  if (source.endsWith('.yml') || source.endsWith('.yaml')) return 'yaml';
  if (body.startsWith('#') || body.includes('\n#') || body.includes('](') || source.endsWith('.md')) return 'markdown';
  if (source.endsWith('.pdf')) return 'pdf';
  if (/\.(png|jpe?g|gif|webp)$/.test(source)) return 'image';
  if (/\.(mp4|mov|webm)$/.test(source)) return 'video';
  if (/\.(mp3|wav|m4a)$/.test(source)) return 'audio';
  if (!body && payload.contentUrl) return 'url';
  return 'plaintext';
}

function normalizeMetadataKey(key) {
  return String(key || '').trim().replace(/[^A-Za-z0-9_-]+/g, '').toLowerCase();
}

function isContentDataMetadataKey(key) {
  return new Set([
    'agent',
    'artifact',
    'artifacttype',
    'category',
    'classification',
    'contenttype',
    'lane',
    'llmdetailsid',
    'memoryscope',
    'preferencescope',
    'preferencetype',
    'reason',
    'source',
    'sourcepackage',
    'sourcesurface',
    'sourcelane',
    'status',
    'tags',
    'validationnonce',
    'workspaceid'
  ]).has(key);
}

function metadataNameForKey(key) {
  return {
    artifacttype: 'artifactType',
    llmdetailsid: 'llmDetailsId',
    memoryscope: 'memoryScope',
    preferencescope: 'preferenceScope',
    preferencetype: 'preferenceType',
    sourcepackage: 'sourcePackage',
    sourcesurface: 'sourceSurface',
    sourcelane: 'sourceLane',
    validationnonce: 'validationNonce',
    workspaceid: 'workspaceId'
  }[key] || key;
}

function stripClientManagedFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const blocked = new Set([
    'id',
    'ownerId',
    'ownerID',
    'createdDate',
    'keyHash',
    'lastAccessedById',
    'lastAccessedDate',
    'lastModifiedById',
    'lastModifiedDate'
  ]);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !blocked.has(key)));
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

function normalizeHttpPath(value) {
  const pathValue = String(value || '').trim();
  if (!pathValue.startsWith('/') || pathValue.includes('?') || pathValue.includes('#')) {
    throw new Error('GrayMatter MCP path must be an absolute URL path.');
  }
  return pathValue.length > 1 ? pathValue.replace(/\/+$/, '') : pathValue;
}

function isMcpRequestPath(pathname, publicMcpPath, publicApp) {
  const publicPaths = new Set([publicMcpPath, COMPATIBLE_PUBLIC_MCP_PATH]);
  if (publicApp) return publicPaths.has(pathname);
  return publicPaths.has(pathname) || pathname === '/' || pathname === '/message';
}

function isProtectedResourceMetadataPath(pathname, publicMcpPath) {
  const suffix = publicMcpPath.replace(/^\//, '');
  return pathname === '/.well-known/oauth-protected-resource'
    || pathname === `/.well-known/oauth-protected-resource/${suffix}`;
}

function protectedResourceMetadata(publicResource, oauthIssuer) {
  return {
    resource: publicResource,
    authorization_servers: [oauthIssuer],
    scopes_supported: [...PUBLIC_OAUTH_SCOPES],
    resource_documentation: 'https://github.com/ValkyrLabs/GrayMatter/blob/main/plugins/graymatter/README.md',
    bearer_methods_supported: ['header']
  };
}

async function requirePublicPrincipal(req, config) {
  const authHeader = Array.isArray(req.headers.authorization)
    ? req.headers.authorization[0]
    : req.headers.authorization;
  const bearerMatch = typeof authHeader === 'string' ? authHeader.match(/^Bearer\s+(.+)$/i) : null;
  if (!bearerMatch || !bearerMatch[1].trim()) {
    throw publicAuthError('invalid_token', 'A valid OAuth access token is required.');
  }
  const accessToken = bearerMatch[1].trim();
  let verified;
  try {
    verified = await config.tokenVerifier(accessToken, {
      issuer: config.oauthIssuer,
      jwksUri: config.oauthJwksUri,
      audience: config.publicResource,
      fetchImpl: config.fetchImpl,
      jwksCache: config.jwksCache
    });
  } catch (error) {
    if (error && error.name === 'PublicAuthError') throw error;
    throw publicAuthError('invalid_token', 'The OAuth access token could not be validated.');
  }
  const claims = verified && verified.claims ? verified.claims : verified;
  if (!claims || typeof claims !== 'object') {
    throw publicAuthError('invalid_token', 'The OAuth access token did not contain a valid principal.');
  }
  const userId = firstNonEmptyString(claims.userId, claims.user_id, claims.sub);
  const organizationId = firstNonEmptyString(claims.organizationId, claims.organization_id, claims.orgId, claims.org_id);
  const tenantId = firstNonEmptyString(claims.tenantId, claims.tenant_id);
  if (!userId || !organizationId || !tenantId) {
    throw publicAuthError('invalid_token', 'The OAuth access token is missing required principal scope claims.');
  }
  return {
    accessToken,
    userId,
    organizationId,
    tenantId,
    roles: claimStringArray(claims.roles || claims.roleList || claims.authorities),
    permissions: claimStringArray(claims.permissions || claims.permissionList),
    scopes: tokenScopes(claims)
  };
}

async function verifyPublicAccessToken(token, config) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw publicAuthError('invalid_token', 'The OAuth access token is malformed.');
  const header = parseJwtJson(parts[0]);
  const claims = parseJwtJson(parts[1]);
  if (!header || !claims || header.alg !== 'RS256' || !hasNonEmptyString(header.kid)) {
    throw publicAuthError('invalid_token', 'The OAuth access token uses an unsupported signature.');
  }
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== config.issuer || !audienceMatches(claims.aud, config.audience)
      || !Number.isFinite(Number(claims.exp)) || Number(claims.exp) <= now
      || (claims.nbf !== undefined && Number(claims.nbf) > now + 30)) {
    throw publicAuthError('invalid_token', 'The OAuth access token issuer, audience, or lifetime is invalid.');
  }
  const keys = await loadPublicJwks(config);
  const jwk = keys.find((candidate) => candidate && candidate.kid === header.kid && candidate.kty === 'RSA');
  if (!jwk) throw publicAuthError('invalid_token', 'The OAuth access token signing key is unavailable.');
  let publicKey;
  try {
    publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  } catch {
    throw publicAuthError('invalid_token', 'The OAuth signing key is invalid.');
  }
  const verified = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    publicKey,
    Buffer.from(parts[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  );
  if (!verified) throw publicAuthError('invalid_token', 'The OAuth access token signature is invalid.');
  return { claims };
}

async function loadPublicJwks(config) {
  const cache = config.jwksCache || { expiresAt: 0, keys: [] };
  if (cache.expiresAt > Date.now() && Array.isArray(cache.keys) && cache.keys.length > 0) {
    return cache.keys;
  }
  let jwksUri = config.jwksUri;
  if (!jwksUri) {
    const metadataResponse = await config.fetchImpl(`${withoutTrailingSlash(config.issuer)}/.well-known/oauth-authorization-server`, {
      headers: { accept: 'application/json' }
    });
    if (!metadataResponse.ok) throw publicAuthError('invalid_token', 'OAuth authorization metadata is unavailable.');
    const metadata = await metadataResponse.json();
    jwksUri = metadata && metadata.jwks_uri;
  }
  if (!hasNonEmptyString(jwksUri) || !jwksUri.startsWith('https://')) {
    throw publicAuthError('invalid_token', 'OAuth JWKS metadata is unavailable.');
  }
  const response = await config.fetchImpl(jwksUri, { headers: { accept: 'application/json' } });
  if (!response.ok) throw publicAuthError('invalid_token', 'OAuth signing keys are unavailable.');
  const payload = await response.json();
  const keys = payload && Array.isArray(payload.keys) ? payload.keys : [];
  if (keys.length === 0) throw publicAuthError('invalid_token', 'OAuth signing keys are unavailable.');
  cache.keys = keys;
  cache.expiresAt = Date.now() + 5 * 60 * 1000;
  return keys;
}

function parseJwtJson(segment) {
  try {
    const normalized = String(segment || '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function audienceMatches(audience, expected) {
  return Array.isArray(audience) ? audience.includes(expected) : audience === expected;
}

function claimStringArray(value) {
  if (Array.isArray(value)) return uniqueStrings(value.map(String).map((item) => item.trim()).filter(Boolean));
  if (typeof value === 'string') return uniqueStrings(value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean));
  return [];
}

function tokenScopes(claims) {
  return claimStringArray(claims.scope || claims.scp);
}

function requirePublicScopes(principal, requiredScopes) {
  const granted = new Set(principal && Array.isArray(principal.scopes) ? principal.scopes : []);
  const missing = requiredScopes.filter((scope) => !granted.has(scope));
  if (missing.length > 0) {
    const error = new Error('The OAuth access token does not grant the required operation scope.');
    error.name = 'PublicScopeError';
    error.statusCode = 403;
    throw error;
  }
}

function assertNoIdentityOverrideHeaders(req) {
  const forbiddenHeaders = ['x-tenant-id', 'x-organization-id', 'x-user-id', 'x-owner-id', 'x-valkyr-token'];
  if (forbiddenHeaders.some((header) => req.headers[header] !== undefined)) {
    throw publicArgumentError('Identity and tenant override headers are not accepted.');
  }
}

function assertNoPrincipalOverrides(value, depth = 0) {
  if (depth > 8 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item) => assertNoPrincipalOverrides(item, depth + 1));
    return;
  }
  if (typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    const normalized = key.replace(/[-\s]/g, '_').toLowerCase();
    if (PUBLIC_IDENTITY_KEYS.has(normalized)) {
      throw publicArgumentError('Identity, tenant, organization, owner, role, permission, and ACL overrides are not accepted.');
    }
    assertNoPrincipalOverrides(nested, depth + 1);
  }
}

function publicAuthError(code, message) {
  const error = new Error(message);
  error.name = 'PublicAuthError';
  error.oauthError = code;
  error.statusCode = 401;
  return error;
}

function publicAuthChallenge(publicResource, oauthError, description) {
  const metadataUrl = `${withoutTrailingSlash(publicResource)}/.well-known/oauth-protected-resource`;
  const safeError = oauthError || 'invalid_token';
  const safeDescription = String(description || 'OAuth authorization is required.').replace(/["\\\r\n]/g, ' ');
  return `Bearer resource_metadata="${metadataUrl}", scope="${PUBLIC_OAUTH_SCOPES.join(' ')}", error="${safeError}", error_description="${safeDescription}"`;
}

function publicHttpError(error, publicResource) {
  if (error && error.name === 'PublicAuthError') {
    const challenge = publicAuthChallenge(publicResource, error.oauthError, 'OAuth authorization is required.');
    return {
      status: 401,
      body: publicErrorEnvelope('AUTH_REQUIRED', 'OAuth authorization is required.', true),
      headers: { 'www-authenticate': challenge }
    };
  }
  if (error && error.name === 'PublicArgumentError') {
    return { status: 400, body: publicErrorEnvelope('INVALID_ARGUMENT', error.message, false), headers: {} };
  }
  return { status: 500, body: publicErrorEnvelope('INTERNAL_ERROR', 'GrayMatter could not process the request.', true), headers: {} };
}

function publicToolSuccess(value, text, nextOffset) {
  const structuredContent = {
    ok: true,
    data: compactPublicValue(value)
  };
  if (nextOffset !== undefined) structuredContent.nextOffset = nextOffset;
  return {
    structuredContent,
    content: [{ type: 'text', text }]
  };
}

function publicToolErrorFromException(error, publicResource) {
  let code = 'INTERNAL_ERROR';
  let message = 'GrayMatter could not complete the operation.';
  let retryable = false;
  const status = Number(error && (error.status || error.statusCode));
  if (error && error.name === 'PublicArgumentError') {
    code = 'INVALID_ARGUMENT';
    message = error.message;
  } else if (error && error.name === 'PublicScopeError') {
    code = 'FORBIDDEN';
    message = 'The signed-in user or OAuth grant does not allow this operation.';
  } else if (status === 401) {
    code = 'AUTH_REQUIRED';
    message = 'OAuth authorization is required.';
    retryable = true;
  } else if (status === 402) {
    code = 'USAGE_LIMIT_REACHED';
    message = 'The GrayMatter usage limit has been reached. Manage the account outside ChatGPT, then retry.';
  } else if (status === 403) {
    code = 'FORBIDDEN';
    message = 'The signed-in user is not authorized for this operation.';
  } else if (status === 404) {
    code = 'NOT_FOUND';
    message = 'The requested authorized record was not found.';
  } else if (status === 409) {
    code = 'CONFLICT';
    message = 'The operation conflicts with the current record state.';
  } else if (status === 400 || status === 413 || status === 422) {
    code = 'INVALID_ARGUMENT';
    message = 'The request did not satisfy the GrayMatter tool contract.';
  } else if (status >= 500 || (error && error.name === 'TypeError')) {
    code = 'UPSTREAM_UNAVAILABLE';
    message = 'GrayMatter is temporarily unavailable.';
    retryable = true;
  }
  const result = publicToolError(code, message, retryable);
  if (code === 'AUTH_REQUIRED') {
    result._meta = { 'mcp/www_authenticate': [publicAuthChallenge(publicResource, 'invalid_token', message)] };
  }
  return result;
}

function publicToolError(code, message, retryable) {
  return {
    isError: true,
    structuredContent: publicErrorEnvelope(code, message, retryable),
    content: [{ type: 'text', text: message }]
  };
}

function publicErrorEnvelope(code, message, retryable) {
  return { ok: false, error: { code, message, retryable: Boolean(retryable) } };
}

function compactPublicValue(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 7) return '[truncated]';
  if (typeof value === 'string') return value.length > PUBLIC_MAX_RESPONSE_STRING
    ? `${value.slice(0, PUBLIC_MAX_RESPONSE_STRING)}…`
    : value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.slice(0, PUBLIC_MAX_RESPONSE_ITEMS).map((item) => compactPublicValue(item, depth + 1));
  }
  const sanitized = {};
  for (const [key, nested] of Object.entries(value)) {
    if (/token|secret|password|credential|decrypted|ownerId|lastModifiedById|tenantId|organizationId|principal/i.test(key)) {
      continue;
    }
    sanitized[key] = compactPublicValue(nested, depth + 1);
  }
  return sanitized;
}

function authContextFrom(req, processToken = '', security = defaultSecurityConfig()) {
  const headerToken = req.headers['x-valkyr-token'];
  if (headerToken && HOSTED_DEPLOYMENT_MODES.has(security.deploymentMode) && !security.allowUnsafeHeaderToken) {
    const error = new Error('X-Valkyr-Token is disabled in hosted GrayMatter MCP mode. Use bearer/session auth or enable the explicit unsafe override for private testing.');
    error.statusCode = 401;
    throw error;
  }
  if (Array.isArray(headerToken)) {
    return { token: headerToken[0] || '', requestScopedToken: Boolean(headerToken[0]) };
  }
  if (headerToken) {
    return { token: headerToken, requestScopedToken: true };
  }

  const authHeader = Array.isArray(req.headers.authorization)
    ? req.headers.authorization[0]
    : req.headers.authorization;
  const bearerMatch = typeof authHeader === 'string' ? authHeader.match(/^Bearer\s+(.+)$/i) : null;
  if (bearerMatch) {
    return { token: bearerMatch[1].trim(), requestScopedToken: true };
  }

  if (security.deploymentMode === 'hosted-multi-tenant') {
    return { token: '', requestScopedToken: true };
  }

  return { token: processToken || process.env.VALKYR_AUTH_TOKEN || process.env.VALKYR_JWT_SESSION || '', requestScopedToken: false };
}

function tenantIdFrom(req, processTenantId = '', processToken = '') {
  const headerTenant = req.headers['x-tenant-id'];
  if (Array.isArray(headerTenant)) {
    return cleanTenantId(headerTenant[0]) || cleanTenantId(processTenantId) || tenantIdFromToken(processToken);
  }
  return cleanTenantId(headerTenant) || cleanTenantId(processTenantId) || tenantIdFromToken(processToken);
}

function cleanTenantId(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed && trimmed.toLowerCase() !== 'null' ? trimmed : '';
}

function tenantIdFromToken(token) {
  const claims = decodeJwtPayload(token);
  if (!claims) return '';
  const explicitTenant = cleanTenantId(claims.tenantId || claims.organizationId || claims.orgId);
  if (explicitTenant) return explicitTenant;
  return jwtHasRole(claims, 'VALKYR_AGENT') ? 'main' : '';
}

function decodeJwtPayload(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function jwtHasRole(claims, roleName) {
  const target = normalizeRole(roleName);
  return ['roles', 'roleList', 'authorities', 'authorityList'].some((key) => {
    const values = Array.isArray(claims[key]) ? claims[key] : [];
    return values.some((value) => normalizeRole(value) === target);
  });
}

function normalizeRole(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const upper = value.trim().toUpperCase();
  return upper.startsWith('ROLE_') ? upper : `ROLE_${upper}`;
}

function apiUrl(apiBase, endpoint) {
  const base = `${withoutTrailingSlash(apiBase)}/`;
  const cleanEndpoint = endpoint.replace(/^\/+/, '');
  return new URL(cleanEndpoint, base).toString();
}

function openSseStream(req, res, security = defaultSecurityConfig()) {
  res.writeHead(200, {
    ...corsHeaders(req, security),
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'content-type': 'text/event-stream'
  });
  res.write('event: endpoint\n');
  res.write('data: /message\n\n');
  const keepAlive = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 25000);
  req.on('close', () => {
    clearInterval(keepAlive);
    if (!res.writableEnded) {
      res.end();
    }
  });
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

function sendJson(req, res, status, payload, security = defaultSecurityConfig(), extraHeaders = {}) {
  res.writeHead(status, {
    ...corsHeaders(req, security),
    'content-type': 'application/json',
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}

function sendNoContent(req, res, security = defaultSecurityConfig()) {
  res.writeHead(204, corsHeaders(req, security));
  res.end();
}

function defaultSecurityConfig() {
  return { deploymentMode: 'local-dev', allowedOrigins: [], allowUnsafeHeaderToken: false, publicApp: false };
}

function normalizeDeploymentMode(value) {
  const mode = String(value || 'local-dev').trim();
  if (LOCAL_DEPLOYMENT_MODES.has(mode) || HOSTED_DEPLOYMENT_MODES.has(mode)) {
    return mode;
  }
  throw new Error(`Unsupported GrayMatter MCP deployment mode: ${mode}`);
}

function parseAllowedOrigins(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  return raw.map((origin) => withoutTrailingSlash(String(origin).trim())).filter(Boolean);
}

function parseBoolean(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function corsHeaders(req, security = defaultSecurityConfig()) {
  const headers = {
    'access-control-allow-headers': security.publicApp
      ? 'authorization,content-type,mcp-protocol-version,mcp-session-id'
      : 'authorization,content-type,x-valkyr-token',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    vary: 'Origin'
  };

  if (!HOSTED_DEPLOYMENT_MODES.has(security.deploymentMode)) {
    headers['access-control-allow-origin'] = '*';
    return headers;
  }

  const origin = withoutTrailingSlash(Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin || '');
  if (origin && security.allowedOrigins.includes(origin)) {
    headers['access-control-allow-origin'] = origin;
  }
  return headers;
}

function authReadiness(security, hasProcessToken) {
  return {
    ok: true,
    deploymentMode: security.deploymentMode,
    hostedMode: HOSTED_DEPLOYMENT_MODES.has(security.deploymentMode),
    allowedOrigins: security.allowedOrigins,
    xValkyrTokenAccepted: !HOSTED_DEPLOYMENT_MODES.has(security.deploymentMode) || security.allowUnsafeHeaderToken,
    processTokenAccepted: security.deploymentMode !== 'hosted-multi-tenant',
    processTokenConfigured: hasProcessToken
  };
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

function firstNonEmptyString(...values) {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0)?.trim();
}

function clampInteger(value, defaultValue, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }
  return Math.max(min, Math.min(max, parsed));
}

function uniqueStrings(values) {
  return Array.from(new Set(
    values
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  ));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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
  tools,
  publicTools,
  verifyPublicAccessToken
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
