package com.valkyrlabs.valkyrai.graymatter.memory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.valkyrlabs.ValkyrAI;
import com.valkyrlabs.api.PrincipalRepository;
import com.valkyrlabs.model.ContentData;
import com.valkyrlabs.model.ContentMediaLink;
import com.valkyrlabs.model.MemoryEntry;
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
import com.valkyrlabs.workflow.engine.conditions.OpenXLSConditionEvaluator;
import com.valkyrlabs.workflow.modules.graymatter.OmegaContextPageModule;
import com.valkyrlabs.workflow.modules.graymatter.OmegaReceiptModule;
import com.valkyrlabs.workflow.service.ExecModuleInputMappingService;
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
import org.springframework.jdbc.core.JdbcTemplate;
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
import org.springframework.web.server.ResponseStatusException;

@SpringBootTest(classes = ValkyrAI.class, properties = {
    "spring.task.scheduling.enabled=false", "spring.quartz.auto-startup=false",
    "billing.signup.welcome-credits=20000", "billing.signup.memory-starter-credits=20000",
    "springdoc.api-docs.enabled=false", "springdoc.swagger-ui.enabled=false",
    "spring.datasource.url=jdbc:h2:mem:cloud_dispatch_query_discovery;MODE=MySQL;DATABASE_TO_LOWER=TRUE;CASE_INSENSITIVE_IDENTIFIERS=TRUE;NON_KEYWORDS=USER,MONTH,INTERVAL;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE",
    "valkyrai.workflow.notification.enabled=false", "valkyrai.workflow.recovery.enabled=false",
    "MAILERSEND_API_KEY=mlsn.native-contained-test", "valkyrai.frontend-base-url=https://valkyrlabs.example",
    "valkyr.bootstrap.super.password=native-association-test", "valkyr.bootstrap.super.once-file=target/test-bootstrap/cloud-dispatch-super.once"})
@ActiveProfiles("test")
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class CloudDispatchQueryDiscoveryJpaTest {
  @Autowired MockMvc mvc;
  @Autowired ApplicationContext applicationContext;
  @Autowired @org.springframework.beans.factory.annotation.Qualifier("requestMappingHandlerMapping")
  org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping handlerMappings;
  @Autowired ObjectMapper json;
  @Autowired JdbcTemplate jdbc;
  @Autowired SystemUserService users;
  @Autowired PrincipalRepository principals;
  @Autowired com.valkyrlabs.api.TenantSchemaRegistryRepository registries;
  @Autowired com.valkyrlabs.valkyrai.service.billing.GrayMatterCoreSchemaProvisioner coreSchemas;
  @Autowired RoleManagementService roles;
  @Autowired OrganizationMembershipLifecycleService memberships;
  @Autowired OrganizationSchemaProvisioningService schemas;
  @Autowired TenantSchemaContextResolver contexts;
  @Autowired TenantSchemaExecutionService routing;
  @Autowired SignupWelcomeCreditService credit;
  @Autowired com.valkyrlabs.valkyrai.graymatter.retrieval.OmegaExecutionPolicy executionPolicy;
  @Autowired ValkyrAclService acl;
  @Autowired org.springframework.security.access.PermissionEvaluator permissions;
  @Autowired PlatformTransactionManager transactions;
  @PersistenceContext EntityManager em;
  // Suppress outbound startup work only. All identity, routing, storage, and HTTP gates are real.
  @MockitoBean com.valkyrlabs.valkyrai.service.TransactionalEmailService email;
  @MockitoBean com.valkyrlabs.valkyrai.service.research.DigitalProductGiveawayResearchService research;


  private static final String RECEIPTS = "/v1/graymatter-retrieval-receipts";

  @Test
  void frozenQueryOnlyPathAndHydratedEndpoints() throws Exception {
    var fixture = json.readTree(java.nio.file.Files.readString(java.nio.file.Path.of(
        System.getProperty("graymatter.dispatch.fixture"))));
    UUID admin = core(() -> principals.findPrincipalByUsername("super").get(0).getId());
    Organization tenant = organization();
    UUID peer = member(tenant, admin, true);
    UUID owner = member(tenant, admin, false);
    Map<String, Object> requesterIdentity = identityEvidence(owner, tenant,
        com.valkyrlabs.model.OrganizationMembership.OrganizationRoleEnum.MEMBER);
    Map<String, Object> peerIdentity = identityEvidence(peer, tenant,
        com.valkyrlabs.model.OrganizationMembership.OrganizationRoleEnum.OWNER);
    provision(tenant);
    var assigned = new java.util.ArrayList<JsonNode>();
    var planted = new java.util.LinkedHashMap<String, Object>();
    for (JsonNode task : fixture.required("cases")) {
      if (!task.required("family").asText().equals("query-free")) continue;
      assigned.add(task);
      String anchorText = task.required("rows").get(0).required("text").asText();
      String targetText = task.required("rows").get(1).required("text").asText();
      UUID target = graphContent(peer, targetText);
      UUID anchor = graphWrite(owner, () -> {
        ContentMediaLink link = new ContentMediaLink();
        link.setOwnerId(owner);
        link.setFileName(anchorText);
        link.setContentData(em.getReference(ContentData.class, target));
        em.persist(link);
        em.flush();
        return link.getId();
      });
      graphPermission(owner, ContentMediaLink.class, anchor, owner, ValkyrAIPermission.MERGE, true);
      graphPermission(peer, ContentData.class, target, owner, ValkyrAIPermission.READ, true);
      graphPermission(peer, ContentData.class, target, owner, ValkyrAIPermission.MERGE, true);
      assertGraphAccess(owner, ContentMediaLink.class, anchor, true, true);
      assertGraphAccess(owner, ContentData.class, target, true, true);
      planted.put(task.required("id").asText(), Map.of("anchor", anchor, "detail", target));
    }
    assertThat(assigned).hasSize(2);
    var observations = new java.util.ArrayList<Map<String, Object>>();
    var failures = new java.util.ArrayList<Throwable>();
    for (JsonNode task : assigned) {
      var observation = new java.util.LinkedHashMap<String, Object>();
      observation.put("case", task.required("id").asText());
      observation.put("query", task.required("query").asText());
      observation.put("shipmentId", task.required("shipmentId").asText());
      long started = System.nanoTime();
      try {
        // Retrieval receives the query only. Planted IDs and facts above are NOT read here.
        GraphRead continuation = graphReceipt(owner, task.required("query").asText());
        JsonNode citation = continuation.tool().required("evidence").get(0).required("graphPathCitations").get(0);
        assertThat(citation.required("seed").required("schemaName").asText()).isEqualTo("ContentMediaLink");
        assertThat(citation.required("target").required("schemaName").asText()).isEqualTo("ContentData");
        assertThat(citation.required("edges").size()).isEqualTo(1);
        UUID source = UUID.fromString(citation.required("seed").required("entityId").asText());
        UUID destination = UUID.fromString(citation.required("target").required("entityId").asText());
        observation.put("discovery", Map.of("id", source.toString(), "contentDataId", destination.toString()));
        observation.put("discoveryPathCitation", citation);
        observation.put("targetEvidence", continuation.evidence());
        observation.put("receipt", continuation.receipt());
        observation.put("plan", continuation.plan());
        observation.put("toolResponse", continuation.tool());
        assertThat(continuation.receipt().required("answerPolicy").asText()).isEqualTo("ALLOW_WITH_CAVEAT");
        assertThat(continuation.evidence().size()).isEqualTo(1);
        assertThat(continuation.receipt().required("items").get(0).required("entityId").asText())
            .isEqualTo(destination.toString());
        // The owning graphReceipt method already re-read the receipt through its current-proof guard.
        JsonNode compiled = response(owner, post("/v1/graymatter_ops/context_page/compile")
            .content(json.writeValueAsString(Map.of(
                "taskIntent", task.required("query").asText(),
                "retrievalReceipt", Map.of("id", continuation.receipt().required("id").asText()),
                "includeTypedPathEndpoints", true, "tokenBudget", 1024))), 200);
        observation.put("compiledPage", compiled);
        JsonNode page = compiled.required("contextPage");
        assertThat(page.required("status").asText()).isEqualTo("compiled");
        assertThat(page.required("items").size()).isEqualTo(2);
        assertThat(page.required("hydrationPointers").size()).isEqualTo(2);
        JsonNode hydrated = response(owner, post("/v1/graymatter_ops/context_page/hydrate")
            .content(json.writeValueAsString(Map.of("contextPageRef", page.required("pageRef").asText(),
                "maxItems", 2, "maxTokens", 1024))), 200);
        observation.put("hydratedPage", hydrated);
        assertThat(hydrated.required("contextPage").required("hydrationPointers").size()).isEqualTo(2);
        for (JsonNode pointer : hydrated.required("contextPage").required("hydrationPointers")) {
          assertThat(pointer.required("status").asText()).isEqualTo("hydrated");
        }
        observation.put("succeeded", true);
      } catch (Throwable failure) {
        failures.add(failure);
        observation.put("succeeded", false);
        observation.put("failureClass", failure.getClass().getName());
        observation.put("failure", String.valueOf(failure.getMessage()));
        failure.printStackTrace(System.out);
      }
      observation.put("elapsedNanos", System.nanoTime() - started);
      observations.add(observation);
    }
    // Separate authorization/ambiguity controls run after both unchanged task captures.
    var controls = new java.util.ArrayList<Map<String, Object>>();
    if (failures.isEmpty()) {
      try {
        JsonNode task = assigned.get(0);
        String query = task.required("query").asText();
        JsonNode first = json.valueToTree(observations.get(0));
        UUID source = UUID.fromString(first.required("discovery").required("id").asText());
        UUID target = UUID.fromString(first.required("discovery").required("contentDataId").asText());
        String text = task.required("rows").get(0).required("text").asText();
        // Peer-owned decoy has no READ or MERGE grant to the requesting ordinary actor.
        UUID hidden = graphLink(peer, text, target);
        assertGraphAccess(owner, ContentMediaLink.class, hidden, false, false);
        GraphRead withHiddenDecoy = graphReceipt(owner, query);
        assertThat(withHiddenDecoy.evidence().size()).isEqualTo(1);
        assertThat(withHiddenDecoy.evidence().get(0).required("graphPathCitations").get(0)
            .required("seed").required("entityId").asText()).isEqualTo(source.toString());
        controls.add(Map.of("control", "unreadable_match_does_not_suppress_unique_authorized_seed", "passed", true));

        var supplied = graphRequest(owner, query).body();
        supplied.put("seedEntities", List.of(Map.of("schemaName", "ContentMediaLink", "entityId", source)));
        MockHttpServletResponse suppliedResponse = request(owner, post("/v1/graymatter/omega/tools/graph-expand")
            .content(json.writeValueAsString(supplied)));
        assertThat(suppliedResponse.getStatus()).isEqualTo(400);
        controls.add(Map.of("control", "explicit_ids_with_discovery_denied", "httpStatus", 400));

        graphPermission(peer, ContentData.class, target, owner, ValkyrAIPermission.READ, false);
        // GRAYMATTER_USER also inherits ContentData READ from the tenant role root.
        // An explicit ordinary object deny is needed to remove effective READ authority.
        graphDenyPermission(peer, ContentData.class, target, owner, ValkyrAIPermission.READ);
        assertGraphAccess(owner, ContentData.class, target, false, true);
        controls.add(noTypedPath(owner, query, "effective_target_read_denied"));
        graphPermission(peer, ContentData.class, target, owner, ValkyrAIPermission.READ, false);
        graphPermission(peer, ContentData.class, target, owner, ValkyrAIPermission.READ, true);
        graphPermission(peer, ContentData.class, target, owner, ValkyrAIPermission.MERGE, false);
        assertGraphAccess(owner, ContentData.class, target, true, false);
        controls.add(noTypedPath(owner, query, "revoked_target_merge"));
        graphPermission(peer, ContentData.class, target, owner, ValkyrAIPermission.MERGE, true);

        UUID ambiguous = graphLink(owner, text, target);
        graphPermission(owner, ContentMediaLink.class, ambiguous, owner, ValkyrAIPermission.MERGE, true);
        controls.add(noTypedPath(owner, query, "second_visible_match_same_fk"));
        UUID other = graphContent(peer, "Separate synthetic target for the ambiguity control");
        graphPermission(peer, ContentData.class, other, owner, ValkyrAIPermission.READ, true);
        graphPermission(peer, ContentData.class, other, owner, ValkyrAIPermission.MERGE, true);
        graphWrite(owner, () -> {
          em.find(ContentMediaLink.class, ambiguous).setContentData(em.getReference(ContentData.class, other));
          em.flush();
          return null;
        });
        controls.add(noTypedPath(owner, query, "second_visible_match_different_fk"));
      } catch (Throwable failure) {
        failures.add(failure);
        controls.add(Map.of("control", "native_control_failure", "class", failure.getClass().getName(),
            "message", String.valueOf(failure.getMessage())));
        failure.printStackTrace(System.out);
      }
    }
    var report = new java.util.LinkedHashMap<String, Object>();
    report.put("schemaVersion", "cloud-dispatch-query-discovery/v1");
    report.put("boundary", "owning HTTP plan and query-only PATH discovery, followed by owning typed endpoint compile and hydrate");
    report.put("tenantId", tenant.getId());
    report.put("actorId", owner);
    report.put("peerId", peer);
    report.put("requesterIdentity", requesterIdentity);
    report.put("peerIdentity", peerIdentity);
    report.put("plantedIdentityMapForIndependentJudgeOnly", planted);
    report.put("observations", observations);
    report.put("controls", controls);
    report.put("runtime", origins());
    java.nio.file.Files.writeString(java.nio.file.Path.of(System.getProperty("graymatter.dispatch.capture")),
        json.writerWithDefaultPrettyPrinter().writeValueAsString(report), java.nio.file.StandardOpenOption.CREATE_NEW);
    assertThat(failures).as("Both frozen cases must complete through the real native boundary").isEmpty();
  }

  private Map<String, Object> origins() throws Exception {
    var result = new java.util.LinkedHashMap<String, Object>();
    for (Class<?> type : List.of(com.valkyrlabs.model.ContentMediaLinkService.class,
        com.valkyrlabs.valkyrai.graymatter.retrieval.GeneratedThorApiGraphSearchProvider.class,
        com.valkyrlabs.valkyrai.graymatter.retrieval.GeneratedGraphSeedDiscovery.class,
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
  private UUID graphContent(UUID actor, String title) {
    return graphWrite(actor, () -> {
      ContentData content = new ContentData();
      content.setOwnerId(actor);
      content.setTitle(title);
      em.persist(content);
      em.flush();
      return content.getId();
    });
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

  private record GraphRead(JsonNode evidence, JsonNode receipt, JsonNode plan, JsonNode tool) {}

  private record PlannedGraphRequest(JsonNode plan, java.util.LinkedHashMap<String, Object> body) { }

  private PlannedGraphRequest graphRequest(UUID actor, String query) throws Exception {
    JsonNode plan = response(actor, post("/v1/graymatter/omega/plan").content(json.writeValueAsString(Map.of(
        "query", query, "mode", "BALANCED", "recipe", "ENTITY_NEIGHBORHOOD", "includeEvaluator", false,
        "budgets", Map.of("maxGraphHops", 1, "maxLatencyMs", 1200, "maxCandidates", 8)))), 200);
    JsonNode graphStep = java.util.stream.StreamSupport.stream(plan.required("steps").spliterator(), false)
        .filter(step -> "graph_expand".equals(step.path("tool").asText()))
        .findFirst().orElseThrow(() -> new AssertionError("Graph step missing: " + plan.path("warnings")));
    int resultLimit = graphStep.required("maxResults").asInt();
    assertThat(resultLimit).isPositive();
    var request = new java.util.LinkedHashMap<String, Object>();
    request.put("query", query);
    request.put("planId", plan.required("plan").required("planId").asText());
    request.put("queryMode", "PATH");
    request.put("discoverPathFromQuery", true);
    request.put("objectTypes", List.of("ContentMediaLink"));
    request.put("graphPaths", List.of("ContentMediaLink.contentData.ContentData"));
    request.put("direction", "OUTBOUND");
    request.put("maxHops", 1);
    request.put("maxNodes", 2);
    request.put("maxEdges", 1);
    request.put("maxResults", 1);
    return new PlannedGraphRequest(plan, request);
  }

  private GraphRead graphReceipt(UUID actor, String query) throws Exception {
    var planned = graphRequest(actor, query);
    var request = planned.body();
    JsonNode result = response(actor, post("/v1/graymatter/omega/tools/graph-expand")
        .content(json.writeValueAsString(request)), 200);
    assertThat(result.required("policyFlags").toString()).contains("graph_query_discovery=omegarag-query-path/v1");
    JsonNode receipt = response(actor, get(RECEIPTS + "/" + result.required("receiptRef").asText()), 200)
        .required("receipt");
    return new GraphRead(result.required("evidence"), receipt, planned.plan(), result);
  }

  private UUID graphLink(UUID actor, String fileName, UUID target) {
    return graphWrite(actor, () -> {
      var source = new ContentMediaLink();
      source.setOwnerId(actor);
      source.setFileName(fileName);
      source.setContentData(em.getReference(ContentData.class, target));
      em.persist(source);
      em.flush();
      return source.getId();
    });
  }

  private Map<String, Object> noTypedPath(UUID actor, String query, String control) throws Exception {
    var body = graphRequest(actor, query).body();
    MockHttpServletResponse actual = request(actor, post("/v1/graymatter/omega/tools/graph-expand")
        .content(json.writeValueAsString(body)));
    assertThat(actual.getStatus()).as(control + ": " + actual.getContentAsString()).isIn(200, 403, 404, 409);
    if (actual.getStatus() == 200) {
      JsonNode result = json.readTree(actual.getContentAsByteArray());
      assertThat(result.path("evidence").isArray()).isTrue();
      assertThat(result.path("evidence").size()).isZero();
      assertThat(result.path("receipt").path("items").size()).isZero();
    }
    return Map.of("control", control, "httpStatus", actual.getStatus(), "typedPathEvidenceCount", 0);
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

  private JsonNode response(UUID actor, MockHttpServletRequestBuilder builder, int expected) throws Exception {
    MockHttpServletResponse actual = request(actor, builder);
    assertThat(actual.getStatus()).as(actual.getContentAsString()).isEqualTo(expected);
    return json.readTree(actual.getContentAsByteArray());
  }

  private void witness(String check, Map<String, ?> values) throws Exception {
    System.out.println("NATIVE_ASSOCIATION_RECALL_WITNESS " + json.writeValueAsString(
        Map.of("check", check, "observed", values)));
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
