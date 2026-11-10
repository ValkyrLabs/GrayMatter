package com.valkyrlabs.valkyrai.skillopt;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.valkyrlabs.model.*;
import java.security.MessageDigest;
import java.util.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.web.server.ResponseStatusException;

class ShadowAdmissionControlsTest {
  @ParameterizedTest(name="{0}")
  @ValueSource(strings={"valid", "source-task-substituted", "candidate-task-substituted",
      "flags-only", "stamped-other-cohort", "stamped-other-candidate", "stamped-other-input",
      "source-version-revoked", "candidate-version-revoked", "source-version-mutated", "candidate-abi-mutated",
      "source-is-test", "candidate-is-test", "source-no-longer-success", "source-owner-changed",
      "candidate-owner-changed", "route-revoked", "route-trashed", "ambiguous-route",
      "source-trashed", "candidate-trashed", "source-version-trashed", "candidate-version-trashed"})
  void onlyTheOriginalAuthorizedPairCounts(String scenario) throws Exception {
    var json = new ObjectMapper();
    var receipts = mock(SkillOptRouteReceiptService.class);
    var versions = mock(WorkflowVersionService.class);
    var compilerRules = mock(SkillMechanizationCompilerService.class);
    var proof = new SkillShadowReplayEvidence(receipts, json, versions, compilerRules);
    var actor = UUID.randomUUID();
    var source = new WorkflowExecution().id(UUID.randomUUID()).ownerId(actor).workflowId(UUID.randomUUID())
        .workflowVersionId(UUID.randomUUID()).definitionSnapshotHash("1".repeat(64)).testMode(false)
        .triggerType(WorkflowExecution.TriggerTypeEnum.MANUAL).state(WorkflowExecution.StateEnum.SUCCESS);
    var replay = new WorkflowExecution().id(UUID.randomUUID()).ownerId(actor).workflowId(UUID.randomUUID())
        .workflowVersionId(UUID.randomUUID()).definitionSnapshotHash("2".repeat(64)).testMode(false)
        .triggerType(WorkflowExecution.TriggerTypeEnum.MANUAL).state(WorkflowExecution.StateEnum.SUCCESS);
    var sourceVersion = new WorkflowVersion().id(source.getWorkflowVersionId()).workflowId(source.getWorkflowId())
        .contentHash(source.getDefinitionSnapshotHash()).abiHash("3".repeat(64)).validationStatus(WorkflowVersion.ValidationStatusEnum.VALID);
    var version = new WorkflowVersion().id(replay.getWorkflowVersionId()).workflowId(replay.getWorkflowId())
        .contentHash(replay.getDefinitionSnapshotHash()).abiHash("4".repeat(64)).validationStatus(WorkflowVersion.ValidationStatusEnum.VALID);
    when(versions.findById(sourceVersion.getId())).thenReturn(Optional.of(sourceVersion));
    when(versions.findById(version.getId())).thenReturn(Optional.of(version));
    var candidate = new SkillImprovementCandidate().candidateRef("candidate").experimentRef("experiment")
        .tenantId("tenant-a").activationRef("procedure").ownerId(actor).status(SkillCandidateStatus.SHADOW);
    var compiler = new SkillMechanizationReceipt().receiptRef("compiler").candidateRef("candidate").procedureRef("procedure")
        .workflowId(version.getWorkflowId()).workflowVersionId(version.getId()).contentHash(version.getContentHash())
        .abiHash(version.getAbiHash()).holdoutSetRef("cohort").taskFamily("invoices");
    var sourceCapsule = new SkillExperienceCapsule().capsuleRef("holdout");
    Map<String,Object> business = Map.of("invoiceIds",List.of("a","b"),"customerIds",List.of("a"));
    Map<String,Object> input = Map.of("task",business);
    var canonical = json.writer().with(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS);
    var taskDigest = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(canonical.writeValueAsBytes(business)));
    var inputDigest = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(
        canonical.writeValueAsBytes(List.of("skillOptShadowReplayAdmission","MANUAL",input))));
    var trace = SkillShadowReplayEvidence.trace(candidate,compiler,source,taskDigest,actor);
    var binding = new SkillOptShadowReplayDispatch.Binding(actor,"tenant-a","candidate","experiment","procedure","compiler",
        "cohort","holdout",source.getId(),version.getWorkflowId(),version.getId(),version.getContentHash(),version.getAbiHash(),taskDigest,trace);
    var dispatch = new SkillOptShadowReplayDispatch(binding,"route",json);
    var stamp = new HashMap<>(dispatch.admission(actor,new Workflow().id(version.getWorkflowId()),version,input,inputDigest));
    var trigger = new HashMap<String,Object>(input);
    trigger.put("workflowExecutionRef",source.getId().toString());
    trigger.put("_skillOptMechanizedProcedure",true); trigger.put("_skillOptProcedureRef","procedure");
    trigger.put("_skillOptMechanizationReceiptRef","compiler");
    source.setTriggerPayload(json.writeValueAsString(input));
    var original = new SkillOptRouteReceipt().receiptRef("route").traceId(trace).ownerId(actor).tenantId("tenant-a")
        .taskType(SkillOptTaskType.WORKFLOW).recommendedRoute(SkillOptRoute.RUN_WORKFLOW).requiredApproval(false).requiredHydration(false).billable(true);
    when(receipts.findSkillOptRouteReceiptByReceiptRef("route")).thenReturn(List.of(original));
    switch (scenario) {
      case "source-task-substituted" -> source.setTriggerPayload("{\"task\":{\"invoiceIds\":[]}}");
      case "candidate-task-substituted" -> trigger.put("task",Map.of("invoiceIds",List.of()));
      case "stamped-other-cohort" -> stamp.put("holdoutSetRef","different");
      case "stamped-other-candidate" -> stamp.put("candidateRef","different");
      case "stamped-other-input" -> stamp.put("inputDigest","5".repeat(64));
      case "source-version-revoked" -> when(versions.findById(sourceVersion.getId())).thenReturn(Optional.empty());
      case "candidate-version-revoked" -> when(versions.findById(version.getId())).thenReturn(Optional.empty());
      case "source-version-mutated" -> sourceVersion.setContentHash("6".repeat(64));
      case "candidate-abi-mutated" -> version.setAbiHash("7".repeat(64));
      case "source-is-test" -> source.setTestMode(true);
      case "candidate-is-test" -> replay.setTestMode(true);
      case "source-no-longer-success" -> source.setState(WorkflowExecution.StateEnum.FAILED);
      case "source-owner-changed" -> source.setOwnerId(UUID.randomUUID());
      case "candidate-owner-changed" -> replay.setOwnerId(UUID.randomUUID());
      case "route-revoked" -> when(receipts.findSkillOptRouteReceiptByReceiptRef("route")).thenReturn(List.of());
      case "route-trashed" -> original.setTrashed(true);
      case "ambiguous-route" -> when(receipts.findSkillOptRouteReceiptByReceiptRef("route")).thenReturn(List.of(original,original));
      case "source-trashed" -> source.setTrashed(true);
      case "candidate-trashed" -> replay.setTrashed(true);
      case "source-version-trashed" -> sourceVersion.setTrashed(true);
      case "candidate-version-trashed" -> version.setTrashed(true);
    }
    replay.setTriggerPayload(json.writeValueAsString(trigger));
    replay.setContextData("flags-only".equals(scenario) ? "{}" : json.writeValueAsString(Map.of(dispatch.contextKey(),stamp)));
    if ("valid".equals(scenario)) assertDoesNotThrow(() -> proof.require(candidate,sourceCapsule,compiler,source,replay,actor));
    else assertThrows(ResponseStatusException.class, () -> proof.require(candidate,sourceCapsule,compiler,source,replay,actor));
  }
}
