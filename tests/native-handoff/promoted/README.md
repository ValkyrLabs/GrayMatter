# Governed procedure shadow replay

An authenticated trainer records 96 successful, non-TEST executions of the catalog invoice/customer reconciliation workflow. The compiler stages an immutable procedure and freezes 20 sources for replay. The private SkillOptics operation reruns each frozen task under explicit source and compiled workflow/version EXECUTE grants. The generated endpoint accepts a baseline capsule reference. The service resolves the task, version, route, and ordinary workflow billing from authorized records.

The trainer and the second principal have organization-local OWNER memberships and the FREE, DEVELOPER, APPLICATION_READ, GRAYMATTER_USER, and Core roles. The second principal has neither platform ADMIN nor SUPER_ADMIN, and the test grants Procedure READ explicitly. They execute in separate authenticated principal contexts. Calling the active execution endpoint yields a real fallback receipt. The fixture also exercises missing EXECUTE, cross-member shadow submission, a training capsule submitted for replay, changing a bound procedure directly, and retrying an authorized frozen task. A successful retry returns the original route and execution.

Run `python3 tests/native-handoff/promoted/verify.py` to reproduce the 96 invoice expectations independently in Python and reconcile the recorded capsule, route, and evaluation references across all 20 pairs.

The Java fixture builds synthetic populations with varying sizes and missing customer references. It calculates expected business-report checksums independently before launching any source. The runs share one invoice method and synthetic fixture generator. The 20 replay tasks belong to the compiler’s actual split, and the source IDs, expected reports, actual results, route receipts, scoring receipts and release decision are included in the [observed run](observed.json).

Both arms computed the same reports. Each pair scored 0.9055555555555556 on both sides, producing an assessed mean of 0.9056 per arm. The experiment stayed in SHADOW. The experiment required at least 0.02 improvement and at most 10 mean credits. Both guardrails failed. The score adapter leaves execution-specific cost unknown when it lacks verified metering, and Omega penalizes that missing measurement. The native ledger uses synthetic welcome credits for these ordinary workflow launches. This run measures held-out re-execution of a copied workflow and the decision to withhold release. Cross-agent execution of a promoted revision requires a qualified procedure. The separate [prospective task protocol](../../../benchmarks/procedure-return/README.md) covers that comparison.

The reviewed 35-file patch is installed in the sibling ValkyrAI working copy.
Its canonical schema passed `./vaix mvn ... generate-sources`, and every
handwritten postimage still matches the qualified patch after generation.
The [installation record](installation.json) pins those files and generated
API checks. This is a local source installation; the hosted backend and
installed SWARM package were not deployed by this run. The GrayMatter MCP
suite passed 245 tests, including the private replay transport and the
correction of unsupported memory-link acknowledgements.

## Reproduce

The owning private ValkyrAI backend includes the reviewed test at `valkyrai/src/test/java/com/valkyrlabs/valkyrai/sagechat/NativeProcedureShadowReplayJpaTest.java`. Use a network-isolated development environment with the normal owner build, its test profile, the generated API, and ephemeral signing and encryption configuration. The test uses its own in-memory H2 database. Supply a new absolute witness path to retain the JSON results. The [test source](NativeProcedureShadowReplayJpaTest.java) is included here for inspection.

```sh
./vaix mvn -o -pl valkyrai \
  -Dtest=NativeProcedureShadowReplayJpaTest \
  -Dgraymatter.shadow.witness=/absolute/path/to/new-witness.json \
  test-compile surefire:test@default-test
```

The [diagnostic runner](run.py) can exercise the same test with an existing matching AspectJ-woven backend and its locally cached test dependencies. The canonical Maven run passed 249 tests across 16 selected suites, with zero failures, errors, or skipped tests. The [qualification record](provenance.json) pins each included Surefire report, its timestamp, the source and woven classes, and the exact 35-file owner patch. The diagnostic runner compiles the fixture only and uses a temporary filesystem and synthetic keys. Earlier observations used a profile that allowed an external TCP connect in a later probe.

```sh
python3 tests/native-handoff/promoted/run.py \
  --build /absolute/path/to/ValkyrAI/valkyrai/target \
  --dependencies /absolute/path/to/maven-test-classpath.txt \
  --jdk /absolute/path/to/jdk-17 \
  --console /absolute/path/to/junit-platform-console-standalone-1.11.4.jar \
  --agent /absolute/path/to/byte-buddy-agent-1.17.5.jar \
  --witness /absolute/path/to/new-diagnostic-witness.json
```

On macOS the runner uses the shared TCP profile, which permits connections to loopback and denies external TCP connects. On a system already operating inside an isolated network namespace use `--already-network-isolated`.
