# GrayMatter memory benchmarks

`run-memory-benchmarks.mjs` measures the deployed GrayMatter memory path rather than an in-process
mock. It starts this repository's MCP server, uses the installed client credential, writes bounded
session memories, runs tenant-scoped retrieval plus the default `get_context` call, records
evidence-session Recall@K, context latency, receipt presence, estimated prompt tokens, reliability,
and server-reported credits, and then forgets the benchmark memories unless `--keep` is supplied.

The public inputs are pinned to the official
[LoCoMo repository](https://github.com/snap-research/locomo) and
[LongMemEval cleaned dataset](https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned).
The Valkyr fixture is synthetic and covers workflow approval, artifact-bound deploy gates, KYC
human review, and superseded KYC status.

Run a reproducible smoke slice:

```bash
node benchmarks/run-memory-benchmarks.mjs --suite all --limit 3 --top-k 10 \
  --output artifacts/benchmarks/memory-benchmark-latest.json
```

Run a larger public slice with cached official datasets:

```bash
node benchmarks/run-memory-benchmarks.mjs --suite locomo,longmemeval --limit 25 --top-k 10
```

This harness is retrieval-and-context evaluation. It deliberately does not claim official LoCoMo
or LongMemEval answer accuracy because no answer model or official LLM judge is invoked. Dataset
revision, SHA-256, seed, case denominator, runtime revision, latency distribution, token estimate
method, credit evidence, and cleanup results are embedded in every output manifest.

To evaluate a **local JAR** without a hosted account, see [session retrieval
on LoCoMo](locomo-local/README.md). It compares two generated Lite builds
with independent BM25 on the same questions and includes a separately
reserved sample, the result files and per-question evidence rankings.

## Compare a raw store with compiled agent context

The [authentication latency experiment](auth-latency/README.md) times the
original and optimized generated Lite builds in two alternating runs,
including receipt freshness and authenticated-health controls.

For correction, deletion and concurrent writers, the [source lifecycle
comparison](source-lifecycle/README.md) runs five frozen scenarios through
the LangGraph JavaScript store and the generated Lite HTTP API. It checks the
persisted value and earlier receipts after each operation.

The optional store probe writes the same dated-window notes into the official LangGraph JavaScript `InMemoryStore` and a disposable GrayMatter Lite JVM on loopback. It sends the same query, source filter and result limit to both, then asks Lite to compile the selected context. Results show returned record keys and body sizes, Lite's answer policy and withheld references, and whether a larger budget recovers an exception at the end of a source. The fixture also includes two contradictory statements with and without an explicit marker and an unrelated marked source.

Run from the repository root with Java 21, Node.js 20+, npm, curl and OpenSSL. If you already have a Lite JAR, pass its path to the runner and skip generation and build.

```bash
./vaix generate
./vaix build
npm ci --prefix benchmarks/store-context-probe --ignore-scripts --no-audit --no-fund
benchmarks/store-context-probe/run.sh > store-context-results.json
```

The runner uses an in-memory H2 database and a random password. Each result file identifies the exact JAR and fixture by SHA-256. The LangGraph store runs with its default unindexed configuration, where `search` applies the metadata filter and count limit. Lite uses keyword ranking and its byte-based context budget. The probe measures these API responses. Framework applications can add their own retrieval, conflict and context policies. Agent answer quality, application task success and latency need separate evaluations. [LangGraph store reference](https://reference.langchain.com/javascript/langchain-langgraph/web/InMemoryStore) · [Fixture and HTTP calls](store-context-probe/probe.cjs)

### Score the six matched Lite decisions

The retrospective, hand-labeled oracle asks whether an agent may confidently answer this week's canary-window question. It uses all fixture sources in scope, including relevant contradictory notes below the delivery cut. Each of the six scenarios contributes one initial decision per JAR. A false permission counts against the four scenarios that require withholding. A false refusal counts against the two that permit an answer. The unindexed LangGraph search contributes a raw-record control and has no answer-policy score. [Policy labels and reasons](store-context-probe/policy-oracle.json)

Recompute the pinned scorecard from the repository root with Node.js 20+ and no package installation or server. To score a new matched pair produced by the same probe, append the two capture paths in before/after order.

```bash
node benchmarks/store-context-probe/score.cjs
```

| Measure | Initial | Below-cutoff marker check | Weekday clarification |
| --- | ---: | ---: | ---: |
| False permissions / cases that should withhold | 2/4 | 1/4 | 0/4 |
| False refusals / cases that should permit | 0/2 | 0/2 | 0/2 |
| Complete exception recovered on larger-budget retry / retry cases | 1/1 | 1/1 | 1/1 |

The first fix retained the lower-ranked marked Thursday source; the next
asked for clarification when two bare notes named different days for the
same schedule. All builds withheld the long source at 128 bytes and
recovered its exception at 4,096. These are six designed cases with an
oracle that assumes the user needs one answer for the week. [Initial](store-context-probe/observations/2026-11-06-before.json)
· [Marker check](store-context-probe/observations/2026-11-06-after.json)
· [Weekday clarification](store-context-probe/observations/2026-11-06-weekday-policy.json)

An [independent HTTP probe](store-context-probe/schedule-controls.cjs) tested
one required clarification and 17 compatible schedules, including different
subjects, environments, time intervals and explicit two-day recurrence. The
new compiler caught the ambiguous pair. It also requested clarification on
**1/17** compatible cases: an unversioned third note said the final decision
superseded the earlier day. The earlier compiler allowed all 17 and missed
the required clarification. If the two bare notes actually describe a recurring
schedule, exactly the same input causes an unnecessary clarification; that
alternate interpretation is scored separately. These cases do not estimate
answer accuracy in production. [Previous](store-context-probe/observations/2026-11-06-schedule-baseline.json)
· [Current](store-context-probe/observations/2026-11-06-schedule-current.json)

Reproduce the schedule controls with `node benchmarks/store-context-probe/schedule-controls.cjs /path/to/generated.jar`.
