# Native Cloud association recall checks

This fixture exercises the owning Cloud HTTP handlers through MockMvc in a real
Spring application, with AspectJ-woven services, generated persistence, disposable
H2 schemas, enrolled ordinary members, and actual role and object grants. It does
not claim a live network transport test. It supplements the separate
[Lite matched benchmark](../../../benchmarks/association-recall/README.md).

The [sealed dependency run](sealed-feature-observed.json) passed all three native
feature methods and thirteen witness stages, within **426/427** selected tests.
The ordinary upgrade fixture returned no results before migration despite a
successful source read and correct tenant placement. A separate run of that
fixture passed **1/1** with all 44,060 compiled files unchanged. This establishes
intermittency, not its cause, and does not replace the full-run failure.

The earlier [427/427 observation](observed.json) remains immutable. A shared
SNAPSHOT JAR changed during that run, so its exact whole dependency set is
unresolved. The sealed runs retain [437 runtime JAR hashes and 104 volatile
artifact-file hashes](sealed-dependency-pins.json), unchanged before and after,
alongside the same 56 source postimages. These observations do not assert a
hosted deployment or production database qualification.

The canonical owning copy belongs at
`ValkyrAI/valkyrai/src/test/java/com/valkyrlabs/valkyrai/graymatter/memory/NativeMemoryAssociationRecallJpaTest.java`.
After installing the reviewed backend patch, run from the ValkyrAI root with the
normal backend prerequisites and cached Maven dependencies.

```sh
/usr/bin/sandbox-exec -f /absolute/path/to/GrayMatter/tests/memory-associations/recall/loopback.sb \
  ./vaix mvn -o -pl valkyrai -Dskip.codegen=false -Dforce.codegen=true \
  -Dmaven.repo.local=/absolute/path/to/verified-sealed-m2 \
  -Dtest=NativeMemoryAssociationRecallJpaTest \
  test-compile surefire:test@default-test
```

The current macOS profile permits TCP connects to loopback and denies external
TCP connects. Bind local listeners explicitly to loopback. Earlier observations
used a profile that allowed an external TCP connect in a later probe. Use an
isolated Maven repository matching the recorded dependency pins and the
fixture’s disposable in-memory H2 database. The fixture mocks startup email and
research services. [TCP probe](loopback-tcp-observed.json)
The race spy calls the real discovery service and uses a latch to schedule a
source correction before binding.

The fixture covers four cases.

- Authorized one-hop recall, secure receipt commitments, current page and route
  use, read revocation, source correction, new edges in the admitted pool, and
  generated/raw ingress protection. Route request fields come from the actual
  owning page response; route responses retain only the page locator. Historical
  route reads use the existing tenant-aware
  `/skillopt_ops/{accountId}/route_receipts/{receiptRef}` endpoint. The generic
  `SkillOptRouteReceipt` GET remains a platform-scope operation.
- A populated compatible-shape upgrade through the real provisioner. Source text
  and the ordinary receipt’s visible text hash survive the upgrade. The fixture
  emulates the prior schema in one JVM by removing empty new tables and
  nullable new columns.
- A real correction between discovery and binding, requiring rejection and zero
  committed receipt or private binding rows.
- Absent generic semantic-cache routes and denied raw administrator cache CRUD.

Receipt-body tampering and missing-proof restoration are explicitly internal
persistence faults. Test-only inspection of committed pool IDs corroborates that
the new edge targets an already-emitted eligible neighbor; it does not alter proof.
Currentness covers selected evidence and eligible edges in
the original bounded candidate pool. A new source outside that pool is a
documented boundary. The observations cover authorization and persistence in
local H2. Hosted deployment, production dialects, and comparative performance
have separate qualification criteria.

`collect_native.py` accepts a completed canonical command log, the exact native
Surefire XML, and the frozen fixture. It requires all four methods and fourteen
witness stages, and checks that report witnesses match the command log before
creating a new observation file. It deliberately rejects the sealed full-run
failure; the separate feature artifact preserves that run's passes and failure.

```sh
/usr/bin/python3 -B tests/memory-associations/recall/collect_native.py \
  --log /absolute/path/to/canonical-run.log \
  --report /absolute/path/to/TEST-com.valkyrlabs.valkyrai.graymatter.memory.NativeMemoryAssociationRecallJpaTest.xml \
  --fixture tests/memory-associations/recall/NativeMemoryAssociationRecallJpaTest.java \
  --output /absolute/path/to/new-observed.json
```

The complete owning suite inventory and reviewed installation are separate from
these four native methods. Count overlapping test methods once when reporting
coverage.
