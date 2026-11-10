package com.valkyrlabs.graymatter.localserver.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.valkyrlabs.graymatter.localserver.model.PrincipalRecord;
import com.valkyrlabs.graymatter.localserver.repository.PrincipalRecordRepository;
import com.valkyrlabs.graymatter.localserver.service.BifrostLiteCompressor;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anySet;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:h2:mem:receipt-cohort;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
    "spring.jpa.hibernate.ddl-auto=create-drop", "graymatter.starter-knowledge-pack.enabled=false"
})
@AutoConfigureMockMvc
class ReceiptCandidateFreshnessTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired JdbcTemplate jdbc;
    @MockitoSpyBean BifrostLiteCompressor compressor;
    @Autowired PrincipalRecordRepository principals;
    @Autowired PasswordEncoder passwords;
    private final String source = "Calendar-" + UUID.randomUUID();
    private final String reader = "cohort-reader";

    @BeforeEach
    void ensureReader() {
        if (principals.findByUsernameIgnoreCase(reader).isEmpty()) {
            principals.save(new PrincipalRecord(reader, passwords.encode("reader-password"), "Reader", "ROLE_USER"));
        }
    }

    @Test
    void newEligibleDisputeInvalidatesStatusHydrationAndFixedSourceDescendants() throws Exception {
        JsonNode initial = write("admin", source, "context", "Canary window is Wednesday.", "topic");
        JsonNode prior = compile();
        assertThat(prior.path("retrievalStatus").asText()).isEqualTo("OK");
        JsonNode fixed = fork(prior);
        write("admin", source, "context", "Canary window is Thursday.", "topic", "unresolved");
        assertThat(inspect(prior).path("recordedRetrievalStatus").asText()).isEqualTo("OK");
        for (JsonNode receipt : List.of(prior, fixed)) {
            JsonNode state = inspect(receipt);
            assertThat(state.path("retrievalStatus").asText()).isEqualTo("STALE_CONTEXT");
            assertThat(state.path("staleRefs").size()).isZero(); // No disclosed pointer changed.
            mvc.perform(get("/v1/graymatter/retrieval-context/{id}/hydrate/{memory}",
                receipt.path("receiptId").asText(), initial.path("id").asText()).with(httpBasic("admin", "graymatter-light")))
                .andExpect(status().isConflict());
            JsonNode staleChild = fork(receipt);
            assertThat(staleChild.path("retrievalStatus").asText()).isEqualTo("STALE_CONTEXT");
            assertThat(staleChild.path("items").size()).isZero();
            assertThat(staleChild.path("context").isNull() || staleChild.path("context").isMissingNode()).isTrue();
        }
        assertThat(compile().path("retrievalStatus").asText()).isEqualTo("CONFLICTING_CONTEXT");
    }

    @Test
    void concurrentInsertCannotAttachANewerFingerprintToOlderSearchResults() throws Exception {
        write("admin", source, "context", "Canary window is Wednesday.", "topic");
        CountDownLatch ranked = new CountDownLatch(1);
        CountDownLatch committed = new CountDownLatch(1);
        doAnswer(call -> {
            ranked.countDown();
            if (!committed.await(15, TimeUnit.SECONDS)) throw new AssertionError("Second write did not finish");
            return call.callRealMethod();
        }).when(compressor).compress(anyList(), eq("Canary window"), anyInt(), anySet());
        var pool = Executors.newSingleThreadExecutor();
        try {
            var first = pool.submit(this::compile);
            assertThat(ranked.await(15, TimeUnit.SECONDS)).isTrue();
            write("admin", source, "context", "Canary window is Thursday.", "topic", "unresolved");
            committed.countDown();
            JsonNode original = first.get(15, TimeUnit.SECONDS);
            assertThat(original.path("retrievalStatus").asText()).isEqualTo("OK");
            assertThat(inspect(original).path("retrievalStatus").asText()).isEqualTo("STALE_CONTEXT");
            assertThat(compile().path("retrievalStatus").asText()).isEqualTo("CONFLICTING_CONTEXT");
        } finally {
            committed.countDown();
            pool.shutdownNow();
        }
    }

    @Test
    void outsideScopeAndOtherPrincipalsDoNotInvalidateAnAuthorizedReceipt() throws Exception {
        write("admin", source, "context", "Canary window is Wednesday.", "topic");
        JsonNode prior = compile();
        write(reader, source, "context", "Canary window is Thursday.", "topic", "unresolved");
        write("admin", "another-" + source, "context", "Canary window is Thursday.", "topic", "unresolved");
        write("admin", source, "decision", "Canary window is Thursday.", "topic", "unresolved");
        write("admin", source, "context", "Canary window is Thursday.", "other", "unresolved");
        assertThat(inspect(prior).path("retrievalStatus").asText()).isEqualTo("OK");
        assertThat(fork(prior).path("answerPolicy").asText()).isEqualTo("ALLOW_ANSWER");
    }

    @Test
    void revisionAndMembershipChangesAreDetectedWhenSelectedPointersAndCandidateCountsStayTheSame() throws Exception {
        write("admin", source, "context", "Canary window is Wednesday.", "topic");
        JsonNode offQuery = write("admin", source, "context", "Billing totals", "topic");
        JsonNode outside = write("admin", source, "context", "Audit totals", "other");
        JsonNode prior = compile();
        assertThat(prior.path("sourceCount").asInt()).isEqualTo(1);
        JsonNode changed = revise(offQuery, Map.of("text", "Billing totals updated"));
        assertThat(inspect(prior).path("retrievalStatus").asText()).isEqualTo("STALE_CONTEXT");
        JsonNode restored = revise(changed, Map.of("text", "Billing totals"));
        assertThat(inspect(prior).path("retrievalStatus").asText()).isEqualTo("STALE_CONTEXT");
        JsonNode beforeMembershipSwap = compile();
        revise(restored, Map.of("tags", List.of("other")));
        revise(outside, Map.of("tags", List.of("topic")));
        assertThat(inspect(beforeMembershipSwap).path("retrievalStatus").asText()).isEqualTo("STALE_CONTEXT");
        assertThat(compile().path("retrievalStatus").asText()).isEqualTo("OK");
    }

    @ParameterizedTest
    @CsvSource({",", "malformed,valid", "*|*|*,partial"})
    void positiveReceiptWithoutValidCandidateProofCannotSupplyNewContext(String selectors, String fingerprint) throws Exception {
        JsonNode entry = write("admin", source, "context", "Canary window is Wednesday.", "topic");
        JsonNode prior = compile();
        String id = prior.path("receiptId").asText();
        jdbc.update("update memory_retrieval_receipt set candidate_state_hash = ?, candidate_selectors = ? where id = ?",
            "valid".equals(fingerprint) ? "a".repeat(64) : fingerprint, selectors, UUID.fromString(id));
        JsonNode state = inspect(prior);
        assertThat(state.path("recordedRetrievalStatus").asText()).isEqualTo("OK");
        assertThat(state.path("retrievalStatus").asText()).isEqualTo("RETRY_REQUIRED");
        mvc.perform(get("/v1/graymatter/retrieval-context/{id}/hydrate/{memory}", id, entry.path("id").asText())
            .with(httpBasic("admin", "graymatter-light"))).andExpect(status().isConflict());
        mvc.perform(post("/v1/graymatter/retrieval-context/{id}/fork", id).with(httpBasic("admin", "graymatter-light"))
            .contentType(MediaType.APPLICATION_JSON).content("{\"query\":\"Canary window\"}")).andExpect(status().isConflict());
    }

    private JsonNode revise(JsonNode entry, Map<String, Object> changes) throws Exception {
        var body = new java.util.HashMap<>(changes);
        body.put("expectedSourceHash", entry.path("sourceHash").asText());
        return postAs("admin", "/v1/graymatter/memory/" + entry.path("id").asText() + "/revise", body);
    }

    private JsonNode write(String owner, String channel, String type, String text, String... tags) throws Exception {
        return postAs(owner, "/v1/MemoryEntry/write", Map.of("sourceChannel", channel, "type", type,
            "text", text, "tags", List.of(tags)));
    }

    private JsonNode compile() throws Exception {
        return postAs("admin", "/v1/graymatter/retrieval-context", Map.of("query", "Canary window", "topK", 1,
            "retrievalMode", "KEYWORD", "filters", Map.of("source", source.toUpperCase(java.util.Locale.ROOT),
            "type", "CONTEXT", "tags", List.of("TOPIC"))));
    }

    private JsonNode inspect(JsonNode receipt) throws Exception {
        return mapper.readTree(mvc.perform(get("/v1/graymatter-retrieval-receipts/{id}", receipt.path("receiptId").asText())
            .with(httpBasic("admin", "graymatter-light"))).andExpect(status().isOk())
            .andReturn().getResponse().getContentAsByteArray());
    }

    private JsonNode fork(JsonNode receipt) throws Exception {
        return postAs("admin", "/v1/graymatter/retrieval-context/" + receipt.path("receiptId").asText() + "/fork",
            Map.of("query", "Canary window"));
    }

    private JsonNode postAs(String owner, String path, Object body) throws Exception {
        return mapper.readTree(mvc.perform(post(path).with(httpBasic(owner, owner.equals("admin") ? "graymatter-light" : "reader-password"))
            .contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsBytes(body))).andExpect(status().isOk())
            .andReturn().getResponse().getContentAsByteArray());
    }
}
