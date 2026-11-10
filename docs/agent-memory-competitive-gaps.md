# Agent memory competitive gaps

Reviewed 2026-11-07. This assessment covers 17 competing baselines for durable and procedural agent memory. It compares public contracts with GrayMatter’s baseline at `c8836386` and distinguishes source tests from runtime comparisons. Product editions matter. The case studies measure retrieval and policy decisions. Answer quality, latency and cost across complete competing systems remain unmeasured.

## Where an agent can make the wrong decision

**Can I answer from this excerpt?** GrayMatter Lite already retrieves owned memories, fits excerpts to a byte budget, and allows an agent to hydrate a receipt source by ID and hash. At the baseline revision, its answer-policy check required at least one item and zero stale or omitted sources. A single long decision could satisfy that check even if compression cut off its exception. An explicitly conflict-tagged source could also receive a confident citation policy. Both failures can occur with perfectly relevant search results. The selected change makes evidence completeness and declared conflicts count in the decision an agent actually receives. [Lite context service](../templates/graymatter-light-bootstrap/local-server/src/main/java/com/valkyrlabs/graymatter/localserver/service/MemoryContextService.java) · [Bifrost Lite compressor](../templates/graymatter-light-bootstrap/local-server/src/main/java/com/valkyrlabs/graymatter/localserver/service/BifrostLiteCompressor.java)

**Which execution succeeded?** The private GrayMatter CLI can discover a procedure, submit a task to SkillOptics, and read a generated ValkyrAI workflow execution. At the baseline revision a status read by execution ID could return `succeeded: true` for a `SUCCESS` row even when the caller had yet to establish that its version or route belonged to the original dispatch. The second selected change lets an agent check this association. The distinction matters when several runs exist, a response was lost, or an older server omits a binding. An independently observed business effect, such as the correct invoice actually being reconciled, needs its own artifact. [Execution adapter](../mcp-server/lib/procedure-execution.cjs) · [Private procedure contract](private-procedure-execution.md)

## What competitors already deliver

The Zep, Letta, Mem0 and Alook contracts below were refreshed from primary sources on **2026-11-07, 19:58–20:03 UTC**. This was documentation and source inspection, without authenticated competitor runs. Combined capabilities are marked unverified where the available contracts leave them open.

| Baseline | Documented behavior | What to compare in GrayMatter |
| --- | --- | --- |
| Hindsight | Recall fuses keyword, semantic, graph and temporal results. It marks truncated source facts and chunks, and documents that rank scores are relative to one query. Reflect can synthesize answers using the selected facts. [Recall](https://hindsight.vectorize.io/developer/api/recall) · [Reflect](https://docs.hindsight.vectorize.io/api-reference/reflect/) | With the exception clause outside the budget, examine the answer policy, what the agent receives, and whether a fresh read can recover the clause. |
| Zep Cloud v4 and open-source Graphiti | Alongside temporal graph memory, Cloud Agent Skills documents agent namespaces, immutable skill versions, version-specific use records, candidate evaluations and admission gates. Enterprise ABAC adds project-internal controls. An API key without policies has project-wide access. Graphiti documents the open-source temporal graph separately. [Facts](https://help.getzep.com/v4/facts) · [Skill versions](https://help.getzep.com/v4/agent-skills/manage-skills) · [Skill use](https://help.getzep.com/v4/agent-skills/retrieve-skills) · [Candidate evaluation](https://help.getzep.com/sdk-reference/agent/skills/evaluations/create-for-candidate) · [ABAC](https://help.getzep.com/attribute-based-access-control) · [Graphiti](https://github.com/getzep/graphiti) | Compare candidate admission, exact retrieved skill versions, current source access and independently checked task outcomes. Separate Zep's recorded evaluation from the application execution that produced it. |
| Mem0 Platform | Project credentials establish organization and project scope. User, agent, app and run identifiers select memories inside that scope. The platform documents memory history, feedback and Dream's source lineage for synthesized memories. [Organizations/projects](https://docs.mem0.ai/api-reference/organizations-projects) · [Entity scopes](https://docs.mem0.ai/platform/features/entity-scoped-memory) · [History](https://docs.mem0.ai/api-reference/memory/history-memory) · [Dream sources](https://docs.mem0.ai/api-reference/dream/get-dream-memory-sources) · [Feedback](https://docs.mem0.ai/api-reference/memory/feedback) | Compare changed-preference recall and derived-source provenance at the same budget. Use distinct project credentials to test tenant isolation. Immutable workflow execution binding and independent failed-source admission remain unverified in the inspected contracts. |
| Supermemory | Sources become linked memories that can update or extend earlier facts. Its API exposes source connectors and sync operations. The vendor distinguishes connector progress from the point when a changed document becomes available to answers. [Memory lifecycle](https://supermemory.ai/product/) · [Connector freshness](https://supermemory.ai/blog/connector-provider-separation/) | Measure the time from a source correction or deletion to the last stale answer across derived memories and cached context. |
| Cognee | Maintainer examples cover conflict review and resolution, time-bounded recall, evidence references, permission-filtered retrieval, and skills improved and reapplied using feedback. [Runnable examples](https://github.com/topoteretes/cognee/blob/main/examples/README.md) | Compare conflict handling before and after adjudication. Change a source grant in between and check what an existing receipt can still reveal. |
| Letta | The current Agent SDK exposes run IDs and terminal results. MemFS keeps Git-backed memory and skills. Agents are private by default with organization sharing and role controls. Conversations remain private to their creator. The separately documented legacy V1 Evals supports fresh agents per sample, deterministic graders and CI gates. [Sessions](https://docs.letta.com/agent-sdk/sessions) · [MemFS](https://docs.letta.com/concepts/memfs) · [Permissions](https://docs.letta.com/teams/permissions) · [Evaluation targets](https://docs.letta.com/v1-sdk/evals/concepts/targets) · [Graders](https://docs.letta.com/v1-sdk/evals/concepts/graders) · [Gates](https://docs.letta.com/v1-sdk/evals/concepts/gates) | Compare isolated evaluation samples and independent task correctness, while reporting the SDK generation used. The combined contract for Git history, run correlation and immutable workflow-to-execution binding remains unverified. |
| Memorable | Its extraction API turns tool-call traces into ordered procedures. The CLI recalls actions and verification commands as reference for a later run. [Extraction and recall](https://www.memorable.sh/doc) · [CLI contract](https://www.memorable.sh/docs/cli) | Change the target artifact between runs. Compare the historical verification command with evidence of the present execution and its effect. |
| LangMem | Its prompt optimizer consumes past trajectories to refine instructions. The library also supports background memory management. [Optimization guide](https://langchain-ai.github.io/langmem/guides/optimize_memory_prompt/) · [API](https://langchain-ai.github.io/langmem/reference/) | Train on one set of trajectories and measure verified task success and regressions on held-out runs before promoting a procedure. |
| Amazon Bedrock AgentCore | Episodic memory records tool interactions and reflects across episodes. Managed and self-managed strategies control long-term extraction. Gateway Policy separately uses Cedar to authorize tool calls. [Episodic strategy](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/episodic-memory-strategy.html) · [Memory strategies](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/memory-strategies.html) · [Policy](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy-create-policies.html) | Use the same successful episode, then revoke the action grant. Trace recall, routing, denial and any workflow side effects separately. |
| Google Cloud Memory Bank | Immutable revisions track memory changes. Viewing revisions is permission-controlled and operators can configure retention. [Memory revisions](https://docs.cloud.google.com/gemini-enterprise-agent-platform/scale/memory-bank/revisions) | Compare source history, as-of reconstruction and deletion behavior after a revision expires. A source hash alone cannot reconstruct the old content. |
| Honcho | Session context can include recent messages, a summary and a representation of a peer. Peer cards can be maintained from conversation history and edited. [Memory API](https://agentcash.honcho.dev/) | Give two participants conflicting preferences, correct just one, and verify what a new agent recalls for each participant. Score correct attribution as well as recall. |
| Redis Agent Memory | The supported service separates session memory from durable memory, with configurable schemas and TTL-based retention. Redis distinguishes it from the open-source reference server. Its researchers also report experiments combining raw conversation chunks with extracted facts. [Service and editions](https://redis.github.io/agent-memory-server/) · [Redis retrieval study](https://redis.github.io/redis-ai-research-public/longmemeval-agent-memory/) | Expire a source between session recall and task execution. Compare the last stale answer and the latency of fresh retrieval in both products. Do not compare Redis’s published answer results to Lite’s session recall metric. |
| MemOS | Its open-source API processes messages inside scoped memory containers, schedules extraction asynchronously, and accepts corrections. [Open-source API](https://github.com/MemTensor/MemOS/blob/main/docs/en/open_source/open_source_api/start/overview.md) | Write a source and immediately correct it while ingestion is queued. Record when the correction becomes visible and whether the earlier value resurfaces across agents or containers. |
| Archived Acontext and successor Alook | Acontext distilled session evidence and task outcomes into portable skills. Its archived repository points to Alook. Alook provides shared workspaces with separate private agent context. Its implemented idle-memory maintenance preserves source links and reusable experience. The Automation API covers collaboration actions and explicitly excludes chat-history and bot-inbox reads. [Acontext](https://github.com/memodb-io/Acontext) · [Alook workspace](https://alook.ai/blog/introducing-alook) · [Pinned reflection prompt](https://github.com/alookai/alook/blob/263a58c87e2664fad0ff1508fa39a1fa7abcbc51/src/daemon/src/manager/memoryMaintenancePrompt.ts) · [Pinned developer guide](https://github.com/alookai/alook/blob/263a58c87e2664fad0ff1508fa39a1fa7abcbc51/src/web/public/agent.md) | Treat Alook as a current workspace and procedural-reflection rival, with Acontext retained as a historical developer-memory baseline. Alook's standalone retain/search API, immutable workflow execution provenance and independent failed-source evaluation remain unverified. |
| Engram | Documents tombstones for explicit revocation and supersession across ordinary read paths, rejection of same-text reinsertion, and erasure of derived memory. [Revocation contract](https://github.com/jamjet-labs/engram) | Repeat explicit revocation across search, receipt reuse, compiled context and workflow admission. Separately test an authorized new source that intentionally restores a prior value. |
| EverOS | Its unreleased self-hosted changelog describes source-existence checks under an owner lock before derived writes, and deletion of reflected content and derived facts. [Maintainer changelog](https://github.com/EverMind-AI/EverOS/blob/main/CHANGELOG.md#unreleased) | Pause extraction after a source revision is read, then correct or delete that revision. Check whether delayed extraction can restore obsolete evidence or promote a procedure based on it. |
| Agent Zero Memory | The authors describe separate event, graph and citation-backed document memories, and an intent gate before retrieval. [Author preprint](https://arxiv.org/abs/2608.29606) | Use identical queries that require two kinds of evidence. Track each cited source version, the cost of parallel retrieval, and whether a self-contained request avoids unnecessary retrieval. |

A published preprint found that the tested defaults of five agent-memory systems could return superseded policy, with unsafe actions downstream. Its paired old-and-new policies make a useful external fixture. Explicit policy supersession, a change to source content, and withdrawal of a reader's grant need separate cases because each changes what evidence a current run may use. [Study](https://arxiv.org/abs/2609.08258) · [Experiment code](https://github.com/VulcanLab/Memory-Rebirth-Attack)

The closest overlap for the first change is Hindsight’s explicit truncation signal and Cognee’s conflict inspection. Zep Cloud v4 is the strongest documented procedural comparator because it combines versioned skills, trace evidence and candidate admission. Memorable’s verification evidence, Letta’s executable skills and AgentCore’s action policy remain relevant individual comparisons. Whether each competitor enforces the same combined workflow-execution behavior is an open comparison.

## Where the integration work falls

* **From recall to an authorized action.** Zep explicitly assigns the decision to run an external tool to the application. Letta skills can call APIs using the agent's available tools and permissions. A team using either pattern still has to connect a recalled fact to evidence about a particular business workflow. GrayMatter's private verifier can follow that connection when the authorized SkillOptics, workflow and Bifrost records carry matching references. The target system must still verify the business effect. [Zep security boundary](https://help.getzep.com/v4/memory-security) · [Letta skill execution](https://docs.letta.com/configuration/skills) · [GrayMatter verification](private-procedure-execution.md#check-which-retrieval-went-into-a-procedure-run)
* **From a historical check to the current run.** Memorable surfaces the command that verified an earlier procedure and asks the agent to confirm the procedure fits its new task. That leaves a concrete question when a procedure changes between runs. GrayMatter can compare the current authorized records' workflow version, snapshot hash and route, and return incomplete evidence for a legacy run. Comparing hashes alone cannot authenticate the execution origin. [Memorable CLI](https://www.memorable.sh/docs/cli) · [GrayMatter evidence verifier](../mcp-server/lib/procedure-evidence.cjs)
* **From recorded evaluation to independently executed evidence.** Zep's November 2026 paper derives verification strength from caller identity and restricts agents to self-reports. Failed traces support failure analysis. The procedure-step learner requires verified successes, and the paper lists learning verified subgoals from failed traces as future work. The application runs code, verifiers and evaluations, then Zep records the results and applies admission gates. [Primary paper §§5.1–5.6 and 9](https://arxiv.org/html/2611.01386v1) · [Admission requirements](https://help.getzep.com/v4/agent-skills/learning-and-admission)
* **From partial retrieval to an agent decision.** Hindsight Recall reports truncated source facts and chunks. An application consuming Recall must decide whether the omitted material matters before answering. GrayMatter Lite chooses a conservative default for cut passages and explicit conflict markers and supports a larger-budget retry. This costs an extra retrieval or clarification when the omitted text was irrelevant. Hindsight's separate Reflect operation has its own reasoning behavior and needs its own comparison. [Hindsight Recall](https://hindsight.vectorize.io/developer/api/recall) · [Lite receipt policy](graymatter-lite.md#bifrost-context-for-agents)
* **From a lost response to a durable memory.** AgentCore accepts a client token to deduplicate event creation. Hindsight OSS v1.2.0 returns the original asynchronous retain operation when the same operation ID is reused within a bank, even when its payload changes. Zep Cloud v4 Agent Skills returns a conflict when an existing trace ID is reused with different creation parameters. These APIs create different objects, so measure durable events, operations and traces separately. [AgentCore CreateEvent](https://docs.aws.amazon.com/bedrock-agentcore/latest/APIReference/API_CreateEvent.html) · [Hindsight v1.2.0 tests](https://github.com/vectorize-io/hindsight/blob/v1.2.0/hindsight-api-slim/tests/test_async_retain_operation_id.py) · [Zep trace capture](https://help.getzep.com/v4/agent-skills/capture-traces)

  GrayMatter commits the original request fingerprint with its memory in a tenant-local admission record. In the authenticated H2 HTTP test, two requests both observed the missing key before attempting the write. They converged on one durable memory and the same receipt, trace and classification revision. Changing the text, type, title, tags, channel or link assertions returned a conflict. After deletion, an exact retry returned 404 without recreating the memory. An occupied historical key with no verified original intent returned 409. The write receipt grants no answer authority. Both MCP remember aliases exposed a non-retryable conflict in a separate adapter test. PostgreSQL 17 passed real tenant provisioning and isolation. Hosted and real MySQL replay comparisons remain unverified. [GrayMatter replay issue](https://github.com/ValkyrLabs/ValkyrAI/issues/4660)

## A proposed matched procedural evaluation with Zep

This protocol awaits execution. Pin the Cloud v4 contract and verify account entitlements first. The current Agent Skills overview describes Cloud availability, while an evaluation reference still describes a restricted release. Record the accessible features and policy configuration. [Overview](https://help.getzep.com/v4/agent-skills) · [Evaluation reference](https://help.getzep.com/sdk-reference/agent/skills/evaluations/create)

The closest endpoint is `POST /api/v4/agents/{agent_uuid}/skill-candidates/{review_uuid}/candidates/{candidate_uuid}/evaluations`. It requires an evaluator category, evaluator version, expected candidate revision and typed verdict. A controlled-test flag, environment, evidence reference and metrics are optional. The published request does not require an executed workflow ID or immutable execution digest. Test the evaluation and admission contract as documented, and separately measure the application work required to bind it to a real execution. [Candidate evaluation contract](https://help.getzep.com/sdk-reference/agent/skills/evaluations/create-for-candidate)

1. **Freeze the workload and oracle.** Use a side-effect-free policy-exception task that produces a structured report. Precommit fixture hashes, expected outputs, checker version, model, tool access and inference budget. Demonstrate that the baseline fails the independent checker. Keep held-out task cases outside all candidate learning inputs.
2. **Learn from equivalent authorized evidence.** Supply each arm the same training traces and outcomes. Include a verified successful correction in the matched learning workload so both systems can build a procedure. Run a separate failed-only ablation and record whether each product admits the resulting candidate. Freeze each resulting candidate before evaluation.
3. **Execute and grade independently.** Run baseline and candidate against the same held-out fixtures in fresh execution scopes. The external checker grades the produced artifact without reading the candidate's claimed outcome. For Zep, submit that result against the exact candidate revision using the endpoint above. For GrayMatter, retain the authorized execution, immutable workflow version, holdout association and score receipt. Report which bindings the service enforces and which the harness supplies.
4. **Exercise authority and provenance controls.** Use two separate authenticated projects or tenants, then attempt an exact-ID read from the foreign scope. Revoke source access before a later evaluation. Try a stale candidate revision, a mismatched execution/evidence reference, and a late success event from a stale worker. Record which service or harness accepted each event and whether an independent checker actually ran.
5. **Report correctness and integration cost separately.** Publish verified task successes and regressions, admission decisions, source availability after revocation, completeness of execution bindings, latency, token usage and external harness work. Include failed and withheld outcomes. Mark each native capability unverified or unsupported for the specific edition when appropriate.

Letta can provide an additional independent evaluation arm through the documented legacy V1 AgentFile/factory path, which creates fresh agents per sample. Report the SDK version with the results. Mem0 can participate through an application harness with project-scoped credentials and source lineage, while reporting its memory feedback separately from candidate admission. Neither extension has been executed here. [Letta targets](https://docs.letta.com/v1-sdk/evals/concepts/targets) · [Mem0 project scope](https://docs.mem0.ai/api-reference/organizations-projects) · [Mem0 feedback](https://docs.mem0.ai/api-reference/memory/feedback)

## A matched store and context probe

Six synthetic cases use the same text, tags, source filter, query and result limit on both sides. The LangGraph JavaScript `InMemoryStore` from `@langchain/langgraph-checkpoint@1.2.2` uses its default unindexed store. GrayMatter Lite uses its keyword search API and then compiles context from the same query. The store returns records for application code to interpret. Lite also makes a decision about passing text to the agent. An application can add its own policy to LangGraph. [Reproduce the probe](../benchmarks/README.md#compare-a-raw-store-with-compiled-agent-context) · [LangGraph store API](https://reference.langchain.com/javascript/langchain-langgraph/web/InMemoryStore)

| Input | LangGraph store | Observed Lite context |
| --- | --- | --- |
| One Wednesday window, limit 1 | Wednesday | Allowed Wednesday. |
| Wednesday and Thursday, limit 2, neither tagged | Both complete records | The earlier compiler allowed both. The v3 compiler asks whether both days apply and retains the two evidence IDs. |
| Same records, Thursday tagged `unresolved`, limit 2 | Both complete records with the tag | Withheld both and returned the Thursday source ID as conflict evidence. |
| Same tagged records, limit 1 | Wednesday | Raw Lite search selected Wednesday in both builds. The earlier compiler allowed it. The updated compiler retained Thursday as conflict evidence and withheld all text. |
| Wednesday plus a tagged billing record mentioning “canary” but not “window”, limit 1 | Wednesday | Allowed Wednesday. |
| One 2,879-byte decision with a final exception, limit 1 | Entire record | At budget 128, withheld the passage and identified the truncated source. Recompressing that receipt at 4,096 delivered the original text including the exception. |

The updated Lite compiler can retain one explicitly marked source below the cutoff when its body contains every query term and it passes the owner, filter and retrieval checks. The unrelated billing record shared only one query term. V3 also recognizes two bare, different weekday assignments for the same queried schedule, record type and source channel. Arbitrary untagged contradictions and paraphrases can still be missed. The budget applies to the Lite context call. LangGraph's count limit applies to whole records.

The runs used the same six fixtures and pinned SDK. The initial build was a generated Lite bundle. The updated build ran the handwritten Lite application with the below-cutoff check. The manifests record both JAR digests, the identical probe digest, raw record keys, diagnostic sources and delivered items. These observations measure API behavior. Measuring supported answers, latency or cost needs an agent workload and a judge. [Initial run](../benchmarks/store-context-probe/observations/2026-11-06-before.json) · [Updated run](../benchmarks/store-context-probe/observations/2026-11-06-after.json)

We repeated all six requests after running the default `./vaix generate` and
`./vaix build` on the source with the below-cutoff conflict check. The [generated core capture](../benchmarks/store-context-probe/observations/2026-11-06-generated-core.json)
matched the updated compiler on every decision, delivered and diagnostic
source, and budget retry. The two untagged, equally ranked records changed
order in raw search; both were still returned. Across the four initial cases
whose oracle requires withholding, false permissions fell from two to one.
False refusals were zero out of two on both builds. The one same-receipt
budget retry recovered its missing exception in every build. These
denominators refer only to the six synthetic cases. The [subsequent offline
ranking build](../benchmarks/store-context-probe/observations/2026-11-06-offline-ranking.json)
returned the same six policy decisions.

With the [v3 weekday check](../benchmarks/store-context-probe/observations/2026-11-06-weekday-policy.json),
false permissions fell to **0/4**, with **0/2** false refusals and **1/1**
successful budget retries in the original six cases. A
[separate adversarial probe](../benchmarks/store-context-probe/schedule-controls.cjs)
found the cost: v3 withheld **1/17** compatible schedules. A source saying
“the final decision supersedes Wednesday” did not establish authority or scope
for the rule, so the agent still requested clarification. Confirmed two-day
recurrence passed. The same bare Monday/Friday statements could also express
a recurring schedule; the result reflects uncertainty, not a factual contradiction.

## An independent retrieval check on LoCoMo

In the original generated Lite runtime, the offline ranker gave BM25 matches
and hashed word/trigram matches separate votes. On 100 sampled LoCoMo
questions, its top three results contained 80 of 130 annotated evidence
sessions; plain BM25 found 95. The revised offline default preserves exact-term
ranking and fills the remaining slots with verified subword matches. It found
95 of 130 on the same questions.

On **100 additional questions reserved before making the change**, the
revised Lite search found **88 of 136** annotated evidence sessions,
up from **62 of 136**. Mean recall per question rose from **51.14% to
76.56%**. Thirty-one questions improved, five regressed, and 64 were tied.
The new ranker matched the independent BM25 evidence count for every question
in both samples. This measures session retrieval at three results per query,
not answer accuracy. [Protocol and observations](../benchmarks/locomo-local/README.md)

There is also a concrete scaling question: the Lite search service currently
loads the principal's candidate memories and applies source/tag filters before
ranking them in process. Measure p95 latency and memory with a large principal
history and a narrow source filter before recommending it for that workload.

## Hindsight's source-fact budget under test

We ran all ten upstream tests for Hindsight's source-fact selector at commit `eb963cb5a929d92c081371df64c2d5c2fe3351af`. All ten passed. The tests use one token per word. With a budget of two, the selector skipped a 50-word source, retained both later one-word sources and set its truncation flag. A missing database row alone left that flag false. A caller checking provenance therefore needs to compare the advertised source IDs with the map of resolved facts. Hindsight's engine integration test also checks that a budget covering the top result's sources retains them. We reviewed that test. The local execution covered the selector only. [Pinned selector](https://github.com/vectorize-io/hindsight/blob/eb963cb5a929d92c081371df64c2d5c2fe3351af/hindsight-api-slim/hindsight_api/engine/source_facts.py) · [Ten upstream tests](https://github.com/vectorize-io/hindsight/blob/eb963cb5a929d92c081371df64c2d5c2fe3351af/hindsight-api-slim/tests/test_source_facts_selection.py) · [Engine integration test](https://github.com/vectorize-io/hindsight/blob/eb963cb5a929d92c081371df64c2d5c2fe3351af/hindsight-api-slim/tests/test_source_facts_tokens.py#L174-L217)

This gives a concrete tradeoff. Hindsight can still supply other facts when one source exceeds budget. GrayMatter Lite withholds compiled agent context if a selected passage is incomplete, and the agent can retry that receipt. Hindsight's source-fact map and Lite's compiled context are different outputs. Comparing the quality and cost of the resulting answers requires an application consuming each one.

To reproduce, check out the pinned Hindsight revision and run `python3 -I benchmarks/check-hindsight-source-facts.py /path/to/hindsight/hindsight-api-slim` from the GrayMatter repository. The runner verifies both upstream Git blob hashes before executing the original tests with the Python standard library. [Local runner](../benchmarks/check-hindsight-source-facts.py)

## Correcting a source after another agent has read it

In five matched scenarios, both the pinned LangGraph JavaScript
`InMemoryStore` and updated Lite returned the corrected value on the next
exact read and scoped search. When two clients edited from the same read,
both native LangGraph puts completed. Lite accepted one correction and
returned HTTP 412 for the other. Lite also rejected a delayed deletion and
a delayed edit after the text had changed and then returned to its original
value. The comparison uses the SDK's ordinary key operations. An application
can add its own concurrency policy. [Matched observations and frozen inputs](../benchmarks/source-lifecycle/README.md)

Google Memory Bank allows operators to inspect
immutable revision snapshots and roll a memory back. Lite's current source
hash checks which revision a caller reviewed. Restoring earlier text in this
probe required supplying that text again. Historical revision retention
and rollback remain distinct comparisons. [Google Memory Bank revisions](https://docs.cloud.google.com/gemini-enterprise-agent-platform/scale/memory-bank/revisions)

A new source changed a decision even when an earlier passage remained intact.
On v3 a newly added dispute caused a fresh search to withhold, yet the older
receipt still hydrated its approved passage. On v4 the earlier decision
remains visible for audit, hydration returns 409, and a new search under
the original filters records the dispute in a child receipt. An unrelated
write outside those filters leaves the receipt usable. Changed records
within the filters can require a fresh search even when their wording is
unrelated. [Local contract](graymatter-lite.md#correcting-and-forgetting-a-local-memory)
· [Agent acceptance test](../tests/gm_lite_lifecycle_mcp_test.cjs)

The public MCP adapter also checks mutation acknowledgements. Five simulated
upstream responses previously yielded false success, including an update
for a different ID and a deletion that was still queued. Those cases now
return an uncertain outcome, and the verified update and deletion both pass.
This tests the local adapter against the hosted API's response contract.
Remote connector propagation and a grant revocation between action and
execution still require an end-to-end test.

The owning Cloud runtime now checks the selected ordinary memory's body hash
and stored audit timestamps before reusing a receipt. In an H2 tenant, a
fresh source revision remained readable while the old receipt, exact retry,
Bifrost page and SkillOptics route were denied. Restoring the exact earlier
body preserved its hash and changed its timestamp, so the older receipt
remained unusable. The 100-test VAIX run also covered an existing ordinary
receipt across an additive schema upgrade. Older rows with incomplete source
stamps can only be checked against the evidence they retain.
[Owning qualification](../.vaix/verification/ordinary-receipt-source-revision/qualification.json)

Automatic temporal correction now starts the predecessor lookup inside the
placed tenant transaction. It chooses the unique current assertion in the
same effective window, and rejects an idempotent writer replay that points
to an archived row. For ordinary MemoryEntry writes, a private persisted
revision now binds admission and is checked again under the source lock at
assertion commit. The owning H2 run observed three distinct admissions for
an exact-text restore, rejected delayed obsolete work, and showed a real
PATCH waiting for the assertion writer. All 189 selected tests passed.
The tenant bundle adds a nullable column from the actual PostgreSQL and
MySQL Hibernate exports. Connector writes outside this lifecycle require
their own revision evidence. [Revision qualification](../.vaix/verification/memory-source-revision-fence/qualification.json)

At 1,024 owned memories with eight matching the receipt's filters,
authenticated receipt inspection took a median **107 ms** on v4 and **94 ms**
on v3. The 95th percentiles were **442 ms** and **130 ms**. Each estimate
uses 48 requests on a shared development machine. An authenticated health
read alone took a median **100 ms** on v4, so the total includes a
substantial authentication cost. The tail measurements varied across the
two filter scopes and require repeated runs to attribute the difference.
[Raw latency samples and controls](../benchmarks/source-lifecycle/latency/README.md)

The next generated build addressed that authentication cost. Two alternating
runs with the same 1,024-memory workload reduced median receipt inspection
from **103–129 ms** to **11–15 ms**, while preserving the source-scope check.
The implementation reuses successful password comparisons for a bounded
interval and reloads account status, verifier and roles for every request.
The native HTTP tests observe password rotation, changed roles, disablement
and deletion immediately. Unknown users retain Spring's BCrypt timing path.
[Authentication experiment and all four observations](../benchmarks/auth-latency/README.md)

## Following evidence into a workflow

The [hosted workflow example](../examples/workflows/README.md) rereads a
Bifrost receipt under the current principal. A Rune checks whether that
retrieval permitted an answer. SkillOptics then records the observed decision
as replay evidence with an unknown business outcome. A second gate catches an
older production-success record returned on replay. The offline test runs the
actual workflow evaluator on permitting, withheld and mismatched branches;
authenticated record reads are fixtures.

The [private verification command](private-procedure-execution.md#check-which-retrieval-went-into-a-procedure-run)
checks the exact workflow version, route and retrieval trajectory. For the
invoice/customer workflow it can also compare a result to an independently
pinned expectation. In the [cross-runtime test](../tests/gm_procedure_result_interop_test.sh),
a real catalog join finds one unmatched invoice out of two; Java produces the
result and the JavaScript verifier checks it. This verifies the report against
the fixture. A non-production hosted dispatch by a second agent, with real
grants and a target-system receipt, remains a separate acceptance case.

The [full native handoff test](../tests/native-handoff/README.md) now runs on a
fresh H2 database with actual organization memberships, object grants,
receipt storage, Rune evaluation, immutable workflow execution and SkillOptics
normalization. One source produces a caveat and the gate withholds. Two granted
synthetic sources pass the configured default gate. The non-admin owner
executes the receipt-gated invoice workflow, whose result matches all six
expected fields and an independently precommitted checksum. The resulting
WORKFLOW success is persisted as replay evidence.

The foreign actor is denied before creating a test run. Revoking a source's
composition grant still leaves the owner's workflow EXECUTE grant intact,
but the second execution fails with no business report and no verified-success
observation. These checks found and fixed a native scope-propagation defect
at async dispatch and module workers. The reviewed source patch passed 123
owning tests, 18 independent controls and the full native contract.

The test uses synthetic inputs and fixture login. Its frozen Maven build,
woven candidate classes, policy-resource hashes and JVM class origins are
recorded in the [observations](../tests/native-handoff/observed.json).
The native workflow graph and post-result verification are orchestrated by
the test. Hosted agent handoff through a promoted procedure and its measured
task return remain acceptance work.

On November 6 we selected a real, successful test-mode workflow execution
and ran the private verifier from its execution ID. The row lacked the
reviewed version, snapshot, route and trajectory, so the verifier returned
`incomplete` and left its business outcome unverified. A success flag alone
was insufficient. This is a live check of the refusal path.

The local ValkyrAI promotion and new activation paths also recheck a workflow
candidate's two experiment arms against the frozen holdout, the authorized
executions and their original score receipts. ASTRA reproduced two bypasses:
multiple evaluations of one execution counted independently, and a score
could be substituted from another outcome. Both now fail; two independent
pairs still pass and an operator can roll back. The 75 owning and adjacent
service tests plus 18 independent controls used mocked persistence. These
checks cover the decision paths, not overlapping database transactions or
prospective gains from a promoted skill. Existing bindings were not modified.

The next native qualification ran 96 distinct synthetic invoice populations
through a normal SANDBOX deployment, checked their business reports against
independently computed checksums, and compiled the recurring workflow. The
compiler assigned 76 executions to training and reserved 20 for holdout. A new
governed SHADOW replay operation derives each task from its original authorized
holdout execution; callers supply candidate and capsule references rather
than task data or provenance flags. All 20 compiled replay reports matched.
An exact retry reused its original execution and route. This closes the
bootstrap gap in which validation needed an executable procedure while the
ordinary procedure route correctly excluded unqualified SHADOW revisions.

Both arms scored equally. Reassessment retained SHADOW. A second account with
organization-local OWNER membership and explicit Procedure READ, without a
platform administrator role, could discover the descriptor but could not
execute it as an active release.
These observations establish local compilation and holdout replay correctness,
not a promoted cross-agent handoff, hosted deployment or measured advantage.
The [prospective protocol](../benchmarks/procedure-return/README.md) separately
reserves twelve unseen populations; its direct source arm passed all twelve,
while no qualified procedure was available for the paired arm.

The same audit found cross-caller idempotency reuse before authorization,
unbound replay task contents, and manual CRUD paths that could alter runtime
evidence or change a compiled SHADOW descriptor to ACTIVE. The reviewed changes
scope retry identity to the authenticated caller, bind canonical inputs to
server-created execution admission, retain the original route on retry, and
require owning lifecycle commands for compiled bindings and execution writes.
Manual unbound procedure descriptors retain generated CRUD and authorization.
These controls govern future API writes; they do not attest to old ACTIVE rows
or privileged direct database writes.

Workflow replay now uses terminal execution clocks and retains unknown spend
in both actual and estimated credit fields. A settled launch fee alone cannot
prove the complete cost of a workflow with separately billed provider actions.
Historical adapter observations that defaulted missing costs to zero do not
qualify under the new workflow evaluator revision. The private
[`shadow-replay` command](private-procedure-execution.md#run-a-frozen-shadow-holdout)
exposes the new admission path without adding marketplace tools.

The audit also found that private `memory_link` returned `linked` without a
backend write. The adapter now checks a versioned capability, submits one write
and reads the exact saved receipt before acknowledging it. The generated Lite
backend persists a ThorAPI-owned association, rechecks both endpoint grants and
physically cascades deletion. Actual Java 17 and Java 21 restart checks and a
real stdio MCP client qualify that local behavior. The local Cloud source passed
119 canonical tests, including permissions, persistence, concurrent replay,
rollback and billing, and exact receipt timestamps. Legacy backends remain
unsupported without a write.
Portable labels are navigation and do not enter governed temporal supersession
or answer evidence. [Protocol and verification](memory-associations.md)

Lite now follows owned memory associations during an explicit recall request.
It admits independently relevant neighbors and binds the selected paths to the
receipt's current source revisions. The frozen matched comparison improved
complete answer evidence from 4/9 to 6/9 and required abstention from 2/4 to 4/4.
Its linked-detail median increased from 6.59 to 18.00 ms and its context grew
from 197 to 295 bytes. These are local retrieval and policy measurements on
the same fixture. [Matched Lite results](../benchmarks/association-recall/matched-release-observed.json)

Graph traversal is an established comparator feature. Graphiti documents
breadth-first and distance-based search, and Hindsight documents spreading
activation in its recall API. A product comparison needs matched execution on
those systems with the same evidence and resource bounds. [Graphiti search](https://help.getzep.com/graphiti/working-with-data/searching) · [Hindsight recall](https://docs.hindsight.vectorize.io/api-reference/recall-memories/)


The same 14 inputs also ran through LangGraph's indexed InMemoryStore with a
fixed local lexical encoder. Its native top-K returned the anchor on the
linked-detail case. Wider search included the answer and an unlinked note.
The benchmark's one-hop application adapter recovered the query-free linked
answer that Lite omitted, and it also admitted the unrelated linked control.
Lite requires independently relevant neighbor text. This comparison measures
selected evidence across different storage and compilation contracts. [Frozen SDK comparison](../benchmarks/association-recall/langgraph/README.md)

The same fixture also ran through native Graphiti BM25 and one-hop traversal on
a supplied FalkorDB graph. Traversal found both linked-detail answers and returned
the unrelated, metadata-only and weak-seed neighbors. Lite excluded those three
controls and missed the query-free answer. Graphiti used a supplied graph with
zero model calls. The measurements cover retrieval and three source or edge
mutations. [Matched Graphiti observations](../benchmarks/association-recall/graphiti/matched.json)

Hindsight's native recall ran the same 14 cases and three lifecycle checks with
a local BGE model and PostgreSQL. Its default semantic pass admitted every
in-bank source, so graph on and graph off returned the same evidence. A separate
duplicate-seed calibration moved the answer from rank 21 to rank 1 with graph
recall enabled. Both calibration arms already returned the answer. The graph
uses undirected entity co-occurrence and the native LOW budget. [Matched Hindsight observations](../benchmarks/association-recall/hindsight/README.md)

A separate task comparison gave the same closed-schema dispatch consumer
evidence from native Lite, Graphiti, and Hindsight. An independent SQLite
judge checked packet contents and citations against complete authorized inputs.
Across 12 populations, Lite improved from 6 to 10 correct outcomes and
Graphiti from 6 to 12. Hindsight stayed at 12. Lite and Graphiti each dropped
from two unsupported conflict actions to zero. Lite still withheld both
answerable packets that required query-free detail. The consumer budget was
fixed across products, while the native retrieval settings differed.
[Matched dispatch tasks](../benchmarks/association-recall/dispatch-task/README.md)

A fresh offline Graphiti run reproduced every task decision on the frozen
dispatch set. The linked arm returned 12 of 12 correct packets with zero
unsupported actions. The original Lite and Hindsight captures stayed fixed.
[Graphiti reproduction](../benchmarks/association-recall/dispatch-task/observations/graphiti-reproduction-20261107.json)

The Cloud diagnostic ran both frozen query-free cases through the tenant-scoped
generated discovery service and the native typed graph tool. It derived the
target locator from the authorized relationship and received a scoped path
receipt in both cases. The frozen consumer withheld all four evaluations.
Receipt previews flattened the line break that identifies the structured `FACT`
record. This diagnostic exercises internal discovery and native graph
continuation. The test principals have `FREE` and `GRAYMATTER_USER` platform
roles and local organization `OWNER` memberships. A `MEMBER` fixture is a
separate authority control. [Cloud diagnostic](../benchmarks/association-recall/cloud-dispatch-query-free/README.md)

With paired ContextPage hydration, the same consumer and judge accepted both
frozen query-free packets with correct source attribution. Both hydrated
records came from one current typed receipt and distinct source pointers. The
hydrated target alone still yielded zero correct packets. Neither arm produced
an unsupported action. The Cloud diagnostic covers two internally discovered
cases. [Paired endpoint results](../benchmarks/association-recall/cloud-dispatch-typed-endpoints/README.md)

The owning checkout now includes paired compile, hydrate, prompt, fork, and
recompression support. The native lifecycle checked exact total-budget
hydration, original receipt and task binding, distinct endpoint identities,
and denial after repointing. Recompression retains its durable source and
result page links while suppressing the recursive JSON back-reference. The
owning suite passed 148 tests. The MCP public compile and hydrate adapters
passed 273 tests and preserved both captured native projections byte for byte.

Query-only discovery now passes the same two cases under a true organization
`MEMBER` with `GRAYMATTER_USER` and no platform Core role. A fixed ThorAPI
relationship resolves both endpoints from the original query. The six native
authority controls cover hidden decoys, supplied locators, effective READ
denial, MERGE revocation, and same-target and different-target ambiguity. The
owning suite passed 72 tests. The public discovery adapter passed 32 focused
tests and replayed both captured MEMBER responses through discovery, compile,
and hydration. [Query-only results](../benchmarks/association-recall/cloud-dispatch-query-discovery/README.md)

The full 12-task Cloud baseline retained the same frozen consumer and judge.
Paired ThorAPI and Bifrost evidence scored 8/12 with zero unsupported
actions, including both excluded-source abstentions. Three inputs exceeded
the filename column, and the remaining direct case had no relationship to
traverse. The single-source control initially hit a planner budget error on
all nine enrolled cases. After the exact traversal and generated target-read
fixes, all nine source reads succeeded and the single-source arm scored 3/12
under the frozen action policy. The paired arm stayed at 8/12. A post hoc
check that allowed action on an ordinary source caveat scored 4/12 and
produced one unsupported conflict action. [Full Cloud comparison](../benchmarks/association-recall/cloud-dispatch-full/README.md)

The long-body comparison stored every anchor intact in `ContentData.contentData`
and followed the generated owning relationship from the body to its media
record. Both arms were available on all 12 frozen tasks. Bifrost paired
evidence scored 10/12 and source-only scored 4/12, with zero unsupported
actions. The paired arm withheld both direct tasks, which had no supplied
relationship. READ and MERGE revocation independently denied the measured
receipt and page. [Native long-body comparison](../benchmarks/association-recall/cloud-dispatch-body/README.md)

The direct and conflict cases each had a readable single anchor, complete
query coverage, and the same generic evaluator score. The contrary detail
in the conflict cases fell outside that receipt. A future deterministic
workflow can use the invoice reconciliation pattern to capture its declared
source scope before executing. For these tasks it would need a unique body
match and an authoritative membership snapshot for the owning-FK children,
including a verified empty set. An empty ACL-filtered result cannot
establish that scope. The pinned output contract would need to withhold on
scope ambiguity, ACL or version changes, or an unverified output producer,
while keeping inaccessible source identities and counts private.
Score that as a separate arm with the same judge. [Task outcomes](../benchmarks/association-recall/cloud-dispatch-body/observations/results.json)

The terminal workflow event now carries bounded counts of execution-linked
usage and holds. In a native delegated run, the MEMBER could read the
committed count and replay the exact packet. The creator paid once, and
their payer and ledger identifiers stayed private. Total spend remains
unknown until settlement coverage is complete. [Terminal qualification](../.vaix/verification/workflow-billing-causality/terminal-staged/qualification.json)

ASTRA diagnosis now follows the exact module attempt selected by the workflow
evaluator. The terminal event binds that module event, its sequence, the Run,
and the execution recovery fence. The reader checks the current generated
READ grants for the execution, Run and immutable workflow version. It verifies
the task and module membership against the hashed version snapshot. The native
invoice workflow exercised the failure and the real SkillOptics diagnosis
module. A reviewer needed READ on all three objects, and revoking Run READ
denied proof on the next request. All 126 focused tests passed. Older runs can
still supply an inspection summary. Proposed regression fixtures require
separate holdout admission.
[Native workflow acceptance](../.vaix/verification/shared-rc7-native-tests.txt)

The internal failed-source trial uses a frozen compiler holdout and reserves two
separate immutable workflow executions in one transaction. Both arms run the
same three proposal stages, with inspection-only diagnosis in the baseline and
terminal-cause verification in the candidate. Each worker rechecks the source
witness and uses its own current `run_workflow` route. Retries preserve the
original admission receipts. Trial executions are excluded from ordinary
workflow learning. The native invoice fixture
compared the two outputs against the stored failed Run and event coordinates.
The baseline matched the structural inspection, the candidate verified the
terminal cause, and the source remained failed. All 122 focused tests passed.
[Native diagnostic trial](../.vaix/verification/shared-rc7-native-tests.txt)

The governed SkillOptics API freezes one baseline, compiled candidate, rubric
version and cohort hash for an experiment. Operators freeze the protocol at
`POST /skillopt_ops/candidates/{candidateRef}/diagnostic-protocol`, then submit a
frozen holdout capsule to `POST /skillopt_ops/candidates/{candidateRef}/diagnostic-trials`.
The assessment at `POST /skillopt_ops/candidates/{candidateRef}/diagnostic-trials/assess`
rechecks the source witness and reads each pinned workflow's persisted diagnosis
Run. It records the two categorical verdicts and output hashes as one private
assessment. These records are separate from Omega promotion scores and billing.
Tenant bundle 3.15.0 adds the two record types with required unique keys in
both exported dialects. PostgreSQL 17 verified fresh provisioning, repair of
missing tables, and sibling-role denial.
The native generated API fixture used six actual failed invoice executions and
froze four training cases and two holdouts. Both held-out pairs used the same
versions. The two baselines produced inspection-only verdicts, the two
candidates verified the terminal cause, and both failed sources stayed failed.
The API rejected a second valid baseline, returned stable receipts on retry,
and saved one assessment per case. The focused suites passed 121 distinct checks.
The wider prospective comparison and promotion evidence remain open.
[Generated API and tenant verification](../.vaix/verification/shared-rc7-native-tests.txt#L54)

The non-CORE organization path now reads workflow evidence and publishes the
exact candidate version in explicit CORE transactions. An authorized tenant
retry can rebind a committed CORE publication after tenant rollback. The
compiler compares the original evidence and graph intent without generated
audit timestamps. Diagnostic workers verify the admitted actor and organization
before routing or debit. In a provisioned local H2 organization schema, the
native test rolled back staging, reused the exact CORE version, and finished
freeze, launch, and assessment through generated ingress. Protocol and
assessment rows were confined to the organization schema. All 229 focused
checks passed. The same non-CORE generated API fixture passed on disposable
PostgreSQL 17.10 with a non-superuser database owner. It verified rollback
recovery, the same inspection-only and verified-terminal-cause outcomes, and
organization-only protocol and assessment rows. MySQL remains unqualified for
this application path.
[Organization-tenant native verification](../.vaix/verification/shared-rc7-native-tests.txt#L74)

On PostgreSQL with repeatable read, launch returned a conflict when its original
snapshot could not see a newly committed admission receipt. The route verifier
now reads admission and worker receipts in fresh transactions under the same
tenant and actor checks. After the new workflow controller received its
explicit CORE binding and the manifest was regenerated, native H2 and
PostgreSQL reruns passed. PostgreSQL verified the real isolation level,
organization schema and restricted runtime role. All 39 selected tests passed.
[PostgreSQL and snapshot verification](../.vaix/verification/shared-rc7-native-tests.txt#L88)

The generated `GET /skillopt_ops/candidates/{candidateRef}/diagnostic-qualification`
reports distinct held-out sources, revalidated pairs and terminal-cause counts.
It reads the current authorized source witness for every held-out case and
checks each recorded pair against its native executions, diagnosis outputs
and route receipts. A content-free digest binds the frozen artifacts and
each observed case. Only the explicit assessment operation records a pair.
`COMPLETE` means every frozen holdout has a revalidated output pair.
The native two-holdout case moved from incomplete at 1/2 to complete at 2/2.
The non-CORE fixture also verified that reads preserve assessments and that
artifact EXECUTE revocation denies the preview. All 45 selected checks passed
on the shared build, including H2 and repeatable-read PostgreSQL. Release
approval and cost settlement remain separate.
[Qualification verification](../.vaix/verification/shared-rc7-native-tests.txt#L110)

The larger native comparison assigned 100 source failures across four
contract defects and three immutable definitions per run. Both arms were
structurally correct on all 20 frozen holdouts on H2 and PostgreSQL.
The candidate verified the exact terminal witness on every case. The
PostgreSQL run independently checked persisted diagnosis outputs and
attributed one 10-credit gross launch debit to each of its 40 arms.
Training and foreign-source controls were rejected separately. The follow-up
settled all 20 pairs on the exact local graph. Native retries, competing
failure events, and business recovery remain unmeasured.
[Prospective cases and protocol](../benchmarks/procedure-return/README.md#prospective-failed-workflow-diagnosis)

SkillOptics now evaluates diagnostic release evidence from the frozen trial.
The assessment checks exact cause, regressions, measured p95 latency, and
both arms' current net receipts. Its digest binds the approval challenge
alongside the ordinary business-replay assessment. CORE decisions retain
the payer lock through commit and read a fresh ledger snapshot when the
transaction uses stricter isolation. Tenant-schema candidates can receive
the diagnostic assessment. An actionable cross-plane release still needs
a qualified commit boundary. [H2 and PostgreSQL release review](../benchmarks/procedure-return/observations/native-diagnostic-release-observed.json)

The ordinary workflow replay scorer now consumes verified net credits for the
exact local invoice graph. It requires the entire frozen cohort, a native
receipt for every arm, and an independently recomputed report from each
original task. A linked reversal invalidates the cohort's current price and
binds any later release decision to a fresh assessment hash. The native
equivalent graphs returned 20 correct held-out reports with 200 net credits
per arm. The unchanged business score kept the candidate in shadow.
[Ordinary business replay](../benchmarks/procedure-return/README.md#verified-credits-for-ordinary-business-replay)

The invoice join repair addresses a silent failure. All 96 source executions
reported success while returning the wrong report. The compiled revision fixed
one join key and improved exact report correctness from 0 of 20 to 20 of 20 on
frozen inputs, with 200 settled credits per arm. H2 and PostgreSQL 17.10 verified
separate promotion and binding approvals, a Bifrost-routed native canary with a
correct report, and a distinct authorized consumer executing the active version.
Historical training outcomes did not qualify as canary evidence. The result
covers the exact invoice graph and CORE actors in the isolated fixture.
[Native invoice repair](../benchmarks/procedure-return/README.md#native-invoice-join-repair)

The administrator Omega and SkillOptics endpoints now use the same rollback
transaction for a linked procedure. The H2 and PostgreSQL 17.10 fixtures paused a consumer
after its authorized route committed. It rolled back the binding, resumed the
consumer, and observed fallback with no new execution. An exact retry also
recovered the legacy split state with an evaluation missing and retained one
rollback command debit. Automatic rollback across several candidates remains open.
[Native rollback observations](../benchmarks/procedure-return/observations/native-invoice-rollback-observed.json)

Tenant admission now keeps the authorized procedure locked while the immutable
workflow is admitted in a separate CORE transaction. On physical PostgreSQL,
an invited member used a tenant route and received the independently verified
report from CORE. A second connection could not lock the tenant procedure
during admission. An exact retry returned the original execution and tenant
route receipt. After rollback, a previously committed route and a fresh route
both fell back with zero new executions. The fixture imported an existing
active binding. Tenant-priced promotion remains open.
[Physical tenant admission](../benchmarks/procedure-return/observations/native-tenant-procedure-admission-observed.json)

Zep's restore copies an earlier immutable skill into a new candidate that
must pass admission. Its request checks the expected current version. Zep can
also retire a skill from search while retaining its version history.
Letta versions agent memory in a Git-backed repository. LangGraph can fork
execution from a checkpoint and rerun downstream nodes. The matched release
test should hold an authorized workflow route across rollback and measure
whether it can still admit a new execution. Matched competitor runtime results
are still pending. [Zep version restore](https://help.getzep.com/v4/agent-skills/manage-skills) · [Zep retirement](https://help.getzep.com/v4/agent-skills/author-skills) · [Letta memory filesystem](https://github.com/letta-ai/letta-docs-md/blob/main/concepts/memfs/index.md) · [LangGraph checkpointers](https://github.com/langchain-ai/docs/blob/main/src/oss/langgraph/checkpointers.mdx)

LangMem takes trajectories and optional feedback as optimizer inputs. Acontext's
archived learner extracts lessons from reported failed tasks. Zep Cloud v4
captures attempt outcomes and verifier strength, and records skill use against
the version returned by search. These published interfaces establish different
parts of the evidence chain. A matched failure test should send a late result
from a stale worker and check whether each integration can recover the actual
terminal attempt and immutable executed workflow version. [LangMem input contract](https://github.com/langchain-ai/langmem/blob/8620b986af5b0c7593e6b7fbece2998690d22d15/src/langmem/prompts/types.py) · [Acontext failure distillation](https://github.com/memodb-io/Acontext/blob/1ddfd903fd1004672ca9f9a70d92041153ba43d5/src/server/core/acontext_core/llm/prompt/skill_distillation.py) · [Zep trace verification](https://help.getzep.com/v4/agent-skills/capture-traces) · [Zep version-bound use](https://help.getzep.com/v4/agent-skills/retrieve-skills)

Bifrost now rechecks a shared projection's private grant before returning
the page or using it in SkillOptics. The owning native test verified that
expiry or revocation withholds owner and recipient reads and the recorded
fork and recompression descendants. The owner could still read the original
page after revocation. Pinning could extend page retention only within the
separate authority boundary of the grant. Relation-free projections
still need separate source revision and connector synchronization coverage.
[Share authority qualification](../.vaix/verification/context-share-authority/qualification.json)

With 6,001 synthetic memories outside the requested source and three inside,
Lite now reads cached vectors only for the in-scope candidates. Both benchmark
orders preserved context and proof. Filtered median latency fell from 55.21 to
42.18 ms, then from 44.87 to 32.79 ms in reverse order. The unfiltered control
varied between pairs. [Same-library pressure probe](../benchmarks/association-recall/filtered-index-observed.json)

## Remaining gaps, in priority order

| Priority | Gap to close or quantify | Evidence that would settle it |
| --- | --- | --- |
| 1 | Hosted cross-agent handoff through a promoted procedure | A native persisted workflow binds the typed Bifrost receipt, Rune, paired page, and one SkillOptics observation to a pinned workflow version. A separate native organization MEMBER executed an owner's source deployment, produced the expected report, and replayed the one payer-owned charge. The hosted acceptance requires a distinct executor discovering and executing an actually promoted procedure, with the original dispatch, version, route and trajectory and the independently expected artifact. [Native delegation evidence](../tests/native-handoff/member-source-observed.json) |
| 2 | Conflicts and historical corrections an agent never explicitly tagged | The owning H2 test verifies ordered correction for ordinary MemoryEntry writes, including stale-worker rejection and exact-text restore. Evaluate arbitrary prose and connected sources with separate effective and recorded times, independent expected versions, and a negative control that merely mentions conflict. [Revision qualification](../.vaix/verification/memory-source-revision-fence/qualification.json) |
| 3 | Measured task return on independent, unseen runs | The native diagnostic and invoice trials each settled 20 paired holdouts. The invoice replay scorer verified exact reports and priced both arms from their ledger receipts. The equivalent graphs tied and stayed in shadow. Measure independently verified business improvement on a distinct repair candidate, native retry and stale-worker cases, and elapsed time and tokens. [Ordinary business replay](../benchmarks/procedure-return/README.md#verified-credits-for-ordinary-business-replay) |
| 4 | Connected source synchronization and grant changes | Local corrections, deletion, concurrent writes and stale receipt checks now have matched observations. Repeat the experiment with a real connector and a revoked grant. Measure the interval until every affected retrieval, context page and hydration reflects the change. |
| 5 | Head-to-head retrieval and task performance | Use identical fixtures, answer models, token budgets and judges. Report Recall@K, supported answer accuracy, abstention errors, task success, p50/p95 latency and cost per successful task. Publish denominators, configuration and failures. |
| 6 | Hosted association recall and production database behavior | Local ValkyrAI now carries one server-owned deadline across an async attempt and reserves time for durable finalization. The unchanged H2 test passed committed failure, reload and resume at the original 3,000 ms budget. Private PostgreSQL 17.10 passed physical provisioning, tenant isolation, upgrade, rollback and the association storage contract. Hosted recall and broader production-dialect replay remain acceptance checks. [Local verification](memory-associations.md) · [Native observations](../tests/memory-associations/recall/cloud-async-observed.json) |
| 7 | Query-based linked evidence and complete single-source evidence | The native typed-path case passed on H2 and PostgreSQL 17, including repointing, correction and grant revocation. The long-body H2 run admitted all 12 frozen inputs and qualified both measured revocation controls. Its two direct tasks still require a source-completeness decision that can distinguish actionable evidence from a conflict. Qualify live OAuth and additional relationship types. [Native typed-path case](../tests/memory-associations/recall/typed-graph-tool-observed.json) · [Long-body comparison](../benchmarks/association-recall/cloud-dispatch-body/README.md) |

The Dahlia packing-note fixture supplies an association label. A typed-path
control can instead ask for the customer name of a query-matched opportunity
and follow the generated `Opportunity.customer` property to `Customer.name`.
The existing graph citation records the path and schema versions. The next
check must also bind the selected endpoint projections to the receipt and
verify them on reuse. Pair that case with a readable, unrelated customer, a
repointed relationship and a corrected customer name.

The installed ValkyrAI patch exercised the generated, tenant-owned
`ContentMediaLink.contentData` relationship. The native graph tool returned
the query-free target with `ALLOW_WITH_CAVEAT`, preserved lexical similarity
at zero, and excluded a readable unlinked target. The receipt GET retained
the typed citation and revision proof with text fields redacted. ContextPage
initially discarded the target at its lexical relevance check. The repaired
compiler kept the one verified item for the original task. All 361 local
tests passed, including hydration, workflow prompt generation, and SkillOptics
route admission. Repointing the link blocked receipt, page, prompt and route
reuse. Correcting the target or revoking its composition grant blocked the
affected receipt. The owning checkout matched all 35 qualified source
postimages after installation. A private PostgreSQL 17 run passed the same
journey with generated tenant tables and a restricted runtime role.
[Tool and receipt observations](../tests/memory-associations/recall/typed-graph-tool-observed.json)

Workflow Studio now carries the original receipt into ContextPage
compilation. The native H2 bridge passed the scoped Rune, withheld at the
ordinary answer gate, and kept module outputs free of source text. A new task,
another actor, or a repointed relationship could not reuse the scoped
evidence. The bridge was installed after 39 passing tests. This verifies the
modules and Rune through the workflow input mapper. The persisted promoted
handoff remains a separate test. [Workflow configuration](../examples/workflows/README.md#reuse-a-typed-graph-receipt)

The persisted native workflow executes that typed gate in a real worker. It
binds the original receipt and paired page to an immutable workflow version
and one durable SkillOptics observation. The tenant-source observation adapter
establishes the signed-in actor's tenant scope before normalization. A revoked
composition grant withholds both a fresh workflow effect and direct
normalization replay, while the original observation remains in history.
All 68 selected workflow and adapter tests passed.

The signed-in read-only recheck compared seven visible hosted executions,
ten route receipts and five procedures. Two successful non-billable sandbox
runs shared a pinned version and each had a matching terminal route. The
terminal acceptance case is the stronger historical control because it was
designed to check terminal receipt binding. The selected route says
`run_workflow`, and the only visible version-bound procedure is still in
shadow. Both successful sandbox runs have `testMode: false`. The selected
execution has no original dispatch key or procedure admission, and its route
has no ContextPage. Direct signed-in lookup did not find the worker Run.
The execution-only verifier reported `incomplete` on a fixture from that
readback. Omega linkage and independent business-result verification remain open.
[Hosted selection and qualification](../tests/native-handoff/hosted-selection.json)

For priority 2, the hosted typed-assertion contract already accepts independent
effective and recorded dates. The [temporal reconstruction checks](temporal-reconstruction-contract.md)
cover a late correction with a fixed effective date, along with current access
to the predecessor and successor. Lite's weekday clarification does not resolve
supersession or contradictions in arbitrary prose.

GrayMatter’s existing harness can measure retrieval and context on pinned LoCoMo, LongMemEval and Valkyr workflow cases. Its Recall@K denominator counts evidence sessions. Answer accuracy and execution success need separate evaluation. Use the existing release evidence process for any public comparative claim. [Benchmark harness](../benchmarks/README.md) · [LongMemEval tasks](https://github.com/xiaowu0162/longmemeval) · [GrayMatter release evidence](omegarag-release-evidence.md)
