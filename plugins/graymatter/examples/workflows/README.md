# Inspect a hosted GrayMatter retrieval receipt

Use this ValkyrAI workflow when an agent needs to record that a particular recall passed the server's answer policy. It takes one existing hosted retrieval receipt reference. The branch history distinguishes a verified observation, a withheld receipt and an observation with mismatched fields. [Workflow Studio graph](graph-templates/graymatter-receipt-observation.json)

1. Load the graph into an owned Workflow Studio definition with the GrayMatter and SkillOptics modules available. The graph follows the `WorkflowGraphRequest` format. When using the secured `POST /v1/vaiworkflow/saveGraph` entry point, set `workflow.id` to the owned definition's ID. An application embedding the example as a classpath resource can instead call `WorkflowGraphTemplateService.materialize("graymatter-receipt-observation", Map.of())`.
2. Review the immutable workflow version. Use its governed **manual** launch entry point, which validates the closed launch schema and applies the deployment's authorization and idempotency rules. Supply only the receipt reference in the business inputs.

   ```json
   { "receiptRef": "your-hosted-retrieval-receipt-ref" }
   ```

3. Inspect the branch event. `OmegaReceiptModule` reads the receipt under the authenticated principal. `ConditionalBranchModule` uses a Gridheim Rune to require status `ok`, answer policy `allow_answer`, recommended action `answer`, and at least one receipt item. Any other combination ends at **Evidence withheld**. An inaccessible receipt or malformed evaluation input fails at its originating node.
4. On the permitting branch, `SkillObserveOutcomeModule` requests a `retrieval_answer_permitted` observation for the **reread receipt ID**. SkillOptics looks up an observation by tenant, source type, source ID, event and outcome version. A retry can therefore return an existing row with a different outcome or evidence class.
5. **Observation receipt verified** means the module returned normalized status, source type `bifrost`, the exact reread receipt ID and event, evidence class `replay`, outcome `unknown` and numeric version 1. The nested observation reference must agree with both module outputs, `observationRef` and the single entry in `observationRefs`. The reference must match the runtime's `skillobs-` prefix and 40 lowercase hex digits. Use that reference for subsequent authorized reads. Contradictory fields reach **Observation mismatch**. Missing required expression inputs fail the verification task.

A verified receipt can represent a new observation or a matching prior row. The SkillOptics module projects both a stored null outcome and an explicit `UNKNOWN` as `unknown`. This workflow verifies that projection. Establishing the exact persisted outcome or independently recomputing the tenant-bound reference requires access to the underlying observation.

The launch schema excludes caller-supplied policy, branch state, outcomes and identity fields. Bind this template to manual deployments that enforce that schema. Its observation records the original retrieval decision after a current access check. Run a fresh retrieval when the task requires current source content or a new eligibility decision. Verifying a business effect requires the separate execution/version check and an artifact from the target system. Lite receipts reside in the local store and use a different contract.

## Reuse a typed graph receipt

For a workflow that needs a specific generated relationship, read the
original receipt with **Omega Receipt Inspector**. It returns the
`evidenceClaimScope` field when the current, authorized receipt carries
the typed-path caveat. Map the inspector result through the workflow input
mapper before evaluating the Rune.

```text
=AND(EXACT(omegaReceiptResult.answerPolicy,"allow_with_caveat"),EXACT(omegaReceiptResult.evidenceClaimScope,"typed_path_and_endpoint_projection_only"),omegaReceiptResult.itemCount=1)
```

On the matching branch, map `omegaReceiptResult.retrievalReceiptRef` to
`retrievalReceiptRef` on **Omega Context Page** with operation `compile`.
Set `taskIntent` to the original query. The compiler reloads the receipt
under the workflow principal, checks the relationship and source revisions,
and returns the page reference and counts. A changed task can yield an
empty page. Supplying new retrieval filters or association opt-in with a
receipt reference is invalid.

To retain the anchor and target as separate evidence items, set
`includeTypedPathEndpoints` to `true` on the compile module. The original
receipt still has one typed path item. The compiled page has two distinct
source pointers and the workflow output carries only references and counts.
The owning hydration operation rechecks the relationship and both source
versions. It returns the two projections together with their original line
breaks if both fit the hydration budget. A request with insufficient budget
withholds the pair. A changed task requires its own retrieval decision.

Treat the caveat as authority for the exact path and its endpoint projection.
The default answer-permission Rune above retains its stricter policy.
The native bridge test exercises actual module execution and Rune evaluation
with a real receipt, including changed-task, cross-actor and repoint controls.

## Run the offline contract test

Use JDK 21, a compiled ValkyrAI backend and its test-scope dependency classpath file (a colon-separated list of absolute JAR paths). The runner uses the sibling checkout's VAIX build output when available and falls back to the backend's Maven `target` directory. Set `VALKYRAI_BACKEND` to the backend module when using another checkout.

```sh
tests/gm_receipt_workflow_test.sh /path/to/valkyrai-test-classpath.txt
```

The test materializes and validates the graph with Workflow Studio and executes it with the native graph evaluator, OpenXLS conditions and field-regex branch. It exercises a verified receipt, an empty receipt and a replay returning a prior production success. Separate module checks cover restrictive receipt enums, forged inputs, missing fields, conflicting references, malformed IDs and the null-outcome projection. The authenticated data services use in-process fixtures. A deployed run with a real authorized receipt is a separate integration check.
