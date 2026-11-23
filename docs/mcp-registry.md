# GrayMatter in the MCP server gallery

GrayMatter's MCP server connects AI agents to authorized durable memory and bounded context. Its registry identity is `io.github.ValkyrLabs/graymatter`, published by Valkyr Labs. The VS Code extension and the MCP server listing are separate installation surfaces.

## Connect hosted GrayMatter

In VS Code, open the Extensions view and search for `@mcp GrayMatter`. Check that the publisher is Valkyr Labs and the repository is `ValkyrLabs/GrayMatter`, then install the server and complete the browser's OAuth sign-in. Hosted memory requires a GrayMatter Cloud account and the permissions granted during linking.

If the GitHub-backed gallery has not included the listing yet, run **MCP: Add Server**, choose **HTTP**, and enter:

```text
https://api-0.valkyrlabs.com/graymatter/mcp
```

Name the connection `graymatter`. VS Code uses the server's OAuth discovery metadata for sign-in. Keep tokens and passwords out of MCP configuration files. An ordinary api-0 login session is separate from an OAuth grant for this MCP resource.

Clients can call `initialize` and `tools/list` without a token to inspect the
static public catalog. The initialization notification is also accepted without
sign-in. Every `tools/call`, including memory reads and context compilation, still
requires OAuth; resource reads are not anonymous. Anonymous discovery never
queries customer data or uses a server-side credential. Supplied invalid or
expired credentials are rejected, not silently treated as anonymous requests.

The equivalent VS Code workspace configuration is:

```json
{
  "servers": {
    "graymatter": {
      "type": "http",
      "url": "https://api-0.valkyrlabs.com/graymatter/mcp"
    }
  }
}
```

Save it as `.vscode/mcp.json`. For portable MCP configuration, use the host's supported configuration format. Follow the client's server trust and OAuth prompts, then verify that GrayMatter tools are listed before using memory.

## Use local GrayMatter Lite without hosted signup

Local Lite is a separate connection. Use the GrayMatter extension's **Connect Local GrayMatter Lite** command when that extension is installed, or follow [the source-based local setup](graymatter-light.md). No valkyrlabs.com account is required for local Lite. An uncached source build needs its documented toolchain and dependencies; a prepared local instance can run without the hosted service.

This remote registry entry connects the hosted service. It does not install or start a local Lite instance. The npm package `@valkyrlabs/graymatter-mcp-server` is not published by this listing, and should not be used as a gallery installation command.

## Publish and verify the listing

The repository root's `server.json` is the publication metadata. Its schema is the official MCP Registry schema; no package publication is needed for its remote Streamable HTTP connection.

Validate the file with the [official publisher](https://modelcontextprotocol.io/registry/quickstart):

```bash
node --test tests/mcp-registry.test.mjs
mcp-publisher validate server.json
```

For this GitHub organization namespace, use the repository's existing manual
**Publish GrayMatter MCP Registry Metadata** workflow on `main`. It uses a
short-lived GitHub Actions OIDC identity; no token needs to be exported or placed
in the repository. Update its exact metadata checksum and version pin together
with `server.json`; the listing test rejects a stale pin.

```bash
gh workflow run publish-mcp-registry.yml --repo ValkyrLabs/GrayMatter --ref main
```

After publication, verify the exact server name and version in the [official registry API](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.ValkyrLabs%2Fgraymatter&version=latest), then separately verify the [GitHub-backed gallery](https://api.mcp.github.com/v0.1/servers?search=io.github.ValkyrLabs%2Fgraymatter&version=latest) and VS Code's `@mcp GrayMatter` search. A successful official-registry publication is not proof that GitHub's gallery has included the server. Record the actual result for both services.

The publisher's interactive GitHub device flow currently grants only a personal
namespace, even for organization owners. It cannot publish this organization
listing; use the OIDC workflow rather than repeatedly signing in or copying a
GitHub credential. See the [official organization authentication guidance](https://modelcontextprotocol.io/registry/authentication#personal-vs-organization-namespaces).

Published version metadata is immutable. Review changes and publish a new metadata version for subsequent updates; retrying an interrupted publication should first check whether that exact version already exists.

The registry metadata version is independent of the OpenAI/Claude plugin and npm
versions. The icon uses the existing 64×64 PNG at an immutable repository revision;
verify its public HTTPS response before publishing a new registry version.
