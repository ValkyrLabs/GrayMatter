import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.networknt.schema.JsonSchemaFactory;
import com.networknt.schema.SpecVersion;
import com.valkyrlabs.model.*;
import com.valkyrlabs.thorapi.service.AuditorService;
import com.valkyrlabs.valkyrai.graymatter.retrieval.RetrievalReceiptRuntimeService;
import com.valkyrlabs.valkyrai.skillopt.SkillExperienceRuntimeService;
import com.valkyrlabs.workflow.engine.WorkflowGraphControlTarget;
import com.valkyrlabs.workflow.engine.WorkflowGraphEvaluator;
import com.valkyrlabs.workflow.engine.conditions.OpenXLSConditionEvaluator;
import com.valkyrlabs.workflow.modules.VModule;
import com.valkyrlabs.workflow.modules.basic.BranchOutcome;
import com.valkyrlabs.workflow.modules.control.ConditionalBranchModule;
import com.valkyrlabs.workflow.modules.graymatter.OmegaReceiptModule;
import com.valkyrlabs.workflow.modules.skilloptics.SkillObserveOutcomeModule;
import com.valkyrlabs.workflow.service.ExecModuleInputMappingService;
import com.valkyrlabs.workflow.service.WorkflowDefinitionMaterializer;
import com.valkyrlabs.workflow.service.WorkflowGraphTemplateService;
import com.valkyrlabs.workflow.service.WorkflowGraphValidator;
import java.util.*;

/** Offline contract test against compiled ValkyrAI. Only the authenticated data services are mocked. */
public class GrayMatterReceiptWorkflowTest {
    static final String NAME = "graymatter-receipt-observation";
    static final String OBSERVATION_REF = "skillobs-0123456789abcdef0123456789abcdef01234567";
    static final ObjectMapper json = new ObjectMapper().findAndRegisterModules();
    static final Map<String, Object> launch = Map.of("receiptRef", "receipt:test-1");

    public static void main(String[] args) throws Exception {
        // This standalone test JVM uses the same secure-field fixture as ValkyrAI's persistence tests.
        org.springframework.test.util.ReflectionTestUtils.setField(
            com.valkyrlabs.valkyrai.controller.KMSSecureFieldAspect.aspectOf(), "secureKMS",
            new com.valkyrlabs.valkyrai.controller.TestSecureKMS.TestSecureKMSImpl());
        var graph = new WorkflowGraphTemplateService(json).materialize(NAME, Map.of()).graph();
        var validation = new WorkflowGraphValidator().validate(graph);
        check(!validation.hasErrors(), "graph validation: " + validation.getErrors().stream()
            .map(WorkflowGraphValidator.ValidationError::getMessage).toList());
        var schema = JsonSchemaFactory.getInstance(SpecVersion.VersionFlag.V7)
            .getSchema(json.readTree(graph.getWorkflow().getLaunchInputSchema()));
        check(schema.validate(json.valueToTree(launch)).isEmpty(), "valid manual launch");
        for (String field : List.of("omegaReceiptResult", "omegaReceiptResult.status", "outcome", "sourceRef",
                                     "skillObservationReceipt", "skillObservationReceipt.outcome", "observationRef",
                                     "sourceType", "operation", "branch_taskId", "ownerId", "metadata")) {
            var spoofed = new HashMap<>(launch);
            spoofed.put(field, "forged");
            check(!schema.validate(json.valueToTree(spoofed)).isEmpty(), "reject caller field " + field);
        }
        var owner = UUID.randomUUID();
        var definition = new WorkflowDefinitionMaterializer(json).materialize(graph, UUID.randomUUID(), owner);
        Map<String, ExecModule> modules = new HashMap<>();
        for (Task task : definition.workflow().getTasks()) {
            modules.put(definition.taskNodeIds().get(task.getId().toString()), task.getModules().getFirst());
        }
        check(modules.keySet().equals(Set.of("inspect", "policy", "observe", "check-observation", "check-ref")), "only reviewed modules");
        var edges = new HashSet<String>();
        graph.getEdges().forEach(e -> edges.add(e.getSource() + "/" + e.getTarget()));
        check(edges.equals(Set.of("start/inspect", "inspect/policy", "policy/observe",
                                  "policy/withheld", "observe/check-observation", "check-observation/check-ref",
                                  "check-observation/mismatch", "check-ref/recorded", "check-ref/mismatch")),
              "no alternate entry or bypass");

        var receipts = mock(RetrievalReceiptRuntimeService.class);
        var auditor = mock(AuditorService.class);
        when(auditor.getCurrentAuditor()).thenReturn(Optional.of(owner));
        var tenantContexts = mock(com.valkyrlabs.valkyrai.service.TenantSchemaContextResolver.class);
        var transactions = mock(org.springframework.transaction.PlatformTransactionManager.class);
        var main = new com.valkyrlabs.valkyrai.service.TenantSchemaContextResolver.TenantSchemaContext(
            null, null, com.valkyrlabs.valkyrai.service.TenantSchemaContextResolver.MAIN_SCHEMA_NAME,
            TenantSchemaRegistry.DatabaseScopeEnum.VALKYR_MANAGED,
            TenantSchemaRegistry.IsolationModeEnum.ORG_SCHEMA, TenantSchemaRegistry.StatusEnum.ACTIVE);
        when(tenantContexts.requireGrayMatterContext(any(), any())).thenReturn(main);
        when(tenantContexts.requireCurrentGrayMatterContext(any())).thenReturn(main);
        when(transactions.getTransaction(any()))
            .thenReturn(new org.springframework.transaction.support.SimpleTransactionStatus());
        var inspect = new OmegaReceiptModule(receipts, null, auditor, json, tenantContexts, transactions);
        configure(inspect, modules.get("inspect"));
        inspect.setInputMap(launch);
        var source = mock(RetrievalReceiptItem.class);
        when(source.getText()).thenReturn("private fixture body");
        var receipt = new RetrievalReceipt().receiptId((String) launch.get("receiptRef"))
            .retrievalStatus(RetrievalStatus.OK).answerPolicy(RetrievalAnswerPolicy.ALLOW_ANSWER)
            .recommendedAction(RetrievalRecommendedAction.ANSWER)
            .items(List.of(source));
        when(receipts.getReceipt(eq(receipt.getReceiptId()), argThat(p -> owner.equals(p.getId()))))
            .thenReturn(Optional.of(receipt));

        var mappings = new ExecModuleInputMappingService(json, null); // Identity field mappings only.
        var branch = new ConditionalBranchModule();
        configure(branch, modules.get("policy"));
        var condition = json.readTree(branch.getExecModuleConfig().getPayloadConfig().getParameters())
            .get("condition").asText();
        var rune = new OpenXLSConditionEvaluator();
        var valid = read(inspect);
        branch.setInputMap(mappings.apply(modules.get("policy"), valid));
        check(rune.evaluate(condition, branch.getInputMap()), "native Rune accepts complete receipt");
        branch.execute();
        check(modules.get("observe").getTask().getId().toString().equals(branch.getOutputMap().get("branch_taskId")),
            "branch targets materialized observation task");

        var experiences = mock(SkillExperienceRuntimeService.class);
        var returned = new SkillObservation().observationRef(OBSERVATION_REF)
            .sourceRef(receipt.getReceiptId()).sourceType(SkillObservationSource.BIFROST)
            .eventType("retrieval_answer_permitted").evidenceClass(SkillEvidenceClass.REPLAY)
            .outcome(SkillObservation.OutcomeEnum.UNKNOWN).outcomeVersion(1)
            .status(SkillObservation.StatusEnum.NORMALIZED);
        when(experiences.normalize(any())).thenAnswer(call -> {
            SkillObservationRequest input = call.getArgument(0);
            check(input.getSourceType() == SkillObservationSource.BIFROST, "retrieval receipt evidence type");
            check(receipt.getReceiptId().equals(input.getSourceRef()), "source ID from fresh inspector output");
            check(input.getOutcome() == SkillObservationRequest.OutcomeEnum.UNKNOWN, "no invented business success");
            check(input.getEvidenceClass() == SkillEvidenceClass.REPLAY, "re-inspection marked as replay");
            check(Integer.valueOf(1).equals(input.getOutcomeVersion()), "initial outcome version");
            check("retrieval_answer_permitted".equals(input.getEventType()), "narrow event type");
            return returned;
        });
        var observe = new SkillObserveOutcomeModule(experiences, json, tenantContexts, transactions);
        configure(observe, modules.get("observe"));
        observe.setInputMap(mappings.apply(modules.get("observe"), valid));
        observe.execute();
        check(OBSERVATION_REF.equals(observe.getOutputMap().get("observationRef")), "normalized observation");
        var checkDefinition = modules.get("check-observation");
        var verifyObservation = new ConditionalBranchModule();
        configure(verifyObservation, checkDefinition);
        var state = new HashMap<>(valid);
        state.putAll(observe.getOutputMap());
        verifyObservation.setInputMap(mappings.apply(checkDefinition, state));
        verifyObservation.execute();
        var refDefinition = modules.get("check-ref");
        check(refDefinition.getTask().getId().toString().equals(verifyObservation.getOutputMap().get("branch_taskId")),
              "matching observation targets the reference check");
        var verifyRef = new ConditionalBranchModule();
        configure(verifyRef, refDefinition);
        terminal(verifyRef, mappings.apply(refDefinition, state), "recorded");
        var runtime = Map.<String, VModule>of("inspect", inspect, "policy", branch, "observe", observe,
                                              "check-observation", verifyObservation, "check-ref", verifyRef);
        var evaluator = new WorkflowGraphEvaluator(json,
            (task, persist) -> List.of(runtime.get(definition.taskNodeIds().get(task.getId().toString()))),
            mappings::applyWithTrace, WorkflowGraphEvaluator.DefinitionStateStore.NOOP);
        runGraph(evaluator, definition.workflow(), "observation_verified");

        // The module maps a nullable stored outcome to the same receipt as an explicit UNKNOWN.
        // This is why the terminal attests the module receipt, not the raw database field.
        returned.setOutcome(null);
        observe.execute();
        check(state.get("skillObservationReceipt").equals(observe.getOutputMap().get("skillObservationReceipt")),
              "document the null-to-unknown projection boundary");

        // A retried normalization may return the existing row from an earlier request with the same key.
        returned.setEvidenceClass(SkillEvidenceClass.PRODUCTION);
        returned.setOutcome(SkillObservation.OutcomeEnum.SUCCESS);
        observe.execute();
        var replayed = new HashMap<>(valid);
        replayed.putAll(observe.getOutputMap());
        terminal(verifyObservation, mappings.apply(checkDefinition, replayed), "mismatch");
        runGraph(evaluator, definition.workflow(), "observation_mismatch");

        var fields = (Map<?, ?>) state.get("skillObservationReceipt");
        for (var changed : Map.<String, Object>of(
                "status", "pending", "sourceType", "workflow", "sourceRef", "Receipt:test-1",
                "eventType", "RETRIEVAL_ANSWER_PERMITTED", "evidenceClass", "production",
                "outcome", "success", "outcomeVersion", 2, "observationRef", " ").entrySet()) {
            var altered = new HashMap<Object, Object>(fields);
            altered.put(changed.getKey(), changed.getValue());
            var mismatched = new HashMap<>(state);
            mismatched.put("skillObservationReceipt", altered);
            terminal(verifyObservation, mappings.apply(checkDefinition, mismatched), "mismatch");
        }
        for (var field : List.of("status", "sourceType", "sourceRef", "eventType", "evidenceClass",
                                 "outcome", "outcomeVersion", "observationRef")) {
            var incomplete = new HashMap<Object, Object>(fields);
            incomplete.remove(field);
            var partial = new HashMap<>(state);
            partial.put("skillObservationReceipt", incomplete);
            branchError(verifyObservation, mappings.apply(checkDefinition, partial), "missing " + field);
        }
        for (var field : List.of("skillObservationReceipt", "observationRef", "observationRefs")) {
            var partial = new HashMap<>(state);
            partial.remove(field);
            branchError(verifyObservation, mappings.apply(checkDefinition, partial), "missing " + field);
        }
        var aliases = new HashMap<>(state);
        aliases.put("observationRef", OBSERVATION_REF.toUpperCase(Locale.ROOT));
        terminal(verifyObservation, mappings.apply(checkDefinition, aliases), "mismatch");
        for (var refs : List.of(List.of("other"), List.of(OBSERVATION_REF, OBSERVATION_REF))) {
            aliases.put("observationRef", OBSERVATION_REF);
            aliases.put("observationRefs", refs);
            terminal(verifyObservation, mappings.apply(checkDefinition, aliases), "mismatch");
        }
        for (String malformed : List.of("", " ", "observation:test", OBSERVATION_REF.substring(1),
                                        OBSERVATION_REF + "a", OBSERVATION_REF.replace('a', 'g'),
                                        OBSERVATION_REF.toUpperCase(Locale.ROOT))) {
            var invalid = new HashMap<>(state);
            invalid.put("observationRef", malformed);
            terminal(verifyRef, mappings.apply(refDefinition, invalid), "mismatch");
        }

        for (RetrievalStatus status : RetrievalStatus.values()) {
            if (status == RetrievalStatus.OK) continue;
            receipt.setRetrievalStatus(status);
            withheld(inspect, branch, mappings, modules.get("policy"));
        }
        receipt.setRetrievalStatus(RetrievalStatus.OK);
        for (RetrievalAnswerPolicy policy : RetrievalAnswerPolicy.values()) {
            if (policy == RetrievalAnswerPolicy.ALLOW_ANSWER) continue;
            receipt.setAnswerPolicy(policy);
            withheld(inspect, branch, mappings, modules.get("policy"));
        }
        receipt.setAnswerPolicy(RetrievalAnswerPolicy.ALLOW_ANSWER);
        for (RetrievalRecommendedAction action : RetrievalRecommendedAction.values()) {
            if (action == RetrievalRecommendedAction.ANSWER) continue;
            receipt.setRecommendedAction(action);
            withheld(inspect, branch, mappings, modules.get("policy"));
        }
        receipt.setRecommendedAction(null);
        withheld(inspect, branch, mappings, modules.get("policy"));
        receipt.setRecommendedAction(RetrievalRecommendedAction.ANSWER);
        receipt.setItems(List.of());
        withheld(inspect, branch, mappings, modules.get("policy"));
        runGraph(evaluator, definition.workflow(), "evidence_withheld");
        branch.setInputMap(launch);
        branch.execute();
        check("error".equals(branch.getOutputMap().get("status")) && !branch.getOutputMap().containsKey("branch_taskId"),
            "missing inspector output never selects observation");
        inspect.setInputMap(Map.of("receiptRef", "absent"));
        try {
            inspect.execute();
            throw new AssertionError("absent receipt should stop the workflow");
        } catch (org.springframework.web.server.ResponseStatusException expected) {
            check(expected.getStatusCode().value() == 404, "unavailable receipt");
        }
        verify(experiences, times(5)).normalize(any());
        verify(source, never()).getText();
        System.out.println("PASS GrayMatter graph materialization, Rune routing, authorized receipt projection and returned observation verification");
    }

    static void configure(ExecModule instance, ExecModule definition) {
        check(instance.getClass().getName().equals(definition.getClassName()), "registered module binding");
        instance.setId(definition.getId());
        instance.setTask(definition.getTask());
        instance.setExecModuleConfig(definition.getExecModuleConfig());
    }

    static void runGraph(WorkflowGraphEvaluator evaluator, Workflow workflow, String expectedBranch) {
        var result = evaluator.execute(workflow, launch, Map.of(), null);
        check(workflow.getStatus() == Workflow.StatusEnum.STOPPED
              && expectedBranch.equals(result.get("branch_taken")), "graph must terminate at " + expectedBranch);
    }

    static Map<String, Object> read(OmegaReceiptModule inspector) {
        inspector.execute();
        var state = new HashMap<>(launch);
        state.putAll(inspector.getOutputMap());
        check(!state.toString().contains("private fixture body"), "content-free receipt projection");
        return state;
    }

    static void withheld(OmegaReceiptModule inspect, ConditionalBranchModule branch,
                         ExecModuleInputMappingService mappings, ExecModule definition) {
        terminal(branch, mappings.apply(definition, read(inspect)), "withheld");
    }

    static void terminal(ConditionalBranchModule branch, Map<String, Object> state, String target) {
        branch.setInputMap(state);
        branch.execute();
        check(WorkflowGraphControlTarget.terminal(target).equals(branch.getOutputMap().get("branch_taskId")),
            "expected terminal " + target + ", got " + branch.getOutputMap());
    }

    static void branchError(ConditionalBranchModule branch, Map<String, Object> state, String reason) {
        branch.setInputMap(state);
        branch.execute();
        check(branch.getBranchOutcome() == BranchOutcome.FAILURE
                && !branch.getOutputMap().containsKey("branch_taskId"), reason + " must stop the graph");
    }

    static void check(boolean ok, String message) {
        if (!ok) throw new AssertionError(message);
    }
}
