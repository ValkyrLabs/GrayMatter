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
