# Local receipt-inspection latency

This probe times `GET /v1/graymatter-retrieval-receipts/{id}` on the actual v3 and v4 Lite JARs. It measures a successful, current receipt that contains one source pointer. V4 also checks the revisions and membership of the owner's candidates within the original filters.

## Measured observations

Each cell shows **p50 / p95 in milliseconds**, from 48 sequential measurements of that route. The narrow and wide receipts retain exactly one pointer each even when their eligible source counts differ.

| Build | Owner rows | Narrow receipt (8 eligible) | Wide receipt (all eligible) | Health with Basic | Health anonymously |
|---|---:|---:|---:|---:|---:|
| v3 | 8 | 132.8 / 288.7 | 123.4 / 308.3 | 124.5 / 347.1 | 5.8 / 13.3 |
| v4 | 8 | 82.2 / 123.6 | 83.0 / 176.1 | 79.6 / 112.4 | 3.4 / 6.5 |
| v3 | 1,024 | 93.6 / 130.3 | 95.7 / 149.4 | 95.1 / 129.1 | 3.6 / 10.0 |
| v4 | 1,024 | 106.7 / 441.8 | 103.2 / 243.1 | 100.0 / 215.1 | 3.6 / 17.1 |

At 1,024 rows the v4 median difference between authenticated and anonymous health, paired within measurement cycle, was **94.9 ms**. The same paired comparison of receipt inspection against authenticated health was **5.8 ms** for both narrow and wide scopes. Basic authentication dominated typical end-to-end latency here. Lite verifies the password with BCrypt and looks up the principal. The paired control measures these steps together with any other work introduced by authenticating that health request.

The v4 narrow scope still visits metadata for the owner's 1,024 rows while only 8 contribute to its fingerprint. The v4 narrow receipt reached **441.8 ms at p95** in this run. The two builds ran sequentially, v3 first, on a shared Apple M4 Pro while other local test JVMs were active. The authenticated control also moved materially between stages. These observations do not isolate the scan's CPU cost or establish a version-induced change in tail latency. There was one JVM per build, one owner, one warm in-memory database per JVM, one pointer per receipt, and one measured request in flight. Concurrent clients, disk-backed storage, larger corpora, stale receipts, and hosted OAuth were outside this measurement.

## Fixture and timing

Each JAR ran in its own JVM on loopback, with an empty in-memory H2 database, starter packs disabled, feature-hash embeddings, and a temporary random Basic password. The runner writes 8 entries through the memory API, measures that stage, then writes enough entries to reach 1,024 and measures again. At each stage it compiles two `KEYWORD` receipts with `topK=1`, the same source and type, and different tag filters. The narrow tag matches the first 8 entries. The wide tag matches every entry. Only the first row contains the query terms. Each compiled receipt must select precisely that row. Every timed receipt read must return the requested ID, the expected policy version, one source, and a current `ALLOW_ANSWER` decision.

The Node client issues one request at a time during measurement. It measures through receipt of the entire HTTP body with a monotonic clock. JSON parsing and assertions occur after timing. Each stage alternates the two receipt GETs and two control GETs in rotating order. There are 12 unrecorded warmups and 48 measured requests **per route per stage**. Both controls call `/actuator/health`, once with the same Basic credentials used for receipt inspection, once anonymously. A bad Basic password must return 401 on that same route. HTTP timing includes connection handling, authentication, routing, SQL, serialization and response transfer. It excludes startup, writes and compilation. `p50` and `p95` use nearest rank.

## Reproduce

Use Node 20 or later and a Java runtime compatible with the pinned JARs. `JAVA` can select an absolute Java executable. Run the builds sequentially on the same machine. The runner rejects artifacts whose SHA-256 differs from `fixture.json`. It accepts local JAR paths and always starts its own loopback server.

```sh
cd benchmarks/source-lifecycle/latency
node probe.cjs v3 /absolute/path/to/graymatter-local-server-825fb4dc.jar > /tmp/graymatter-v3-latency.json
node probe.cjs v4 /absolute/path/to/final/graymatter-local-server.jar > /tmp/graymatter-v4-latency.json
node check.cjs /tmp/graymatter-v3-latency.json /tmp/graymatter-v4-latency.json
node check.cjs
shasum -a 256 -c SHA256SUMS
```

`v3.json` and `v4.json` contain every measured elapsed time in microseconds, grouped by route and ordered by cycle. They include the fixture, runner and artifact digests, software versions and UTC timestamps. `check.cjs` verifies the checked-in observations against the fixture and recomputes all published percentiles. Reruns produce new observations.
