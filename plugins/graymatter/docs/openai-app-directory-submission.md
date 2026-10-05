# OpenAI Plugin Directory Submission

OpenAI now publishes Apps SDK apps as plugins. GrayMatter is an app-plus-skills plugin: its app is backed by the public MCP endpoint and its two bundled skills teach safe durable-memory and bounded-context behavior.

## Developer-mode validation

1. Deploy `mcp-server/` over HTTPS with `GRAYMATTER_PUBLIC_APP=true` and the environment documented in `README.md`.
2. Enable Developer mode in ChatGPT under Settings → Security and login.
3. Under Settings → Plugins, create a developer-mode app using `https://api-0.valkyrlabs.com/graymatter/mcp`.
4. Complete OAuth linking, confirm that exactly eight public tools are discovered, and run the representative prompts in `SUBMISSION_CHECKLIST.md`.
5. After metadata changes, redeploy and refresh the developer-mode app.

## Public submission

For this resubmission, update the existing draft rather than creating another. Use the exact five-positive/three-negative [Reviewer Quick Start](reviewer-test-credentials.md), not the optional engineering examples. Current [OpenAI submission requirements](https://developers.openai.com/plugins/deploy/submission) and [complete-plugin testing](https://developers.openai.com/plugins/deploy/connect-chatgpt) govern the actual portal format; legacy `.app.json` client mappings are not supported ChatGPT plugin ZIP app references. Respect the human's requested stopping point before submission and any action-time legal confirmation.

1. Complete Valkyr Labs business verification in the OpenAI Platform organization and confirm the publisher identity is verified.
2. Give the submitter Apps Management read/write access (`api.apps.write` and `api.apps.read`) and use a global-data-residency project.
3. Open the plugin submission portal and create a `With MCP` plugin.
4. Enter the concrete production MCP URL and OAuth configuration, then scan tools.
5. Verify names, descriptions, strict schemas, OAuth security schemes, annotations, `_meta`, and server instructions imported from the live endpoint.
6. Add the GrayMatter listing, two bundled skills, privacy policy, terms and support URLs, test cases, reviewer test credentials, availability, and release notes from `SUBMISSION_CHECKLIST.md`.
7. Submit for review. After approval, publish from the portal.

## Hard blockers

Do not submit until:

- the HTTPS MCP route and compatibility alias are live;
- OAuth authorization-code + PKCE `S256`, protected-resource metadata, authorization-server metadata, token validation, and JWKS are live;
- two isolated reviewer accounts pass the public MCP smoke test;
- production api-docs exposes the ContextPage compile endpoint;
- the public privacy policy covers all disclosed data handling; and
- the actual ChatGPT tester path passes its required cases, including both bundled skills; legacy clients separately retain the assigned durable app ID in `.app.json`.

See `SUBMISSION_CHECKLIST.md` for the ready-to-paste listing, tool explanations, prompts, data disclosure, reviewer procedure, security controls, and exact blockers.
