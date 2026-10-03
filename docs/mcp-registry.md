# GrayMatter in the MCP server gallery

GrayMatter's MCP server connects AI agents to authorized durable memory and bounded context. Its registry identity is `io.github.ValkyrLabs/graymatter`, published by Valkyr Labs. The VS Code extension and the MCP server listing are separate installation surfaces.

## Connect hosted GrayMatter

In VS Code, open the Extensions view and search for `@mcp GrayMatter`. Check that the publisher is Valkyr Labs and the repository is `ValkyrLabs/GrayMatter`, then install the server and complete the browser's OAuth sign-in. Hosted memory requires a GrayMatter Cloud account and the permissions granted during linking.

If the GitHub-backed gallery has not included the listing yet, run **MCP: Add Server**, choose **HTTP**, and enter:

```text
https://api-0.valkyrlabs.com/graymatter/mcp
```

Name the connection `graymatter`. VS Code uses the server's OAuth discovery metadata for sign-in. Keep tokens and passwords out of MCP configuration files. An ordinary api-0 login session is separate from an OAuth grant for this MCP resource.

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

Use an already-authorized MCP Registry login. If a new GitHub OAuth authorization is required, complete it through the publisher's supported device flow with the account owner's approval. Do not export a GitHub CLI credential or place tokens in the repository.

```bash
mcp-publisher login github
mcp-publisher publish server.json
```

After publication, verify the exact server name and version in the [official registry API](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.ValkyrLabs%2Fgraymatter&version=latest), then separately verify the [GitHub-backed gallery](https://api.mcp.github.com/v0.1/servers?search=io.github.ValkyrLabs%2Fgraymatter&version=latest) and VS Code's `@mcp GrayMatter` search. A successful official-registry publication is not proof that GitHub's gallery has included the server. Record the actual result for both services.

Published version metadata is immutable. Review changes and publish a new metadata version for subsequent updates; retrying an interrupted publication should first check whether that exact version already exists.
