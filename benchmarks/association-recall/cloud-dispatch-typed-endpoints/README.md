# Cloud typed endpoint hydration on frozen dispatch tasks

Two query-free cases from the frozen dispatch suite completed through native
ValkyrAI H2 and the same closed-schema consumer. The consumer and independent
SQLite judge used the returned endpoint text byte for byte. The evidence view
with both hydrated endpoints produced both expected packets with correct source
attribution. The target-only view withheld both packets.

| Evidence supplied to the frozen consumer | Correct packets | Unsupported actions |
| --- | ---: | ---: |
| Original target snippet | 0/2 | 0 |
| Original source and target snippet | 0/2 | 0 |
| Hydrated target | 0/2 | 0 |
| Hydrated anchor and target | 2/2 | 0 |

The first two rows come from the separately frozen
[Cloud snippet diagnostic](../cloud-dispatch-query-free/README.md). The last
two rows are views of the same two native hydration trials. The paired evidence
used 610 and 607 UTF-8 bytes under the unchanged 1,024-byte consumer budget.

For each original query, a tenant-scoped generated service located the
`ContentMediaLink`. The test derived the `ContentData` target from the returned
relationship and obtained a typed-path receipt from the owning HTTP graph
tool. It rechecked discovery and called the owning ContextPage compile operation
with the original task, that receipt, a 1,024-token budget and
`includeTypedPathEndpoints: true`. It then requested two hydrated items with
the same token ceiling. Each returned item and pointer shared a separately
identified source. The scorer checked the same page, receipt and projection
versions across compilation and hydration, and passed only the hydrated source
summaries to the unchanged consumer. The receipt's scope remains
`typed_path_and_endpoint_projection_only`.

These results cover internal generated-service discovery and the native owning
HTTP continuation in a local H2 test. The generated public list operation has
its own RBAC boundary. Ordinary-agent discovery, hosted execution, and a full
matched Cloud run across all 12 task populations require separate evidence.

```bash
python3 -B benchmarks/association-recall/cloud-dispatch-typed-endpoints/check.py
```

`native-capture.json` contains the two synthetic native observations.
`results.json` records the four evaluations. `protocol.json` pins the candidate
source, unchanged inputs, and execution boundary. The checker replays all four
outcomes and checks that receipt, version, summary, and case-matrix
contradictions fail closed.
