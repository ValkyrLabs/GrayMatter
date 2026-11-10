package com.valkyrlabs.graymatter.benchmarks;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.valkyrlabs.api.SkilloptOpsApiController;
import com.valkyrlabs.api.SkilloptOpsApiDelegate;
import com.valkyrlabs.model.*;
import com.valkyrlabs.thorapi.config.impl.ValkyrACL;
import com.valkyrlabs.valkyrai.service.Api0DataPlaneBindingManifest;
import com.valkyrlabs.valkyrai.service.OperationDataPlaneScope;
import com.valkyrlabs.valkyrai.service.OperationDataPlaneScopeContext;
import com.valkyrlabs.valkyrai.service.SystemUserService;
import com.valkyrlabs.valkyrai.skillopt.SkillWorkflowPromotionEvidence;
import com.valkyrlabs.workflow.controller.WorkflowController;
import com.valkyrlabs.workflow.controller.WorkflowEngineeringController;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;
import java.util.function.Supplier;
import org.springframework.context.ApplicationContext;
import org.springframework.security.core.context.SecurityContextHolder;

/** In-process, isolated-fixture client of the native secured operations. Takes task inputs only. */
public final class ProcedureReturnProbe {
  private final ApplicationContext app;
  private final UUID owner;
  private final ObjectMapper json;
  private final Api0DataPlaneBindingManifest manifest = Api0DataPlaneBindingManifest.load();
  private record Release(String candidate, String experiment, String procedure, String mechanism, UUID version) {}

  public ProcedureReturnProbe(ApplicationContext app, UUID owner) {
    this.app = app;
    this.owner = owner;
    this.json = app.getBean(ObjectMapper.class);
  }

  // Call outside any ambient operation frame. Each public operation gets its own real manifest binding.
  private <T> T call(Class<?> handler, String method, Supplier<T> work) {
    var binding = manifest.requireHandlerBinding(handler, method);
    if (!binding.allowedScopes().contains(OperationDataPlaneScope.ScopeKind.CORE))
      throw new IllegalArgumentException("Handler lacks CORE placement");
    return OperationDataPlaneScopeContext.callWith(OperationDataPlaneScope.core(binding.modelBinding()),
        () -> app.getBean(SystemUserService.class).runAsPrincipal(owner, () -> {
          var auth = SecurityContextHolder.getContext().getAuthentication();
          if (!owner.equals(ValkyrACL.resolveAuthenticatedPrincipalId()) || auth == null
              || auth.getAuthorities().stream().anyMatch(a -> List.of("ROLE_ADMIN", "ROLE_SUPER_ADMIN").contains(a.getAuthority())))
            throw new IllegalStateException("An ordinary fixture owner must execute both arms");
          return work.get();
        }));
  }

  private Release release(String ref) {
    return call(SkilloptOpsApiController.class, "executeSkilloptProcedure", () -> {
      var candidates = app.getBean(SkillImprovementCandidateService.class)
          .findSkillImprovementCandidateByCandidateRef(ref).stream()
          .filter(c -> owner.equals(c.getOwnerId()) && ref.equals(c.getCandidateRef())
              && !Boolean.TRUE.equals(c.getTrashed()) && c.getStatus() == SkillCandidateStatus.BINDING).toList();
      if (candidates.size() != 1) throw new IllegalStateException("A uniquely bound candidate is required");
      var candidate = candidates.get(0);
      var experiments = app.getBean(OmegaRetrievalExperimentService.class)
          .findOmegaRetrievalExperimentByExperimentId(candidate.getExperimentRef()).stream()
          .filter(e -> owner.equals(e.getOwnerId()) && candidate.getTenantId().equals(e.getTenantId())
              && e.getStatus() == OmegaExperimentStatus.APPLIED && !Boolean.TRUE.equals(e.getTrashed())).toList();
      if (experiments.size() != 1) throw new IllegalStateException("Applied experiment missing");
      app.getBean(SkillWorkflowPromotionEvidence.class).require(experiments.get(0), candidate, owner);
      var procedures = app.getBean(ProcedureService.class).findProcedureByProcedureRef(candidate.getActivationRef()).stream()
          .filter(p -> owner.equals(p.getOwnerId()) && candidate.getTenantId().equals(p.getTenantId())
              && !Boolean.TRUE.equals(p.getTrashed()) && Boolean.TRUE.equals(p.getEnabled())
              && p.getLifecycleStatus() == Procedure.LifecycleStatusEnum.ACTIVE
              && p.getWorkflowBindingStatus() == Procedure.WorkflowBindingStatusEnum.ACTIVE).toList();
      if (procedures.size() != 1) throw new IllegalStateException("Active immutable procedure missing");
      var procedure = procedures.get(0);
      return new Release(ref, candidate.getExperimentRef(), procedure.getProcedureRef(),
          procedure.getMechanizationReceiptRef(), procedure.getWorkflowVersionId());
    });
  }

  /** A null candidate runs the source arm and records every unattempted procedure opportunity explicitly. */
  public void run(Path tasksPath, Path outputPath, UUID deploymentId, UUID sourceVersion,
      String candidateRef, Function<String, SkillOptRouteRequest> routeForCase) throws IOException {
    var tasks = json.readTree(tasksPath.toFile());
    if (!tasks.isArray() || tasks.size() != 12) throw new IllegalArgumentException("Expected 12 frozen tasks");
    Release release = candidateRef == null ? null : release(candidateRef);
    if (release != null && (sourceVersion.equals(release.version()) || routeForCase == null))
      throw new IllegalArgumentException("The source and routed procedure require distinct version bindings");
    Files.createFile(outputPath);
    for (var entry : tasks) {
      String id = entry.required("id").textValue();
      String first = entry.required("first").textValue();
      var task = entry.required("task");
      for (String arm : List.of(first, "source".equals(first) ? "procedure" : "source")) {
        var row = json.createObjectNode().put("id", id).put("arm", arm).put("ownerId", owner.toString())
            .put("inputSnapshotRef", task.required("snapshotRef").textValue())
            .put("sourceDeploymentId", deploymentId.toString()).put("sourceVersion", sourceVersion.toString());
        if ("procedure".equals(arm) && release == null) {
          row.put("status", "no-qualified-release");
        } else {
          var inputs = Map.<String,Object>of("task", json.convertValue(task, new TypeReference<Map<String,Object>>() {}));
          long start = System.nanoTime();
          try {
            UUID executionId;
            if ("source".equals(arm)) {
              var directInputs = new java.util.HashMap<>(inputs);
              directInputs.put("_workflowExecutionIdempotencyKey", task.required("snapshotRef").textValue().substring(7));
              var body = call(WorkflowController.class, "executeDeployment", () ->
                  app.getBean(WorkflowController.class).executeDeployment(deploymentId, directInputs).getBody());
              executionId = UUID.fromString(String.valueOf(body.get("executionId")));
            } else {
              row.put("candidateRef", release.candidate()).put("experimentRef", release.experiment())
                  .put("procedureRef", release.procedure()).put("mechanizationRef", release.mechanism())
                  .put("candidateVersion", release.version().toString());
              var route = routeForCase.apply(id);
              route.setTraceId("prospective-invoice-v1-" + id);
              var request = new SkillOptProcedureExecutionRequest(route).inputs(inputs);
              var result = call(SkilloptOpsApiController.class, "executeSkilloptProcedure", () ->
                  app.getBean(SkilloptOpsApiDelegate.class).executeSkilloptProcedure(request).getBody());
              if (result == null || result.getStatus() != SkillOptProcedureExecutionResponse.StatusEnum.PROCEDURE_STARTED) {
                row.put("status", "fallback");
                executionId = null;
              } else {
                if (!release.procedure().equals(result.getProcedureRef()) || !release.version().equals(result.getWorkflowVersionId())
                    || !Boolean.TRUE.equals(result.getDeterministicAttempted()) || !Boolean.FALSE.equals(result.getAgentExecutionPerformed()))
                  throw new IllegalStateException("Different procedure or execution posture was selected");
                executionId = result.getWorkflowExecution().getId();
                row.put("routeReceipt", result.getRoute().getReceipt().getReceiptRef());
              }
            }
            if (executionId != null) observe(row, executionId, task, start);
          } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IOException("Interrupted before all outcomes could be recorded", interrupted);
          } catch (RuntimeException deniedOrFailed) {
            row.put("status", "error").put("errorType", deniedOrFailed.getClass().getSimpleName());
            var stack = deniedOrFailed.getStackTrace();
            if (stack.length > 0) row.put("errorOrigin", stack[0].getClassName() + "." + stack[0].getMethodName());
            System.err.println("Task return " + id + " " + arm + ": " + deniedOrFailed);
          }
          row.put("elapsedNs", System.nanoTime() - start);
        }
        Files.writeString(outputPath, json.writeValueAsString(row) + "\n", StandardOpenOption.APPEND);
      }
    }
  }

  private void observe(ObjectNode row, UUID execution, JsonNode task, long start) throws InterruptedException {
    row.put("executionId", execution.toString());
    while (System.nanoTime() - start < TimeUnit.SECONDS.toNanos(30)) {
      var result = call(WorkflowEngineeringController.class, "businessResult", () ->
          app.getBean(WorkflowEngineeringController.class).businessResult(execution).getBody());
      if (!"pending".equals(result.status())) {
        var persisted = call(WorkflowEngineeringController.class, "businessResult", () ->
            app.getBean(WorkflowExecutionService.class).findById(execution).orElseThrow());
        JsonNode trigger;
        try {
          trigger = json.readTree(persisted.getTriggerPayload());
        } catch (IOException malformed) {
          throw new IllegalStateException("Native execution has no valid immutable trigger", malformed);
        }
        boolean sameTask = trigger != null && task.equals(trigger.path("task"));
        row.put("triggerTaskMatches", sameTask);
        if ("procedure".equals(row.path("arm").asText())) {
          boolean bound = trigger != null && trigger.path("_skillOptMechanizedProcedure").asBoolean(false)
              && row.path("procedureRef").equals(trigger.path("_skillOptProcedureRef"))
              && row.path("mechanizationRef").equals(trigger.path("_skillOptMechanizationReceiptRef"))
              && row.path("routeReceipt").equals(trigger.path("_skillOptRouteReceiptRef"));
          row.put("triggerProcedureBindingMatches", bound);
        }
        row.put("status", result.status()).put("state", persisted.getState().name())
            .put("executionOwner", String.valueOf(persisted.getOwnerId())).put("trigger", persisted.getTriggerType().name())
            .put("executionVersion", String.valueOf(persisted.getWorkflowVersionId()))
            .put("executionDeployment", String.valueOf(persisted.getWorkflowDeploymentId()))
            .put("testMode", persisted.getTestMode()).put("definitionHash", result.definitionSnapshotHash())
            .put("resultChecksum", result.resultChecksum()).put("contract", result.contractId());
        row.set("result", result.result());
        return;
      }
      Thread.sleep(50);
    }
    row.put("status", "timeout");
  }
}
