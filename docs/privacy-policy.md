# GrayMatter Privacy Policy

Effective date: 2026-07-11

GrayMatter is a ValkyrLabs app that gives users durable memory, shared graph context, and live ValkyrAI schema access through an MCP server.

## Data We Collect

GrayMatter processes the content a user intentionally sends to GrayMatter tools, including memory text, MemoryEntry metadata, memory-search and context-compilation queries, requested entity types, entity identifiers, procedure queries, and retrieval-receipt requests.

When a user connects GrayMatter to a hosted ValkyrAI account, GrayMatter processes OAuth 2.1 authorization-code requests, login and consent choices, PKCE parameters, access and refresh tokens, token revocation requests, and the minimum identity and authorization claims needed to enforce access. The MCP server validates the access token for the intended GrayMatter resource, forwards it to ValkyrAI api-0 for the current request, and does not expose tokens in tool results or widget props.

GrayMatter may log operational metadata needed to maintain reliability and security, such as request timestamps, endpoint names, response status codes, and correlation identifiers. Production logs should redact tokens, secrets, and unnecessary personal information.

## How We Use Data

GrayMatter uses submitted data to fulfill the user's request, including writing durable memory, reading memory, searching memory, compiling bounded context, finding procedures, creating and retrieving authorized retrieval receipts, inspecting graph state, listing or fetching RBAC-scoped business entities, creating permitted entities, and summarizing schema metadata.

GrayMatter does not use user data to advertise unrelated services or manipulate ChatGPT tool selection. Tool descriptions and app metadata must accurately reflect GrayMatter's purpose.

## Sharing

GrayMatter sends user-authorized requests to ValkyrAI api-0 and any configured self-hosted api-0 compatible endpoint. GrayMatter does not sell personal data.

## Retention

MemoryEntry records, ContextPage records, retrieval receipts, and business entities are retained according to the user's ValkyrAI workspace configuration and account policies. Search, retrieval, and context-compilation queries are processed to provide the requested result and may be retained only when required by an authorized retrieval receipt, audit record, security control, or configured workspace policy. OAuth grants and refresh tokens remain until they expire or are revoked. Operational logs are retained only as long as needed for security, debugging, abuse prevention, and legal obligations.

## Deletion

Users can explicitly forget an authorized memory using GrayMatter's confirmed deletion workflow and may request deletion of GrayMatter memories, receipts, OAuth grants, or account data through the ValkyrLabs support channel associated with their account. Revoking an OAuth grant prevents future token use but does not by itself delete previously stored memory. Deletion requests are processed promptly unless retention is required for security, legal, or abuse-prevention reasons.

## Security

GrayMatter follows least-privilege access and RBAC/ACL-scoped api-0 calls. Hosted requests derive user, organization, tenant, roles, permissions, and scopes only from a validated OAuth access token; model- or client-supplied identity and tenant overrides are rejected. Data access is limited to the authenticated tenant and authorized objects, and cross-tenant memory, query, receipt, procedure, and context access is denied. Tokens must be stored outside source control, passed through secure deployment secrets, and redacted from logs.

## Contact

Contact ValkyrLabs support at support@valkyrlabs.com for privacy, access, correction, or deletion requests.
