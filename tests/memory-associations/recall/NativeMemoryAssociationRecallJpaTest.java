package com.valkyrlabs.valkyrai.graymatter.memory;

import static org.assertj.core.api.Assertions.assertThat;
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

@SpringBootTest(classes = ValkyrAI.class, properties = {
    "spring.task.scheduling.enabled=false", "spring.quartz.auto-startup=false",
    "billing.signup.welcome-credits=20000", "billing.signup.memory-starter-credits=20000",
    "springdoc.api-docs.enabled=false", "springdoc.swagger-ui.enabled=false",
    "spring.datasource.url=jdbc:h2:mem:native_memory_association_recall;MODE=MySQL;DATABASE_TO_LOWER=TRUE;CASE_INSENSITIVE_IDENTIFIERS=TRUE;NON_KEYWORDS=USER,MONTH,INTERVAL;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE",
    "valkyrai.workflow.notification.enabled=false", "valkyrai.workflow.recovery.enabled=false",
    "MAILERSEND_API_KEY=mlsn.native-contained-test", "valkyrai.frontend-base-url=https://valkyrlabs.example",
    "valkyr.bootstrap.super.password=native-association-test", "valkyr.bootstrap.super.once-file=target/test-bootstrap/association-super.once"})
@ActiveProfiles("test")
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class NativeMemoryAssociationRecallJpaTest {
  private static final String PATH = "/v1/graymatter/memory/associations";
  private static final String MEMORY = "/v1/MemoryEntry";
  @Autowired MockMvc mvc;
  @Autowired @org.springframework.beans.factory.annotation.Qualifier("requestMappingHandlerMapping")
  org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping handlerMappings;
  @org.springframework.test.context.bean.override.mockito.MockitoSpyBean
  MemoryAssociationRecallSource recallDiscovery;
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
  @Autowired ValkyrAclService acl;
  @Autowired PlatformTransactionManager transactions;
  @PersistenceContext EntityManager em;
  // Suppress outbound startup work only. All identity, routing, storage, and HTTP gates are real.
  @MockitoBean com.valkyrlabs.valkyrai.service.TransactionalEmailService email;
  @MockitoBean com.valkyrlabs.valkyrai.service.research.DigitalProductGiveawayResearchService research;

  private static final String RECEIPTS = "/v1/graymatter-retrieval-receipts";
  private static final String PAGES = "/v1/graymatter_ops/context_page";

  @Test
  void nativeRecallRechecksSourceAuthorityAndDurableProofOnEveryConsumer() throws Exception {
    runtimeOriginWitness();
    UUID admin = core(() -> principals.findPrincipalByUsername("super").get(0).getId());
    Organization tenant = organization();
    UUID owner = member(tenant, admin);
    UUID peer = member(tenant, admin);
    Organization other = organization();
    UUID foreign = member(other, admin);
    provision(tenant);
    provision(other);
    String query = "Zephyr courier";
    // The current JPA keyword provider requires all query terms and ranks by creation time.
    // Seed eligible detail records first, then the independently selected newest anchor.
    UUID detail = createMemory(peer, "Zephyr courier collection code is indigo-six.");
    UUID admittedUnlinked = createMemory(owner, "Zephyr courier packing guide uses a woven envelope.");
    UUID anchor = createMemory(owner,
        "Zephyr courier dispatch. Zephyr courier staff consult the collection note. "
            + "Zephyr courier uses the documented collection code.");
    permission(owner, anchor, owner, "MERGE", true);
    permission(owner, admittedUnlinked, owner, "MERGE", true);
    permission(peer, detail, owner, "READ", true);

    JsonNode ordinary = receipt(owner, query, false);
    assertThat(memoryIds(ordinary)).contains(anchor.toString()).doesNotContain(detail.toString());
    assertThat(ordinary.path("associationPolicyVersion").isMissingNode()
        || ordinary.path("associationPolicyVersion").isNull()).isTrue();
    JsonNode edge = response(owner, post(PATH).content(json.writeValueAsString(
        Map.of("fromId", anchor, "toId", detail, "relation", "supersedes"))), 201);
    JsonNode readOnly = receipt(owner, query, true);
    assertThat(memoryIds(readOnly)).contains(anchor.toString()).doesNotContain(detail.toString());
    assertThat(readOnly.path("associationRefs").size()).isZero();
    permission(peer, detail, owner, "MERGE", true);
    JsonNode expanded = receipt(owner, query, true);
    assertThat(memoryIds(expanded)).contains(anchor.toString(), detail.toString());
    assertThat(expanded.required("associationPolicyVersion").asText())
        .isEqualTo("graymatter-association-recall/v1");
    JsonNode trace = expanded.required("associationRefs").get(0);
    assertThat(fieldNames(trace)).containsExactlyInAnyOrder("associationRef", "anchorId", "memoryId",
        "associationHash", "anchorSourceHash", "sourceHash");
    assertThat(trace.required("associationRef").asText()).isEqualTo(edge.required("associationRef").asText());
    assertThat(trace.required("anchorId").asText()).isEqualTo(anchor.toString());
    assertThat(trace.required("memoryId").asText()).isEqualTo(detail.toString());
    response(owner, get(RECEIPTS + "/" + expanded.required("receiptId").asText()), 200);
    denied(foreign, get(RECEIPTS + "/" + expanded.required("receiptId").asText()));

    JsonNode pageResponse = response(owner, post(PAGES + "/compile").content(json.writeValueAsString(
        Map.of("taskIntent", query, "retrievalReceipt", Map.of("id", expanded.required("id").asText())))), 200);
    String page = pageResponse.required("contextPage").required("pageRef").asText();
    response(owner, get(PAGES + "/" + page), 200);
    JsonNode nativePage = pageResponse.required("contextPage");
    UUID originalPageId = UUID.fromString(nativePage.required("id").asText());
    routePageLocatorRoundTrip(nativePage);
    JsonNode route = response(owner, post("/v1/skillopt_ops/route").content(json.writeValueAsString(
        Map.of("taskType", "validation", "contextPage", routePageInput(nativePage),
            "traceId", "native-association-route-" + UUID.randomUUID()))), 200).required("receipt");
    UUID routeId = UUID.fromString(route.required("id").asText());
    String historicalRoutePath = "/v1/skillopt_ops/" + owner + "/route_receipts/"
        + route.required("receiptRef").asText();
    assertPageLocator(route, originalPageId);
    JsonNode storedRoute = response(owner, get(historicalRoutePath), 200);
    assertThat(storedRoute.required("id").asText()).isEqualTo(routeId.toString());
    assertPageLocator(storedRoute, originalPageId);
    rawCrudDenied(admin, "SkillOptRouteReceipt", routeId);
    rawCrudDenied(admin, "ContextPage", originalPageId);
    for (JsonNode pageItem : nativePage.path("items")) {
      if (pageItem.hasNonNull("id")) rawCrudDenied(admin, "ContextPageItem", UUID.fromString(pageItem.required("id").asText()));
    }
    witness("route-page-locator", Map.of("routeId", routeId, "contextPageId", originalPageId,
        "configuredMapperInputAndOutputChecked", true, "owningHistoricalRouteRead", true));
    witness("native-positive", Map.of("anchor", anchor, "detail", detail,
        "associationRef", edge.required("associationRef"), "receipt", expanded.required("receiptId"),
        "answerPolicy", expanded.path("answerPolicy"), "contextPageRef", page));

    // The emitted trace proves detail belonged to this exact receipt's original pool.
    // A second label creates a distinct edge, without guessing a provider's cutoff.
    var originalPool = originalEligibleIds(owner, UUID.fromString(expanded.required("id").asText()));
    assertThat(originalPool).contains(anchor.toString(), detail.toString());
    System.out.println("NATIVE_ASSOCIATION_RECALL_DIAGNOSTIC " + json.writeValueAsString(Map.of(
        "receipt", expanded.required("receiptId"), "eligibleSourceIds", originalPool,
        "unlinkedCandidateIncluded", originalPool.contains(admittedUnlinked.toString()))));
    JsonNode newEdge = response(owner, post(PATH).content(json.writeValueAsString(
        Map.of("fromId", anchor, "toId", detail, "relation", "packing detail"))), 201);
    assertThat(newEdge.required("associationRef")).isNotEqualTo(edge.required("associationRef"));
    JsonNode persistedEdge = response(owner, get(PATH + "/" + newEdge.required("associationRef").asText()), 200);
    for (String field : List.of("associationRef", "fromId", "toId", "relation", "tupleHash")) {
      assertThat(persistedEdge.required(field)).as(field).isEqualTo(newEdge.required(field));
    }
    assertThat(persistedEdge.required("fromId").asText()).isEqualTo(anchor.toString());
    assertThat(persistedEdge.required("toId").asText()).isEqualTo(detail.toString());
    denied(owner, get(RECEIPTS + "/" + expanded.required("receiptId").asText()));
    deniedPageConsumers(owner, page);
    witness("new-edge-within-admitted-pool", Map.of("oldReceipt", expanded.required("receiptId"),
        "originalAssociation", edge.required("associationRef"),
        "newAssociation", newEdge.required("associationRef"), "target", detail,
        "originalEligibleSourceIds", originalPool, "sameEligibleNeighborNewEdge", true));
    expanded = receipt(owner, query, true);
    pageResponse = response(owner, post(PAGES + "/compile").content(json.writeValueAsString(
        Map.of("taskIntent", query, "retrievalReceipt", Map.of("id", expanded.required("id").asText())))), 200);
    page = pageResponse.required("contextPage").required("pageRef").asText();
    response(owner, get(PAGES + "/" + page), 200);

    permission(peer, detail, owner, "READ", false);
    denied(owner, get(PATH + "/" + edge.required("associationRef").asText()));
    denied(owner, get(RECEIPTS + "/" + expanded.required("receiptId").asText()));
    deniedPageConsumers(owner, page);
    denied(owner, post("/v1/skillopt_ops/route").content(json.writeValueAsString(
        Map.of("taskType", "validation", "contextPage", routePageInput(pageResponse.required("contextPage")),
            "traceId", "native-revoked-route-" + UUID.randomUUID()))));
    // The owning tenant-scoped history route stays visible; its relation is a locator only.
    // Reading current page contents still goes through the guarded ContextPage endpoint.
    JsonNode historicalRoute = response(owner, get(historicalRoutePath), 200);
    assertThat(historicalRoute.required("id").asText()).isEqualTo(routeId.toString());
    assertPageLocator(historicalRoute, originalPageId);
    response(owner, get(RECEIPTS + "/" + ordinary.required("receiptId").asText()), 200);
    witness("source-read-revoked", Map.of("receipt", expanded.required("receiptId"), "ordinaryStillReadable", true));

    permission(peer, detail, owner, "READ", true);
    JsonNode fresh = receipt(owner, query, true);
    response(owner, patch(MEMORY + "/" + anchor).content(
        "{\"text\":\"Zephyr courier collection note was corrected. Zephyr courier requires a new verification.\"}"), 200);
    denied(owner, get(RECEIPTS + "/" + fresh.required("receiptId").asText()));
    witness("anchor-corrected", Map.of("receipt", fresh.required("receiptId"), "anchor", anchor));

    JsonNode protectedReceipt = receipt(owner, query, true);
    UUID protectedId = UUID.fromString(protectedReceipt.required("id").asText());
    UUID bindingId = scoped(owner, () -> tx(() -> routing.executeRead(
        contexts.requireCurrentGrayMatterContext("native-binding-identity"), () ->
            em.createQuery("select b.id from com.valkyrlabs.model.MemoryAssociationRecallBinding b where b.receiptRecordId = :id", UUID.class)
                .setParameter("id", protectedId).getSingleResult())));
    rawCrudDenied(admin, "MemoryAssociationRecallBinding", bindingId);
    rawCrudDenied(admin, "RetrievalReceipt", protectedId);
    denied(owner, get("/v1/MemoryAssociationRecallBinding/" + bindingId));
    for (var child : Map.of("coverage", "RetrievalCoverage", "quality", "RetrievalQualityScore",
        "provenance", "RetrievalProvenance", "policy", "RetrievalPolicyDecision",
        "evaluator", "RetrievalEvaluatorResult").entrySet()) {
      JsonNode value = protectedReceipt.path(child.getKey());
      if (value.hasNonNull("id")) rawCrudDenied(admin, child.getValue(), UUID.fromString(value.required("id").asText()));
    }
    JsonNode item = java.util.stream.StreamSupport.stream(protectedReceipt.required("items").spliterator(), false)
        .filter(value -> detail.toString().equals(value.path("memoryId").asText())).findFirst().orElseThrow();
    UUID itemId = UUID.fromString(item.required("id").asText());
    rawCrudDenied(admin, "RetrievalReceiptItem", itemId);
    // Deliberate persistence fault after an authentic receipt commit. The next normal read must
    // detect a changed receipt body even when every original source remains authorized.
    scoped(owner, () -> tx(() -> routing.executeWrite(contexts.requireCurrentGrayMatterContext("receipt-fault"), () -> {
      assertThat(em.createQuery("update com.valkyrlabs.model.RetrievalReceiptItem i set i.text = :text where i.id = :id")
          .setParameter("text", "Injected replacement evidence").setParameter("id", itemId).executeUpdate()).isEqualTo(1);
      return null;
    })));
    denied(owner, get(RECEIPTS + "/" + protectedReceipt.required("receiptId").asText()));
    witness("receipt-body-fault", Map.of("receipt", protectedReceipt.required("receiptId"), "item", itemId));

    JsonNode missingProof = receipt(owner, query, true);
    UUID missingId = UUID.fromString(missingProof.required("id").asText());
    // Simulate a partial restore. The public opt-in marker survives while its private proof row
    // is missing. This is an internal corruption fixture, outside supported client writes.
    scoped(owner, () -> tx(() -> routing.executeWrite(contexts.requireCurrentGrayMatterContext("binding-restore-fault"), () -> {
      assertThat(em.createQuery("delete from com.valkyrlabs.model.MemoryAssociationRecallBinding b where b.receiptRecordId = :id")
          .setParameter("id", missingId).executeUpdate()).isEqualTo(1);
      return null;
    })));
    denied(owner, get(RECEIPTS + "/" + missingProof.required("receiptId").asText()));
    witness("missing-proof-fault", Map.of("receipt", missingProof.required("receiptId")));

    JsonNode fixedPool = receipt(owner, query, true);
    UUID later = createMemory(owner, "Zephyr courier loading guide requests a linen wrap.");
    permission(owner, later, owner, "MERGE", true);
    JsonNode laterEdge = response(owner, post(PATH).content(json.writeValueAsString(
        Map.of("fromId", anchor, "toId", later, "relation", "later guide"))), 201);
    response(owner, get(RECEIPTS + "/" + fixedPool.required("receiptId").asText()), 200);
    witness("outside-original-pool-boundary", Map.of("receipt", fixedPool.required("receiptId"),
        "laterSource", later, "laterAssociation", laterEdge.required("associationRef"),
        "oldReceiptStillCurrent", true));
    selectedSourceWithoutAnchorStillRequiresCurrentContent(owner);
    selectedNonAnchorReadRevocationDeniesReceiptPageAndRoute(owner, peer);
  }

  @Test
  void generatedSemanticCachesHaveNoRawIngress() throws Exception {
    UUID admin = core(() -> principals.findPrincipalByUsername("super").get(0).getId());
    for (String entity : List.of("SemanticIndexEntry", "SemanticIndexChunk")) {
      UUID unseeded = UUID.randomUUID();
      rawCrudDenied(admin, entity, unseeded);
      assertThat(handlerMappings.getHandlerMethods().keySet().stream()
          .flatMap(info -> info.getPatternValues().stream())
          .filter(path -> path.equals("/v1/" + entity) || path.startsWith("/v1/" + entity + "/")))
          .as("No generic cache route for %s; owning semantic operations are retained", entity).isEmpty();
      assertThat(request(admin, get("/v1/" + entity + "/" + unseeded)).getStatus()).isEqualTo(404);
    }
    witness("semantic-cache-ingress", Map.of("genericMappingsAbsent", true,
        "rawAdminVerbsDenied", true, "probeUUIDsUnseeded", true));
  }

  @Test
  void sourceCorrectionBetweenRealDiscoveryAndBindingRollsBackReceipt() throws Exception {
    UUID admin = core(() -> principals.findPrincipalByUsername("super").get(0).getId());
    Organization tenant = organization();
    UUID owner = member(tenant, admin);
    provision(tenant);
    UUID detail = createMemory(owner, "Cinder courier collection code is coral-one.");
    UUID anchor = createMemory(owner, "Cinder courier dispatch. Cinder courier uses the collection note.");
    permission(owner, detail, owner, "MERGE", true);
    permission(owner, anchor, owner, "MERGE", true);
    response(owner, post(PATH).content(json.writeValueAsString(
        Map.of("fromId", anchor, "toId", detail, "relation", "collection note"))), 201);
    String schema = scoped(owner, () -> contexts.requireCurrentGrayMatterContext("native-recall-race").schemaName());
    assertThat(schema).matches("org_[0-9a-f]{32}");
    String prefix = "\"" + schema + "\".";
    assertThat(jdbc.queryForObject("select count(*) from " + prefix + "memory_association_recall_binding", Long.class)).isZero();
    var selected = new java.util.concurrent.CountDownLatch(1);
    var release = new java.util.concurrent.CountDownLatch(1);
    var pause = new java.util.concurrent.atomic.AtomicBoolean(true);
    // This spy changes scheduling only: the real discovery, source locks, ACL checks and
    // returned snapshot all execute unchanged. Its REQUIRES_NEW read ends before this latch.
    org.mockito.Mockito.doAnswer(invocation -> {
      Object snapshot = invocation.callRealMethod();
      List<MemoryEntry> anchors = invocation.getArgument(1);
      if (anchors.stream().anyMatch(value -> anchor.equals(value.getId())) && pause.compareAndSet(true, false)) {
        selected.countDown();
        if (!release.await(45, java.util.concurrent.TimeUnit.SECONDS))
          throw new AssertionError("Timed out waiting for authorized source correction");
      }
      return snapshot;
    }).when(recallDiscovery).discover(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.anyList(),
        org.mockito.ArgumentMatchers.anyList(), org.mockito.ArgumentMatchers.anyList(), org.mockito.ArgumentMatchers.anyList());
    var executor = java.util.concurrent.Executors.newSingleThreadExecutor(task -> {
      Thread thread = new Thread(task, "native-association-recall-race");
      thread.setDaemon(true);
      return thread;
    });
    String key = "native-recall-race-" + UUID.randomUUID();
    var compiling = executor.submit(() -> request(owner, post(RECEIPTS).content(json.writeValueAsString(
        Map.of("query", "Cinder courier", "topK", 1, "retrievalMode", "KEYWORD", "includeText", true,
            "includeEvaluator", false, "includeAssociations", true, "idempotencyKey", key)))));
    try {
      assertThat(selected.await(45, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
      response(owner, patch(MEMORY + "/" + anchor).content(json.writeValueAsString(
          Map.of("text", "Cinder courier dispatch was corrected before the receipt committed."))), 200);
      release.countDown();
      MockHttpServletResponse rejected = compiling.get(45, java.util.concurrent.TimeUnit.SECONDS);
      assertThat(rejected.getStatus()).as(rejected.getContentAsString()).isEqualTo(409);
      assertThat(rejected.getContentAsString()).doesNotContain("coral-one");
      assertThat(jdbc.queryForObject("select count(*) from " + prefix + "memory_association_recall_binding", Long.class)).isZero();
      assertThat(jdbc.queryForObject("select count(*) from " + prefix + "retrieval_receipt where idempotency_key = ?", Long.class, key)).isZero();
      JsonNode current = response(owner, get(MEMORY + "/" + anchor), 200);
      assertThat(current.required("text").asText()).contains("corrected before the receipt committed");
      witness("correction-before-binding-race", Map.of("anchor", anchor, "detail", detail,
          "responseStatus", rejected.getStatus(), "newReceiptCount", 0, "newBindingCount", 0,
          "schedulingOnlyRealMethodSpy", true));
    } finally {
      release.countDown();
      compiling.cancel(true);
      executor.shutdownNow();
      org.mockito.Mockito.reset(recallDiscovery);
    }
  }

  private void runtimeOriginWitness() throws Exception {
    var classes = new java.util.LinkedHashMap<String, Object>();
    for (Class<?> type : List.of(MemoryAssociationRecallSource.class,
        MemoryAssociationRecallBindingRuntimeService.class,
        com.valkyrlabs.valkyrai.graymatter.retrieval.RetrievalReceiptRuntimeService.class,
        com.valkyrlabs.valkyrai.graymatter.contextpage.ContextPageRuntimeService.class,
        com.valkyrlabs.model.MemoryAssociationRecallBinding.class,
        com.valkyrlabs.model.MemoryAssociationRecallRef.class)) {
      try (var bytes = type.getResourceAsStream("/" + type.getName().replace('.', '/') + ".class")) {
        if (bytes == null) throw new AssertionError("Missing runtime class bytes: " + type.getName());
        classes.put(type.getName(), Map.of("source", type.getProtectionDomain().getCodeSource().getLocation().toString(),
            "sha256", java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(bytes.readAllBytes()))));
      }
    }
    var resources = new java.util.LinkedHashMap<String, Object>();
    for (String name : List.of("db/graymatter/graymatter-core-v3.json",
        "db/graymatter/graymatter-core-v3.mysql.sql", "db/graymatter/graymatter-core-v3.postgresql.sql",
        "valkyr/data-plane/api0-data-plane-manifest.json")) {
      var resource = getClass().getClassLoader().getResource(name);
      if (resource == null) throw new AssertionError("Missing runtime resource: " + name);
      try (var bytes = resource.openStream()) {
        resources.put(name, Map.of("source", resource.toString(), "sha256",
            java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(bytes.readAllBytes()))));
      }
    }
    witness("runtime-origins", Map.of("classes", classes, "resources", resources));
  }

  private void selectedSourceWithoutAnchorStillRequiresCurrentContent(UUID owner) throws Exception {
    UUID source = UUID.fromString(response(owner, post(MEMORY).content(json.writeValueAsString(
        Map.of("type", "context", "title", "Garnet courier",
            "text", "Courier collection reference is silver-eight."))), 201).required("id").asText());
    permission(owner, source, owner, "MERGE", true);
    JsonNode selected = receipt(owner, "Garnet courier", true);
    assertThat(memoryIds(selected)).containsExactly(source.toString());
    assertThat(selected.required("associationPolicyVersion").asText()).isEqualTo("graymatter-association-recall/v1");
    assertThat(selected.path("associationRefs").size()).isZero();
    response(owner, get(RECEIPTS + "/" + selected.required("receiptId").asText()), 200);
    response(owner, patch(MEMORY + "/" + source).content(json.writeValueAsString(
        Map.of("text", "Courier collection reference changed to copper-nine."))), 200);
    denied(owner, get(RECEIPTS + "/" + selected.required("receiptId").asText()));
    witness("selected-source-without-anchor-corrected", Map.of("source", source,
        "receipt", selected.required("receiptId"), "associationRefCount", 0,
        "originalAnswerPolicy", selected.path("answerPolicy"), "oldReceiptDenied", true));
  }

  private void selectedNonAnchorReadRevocationDeniesReceiptPageAndRoute(UUID owner, UUID peer) throws Exception {
    String query = "Marble courier";
    UUID neighbor = createMemory(owner, "Marble courier route detail requires a woven satchel.");
    UUID nonAnchor = UUID.fromString(response(peer, post(MEMORY).content(json.writeValueAsString(
        Map.of("type", "context", "title", query,
            "text", "Courier collection note requires felt wraps."))), 201).required("id").asText());
    UUID anchor = createMemory(owner, "Marble courier dispatch. Marble courier staff follow the collection note.");
    permission(owner, neighbor, owner, "MERGE", true);
    permission(owner, anchor, owner, "MERGE", true);
    permission(peer, nonAnchor, owner, "READ", true);
    permission(peer, nonAnchor, owner, "MERGE", true);
    response(owner, post(PATH).content(json.writeValueAsString(
        Map.of("fromId", anchor, "toId", neighbor, "relation", "collection detail"))), 201);
    JsonNode selected = receipt(owner, query, true, 2);
    assertThat(memoryIds(selected)).containsExactlyInAnyOrder(anchor.toString(), nonAnchor.toString(), neighbor.toString());
    assertThat(selected.required("associationRefs").size()).isEqualTo(1);
    assertThat(selected.required("associationRefs").get(0).required("anchorId").asText()).isEqualTo(anchor.toString());
    assertThat(selected.required("associationRefs").get(0).required("memoryId").asText()).isEqualTo(neighbor.toString());
    JsonNode page = response(owner, post(PAGES + "/compile").content(json.writeValueAsString(
        Map.of("taskIntent", query, "retrievalReceipt", Map.of("id", selected.required("id").asText())))), 200)
        .required("contextPage");
    response(owner, post("/v1/skillopt_ops/route").content(json.writeValueAsString(
        Map.of("taskType", "validation", "contextPage", routePageInput(page),
            "traceId", "native-nonanchor-route-" + UUID.randomUUID()))), 200);
    permission(peer, nonAnchor, owner, "READ", false);
    denied(owner, get(RECEIPTS + "/" + selected.required("receiptId").asText()));
    deniedPageConsumers(owner, page.required("pageRef").asText());
    denied(owner, post("/v1/skillopt_ops/route").content(json.writeValueAsString(
        Map.of("taskType", "validation", "contextPage", routePageInput(page),
            "traceId", "native-revoked-nonanchor-route-" + UUID.randomUUID()))));
    witness("selected-nonanchor-read-revoked", Map.of("anchor", anchor, "nonAnchor", nonAnchor,
        "neighbor", neighbor, "receipt", selected.required("receiptId"), "page", page.required("pageRef"),
        "receiptPageAndRouteDenied", true));
  }

  @Test
  void populatedOrdinaryReceiptSurvivesActualAdditiveSchemaUpgrade() throws Exception {
    UUID admin = core(() -> principals.findPrincipalByUsername("super").get(0).getId());
    Organization tenant = organization();
    UUID owner = member(tenant, admin);
    provision(tenant);
    String text = "Orchid ledger handoff preserves the bronze-four reference.";
    UUID source = createMemory(owner, text);
    permission(owner, source, owner, "MERGE", true);
    JsonNode sourceBefore = response(owner, get(MEMORY + "/" + source), 200);
    assertThat(sourceBefore.required("text").asText()).isEqualTo(text);
    JsonNode original = receipt(owner, "Orchid ledger", false);
    if (memoryIds(original).isEmpty()) {
      emptyInitialReceiptDiagnostic(tenant, source, original);
    }
    assertThat(memoryIds(original)).containsExactly(source.toString());
    JsonNode receiptBefore = response(owner, get(RECEIPTS + "/" + original.required("receiptId").asText()), 200).required("receipt");
    // Secure receipt text/preview are intentionally omitted for this ordinary actor.
    // Compare the visible content commitment to an independent hash of the fixture text.
    String expectedTextHash = java.util.HexFormat.of().formatHex(
        java.security.MessageDigest.getInstance("SHA-256")
            .digest(text.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
    JsonNode itemBefore = receiptBefore.required("items").get(0);
    assertThat(itemBefore.required("textHash").asText()).isEqualTo(expectedTextHash);
    assertThat(itemBefore.has("text")).isFalse();
    assertThat(itemBefore.has("textPreview")).isFalse();
    var registry = core(() -> users.runAsSystem(() ->
        registries.findTenantSchemaRegistryByOrganization(tenant).stream().findFirst().orElseThrow()));
    String schema = registry.getSchemaName();
    assertThat(schema).matches("org_[0-9a-f]{32}");
    String prefix = "\"" + schema + "\".";
    List<String> additions = List.of("retrieval_receipt_association_refs",
        "memory_association_recall_ref", "memory_association_recall_binding");
    // Explicit compatible-shape upgrade fixture. The source and ordinary receipt above were
    // created by the real owning HTTP path, not synthesized or imported trusted evidence.
    // Only empty new recall tables and nullable new columns are removed in this isolated org.
    for (String table : additions) {
      assertThat(jdbc.queryForObject("select count(*) from " + prefix + table, Long.class)).isZero();
      jdbc.execute("drop table " + prefix + table);
    }
    jdbc.execute("alter table " + prefix + "retrieval_receipt drop column association_policy_version");
    jdbc.execute("alter table " + prefix + "retrieval_receipt drop column association_truncated");
    assertThat(jdbc.update("update " + prefix + "graymatter_core_migration set bundle_name = ?, bundle_version = ?, checksum = ? where bundle_name = ?",
        "graymatter-core-v3@3.9.0", "3.9.0", "0".repeat(64), "graymatter-core-v3@3.10.0")).isEqualTo(1);
    for (String table : additions) {
      assertThat(jdbc.queryForObject("select count(*) from information_schema.tables where table_schema = ? and table_name = ?",
          Long.class, schema, table)).isZero();
    }
    assertThat(jdbc.queryForObject("select count(*) from " + prefix + "retrieval_receipt", Long.class)).isPositive();
    var applied = core(() -> users.runAsSystem(() -> coreSchemas.applyAndValidate(registry)));
    for (String table : additions) {
      assertThat(jdbc.queryForObject("select count(*) from information_schema.tables where table_schema = ? and table_name = ?",
          Long.class, schema, table)).isEqualTo(1L);
    }
    assertThat(jdbc.queryForObject("select checksum from " + prefix + "graymatter_core_migration where bundle_name = ?",
        String.class, "graymatter-core-v3@3.10.0")).isEqualTo(applied.checksum());
    JsonNode reloaded = response(owner, get(RECEIPTS + "/" + original.required("receiptId").asText()), 200).required("receipt");
    assertThat(reloaded.required("receiptId")).isEqualTo(original.required("receiptId"));
    assertThat(reloaded.required("retrievalStatus")).isEqualTo(original.required("retrievalStatus"));
    assertThat(memoryIds(reloaded)).containsExactly(source.toString());
    JsonNode itemAfter = reloaded.required("items").get(0);
    assertThat(itemAfter.required("id")).isEqualTo(itemBefore.required("id"));
    assertThat(itemAfter.required("textHash").asText()).isEqualTo(expectedTextHash);
    assertThat(itemAfter.has("text")).isFalse();
    assertThat(itemAfter.has("textPreview")).isFalse();
    JsonNode sourceAfter = response(owner, get(MEMORY + "/" + source), 200);
    assertThat(sourceAfter.required("id")).isEqualTo(sourceBefore.required("id"));
    assertThat(sourceAfter.required("text")).isEqualTo(sourceBefore.required("text"));
    assertThat(reloaded.path("associationPolicyVersion").isNull()
        || reloaded.path("associationPolicyVersion").isMissingNode()).isTrue();
    witness("populated-compatible-upgrade", Map.of("source", source,
        "receipt", original.required("receiptId"), "schema", schema,
        "appliedChecksum", applied.checksum(), "textHash", expectedTextHash,
        "sourceAndOrdinaryEvidenceUnchanged", true,
        "fixtureBoundary", "Real source and receipt; synthetic empty-table/nullable-column removal reproduces prior compatible physical shape. No old-process or Cloud restart claim."));
  }

  private void emptyInitialReceiptDiagnostic(Organization tenant, UUID source, JsonNode receipt) throws Exception {
    String expectedSchema = core(() -> users.runAsSystem(() ->
        registries.findTenantSchemaRegistryByOrganization(tenant).stream().findFirst().orElseThrow().getSchemaName()));
    assertThat(expectedSchema).matches("org_[0-9a-f]{32}");
    var counts = new java.util.LinkedHashMap<String, Integer>();
    for (String schema : List.of(expectedSchema, "public")) {
      counts.put(schema, jdbc.queryForObject("select count(*) from " + schema
          + ".memory_entry where id = X'" + source.toString().replace("-", "") + "'", Integer.class));
    }
    System.out.println("NATIVE_ASSOCIATION_RECALL_DIAGNOSTIC " + json.writeValueAsString(Map.of(
        "case", "empty-first-upgrade-receipt", "source", source,
        "receipt", receipt.required("receiptId"), "sourceGetStatus", 200, "qualifiedRowCounts", counts)));
  }

  private java.util.Set<String> originalEligibleIds(UUID actor, UUID receiptRecordId) throws Exception {
    // Test-only inspection of committed private state; this exposes no client route
    // and changes neither the proof nor the source/edge authority used by the runtime.
    String snapshot = scoped(actor, () -> tx(() -> routing.executeRead(
        contexts.requireCurrentGrayMatterContext("native-original-pool-inspection"), () ->
            em.createQuery("select b.snapshotJson from com.valkyrlabs.model.MemoryAssociationRecallBinding b "
                + "where b.receiptRecordId = :id", String.class)
                .setParameter("id", receiptRecordId).getSingleResult())));
    var ids = new java.util.TreeSet<String>();
    for (JsonNode source : json.readTree(snapshot).required("eligibleSources")) {
      ids.add(source.required("memoryId").asText());
    }
    return ids;
  }

  private JsonNode routePageInput(JsonNode nativePage) {
    // The existing request schema validates these ContextPage fields. Use only
    // values returned by the owning page endpoint; the route resolver reloads
    // the page and checks current evidence rather than trusting this snapshot.
    var input = json.createObjectNode();
    for (String field : List.of("id", "pageRef", "traceId", "taskIntent", "compactSummary")) {
      assertThat(nativePage.required(field).isTextual()).as(field).isTrue();
      input.set(field, nativePage.required(field));
    }
    return input;
  }

  private void routePageLocatorRoundTrip(JsonNode nativePage) throws Exception {
    UUID id = UUID.fromString(nativePage.required("id").asText());
    var full = json.treeToValue(nativePage, com.valkyrlabs.model.ContextPage.class);
    full.setCompactSummary("indigo-six synthetic nested content");
    var wrapper = new com.valkyrlabs.model.SkillOptRouteReceipt().contextPage(full);
    assertPageLocator(json.valueToTree(wrapper), id);
    var supplied = json.createObjectNode();
    supplied.set("contextPage", json.valueToTree(full));
    var parsed = json.treeToValue(supplied, com.valkyrlabs.model.SkillOptRouteReceipt.class);
    assertThat(parsed.getContextPage().getId()).isEqualTo(id);
    assertThat(parsed.getContextPage().getCompactSummary()).isNull();
    assertThat(parsed.getContextPage().getItems()).isNullOrEmpty();
    assertPageLocator(json.valueToTree(parsed), id);
  }

  private void assertPageLocator(JsonNode route, UUID pageId) {
    JsonNode locator = route.required("contextPage");
    assertThat(fieldNames(locator)).containsExactly("id");
    assertThat(locator.required("id").asText()).isEqualTo(pageId.toString());
    assertThat(locator.toString()).doesNotContain("indigo-six", "compactSummary", "items");
  }

  private void rawCrudDenied(UUID admin, String entity, UUID id) throws Exception {
    for (String method : List.of("GET", "PATCH", "DELETE", "POST")) {
      accessDenied(admin, post("/v1/json-crud").content(json.writeValueAsString(Map.of(
          "entity", entity, "method", method, "id", id,
          "payload", Map.of("id", id, "compactSummary", "Injected replacement evidence")))));
    }
    accessDenied(admin, patch("/v1/json-crud/" + entity + "/" + id)
        .content("{\"compactSummary\":\"Injected replacement evidence\"}"));
  }

  private void accessDenied(UUID actor, MockHttpServletRequestBuilder builder) throws Exception {
    MockHttpServletResponse actual = request(actor, builder);
    assertThat(actual.getStatus()).as(actual.getContentAsString()).isEqualTo(403);
    assertThat(actual.getContentAsString()).doesNotContain("indigo-six", "Injected replacement evidence", "silver-eight", "felt wraps");
  }

  private JsonNode receipt(UUID actor, String query, boolean associations) throws Exception {
    return receipt(actor, query, associations, 1);
  }

  private JsonNode receipt(UUID actor, String query, boolean associations, int topK) throws Exception {
    return response(actor, post(RECEIPTS).content(json.writeValueAsString(Map.of(
        "query", query, "topK", topK, "retrievalMode", "KEYWORD", "includeText", true,
        "includeEvaluator", false, "includeAssociations", associations,
        "idempotencyKey", "native-association-recall-" + UUID.randomUUID()))), 201).required("receipt");
  }

  private void deniedPageConsumers(UUID actor, String page) throws Exception {
    denied(actor, get(PAGES + "/" + page));
    denied(actor, post(PAGES + "/hydrate").content(json.writeValueAsString(
        Map.of("contextPageRef", page, "maxItems", 1, "maxTokens", 512))));
    denied(actor, post(PAGES + "/recompress").content(json.writeValueAsString(
        Map.of("contextPageRef", page, "targetTokenBudget", 512))));
    denied(actor, post(PAGES + "/fork").content(json.writeValueAsString(
        Map.of("contextPageRef", page, "idempotencyKey", "denied-fork-" + UUID.randomUUID()))));
  }

  private void denied(UUID actor, MockHttpServletRequestBuilder builder) throws Exception {
    MockHttpServletResponse actual = request(actor, builder);
    assertThat(actual.getStatus()).as(actual.getContentAsString()).isIn(403, 404, 409);
    assertThat(actual.getContentAsString()).doesNotContain("indigo-six", "Injected replacement evidence", "silver-eight", "felt wraps");
  }

  private java.util.Set<String> memoryIds(JsonNode receipt) {
    var ids = new java.util.HashSet<String>();
    receipt.required("items").forEach(item -> {
      if (item.hasNonNull("memoryId")) ids.add(item.required("memoryId").asText());
    });
    return ids;
  }

  private static java.util.Set<String> fieldNames(JsonNode value) {
    var names = new java.util.HashSet<String>();
    value.fieldNames().forEachRemaining(names::add);
    return names;
  }

  private UUID createMemory(UUID actor, String text) throws Exception {
    return UUID.fromString(response(actor, post(MEMORY).content(json.writeValueAsString(
        Map.of("type", "context", "text", text))), 201).required("id").asText());
  }

  private void permission(UUID owner, UUID source, UUID reader, String name, boolean grant) {
    scoped(owner, () -> tx(() -> routing.executeWrite(contexts.requireCurrentGrayMatterContext("native-source-grant"), () -> {
      UUID actualOwner = em.createQuery("select m.ownerId from com.valkyrlabs.model.MemoryEntry m where m.id = :id", UUID.class)
          .setParameter("id", source).getSingleResult();
      assertThat(actualOwner).isEqualTo(owner);
      var identity = new ObjectIdentityImpl(MemoryEntry.class, source);
      var permission = com.valkyrlabs.thorapi.config.impl.ValkyrACL.mapStringToPermission(name);
      if (grant) acl.grantPermission(identity, reader.toString(), permission);
      else assertThat(acl.revokePermission(identity, reader.toString(), permission)).isPositive();
      return null;
    })));
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
