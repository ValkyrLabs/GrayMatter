# Source correction and deletion

This probe exercises the published JavaScript `@langchain/langgraph-checkpoint@1.2.2` `InMemoryStore` and a local GrayMatter Lite JAR. Both receive the same synthetic text, source channel, tags, read order and intended edits. The frozen fixture covers five scenarios. Its SHA-256 is `2e756dea797d42b826c65eaca0ce54d7189434dfef620c9091556c78cc5f1c1a`. [Fixture and expected behavior](fixture.json)

## Observed on November 6, 2026

The pre-change generated Lite JAR returned HTTP 404 for both private lifecycle actions. Its original source stayed present, so its original receipt still permitted hydration. This distinguishes an unavailable mutation from a successful mutation followed by stale retrieval. [Baseline capture](observations/2026-11-06-before.json)

The updated generated Lite JAR performed both mutations. Both captures used the same fixture, driver, SDK and Node version. The JAR hashes begin with `825fb4dc` (before) and `f6c076b0` (after). [Updated capture](observations/2026-11-06-after.json)

The private MCP run also checked the exact corrected record, a stale retry,
the newly discovered dispute and its linked receipt, and a confirmed deletion.
On a file-backed v3 database, an old approval stayed available for audit
while v4 blocked hydration. After a restart, a new dispute made a v4 approval
stale. [MCP result](observations/2026-11-06-private-mcp.json)
· [Database upgrade result](observations/2026-11-06-v3-v4-upgrade.json)
· [Receipt inspection latency](latency/README.md)

| Operation | LangGraph in-memory store | Updated Lite |
| --- | --- | --- |
| Correct or delete one source | Exact GET and scoped search immediately reflected each operation. | Exact GET and scoped search immediately reflected each operation. |
| Write or delete from a stale read | The delayed native operation resolved. The persisted record showed the late edit or deletion. | Both delayed operations returned 412. The first correction survived. |
| Submit two corrections from the same read | Both puts resolved. A subsequent get returned the last stored value. | One correction succeeded and one returned 412. A subsequent get returned the accepted value. |
| Restore identical content, then use the first client’s observation | The late put resolved. | The restored source had a new fingerprint. The late write returned 412 and its original receipt still withheld context. |
| Reread context after a source changed | The caller retained the original item it previously read. | Previously delivered text stayed in caller memory. Fresh hydration and recompression through the old receipt withheld text from both sources. A separate receipt for the unchanged neighbor remained usable. |

## Run

Use Node with built-in `fetch`, Java 21, and the existing benchmark dependency lock. The launcher creates a fresh in-memory H2 database and a random local password, binds an ephemeral port on 127.0.0.1, and terminates the server after the probe. Each invocation also creates fresh in-memory stores. From the GrayMatter checkout, run

```sh
npm ci --prefix benchmarks/store-context-probe --ignore-scripts --no-audit --no-fund
benchmarks/source-lifecycle/run.sh before /path/to/pre-lifecycle.jar > before.json
benchmarks/source-lifecycle/run.sh after /path/to/lifecycle.jar > after.json
node benchmarks/source-lifecycle/check.cjs before.json after.json
```

The build argument selects the expected outcome for regression checks. It never changes the operations sent to either implementation. The program emits observed results and returns a nonzero exit status when an expected behavior differs. Each report records the actual JAR, driver and fixture hashes. [HTTP and SDK operations](probe.cjs) · [Assertions](check.cjs)

## What each surface does

* **Source records.** The SDK puts a value at a namespace and key, gets the same key, searches within the namespace with a source-channel filter, and deletes the key. Lite uses its assigned source UUID, exact GET, keyword search filtered to the same channel, and the authenticated `revise` and `forget` actions. The Lite client submits the fingerprint from its previous read. On the older JAR that lacked the fingerprint on direct GET, the client obtains the same source’s fingerprint from ranked search. Both sides retain the original exact-read response in client memory and inspect it after the mutations.
* **Late writers.** Two observations are captured before the first write. The delayed client then submits either an edit or deletion using the SDK’s ordinary key operation or Lite’s native expected-fingerprint operation. The separate race issues both writes before awaiting either result. Which request runs first can vary. The restoration case changes A to B and back to identical A text before the delayed client tries again.
* **Prior receipts.** Lite issues a receipt over both sources and a separate receipt filtered to the unchanged neighbor. After each mutation the probe rereads receipt status, tries hydration, and requests a recompressed child. Denied responses must disclose no fixture text. The `null` receipt observations on the SDK side mean this driver exercised its native record API only. Application-level receipt policies and other LangGraph deployments require their own measurement. [Official InMemoryStore reference](https://reference.langchain.com/javascript/langchain-langgraph/web/InMemoryStore)

The measurements cover a single principal and the first read following an acknowledged write in one process. Access revocation, synchronization from remote connectors and physical erasure from backups need separate fixtures. Lite includes HTTP and transactional H2 access. The JavaScript store runs in-process with its default unindexed configuration. Replication delay, connector freshness, agent answer quality, cost and relative latency require separate measurements.
