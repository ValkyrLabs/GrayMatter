# Memory association evidence

These observations qualify local implementation behavior. They do not establish
a hosted deployment, production-dialect latency, automatic graph retrieval, or a
comparative product ranking. Repeated suite inventories overlap and must not be
summed as independent cases.

| Evidence | Observed scope |
| --- | --- |
| [Schema regeneration](schema-observed.json) | Canonical acceptance passed; authored inputs stayed unchanged through generation, example composition, generated builds and runtime checks |
| [Generated Lite](lite-native-observed.json) | 75 Java tests; file-backed native JVM restart; 9 accepted and 15 rejected shared vectors; 8 concurrent exact replays |
| [Actual JDK 17](lite-native-jdk17-observed.json) | The identical final JAR passed the native lifecycle and vectors on OpenJDK 17.0.20 |
| [Legacy upgrade](upgrade-observed.json) | Old and new frozen JARs sequentially opened one populated database; original source and receipt snapshots survived; new associations persisted and cascaded correctly |
| [Private MCP](client-observed.json) | 259 source and 246 packaged-mirror tests, including 15 focused association tests, transport failures and strict byte validation |
| [Actual stdio and Lite](lite-mcp-observed.json) | Capability, one write and exact readback through the real private MCP client and generated backend; correction and forget behavior |
| [Cloud placement baseline](cloud-placement-before.json) | Failed native ordinary tenant write: POST succeeded, owner readback failed, and qualified SQL found the source only in the platform schema; this does not qualify Cloud associations |
| [Cloud source-placement repair](cloud-placement-after.json) | Three ordinary source writes/readbacks and a nested platform callback pass under the actual Spring transaction wrapper; interim run isolated a separate payer-resolution failure |
| [Final Cloud native](cloud-native-observed.json) | 119/119 selected canonical tests, including actual permissions, committed receipts, races, rollback/retry billing, and exact UTC receipt equality |
| [Local Cloud installation](cloud-installation.json) | Exact reviewed patch and all 26 file postimages verified in the local ValkyrAI checkout |

The final generated Lite JAR SHA-256 is
`8167718d5c939044f65e8022be9c83c204cf7dbe0085a4548aba7697315be796`.
An immutable local snapshot is retained at
`.vaix/verification/memory-association/graymatter-local-server-8167718d.jar`.
The generated API hash, authored source hashes, exact commands, temporary logs
and fixture boundaries are recorded in the linked JSON. The shared input
[vectors](tuple-vectors.json) are consumed by the independent Java and MCP checks.

Representative checks after canonical generation are:

```sh
tests/schema_regeneration_test.sh
npm --prefix mcp-server test
npm --prefix plugins/graymatter/mcp-server test
node tests/gm_lite_lifecycle_mcp_test.cjs /absolute/path/to/generated.jar --associations
python3 -B tests/lite_memory_association_restart_test.py /absolute/path/to/generated.jar --java /absolute/path/to/java
python3 -B tests/lite_memory_association_upgrade_test.py /absolute/path/to/old.jar /absolute/path/to/generated.jar --java /absolute/path/to/java
```

Native vector tests seed source IDs in a stopped disposable fixture database;
association writes and reads use authenticated HTTP. The separate legacy
upgrade test creates every fixture and performs every mutation through HTTP.
MCP transport negatives use disposable loopback servers. The separate Cloud native
check uses enrolled synthetic principals with real Spring authorization, generated
persistence, and disposable H2 schemas. It qualifies the local source behavior;
production PostgreSQL/MySQL, Cloud restart and hosted deployment remain separate.
