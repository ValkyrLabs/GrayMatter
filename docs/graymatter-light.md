# GrayMatter Light

## Intent

GrayMatter Light is the offline/local version of GrayMatter.

It exists for:
- demos
- local development
- resilient fallback
- easy experimentation with durable memory before wiring into api-0

## Scope for v1

Keep it intentionally small.

Include:
- minimal `MemoryEntry` schema
- create
- get by id
- basic query
- optional update

Do not include in v1:
- full graph operations
- wide entity surface
- complex auth
- production-only integrations

## Proposed model

```yaml
MemoryEntry:
  type: object
  properties:
    id:
      type: string
      format: uuid
    type:
      type: string
    text:
      type: string
    sourceChannel:
      type: string
    createdDate:
      type: string
      format: date-time
    modifiedDate:
      type: string
      format: date-time
```

## Why ThorAPI

ThorAPI gives Light mode:
- a schema-driven contract
- code generation alignment with the main platform style
- easier migration from local mode to cloud mode
- fewer hand-rolled one-off decisions

## Suggested delivery shape

Phase 1:
- document the concept clearly
- include a starter ThorAPI bundle/spec example

Phase 2:
- provide a tiny runnable local service
- add sample data and smoke-test commands

Phase 3:
- align payloads and migration paths with production GrayMatter

## Ideal developer experience

A developer should be able to:
1. clone the repo
2. start GrayMatter Light locally
3. write a decision or todo
4. query it back
5. later switch to Cloud mode with minimal changes to payload shape and workflow

## Recommendation

Yes, we should build this.
It is the right low-friction entry point and makes GrayMatter easier to explain, test, and trust.
