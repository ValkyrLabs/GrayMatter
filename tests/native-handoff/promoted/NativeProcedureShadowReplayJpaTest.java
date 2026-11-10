package com.valkyrlabs.valkyrai.sagechat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.valkyrlabs.ValkyrAI;
import com.valkyrlabs.api.PrincipalRepository;
import com.valkyrlabs.model.*;
import com.valkyrlabs.thorapi.config.impl.ValkyrAIPermission;
import com.valkyrlabs.valkyrai.security.rbac.RoleManagementService;
import com.valkyrlabs.valkyrai.service.*;
import com.valkyrlabs.valkyrai.service.organization.OrganizationMembershipLifecycleService;
import com.valkyrlabs.workflow.modules.operations.*;
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
      "billing.signup.welcome-credits=20000",
      "billing.signup.memory-starter-credits=20000",
      "spring.quartz.auto-startup=false",
      "springdoc.api-docs.enabled=false",
      "springdoc.swagger-ui.enabled=false",
      "spring.datasource.url=jdbc:h2:mem:synthetic-native-promoted-procedure;MODE=MySQL;DATABASE_TO_LOWER=TRUE;CASE_INSENSITIVE_IDENTIFIERS=TRUE;NON_KEYWORDS=USER,MONTH,INTERVAL;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE",
      "valkyrai.workflow.notification.enabled=false",
      "valkyrai.workflow.recovery.enabled=false",
      "MAILERSEND_API_KEY=mlsn.continuity-contained-test",
      "valkyrai.frontend-base-url=https://valkyrlabs.example",
      "valkyr.bootstrap.super.password=continuity-it-only",
      "valkyr.bootstrap.super.once-file=target/test-bootstrap/continuity-super-admin.once"
    })
@ActiveProfiles("test")
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class NativeProcedureShadowReplayJpaTest {
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
          roles.createRole("GRAYMATTER_USER");
          roles.createRole("APPLICATION_READ");
          roles.assignPrincipalRoles(
              actor.getId(), List.of("FREE", "DEVELOPER", "APPLICATION_READ", "GRAYMATTER_USER"));
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
                com.valkyrlabs.workflow.controller.WorkflowController.class, "executeDeployment");
    return OperationDataPlaneScopeContext.callWith(
        OperationDataPlaneScope.core(binding.modelBinding()), action);
  }

  private <T> T asSkill(UUID member, String method, Supplier<T> action) {
    var binding =
        Api0DataPlaneBindingManifest.load()
            .requireHandlerBinding(com.valkyrlabs.api.SkilloptOpsApiController.class, method);
    return OperationDataPlaneScopeContext.callWith(
        OperationDataPlaneScope.core(binding.modelBinding()),
        () -> users.runAsPrincipal(member, action));
  }

  @Autowired org.springframework.context.ApplicationContext application;
  @Autowired WorkflowBusinessResultService results;
  @Autowired com.valkyrlabs.valkyrai.skillopt.SkillExperienceRuntimeService experience;

  @Autowired com.valkyrlabs.workflow.controller.WorkflowController controller;
  @Autowired com.valkyrlabs.valkyrai.skillopt.SkillCandidateExperimentRuntimeService experiments;
  @Autowired com.valkyrlabs.api.SkilloptOpsApiController operations;

  @Test
  void twentyFrozenShadowExecutionsMatchTheirSourceAndWithholdPromotion() {
    UUID org = withCoreScope(() -> organization("synthetic-procedure"));
    UUID owner = withCoreScope(() -> actor("trainer", org));
    UUID consumer = withCoreScope(() -> actor("reuser", org));
    withCoreScope(
        () -> {
          welcomeCredits.ensureSignupWelcomeCredits(owner);
          welcomeCredits.ensureSignupWelcomeCredits(consumer);
          return null;
        });
    assertThat(
            as(
                consumer,
                () -> SecurityContextHolder.getContext().getAuthentication().getAuthorities()))
        .extracting(a -> a.getAuthority())
        .doesNotContain("ROLE_ADMIN", "ROLE_SUPER_ADMIN");
    var graph =
        new WorkflowGraphTemplateService(mapper)
            .materialize(
                "invoice-customer-reconciliation",
                Map.of("DEFINITION_KEY", "native-promote-" + UUID.randomUUID()))
            .graph();
    var saved =
        as(
            owner,
            () -> application.getBean(WorkflowGraphSaveService.class).saveWorkflowGraph(graph));
    var version = saved.getWorkflowVersion();
    var workflow = saved.getWorkflow();
    assertThat(version.getValidationStatus()).isEqualTo(WorkflowVersion.ValidationStatusEnum.VALID);
    grant(owner, WorkflowVersion.class, version.getId(), owner, "WRITE");
    var draft =
        as(
            owner,
            () ->
                controller.createDeployment(
                    version.getId(),
                    new com.valkyrlabs.workflow.controller.WorkflowController
                        .DeploymentDraftRequest(
                        WorkflowDeployment.EnvironmentEnum.SANDBOX, "{}", "{}", "[]")));
    grant(owner, WorkflowDeployment.class, draft.getId(), owner, "WRITE");
    var deployment = as(owner, () -> controller.activateDeployment(draft.getId()));
    grant(owner, WorkflowDeployment.class, deployment.getId(), owner, "EXECUTE");
    System.out.println(
        "PROMOTED_STAGE realSandboxDeployment version="
            + version.getId()
            + " deployment="
            + deployment.getId());
    var sourceRows = new java.util.ArrayList<Map<String, Object>>();
    var pairs = new java.util.ArrayList<Map<String, Object>>();
    var expectedByCapsule = new java.util.HashMap<String, String>();
    var ids = new java.util.HashSet<UUID>();
    SkillImprovementCandidate candidate = null;
    var frozenInputs = new java.util.ArrayList<InvoiceReferenceSnapshot>();
    var expected = new java.util.ArrayList<String>();
    for (int ordinal = 0; ordinal < 96; ordinal++) {
      var customers = new java.util.ArrayList<InvoiceReferenceSnapshot.CustomerRef>();
      var invoices = new java.util.ArrayList<InvoiceReferenceSnapshot.InvoiceRef>();
      int customerCount = 1 + ordinal % 6, invoiceCount = 2 + ordinal % 11;
      for (int n = 0; n < customerCount; n++)
        customers.add(
            new InvoiceReferenceSnapshot.CustomerRef(
                new UUID(0x076a000000000001L + ordinal, n + 1)));
      for (int n = 0; n < invoiceCount; n++) {
        var customer =
            (n + ordinal) % (2 + ordinal % 4) == 0
                ? new UUID(0x076a000000000003L + ordinal, n + 1)
                : customers.get(n % customerCount).id();
        invoices.add(
            new InvoiceReferenceSnapshot.InvoiceRef(
                new UUID(0x076a000000000002L + ordinal, n + 1), customer));
      }
      var source = new InvoiceReferenceSnapshot(invoices, customers);
      frozenInputs.add(source);
      expected.add(expectedReport(source));
    }
    assertThat(new java.util.HashSet<>(expected)).hasSize(96);
    System.out.println(
        "PROMOTED_STAGE independentSyntheticFixtures count=96 expectedSetHash="
            + digest(String.join("|", expected)));
    for (int ordinal = 0; ordinal < frozenInputs.size(); ordinal++) {
      var input = frozenInputs.get(ordinal);
      String invocation =
          digest(owner + "|source-admission|" + ordinal + "|" + expected.get(ordinal));
      Map<String, Object> start =
          as(
              owner,
              () ->
                  controller
                      .executeDeployment(
                          deployment.getId(),
                          Map.of(
                              "task",
                              input.task(),
                              com.valkyrlabs.workflow.service.WorkflowLaunchContractPreflight
                                  .IDEMPOTENCY_KEY,
                              invocation))
                      .getBody());
      UUID id = UUID.fromString(String.valueOf(start.get("executionId")));
      assertThat(ids.add(id)).isTrue();
      WorkflowExecution execution = terminal(owner, id);
      assertThat(execution.getState())
          .as("durable source run " + id + " reason=" + execution.getErrorMessage())
          .isEqualTo(WorkflowExecution.StateEnum.SUCCESS);
      assertThat(execution.getTestMode()).isFalse();
      assertThat(execution.getWorkflowVersionId()).isEqualTo(version.getId());
      var report = as(owner, () -> results.read(id));
      assertThat(report.resultChecksum()).isEqualTo(expected.get(ordinal));
      var trace = "native-source-" + id;
      var obs =
          as(
              owner,
              () ->
                  experience.normalize(
                      new SkillObservationRequest()
                          .sourceType(SkillObservationSource.WORKFLOW)
                          .sourceRef("workflow_execution:" + id)
                          .eventType("native_invoice_method")
                          .evidenceClass(SkillEvidenceClass.REPLAY)
                          .traceId(trace)
                          .outcome(SkillObservationRequest.OutcomeEnum.SUCCESS)));
      var learned = as(owner, () -> experience.learnFromObservation(obs, null, trace));
      System.out.println(
          "PROMOTED_STAGE actualSource execution="
              + id
              + " workflowState="
              + execution.getState()
              + " score="
              + learned.getOutcome().getAggregateScore()
              + " candidates="
              + learned.getCandidates().size()
              + " capsule="
              + learned.getCapsule().getCapsuleRef());
      sourceRows.add(
          Map.of(
              "ordinal",
              ordinal,
              "executionId",
              id,
              "capsuleRef",
              learned.getCapsule().getCapsuleRef(),
              "expectedReportSha256",
              expected.get(ordinal),
              "actualReportSha256",
              report.resultChecksum()));
      expectedByCapsule.put(learned.getCapsule().getCapsuleRef(), expected.get(ordinal));
      if (!learned.getCandidates().isEmpty()) candidate = learned.getCandidates().get(0);
    }
    assertThat(candidate).isNotNull();
    String ref = candidate.getCandidateRef();
    var staged = as(owner, () -> experiments.stageWithOutcome(ref));
    System.out.println(
        "PROMOTED_STAGE canonicalStage status="
            + staged.candidate().getStatus()
            + " compiled="
            + staged.compilationStatus()
            + " procedure="
            + staged.procedureRef()
            + " workflowVersion="
            + staged.workflowVersionId()
            + " receipt="
            + staged.mechanizationReceiptRef()
            + " support="
            + staged.candidate().getSupportingExperienceRefs().size());
    assertThat(staged.candidate().getSupportingExperienceRefs()).hasSize(96);
    var compiler =
        as(
            owner,
            () ->
                application
                    .getBean(SkillMechanizationReceiptService.class)
                    .findSkillMechanizationReceiptByReceiptRef(staged.mechanizationReceiptRef())
                    .get(0));
    assertThat(compiler.getHoldoutExperienceRefs()).hasSize(20);
    assertThat(compiler.getTrainingExperienceRefs()).hasSize(76);
    System.out.println(
        "PROMOTED_STAGE actualCompilerSplit training="
            + compiler.getTrainingExperienceRefs().size()
            + " holdout="
            + compiler.getHoldoutExperienceRefs().size()
            + " holdoutSet="
            + compiler.getHoldoutSetRef());
    var release =
        as(
            owner,
            () ->
                application
                    .getBean(ProcedureService.class)
                    .findProcedureByProcedureRef(staged.procedureRef())
                    .get(0));
    assertThat(release.getLifecycleStatus()).isEqualTo(Procedure.LifecycleStatusEnum.SHADOW);
    grant(owner, Procedure.class, release.getId(), consumer, "READ");
    var visible =
        as(
            consumer,
            () ->
                application
                    .getBean(ProcedureService.class)
                    .findProcedureByProcedureRef(staged.procedureRef()));
    assertThat(visible).extracting(Procedure::getId).contains(release.getId());
    var route =
        new SkillOptRouteRequest()
            .taskType(SkillOptTaskType.WORKFLOW)
            .traceId("native-shadow-" + UUID.randomUUID())
            .procedureHints(List.of(staged.procedureRef()));
    var attempt =
        asSkill(
            consumer,
            "executeSkilloptProcedure",
            () ->
                operations
                    .executeSkilloptProcedure(
                        new SkillOptProcedureExecutionRequest()
                            .routeRequest(route)
                            .inputs(Map.of("task", frozenInputs.get(0).task())))
                    .getBody());
    assertThat(attempt.getWorkflowExecution()).isNull();
    assertThat(attempt.getRoute().getReceipt().getReceiptRef()).isNotBlank();
    System.out.println(
        "PROMOTED_STAGE secondMemberRefusedShadow route="
            + attempt.getRoute().getRecommendedRoute()
            + " status="
            + attempt.getStatus()
            + " routeReceipt="
            + attempt.getRoute().getReceipt().getReceiptRef());
    var ownerMutation = application.getBean(com.valkyrlabs.api.ProcedureApiDelegate.class);
    assertThatThrownBy(
            () ->
                as(
                    owner,
                    () ->
                        ownerMutation.patchProcedureById(
                            release.getId(),
                            new Procedure()
                                .enabled(true)
                                .lifecycleStatus(Procedure.LifecycleStatusEnum.ACTIVE)
                                .workflowBindingStatus(
                                    Procedure.WorkflowBindingStatusEnum.ACTIVE))))
        .isInstanceOf(org.springframework.security.access.AccessDeniedException.class);
    assertThat(
            as(
                    owner,
                    () ->
                        application
                            .getBean(ProcedureService.class)
                            .findById(release.getId())
                            .orElseThrow())
                .getLifecycleStatus())
        .isEqualTo(Procedure.LifecycleStatusEnum.SHADOW);

    String first = compiler.getHoldoutExperienceRefs().get(0);
    var firstRequest = new SkillShadowReplayExecutionRequest().baselineCapsuleRef(first);
    assertThatThrownBy(
            () ->
                asSkill(
                    consumer,
                    "startSkillCandidateShadowReplay",
                    () -> operations.startSkillCandidateShadowReplay(ref, firstRequest)))
        .isInstanceOfAny(
            org.springframework.web.server.ResponseStatusException.class,
            org.springframework.security.access.AccessDeniedException.class);
    assertThatThrownBy(
            () ->
                asSkill(
                    owner,
                    "startSkillCandidateShadowReplay",
                    () -> operations.startSkillCandidateShadowReplay(ref, firstRequest)))
        .isInstanceOfAny(
            org.springframework.web.server.ResponseStatusException.class,
            org.springframework.security.access.AccessDeniedException.class);
    for (var id : List.of(workflow.getId(), compiler.getWorkflowId()))
      grant(owner, Workflow.class, id, owner, "EXECUTE");
    for (var id : List.of(version.getId(), compiler.getWorkflowVersionId()))
      grant(owner, WorkflowVersion.class, id, owner, "EXECUTE");
    assertThatThrownBy(
            () ->
                asSkill(
                    owner,
                    "startSkillCandidateShadowReplay",
                    () ->
                        operations.startSkillCandidateShadowReplay(
                            ref,
                            new SkillShadowReplayExecutionRequest()
                                .baselineCapsuleRef(compiler.getTrainingExperienceRefs().get(0)))))
        .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);

    var evaluated = new java.util.HashSet<UUID>();
    for (String holdout : compiler.getHoldoutExperienceRefs()) {
      var request = new SkillShadowReplayExecutionRequest().baselineCapsuleRef(holdout);
      var admission =
          asSkill(
              owner,
              "startSkillCandidateShadowReplay",
              () -> operations.startSkillCandidateShadowReplay(ref, request).getBody());
      assertThat(admission.getStatus())
          .isEqualTo(SkillShadowReplayExecutionResponse.StatusEnum.ACCEPTED);
      assertThat(admission.getSelectedRoute()).isEqualTo(SkillOptRoute.RUN_WORKFLOW);
      assertThat(evaluated.add(admission.getWorkflowExecutionId())).isTrue();
      var execution = terminal(owner, admission.getWorkflowExecutionId());
      assertThat(execution.getState()).isEqualTo(WorkflowExecution.StateEnum.SUCCESS);
      assertThat(execution.getTestMode()).isFalse();
      assertThat(execution.getWorkflowVersionId()).isEqualTo(compiler.getWorkflowVersionId());
      var report = as(owner, () -> results.read(execution.getId()));
      assertThat(report.resultChecksum()).isEqualTo(expectedByCapsule.get(holdout));
      if (holdout.equals(first)) {
        var retry =
            asSkill(
                owner,
                "startSkillCandidateShadowReplay",
                () -> operations.startSkillCandidateShadowReplay(ref, request).getBody());
        assertThat(retry.getWorkflowExecutionId()).isEqualTo(admission.getWorkflowExecutionId());
        assertThat(retry.getRouteReceiptRef()).isEqualTo(admission.getRouteReceiptRef());
      }
      var routeReceipt =
          as(
              owner,
              () ->
                  application
                      .getBean(SkillOptRouteReceiptService.class)
                      .findSkillOptRouteReceiptByReceiptRef(admission.getRouteReceiptRef())
                      .get(0));
      var event =
          as(
              owner,
              () ->
                  experience.normalize(
                      new SkillObservationRequest()
                          .sourceType(SkillObservationSource.WORKFLOW)
                          .sourceRef("workflow_execution:" + execution.getId())
                          .eventType("native_invoice_method")
                          .evidenceClass(SkillEvidenceClass.REPLAY)
                          .traceId(routeReceipt.getTraceId())
                          .outcome(SkillObservationRequest.OutcomeEnum.SUCCESS)));
      var capsule =
          as(
                  owner,
                  () ->
                      experience.assemble(
                          new SkillExperienceAssembleRequest()
                              .traceId(routeReceipt.getTraceId())
                              .routeReceiptRef(routeReceipt.getReceiptRef())
                              .candidateRef(ref)
                              .observationRefs(List.of(event.getObservationRef()))))
              .getCapsule();
      as(
          owner,
          () ->
              experience.evaluate(
                  capsule.getCapsuleRef(),
                  new SkillExperienceEvaluateRequest().horizon(SkillOutcomeHorizon.TASK)));
      var pair =
          asSkill(
                  owner,
                  "replaySkillImprovementCandidate",
                  () ->
                      operations
                          .replaySkillImprovementCandidate(
                              ref,
                              new SkillCandidateReplayRequest()
                                  .baselineCapsuleRef(holdout)
                                  .candidateCapsuleRef(capsule.getCapsuleRef()))
                          .getBody())
              .getReplay();
      assertThat(pair.getCandidateScore()).isEqualTo(pair.getBaselineScore());
      pairs.add(
          Map.of(
              "baselineCapsuleRef",
              holdout,
              "compiledExecutionId",
              execution.getId(),
              "expectedReportSha256",
              expectedByCapsule.get(holdout),
              "actualReportSha256",
              report.resultChecksum(),
              "routeReceiptRef",
              routeReceipt.getReceiptRef(),
              "replayRef",
              pair.getReplayRef(),
              "taskDigest",
              admission.getTaskDigest(),
              "baselineScore",
              pair.getBaselineScore(),
              "candidateScore",
              pair.getCandidateScore()));
      System.out.println(
          "PROMOTED_STAGE pairedHoldout="
              + holdout
              + " compiledExecution="
              + execution.getId()
              + " actualResult="
              + report.resultChecksum()
              + " route="
              + routeReceipt.getReceiptRef()
              + " replay="
              + pair.getReplayRef()
              + " baselineScore="
              + pair.getBaselineScore()
              + " candidateScore="
              + pair.getCandidateScore());
    }
    assertThat(evaluated).hasSize(20);
    var assessment = as(owner, () -> experiments.assess(ref));
    assertThat(assessment.getCandidate().getStatus()).isEqualTo(SkillCandidateStatus.SHADOW);
    var decision = assessment.getExperiment().getAssessment();
    assertThat(decision.getBaseline().getSampleCount()).isEqualTo(20);
    assertThat(decision.getCandidate().getSampleCount()).isEqualTo(20);
    assertThat(decision.getPromotable()).isFalse();
    System.out.println("PROMOTED_STAGE authenticGuardrails=" + decision.getGuardrails());
    String output = System.getProperty("graymatter.shadow.witness");
    if (output != null) {
      var result = new java.util.LinkedHashMap<String, Object>();
      result.put("schema", "graymatter-native-shadow-replay/v1");
      result.put("sourceWorkflowVersion", version.getId());
      result.put("candidateRef", ref);
      result.put("procedureRef", release.getProcedureRef());
      result.put("compiledVersion", compiler.getWorkflowVersionId());
      result.put("mechanizationReceipt", compiler.getReceiptRef());
      result.put("holdoutSet", compiler.getHoldoutSetRef());
      result.put("trainingCapsules", compiler.getTrainingExperienceRefs());
      result.put("holdoutCapsules", compiler.getHoldoutExperienceRefs());
      result.put("frozenExpectedDigest", digest(String.join("|", expected)));
      result.put("sources", sourceRows);
      result.put("pairs", pairs);
      result.put("memberFallbackRoute", attempt.getRoute().getRecommendedRoute().getValue());
      result.put("memberFallbackReceipt", attempt.getRoute().getReceipt().getReceiptRef());
      result.put("experimentRef", assessment.getCandidate().getExperimentRef());
      result.put("candidateStatus", assessment.getCandidate().getStatus().getValue());
      result.put("promotionAllowed", decision.getPromotable());
      result.put("guardrails", decision.getGuardrails());
      result.put("meanBaselineScore", decision.getBaseline().getMeanOverallScore());
      result.put("meanCandidateScore", decision.getCandidate().getMeanOverallScore());
      try {
        java.nio.file.Files.writeString(
            java.nio.file.Path.of(output),
            mapper.writerWithDefaultPrettyPrinter().writeValueAsString(result) + "\n",
            java.nio.file.StandardOpenOption.CREATE_NEW);
      } catch (java.io.IOException error) {
        throw new AssertionError("Unable to persist native witness", error);
      }
    }
    System.out.println(
        "PROMOTED_STAGE assessed="
            + assessment.getCandidate().getStatus()
            + " experiment="
            + assessment.getCandidate().getExperimentRef());
  }

  String expectedReport(InvoiceReferenceSnapshot source) {
    var known = new java.util.HashSet<UUID>();
    StringBuilder snapshot = new StringBuilder("invoice-customer-reconciliation/v1");
    for (var row : source.invoices())
      snapshot.append("I").append(row.id()).append(row.customerId());
    for (var row : source.customers()) {
      known.add(row.id());
      snapshot.append("C").append(row.id());
    }
    var missing =
        source.invoices().stream()
            .filter(row -> !known.contains(row.customerId()))
            .map(row -> row.id().toString())
            .toList();
    var result = new java.util.TreeMap<String, Object>();
    result.put("customerCount", source.customers().size());
    result.put("invoiceCount", source.invoices().size());
    result.put("matchedCount", source.invoices().size() - missing.size());
    result.put("snapshotRef", "sha256:" + digest(snapshot.toString()));
    result.put("unmatchedCount", missing.size());
    result.put("unmatchedInvoiceIds", missing);
    try {
      return digest(mapper.writeValueAsString(result));
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  static String digest(String text) {
    try {
      return java.util.HexFormat.of()
          .formatHex(
              java.security.MessageDigest.getInstance("SHA-256")
                  .digest(text.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
    } catch (java.security.NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }

  void grant(UUID owner, Class<?> model, UUID id, UUID subject, String action) {
    as(
        owner,
        () ->
            tx(
                () -> {
                  acl.grantPermission(
                      new ObjectIdentityImpl(model, id),
                      subject.toString(),
                      com.valkyrlabs.thorapi.config.impl.ValkyrACL.mapStringToPermission(action));
                  return null;
                }));
  }

  WorkflowExecution terminal(UUID owner, UUID id) {
    var rows = application.getBean(com.valkyrlabs.model.WorkflowExecutionService.class);
    var end =
        java.util.EnumSet.of(
            WorkflowExecution.StateEnum.SUCCESS,
            WorkflowExecution.StateEnum.FAILED,
            WorkflowExecution.StateEnum.TIMEOUT,
            WorkflowExecution.StateEnum.CANCELLED);
    for (int i = 0; i < 160; i++) {
      var execution = as(owner, () -> rows.findById(id).orElseThrow());
      if (end.contains(execution.getState())) return execution;
      try {
        Thread.sleep(250);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        throw new IllegalStateException(e);
      }
    }
    throw new AssertionError("Native workflow failed to reach terminal state in 40 seconds");
  }
}
