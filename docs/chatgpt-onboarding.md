# GrayMatter in ChatGPT: first useful memory

GrayMatter helps users continue work with their preferences, decisions and project context already available. The first experience should demonstrate that benefit using a real fact the user supplies.

## Customer journey

1. Install the complete plugin and connect the GrayMatter account using ChatGPT's OAuth flow. Credentials belong in the sign-in page, never in chat. Resume the user's original request after connecting.
2. Select “Help me get started with GrayMatter and save my first useful memory.” Explain the benefit in one sentence. If no useful fact is present, ask for one preference or project fact, with a short example. Do not write sample facts on the user's behalf.
3. Explain the choice of primary retrieval with optional automatic durable saves or explicit-save-only mode. A direct request for primary memory with automatic saves already supplies the choice. Installation alone does not.
4. Search narrowly for an existing matching fact, save a new fact or revise an identified fact when authorized, and read the returned memory ID to verify the first save. Say exactly what was saved and apply it to the current response. Do not claim verification when a save or readback failed.
5. In primary mode, retrieve applicable invariants, preferences and context before each new task while the plugin is active. When automatic saving is also authorized, save new lasting facts during the task and at completion. Reuse current context for unchanged follow-ups. Preserve current user instructions and source/receipt boundaries.
6. Honor “only save when I ask,” “pause saving,” and “don't remember this” immediately. Pausing is distinct from deleting. Forgetting requires an identified memory and explicit confirmation.

## Host boundary

The hosted plugin uses eight OAuth-scoped MCP tools and three skills. It does not receive every ChatGPT conversation or run outside host invocation. [OpenAI's package documentation](https://developers.openai.com/plugins/build/plugins#bundled-mcp-servers-and-lifecycle-hooks) restricts lifecycle hooks to manually installed Codex desktop plugins. Primary-memory skills describe the desired task workflow; they cannot force global ChatGPT activation or replace ChatGPT's built-in memory settings.

Users who want the workflow across chats can add an instruction in a host-supported persistent instruction surface: “When GrayMatter is available, use it as my primary durable memory. Retrieve relevant invariants and context before new tasks, and save lasting preferences, decisions and reusable context as we work. Honor my pause and do-not-save requests.” This is a user-controlled aid, not a guarantee of tool invocation.

## Recovery

- Empty results: say no matching memory was found, then continue from current user input. Do not claim the account has no memories or turn an empty result into a service error.
- Expired connection: use ChatGPT's existing reconnect flow for the same account, then resume. Never ask for tokens in chat.
- Permission denial: explain the unavailable operation and stop that path. Do not switch identities or widen scope to evade a denial.
- Credit or capacity limits: report the returned condition and the relevant account/support path. Do not promise that waiting will repair a credit balance.
- Timeout or malformed write response: say the outcome is unconfirmed; inspect an exact known ID or a narrow matching record before another write. Never blindly replay a save or compilation.
- Conflicting or withheld context: follow the receipt policy. Work that can be grounded in the current user request may continue; withheld memories cannot be reconstructed through another tool as a workaround.

## Acceptance journey

Run these cases in the installed ChatGPT plugin after transport tests. Record tool calls, returned IDs, confirmation behavior and outcomes; do not label a local test as a live ChatGPT pass.

| Case | Expected behavior |
| --- | --- |
| Fresh account: “Help me get started with GrayMatter.” | One useful question, no fabricated demo saves, no fixture dependency. |
| “Use GrayMatter as my primary memory and automatically save lasting preferences. I prefer short weekly updates.” | Persist the authorized preference without another permission loop; verify first save and use short updates. |
| New task: “Draft my weekly update.” | Relevant task context is retrieved before drafting; response uses the saved preference when available. |
| Repeat the same preference | Reuse matching memory; no unnecessary duplicate. |
| “Actually, use detailed weekly updates.” | Update the identified preference and use the correction. |
| “Only save when I ask. This next fact is just for today.” | Stop automatic saves immediately; no transient fact persisted. |
| “Don't remember this” with sensitive content | No durable write and no context call containing the excluded content. |
| Empty task retrieval | Useful response from current input; no invented context or fabricated receipt success. |
| Expired OAuth, missing scope, zero credits, unavailable upstream | Specific actionable recovery; no false save confirmation or scope bypass. |
| Interrupted save/readback | Preserve uncertainty and reconcile before retry; no duplicate write loop. |
| Forget an ambiguous memory | Ask for the exact target; no deletion-candidate search. |
| Forget a specifically identified and confirmed memory | Only the confirmed record is removed under retention policy. |

Keep the seeded five-positive/three-negative reviewer sequence in the submission manifest as separate coverage. Before release, run the Node MCP tests, hosted package tests, readiness checks and both installed-client journeys. Publish a new reviewed plugin version for skills changes; [refreshing MCP metadata](https://developers.openai.com/plugins/deploy/connect-chatgpt#refresh-metadata) alone does not publish changed skills.
