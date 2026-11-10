package com.valkyrlabs.valkyrai.sagechat;

import com.valkyrlabs.graymatter.benchmarks.ProcedureReturnProbe;
import com.valkyrlabs.model.WorkflowDeployment;
import com.valkyrlabs.valkyrai.service.Api0DataPlaneBindingManifest;
import com.valkyrlabs.valkyrai.service.OperationDataPlaneScope;
import com.valkyrlabs.valkyrai.service.OperationDataPlaneScopeContext;
import com.valkyrlabs.workflow.controller.WorkflowController;
import com.valkyrlabs.workflow.service.WorkflowGraphSaveService;
import com.valkyrlabs.workflow.service.WorkflowGraphTemplateService;
import java.nio.file.Path;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;

class SourceProcedureReturnJpaTest extends CausalGrayMatterNativeHandoffJpaTest {
  private <T> T invoke(UUID owner, String operation, Supplier<T> action) {
    var binding = Api0DataPlaneBindingManifest.load().requireHandlerBinding(WorkflowController.class, operation);
    return OperationDataPlaneScopeContext.callWith(OperationDataPlaneScope.core(binding.modelBinding()),
        () -> users.runAsPrincipal(owner, action));
  }

  @Test
  void sourceOnly() throws Exception {
    var setupBinding = Api0DataPlaneBindingManifest.load().requireHandlerBinding(
        com.valkyrlabs.workflow.controller.WorkflowTestingController.class, "startTestRun");
    var owner = OperationDataPlaneScopeContext.callWith(OperationDataPlaneScope.core(setupBinding.modelBinding()), () -> {
      var member = actor("procedure-return", organization("return-cohort"));
      welcomeCredits.ensureSignupWelcomeCredits(member);
      return member;
    });
    var graph = new WorkflowGraphTemplateService(mapper).materialize("invoice-customer-reconciliation",
        Map.of("DEFINITION_KEY", "prospective-invoice-source-" + UUID.randomUUID())).graph();
    var schema = (com.fasterxml.jackson.databind.node.ObjectNode) mapper.readTree(graph.getWorkflow().getLaunchInputSchema());
    schema.put("additionalProperties", false);
    graph.getWorkflow().setLaunchInputSchema(schema.toString());
    var saved = invoke(owner, "saveWorkflowGraph", () -> application.getBean(WorkflowGraphSaveService.class)
        .saveWorkflowGraph(graph));
    var controller = application.getBean(WorkflowController.class);
    var source = saved.getWorkflowVersion().getId();
    var draft = invoke(owner, "createDeployment", () -> controller.createDeployment(source,
        new WorkflowController.DeploymentDraftRequest(WorkflowDeployment.EnvironmentEnum.SANDBOX, "{}", "{}", "[]")));
    var active = invoke(owner, "activateDeployment", () -> controller.activateDeployment(draft.getId()));
    // Deployment rows are private. Ownership alone carries no execution permission on this endpoint.
    invoke(owner, "executeDeployment", () -> new org.springframework.transaction.support.TransactionTemplate(transactions)
        .execute(status -> {
          acl.grantPermission(new org.springframework.security.acls.domain.ObjectIdentityImpl(WorkflowDeployment.class, active.getId()),
              owner.toString(), com.valkyrlabs.thorapi.config.impl.ValkyrACL.mapStringToPermission("EXECUTE"));
          return null;
        }));
    new ProcedureReturnProbe(application, owner).run(Path.of(System.getProperty("graymatter.return.tasks")),
        Path.of(System.getProperty("graymatter.return.observations")), active.getId(), source, null, null);
  }
}
