package com.valkyrlabs.valkyrai.graymatter.memory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.valkyrlabs.ValkyrAI;
import com.valkyrlabs.api.PrincipalRepository;
import com.valkyrlabs.model.ContentData;
import com.valkyrlabs.model.ContentMediaLink;
import com.valkyrlabs.model.Organization;
import com.valkyrlabs.model.Principal;
import com.valkyrlabs.thorapi.config.impl.ValkyrAIPermission;
import com.valkyrlabs.valkyrai.security.rbac.RoleManagementService;
import com.valkyrlabs.valkyrai.service.OperationDataPlaneScope;
import com.valkyrlabs.valkyrai.service.OperationDataPlaneScopeContext;
import com.valkyrlabs.valkyrai.service.SystemUserService;
import com.valkyrlabs.valkyrai.service.TenantSchemaContextResolver;
import com.valkyrlabs.valkyrai.service.TenantSchemaExecutionService;
import com.valkyrlabs.valkyrai.service.ValkyrAclService;
import com.valkyrlabs.valkyrai.service.billing.OrganizationSchemaProvisioningService;
import com.valkyrlabs.valkyrai.service.billing.SignupWelcomeCreditService;
import com.valkyrlabs.valkyrai.service.organization.OrganizationMembershipLifecycleService;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.acls.domain.ObjectIdentityImpl;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest(classes = ValkyrAI.class, properties = {
    "spring.task.scheduling.enabled=false", "spring.quartz.auto-startup=false",
    "billing.signup.welcome-credits=20000", "billing.signup.memory-starter-credits=20000",
    "springdoc.api-docs.enabled=false", "springdoc.swagger-ui.enabled=false",
    "spring.datasource.url=jdbc:h2:mem:cloud_dispatch_full_corpus;MODE=MySQL;DATABASE_TO_LOWER=TRUE;CASE_INSENSITIVE_IDENTIFIERS=TRUE;NON_KEYWORDS=USER,MONTH,INTERVAL;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE",
    "valkyrai.workflow.notification.enabled=false", "valkyrai.workflow.recovery.enabled=false",
    "MAILERSEND_API_KEY=mlsn.native-contained-test", "valkyrai.frontend-base-url=https://valkyrlabs.example",
    "valkyr.bootstrap.super.password=native-association-test", "valkyr.bootstrap.super.once-file=target/test-bootstrap/cloud-dispatch-super.once"})
@ActiveProfiles("test")
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class CloudDispatchFullCorpusJpaTest {
  @Autowired MockMvc mvc;
  @Autowired ApplicationContext applicationContext;
  @Autowired ObjectMapper json;
  @Autowired SystemUserService users;
  @Autowired PrincipalRepository principals;
  @Autowired RoleManagementService roles;
  @Autowired OrganizationMembershipLifecycleService memberships;
  @Autowired OrganizationSchemaProvisioningService schemas;
  @Autowired TenantSchemaContextResolver contexts;
  @Autowired TenantSchemaExecutionService routing;
  @Autowired SignupWelcomeCreditService credit;
  @Autowired ValkyrAclService acl;
  @Autowired org.springframework.security.access.PermissionEvaluator permissions;
  @Autowired PlatformTransactionManager transactions;
  @PersistenceContext EntityManager em;
  // Suppress outbound startup work only. All identity, routing, storage, and HTTP gates are real.
  @MockitoBean com.valkyrlabs.valkyrai.service.TransactionalEmailService email;
  @MockitoBean com.valkyrlabs.valkyrai.service.research.DigitalProductGiveawayResearchService research;


  private static final String RECEIPTS = "/v1/graymatter-retrieval-receipts";


  private static final int WARMUPS = 2;
  private static final int MEASURED = 7;
  private static final List<String> ARMS = List.of("source_only", "typed_pair");

  @Test
  void allFrozenCasesThroughMatchedOwningOperations() throws Exception {
    var fixturePath = java.nio.file.Path.of(System.getProperty("graymatter.dispatch.fixture"));
    var protocolPath = java.nio.file.Path.of(System.getProperty("graymatter.dispatch.protocol"));
    JsonNode fixture = json.readTree(java.nio.file.Files.readString(fixturePath));
    JsonNode protocol = json.readTree(java.nio.file.Files.readString(protocolPath));
    assertThat(sha256(java.nio.file.Files.readAllBytes(fixturePath)))
        .isEqualTo("c6fca3e6a0b0c73e327eaab788f3a55d1418a626743695121dcb9eed512488ea");
    assertThat(fixture.required("cases").size()).isEqualTo(12);
    assertThat(protocol.required("assignment").required("warmups").asInt()).isEqualTo(WARMUPS);
    assertThat(protocol.required("assignment").required("measuredRepetitions").asInt()).isEqualTo(MEASURED);
    UUID admin = core(() -> principals.findPrincipalByUsername("super").get(0).getId());
    Organization tenant = organization();
    UUID peer = member(tenant, admin, true);
    UUID actor = member(tenant, admin, false);
    var requester = identityEvidence(actor, tenant,
        com.valkyrlabs.model.OrganizationMembership.OrganizationRoleEnum.MEMBER);
    provision(tenant);
    int capacity = filenameCapacity(actor);
    var rows = new java.util.ArrayList<Map<String, Object>>();
    var failures = new java.util.ArrayList<String>();
    for (JsonNode task : fixture.required("cases")) {
      var observed = new java.util.LinkedHashMap<String, Object>();
      observed.put("id", task.required("id").asText());
      observed.put("query", task.required("query").asText());
      observed.put("shipmentId", task.required("shipmentId").asText());
      Map<String, Object> setup;
      try {
        setup = seedExactCase(actor, peer, task);
      } catch (Exception failure) {
        boolean capacityRejected = task.required("rows").get(0).required("text").asText().length() > capacity
            && hasSqlState(failure, "22001");
        setup = Map.of("status", capacityRejected ? "capacity_rejected" : "setup_error",
            "columnCapacity", capacity, "failureClass", failure.getClass().getName(),
            "failure", String.valueOf(failure.getMessage()));
        if (!capacityRejected) failures.add("Unexpected setup error for " + task.required("id").asText());
      }
      observed.put("setup", setup);
      var warmups = new java.util.ArrayList<Map<String, Object>>();
      var measured = new java.util.ArrayList<Map<String, Object>>();
      for (int iteration = 0; iteration < WARMUPS + MEASURED; iteration++) {
        var trial = new java.util.LinkedHashMap<String, Object>();
        trial.put("iteration", iteration < WARMUPS ? iteration : iteration - WARMUPS);
        for (String arm : ARMS) {
          Map<String, Object> attempt = "ready".equals(setup.get("status"))
              ? executeArm(actor, task.required("query").asText(), arm)
              : Map.of("status", "setup_unavailable", "attempted", false, "elapsedNanos", 0L);
          trial.put(arm, attempt);
          if ("runtime_error".equals(attempt.get("status")))
            failures.add("Runtime error for " + task.required("id").asText() + "/" + arm + "/" + iteration);
        }
        (iteration < WARMUPS ? warmups : measured).add(trial);
      }
      observed.put("warmups", warmups);
      observed.put("trials", measured);
      rows.add(observed);
    }
    List<Map<String, Object>> controls;
    try {
      controls = postCaptureRevocations(actor, peer, rows);
    } catch (Throwable failure) {
      failures.add("Post-capture authority control failed: " + failure.getClass().getName());
      controls = List.of(Map.of("control", "authority_control_failed", "failureClass", failure.getClass().getName(),
          "failure", String.valueOf(failure.getMessage())));
    }
    var report = new java.util.LinkedHashMap<String, Object>();
    report.put("schemaVersion", "cloud-dispatch-full-capture/v1");
    report.put("protocolSha256", sha256(java.nio.file.Files.readAllBytes(protocolPath)));
    report.put("fixtureSha256", sha256(java.nio.file.Files.readAllBytes(fixturePath)));
    report.put("actorId", actor); report.put("peerId", peer); report.put("tenantId", tenant.getId());
    report.put("requesterIdentity", requester);
    report.put("fileNameColumnCapacity", capacity);
    report.put("datasetEnrollment", "synthetic ORM fixture; per-row owner, current effective READ/MERGE verified before any owning HTTP retrieval");
    report.put("cases", rows); report.put("controls", controls); report.put("runtime", origins());
    report.put("unexpectedFailures", failures);
    java.nio.file.Files.writeString(java.nio.file.Path.of(System.getProperty("graymatter.dispatch.capture")),
        json.writerWithDefaultPrettyPrinter().writeValueAsString(report), java.nio.file.StandardOpenOption.CREATE_NEW);
    assertThat(failures).as("Record unsupported assignments, but fail unexpected infrastructure errors").isEmpty();
  }

  private Map<String, Object> seedExactCase(UUID actor, UUID peer, JsonNode task) {
    var byKey = new java.util.LinkedHashMap<String, JsonNode>();
    for (JsonNode row : task.required("rows")) byKey.put(row.required("key").asText(), row);
    assertThat(byKey.keySet()).contains("anchor");
    assertThat(task.required("links").size()).isLessThanOrEqualTo(1);
    boolean linked = task.required("links").size() == 1;
    if (linked) {
      assertThat(task.required("links").get(0).required("from").asText()).isEqualTo("anchor");
      assertThat(task.required("links").get(0).required("to").asText()).isEqualTo("detail");
    }
    // Synthetic dataset enrollment, not a claim about generated create API permissions.
    // Retrieval, ownership, ACLs, plans, proofs, and output operations below use real services.
    // One atomic transaction means a rejected anchor never leaves a detail row behind.
    Map<String, UUID> ids = graphWrite(actor, () -> {
      var result = new java.util.LinkedHashMap<String, UUID>();
      ContentData detail = null;
      if (byKey.containsKey("detail")) {
        detail = new ContentData();
        detail.setOwnerId(peer);
        detail.setTitle(byKey.get("detail").required("text").asText());
        var tags = new java.util.ArrayList<com.valkyrlabs.model.Tag>();
        for (JsonNode supplied : byKey.get("detail").path("tags")) {
          var tag = new com.valkyrlabs.model.Tag().name(supplied.asText()).ownerId(peer);
          em.persist(tag); tags.add(tag);
        }
        detail.setTags(tags);
        em.persist(detail); em.flush(); result.put("detail", detail.getId());
      }
      var anchor = new ContentMediaLink();
      anchor.setOwnerId(actor); anchor.setFileName(byKey.get("anchor").required("text").asText());
      if (linked) anchor.setContentData(detail);
      em.persist(anchor); em.flush(); result.put("anchor", anchor.getId());
      return Map.copyOf(result);
    });
    graphPermission(actor, ContentMediaLink.class, ids.get("anchor"), actor, ValkyrAIPermission.MERGE, true);
    assertGraphAccess(actor, ContentMediaLink.class, ids.get("anchor"), true, true);
    boolean excluded = byKey.containsKey("detail") && byKey.get("detail").hasNonNull("sourceSuffix");
    if (ids.containsKey("detail")) {
      UUID target = ids.get("detail");
      if (excluded) {
        graphDenyPermission(peer, ContentData.class, target, actor, ValkyrAIPermission.READ);
        graphDenyPermission(peer, ContentData.class, target, actor, ValkyrAIPermission.MERGE);
      } else {
        graphPermission(peer, ContentData.class, target, actor, ValkyrAIPermission.READ, true);
        graphPermission(peer, ContentData.class, target, actor, ValkyrAIPermission.MERGE, true);
      }
      assertGraphAccess(actor, ContentData.class, target, !excluded, !excluded);
    }
    var bindings = new java.util.LinkedHashMap<String, Object>();
    for (var entry : ids.entrySet()) {
      var row = byKey.get(entry.getKey());
      bindings.put(entry.getKey(), Map.of("nativeId", entry.getValue(),
          "schemaName", entry.getKey().equals("anchor") ? "ContentMediaLink" : "ContentData",
          "field", entry.getKey().equals("anchor") ? "fileName" : "title",
          "textSha256", sha256(row.required("text").asText().getBytes(java.nio.charset.StandardCharsets.UTF_8)),
          "excluded", row.hasNonNull("sourceSuffix")));
    }
    return Map.of("status", "ready", "bindings", bindings, "linked", linked,
        "freeLinkLabelsRetainedAsAuthority", false);
  }

  private Map<String, Object> executeArm(UUID actor, String query, String arm) {
    var observed = new java.util.LinkedHashMap<String, Object>();
    observed.put("attempted", true);
    long started = System.nanoTime();
    try {
      var planRequest = Map.of("query", query, "mode", "BALANCED", "recipe", "ENTITY_NEIGHBORHOOD",
          "includeEvaluator", false, "budgets", Map.of("maxGraphHops", 1, "maxLatencyMs", 1200, "maxCandidates", 8));
      JsonNode plan = exchange(actor, "plan", "/v1/graymatter/omega/plan", planRequest, observed);
      if (plan == null) return observed;
      var graph = new java.util.LinkedHashMap<String, Object>();
      graph.put("query", query); graph.put("planId", plan.required("plan").required("planId").asText());
      graph.put("objectTypes", List.of("ContentMediaLink")); graph.put("maxResults", 1);
      if (arm.equals("source_only")) {
        graph.put("queryMode", "ENTITY"); graph.put("maxHops", 0); graph.put("maxNodes", 1);
      } else {
        graph.put("queryMode", "PATH"); graph.put("discoverPathFromQuery", true);
        graph.put("graphPaths", List.of("ContentMediaLink.contentData.ContentData"));
        graph.put("direction", "OUTBOUND"); graph.put("maxHops", 1); graph.put("maxNodes", 2); graph.put("maxEdges", 1);
      }
      JsonNode tool = exchange(actor, "tool", "/v1/graymatter/omega/tools/graph-expand", graph, observed);
      if (tool == null) return observed;
      var current = request(actor, get(RECEIPTS + "/" + tool.required("receiptRef").asText()));
      observed.put("receiptHttpStatus", current.getStatus());
      JsonNode currentBody = json.readTree(current.getContentAsByteArray()); observed.put("receiptResponse", currentBody);
      if (current.getStatus() != 200) { deniedOrError(observed, current.getStatus()); return observed; }
      JsonNode receipt = currentBody.required("receipt");
      if (receipt.path("items").size() != 1) { observed.put("status", "native_withheld"); return observed; }
      if (arm.equals("source_only")) {
        JsonNode item = receipt.required("items").get(0);
        var readRequest = Map.of("planId", graph.get("planId"), "query", query,
            "searchReceiptRef", receipt.required("receiptId").asText(),
            "sourceRef", item.required("memoryId").asText(), "maxBytes", 4096, "maxTokens", 1024);
        JsonNode read = exchange(actor, "read", "/v1/graymatter/omega/tools/target-read", readRequest, observed);
        if (read == null) return observed;
        observed.put("status", "completed");
      } else {
        boolean typed = "ALLOW_WITH_CAVEAT".equals(receipt.path("answerPolicy").asText())
            && receipt.path("policy").path("policyNotes").toString()
                .contains("graph_evidence_claim_scope=typed_path_and_endpoint_projection_only");
        if (!typed) { observed.put("status", "native_withheld"); return observed; }
        var compile = Map.of("taskIntent", query, "retrievalReceipt", Map.of("id", receipt.required("id").asText()),
            "includeTypedPathEndpoints", true, "tokenBudget", 1024);
        JsonNode page = exchange(actor, "compile", "/v1/graymatter_ops/context_page/compile", compile, observed);
        if (page == null) return observed;
        JsonNode hydrated = exchange(actor, "hydrate", "/v1/graymatter_ops/context_page/hydrate",
            Map.of("contextPageRef", page.required("contextPage").required("pageRef").asText(),
                "maxItems", 2, "maxTokens", 1024), observed);
        if (hydrated == null) return observed;
        observed.put("status", "completed");
      }
    } catch (Exception failure) {
      observed.put("status", "runtime_error"); observed.put("failureClass", failure.getClass().getName());
      observed.put("failure", String.valueOf(failure.getMessage()));
    } finally { observed.put("elapsedNanos", System.nanoTime() - started); }
    return observed;
  }

  private JsonNode exchange(UUID actor, String name, String path, Object body, Map<String, Object> observed) throws Exception {
    observed.put(name + "Request", body);
    var actual = request(actor, post(path).content(json.writeValueAsString(body)));
    observed.put(name + "HttpStatus", actual.getStatus());
    JsonNode result = json.readTree(actual.getContentAsByteArray()); observed.put(name + "Response", result);
    if (actual.getStatus() != 200) { deniedOrError(observed, actual.getStatus()); return null; }
    return result;
  }

  private static void deniedOrError(Map<String, Object> observed, int status) {
    observed.put("status", List.of(403, 404, 409).contains(status) ? "native_denied"
        : List.of(400, 422).contains(status) ? "native_rejected" : "runtime_error");
  }

  private List<Map<String, Object>> postCaptureRevocations(UUID actor, UUID peer,
      List<Map<String, Object>> cases) throws Exception {
    for (Map<String, Object> candidate : cases) {
      JsonNode row = json.valueToTree(candidate);
      JsonNode attempt = row.required("trials").get(MEASURED - 1).required("typed_pair");
      if (!"completed".equals(attempt.path("status").asText())) continue;
      UUID target = UUID.fromString(row.required("setup").required("bindings").required("detail").required("nativeId").asText());
      var controls = new java.util.ArrayList<Map<String, Object>>();
      graphPermission(peer, ContentData.class, target, actor, ValkyrAIPermission.READ, false);
      graphDenyPermission(peer, ContentData.class, target, actor, ValkyrAIPermission.READ);
      assertGraphAccess(actor, ContentData.class, target, false, true);
      controls.add(staleOutputsDenied(actor, attempt, "effective_read_denied"));
      graphPermission(peer, ContentData.class, target, actor, ValkyrAIPermission.READ, false);
      graphPermission(peer, ContentData.class, target, actor, ValkyrAIPermission.READ, true);
      graphPermission(peer, ContentData.class, target, actor, ValkyrAIPermission.MERGE, false);
      assertGraphAccess(actor, ContentData.class, target, true, false);
      controls.add(staleOutputsDenied(actor, attempt, "merge_revoked"));
      graphPermission(peer, ContentData.class, target, actor, ValkyrAIPermission.MERGE, true);
      return controls;
    }
    return List.of(Map.of("control", "revocation_unavailable", "reason", "no completed typed pair in measured capture"));
  }

  private Map<String, Object> staleOutputsDenied(UUID actor, JsonNode attempt, String name) throws Exception {
    String receipt = attempt.required("toolResponse").required("receiptRef").asText();
    String page = attempt.required("hydrateResponse").required("contextPage").required("pageRef").asText();
    var receiptRead = request(actor, get(RECEIPTS + "/" + receipt));
    var hydrate = request(actor, post("/v1/graymatter_ops/context_page/hydrate")
        .content(json.writeValueAsString(Map.of("contextPageRef", page, "maxItems", 2, "maxTokens", 1024))));
    assertThat(receiptRead.getStatus()).isIn(403, 404, 409);
    assertThat(hydrate.getStatus()).isIn(403, 404, 409);
    return Map.of("control", name, "receiptRef", receipt, "pageRef", page,
        "receiptHttpStatus", receiptRead.getStatus(), "hydrateHttpStatus", hydrate.getStatus());
  }

  private int filenameCapacity(UUID actor) {
    return graphWrite(actor, () -> em.unwrap(org.hibernate.Session.class).doReturningWork(connection -> {
      try (var columns = connection.getMetaData().getColumns(null, connection.getSchema(), "%", "%")) {
        while (columns.next()) {
          if ("content_media_link".equalsIgnoreCase(columns.getString("TABLE_NAME"))
              && "file_name".equalsIgnoreCase(columns.getString("COLUMN_NAME"))) return columns.getInt("COLUMN_SIZE");
        }
      }
      throw new IllegalStateException("Current tenant filename column is unavailable");
    }));
  }

  private static boolean hasSqlState(Throwable failure, String state) {
    for (Throwable current = failure; current != null; current = current.getCause())
      if (current instanceof java.sql.SQLException sql && state.equals(sql.getSQLState())) return true;
    return false;
  }

  private static String sha256(byte[] input) {
    try { return java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(input)); }
    catch (java.security.NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
  }

  private Map<String, Object> origins() throws Exception {
    var result = new java.util.LinkedHashMap<String, Object>();
    for (Class<?> type : List.of(com.valkyrlabs.model.ContentMediaLinkService.class,
        com.valkyrlabs.valkyrai.graymatter.retrieval.GeneratedThorApiGraphSearchProvider.class,
        com.valkyrlabs.valkyrai.graymatter.retrieval.GeneratedGraphSeedDiscovery.class,
        com.valkyrlabs.valkyrai.graymatter.retrieval.OmegaSourceReadRuntimeService.class,
        com.valkyrlabs.valkyrai.graymatter.retrieval.GeneratedGraphPathProofService.class,
        com.valkyrlabs.valkyrai.graymatter.retrieval.RetrievalReceiptRuntimeService.class,
        com.valkyrlabs.valkyrai.graymatter.retrieval.OmegaRetrievalToolRuntimeService.class,
        com.valkyrlabs.valkyrai.memory.ThorApiEntityIndexDocumentBuilder.class)) {
      try (var bytes = type.getResourceAsStream("/" + type.getName().replace('.', '/') + ".class")) {
        result.put(type.getName(), Map.of("codeSource", type.getProtectionDomain().getCodeSource().getLocation().toString(),
            "sha256", java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(bytes.readAllBytes()))));
      }
    }
    return result;
  }
  private <T> T graphWrite(UUID actor, Supplier<T> action) {
    return scoped(actor, () -> tx(() -> routing.executeWrite(
        contexts.requireCurrentGrayMatterContext("native-typed-graph-fixture"), action)));
  }

  private void graphPermission(UUID actor, Class<?> type, UUID id, UUID reader,
      org.springframework.security.acls.model.Permission permission, boolean grant) {
    graphWrite(actor, () -> {
      var identity = new ObjectIdentityImpl(type, id);
      if (grant) acl.grantPermission(identity, reader.toString(), permission);
      else assertThat(acl.revokePermission(identity, reader.toString(), permission)).isPositive();
      return null;
    });
  }

  private void graphDenyPermission(UUID actor, Class<?> type, UUID id, UUID reader,
      org.springframework.security.acls.model.Permission permission) {
    graphWrite(actor, () -> {
      acl.denyPermission(new ObjectIdentityImpl(type, id), reader.toString(), permission);
      return null;
    });
  }

  private MockHttpServletResponse request(UUID actor, MockHttpServletRequestBuilder builder) throws Exception {
    Authentication authentication = core(() -> users.runAsPrincipal(actor,
        () -> SecurityContextHolder.getContext().getAuthentication()));
    var result = mvc.perform(builder.with(authentication(authentication)).with(csrf()).contentType("application/json")).andReturn();
    if (result.getResponse().getStatus() >= 500 && result.getResolvedException() != null) {
      result.getResolvedException().printStackTrace(System.out);
    }
    return result.getResponse();
  }

  private <T> T scoped(UUID actor, Supplier<T> action) {
    return core(() -> users.runAsPrincipal(actor, () -> {
      var ctx = contexts.requireCurrentGrayMatterContext("native-association-recall-test");
      return OperationDataPlaneScopeContext.callTenantGrayMatterChildOperation(OperationDataPlaneScope.tenantGrayMatterBundle(ctx), action);
    }));
  }

  private void provision(Organization org) {
    core(() -> users.runAsSystem(() -> { schemas.provisionGrayMatterCoreForOrganization(org); return null; }));
  }

  private Organization organization() {
    return core(() -> users.runAsSystem(() -> tx(() -> {
      Organization org = new Organization().name("navigation-control-" + UUID.randomUUID());
      em.persist(org); em.flush(); return org;
    })));
  }

  private UUID member(Organization org, UUID admin, boolean organizationOwner) {
    Principal member = core(() -> users.runAsSystem(() -> tx(() -> {
      Principal p = new Principal().username("nav-" + UUID.randomUUID().toString().substring(0, 12))
          .federalIdentification(null).stateIdentification(null).email(null).phone(null)
          .enabled(true).accountEnabled(true).accountNonExpired(true).accountNonLocked(true).credentialNonExpired(true)
          .organization(em.getReference(Organization.class, org.getId()));
      em.persist(p); em.flush(); return p;
    })));
    core(() -> users.runAsSystem(() -> {
      if (organizationOwner) {
        memberships.ensureOrganizationOwnerMembership(member, org);
      } else {
        // Same native enrollment convention as WorkflowCapabilityGrantLifecycleJpaTest:
        // the synthetic requester is a MEMBER, not a tenant-wide privileged owner.
        tx(() -> {
          var membership = new com.valkyrlabs.model.OrganizationMembership()
              .principal(em.getReference(Principal.class, member.getId()))
              .organization(em.getReference(Organization.class, org.getId()))
              .ownerId(admin)
              .organizationRole(com.valkyrlabs.model.OrganizationMembership.OrganizationRoleEnum.MEMBER)
              .status(com.valkyrlabs.model.OrganizationMembership.StatusEnum.ACTIVE)
              .personalTenant(false).activatedAt(OffsetDateTime.now());
          em.persist(membership);
          em.flush();
          return null;
        });
      }
      return tx(() -> {
        var identity = new ObjectIdentityImpl(Principal.class, member.getId());
        acl.grantPermission(identity, admin.toString(), ValkyrAIPermission.READ);
        acl.grantPermission(identity, admin.toString(), ValkyrAIPermission.WRITE);
        return null;
      });
    }));
    core(() -> users.runAsPrincipal(admin, () -> roles.assignPrincipalRoles(member.getId(), List.of("FREE", "GRAYMATTER_USER"))));
    core(() -> credit.ensureSignupWelcomeCredits(member.getId()));
    core(() -> users.runAsPrincipal(member.getId(), () -> {
      assertThat(SecurityContextHolder.getContext().getAuthentication().getAuthorities())
          .extracting(authority -> authority.getAuthority())
          .contains("ROLE_GRAYMATTER_USER").doesNotContain("ROLE_VALKYR_CORE", "ROLE_ADMIN", "ROLE_SYSTEM");
      return null;
    }));
    return member.getId();
  }

  private Map<String, Object> identityEvidence(UUID actor, Organization org,
      com.valkyrlabs.model.OrganizationMembership.OrganizationRoleEnum expected) {
    var actualMembership = core(() -> users.runAsSystem(() -> {
      var rows = memberships.membershipsFor(actor).stream()
          .filter(row -> org.getId().equals(row.getOrganization().getId())).toList();
      assertThat(rows).hasSize(1);
      var row = rows.get(0);
      assertThat(row.getOrganizationRole()).isEqualTo(expected);
      assertThat(row.getStatus()).isEqualTo(com.valkyrlabs.model.OrganizationMembership.StatusEnum.ACTIVE);
      assertThat(row.getPersonalTenant()).isFalse();
      return Map.<String, Object>of("membershipId", row.getId(),
          "organizationId", row.getOrganization().getId(), "organizationRole", row.getOrganizationRole().getValue(),
          "status", row.getStatus().getValue(), "personalTenant", row.getPersonalTenant());
    }));
    return core(() -> users.runAsPrincipal(actor, () -> {
      var authentication = SecurityContextHolder.getContext().getAuthentication();
      var authorities = authentication.getAuthorities().stream().map(authority -> authority.getAuthority()).sorted().toList();
      assertThat(authorities).contains("ROLE_GRAYMATTER_USER")
          .doesNotContain("ROLE_VALKYR_CORE", "ROLE_ADMIN", "ROLE_SYSTEM");
      var authenticated = (Principal) authentication.getPrincipal();
      assertThat(authenticated.getId()).isEqualTo(actor);
      assertThat(authenticated.getOrganization().getId()).isEqualTo(org.getId());
      var evidence = new java.util.LinkedHashMap<String, Object>(actualMembership);
      evidence.put("actorId", actor);
      evidence.put("authorities", authorities);
      return Map.copyOf(evidence);
    }));
  }

  private void assertGraphAccess(UUID actor, Class<?> type, UUID id, boolean read, boolean merge) {
    scoped(actor, () -> tx(() -> routing.executeRead(
        contexts.requireCurrentGrayMatterContext("native-discovery-acl-verification"), () -> {
          var authentication = SecurityContextHolder.getContext().getAuthentication();
          assertThat(permissions.hasPermission(authentication, id, type.getName(), "READ"))
              .as("current %s READ for %s", type.getSimpleName(), actor).isEqualTo(read);
          assertThat(permissions.hasPermission(authentication, id, type.getName(), "MERGE"))
              .as("current %s MERGE for %s", type.getSimpleName(), actor).isEqualTo(merge);
          return null;
        })));
  }

  private <T> T core(Supplier<T> action) {
    var binding = com.valkyrlabs.valkyrai.service.Api0DataPlaneBindingManifest.load().requireHandlerBinding(
        com.valkyrlabs.valkyrai.security.rbac.RoleManagementController.class, "assignPrincipalRoles");
    return OperationDataPlaneScopeContext.callWith(OperationDataPlaneScope.core(binding.modelBinding()), action);
  }

  private <T> T tx(Supplier<T> action) {
    return new TransactionTemplate(transactions).execute(status -> action.get());
  }
}
