# GrayMatter multi-agent conventions

Use shared GrayMatter as the durable coordination layer, not Discord chatter.

## Identity

Give every agent a stable identity.

Recommended examples:
- `valor`
- `patchbot`
- `scribebot`
- `salesbot`
- `sentrybot`

Use that identity consistently in:
- agent/system instructions
- `sourceChannel` when appropriate
- durable handoff text
- graph ownership fields

## Memory types

Use `MemoryEntry.type` intentionally:
- `decision` for durable choices
- `todo` for actionable follow-up
- `context` for reusable facts
- `artifact` for durable output references
- `preference` for stable preferences

## Write style

Prefer small durable facts over giant blobs.

Good:
- `decision`: "Use GrayMatter as the shared memory layer for Valor and PatchBot"
- `todo`: "PatchBot to add CI validation for graymatter.skill packaging"
- `artifact`: "README updated with customer-ready GrayMatter setup recipe"

Bad:
- huge transcript dumps
- vague entries like "worked on the thing"
- repeated noisy status spam

## Handoffs

When handing off work between agents:
- write one durable `context` or `decision` entry with the exact state
- include owner, task, and next action in the text
- keep chat discussion secondary

## Tags

If backend tag persistence is working, use stable normalized tags like:
- `graymatter`
- `launch`
- `patchbot`
- `customer-setup`

If tagged writes fail, rely on untagged durable text first.
