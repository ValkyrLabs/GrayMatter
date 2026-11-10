# Native receipt-gated workflow acceptance

This opt-in test starts the private ValkyrAI Spring application with a fresh in-memory H2 database. It follows a GrayMatter retrieval receipt through a Rune decision, an immutable invoice workflow, and a durable SkillOptics observation. The November 6 run passed all assertions. Its synthetic identifiers, source and class hashes, and observed business result are recorded in the [run witness](observed.json).

## What the run established

| Input or control | Observed result |
| --- | --- |
| One composed source with the default retrieval policy | The receipt had `PARTIAL_COVERAGE`. The receipt-inspection graph took `evidence_withheld` and returned no observation. |
| Two distinct synthetic records and source channels, both granted MERGE | A fresh receipt contained both source UUIDs and allowed an answer. The graph verified its stored BIFROST observation as REPLAY/UNKNOWN. |
| A member from a different organization | The member could not retrieve the owner's receipt. The secured test controller denied EXECUTE, and the test-run count stayed unchanged. |
| The owner running the frozen invoice fixture | The durable execution contained the exact inspected receipt and `receipt_usable` branch. The catalog Join and report modules returned one matched invoice and one specific unmatched invoice. All six fields matched the frozen fixture. |
| Verified report | After comparing the independently computed checksum, the caller submitted a WORKFLOW observation. SkillOptics resolved the actual owned execution and stored REPLAY/SUCCESS with its execution reference. |
| Revoked MERGE on one source, with the same owner and workflow EXECUTE grant | The original receipt became unreadable. Launching the same workflow version again produced a failed execution, no business report, and zero `synthetic_reconciliation_verified` observations for that execution. |

The test provisions synthetic organizations, ordinary members, role grants, source composition consent, and two invoice rows. It uses the application’s authenticated principal context and the secured Spring controller. The receipt, Rune decision, execution, business result, and observation come from the owning services. Both source records originate in the test fixture. The independent check is the [Python invoice oracle](report_oracle.py): it computes the expected report and checksum directly from the frozen invoice/customer IDs before any workflow runs.

The workflow test dispatcher uses the application's non-billable TEST mode. The verified SUCCESS observation is submitted by the test caller after inspecting the result. This proves the native replay-evidence path through durable storage. Live SaaS dispatch, model training, candidate promotion, billing performance, and cross-product ranking require separate evidence.

## Reproduce

Use the private backend's compiled **AspectJ-woven** Maven build and its matching test classpath. The build needs current generated model classes, the generated api-0 data-plane manifest, application resources, and the `test` profile. The test runner compiles only the Java fixture. Keep the application build outside this repository.

```sh
python3 tests/native-handoff/report_oracle.py

python3 tests/native-handoff/run.py \
  --build /absolute/path/to/ValkyrAI/.vaix/maven/valkyrai \
  --dependencies /absolute/path/to/maven-test-classpath.txt \
  --console /absolute/path/to/junit-platform-console-standalone-1.11.4.jar \
  --agent /absolute/path/to/byte-buddy-agent-1.17.5.jar \
  --jdk /absolute/path/to/jdk-17
```

On macOS the runner starts the JVM with the shared TCP profile, which permits connections to loopback and denies external TCP connects. Earlier observations used a profile that allowed an external TCP connect in a later probe. In an existing network-isolated sandbox, pass `--already-network-isolated`. Each run gets a temporary filesystem and ephemeral signing and encryption keys. The runner prints only synthetic stage witnesses and the JUnit result. A pre-installation check can pass `--woven-overlay /absolute/path/to/reviewed/classes` to place the exact reviewed production classes ahead of the base build.

The combined [workflow graph](synthetic-handoff.json) uses the receipt inspector and default answer-policy Rune from the GrayMatter example and the native invoice workflow's Join, report and declared business-result contract. The [JUnit fixture](CausalGrayMatterNativeHandoffJpaTest.java) uses committed membership/ACL grants and the actual asynchronous workflow dispatcher. The expected checksum is `14172e67bf8a8e1432751f6e4e339e314d4ce61bb1938d820281b3bc74b54baa`.

On the pre-fix woven backend the usable receipt reached the Rune, then the pooled module worker lost the immutable data-plane scope and the generated SkillOptics service denied access. The reviewed backend patch propagates the authorized operation scope through the workflow executor and module worker and restores the worker's earlier scope on return or failure. The witness pins both the base build and reviewed woven class overlay used in the passing run.
