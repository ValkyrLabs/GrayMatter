# Matched local LangGraph association slice

The official JavaScript `@langchain/langgraph-checkpoint@1.2.2` ran successfully
with all networking denied. The independent checker verified native scores,
returned text, source filters, application traversal and three lifecycle changes
over all 14 previously frozen association cases. The [matched table](matched.json)
places those observations beside the existing generated Lite `a059d353…` capture.
It does not rank the products.

The [protocol](protocol.json) was frozen at SHA-256
`ed56d37780998b21f3e33751c5f7b2ea760021f031459736fa15950a5197258e`
before executing this SDK run. It reuses the exact source bodies, tags, labels,
direction, queries and source filters from the original fixture, whose hash is
`c88f1c7a…`. The Lite observation is pinned independently; it was not rerun here.
The [raw observation](observed.json) contains every result, traversal API trace,
measured repetition and hashes of all 500 loaded dependency files.

## What was actually exercised

LangGraph documents JSON records, namespace/key storage, metadata filters and
optional vector search. The test uses those real APIs in the installed package.
Its vector provider is an explicitly test-supplied, deterministic term-frequency
encoder: lowercase ASCII words, no stemming or stopwords, 162 dimensions drawn
from the input bodies and queries. Labels, tags and the expected answer are not
encoder inputs. There is no learned embedding or answer model. Native cosine
scores are checked independently in Python. [Official memory documentation](https://docs.langchain.com/oss/javascript/concepts/memory)
and [official store reference](https://reference.langchain.com/javascript/langchain-langgraph/web/InMemoryStore).

Three separate arms make the boundary visible:

| Arm | Actual operation |
| --- | --- |
| Native topK | Indexed `store.search`, original query/filter, limit one. |
| Native wider search | The same API with limit nine; this is a larger retrieval budget. |
| Application one-hop | Benchmark code takes positive-score native seeds, searches separately stored JSON edges by `fromId`, then `get`s their targets. It preserves the source filter, deduplicates, and follows outgoing edges once. |

The application adapter is **not an upstream graph-recall feature**. It does not
interpret relation labels, infer trust, detect contradictions or manufacture a
receipt. The same adapter can follow useful query-free text and irrelevant text;
those are both reported. Namespace selection is application input, not proof of
authentication or ACL enforcement. No access-revocation comparison is made.

## Observations and limits

* The linked-detail case returned the anchor alone with native topK, all three
  source records with wider native search, and the anchor plus linked answer with
  application traversal. Lite's opt-in capture returned the same two sources.
* The application traversal recovered the query-free packing note. Lite omitted
  it under its frozen independent-relevance requirement. Wider native search also
  returned it. This is evidence availability, not an evaluated generated answer.
* Reverse links were not followed, the two-hop target was not reached, and the
  reciprocal edge did not cause repeated traversal. These are adapter limits.
  The `related` and `supersedes` variants selected the same SDK records.
* Native search returned zero-score records when its requested limit allowed
  them. The adapter's positive seed threshold is application policy. Native
  policy/abstention fields are recorded as null; Lite's withholding outcomes are
  shown without assigning an SDK failure rate.
* Actual native `put`/`delete` changed subsequent exact reads. Deleting the source
  left its separately stored edge present. A retained live `get` object reflected
  a replacement `put`; an explicitly detached JSON snapshot remained unchanged.
  No SDK receipt API or application receipt policy was exercised.

The original Lite budget is retained as a reference, because this native SDK
search has no corresponding token-budget argument. Returned body UTF-8 bytes
exclude Lite's provenance formatting and are not model tokens. Timing includes
in-process SDK/adapter work after two warmups, seven repetitions, a 512 MiB Node
heap limit and no network. Lite's recorded HTTP/H2 timings are a different cost
boundary; do not compare them as latency or efficiency rankings. The in-memory
store is not a persistent deployment. No restart, hosted service, access-control,
embedding-quality or generated-answer claim follows from this slice.

The local dependency/cache inspection found this runnable pinned SDK. The
Hindsight scratch contained only source/test excerpts, and the inspected Python
package caches had no Mem0, Graphiti or Hindsight runtime. This is an environment
availability result, not a claim that those products cannot run locally. No new
dependencies or competing service were installed.

## Reproduce

The dependency lock already used by `benchmarks/store-context-probe` pins the
official package and its registry integrity. If dependencies are absent, install
that existing lock before the offline run; the following command installs no
packages. Use macOS with `sandbox-exec` and Node supporting built-in fetch. Run
from the GrayMatter root, selecting a **new** output path:

```sh
env -i PATH=/opt/homebrew/bin:/usr/bin:/bin \
  /usr/bin/sandbox-exec -f benchmarks/association-recall/langgraph/offline.sb \
  node --max-old-space-size=512 benchmarks/association-recall/langgraph/run.cjs \
  /private/tmp/langgraph-association-new.json
/usr/bin/python3 -B benchmarks/association-recall/langgraph/check.py \
  /private/tmp/langgraph-association-new.json --output /private/tmp/langgraph-matched-new.json
```

Both commands refuse to overwrite observations. Runtime timing and timestamps
will vary; fixture hashes, native score calculations, source selections and
API boundaries must validate. The runner pins its protocol and existing Lite
capture. The checker also validates the actual loaded SDK bytes against the
current installation. Source/runtime changes require a separately labeled run.
