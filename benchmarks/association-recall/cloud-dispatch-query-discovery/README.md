# Cloud query-only typed path discovery

A signed-in organization MEMBER completed both frozen query-free dispatch
cases through the owning ValkyrAI HTTP handlers. Its runtime roles were
`EVERYONE`, `FREE`, and `GRAYMATTER_USER`. The unchanged consumer and
independent judge scored **2/2** packets with both hydrated records and
**0/2** with the hydrated target alone. Both views produced zero unsupported
actions. [Frozen dispatch tasks](../dispatch-task/README.md)

The test sends the original query to an Omega plan and the graph tool. The
request selects the fixed `ContentMediaLink.contentData.ContentData` path
and enables `discoverPathFromQuery`. It supplies neither endpoint locator.
The owning provider looks for a unique visible literal `fileName` match and
derives the target from the stored relationship. The current receipt binds
the path, endpoint revisions, and original query with the scoped typed-path
caveat. The same receipt then compiles and hydrates the two records under a
1,024-token budget. The scorer uses only the returned summaries.

| Authority and ambiguity control | Result |
| --- | --- |
| Unreadable matching decoy | The authorized source still produced one typed path |
| Caller-supplied entity ID with discovery | HTTP 400 |
| Effective target READ denial | Zero typed evidence items |
| Target MERGE revoked | Zero typed evidence items |
| Second visible match with the same target | Zero typed evidence items |
| Second visible match with a different target | Zero typed evidence items |

The tenant’s `GRAYMATTER_USER` role inherits ContentData READ. Removing a
redundant direct grant therefore left effective READ intact. The final test
uses a real object denial to verify the effective authority boundary. The
provider checks uniqueness at discovery time. The receipt rechecks the
selected relationship and endpoint revisions on use.

This fixture uses canonical Spring, generated ThorAPI services, H2, and
MockMvc. The public MCP adapters were also replayed against captured owning
responses. Live OAuth transport, a larger retrieval corpus, and other
relationship types have separate acceptance criteria. The two cases do not
measure scan cost or comparative latency.

```bash
python3 -B benchmarks/association-recall/cloud-dispatch-query-discovery/check.py
```
