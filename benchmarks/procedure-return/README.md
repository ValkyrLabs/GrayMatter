# Prospective workflow task return

This evaluation compares a normally authorized, immutable source deployment with a procedure actually promoted from recurring successful source executions. The task is to reconcile a supplied invoice/customer snapshot. Each arm receives the same complete synthetic business input under the same non-platform-admin organization owner. The source arm knows which workflow to run, so the comparison measures whether the promoted route preserves the direct workflow’s business return. It gives the baseline no artificial planning cost.

The 249-test canonical Maven run passed. The source workflow returned the complete expected report on **12 of 12** assigned source cases. Each result records a distinct non-TEST run and its definition and output checksums. Source median call-through-read time was **331.85 ms**. The release remained in SHADOW after all 20 frozen replay pairs returned the expected report with zero improvement in aggregate score. No promoted procedure ran on the 12 prospective tasks, so there is no paired latency, quality or cost comparison. [Canonical task rows](observations/canonical-source.jsonl) · [Independent scores](observations/canonical-source-score.json) · [Owning test-report digests](observations/canonical-evidence.json) · [Canonical build provenance](../../tests/native-handoff/promoted/provenance.json) · [Governed shadow evidence](../../tests/native-handoff/promoted/observed.json)

The source fixture creates an organization-local OWNER, explicitly assigns FREE, DEVELOPER and APPLICATION_READ, then grants VALKYR_CORE. The role service also supplies EVERYONE. The execution principal has neither platform ADMIN nor SUPER_ADMIN. The separate shadow fixture additionally assigns GRAYMATTER_USER. A least-privileged organization MEMBER has not demonstrated successful execution here.

A separate native control admitted an organization MEMBER to execute another
principal's immutable source deployment under explicit object grants. The
worker produced the expected invoice report. A generated usage row retained
the workflow owner's billing attribution and exact replay reused the same
charge. Deployment EXECUTE revocation denied both identical and fresh
launches. This control uses VALKYR_CORE and the native source deployment.
It leaves the promoted arm in SHADOW. [Native delegation evidence](../../tests/native-handoff/member-source-observed.json)

An earlier standalone source control also returned 12 exact reports, with a 265.32 ms standalone median. Omission of the explicit deployment EXECUTE grant denied all 12 requests. [Standalone trial rows](observations/native-source.jsonl) · [Environment](observations/source-environment.json)

The [frozen manifest](frozen.json) predates candidate inspection. Twelve cases cover empty inputs, unmatched and repeated references, unused customers, ordering, and the 128-row limit. They are twelve populations of one workflow family. Six cases execute source first and six procedure first. The twelve snapshots are reserved for this prospective evaluation and must be excluded from all training, admission, replay, assessment and canary examples.

## Independent outcome

[The corpus generator](corpus.py) produces unique canonical UUIDs from the preregistered namespace and case identifier. A separate SQLite database computes the join counts and ordered missing invoice IDs. A case earns one point only when a distinct, same-owner, successful, non-TEST native execution returns all six expected fields and the digest of the canonical report. The scorer requires the persisted immutable input to equal the assigned task, the exact immutable version, the expected source deployment or genuine procedure routing receipt, and a positive measured time. Duplicate runs, fallback, timeouts, and missing rows earn zero on assigned tasks. An unavailable release is reported separately from an attempted procedure that returned an incorrect report.

Each duration runs from the attempt through the final owner-visible result and execution read, with 50 ms polling. Paired medians cover only cases for which both arms returned the exact expected report. Startup and training are excluded. Credits and planning tokens are unmeasured. No outcome here measures answer quality from an agent or LLM.

## Run it

Use the owning build’s JDK (17 or later), an owner-compiled AJC-woven ValkyrAI backend and its resolved test classpath. The runner compiles fixture sources against Java 17. The independently runnable source control creates a fresh in-memory H2 application, organization-local OWNER, synthetic closed-schema workflow and ACTIVE SANDBOX deployment. On macOS the runner confines Java to loopback. On other hosts use an isolated network namespace and pass `--already-network-isolated` from within it.

```sh
python3 -B benchmarks/procedure-return/test_evaluate.py
python3 -B benchmarks/procedure-return/run_source.py \
  --build "$BUILD" --dependencies "$DEPENDENCIES" --jdk "$JDK" \
  --console "$JUNIT_STANDALONE" --agent "$BYTE_BUDDY_AGENT" \
  --output /tmp/source-trials.jsonl --log /tmp/source-trials.log
python3 -B benchmarks/procedure-return/evaluate.py --score /tmp/source-trials.jsonl
```

An optional reviewed `--woven-overlay DIRECTORY` can precede the original backend classes during preinstallation qualification. Use fresh output and log paths on every run.

For the paired run, first call `evaluate.py --emit-inputs NEW_FILE`. Compile [ProcedureReturnProbe.java](ProcedureReturnProbe.java) into the same isolated JPA test as the lifecycle that produced the bound candidate. Call the following outside any existing operation scope, after governance completed. The hook sets the correct data-plane binding and runs each secured operation under the nominated organization owner. The route factory should create the normal task-family request for that owner, with procedure hints and metadata fixed for all tasks. It may only use the supplied case ID as trace identity. Business inputs and expected reports must never be used to choose a route. The hook assigns the fixed per-case trace.

```java
new ProcedureReturnProbe(application, owner).run(
    tasksPath, observationsPath, activeSourceDeploymentId, sourceVersionId,
    boundCandidateRef, id -> normalInvoiceRouteRequest());
```

The hook re-reads the BINDING candidate, APPLIED Omega experiment, valid promotion evidence and ACTIVE workflow procedure before collecting paired evidence. The candidate call uses `executeSkilloptProcedure`. The source call uses `WorkflowController.executeDeployment` with a per-task idempotency key and no procedure. These are direct Spring calls through the secured beans, with real persistence and actor authorization. Supplying a null candidate explicitly records twelve unattempted opportunities and exercises the source. A governance failure is evidence of an unavailable release. It must not be converted into twelve answer-quality failures or a fabricated promotion.

## What governance currently measures

The general compiler reuses one eligible immutable workflow graph under a new content-addressed procedure. Its recurring-exact-workflow path replaces identities and catalog metadata while preserving the business modules. Equally correct direct and compiled graphs can therefore tie on every business report.

The native capsule aggregate averages correctness, completion, relevance, evidence quality, efficiency and recovery. Its efficiency component is clamped to `1 − actualCreditCost / 200 − latencyMs / 1200000`. In that formula absent metadata contributes zero cost and zero time. These defaults do not constitute observed savings. With all other dimensions fixed and away from the clamp, a 0.02 overall improvement requires a 24-credit saving per task, a 144-second saving per task, or the corresponding combination. Staging additionally requires at least 20 samples per arm and sets separate latency and cost ceilings. The earlier workflow replay adapter, v2, copied capsule credit metadata into both estimated and actual trajectory credits, converted unknown values to zero, and used capsule row timestamps for latency. The reviewed workflow-only v3 correction reads the authorized execution’s terminal timestamps. When that interval is missing or invalid, it leaves completion time absent. V3 leaves both trajectory credit fields empty. For the closed local invoice graph, Omega reads a separate verified native settlement. Unsupported or historical runs remain unpriced. The owning replay and score-evidence suites exercised missing, malformed, and post-hoc substituted costs. [Canonical test-report digests](observations/canonical-evidence.json) · [Original guard diagnostics](observations/guard-diagnostics.json) This protocol uses elapsed time at the client and keeps missing costs and tokens as null.

See the owning `SkillMechanizationCompilerService.exactWorkflowPlan`, `SkillExperienceRuntimeService.outcomeSummary`, `SkillCandidateExperimentRuntimeService` and `WorkflowBusinessResultService` for the canonical implementation.

The owning billing runtime now records operation-level execution attribution.
In a native organization MEMBER control, the single payer-owned debit
identified the member's exact execution. The PostgreSQL 17 upgrade kept
legacy rows' attribution empty. The 178-test qualification also covered
private reservation settlement and existing token replay. Complete
settlement across child work, reversals and external usage remains a
separate requirement for promotion. [Billing qualification](../../.vaix/verification/workflow-billing-causality/qualification.json)

New full usage reversals from app-generation compensation and SWARM refunds
now retain the exact original debit ID. An authorized native payer restored
the balance after a delegated workflow run with one linked negative leg.
Exact replay reused it, and the member executor was denied compensation.
The affected workflow stays on the original debit. The reversal keeps its
own causal attribution, and historical unlinked rows retain a null origin.
PostgreSQL verified the additive migration. Final settlement still requires
evidence for the complete operation population and later adjustments.
[Linked reversal verification](../../.vaix/verification/shared-rc7-native-tests.txt)

The completed-provider billing path can now retain an exact pending debit
after a transient ledger failure. Recovery verifies the signed CORE record,
current canonical payer, causal execution, and every persisted charge field.
The ledger write and queue resolution commit together under the payer lock.
Launch admission and reservation settlement keep their existing atomic paths.
Older unsigned entries remain pending for reconciliation. The workflow score
adapter requires a separate, closed execution-level settlement before it
can use net credits. [Native billing verification](../../.vaix/verification/shared-rc7-native-tests.txt)

## Verified credits for ordinary business replay

On H2 and PostgreSQL 17.10, the invoice fixture executed 96 successful
source runs and held out 20 from the compiler's training set. The 20 compiled
shadow runs returned the same independently computed reports for those
held-out tasks. Each of the 40 executions was admitted prospectively and
settled from its own native launch debit. The explicit Omega assessment
verified both arms' reports from the original task, revalidated the frozen
replay history, and priced each arm at 200 total net credits, or 10 per run.

A real linked reversal withdrew the cohort's pricing. Resealing the affected
receipt restored the candidate mean at 9.5 credits and changed the assessment
hash. The equal scores kept the candidate in shadow.
[H2 and PostgreSQL observations](observations/native-business-release-observed.json)

## Native invoice join repair

A misbound customer key produced well-formed but incorrect reports in all 96
successful source runs. SkillOptics froze 20 of those tasks before compiling an
immutable revision that changed the join's right-hand key to the canonical
customer ID. The original reports matched the independent oracle on 0 of 20
held-out tasks. The repaired reports matched on 20 of 20. Each arm settled 200
credits across its 20 native runs. A linked reversal withdrew pricing, changed
the approval hash, and required a fresh promotion approval after resealing.

The native fixture passed on H2 with 167 selected checks and on PostgreSQL
17.10. A Bifrost ContextPage built from
two authorized fixture sources routed a new native canary execution. SkillOptics
qualified its persisted report and excluded the old training outcome from the
binding evidence. The test evaluated the actual canary outcome immediately after
completion using the `operational_24h` horizon label. A separate binding approval
activated the version, and an authorized non-admin consumer received the correct
report on a fresh input through the same procedure. This fixture covers the
exact invoice graph in an isolated CORE database.
[Native invoice repair observations](observations/native-invoice-repair-observed.json)

### Rollback after binding

The H2 and PostgreSQL 17.10 fixtures issued an authorized consumer route before
the owner rolled back through the administrator Omega endpoint. Rollback retired the experiment,
candidate, and exact procedure binding together. The pending route and a fresh
route both returned fallback with zero new executions of the retired version.

The canonical SkillOptics endpoint accepted the exact same incident and rollback
references, preserved the original decision, and rejected a changed incident.
The fixture recreated the historical split state and made a baseline evaluation
unavailable. An exact retry disabled the procedure again while retaining the
original Omega timestamp and a single rollback command debit. This checks CORE
admission and a single governed procedure.
[Native rollback observations](observations/native-invoice-rollback-observed.json)

### Tenant-scoped admission

The PostgreSQL 17.10 fixture used an imported active procedure in a physical
tenant schema and a native immutable invoice workflow in CORE. An invited
member received the correct report through a route compiled from tenant
context. During CORE admission, a second connection attempting to lock the
tenant procedure received PostgreSQL `55P03`. The original request replayed
the same execution and tenant receipt. A committed route held across rollback
and a fresh route issued afterward both produced fallback with zero new
executions. The imported binding isolates this test from tenant promotion.
[Tenant admission observations](observations/native-tenant-procedure-admission-observed.json)

## Workflow snag diagnosis

The workflow snag diagnosis repair used a separate frozen oracle. Over
twenty synthetic failing inspections returned by the real engineering
projection, the original adapter emitted zero exact diagnoses. The repaired
adapter returned all twenty and preserved the verified coordinates through
the ticket and regression proposal modules. This comparison measures
diagnosis fidelity. A promotion trial needs two diagnostic arms on the
same failing source and separate settlement evidence. [Recovery qualification](../../.vaix/verification/workflow-snag-inspection/qualification.json)

## Prospective failed-workflow diagnosis

`native-diagnostic-prospective/v1` assigns 100 ordinary SANDBOX source
executions before learning. Four equally sized groups exercise an incorrect
snapshot digest, a duplicate invoice ID, an inner join that drops an unmatched
invoice, and an invalid join result supplied to a report-only workflow.
The groups use three immutable workflow definitions. The fixture checks the
selected native Run's error and terminal witness for each assigned source.
It stages once, uses the compiler's unmodified 80/20 partition, and runs both
pinned diagnostic arms on every assigned holdout. It reports realized fault
coverage and retains the original partition.

The independent checker reads the source's native Run and ordered failure
events before scoring either arm. Structural diagnosis and exact terminal
proof are separate outcomes. The inspection baseline can identify the right
step and error category without claiming the full terminal witness. Training
and foreign-source admission checks have a separate denominator. The source
executions remain failed. This comparison measures diagnosis, with business
recovery, retries, and settled credits outside its scope.

The first H2 run verified all 20 pairs. Both arms identified the correct
failure step and category in 20/20 cases. The candidate verified the full
terminal witness in 20/20. The holdout contained seven digest failures, six
duplicate IDs, two inner-join failures and five report-only failures. Both
admission controls were rejected. The independent checker used the
worker-published execution context. The server also scored the exact
persisted diagnosis Runs. [H2 cases and evidence](observations/native-diagnostic-prospective-h2.json)

The fresh PostgreSQL 17.10 run verified all 20 assigned pairs with zero case
errors. The independent checker scored the unique authorized diagnosis Run
for each arm. Both arms were structurally correct on 20/20 cases, and the
candidate verified the exact terminal witness on 20/20. The holdout included
seven digest failures, four duplicate IDs, two inner-join failures and seven
report-only failures. Both admission controls were rejected.

Each of the 40 PostgreSQL diagnostic arms had one verified 10-credit gross
launch debit. The durable start-to-finish median was 806 ms in each arm.
The nearest-rank p95 was 889 ms for the inspection baseline and 904 ms for
the candidate. These local intervals include queue and launch processing
for the concurrently admitted arms and exclude assessment. Final settlement
remained unknown for that run. [PostgreSQL cases and measurements](observations/native-diagnostic-prospective-postgresql.json)

The first-run fixture SHA-256 was
`03b1900781e5cd566d655b19c6d8be3e4d436d1b46c48b89fc47d95c32fa2fcd`.
The PostgreSQL reproduction froze
`57a2c3809f617711798704e746dc905c6783ae317a5e5fd2ebc1a8072364a3ae`.
It preserves the source recipes and partition rule while adding direct
independent diagnosis Run reads, a record for every assigned holdout, and
per-arm observations of the committed launch debit and durable interval.
Run the opt-in case through VAIX from the owning ValkyrAI checkout with
loopback-only networking and a disposable test database.

```sh
VALKYRAI_NATIVE_PROSPECTIVE_DIAGNOSTICS=true ./vaix mvn -o -pl valkyrai \
  -Dvaix.isolatedOutput=true -Dskip.codegen=true \
  '-Dtest=NativeFailedAttemptEvidenceJpaTest#prospectiveDiagnosticCohortUsesTwentyIndependentHoldouts' \
  test-compile surefire:test@default-test
```

## Net credit settlement for diagnostic arms

A fresh PostgreSQL 17.10 cohort assigned 100 native source failures, trained
on 80 and held out 20. All 20 pairs returned current settlement receipts.
The inspection baseline and the candidate each settled 200 net credits.
The candidate verified the exact terminal cause in all 20 pairs. The
case records retain the independently observed gross launch debits, and the
qualification returns a separate digest for both arms' net settlement.
[PostgreSQL settlement evidence](observations/native-diagnostic-settlement-postgresql.json)

The receipt covers the exact three-module local graph, its committed launch
and any canonical full linked reversal. A reversal control withheld cohort
totals after a linked reversal and restored them on reassessment with the
candidate total reduced by ten credits. It kept the diagnostic verdicts and
their evidence hash. Historical runs without prospective admission remain
unpriced in the qualification. Business recovery and promotion each retain
their own evidence requirements. [Native verification](../../.vaix/verification/shared-rc7-native-tests.txt)

## SkillOptics diagnostic release review

The generated candidate assessment now returns an independent diagnostic
review. On both H2 and PostgreSQL 17.10, both arms produced valid outputs on
all 20 holdouts. The inspection baseline verified zero terminal causes. The
candidate verified 20. Both arms settled 200 net credits. On PostgreSQL the
measured baseline and candidate p95 durations were 875 ms and 926 ms. On H2
they were 1,099 ms and 1,007 ms. All nine diagnostic guardrails passed. The
separate business replay assessment kept the candidate in shadow and issued
no approval challenge.

An independent database connection could acquire the payer row only after the
CORE decision committed. A linked reversal committed after a repeatable-read
snapshot opened. The old snapshot still returned the prior receipt. The
decision read fresh evidence while retaining its payer lock and excluded the
reversed receipt. The read-only qualification withheld cohort totals at
19 settled pairs. Reassessment restored all 20 with 200 baseline credits,
190 candidate credits, and new settlement and assessment hashes.
[Observed release evidence](observations/native-diagnostic-release-observed.json) · [Native verification](../../.vaix/verification/shared-rc7-native-tests.txt)

## Admission controls

[The independent admission matrix](controls/ShadowAdmissionControlsTest.java) exercises the reader with a real server-side admission constructor and controlled version/receipt lookups. Its positive case uses the same immutable task through a distinct source and candidate run. Negative cases alter the business input behind a valid source UUID, supply raw flags without admission, replace the candidate/cohort/input digest, revoke or change authorized versions, change the principal, mark candidate/source runs as TEST or trashed, and substitute removed or ambiguous route receipts. The original replay adapter accepted the changed task and unsigned raw flags. The reviewed admission reader rejected all 22 attacks and passed the positive case. The canonical Maven reactor passed all 23 tests. The separate H2 admissions executed real compiled holdout runs under normal authorization. [Owning test-report digests](observations/canonical-evidence.json) · [H2 shadow admission](../../tests/native-handoff/promoted/README.md)
