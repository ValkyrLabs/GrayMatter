# GrayMatter

Secure, durable memory for Claude by Valkyr Labs. GrayMatter remembers the
preferences, decisions, and project context you choose to keep, so you can
continue work across conversations without repeating the same background.

## What is included

- The GrayMatter hosted MCP connector for searching, reading, saving, revising,
  and forgetting memories, finding reusable procedures, compiling bounded task
  context, and inspecting retrieval receipts.
- Three skills: `graymatter-onboarding`, `graymatter-memory`, and
  `graymatter-context`. They teach Claude how to establish your memory choices,
  match the right records, verify writes, and respect retrieval policy.

The connector and plugin use the same MCP URL. If you install both directory
listings, they refer to the same service rather than separate memory stores.

## Connect

Add GrayMatter from Claude's directory, then connect its GrayMatter connector.
Sign in to your own GrayMatter account on `api-0.valkyrlabs.com` and approve the
OAuth consent screen. Your account determines which memories you can access;
there is no tenant or permission override in the plugin. Do not paste passwords
or access tokens into a conversation.

In Claude Code, open `/mcp` if authentication is needed. For a local development
copy of this bundle, start Claude Code with `claude --plugin-dir /path/to/bundle`.
The bundle needs no package installation, local server, shell hook, or build step.

For the repository-hosted Claude Code marketplace, run:

```text
/plugin marketplace add https://github.com/ValkyrLabs/GrayMatter.git#claude-plugin
/plugin install graymatter@graymatter
```

## Try it

- "Remember that I prefer short release notes with links to the tests."
- "What do you remember about this project's release process?"
- "Compile only the context needed for my current task, with source references."
- "Find our stored production release review procedure."

You can ask GrayMatter to act as primary memory when its skills and tools are
active. Choose whether lasting facts should be saved automatically or only on
request. Installation alone does not change a host-wide memory setting or
guarantee that the host invokes a tool before every task. You can pause saving,
correct an exact record, or confirm the exact memory to forget.

## Data handling and privacy

This bundle contains instructions and one HTTPS MCP configuration. It has no
executable hooks, telemetry process, credential reader, or automatic repository
upload. When Claude invokes a GrayMatter tool, the supplied task, search text,
memory content, or record reference is sent to the declared GrayMatter service
at `https://api-0.valkyrlabs.com/graymatter/mcp`. Tool results are returned to
Claude. Do not save secrets or session-only material as durable memory.

Saved memories persist in your GrayMatter account and are subject to the
service's retention and deletion policies. Account authorization remains on the
server. A retrieval receipt explains the authorized evidence used for context;
missing evaluator confidence is not a confidence score of zero. Withheld or
conflicting context must not be presented as verified evidence.

Read the [privacy policy](https://valkyrlabs.com/v1/Legal/privacy/) and
[terms of service](https://valkyrlabs.com/v1/Legal/tos/) for the service's data
handling and account terms.

## Troubleshooting

If the connector is disconnected, use Claude's Connect or reconnect control
and resume your original task. In Claude Code, inspect `/mcp`. An empty search
does not prove the whole store is empty. For a timeout or uncertain write,
inspect the existing record before retrying to avoid duplicates. If context is
withheld, follow its retrieval policy; do not substitute a search summary and
call it compiled context.

Support: [support@valkyrlabs.com](mailto:support@valkyrlabs.com).
Source and issues: [ValkyrLabs/GrayMatter](https://github.com/ValkyrLabs/GrayMatter).
The bundle is licensed under AGPL-3.0-only, matching its source repository.
