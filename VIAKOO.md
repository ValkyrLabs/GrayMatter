# GM Agent Memory — Viakoo internal

Viakoo's internal fork of GrayMatter, used as the durable agent-memory backend for the
Adapter Generator and other agents. This note covers what differs from upstream and how to
run it against Viakoo's Postgres.

## What this fork adds over upstream GrayMatter

- **Postgres datasource support** — the local server can run on Postgres/Citus instead of the
  embedded H2 (`feat(local-server): support a Postgres datasource`).
- **Receipt-policy and retrieval fixes** — the MCP server recognises the local server's
  `bifrost-lite-context/v1` answer-policy vocabulary, and the context compressor has better
  excerpt windowing, ranking, and sufficiency reporting.
- Local in-progress changes carried over from the working checkout (delete endpoint, LM Studio
  embedding service, hybrid search, memory-scan, docs).

## Backend: Postgres / Citus

The datasource is configured entirely by environment variables; the default remains H2 so
nothing breaks without them. To point the server at Postgres, set:

```sh
export GRAYMATTER_DB_DRIVER=org.postgresql.Driver
export GRAYMATTER_DB_URL='jdbc:postgresql://<HOST>:5432/<DATABASE>'   # e.g. citus-c.cloud.viakoo.com:5432/gm-agent-memory
export GRAYMATTER_DB_USERNAME='<USER>'
export GRAYMATTER_DB_PASSWORD='<PASSWORD>'   # keep out of git; use a secret store or an env file (mode 600)
```

Notes:

- The PostgreSQL JDBC driver is bundled in the built jar; no extra step is needed.
- `spring.jpa.hibernate.ddl-auto=update`, so **the first boot against an empty database creates
  the schema automatically** — and also seeds a small starter knowledge pack. Clear that seed
  before importing real data if you are migrating.
- Embeddings come from the configured provider (LM Studio `text-embedding-nomic-embed-text-v1.5`
  by default). After loading or changing data, rebuild the vector index with
  `POST /v1/memory/reindex`.
- The tables are created as plain (Citus-local) tables on the coordinator, not distributed. If
  distribution is wanted, run `create_distributed_table(...)` out of band after the schema exists.

## Build and test

```sh
# MCP server (Node 20+)
cd mcp-server && node --test test/*.test.js

# Local server (Java 17+, Maven)
cd templates/graymatter-light-bootstrap/local-server && mvn test
```

The repo's `./vaix` wraps generate/build/test for the full staged bundle; see the top-level
`README.md`.

## Migrating memories between backends

Memory ids and timestamps are primary keys that other memories reference, so a migration must
preserve them. Copy `principal`, `knowledge_pack`, `user_preferences` and `memory_entry` (in
that FK order) with a JDBC copy that keeps every column value, then `POST /v1/memory/reindex` to
rebuild `memory_search_index`. The `memory_retrieval_receipt*` tables are transient and need not
be migrated.
