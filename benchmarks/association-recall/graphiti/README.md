# Native Graphiti association retrieval

This runs unmodified Graphiti retrieval against a real embedded FalkorDB database.
The benchmark supplies the synthetic graph and measures local retrieval.
It makes zero extraction, embedding, answer model or paid API calls.

The official source is pinned to commit
[`747b480ec6b12ecb718f1e2bc588b20ee36ea9c2`](https://github.com/getzep/graphiti/tree/747b480ec6b12ecb718f1e2bc588b20ee36ea9c2).
The launcher verifies all 166 upstream Python files. The observation hashes 146
loaded Graphiti/FalkorDB modules. Dependencies, the source archive and the private
libomp bottle are pinned in `dependencies.json` and `requirements.lock`.

`observed.json` contains all 14 existing frozen tasks, seven measured trials per
task after two warmups, and three real source/edge lifecycle mutations.
`matched.json` validates these results and places them alongside the existing
same-input Lite release capture. A second run from a newly acquired private
environment returned the same evidence and scores in all seven trials. See
`reproduction.json`. Four deliberately modified captures were rejected by the
checker (`tamper-checks.json`).

The native graph arm returned required answer evidence in seven of the nine tasks
that specify answer evidence. It recovered the useful query-free note, and also
returned the unrelated, metadata-only and weak-seed neighbors. Incoming and
second-hop evidence remained outside the configured outgoing depth-one search.
Both conflict labels produced the same selection. The results measure which
evidence was returned.

For `linked-detail`, the captured median was 17.06 ms for native keyword retrieval
and 20.00 ms including native graph traversal. Returned source bodies occupied
176 UTF-8 bytes. Graphiti timings include local database operations and exclude
setup. Lite's timings also cover authenticated HTTP, H2 persistence and receipt
compilation. The byte count measures returned Graphiti source bodies.
`maxRssBytes` measures the Python process alone. Redis uses its own configured
`maxmemory=256mb` limit.

## Exact mapping and boundary

The fixture remains at SHA-256
`c88f1c7ab95d897c7f00b3f284cb586338c39d364de226ec671a04f4038cf985`.
Source text becomes `EntityNode.summary`. Names are opaque `source_N` identifiers.
Free relation strings become `EntityEdge.name` and `fact`. Tags/type are preserved
as attributes, and source-channel boundaries map to graph `group_id` values.
Actual native model save/get/delete operations persist and inspect these rows.
This excludes automatic entity extraction and semantic link construction.

The control calls Graphiti's native `node_search` with BM25/RRF and `limit=1`.
Its returned seed is passed to native BFS/RRF with `bfs_max_depth=1`, `limit=8`.
The benchmark deduplicates their union. Graphiti internally requests up to 2
and 16 candidates respectively. The fixture is smaller than those limits. This
configuration uses deterministic RRF and the native candidate rules.

Fresh source reads reflect actual correction and deletion. Deleting the edge
removes graph expansion. Retained client snapshots remain historical client data.
The lifecycle observations cover these operations on the local instance. Source
groups implement the fixture's scope. Authenticated ACLs and token budgets are
outside this API comparison. The observation records the requested Lite byte
budget alongside returned Graphiti source bytes.

## Reproduce on macOS ARM64

Use CPython 3.12, macOS 26+, an available compatible libexpat directory and a fresh
temporary directory for each command. Preparation downloads only public pinned
artifacts, creates a private virtual environment and unpacks libomp privately.
The existing host Python needed its Homebrew libexpat directory explicitly because
its default system library lacked a required symbol.

```sh
python3.12 -B benchmarks/association-recall/graphiti/prepare.py \
  --output-dir /private/tmp/graphiti-prepared-NEW \
  --expat-dir /opt/homebrew/opt/expat/lib

python3 -B benchmarks/association-recall/graphiti/launch.py \
  --python /private/tmp/graphiti-prepared-NEW/venv/bin/python \
  --source-dir /private/tmp/graphiti-prepared-NEW/graphiti-747b480ec6b12ecb718f1e2bc588b20ee36ea9c2 \
  --lib-dir /private/tmp/graphiti-prepared-NEW/native-libs/libomp/23.1.5/lib \
  --expat-dir /opt/homebrew/opt/expat/lib \
  --output-dir /private/tmp/graphiti-results-NEW

python3 -B benchmarks/association-recall/graphiti/check.py \
  /private/tmp/graphiti-results-NEW/observed.json \
  --output /private/tmp/graphiti-results-NEW/matched.json
```

The final runtime denies all IP networking, permits Unix sockets only beneath its
fresh scratch root, inherits no API credentials and disables telemetry. Before
starting the database it requires a TEST-NET TCP connection to fail with EPERM.
The runner shuts down the database after the run. The preparation phase needs
network access. A surrounding sandbox may need to authorize the nested sandbox
launcher.

An initial unconstrained install selected OpenAI 3, whose HTTP dependency no longer
satisfied Graphiti's `httpx` import. The successful environment pins OpenAI, httpx,
FalkorDB and Redis to versions from the official Graphiti lock. The complete final
environment is hash-pinned.

The inherited broad loopback profile unexpectedly allowed an external TCP connect
in a separate preflight. The final benchmark uses the Unix-only profile and live
denial gate. The older Lite observation used the earlier profile, so its network
containment remains unverified. The preflight probe sent zero application bytes.
