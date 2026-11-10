package com.valkyrlabs.graymatter.localserver.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doReturn;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.valkyrlabs.graymatter.localserver.model.PrincipalRecord;
import com.valkyrlabs.graymatter.localserver.repository.MemoryEntryRepository;
import com.valkyrlabs.graymatter.localserver.repository.MemorySearchIndexRepository;
import com.valkyrlabs.graymatter.localserver.repository.PrincipalRecordRepository;
import com.valkyrlabs.graymatter.localserver.service.MemoryHybridSearchService;
import com.valkyrlabs.graymatter.localserver.service.LocalMemoryEmbeddingService;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:h2:mem:memory-mutation-test;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
    "spring.jpa.hibernate.ddl-auto=create-drop", "graymatter.starter-knowledge-pack.enabled=false"
})
@AutoConfigureMockMvc
class MemoryMutationControllerTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired PrincipalRecordRepository principals;
    @Autowired PasswordEncoder passwords;
    @MockitoSpyBean MemoryEntryRepository memories;
    @MockitoSpyBean LocalMemoryEmbeddingService embeddings;
    @Autowired MemorySearchIndexRepository indexes;
    @Autowired MemoryHybridSearchService search;

    @BeforeEach
    void ensureReader() {
        if (principals.findByUsernameIgnoreCase("reader").isEmpty()) {
            principals.save(new PrincipalRecord("reader", passwords.encode("reader-password"), "Reader", "ROLE_USER"));
        }
    }

    @Test
    void originalReceiptsStayStaleAfterContentIsRestoredAndForgettingRemovesTheProjection() throws Exception {
        String channel = UUID.randomUUID().toString();
        JsonNode original = ok("/v1/MemoryEntry/write", Map.of("text", "violet", "sourceChannel", channel, "tags", List.of("a")));
        String id = original.get("id").asText();
        UUID uuid = UUID.fromString(id);
        String initial = original.get("sourceHash").asText();
        String path = "/v1/graymatter/memory/" + id;
        String snapshot = mvc.perform(get(path).with(httpBasic("admin", "graymatter-light")))
            .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertThat(mapper.readTree(snapshot).get("sourceHash")).isEqualTo(original.get("sourceHash"));
        mvc.perform(get(path).with(httpBasic("reader", "reader-password"))).andExpect(status().isNotFound());
        Map<String, Object> query = Map.of("query", "violet", "retrievalMode", "KEYWORD", "source", channel);
        assertThat(ok("/v1/MemoryEntry/query", query).path("results").get(0).path("sourceHash").asText()).isEqualTo(initial);
        String receipt = ok("/v1/graymatter/retrieval-context", query).path("receiptId").asText();
        var staleSnapshot = memories.findById(uuid).orElseThrow();
        JsonNode same = ok(path + "/revise", Map.of("expectedSourceHash", initial, "text", "violet"));
        assertThat(same.get("sourceHash")).isEqualTo(original.get("sourceHash"));
        assertThat(same.get("lastModifiedDate")).isEqualTo(original.get("lastModifiedDate"));
        JsonNode revised = ok(path + "/revise", Map.of("expectedSourceHash", initial, "text", "amber", "tags", List.of()));
        String changed = revised.path("sourceHash").asText();
        assertThat(changed).isNotEqualTo(initial);
        assertThat(revised.path("tags").asText()).isEmpty();
        assertThat(revised.path("id").asText()).isEqualTo(id);
        assertThat(revised.path("sourceChannel").asText()).isEqualTo(channel);
        assertThat(ok("/v1/MemoryEntry/query", query).path("results")).isEmpty();
        assertThat(mutate(path + "/forget", Map.of("expectedSourceHash", initial, "confirmed", true)).getStatus()).isEqualTo(412);
        String restored = ok(path + "/revise", Map.of("expectedSourceHash", changed, "text", "violet", "tags", List.of("a")))
            .path("sourceHash").asText();
        assertThat(restored).isNotIn(initial, changed);
        assertThat(mutate(path + "/revise", Map.of("expectedSourceHash", initial, "text", "wrong")).getStatus()).isEqualTo(412);
        search.indexFeatureHash(staleSnapshot);
        assertThat(indexes.findById(uuid).orElseThrow().getSourceHash()).isEqualTo(restored);
        mvc.perform(get("/v1/graymatter/retrieval-context/{receipt}/hydrate/{id}", receipt, id)
            .with(httpBasic("admin", "graymatter-light"))).andExpect(status().isConflict());
        assertThat(ok("/v1/graymatter/retrieval-context/" + receipt + "/fork", Map.of("query", "violet"))
            .path("retrievalStatus").asText()).isEqualTo("STALE_CONTEXT");
        String lastReceipt = ok("/v1/graymatter/retrieval-context", query).path("receiptId").asText();
        Map<String, Object> confirmed = Map.of("expectedSourceHash", restored, "confirmed", true);
        assertThat(mutate(path + "/forget", confirmed).getStatus()).isEqualTo(204);
        assertThat(mutate(path + "/forget", confirmed).getStatus()).isEqualTo(404);
        search.indexFeatureHash(staleSnapshot);
        assertThat(indexes.findById(uuid)).isEmpty();
        assertThat(ok("/v1/MemoryEntry/query", query).path("results")).isEmpty();
        var audit = mvc.perform(get("/v1/graymatter-retrieval-receipts/{receipt}", lastReceipt)
            .with(httpBasic("admin", "graymatter-light"))).andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();
        assertThat(mapper.readTree(audit).path("staleRefs").get(0).asText()).isEqualTo(id);
    }

    @Test
    void rejectsUnconfirmedUnscopedAndMalformedMutations() throws Exception {
        var source = ok("/v1/MemoryEntry/write", Map.of("text", "request validation"));
        String id = source.path("id").asText();
        String hash = source.path("sourceHash").asText();
        String path = "/v1/graymatter/memory/" + id;
        for (var bad : List.of(Map.of("text", "new"), Map.of("expectedSourceHash", hash), Map.of("expectedSourceHash", "invalid", "text", "new"),
                Map.of("expectedSourceHash", hash, "text", "  "), Map.of("expectedSourceHash", hash, "text", "x".repeat(16001)),
                Map.of("expectedSourceHash", hash, "tags", "one"), Map.of("expectedSourceHash", hash, "tags", List.of("a,b")),
                Map.of("expectedSourceHash", hash, "ownerId", UUID.randomUUID(), "text", "new"))) {
            assertThat(mutate(path + "/revise", bad).getStatus()).isEqualTo(400);
        }
        String duplicate = "{\"expectedSourceHash\":\"" + hash + "\",\"expectedSourceHash\":\"" + hash + "\",\"text\":\"new\"}";
        assertThat(postRaw(path + "/revise", duplicate, "admin", "graymatter-light").getStatus()).isEqualTo(400);
        String valid = mapper.writeValueAsString(Map.of("expectedSourceHash", hash, "text", "new"));
        assertThat(postRaw(path + "/revise", valid + "{}", "admin", "graymatter-light").getStatus()).isEqualTo(400);
        assertThat(postRaw(path + "/revise", valid, "reader", "reader-password").getStatus()).isEqualTo(404);
        assertThat(postRaw("/v1/graymatter/memory/" + UUID.randomUUID() + "/revise", valid, "reader", "reader-password")
            .getStatus()).isEqualTo(404);
        for (var bad : List.of(Map.of("expectedSourceHash", hash), Map.of("expectedSourceHash", hash, "confirmed", false),
            Map.of("expectedSourceHash", hash, "confirmed", "true"))) {
            assertThat(mutate(path + "/forget", bad).getStatus()).isEqualTo(400);
        }
        String confirmed = mapper.writeValueAsString(Map.of("expectedSourceHash", hash, "confirmed", true));
        assertThat(postRaw(path + "/forget", confirmed, "reader", "reader-password").getStatus()).isEqualTo(404);
        mvc.perform(post(path + "/forget").contentType(MediaType.APPLICATION_JSON).content(confirmed)).andExpect(status().isUnauthorized());
        assertThat(memories.findById(UUID.fromString(id)).orElseThrow().getText()).isEqualTo("request validation");
    }

    @Test
    void twoRequestsBasedOnTheSameHashCanOnlyCommitOneCorrection() throws Exception {
        JsonNode source = ok("/v1/MemoryEntry/write", Map.of("text", "original"));
        String path = "/v1/graymatter/memory/" + source.path("id").asText() + "/revise";
        String hash = source.path("sourceHash").asText();
        var ready = new CountDownLatch(2);
        var start = new CountDownLatch(1);
        var pool = Executors.newFixedThreadPool(2);
        try {
            var calls = List.of("candidate A", "candidate B").stream().map(text -> pool.submit(() -> {
                ready.countDown();
                if (!start.await(10, TimeUnit.SECONDS)) throw new AssertionError("start timeout");
                return mutate(path, Map.of("text", text, "expectedSourceHash", hash)).getStatus();
            })).toList();
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            assertThat(List.of(calls.get(0).get(12, TimeUnit.SECONDS), calls.get(1).get(12, TimeUnit.SECONDS)))
                .containsExactlyInAnyOrder(200, 412);
        } finally {
            start.countDown();
            pool.shutdownNow();
        }
    }

    @Test
    void rebuildDoesNotRemoveAnIndexCreatedAfterItsSourceSnapshot() throws Exception {
        UUID orphan = UUID.fromString(ok("/v1/MemoryEntry/write", Map.of("text", "legacy dangling projection")).path("id").asText());
        String readerJson = mapper.writeValueAsString(Map.of("text", "other owner dangling projection"));
        UUID otherOrphan = UUID.fromString(mapper.readTree(postRaw("/v1/MemoryEntry/write", readerJson, "reader", "reader-password")
            .getContentAsByteArray()).path("id").asText());
        memories.deleteById(orphan);
        memories.deleteById(otherOrphan);
        var snapshot = memories.findByPrincipalUsernameIgnoreCaseOrderByCreatedAtAsc("admin");
        var scanned = new CountDownLatch(1);
        var resume = new CountDownLatch(1);
        doAnswer(call -> {
            scanned.countDown();
            if (!resume.await(12, TimeUnit.SECONDS)) throw new AssertionError("source scan did not resume");
            return snapshot;
        }).when(memories).findByPrincipalUsernameIgnoreCaseOrderByCreatedAtAsc("admin");
        var pool = Executors.newSingleThreadExecutor();
        try {
            var rebuild = pool.submit(() -> search.reindex("admin"));
            assertThat(scanned.await(10, TimeUnit.SECONDS)).isTrue();
            var created = ok("/v1/MemoryEntry/write", Map.of("text", "committed after source scan"));
            UUID id = UUID.fromString(created.path("id").asText());
            resume.countDown();
            assertThat(rebuild.get(12, TimeUnit.SECONDS).deletedStale()).isEqualTo(1);
            assertThat(indexes.findById(orphan)).isEmpty();
            assertThat(indexes.findById(otherOrphan)).isPresent();
            assertThat(indexes.findById(id).orElseThrow().getSourceHash()).isEqualTo(created.path("sourceHash").asText());
        } finally {
            resume.countDown();
            pool.shutdownNow();
        }
    }

    @Test
    void delayedSemanticEmbeddingDoesNotBlockAConcurrentCorrectionOrResurrectADeletedSource() throws Exception {
        // Sorting by creation time puts both targets before the delayed final record.
        var first = ok("/v1/MemoryEntry/write", Map.of("text", "before slow embedding"));
        var forgotten = ok("/v1/MemoryEntry/write", Map.of("text", "forget during slow embedding"));
        var last = ok("/v1/MemoryEntry/write", Map.of("text", "delayed final embedding"));
        var computing = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        doReturn(true).when(embeddings).semanticConfigured();
        doAnswer(call -> {
            if (last.path("text").asText().equals(call.getArgument(0))) {
                computing.countDown();
                if (!release.await(15, TimeUnit.SECONDS)) throw new AssertionError("embedding not released");
            }
            return new float[]{1f, 0f};
        }).when(embeddings).semantic(org.mockito.ArgumentMatchers.anyString());
        var pool = Executors.newSingleThreadExecutor();
        try {
            var rebuild = pool.submit(() -> search.reindex("admin"));
            assertThat(computing.await(10, TimeUnit.SECONDS)).isTrue();
            UUID correctedId = UUID.fromString(first.path("id").asText());
            var corrected = ok("/v1/graymatter/memory/" + correctedId + "/revise", Map.of(
                "expectedSourceHash", first.path("sourceHash").asText(), "text", "new evidence"));
            UUID forgottenId = UUID.fromString(forgotten.path("id").asText());
            assertThat(mutate("/v1/graymatter/memory/" + forgottenId + "/forget", Map.of(
                "expectedSourceHash", forgotten.path("sourceHash").asText(), "confirmed", true)).getStatus()).isEqualTo(204);
            release.countDown();
            rebuild.get(12, TimeUnit.SECONDS);
            assertThat(indexes.findById(correctedId).orElseThrow().getSourceHash()).isEqualTo(corrected.path("sourceHash").asText());
            assertThat(indexes.findById(forgottenId)).isEmpty();
        } finally {
            release.countDown();
            pool.shutdownNow();
        }
    }

    private JsonNode ok(String path, Object body) throws Exception {
        MockHttpServletResponse response = mutate(path, body);
        assertThat(response.getStatus()).isEqualTo(200);
        return mapper.readTree(response.getContentAsByteArray());
    }

    private MockHttpServletResponse mutate(String path, Object body) throws Exception {
        return postRaw(path, mapper.writeValueAsString(body), "admin", "graymatter-light");
    }

    private MockHttpServletResponse postRaw(String path, String json, String user, String password) throws Exception {
        return mvc.perform(post(path).with(httpBasic(user, password)).contentType(MediaType.APPLICATION_JSON).content(json))
            .andReturn().getResponse();
    }
}
