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
    "spring.datasource.url=jdbc:h2:mem:cloud_dispatch_query_free;MODE=MySQL;DATABASE_TO_LOWER=TRUE;CASE_INSENSITIVE_IDENTIFIERS=TRUE;NON_KEYWORDS=USER,MONTH,INTERVAL;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE",
    "valkyrai.workflow.notification.enabled=false", "valkyrai.workflow.recovery.enabled=false",
    "MAILERSEND_API_KEY=mlsn.native-contained-test", "valkyrai.frontend-base-url=https://valkyrlabs.example",
    "valkyr.bootstrap.super.password=native-association-test", "valkyr.bootstrap.super.once-file=target/test-bootstrap/cloud-dispatch-super.once"})
@ActiveProfiles("test")
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class CloudDispatchQueryFreeJpaTest {
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
  @Autowired PlatformTransactionManager transactions;
  @PersistenceContext EntityManager em;
  // Suppress outbound startup work only. All identity, routing, storage, and HTTP gates are real.
  @MockitoBean com.valkyrlabs.valkyrai.service.TransactionalEmailService email;
  @MockitoBean com.valkyrlabs.valkyrai.service.research.DigitalProductGiveawayResearchService research;


  @Autowired com.valkyrlabs.model.ContentMediaLinkService links;
  private static final String RECEIPTS = "/v1/graymatter-retrieval-receipts";

  @Test
  void frozenQueryFreeInternalDiscoveryAndExactTypedContinuation() throws Exception {
    var fixture = json.readTree(java.nio.file.Files.readString(java.nio.file.Path.of(
        System.getProperty("graymatter.dispatch.fixture"))));
    UUID admin = core(() -> principals.findPrincipalByUsername("super").get(0).getId());
    Organization tenant = organization();
    UUID owner = member(tenant, admin);
    UUID peer = member(tenant, admin);
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
        Map<String, Object> discovered = discover(owner, task.required("query").asText());
        observation.put("discovery", discovered);
        UUID source = UUID.fromString((String) discovered.get("id"));
        UUID destination = UUID.fromString((String) discovered.get("contentDataId"));
        GraphRead continuation = graphReceipt(owner, task.required("query").asText(), source, List.of(destination));
        observation.put("targetEvidence", continuation.evidence());
        observation.put("receipt", continuation.receipt());
        observation.put("plan", continuation.plan());
        observation.put("toolResponse", continuation.tool());
        assertThat(continuation.receipt().required("answerPolicy").asText()).isEqualTo("ALLOW_WITH_CAVEAT");
        assertThat(continuation.evidence().size()).isEqualTo(1);
        assertThat(continuation.receipt().required("items").get(0).required("entityId").asText())
            .isEqualTo(destination.toString());
        // Current generated service authorization is checked again before the explicit client union.
        Map<String, Object> current = discover(owner, task.required("query").asText());
        assertThat(current).isEqualTo(discovered);
        observation.put("currentDiscovery", current);
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
    var report = new java.util.LinkedHashMap<String, Object>();
    report.put("schemaVersion", "cloud-dispatch-query-free/v1");
    report.put("boundary", "internal generated service discovery; owning HTTP graph continuation");
    report.put("tenantId", tenant.getId());
    report.put("actorId", owner);
    report.put("peerId", peer);
    report.put("plantedIdentityMapForIndependentJudgeOnly", planted);
    report.put("observations", observations);
    report.put("runtime", origins());
    java.nio.file.Files.writeString(java.nio.file.Path.of(System.getProperty("graymatter.dispatch.capture")),
        json.writerWithDefaultPrettyPrinter().writeValueAsString(report), java.nio.file.StandardOpenOption.CREATE_NEW);
    assertThat(failures).as("Both frozen cases must complete through the real native boundary").isEmpty();
  }

  private Map<String, Object> discover(UUID actor, String query) {
    return scoped(actor, () -> tx(() -> routing.executeRead(
        contexts.requireCurrentGrayMatterContext("cloud-dispatch-structured-query"), () -> {
          String example;
          try { example = json.writeValueAsString(Map.of("fileName", Map.of("$contains", query))); }
          catch (Exception failure) { throw new IllegalStateException(failure); }
          var predicate = com.valkyrlabs.thorapi.util.QbeQuery.parse(example, ContentMediaLink.class);
          var matches = links.findAllMatching(predicate, org.springframework.data.domain.PageRequest.of(0, 8));
          assertThat(matches.getContent()).hasSize(1);
          ContentMediaLink match = matches.getContent().get(0);
          // Only the returned relationship identity is read here; target content is not dereferenced.
          return Map.<String, Object>of("id", match.getId().toString(), "fileName", match.getFileName(),
              "contentDataId", match.getContentData().getId().toString(), "example", example,
              "totalElements", matches.getTotalElements());
        })));
  }

  private Map<String, Object> origins() throws Exception {
    var result = new java.util.LinkedHashMap<String, Object>();
    for (Class<?> type : List.of(com.valkyrlabs.model.ContentMediaLinkService.class,
        com.valkyrlabs.valkyrai.graymatter.retrieval.GeneratedThorApiGraphSearchProvider.class,
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

  private record GraphRead(JsonNode evidence, JsonNode receipt, JsonNode plan, JsonNode tool) {}

  private GraphRead graphReceipt(UUID actor, String query, UUID seed, List<UUID> targets) throws Exception {
    JsonNode plan = response(actor, post("/v1/graymatter/omega/plan").content(json.writeValueAsString(Map.of(
        "query", query, "mode", "BALANCED", "recipe", "ENTITY_NEIGHBORHOOD", "includeEvaluator", false,
        "budgets", Map.of("maxGraphHops", 1, "maxLatencyMs", 1200, "maxCandidates", 8)))), 200);
    JsonNode graphStep = java.util.stream.StreamSupport.stream(plan.required("steps").spliterator(), false)
        .filter(step -> "graph_expand".equals(step.path("tool").asText()))
        .findFirst().orElseThrow(() -> new AssertionError("Graph step missing: " + plan.path("warnings")));
    int resultLimit = graphStep.required("maxResults").asInt();
    assertThat(resultLimit).isPositive();
    var request = new java.util.LinkedHashMap<String, Object>(Map.of(
        "query", query, "planId", plan.required("plan").required("planId").asText(),
        "idempotencyKey", "native-typed-path-" + UUID.randomUUID(), "queryMode", "PATH",
        "direction", "OUTBOUND", "maxHops", 1, "maxResults", resultLimit,
        "graphPaths", List.of("ContentMediaLink.contentData.ContentData"),
        "seedEntities", List.of(Map.of("schemaName", "ContentMediaLink", "entityId", seed)),
        "targetEntities", targets.stream().map(id -> Map.of("schemaName", "ContentData", "entityId", id)).toList()));
    request.put("maxNodes", 6);
    JsonNode result = response(actor, post("/v1/graymatter/omega/tools/graph-expand")
        .content(json.writeValueAsString(request)), 200);
    JsonNode receipt = response(actor, get(RECEIPTS + "/" + result.required("receiptRef").asText()), 200)
        .required("receipt");
    return new GraphRead(result.required("evidence"), receipt, plan, result);
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

  private UUID member(Organization org, UUID admin) {
    Principal member = core(() -> users.runAsSystem(() -> tx(() -> {
      Principal p = new Principal().username("nav-" + UUID.randomUUID().toString().substring(0, 12))
          .federalIdentification(null).stateIdentification(null).email(null).phone(null)
          .enabled(true).accountEnabled(true).accountNonExpired(true).accountNonLocked(true).credentialNonExpired(true)
          .organization(em.getReference(Organization.class, org.getId()));
      em.persist(p); em.flush(); return p;
    })));
    core(() -> users.runAsSystem(() -> {
      memberships.ensureOrganizationOwnerMembership(member, org);
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

  private <T> T core(Supplier<T> action) {
    var binding = com.valkyrlabs.valkyrai.service.Api0DataPlaneBindingManifest.load().requireHandlerBinding(
        com.valkyrlabs.valkyrai.security.rbac.RoleManagementController.class, "assignPrincipalRoles");
    return OperationDataPlaneScopeContext.callWith(OperationDataPlaneScope.core(binding.modelBinding()), action);
  }

  private <T> T tx(Supplier<T> action) {
    return new TransactionTemplate(transactions).execute(status -> action.get());
  }
}
