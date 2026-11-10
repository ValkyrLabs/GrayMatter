package com.valkyrlabs.valkyrai.sagechat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.valkyrlabs.ValkyrAI;
import com.valkyrlabs.api.PrincipalRepository;
import com.valkyrlabs.model.*;
import com.valkyrlabs.thorapi.config.impl.ValkyrAIPermission;
import com.valkyrlabs.valkyrai.graymatter.retrieval.OmegaMemoryFormationRuntimeService;
import com.valkyrlabs.valkyrai.graymatter.retrieval.RetrievalReceiptRuntimeService;
import com.valkyrlabs.valkyrai.personalization.SageChatOmegaContinuityMemoryService;
import com.valkyrlabs.valkyrai.security.rbac.RoleManagementService;
import com.valkyrlabs.valkyrai.service.*;
import com.valkyrlabs.valkyrai.service.organization.OrganizationMembershipLifecycleService;
import com.valkyrlabs.workflow.engine.WorkflowGraphEvaluator;
import com.valkyrlabs.workflow.modules.VModule;
import com.valkyrlabs.workflow.modules.control.ConditionalBranchModule;
import com.valkyrlabs.workflow.modules.graymatter.OmegaReceiptModule;
import com.valkyrlabs.workflow.modules.operations.*;
import com.valkyrlabs.workflow.modules.skilloptics.SkillObserveOutcomeModule;
import com.valkyrlabs.workflow.service.*;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.security.acls.domain.ObjectIdentityImpl;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest(
    classes = ValkyrAI.class,
    webEnvironment = SpringBootTest.WebEnvironment.MOCK,
    properties = {
      "spring.task.scheduling.enabled=false",
      "spring.quartz.auto-startup=false",
      "springdoc.api-docs.enabled=false",
      "springdoc.swagger-ui.enabled=false",
      "spring.datasource.url=jdbc:h2:mem:synthetic-native-handoff;MODE=MySQL;DATABASE_TO_LOWER=TRUE;CASE_INSENSITIVE_IDENTIFIERS=TRUE;NON_KEYWORDS=USER,MONTH,INTERVAL;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE",
      "valkyrai.workflow.notification.enabled=false",
      "valkyrai.workflow.recovery.enabled=false",
      "MAILERSEND_API_KEY=mlsn.continuity-contained-test",
      "valkyrai.frontend-base-url=https://valkyrlabs.example",
      "valkyr.bootstrap.super.password=continuity-it-only",
      "valkyr.bootstrap.super.once-file=target/test-bootstrap/continuity-super-admin.once"
    })
@ActiveProfiles("test")
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class CausalGrayMatterNativeHandoffJpaTest {
  @Autowired ApplicationEventPublisher events;
  @Autowired SageChatOmegaContinuityMemoryService continuity;
  @Autowired RetrievalReceiptRuntimeService receiptRuntime;
  @Autowired OmegaMemoryFormationRuntimeService memoryFormation;
  @Autowired PrincipalRepository principals;
  @Autowired SystemUserService users;
  @Autowired OrganizationMembershipLifecycleService memberships;
  @Autowired RoleManagementService roles;
  @Autowired ValkyrAclService acl;
  @Autowired com.valkyrlabs.valkyrai.service.billing.SignupWelcomeCreditService welcomeCredits;
  @Autowired PlatformTransactionManager transactions;
  @Autowired ObjectMapper mapper;
  @PersistenceContext EntityManager em;

  // Only unrelated outbound startup systems are contained; none participates in these contracts.
  @MockitoBean com.valkyrlabs.valkyrai.service.TransactionalEmailService email;

  @MockitoBean
  com.valkyrlabs.valkyrai.service.research.DigitalProductGiveawayResearchService research;

  @AfterEach
  void clear() {
    SecurityContextHolder.clearContext();
  }

  UUID organization(String name) {
    return users.runAsSystem(
        () ->
            tx(
                () -> {
                  var value = new Organization().name(name + UUID.randomUUID());
                  em.persist(value);
                  em.flush();
                  return value.getId();
                }));
  }

  UUID actor(String name, UUID organization) {
    Principal actor =
        users.runAsSystem(
            () ->
                tx(
                    () -> {
                      var value =
                          new Principal()
                              .username(name + "-" + UUID.randomUUID().toString().substring(0, 12))
                              .federalIdentification(null)
                              .stateIdentification(null)
                              .email(null)
                              .phone(null)
                              .enabled(true)
                              .accountEnabled(true)
                              .accountNonExpired(true)
                              .accountNonLocked(true)
                              .credentialNonExpired(true)
                              .organization(em.getReference(Organization.class, organization));
                      em.persist(value);
                      em.flush();
                      return value;
                    }));
    users.runAsSystem(
        () -> {
          memberships.ensureOrganizationOwnerMembership(actor, actor.getOrganization());
          return null;
        });
    UUID bootstrapAdmin =
        principals.findPrincipalByUsername("super").stream().findFirst().orElseThrow().getId();
    users.runAsSystem(
        () ->
            tx(
                () -> {
                  var identity = new ObjectIdentityImpl(Principal.class, actor.getId());
                  acl.grantPermission(identity, bootstrapAdmin.toString(), ValkyrAIPermission.READ);
                  acl.grantPermission(
                      identity, bootstrapAdmin.toString(), ValkyrAIPermission.WRITE);
                  return null;
                }));
    // Real role-management generated reads require the immutable Core operation scope.
    // Actor identity, active membership and exact bootstrap ACL grants are committed above.
    as(
        bootstrapAdmin,
        () -> {
          roles.createRole("DEVELOPER");
          roles.createRole("APPLICATION_READ");
          roles.assignPrincipalRoles(
              actor.getId(), List.of("FREE", "DEVELOPER", "APPLICATION_READ"));
          roles.grantValkyrCoreRole(actor.getId());
          return null;
        });
    users.runAsSystem(
        () ->
            tx(
                () -> {
                  assertThat(principals.findById(actor.getId()).orElseThrow().getRoles())
                      .anyMatch(
                          role ->
                              com.valkyrlabs.valkyrai.security.rbac.ValkyrCoreRoleCatalog
                                  .isCoreRole(role.getRoleName()));
                  return null;
                }));
    return actor.getId();
  }

  private <T> T tx(Supplier<T> action) {
    return new TransactionTemplate(transactions).execute(status -> action.get());
  }

  private <T> T as(UUID principal, Supplier<T> action) {
    return withCoreScope(() -> users.runAsPrincipal(principal, action));
  }

  private <T> T withCoreScope(Supplier<T> action) {
    var binding =
        Api0DataPlaneBindingManifest.load()
            .requireHandlerBinding(
                com.valkyrlabs.workflow.controller.WorkflowTestingController.class, "startTestRun");
    return OperationDataPlaneScopeContext.callWith(
        OperationDataPlaneScope.core(binding.modelBinding()), action);
  }

  @Autowired org.springframework.context.ApplicationContext application;
  @Autowired SkillObservationService observationRows;
  @Autowired com.valkyrlabs.workflow.controller.WorkflowTestingController testController;
  @Autowired WorkflowAutomatedTestService testing;
  @Autowired WorkflowBusinessResultService results;
  @Autowired com.valkyrlabs.valkyrai.skillopt.SkillExperienceRuntimeService experience;

  Map<String, Object> inspectAndNormalize(UUID owner, String ref) {
    var spec =
        new WorkflowGraphTemplateService(mapper)
            .materialize("graymatter-receipt-observation", Map.of())
            .graph();
    var definition =
        new WorkflowDefinitionMaterializer(mapper).materialize(spec, UUID.randomUUID(), owner);
    var mappings = application.getBean(ExecModuleInputMappingService.class);
    var engine =
        new WorkflowGraphEvaluator(
            mapper,
            (task, persist) ->
                task.getModules().stream()
                    .map(
                        module -> {
                          VModule m =
                              switch (module.getClassName()) {
                                case "com.valkyrlabs.workflow.modules.graymatter.OmegaReceiptModule" ->
                                    application.getBean(OmegaReceiptModule.class);
                                case "com.valkyrlabs.workflow.modules.skilloptics.SkillObserveOutcomeModule" ->
                                    application.getBean(SkillObserveOutcomeModule.class);
                                case "com.valkyrlabs.workflow.modules.control.ConditionalBranchModule" ->
                                    new ConditionalBranchModule();
                                default -> throw new AssertionError(module.getClassName());
                              };
                          m.setId(module.getId());
                          m.setTask(task);
                          m.setExecModuleConfig(module.getExecModuleConfig());
                          return m;
                        })
                    .toList(),
            mappings::applyWithTrace,
            WorkflowGraphEvaluator.DefinitionStateStore.NOOP);
    return engine.execute(definition.workflow(), Map.of("receiptRef", ref), Map.of(), null);
  }

  @Test
  void canonicalReceiptToSkillObservation() {
    withCoreScope(
        () -> {
          exerciseAsNewMembers();
          return null;
        });
  }

  void exerciseAsNewMembers() {
    var org = organization("native-handoff");
    var owner = actor("native-member", org);
    var other = actor("different-member", organization("denied"));
    welcomeCredits.ensureSignupWelcomeCredits(owner);
    as(
        owner,
        () -> {
          assertThat(SecurityContextHolder.getContext().getAuthentication().getAuthorities())
              .extracting(a -> a.getAuthority())
              .doesNotContain("ROLE_ADMIN", "ROLE_SUPER_ADMIN");
          return null;
        });
    System.out.println("NATIVE_STAGE actualMembershipsAndGrants");
    var recall = makeAndVerifyDefaultReceipts(owner, other);
    var observationRef = verifyRecallObservation(owner, recall.receipt());
    var fixture = freezeReceiptGatedInvoiceFixture(owner, recall.receipt());
    verifyForeignExecutionDenied(owner, other, fixture);
    var run = runAndVerifyBusinessEffect(owner, fixture, recall.receipt());
    recordVerifiedWorkflowOutcome(owner, run, recall.receipt(), observationRef);
    verifyRevokedInputCannotProduceBusinessEffect(
        owner, fixture, run, recall.receipt(), recall.auditSource());
  }

  private record Recall(RetrievalReceipt receipt, UUID auditSource) {}

  private Recall makeAndVerifyDefaultReceipts(UUID owner, UUID other) {
    var text =
        "Confirm the preserved violet invoice reconciliation checksum for the Talon reference"
            + " fixture.";
    var formed =
        as(
            owner,
            () ->
                memoryFormation.remember(
                    new OmegaRememberRequest()
                        .text(text)
                        .type(OmegaRememberRequest.TypeEnum.EPISODIC)
                        .sourceChannel("sagechat")
                        .idempotencyKey("native-handoff-" + UUID.randomUUID()),
                    principals.findById(owner).orElseThrow()));
    as(
        owner,
        () ->
            tx(
                () -> {
                  acl.grantPermission(
                      new ObjectIdentityImpl(MemoryEntry.class, formed.getMemoryRef()),
                      owner.toString(),
                      com.valkyrlabs.thorapi.config.impl.ValkyrACL.mapStringToPermission("MERGE"));
                  return null;
                }));
    System.out.println("NATIVE_STAGE sourceCommittedAndCompositionGranted");
    var req =
        new RetrievalReceiptRequest().query(text).topK(4).includeText(true).includeEvaluator(false);
    req.setIdempotencyKey("one-source-" + UUID.randomUUID());
    var first =
        as(
            owner,
            () -> receiptRuntime.createReceipt(req, principals.findById(owner).orElseThrow()));
    assertThat(first.getItems())
        .extracting(RetrievalReceiptItem::getMemoryId)
        .contains(formed.getMemoryRef());
    assertThat(first.getAnswerPolicy()).isEqualTo(RetrievalAnswerPolicy.ALLOW_WITH_CAVEAT);
    System.out.println(
        "NATIVE_STAGE oneSourceReceipt status="
            + first.getRetrievalStatus()
            + " policy="
            + first.getAnswerPolicy()
            + " action="
            + first.getRecommendedAction()
            + " sourceCount="
            + first.getProvenance().getSourceCount()
            + " itemCount="
            + first.getItems().size());
    var withheld = as(owner, () -> inspectAndNormalize(owner, first.getReceiptId()));
    assertThat(withheld.get("branch_taken")).isEqualTo("evidence_withheld");
    assertThat(withheld.get("observationRef")).isNull();
    System.out.println(
        "NATIVE_STAGE singleSourcePartialCoverageWithheld receipt="
            + first.getReceiptId()
            + " source="
            + formed.getMemoryRef()
            + " observationCount=0");
    var corroborating =
        as(
            owner,
            () ->
                memoryFormation.remember(
                    new OmegaRememberRequest()
                        .text(
                            "The Talon audit confirms the preserved violet invoice reconciliation"
                                + " checksum in the two-row reference fixture.")
                        .type(OmegaRememberRequest.TypeEnum.EPISODIC)
                        .sourceChannel("synthetic-audit")
                        .idempotencyKey("native-handoff-audit-" + UUID.randomUUID()),
                    principals.findById(owner).orElseThrow()));
    as(
        owner,
        () ->
            tx(
                () -> {
                  acl.grantPermission(
                      new ObjectIdentityImpl(MemoryEntry.class, corroborating.getMemoryRef()),
                      owner.toString(),
                      com.valkyrlabs.thorapi.config.impl.ValkyrACL.mapStringToPermission("MERGE"));
                  return null;
                }));
    req.setIdempotencyKey("two-sources-" + UUID.randomUUID());
    var receipt =
        as(
            owner,
            () -> receiptRuntime.createReceipt(req, principals.findById(owner).orElseThrow()));
    assertThat(receipt.getItems())
        .extracting(RetrievalReceiptItem::getMemoryId)
        .contains(formed.getMemoryRef(), corroborating.getMemoryRef());
    assertThat(receipt.getAnswerPolicy()).isEqualTo(RetrievalAnswerPolicy.ALLOW_ANSWER);
    assertThat(receipt.getItems())
        .extracting(RetrievalReceiptItem::getMemoryId)
        .contains(formed.getMemoryRef());
    assertThat(
            as(
                other,
                () ->
                    receiptRuntime.getReceipt(
                        receipt.getReceiptId(), principals.findById(other).orElseThrow())))
        .isEmpty();
    System.out.println(
        "NATIVE_STAGE receiptBoundToAuthorizedSource receipt="
            + receipt.getReceiptId()
            + " firstSource="
            + formed.getMemoryRef()
            + " secondSource="
            + corroborating.getMemoryRef()
            + " status="
            + receipt.getRetrievalStatus()
            + " policy="
            + receipt.getAnswerPolicy()
            + " action="
            + receipt.getRecommendedAction()
            + " sourceCount="
            + receipt.getProvenance().getSourceCount());
    return new Recall(receipt, corroborating.getMemoryRef());
  }

  private String verifyRecallObservation(UUID owner, RetrievalReceipt receipt) {
    var outcome = as(owner, () -> inspectAndNormalize(owner, receipt.getReceiptId()));
    assertThat(outcome.get("branch_taken")).isEqualTo("observation_verified");
    var observed =
        as(
            owner,
            () ->
                observationRows.findSkillObservationByObservationRef(
                    (String) outcome.get("observationRef")));
    assertThat(observed)
        .singleElement()
        .satisfies(
            o -> {
              assertThat(o.getOwnerId()).isEqualTo(owner);
              assertThat(o.getSourceRef()).isEqualTo(receipt.getReceiptId());
              assertThat(o.getSourceType()).isEqualTo(SkillObservationSource.BIFROST);
              assertThat(o.getStatus()).isEqualTo(SkillObservation.StatusEnum.NORMALIZED);
              assertThat(o.getOutcome()).isEqualTo(SkillObservation.OutcomeEnum.UNKNOWN);
            });
    System.out.println(
        "NATIVE_STAGE runeAndCommittedSkillObservation branch="
            + outcome.get("branch_taken")
            + " observation="
            + outcome.get("observationRef")
            + " outcome=UNKNOWN");
    return (String) outcome.get("observationRef");
  }

  private InvoiceReferenceRehearsalService.Saved freezeReceiptGatedInvoiceFixture(
      UUID owner, RetrievalReceipt receipt) {
    var input =
        new InvoiceReferenceSnapshot(
            List.of(
                new InvoiceReferenceSnapshot.InvoiceRef(new UUID(1, 1), new UUID(2, 1)),
                new InvoiceReferenceSnapshot.InvoiceRef(new UUID(1, 2), new UUID(2, 2))),
            List.of(new InvoiceReferenceSnapshot.CustomerRef(new UUID(2, 1))));
    var workflow =
        as(
            owner,
            () ->
                application
                    .getBean(WorkflowGraphSaveService.class)
                    .saveWorkflowGraph(
                        new WorkflowGraphTemplateService(mapper)
                            .materialize(
                                "synthetic-handoff",
                                Map.of(
                                    "DEFINITION_KEY",
                                    "synthetic-native-handoff-" + UUID.randomUUID()))
                            .graph()));
    assertThat(workflow.getWorkflow().getOwnerId()).isEqualTo(owner);
    var version = workflow.getWorkflowVersion();
    assertThat(version.getValidationStatus()).isEqualTo(WorkflowVersion.ValidationStatusEnum.VALID);
    var frozenInput =
        mapper.valueToTree(
            Map.of("input", Map.of("receiptRef", receipt.getReceiptId(), "task", input.task())));
    var report =
        Map.<String, Object>of(
            "customerCount",
            1,
            "invoiceCount",
            2,
            "matchedCount",
            1,
            "snapshotRef",
            "sha256:696e988bf8eb846810ed744cf771af4836b6bdcbf875ee12a8345c6efffc5707",
            "unmatchedCount",
            1,
            "unmatchedInvoiceIds",
            List.of(new UUID(1, 2).toString()));
    var checks =
        report.entrySet().stream()
            .map(
                field ->
                    Map.of(
                        "name",
                        field.getKey(),
                        "path",
                        "$.result.reconciliationReport." + field.getKey(),
                        "operator",
                        "equals",
                        "expected",
                        field.getValue()))
            .toList();
    var expected = mapper.valueToTree(checks);
    var chosen =
        as(
            owner,
            () ->
                testing.createVersion(
                    new WorkflowAutomatedTestService.TestDefinitionRequest(
                        version.getId(),
                        "receipt gated fixture",
                        frozenInput.toString(),
                        "{}",
                        expected.toString(),
                        "{}",
                        "{}",
                        null,
                        true)));
    var saved =
        new InvoiceReferenceRehearsalService.Saved(
            workflow.getWorkflow().getId(), version.getId(), chosen.getId());
    as(
        owner,
        () ->
            tx(
                () -> {
                  acl.grantPermission(
                      new ObjectIdentityImpl(WorkflowTest.class, saved.testId()),
                      owner.toString(),
                      com.valkyrlabs.thorapi.config.impl.ValkyrACL.mapStringToPermission(
                          "EXECUTE"));
                  return null;
                }));
    return saved;
  }

  private void verifyForeignExecutionDenied(
      UUID owner, UUID other, InvoiceReferenceRehearsalService.Saved saved) {
    long before =
        as(
            owner,
            () ->
                tx(
                    () ->
                        em.createQuery(
                                "select count(r) from com.valkyrlabs.model.WorkflowTestRun r where"
                                    + " r.workflowTestId=:test",
                                Long.class)
                            .setParameter("test", saved.testId())
                            .getSingleResult()));
    assertThatThrownBy(() -> as(other, () -> testController.startTestRun(saved.testId())))
        .isInstanceOf(org.springframework.security.access.AccessDeniedException.class);
    assertThat(
            as(
                owner,
                () ->
                    tx(
                        () ->
                            em.createQuery(
                                    "select count(r) from com.valkyrlabs.model.WorkflowTestRun r"
                                        + " where r.workflowTestId=:test",
                                    Long.class)
                                .setParameter("test", saved.testId())
                                .getSingleResult())))
        .isEqualTo(before);
    System.out.println("NATIVE_STAGE foreignExecutionDeniedWithoutRun");
  }

  private WorkflowAutomatedTestService.TestRunStartResponse runAndVerifyBusinessEffect(
      UUID owner, InvoiceReferenceRehearsalService.Saved saved, RetrievalReceipt receipt) {
    var run = as(owner, () -> testController.startTestRun(saved.testId()).getBody());
    System.out.println(
        "NATIVE_STAGE authorizedWorkflowDispatched execution="
            + run.executionId()
            + " workflowTestRun="
            + run.testRunId()
            + " workflowVersion="
            + run.workflowVersionId()
            + " definitionHash="
            + run.definitionSnapshotHash());
    WorkflowBusinessResultService.BusinessResult output = null;
    for (int attempt = 0; attempt < 45; attempt++) {
      output = as(owner, () -> results.read(run.executionId()));
      if ("available".equals(output.status()) || "unsuccessful".equals(output.status())) break;
      try {
        Thread.sleep(500);
      } catch (InterruptedException e) {
        throw new IllegalStateException(e);
      }
    }
    as(owner, () -> testing.reconcile(run.testRunId()));
    output = as(owner, () -> results.read(run.executionId()));
    assertThat(output.status()).isEqualTo("available");
    assertThat(output.correctness()).isEqualTo("matches-fixture");
    var execution =
        as(
            owner,
            () ->
                application
                    .getBean(com.valkyrlabs.model.WorkflowExecutionService.class)
                    .findById(run.executionId())
                    .orElseThrow());
    try {
      var state = mapper.readTree(execution.getContextData());
      var fromInspection = state.path("omegaReceiptResult").path("retrievalReceiptRef").textValue();
      assertThat(fromInspection).isEqualTo(receipt.getReceiptId());
      assertThat(state.path("branch_taken").textValue()).isEqualTo("receipt_usable");
      System.out.println(
          "NATIVE_STAGE immutableWorkflowResolvedReceipt receipt="
              + fromInspection
              + " branch="
              + state.path("branch_taken").textValue());
    } catch (com.fasterxml.jackson.core.JsonProcessingException error) {
      throw new IllegalStateException(error);
    }

    assertThat(output.resultChecksum())
        .isEqualTo("14172e67bf8a8e1432751f6e4e339e314d4ce61bb1938d820281b3bc74b54baa");
    assertThat(output.result().path("matchedCount").intValue()).isOne();
    assertThat(output.result().path("unmatchedInvoiceIds").get(0).asText())
        .isEqualTo(new UUID(1, 2).toString());
    System.out.println(
        "NATIVE_STAGE invoiceReportComparedToPrecommittedIndependentDigest resultChecksum="
            + output.resultChecksum()
            + " fixtureCorrectness="
            + output.correctness());
    return run;
  }

  private void recordVerifiedWorkflowOutcome(
      UUID owner,
      WorkflowAutomatedTestService.TestRunStartResponse run,
      RetrievalReceipt receipt,
      String observationRef) {
    var workflowObservation =
        as(
            owner,
            () ->
                experience.normalize(
                    new SkillObservationRequest()
                        .sourceType(SkillObservationSource.WORKFLOW)
                        .sourceRef("workflow_execution:" + run.executionId())
                        .eventType("synthetic_reconciliation_verified")
                        .evidenceClass(SkillEvidenceClass.REPLAY)
                        .traceId(receipt.getTraceId())
                        .evidenceRefs(List.of(receipt.getReceiptId(), observationRef))
                        .outcome(SkillObservationRequest.OutcomeEnum.SUCCESS)));
    assertThat(workflowObservation.getStatus()).isEqualTo(SkillObservation.StatusEnum.NORMALIZED);
    assertThat(workflowObservation.getMetadataJson()).contains(run.executionId().toString());
    assertThat(
            as(
                owner,
                () ->
                    observationRows.findSkillObservationByObservationRef(
                        workflowObservation.getObservationRef())))
        .singleElement()
        .satisfies(
            o -> assertThat(o.getSourceRef()).isEqualTo("workflow_execution:" + run.executionId()));
    System.out.println(
        "NATIVE_STAGE independentResultAndWorkflowEvidenceLinked observation="
            + workflowObservation.getObservationRef()
            + " workflow="
            + run.executionId()
            + " outcome="
            + workflowObservation.getOutcome()
            + " evidence="
            + workflowObservation.getEvidenceClass());
  }

  private void verifyRevokedInputCannotProduceBusinessEffect(
      UUID owner,
      InvoiceReferenceRehearsalService.Saved saved,
      WorkflowAutomatedTestService.TestRunStartResponse run,
      RetrievalReceipt receipt,
      UUID corroboratingSource) {
    as(
        owner,
        () ->
            tx(
                () -> {
                  acl.revokePermission(
                      new ObjectIdentityImpl(MemoryEntry.class, corroboratingSource),
                      owner.toString(),
                      com.valkyrlabs.thorapi.config.impl.ValkyrACL.mapStringToPermission("MERGE"));
                  return null;
                }));
    assertThat(
            as(
                owner,
                () ->
                    receiptRuntime.getReceipt(
                        receipt.getReceiptId(), principals.findById(owner).orElseThrow())))
        .isEmpty();
    var revoked = as(owner, () -> testController.startTestRun(saved.testId()).getBody());
    assertThat(revoked.executionId()).isNotEqualTo(run.executionId());
    var terminal =
        java.util.EnumSet.of(
            WorkflowExecution.StateEnum.SUCCESS,
            WorkflowExecution.StateEnum.FAILED,
            WorkflowExecution.StateEnum.TIMEOUT,
            WorkflowExecution.StateEnum.CANCELLED);
    var executionRows = application.getBean(com.valkyrlabs.model.WorkflowExecutionService.class);
    WorkflowExecution.StateEnum revokedState = null;
    for (int attempt = 0; attempt < 45; attempt++) {
      revokedState =
          as(owner, () -> executionRows.findById(revoked.executionId()).orElseThrow().getState());
      if (terminal.contains(revokedState)) break;
      try {
        Thread.sleep(500);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        throw new IllegalStateException(e);
      }
    }
    assertThat(terminal).contains(revokedState);
    var revokedResult = as(owner, () -> results.read(revoked.executionId()));
    assertThat(revokedResult.result()).isNull();
    assertThat(revokedResult.status()).isNotEqualTo("available");
    var successEvents =
        as(
                owner,
                () ->
                    observationRows.findSkillObservationBySourceRef(
                        "workflow_execution:" + revoked.executionId()))
            .stream()
            .filter(o -> "synthetic_reconciliation_verified".equals(o.getEventType()))
            .count();
    assertThat(successEvents).isZero();
    System.out.println(
        "NATIVE_STAGE revokedReceiptCouldNotProduceReport execution="
            + revoked.executionId()
            + " executionState="
            + revokedState
            + " reportStatus="
            + revokedResult.status()
            + " verifiedSuccessEvents="
            + successEvents);
  }
}
