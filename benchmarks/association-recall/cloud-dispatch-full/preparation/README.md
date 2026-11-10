This is an unexecuted extension of the frozen twelve-task dispatch benchmark. It keeps every assigned case and the existing consumer, SQLite judge, two warmups, seven measured repetitions, and 1,024-byte final evidence limit. No model, external API, or new dependency is used.

`CloudDispatchFullCorpusJpaTest#allFrozenCasesThroughMatchedOwningOperations` creates an isolated H2 tenant and a real ordinary organization MEMBER. Synthetic rows are enrolled with ORM in a tenant transaction; this is not a generated-create-API test. All retrieval, scope selection, ACL checks, planning, receipt inspection, target reads, compilation, and hydration use current owning HTTP operations. The peer owns detail records. Effective READ and MERGE are checked before retrieval, with explicit denials for excluded rows. No case family, expected output, shipment identifier, or planted record identifier enters retrieval.

The source-only arm performs query-derived ENTITY discovery and a receipt-bound target read. It takes the actual returned fileName value and requires ALLOW_ANSWER before using it. The typed-pair arm performs query-only PATH discovery, inspects the current receipt, compiles both typed endpoints, and hydrates at most two items. It accepts only the scoped typed-path caveat. The same unchanged consumer and judge see the resulting actual text, with native IDs translated to frozen citation keys only after retrieval. There is no direct-case fallback for the pair arm.

Current storage maps full anchors to ContentMediaLink.fileName and full details to ContentData.title. The current filename column is varchar(255); direct-1, distractor-1, and conflict-1 contain anchors of 258, 258, and 261 characters. Their exact inserts are attempted, and only an actual SQLState22001 plus an observed capacity mismatch is classified as capacity_rejected. Every case still receives all assigned trial entries. Setup, protocol, and runtime failures receive no correct-abstention credit. A native withholding or graph authorization denial can count as a correct abstention and is reported by boundary. An explicit `omega_provider_failure=graph:*` in a current receipt is also unavailability, including HTTP200/NO_RESULTS. Genuine no-path or ACL withholding without a provider exception remains separately scoreable. Denial from target-read after a current authorized exact ENTITY selection is mechanical unavailability in this control; it receives no correct-abstention credit. The response sourceRef retains the receipt's canonical locator (its synthetic memoryId when present), while entityType/entityId identify the generated target.

Free relation labels have no field in the typed FK mapping. They are not converted into authority. Detail tags are retained. Repetitions are not independent tasks. Native storage, policy, and operation budgets differ from the rival implementations, so these results cannot establish general superiority or causal latency gains.

The source-only control may expose a current product defect: generated graph receipts carry synthetic memory IDs, while target-read checks a nonnull memoryId as a MemoryEntry before considering generated entity fields. The harness records that response without a database fallback. A later fix must be a separately identified candidate run.

Preparation validation uses only Python:

```bash
DISPATCH_FROZEN=/absolute/GrayMatter/benchmarks/association-recall/dispatch-task \
DISPATCH_PRIOR_NATIVE=/absolute/GrayMatter/benchmarks/association-recall/cloud-dispatch-query-discovery/native-capture.json \
python3 -B test_score.py
```

The tests replay the two prior actual paired projections inside synthetic validator envelopes and exercise rejection of changed queries, budgets, seed IDs, identity, source revisions, excluded evidence, dropped assignments, and false abstention credit. Those envelopes are unit-test data, not new benchmark observations.

The native patch adds only:
`valkyrai/src/test/java/com/valkyrlabs/valkyrai/graymatter/memory/CloudDispatchFullCorpusJpaTest.java`.
Its preimage must be absent. Apply only in the reviewed isolated reactor. Use the canonical VAIX pipeline with the existing offline/loopback sandbox and sealed Maven repository. After the corresponding canonical generation, the owning test selection is:

```bash
./vaix mvn -o -Dmaven.repo.local="$SEALED_M2" -pl valkyrai \
  -Dtest=CloudDispatchFullCorpusJpaTest#allFrozenCasesThroughMatchedOwningOperations \
  -Dgraymatter.dispatch.fixture="$FROZEN/fixture.json" \
  -Dgraymatter.dispatch.protocol="$BENCHMARK/protocol.json" \
  -Dgraymatter.dispatch.capture="$NEW_CAPTURE" \
  test-compile surefire:test@default-test
```

The capture path must not exist. Preserve the real command, sandbox, source/generated-resource/class/dependency hashes, fresh Surefire report and exit status. This preparation has not run or compiled the Java test.

Score and verify the actual capture with new output paths:

```bash
python3 -B score.py --capture "$NEW_CAPTURE" --frozen "$FROZEN" --out "$NEW_RESULTS"
python3 -B check.py --capture "$NEW_CAPTURE" --frozen "$FROZEN" \
  --results "$NEW_RESULTS" --manifest manifest.json
```

The checker requires all twelve cases and both complete trial matrices, exact request contracts, actual source bindings, current receipt/page lineage and stable source versions. READ and MERGE revocation controls must deny the same previously measured receipt/page. Infrastructure failures remain visible and prevent qualification. No new observation is included in this preparation.
