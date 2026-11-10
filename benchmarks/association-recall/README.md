# Association recall benchmark

The fixture was frozen before candidate execution at SHA-256
`c88f1c7ab95d897c7f00b3f284cb586338c39d364de226ec671a04f4038cf985`.
Fourteen synthetic tasks measure disclosed evidence, explicit withholding and
navigation limits. The expected evidence is written in `fixture.json` before
running either implementation.

The [matched observation](matched-release-observed.json) passed all 14 frozen cases and
four lifecycle checks on candidate `a059d353…`. Complete answer evidence was
present in 6 of 9 candidate cases and 4 of 9 baseline cases. The candidate
withheld all four designated abstention cases, compared with two on the baseline.
The direct-retrieval control matched the baseline in every case.

For the linked-detail task, measured median latency was 6.59 ms on the baseline
and 18.00 ms on the candidate, with 197 and 295 context bytes respectively.
The sequential release run measured these timings under host load. The
query-free, incoming-edge and two-hop answer cases remain incomplete under the
frozen policy. Per-case timings, raw receipts and all lifecycle outcomes are
preserved in the observation files.

The pinned baseline is the generated Lite JAR
`8167718d5c939044f65e8022be9c83c204cf7dbe0085a4548aba7697315be796`, retained in
`.vaix/verification/memory-association/graymatter-local-server-8167718d.jar`.
Both runs use the same task bodies, labels, filters, topK and compiler budget.
Each runtime mints its own source and receipt UUIDs. Observations preserve those
identities and map them back to frozen fixture keys.

Run from the GrayMatter repository on macOS with Python 3.11+ and JDK 17.
The runner launches an immutable JAR copy bound to loopback, with a disposable
file-backed H2 database and synthetic Basic authentication. The current profile
permits TCP connects to loopback and denies external TCP connects. Earlier
observations used a profile that allowed an external TCP connect in a later
probe. The sandbox launcher must be permitted by the surrounding environment.

```sh
python3 -B benchmarks/association-recall/run.py baseline \
  .vaix/verification/memory-association/graymatter-local-server-8167718d.jar \
  benchmarks/association-recall/baseline-observed.json
python3 -B benchmarks/association-recall/run.py candidate /absolute/path/to/candidate.jar \
  benchmarks/association-recall/candidate-release-observed.json
python3 -B benchmarks/association-recall/check.py \
  benchmarks/association-recall/baseline-observed.json \
  benchmarks/association-recall/candidate-release-observed.json
```

The loopback sandbox uses `-Djava.net.preferIPv4Stack=true`. JVM memory is fixed at `-Xms128m -Xmx512m`. Both builds use the KEYWORD retrieval runtime. The default topK is one and the compiler
budget is 1024. A separate 128-budget case requires withholding. Each mode has
two warmups and seven measured authenticated compile requests. Median and
nearest-rank p95 are descriptive measurements from one local JVM, including
HTTP and receipt persistence. Server `tokenEstimate` is compared with actual
UTF-8 context bytes because this compiler uses bytes as its conservative bound.
The observations quantify retrieval cost and selected evidence.

The option-disabled run serves as a direct regression control. The same request
with `includeAssociations=true` is sent to both JARs, and its actual HTTP result
is recorded. Below-cut linked evidence must independently match the original
query. A query-free useful note is deliberately retained as a conservative miss.
An unrelated neighbor and a metadata-only match must remain excluded. The two
conflict cases differ only in their free relation label, with `supersedes`
receiving the same treatment as `related`. Incoming links, a two-hop path and a
reciprocal cycle pin the outgoing one-hop boundary.

Lifecycle checks issue receipts before source correction, source deletion,
source-owner revocation and edge revocation. Ordinary source writes, revision,
forget, associations and all receipt reads use authenticated HTTP. Lite exposes
no ACL-revocation operation. The owner-transfer and edge-removal cases therefore
use explicitly labeled updates to the stopped disposable H2 database, then
restart the real JVM and check authenticated visibility and old receipt use.
These cases measure response to lost authority and navigation provenance.

`check.py` independently reconstructs the first measured evidence from the raw
response, verifies every measured trial against it, checks the budget and
withholding behavior, and compares the candidate with the frozen oracle. A
passing task establishes that its required evidence was present or that its
designated abstention was observed. Query-free and two-hop answers remain outside the frozen expansion
policy, even when a human could follow those relationships.

The [private MCP acceptance](mcp-observed.json) runs the real stdio adapter against
the same generated release. It verifies the opt-in marker before links exist,
fresh parent receipts after links are added, exact source hashes, unrelated-neighbor
exclusion, correction/forget invalidation and rejection of a changed refresh flag.
It also retains the redirect and private-catalog boundary controls.

```sh
node tests/gm_lite_lifecycle_mcp_test.cjs \
  .vaix/verification/association-recall/graymatter-local-server-a059d353.jar \
  --association-recall
```

## Large history with a narrow source filter

The [pressure observation](filtered-index-observed.json) records two run orders
with the same synthetic H2 seed. The original code and the optimized build
share all 291 runtime libraries. Only the search service and index repository
classes differ. Each JVM has 6,001 memories outside the selected source and
three inside it. Each order runs five warmups and 15 measurements per mode.
Both builds return identical context and association proof for each mode.

Use the `prepare` phase of [filtered-index.py](filtered-index.py) with the
original a059 JAR and a fresh scratch directory. Run `baseline` with the
control artifact and `candidate` with the optimized artifact listed in the
observation. Each phase copies the same seed database before launching a
loopback server. For reverse order, copy the prepared seed and its metadata to
a second scratch directory. Keep this directory private because its metadata
contains the disposable fixture password.
