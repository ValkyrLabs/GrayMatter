# Local session retrieval on LoCoMo

This benchmark measures how often GrayMatter Lite retrieves the dialogue sessions that LoCoMo's authors annotated as evidence for a question. It compares Lite's default offline HYBRID ranker with an independent Python BM25 implementation. Both receive the same question and search every session in the same conversation. [LoCoMo source at the pinned revision](https://github.com/snap-research/locomo/tree/3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376)

**Measured November 6, 2026.** The revised offline HYBRID ranker retrieved 88 of 136 annotated evidence sessions on the reserved slice. The original retrieved 62, and BM25 retrieved 88. The revised build ranks positive BM25 matches before subword-only matches when the local semantic provider uses feature hashing. The ranking rule was fixed before scoring the reserved questions. Each run indexed all 272 sessions.

| Question slice | Ranker | Evidence retrieved | Pooled Recall@3 | Mean query Recall@3 | Questions with any evidence | Questions with all evidence |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Initial | Original Lite | 80/130 | 61.54% | 66.73% | 72/100 | 61/100 |
| Initial | Revised Lite | 95/130 | 73.08% | 81.07% | 88/100 | 75/100 |
| Initial | BM25 | 95/130 | 73.08% | 81.07% | 88/100 | 75/100 |
| Reserved | Original Lite | 62/136 | 45.59% | 51.14% | 59/100 | 46/100 |
| Reserved | Revised Lite | 88/136 | 64.71% | 76.56% | 84/100 | 71/100 |
| Reserved | BM25 | 88/136 | 64.71% | 76.56% | 84/100 | 71/100 |

On the initial slice, the revision improved 18 questions, regressed on 4, and tied on 78. On the reserved slice it improved 31, regressed on 5, and tied on 64. The revised ranker retrieved the same number of annotated sessions as BM25 for each of the 200 questions. The JSON files contain each question's corpus index, evidence sessions, ranked results, and artifact digests. [Original initial](2026-11-06-generated-core.json) · [Revised initial](2026-11-06-ranked-initial.json) · [Original reserved](2026-11-06-original-reserved.json) · [Revised reserved](2026-11-06-ranked-reserved.json)

A [final rerun on the upgrade-compatible v3 distribution](2026-11-06-v3-reserved.json) returned the same ranked sessions on all 100 reserved questions. The policy changes preserved the measured retrieval result.

**Sampling.** Use all ten conversations. Exclude category 5 and questions with missing, malformed, or unresolvable evidence references. Within each conversation, order the eligible questions by the bytewise SHA-256 digest of the UTF-8 seed, conversation ID, and zero-based QA index, separated by null bytes. The seed is 20260826. The first ten questions form the initial slice, and the next ten form the reserved slice. The initial report recorded every reserved question index before running the second comparison. For each slice, both builds and BM25 received the same questions, candidates, and result cap.

**Inputs.** Each memory contains the session date followed by every turn's speaker and transcript text in the supplied order. Both rankers search these full texts with the constant record type `episodic`. Image payloads, answer text, QA evidence labels, and summaries do not enter the index. Each Lite write must round-trip the exact text and source channel. The runner sends the original question to the HTTP search endpoint with the conversation as a source filter, a limit of three, and the offline `feature-hash-384-v1` profile. The independent baseline uses BM25 with k1 = 1.2, b = 0.75, distinct query terms, Unicode letters and numbers, no stop-word list, and ascending numeric session ID for exact score ties. Lite resolves ties using its own runtime ordering.

**Scoring.** Collapse annotated turn references to distinct session IDs within each question. For a question, recall is the number of those sessions in the first three results divided by the number annotated. Mean query recall gives every question equal weight. Pooled recall adds retrieved evidence counts across questions and divides by the total annotated count, so questions with more evidence carry more weight. When a question has more than three annotated sessions, Recall@3 can only credit three. Paired comparisons count which ranker retrieved more annotated sessions on the same question.

**Run it.** Supply a generated runnable Lite JAR, Java 21, and the exact dataset bytes. The runner checks the dataset digest at startup and records the JAR and runner digests. It launches a fresh server with random local credentials, a private in-memory H2 database, an ephemeral loopback port, and the starter knowledge pack disabled. It exits on an ingest, scope, or query failure. Sessions stay in the temporary local process.

```sh
curl -fL -o /tmp/locomo10.json https://raw.githubusercontent.com/snap-research/locomo/3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376/data/locomo10.json
python3 benchmarks/locomo-local/run.py --jar /path/to/graymatter-local-server.jar --corpus /tmp/locomo10.json --sample initial --output /tmp/locomo-local-initial.json
python3 benchmarks/locomo-local/run.py --jar /path/to/graymatter-local-server.jar --corpus /tmp/locomo10.json --sample reserved --output /tmp/locomo-local-reserved.json
```

The observation is about retrieval of annotated sessions. Generating answers, judging their correctness, timing requests, and comparing hosted competitors require separate experiments.
