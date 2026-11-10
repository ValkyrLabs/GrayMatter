package com.valkyrlabs.graymatter.localserver.association;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.valkyrlabs.graymatter.localserver.model.PrincipalRecord;
import com.valkyrlabs.graymatter.localserver.repository.PrincipalRecordRepository;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;

/** Real generated persistence, real Basic authentication, and the owning HTTP receipt lifecycle. */
@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:h2:mem:association-recall;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
    "spring.jpa.hibernate.ddl-auto=create-drop", "graymatter.starter-knowledge-pack.enabled=false"
})
@AutoConfigureMockMvc
class AssociationRecallTest {
    static final String CONTEXT = "/v1/graymatter/retrieval-context";
    static final String EDGES = "/v1/graymatter/memory/associations";
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired JdbcTemplate jdbc;
    @Autowired PrincipalRecordRepository principals;
    @Autowired PasswordEncoder passwords;
    String scope;

    @BeforeEach void prepare() {
        scope = UUID.randomUUID().toString();
        for (String user : List.of("recall", "other")) if (principals.findByUsernameIgnoreCase(user).isEmpty())
            principals.save(new PrincipalRecord(user, passwords.encode("test-password"), user, "ROLE_USER"));
    }

    @Test void optInAddsOnlyIndependentBodyEvidenceAndKeepsTheOriginalRankScore() throws Exception {
        var anchor = memory("Aster courier manifest.");
        var neighbor = memory("Courier pickup code is P7.");
        var edge = link(anchor, neighbor, "supersedes");
        var ordinary = compile(false);
        var expanded = compile(true);
        assertThat(ids(ordinary)).containsExactly(id(anchor));
        assertThat(ids(expanded)).containsExactly(id(anchor), id(neighbor));
        assertThat(expanded.path("items").get(0).path("score")).isEqualTo(ordinary.path("items").get(0).path("score"));
        assertThat(expanded.path("retrievalStatus").asText()).isEqualTo("OK");
        assertThat(expanded.path("context").asText()).doesNotContain("supersedes");
        assertThat(expanded.path("associationPolicyVersion").asText()).isEqualTo("graymatter-association-recall/v1");
        assertThat(ordinary.path("associationPolicyVersion").isMissingNode()).isTrue();
        assertThat(expanded.path("associationTruncated").asBoolean()).isFalse();
        var proof = expanded.path("associationRefs").get(0);
        assertThat(proof.size()).isEqualTo(6);
        assertThat(proof.path("associationRef").asText()).isEqualTo(edge.path("associationRef").asText());
        assertThat(proof.path("anchorId").asText()).isEqualTo(id(anchor));
        assertThat(proof.path("memoryId").asText()).isEqualTo(id(neighbor));
        for (String hash : List.of("associationHash", "anchorSourceHash", "sourceHash"))
            assertThat(proof.path(hash).asText()).matches("[0-9a-f]{64}");
        assertThat(read(expanded).path("associationRefs")).isEqualTo(expanded.path("associationRefs"));
        assertThat(hydrate(expanded, neighbor).getStatus()).isEqualTo(200);
        var child = result(post(CONTEXT + "/" + receipt(expanded) + "/recompress", Map.of("query", "Aster courier", "tokenBudget", 1024)), 200);
        assertThat(child.path("associationRefs")).isEqualTo(expanded.path("associationRefs"));
        assertThat(child.path("retrievalStatus").asText()).isEqualTo("OK");
    }

    @Test void noRelationLabelMetadataMatchReverseOrRecursiveTraversalCanQualifyText() throws Exception {
        var anchor = memory("Aster courier manifest.");
        var neighbor = memory("Courier pickup code is P7.");
        var nextHop = memory("Courier van number is V8.");
        var unrelated = memory("Orchard watering ends at noon.");
        var metadata = memory("recall", "Purple folder has the receipt.", scope, List.of("courier"));
        var reverse = memory("Courier return number is R9.");
        link(anchor, neighbor, "ordinary-link"); link(neighbor, nextHop, "second-hop");
        link(anchor, unrelated, "Aster courier"); link(anchor, metadata, "tag-only"); link(reverse, anchor, "reverse");
        assertThat(ids(compile(true))).containsExactly(id(anchor), id(neighbor));
    }

    @Test void weakSeedDoesNotInitiateTraversalAndEmptyOptInStillHasItsPolicyMarker() throws Exception {
        var anchor = memory("Aster manifest.");
        var neighbor = memory("Courier pickup code is P7.");
        link(anchor, neighbor, "ordinary");
        var receipt = compile(true);
        assertThat(ids(receipt)).hasSize(1);
        assertThat(receipt.path("associationRefs")).isEmpty();
        assertThat(receipt.path("associationPolicyVersion").asText()).isEqualTo("graymatter-association-recall/v1");
        assertThat(read(receipt).path("retrievalStatus").asText()).isEqualTo("OK");
    }

    @Test void originalSourceTagsAndOwnerFiltersApplyToTheNeighbor() throws Exception {
        var anchor = memory("recall", "Aster courier manifest.", scope, List.of("selected"));
        var good = memory("recall", "Courier pickup code is P7.", scope, List.of("selected"));
        var wrongTags = memory("Courier pickup tag is W8.");
        var wrongSource = memory("recall", "Courier pickup source is S9.", "elsewhere", List.of("selected"));
        var foreign = memory("other", "Courier private code is SECRET.", scope, List.of("selected"));
        link(anchor, good, "ordinary"); link(anchor, wrongTags, "wrong-tags"); link(anchor, wrongSource, "wrong-source");
        assertThat(post(EDGES, tuple(anchor, foreign, "foreign")).getStatus()).isEqualTo(404);
        var request = request(true); request.put("tags", List.of("selected"));
        var expanded = result(post(CONTEXT, request), 200);
        assertThat(ids(expanded)).containsExactly(id(anchor), id(good));
        assertThat(expanded.toString()).doesNotContain("SECRET");
        assertThat(getAs("other", "/v1/graymatter-retrieval-receipts/" + receipt(expanded)).getStatus()).isEqualTo(404);
    }

    @Test void correctingAnchorInvalidatesAllGraphAuthorityWithoutDeletingTheIdentityLink() throws Exception {
        var anchor = memory("Aster courier manifest."); var neighbor = memory("Courier pickup code is P7.");
        var edge = link(anchor, neighbor, "ordinary"); var original = compile(true);
        result(post("/v1/graymatter/memory/" + id(anchor) + "/revise",
            Map.of("expectedSourceHash", anchor.path("sourceHash").asText(), "text", "Aster courier updated manifest.")), 200);
        assertStale(original, neighbor);
        assertThat(getAs("recall", EDGES + "/" + edge.path("associationRef").asText()).getStatus()).isEqualTo(200);
        var fresh = result(post(CONTEXT + "/" + receipt(original) + "/refresh", request(true)), 200);
        assertThat(fresh.path("retrievalStatus").asText()).isEqualTo("OK");
        assertThat(fresh.path("associationRefs").get(0).path("associationRef")).isEqualTo(edge.path("associationRef"));
        assertThat(fresh.path("associationRefs").get(0).path("anchorSourceHash"))
            .isNotEqualTo(original.path("associationRefs").get(0).path("anchorSourceHash"));
    }

    @Test void forgettingAnchorCascadesTheEdgeAndNeverLeavesHydratableNeighborProof() throws Exception {
        var anchor = memory("Aster courier manifest."); var neighbor = memory("Courier pickup code is P7.");
        var edge = link(anchor, neighbor, "ordinary"); var original = compile(true);
        assertThat(post("/v1/graymatter/memory/" + id(anchor) + "/forget",
            Map.of("expectedSourceHash", anchor.path("sourceHash").asText(), "confirmed", true)).getStatus()).isEqualTo(204);
        assertThat(jdbc.queryForObject("select count(*) from memory_association where id=?", Integer.class,
            UUID.fromString(edge.path("associationRef").asText()))).isZero();
        assertStale(original, neighbor);
    }

    @Test void edgeRevocationInvalidatesGraphReceiptButLeavesOrdinaryReceiptUsable() throws Exception {
        var anchor = memory("Aster courier manifest."); var neighbor = memory("Courier pickup code is P7.");
        var edge = link(anchor, neighbor, "ordinary"); var graph = compile(true); var ordinary = compile(false);
        // A storage fixture models an administrative edge revocation, not an exposed caller CRUD route.
        jdbc.update("delete from memory_association where id=?", UUID.fromString(edge.path("associationRef").asText()));
        assertStale(graph, neighbor);
        assertThat(read(ordinary).path("retrievalStatus").asText()).isEqualTo("OK");
        assertThat(hydrate(ordinary, anchor).getStatus()).isEqualTo(200);
    }

    @Test void edgeOwnerTamperingCannotPreserveOrDiscloseItsOldGraphProof() throws Exception {
        var anchor = memory("Aster courier manifest."); var neighbor = memory("Courier pickup code is P7.");
        var edge = link(anchor, neighbor, "ordinary"); var graph = compile(true);
        jdbc.update("update memory_association set owner_id=? where id=?", principals.findByUsernameIgnoreCase("other").orElseThrow().getId(),
            UUID.fromString(edge.path("associationRef").asText()));
        assertStale(graph, neighbor);
        assertThat(compile(true).path("associationRefs")).isEmpty();
    }

    @Test void newOutgoingEdgeInvalidatesAnEmptyOptInSnapshotOnly() throws Exception {
        var anchor = memory("Aster courier manifest."); var neighbor = memory("Courier pickup code is P7.");
        var empty = compile(true); var ordinary = compile(false);
        link(anchor, neighbor, "new-link");
        assertThat(read(empty).path("retrievalStatus").asText()).isEqualTo("STALE_CONTEXT");
        assertThat(hydrate(empty, anchor).getStatus()).isEqualTo(409);
        assertThat(read(ordinary).path("retrievalStatus").asText()).isEqualTo("OK");
    }

    @Test void recompressCannotDropGraphDependenciesOrChangeDiscoverySettings() throws Exception {
        var anchor = memory("Aster courier manifest."); var neighbor = memory("Courier pickup code is P7.");
        link(anchor, neighbor, "ordinary"); var graph = compile(true);
        String base = CONTEXT + "/" + receipt(graph);
        for (JsonNode dependency : List.of(anchor, neighbor))
            assertThat(post(base + "/recompress", Map.of("query", "Aster courier", "evictedRefs", List.of(id(dependency)))).getStatus()).isEqualTo(400);
        assertThat(post(base + "/recompress", Map.of("query", "Aster courier", "includeAssociations", false)).getStatus()).isEqualTo(400);
        assertThat(post(base + "/refresh", request(false)).getStatus()).isEqualTo(409);
        assertThat(result(post(base + "/refresh", request(true)), 200).path("retrievalStatus").asText()).isEqualTo("OK");
    }

    @Test void ninthEligibleNeighborIsPartialRatherThanSilentlyComplete() throws Exception {
        var anchor = memory("Aster courier manifest.");
        for (int i = 0; i < 9; i++) link(anchor, memory("Courier pickup detail number " + i + "."), "neighbor");
        var graph = compile(true);
        assertThat(graph.path("associationRefs")).hasSize(8);
        assertThat(graph.path("sourceCount").asInt()).isEqualTo(9);
        assertThat(graph.path("associationTruncated").asBoolean()).isTrue();
        assertThat(graph.path("retrievalStatus").asText()).isEqualTo("PARTIAL_COVERAGE");
        assertThat(graph.path("items")).isEmpty();
    }

    @Test void edgeCapUsesOneExtraDatabaseRowAndDoesNotMislabelExactlyTheCap() throws Exception {
        var anchor = memory("Aster courier manifest."); var neighbor = memory("Courier pickup code is P7.");
        for (int i = 0; i < 64; i++) link(anchor, neighbor, "label-" + i);
        var exact = compile(true);
        assertThat(exact.path("associationTruncated").asBoolean()).isFalse();
        assertThat(exact.path("retrievalStatus").asText()).isEqualTo("OK");
        link(anchor, neighbor, "label-sentinel");
        var overflow = compile(true);
        assertThat(overflow.path("associationTruncated").asBoolean()).isTrue();
        assertThat(overflow.path("retrievalStatus").asText()).isEqualTo("PARTIAL_COVERAGE");
        assertThat(read(exact).path("retrievalStatus").asText()).isEqualTo("STALE_CONTEXT");
        jdbc.update("update memory_entry set principal_id=? where id=?", principals.findByUsernameIgnoreCase("other").orElseThrow().getId(), UUID.fromString(id(neighbor)));
        var denied = compile(true);
        assertThat(denied.path("associationTruncated").asBoolean()).isFalse();
        assertThat(denied.path("retrievalStatus").asText()).isEqualTo("OK");
    }

    @Test void selectedNeighborStillUsesTheOriginalBudgetAndConflictPolicy() throws Exception {
        var anchor = memory("Aster courier manifest."); var neighbor = memory("Courier pickup notes " + "long explanation ".repeat(100));
        link(anchor, neighbor, "ordinary");
        var request = request(true); request.put("tokenBudget", 128);
        var partial = result(post(CONTEXT, request), 200);
        assertThat(partial.path("retrievalStatus").asText()).isEqualTo("PARTIAL_COVERAGE");
        assertThat(partial.path("associationTruncated").asBoolean()).isFalse();
        assertThat(partial.path("context").isNull()).isTrue();
        var disputed = memory("recall", "Courier pickup code is disputed.", scope, List.of("conflict"));
        link(anchor, disputed, "ordinary");
        assertThat(compile(true).path("retrievalStatus").asText()).isEqualTo("CONFLICTING_CONTEXT");
    }

    private void assertStale(JsonNode graph, JsonNode survivingNeighbor) throws Exception {
        var current = read(graph);
        assertThat(current.path("retrievalStatus").asText()).isEqualTo("STALE_CONTEXT");
        assertThat(current.path("associationRefs")).isEmpty();
        assertThat(hydrate(graph, survivingNeighbor).getStatus()).isEqualTo(409);
        var child = result(post(CONTEXT + "/" + receipt(graph) + "/recompress", Map.of("query", "Aster courier")), 200);
        assertThat(child.path("retrievalStatus").asText()).isEqualTo("STALE_CONTEXT");
        assertThat(child.path("associationRefs")).isEmpty();
        assertThat(child.path("items")).isEmpty();
    }
    private JsonNode compile(boolean include) throws Exception { return result(post(CONTEXT, request(include)), 200); }
    private Map<String,Object> request(boolean include) {
        var request = new HashMap<String,Object>();
        request.put("query", "Aster courier"); request.put("topK", 1); request.put("tokenBudget", 1024);
        request.put("source", scope); request.put("retrievalMode", "KEYWORD"); request.put("includeAssociations", include);
        return request;
    }
    private JsonNode memory(String text) throws Exception { return memory("recall", text, scope, List.of()); }
    private JsonNode memory(String user, String text, String source, List<String> tags) throws Exception {
        return result(postAs(user, "/v1/MemoryEntry/write", Map.of("text", text, "type", "context", "sourceChannel", source, "tags", tags)), 200);
    }
    private JsonNode link(JsonNode from, JsonNode to, String relation) throws Exception { return result(post(EDGES, tuple(from,to,relation)), 201); }
    private Map<String,String> tuple(JsonNode from, JsonNode to, String relation) { return Map.of("fromId",id(from),"toId",id(to),"relation",relation); }
    private String id(JsonNode memory) { return memory.path("id").asText(); }
    private String receipt(JsonNode context) { return context.path("receiptId").asText(); }
    private List<String> ids(JsonNode context) { var ids = new ArrayList<String>(); context.path("items").forEach(item -> ids.add(item.path("memoryId").asText())); return ids; }
    private JsonNode read(JsonNode context) throws Exception { return result(getAs("recall", "/v1/graymatter-retrieval-receipts/" + receipt(context)), 200); }
    private MockHttpServletResponse hydrate(JsonNode context, JsonNode memory) throws Exception { return getAs("recall", CONTEXT + "/" + receipt(context) + "/hydrate/" + id(memory)); }
    private MockHttpServletResponse getAs(String user, String path) throws Exception { return mvc.perform(get(path).with(httpBasic(user,"test-password"))).andReturn().getResponse(); }
    private MockHttpServletResponse post(String path, Object body) throws Exception { return postAs("recall",path,body); }
    private MockHttpServletResponse postAs(String user, String path, Object body) throws Exception {
        return mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post(path).with(httpBasic(user,"test-password"))
            .contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsBytes(body))).andReturn().getResponse();
    }
    private JsonNode result(MockHttpServletResponse response, int expected) throws Exception {
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(expected);
        return mapper.readTree(response.getContentAsByteArray());
    }
}
