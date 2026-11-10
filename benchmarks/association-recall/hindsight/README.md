# Native Hindsight recall

This runs Hindsight's unmodified `MemoryEngine` against a private PostgreSQL
database with a real local embedding model. All 14 frozen association tasks and
three native curation controls completed. A fresh environment reproduced every
measured selection and native semantic/keyword score across seven trials per arm.

Hindsight is pinned to official commit
[`eb963cb5a929d92c081371df64c2d5c2fe3351af`](https://github.com/vectorize-io/hindsight/tree/eb963cb5a929d92c081371df64c2d5c2fe3351af),
version 1.2.0. The run verifies 376 source files and records hashes for 193 loaded
upstream modules. It uses PostgreSQL 18.1, pgvector 0.8.5, 87 pinned Python
packages, and BAAI/bge-small-en-v1.5 ONNX revision
`5c38ec7c405ec4b44b94cc5a9bb96e735b38267a` on one CPU thread.

`LLM_PROVIDER=none` is Hindsight's documented raw-chunk retention mode.
`RERANKER_PROVIDER=rrf` keeps native merged ranking without a reranker model.
The embedder uses the published BGE CLS pooling, normalization and query prefix.
The run made zero extraction, answer model or hosted inference calls. It
exercises native library entry points and migrations. File parsing and hosted
authentication are outside the test.

## What the run observed

Both arms returned identical evidence on all 14 tasks. Every in-bank fixture row
cleared Hindsight's default semantic floor, so the graph arm added zero candidates.
This includes the useful query-free note, unrelated and metadata-only neighbors,
conflicting sources, incoming evidence and second-hop evidence. Native semantic
and keyword recall returned those sources and excluded the separate source bank.

For `linked-detail`, Hindsight returned `anchor`, `answer` and `unlinked` in both
arms. The existing Lite capture returned `anchor` by default and `anchor, answer`
with associations enabled. `matched.json` provides each task's source selections,
answer-evidence presence and the original Lite status.

The separate calibration supplies twenty duplicate high-similarity seeds plus the
original answer, all sharing one entity. The answer had native semantic rank 21.
Enabling graph recall produced one graph candidate and moved it from final rank
21 to rank 1. Both arms already returned all 21 rows. The calibration measures
ranking on duplicate seeds. See `calibration.json` and its launch and log files.

Actual source correction changed the exact native source read. Deletion removed
the current anchor, and `entities=[]` detached its entity set. Subsequent recall
used current data. Previously captured responses remained historical client
snapshots. Receipt refresh and owner revocation are outside this comparison.

## Mapping and measurement limits

The fixture remains SHA-256
`c88f1c7ab95d897c7f00b3f284cb586338c39d364de226ec671a04f4038cf985`.
Texts, queries and tags are unchanged. Each case/source channel has its own bank.
Relations become shared opaque entities through supported retain inputs with
`resolve_entities=false`. One entity represents each unordered endpoint pair.
Original directed edges and exact labels remain in metadata. The graph follows
undirected Hindsight entity co-occurrence. Native retention may also create
semantic and temporal links. The run records stored entities and links through
the native API.

Both arms use the native LOW budget of up to 100 candidates per retrieval arm
and 20 graph seeds. Semantic and graph thresholds remain 0.3. Temporal retrieval is
disabled because the supplied tasks contain no temporal constraint. Graph enablement
is the only difference between the two arms. Lite used keyword `topK=1`.

Hindsight's native tokenizer receives the fixture's numerical budget, 1024 or 128.
Lite interprets its budget as a conservative byte ceiling. The long-budget task
used 49 Hindsight tokens and fitted its 128-token limit. The observation records
each budget in its native unit.

Timings cover native recall after setup and exclude bank-configuration updates.
Two warmups precede seven measured trials, always control then treatment. Fixed
order, caches, model work and different transport/persistence responsibilities
prevent a causal speed comparison. Raw timings are retained as diagnostics.
The final Python peak RSS was 592,625,664 bytes. PostgreSQL is a separate process
configured with 32 MB shared buffers.

## Reproduce

Use macOS ARM64 and CPython 3.12 with the pinned host libexpat/OpenSSL libraries
listed in `dependencies.json`. Preparation creates only temporary files and a
private virtual environment. Preparation extracts PostgreSQL and pgvector from
verified embedded archives in the public pg0 wheel. The launcher starts the
database inside the scratch directory.

```sh
DYLD_LIBRARY_PATH=/opt/homebrew/opt/expat/lib python3.12 -B \
  benchmarks/association-recall/hindsight/prepare.py \
  --output-dir /private/tmp/hindsight-prepared-NEW

python3 -B benchmarks/association-recall/hindsight/launch.py \
  --setup /private/tmp/hindsight-prepared-NEW \
  --output-dir /private/tmp/hindsight-results-NEW

python3 -B benchmarks/association-recall/hindsight/check.py \
  /private/tmp/hindsight-results-NEW/observed.json \
  --output /private/tmp/hindsight-results-NEW/matched.json

python3 -B benchmarks/association-recall/hindsight/launch.py \
  --setup /private/tmp/hindsight-prepared-NEW \
  --output-dir /private/tmp/hindsight-calibration-NEW --calibration
```

Preparation downloads public pinned artifacts. `--artifact-cache` can reuse an
earlier isolated setup after hash verification. The recorded fresh-environment
reproduction used this option. Runtime denies all IP networking and permits Unix
sockets only inside its fresh output directory. Before database startup it requires
a TEST-NET connection to fail with EPERM. No API credentials are inherited. The
database is stopped after each run. A surrounding sandbox may require authorization
for the nested sandbox launcher.

`check.py` verifies source/model/package provenance, exact retained bodies and
metadata, result identities, budgets, all seven selections and lifecycle results.
The checker rejected five modified captures covering body, relation metadata,
source hash, dependency version and selected ID. The earlier Lite profile allowed
an external TCP connection in a later probe. This Hindsight run uses the tested
Unix-only policy.
