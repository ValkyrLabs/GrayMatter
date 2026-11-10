import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.valkyrlabs.model.WorkflowExecution;
import com.valkyrlabs.model.WorkflowExecutionService;
import com.valkyrlabs.model.WorkflowVersion;
import com.valkyrlabs.model.WorkflowVersionService;
import com.valkyrlabs.workflow.TestModuleConfig;
import com.valkyrlabs.workflow.modules.operations.InvoiceReferenceReportModule;
import com.valkyrlabs.workflow.modules.operations.InvoiceReferenceSnapshot;
import com.valkyrlabs.workflow.modules.transform.JoinModule;
import com.valkyrlabs.workflow.service.WorkflowBusinessResultService;
import com.valkyrlabs.workflow.service.WorkflowExecutionComparisonService;
import com.valkyrlabs.workflow.service.WorkflowGraphTemplateService;
import com.valkyrlabs.workflow.service.GoalSupervisionBusinessResultProjection;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import static org.mockito.Mockito.*;

/** Run actual catalog modules and the actual result projection with synthetic identity rows. */
public class GrayMatterProcedureResultInterop {
    public static void main(String[] args) throws Exception {
        var json = new ObjectMapper().findAndRegisterModules();
        var graph = new WorkflowGraphTemplateService(json)
            .materialize("invoice-customer-reconciliation", Map.of("DEFINITION_KEY", "interop-test")).graph();
        var customer = new UUID(1, 1);
        var source = new InvoiceReferenceSnapshot(List.of(
            new InvoiceReferenceSnapshot.InvoiceRef(new UUID(2, 1), customer),
            new InvoiceReferenceSnapshot.InvoiceRef(new UUID(2, 2), new UUID(1, 2))),
            List.of(new InvoiceReferenceSnapshot.CustomerRef(customer)));
        var join = new JoinModule();
        var module = graph.getModules().getFirst();
        if (!module.getClassName().equals(join.getClass().getName())) throw new AssertionError("wrong join");
        TestModuleConfig.applyJsonConfig(join, module.getExecModuleConfig().getPayloadConfig().getParameters());
        Map<String,Object> task = json.convertValue(Map.of("task", source.task()), new TypeReference<>() {});
        join.setInputMap(task);
        join.execute();
        var report = new InvoiceReferenceReportModule();
        if (!graph.getModules().get(1).getClassName().equals(report.getClass().getName())) throw new AssertionError("wrong report");
        var joined = new HashMap<>(task);
        joined.putAll(join.getOutputMap());
        report.setInputMap(joined);
        report.execute();

        var definition = json.createObjectNode();
        definition.set("submittedGraph", json.valueToTree(graph));
        String snapshot = definition.toString();
        String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(snapshot.getBytes(StandardCharsets.UTF_8)));
        UUID workflow = new UUID(3,1), version = new UUID(3,2), execution = new UUID(3,3);
        var versions = mock(WorkflowVersionService.class);
        when(versions.findById(version)).thenReturn(Optional.of(new WorkflowVersion().id(version).workflowId(workflow)
            .contentHash(hash).definitionSnapshot(snapshot)));
        var executions = mock(WorkflowExecutionService.class);
        var row = new WorkflowExecution().id(execution).workflowId(workflow).workflowVersionId(version)
            .definitionSnapshotHash(hash).state(WorkflowExecution.StateEnum.SUCCESS).testMode(false)
            .contextData(json.writeValueAsString(report.getOutputMap()));
        when(executions.findById(execution)).thenReturn(Optional.of(row));
        // No hosted fixture verdict: this check computes its own expectation from the original two invoices.
        var comparisons = mock(WorkflowExecutionComparisonService.class, CALLS_REAL_METHODS);
        var goalSupervision = mock(GoalSupervisionBusinessResultProjection.class);
        var actual = new WorkflowBusinessResultService(executions, versions, comparisons, goalSupervision, json).read(execution);
        if (!"available".equals(actual.status()) || !"unverified".equals(actual.correctness())) throw new AssertionError("result unavailable");
        verifyNoInteractions(goalSupervision);
        Files.writeString(Path.of(args[0]), json.writeValueAsString(Map.of(
            "response", actual, "expected", source.expected(), "workflowVersionId", version,
            "executionId", execution, "workflowId", workflow, "definitionSnapshotHash", hash)));
    }
}
