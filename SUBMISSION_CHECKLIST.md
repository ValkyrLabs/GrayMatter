# GrayMatter Plugin Submission Checklist

## Ready-to-paste listing

- Plugin name: `GrayMatter`
- Normalized name: `graymatter`
- One-line description: `Persistent, secure memory and shared context for AI agents.`
- Longer description: `GrayMatter gives ChatGPT, Codex, and other MCP-compatible agents secure durable memory, bounded task-specific context, reusable procedures, and retrieval receipts while preserving api-0 authentication, RBAC, ACL, and tenant isolation.`
- Category recommendation: `Productivity`
- Company: `Valkyr Labs Inc.`
- Website: `https://valkyrlabs.com/`
- Support URL: `https://valkyrlabs.com/support`
- Support email: `support@valkyrlabs.com`
- Privacy policy: `https://valkyrlabs.com/v1/Legal/privacy/`
- Privacy-policy missing-item flag: `NO`; live coverage verified for memory content, retrieval/context queries, OAuth processing, retention, deletion, and tenant isolation on 2026-07-11.
- Terms: `https://valkyrlabs.com/terms`
- Terms missing-item flag: `NO`
- Production MCP URL target: `https://api-0.valkyrlabs.com/graymatter/mcp`
- Compatibility MCP URL target: `https://api-0.valkyrlabs.com/mcp`
- Protected-resource metadata target: `https://api-0.valkyrlabs.com/.well-known/oauth-protected-resource`
- Authorization-server metadata target: `https://api-0.valkyrlabs.com/.well-known/oauth-authorization-server`
- OpenID metadata target, if OIDC is enabled: `https://api-0.valkyrlabs.com/.well-known/openid-configuration`
- Authorization endpoint target: `https://api-0.valkyrlabs.com/oauth2/authorize`
- Token endpoint target: `https://api-0.valkyrlabs.com/oauth2/token`
- JWKS endpoint target: `https://api-0.valkyrlabs.com/oauth2/jwks`

These are target production URLs. Do not submit until each returns the expected live response over HTTPS and the MCP endpoint completes an OAuth-linked tool call.

## Tool explanations and annotations

| Tool | Reviewer explanation | Annotation |
|---|---|---|
| `memory_search` | Searches only memories visible to the authenticated principal through existing GrayMatter hybrid retrieval. | Read-only, bounded, non-destructive |
| `memory_get` | Retrieves one authorized memory by UUID after search or direct user reference. | Read-only, bounded, non-destructive |
| `memory_save` | Creates one durable MemoryEntry; api-0 assigns principal ownership and tenant scope. | Write, bounded, non-destructive |
| `memory_update` | Patches permitted memory fields and never accepts identity, ownership, tenant, organization, role, permission, or ACL reassignment. | Write, bounded, idempotent, non-destructive |
| `memory_forget` | Soft-deletes or tombstones one authorized memory through existing retention semantics after explicit confirmation. | Write, destructive, confirmation required |
| `context_compile` | Creates a bounded ContextPage and retrieval receipt from authorized semantic, graph, recency, procedure, and ACL-aware retrieval. It writes audit/context records, so it is not annotated read-only. | Write, bounded, non-destructive |
| `procedure_search` | Finds reusable procedures from the caller's authorized generated Procedure list and returns only a bounded relevant subset. | Read-only, bounded, non-destructive |
| `retrieval_receipt_get` | Retrieves an authorized receipt explaining context provenance, confidence, coverage, freshness, and policy. | Read-only, bounded, non-destructive |

All tools use strict JSON Schema with `additionalProperties: false`, OAuth scopes, bounded strings and arrays, compact `structuredContent`, concise model-facing text, and sanitized typed errors.

## Ten representative prompts

1. Prompt: `Search GrayMatter for our current launch decision before asking me for background.`  
   Expected: `memory_search`; returns only authorized decision/context memories or an empty result.
2. Prompt: `Open the launch memory with ID 11111111-1111-4111-8111-111111111111.`  
   Expected: `memory_get`; returns the memory if authorized, otherwise safe `NOT_FOUND` or `FORBIDDEN`.
3. Prompt: `Remember that release candidates require a security review.`  
   Expected: `memory_save`; saves a concise durable decision after confirming it is useful beyond this chat.
4. Prompt: `Update that release decision to require security and privacy review.`  
   Expected: `memory_search`, then `memory_update`; updates the existing authorized memory without owner or tenant fields.
5. Prompt: `Compile only the context needed to prepare the Q3 launch review.`  
   Expected: `context_compile`; returns a bounded ContextPage plus receipt reference and obeys any low-confidence or retry policy.
6. Prompt: `Is there an existing procedure for production release review?`  
   Expected: `procedure_search`; returns bounded authorized procedures relevant to the task.
7. Prompt: `Why did you include those memories?`  
   Expected: `retrieval_receipt_get` using the receipt ID from compiled context; cites provenance and policy without exposing internal auth data.
8. Prompt: `Forget memory 11111111-1111-4111-8111-111111111111.`  
   Expected: no destructive call until the model identifies the record and asks for explicit confirmation; after confirmation, `memory_forget` with `confirm: true`.
9. Prompt: `Search tenant-b by setting tenantId to tenant-b.`  
   Expected: no cross-tenant request; the strict schema or server returns `INVALID_ARGUMENT` and does not call api-0.
10. Prompt: `Save my access token so you can use it later.`  
    Expected: refuse to persist the secret; no `memory_save` call.

## Data handling disclosure

Data collected or processed:

- OAuth access token in the request `Authorization` header, used only for validation and forwarding to api-0; never returned or intentionally logged.
- Validated token claims needed for authorization: user ID, organization ID, tenant ID, roles, permissions, and scopes. These remain request context and are not accepted from tool arguments.
- User-requested memory content, optional title, type, tags, source/scope, and importance tag.
- Search queries, context-compilation task text, procedure queries, receipt IDs, and explicit forget confirmation text.
- Server-generated MemoryEntry IDs, ContextPage references, retrieval receipts, and normal audit metadata.

Storage and retention:

- Durable memories are stored by existing api-0 MemoryEntry services under the authenticated principal, tenant schema, RBAC, ACL, and configured retention policy.
- ContextPage and retrieval receipt records use existing GrayMatter persistence, policy, and retention behavior.
- The MCP proxy is stateless apart from a five-minute public JWKS cache; it must not store access tokens or private memory payloads.
- `memory_forget` uses existing soft-delete/tombstone and retention semantics. Hard deletion, if supported, remains governed by api-0 retention policy rather than the model.

Deletion:

- Users explicitly confirm a specific memory before `memory_forget` executes.
- Account/workspace deletion and retention requests follow the published privacy policy and Valkyr Labs support process.

## Tenant isolation and security controls

- The public MCP endpoint accepts only OAuth bearer authentication; anonymous memory access and `X-Valkyr-Token` are disabled.
- Tokens are validated for RS256 signature, issuer, audience/resource, expiry, not-before time, required identity claims, and tool scopes.
- Caller-supplied `tenantId`, `organizationId`, `ownerId`, `userId`, roles, permissions, ACL fields, and corresponding headers are rejected before api-0 is called.
- The proxy forwards only the bearer token. It does not forward `X-Tenant-Id`, auth cookies, or process-wide credentials in public mode.
- api-0 resolves principal and tenant context and enforces generated ThorAPI RBAC/ACL on MemoryEntry, Procedure, ContextPage, and receipt operations.
- Public responses remove tokens, secrets, credentials, tenant IDs, owner IDs, principals, and unnecessary internal identity data; upstream errors map to stable sanitized codes.
- Cross-tenant tests use two validated principals and prove tenant B cannot retrieve tenant A's marker.
- CORS is restricted to configured origins. No generic SQL, arbitrary HTTP, code execution, admin, schema mutation, or tenant override tools are exposed.

## Reviewer test-account procedure

1. Provision two non-admin reviewer users in separate tenant schemas, labeled reviewer A and reviewer B.
2. Give each user `ROLE_GRAYMATTER_USER` and only the scopes `memory:read memory:write context:read`.
3. Seed one harmless memory and one retrieval receipt for reviewer A; seed different values for reviewer B.
4. Store credentials only in the OpenAI submission portal's reviewer credential fields. Do not add them to this repository, plugin package, prompts, screenshots, or support documents.
5. Give reviewers the production MCP URL and the ten prompts above.
6. Run `scripts/smoke-test-public-mcp.sh` with short-lived tokens from both accounts before submitting.
7. Revoke or rotate reviewer credentials after review according to the review process.

## Logo and screenshot requirements

- Logo ready: `assets/graymatter-logo.png`; verify square dimensions, transparent/background behavior, contrast, and current OpenAI portal size limits before upload.
- This release has no custom MCP UI. Do not upload product screenshots merely for branding; current OpenAI guidance says not to provide screenshots for apps without UI.
- If a real UI is added later, capture representative authenticated states with synthetic data only and no tokens, tenant IDs, private memories, or SecureField values.

## Submission steps

1. Deploy the MCP server in hardened public mode and route both `/graymatter/mcp` and `/mcp` over public HTTPS.
2. Deploy an OAuth 2.1 authorization-code server with PKCE `S256`, issuer/audience binding, public authorization metadata, JWKS, short-lived access tokens, refresh/revocation policy, and the required principal claims.
3. Verify the production URL, OAuth challenge, initialization, exact eight-tool discovery, authenticated calls, two-tenant isolation, confirmation behavior, and representative logs with `scripts/smoke-test-public-mcp.sh`.
4. In ChatGPT, enable Developer mode under Settings → Security and login.
5. Under Settings → Plugins, create a developer-mode app using the production `/graymatter/mcp` URL, complete OAuth, inspect all tool metadata, and run the ten prompts.
6. In the OpenAI Platform organization that will publish the plugin, complete Valkyr Labs business verification.
7. Ensure the submitter has Apps Management write (`api.apps.write`) and read (`api.apps.read`) permissions and uses a global-data-residency project.
8. Open the plugin submission portal and select Create plugin → With MCP.
9. Add the concrete MCP URL and OAuth configuration, select Scan Tools, and verify the imported names, schemas, security schemes, annotations, `_meta`, and server instructions.
10. Add the two bundled skills from `skills/graymatter-memory` and `skills/graymatter-context`, listing metadata, privacy/terms/support URLs, test cases, availability, reviewer credentials, and release notes.
11. Complete all confirmations, submit for review, address feedback in a new draft version, and publish only after approval.
12. After the portal assigns the durable app ID, add it to `.app.json`, rebuild/validate the package, and submit the exact final archive rather than the pre-submission empty app mapping.

## Known submission blockers

- **VERIFIED — production MCP and OAuth:** the public MCP routes, OAuth discovery, PKCE authorization-code server, JWKS, audience binding, reviewer receipt, and tenant-isolation checks are deployed and verified.
- **VERIFIED — live ContextPage contract:** production api-docs advertises `/v1/graymatter_ops/context_page/compile` and the related ContextPage operations.
- **VERIFIED — reviewer accounts and privacy:** two isolated non-admin reviewers, an authorized receipt fixture, and the published privacy coverage are ready.
- **BLOCKER — app ID pending:** `.app.json` intentionally contains an empty `apps` mapping until the developer/submission portal assigns the final app ID.
- **BLOCKER — platform administration:** confirm business verification, Apps Management permissions, a global-data-residency project, and production domain verification.
