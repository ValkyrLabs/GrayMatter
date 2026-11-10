# Matched dispatch task

This experiment runs real Lite, Graphiti and Hindsight retrieval on twelve new synthetic dispatch populations, then executes the same local consumer on each returned evidence set. The consumer produces a dispatch packet containing the shipment ID, pickup code, gate and packing symbol, with a source citation for each field. It abstains on incomplete, conflicting, malformed or withheld evidence. An independent SQLite judge reconciles the complete authorized input and checks the exact packet, checksum and citations.

| Native retrieval | Control correct | Association arm correct | Incorrect conflict actions, control → association |
| --- | ---: | ---: | ---: |
| GrayMatter Lite `a059d353` | 6/12 | 10/12 | 2 → 0 |
| Graphiti `747b480e` | 6/12 | 12/12 | 2 → 0 |
| Hindsight `eb963cb5` | 12/12 | 12/12 | 0 → 0 |

Lite's association arm supplied the two complementary partial-query facts and withheld the two disputed packets. Its two remaining misses were useful query-free packing details. Graphiti's supplied outgoing graph recovered those details. Hindsight's semantic recall already returned all necessary facts; native graph retrieval added zero candidates on every measured trial. There is no Hindsight graph benefit in this result.

The November 7 offline Graphiti rerun reproduced all 168 arm and trial decisions, packets, citations and selected source sets. The original Lite and Hindsight captures stayed fixed. Graphiti again scored 6/12 with keyword recall and 12/12 with the supplied graph. The linked arm produced zero unsupported actions. [Reproduction verification](observations/graphiti-reproduction-20261107.json)

Eight assigned tasks require a complete packet; four require abstention. Every product/arm produced the same decision, packet and citations across seven measured trials after two warmups. Those repetitions are twelve task populations, not 84 independent accuracy samples. The six scenarios are direct evidence, linked partial-query detail, query-free detail, an unrelated consignment, conflicting facts with a free `supersedes` label, and an excluded source channel. Each has two distinct populations.

The [protocol](protocol.json), [corpus](fixture.json), [consumer](consumer.py), [SQLite judge](judge.py), adapters and scorer were hash-frozen in [freeze.json](freeze.json) before the first native execution. The scenarios were designed around previously observed retrieval boundaries; this is not a blind selection of tasks. New literal shipment IDs and values were generated independently of native results. No expected answers, corpus, product name or association labels are passed to the consumer.

The experiment measures a closed-schema evidence-to-packet computation. The consumer is deliberately a parser and validator, not an LLM. It executes after native evidence capture, so the reported sum of retrieval and consumer times is arithmetic rather than a measured live end-to-end duration. It does not launch a Valkyr workflow, promote a SkillOptics procedure, deliver a real parcel, or establish general answer quality. Task facts are trusted supplied records. Group/bank/channel separation is tested; hosted authentication and general ACL equivalence are not.

All consumers receive the same 1,024 UTF-8-byte ceiling and at most sixteen source records. Overflow causes abstention without clipping. The largest measured evidence set was 464 bytes, so this experiment does not test saturation. The native systems retain their documented settings from the prior probes: Lite authenticated keyword `topK=1`, with or without associations; Graphiti native BM25/RRF `limit=1` plus optional outgoing BFS/RRF depth one `limit=8`; Hindsight native LOW budget, BGE-small ONNX CPU embeddings, raw-chunk retention, RRF and optional graph recall. Native candidate budgets and tokenizer units differ. Graphiti uses directed supplied edges, while Hindsight uses shared opaque entities for undirected endpoint pairs. No query, model or retrieval setting changed after results became available.

The [summary](summary.json) retains task decisions and diagnostic timing. Across all assigned measured trials, median retrieval times were Lite 9.10 → 10.17 ms, Graphiti 0.47 → 1.00 ms, and Hindsight 8.16 → 11.16 ms. Each consumer median was below 0.012 ms. These are local fixed-order observations with different model, storage, transport and receipt responsibilities; they do not establish a causal speed ranking. Graphiti's graph timing includes its preceding keyword search. Startup, ingestion, judge work, credits and operational cost are excluded. No answer-model tokens were used.

Runs used the existing private pinned installations from the [Graphiti](../graphiti/README.md) and [Hindsight](../hindsight/README.md) probes and the actual Lite distribution JAR. The launcher verified 166 Graphiti and 376 Hindsight source files before and after execution. Captures record 146 and 192 loaded source modules, and all 37 and 87 pinned package versions match. Hindsight used the same pinned BGE model and PostgreSQL/pgvector files. Lite ran on OpenJDK 17.0.20 with a 512 MB maximum heap. Graphiti's Redis memory setting was 256 MB; Hindsight PostgreSQL shared buffers were 32 MB. These settings are not equivalent process-wide memory limits.

Competitor runtimes denied all IP networking and allowed only fresh-directory Unix sockets; both required a TEST-NET connection to fail with EPERM before database startup. Lite used the existing directional localhost-only TCP sandbox and fresh authenticated H2 data. Logs retain normal database shutdown; no new dependency, paid API, host service or customer data was used. The first nested sandbox launch was refused by the host. The first Lite attempt failed before Java startup because macOS Python lacked `hashlib.file_digest`. The [launcher amendment](launcher-amendment.json) selects the invoking Python and preserves both failures. The frozen task, retrieval adapters, consumer and judge did not change.

Recheck the stored native captures and all 504 recorded task decisions:

```sh
python3 -B benchmarks/association-recall/dispatch-task/test_contract.py
python3 -B benchmarks/association-recall/dispatch-task/check.py
python3 -B benchmarks/association-recall/dispatch-task/test_capture_controls.py
```

The five capture controls reject altered body text, native source identity, package version, loaded upstream source hash and an out-of-scope record. Five consumer/judge tests additionally cover unseen values, duplicate and unknown fields, policy withholding, budget overflow, missing facts, wrong citations and a changed packet. [Recorded rejection controls](observations/tamper-controls.json) and [runtime qualification](observations/runtime-qualification.json) are retained beside the raw captures, logs and scored packets.

To rerun, first prepare private installations using the prior probe instructions. Use fresh temporary output directories. Preparation may download public pinned artifacts; this experiment's runtime needs no network access beyond local IPC. Python 3.11 or later is required for the outer launcher and scorer.

```sh
python3 -B benchmarks/association-recall/dispatch-task/launch.py graphiti \
  --setup /private/tmp/graphiti-prepared-NEW \
  --output-dir /private/tmp/dispatch-graphiti-NEW
python3 -B benchmarks/association-recall/dispatch-task/launch.py hindsight \
  --setup /private/tmp/hindsight-prepared-NEW \
  --output-dir /private/tmp/dispatch-hindsight-NEW
python3 -B benchmarks/association-recall/dispatch-task/launch.py lite \
  --jar .vaix/verification/association-recall/graymatter-local-server-a059d353.jar \
  --java /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home/bin/java \
  --output-dir /private/tmp/dispatch-lite-NEW
python3 -B benchmarks/association-recall/dispatch-task/score.py \
  /private/tmp/dispatch-lite-NEW/observed.json \
  /private/tmp/dispatch-graphiti-NEW/observed.json \
  /private/tmp/dispatch-hindsight-NEW/observed.json \
  --output /private/tmp/dispatch-scores-NEW.json
```
