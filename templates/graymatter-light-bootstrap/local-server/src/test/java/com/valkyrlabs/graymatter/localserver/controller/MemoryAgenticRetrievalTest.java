package com.valkyrlabs.graymatter.localserver.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.valkyrlabs.graymatter.localserver.model.PrincipalRecord;
import com.valkyrlabs.graymatter.localserver.repository.MemoryEntryRepository;
import com.valkyrlabs.graymatter.localserver.repository.MemoryRetrievalReceiptRepository;
import com.valkyrlabs.graymatter.localserver.repository.MemorySearchIndexRepository;
import com.valkyrlabs.graymatter.localserver.repository.PrincipalRecordRepository;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:h2:mem:agentic-retrieval-test;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
    "spring.jpa.hibernate.ddl-auto=create-drop",
    "graymatter.starter-knowledge-pack.enabled=false"
})
@AutoConfigureMockMvc
class MemoryAgenticRetrievalTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired MemoryEntryRepository memories;
    @Autowired MemorySearchIndexRepository indexes;
    @Autowired MemoryRetrievalReceiptRepository receipts;
    @Autowired PrincipalRecordRepository principals;
    @Autowired PasswordEncoder passwords;
    @Autowired JdbcTemplate jdbc;

    @BeforeEach
    void reset() {
        receipts.deleteAll();
        indexes.deleteAll();
        memories.deleteAll();
        if (principals.findByUsernameIgnoreCase("reader").isEmpty()) {
            principals.save(new PrincipalRecord("reader", passwords.encode("reader-password"),
                "Reader", "ROLE_USER"));
        }
    }

    @Test
    void hybridIndexAndFiltersStayWithinAuthenticatedPrincipal() throws Exception {
        UUID adminId = write("admin", "graymatter-light", "decision",
            "The launch protocol requires signed memory packs and local reindexing", "launch");
        write("reader", "reader-password", "context", "The launch protocol is private to reader", "launch");

        mvc.perform(post("/v1/MemoryEntry/query").with(httpBasic("admin", "graymatter-light"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"signed memory packs\",\"retrievalMode\":\"HYBRID\",\"type\":\"decision\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.results.length()").value(1))
            .andExpect(jsonPath("$.results[0].id").value(adminId.toString()));

        mvc.perform(post("/v1/memory/semantic-index/search").with(httpBasic("admin", "graymatter-light"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"signed memory packs\",\"retrievalMode\":\"VECTOR\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.results[0].memoryEntry.id").value(adminId.toString()))
            .andExpect(jsonPath("$.vectorProfile").value("feature-hash-384-v1"));

        mvc.perform(post("/v1/memory/reindex").with(httpBasic("admin", "graymatter-light")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.indexed").value(1));
        mvc.perform(post("/v1/memory/reindex").with(httpBasic("admin", "graymatter-light"))
                .contentType(MediaType.APPLICATION_JSON).content("{\"dryRun\":true}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.dryRun").value(true))
            .andExpect(jsonPath("$.indexed").value(0))
            .andExpect(jsonPath("$.candidateCount").value(1));
        mvc.perform(post("/v1/memory/reindex").with(httpBasic("admin", "graymatter-light"))
                .contentType(MediaType.APPLICATION_JSON).content("{\"sources\":[{}]}"))
            .andExpect(status().isBadRequest());
        mvc.perform(post("/v1/memory/semantic-index/search").with(httpBasic("admin", "graymatter-light"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"signed memory packs\",\"filters\":{\"tags\":[\"missing\"]}}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.results.length()").value(0));
        mvc.perform(post("/v1/memory/semantic-index/search").with(httpBasic("admin", "graymatter-light"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"signed memory packs\",\"filters\":{\"tenantId\":\"other\"}}"))
            .andExpect(status().isBadRequest());
        mvc.perform(post("/v1/MemoryEntry/query").with(httpBasic("admin", "graymatter-light"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"signed memory packs\",\"retrievalMode\":\"SCHEMA_FILTERED\","
                    + "\"tags\":[\"missing\"]}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.results.length()").value(0));
        assertThat(indexes.findByPrincipalUsernameIgnoreCase("admin")).hasSize(1);
    }

    @Test
    void bifrostRedactsBoundsRechecksAndLinksRecompression() throws Exception {
        UUID decision = write("admin", "graymatter-light", "decision",
            "Important launch rule. api_key=abcdef1234567890 " + "durable evidence ".repeat(150), "launch");
        UUID other = write("admin", "graymatter-light", "context",
            "Launch reference context " + "background detail ".repeat(150), "launch");
        String body = mvc.perform(post("/v1/graymatter/retrieval-context")
                .with(httpBasic("admin", "graymatter-light"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"launch rule\",\"tokenBudget\":256,\"topK\":2,"
                    + "\"protectedRefs\":[\"" + decision + "\"]}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.answerPolicy").value("ANSWER_WITH_CITATIONS"))
            .andExpect(jsonPath("$.contextPageRef").exists())
            .andExpect(jsonPath("$.items[0].memoryId").value(decision.toString()))
            .andReturn().getResponse().getContentAsString();
        JsonNode context = mapper.readTree(body);
        String receiptId = context.path("receiptId").asText();
        assertThat(context.path("context").asText()).doesNotContain("abcdef1234567890")
            .contains("[REDACTED]");
        assertThat(context.path("context").asText().getBytes(java.nio.charset.StandardCharsets.UTF_8).length)
            .isLessThanOrEqualTo(256);

        mvc.perform(post("/v1/graymatter-retrieval-receipts")
                .with(httpBasic("admin", "graymatter-light"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"launch rule\",\"filters\":{\"tags\":[\"missing\"]}}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.answerPolicy").value("DO_NOT_ANSWER_CONFIDENTLY"))
            .andExpect(jsonPath("$.sourceCount").value(0));

        mvc.perform(get("/v1/graymatter/retrieval-context/{id}/hydrate/{memoryId}", receiptId, decision)
                .param("maxTokens", "100").with(httpBasic("admin", "graymatter-light")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.excerpt").value(org.hamcrest.Matchers.not(
                org.hamcrest.Matchers.containsString("abcdef1234567890"))));
        mvc.perform(get("/v1/graymatter/retrieval-context/{id}/hydrate/{memoryId}", receiptId, decision)
                .with(httpBasic("reader", "reader-password")))
            .andExpect(status().isNotFound());

        String recompressed = mvc.perform(post("/v1/graymatter/retrieval-context/{id}/recompress", receiptId)
                .with(httpBasic("admin", "graymatter-light"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"launch rule\",\"tokenBudget\":256,\"evictedRefs\":[\"" + other + "\"]}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.parentReceiptId").value(receiptId))
            .andReturn().getResponse().getContentAsString();
        assertThat(mapper.readTree(recompressed).path("items").size()).isEqualTo(1);

        mvc.perform(post("/v1/graymatter/retrieval-context/{id}/fork", receiptId)
                .with(httpBasic("admin", "graymatter-light"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"launch rule\",\"tokenBudget\":256}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.parentReceiptId").value(receiptId));

        mvc.perform(post("/v1/graymatter/retrieval-context/{id}/recompress", receiptId)
                .with(httpBasic("admin", "graymatter-light"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"launch rule\",\"evictedRefs\":[\"" + decision + "\"]}"))
            .andExpect(status().isBadRequest());

        jdbc.update("update memory_entry set text = ? where id = ?", "Changed launch rule", decision);
        mvc.perform(get("/v1/graymatter-retrieval-receipts/{id}", receiptId)
                .with(httpBasic("admin", "graymatter-light")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.staleRefs[0]").value(decision.toString()));
        mvc.perform(get("/v1/graymatter/retrieval-context/{id}/hydrate/{memoryId}", receiptId, decision)
                .with(httpBasic("admin", "graymatter-light")))
            .andExpect(status().isConflict());
        memories.deleteById(decision);
        mvc.perform(get("/v1/graymatter/retrieval-context/{id}/hydrate/{memoryId}", receiptId, decision)
                .with(httpBasic("admin", "graymatter-light")))
            .andExpect(status().isNotFound());
    }

    @Test
    void contextMadeMostlyOfStubExcerptsIsNotSufficient() throws Exception {
        for (int i = 0; i < 12; i++) {
            write("admin", "graymatter-light", "decision",
                "starved evidence number " + i + " " + "detail about starved evidence ".repeat(50), "starve");
        }
        mvc.perform(post("/v1/graymatter/retrieval-context").with(httpBasic("admin", "graymatter-light"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"starved evidence\",\"tokenBudget\":1024,\"topK\":12}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.retrievalStatus").value("PARTIAL_COVERAGE"))
            .andExpect(jsonPath("$.answerPolicy").value("DO_NOT_ANSWER_CONFIDENTLY"))
            .andExpect(jsonPath("$.recommendedAction").value("retry_retrieval_or_inspect_sources"));

        mvc.perform(post("/v1/graymatter/retrieval-context").with(httpBasic("admin", "graymatter-light"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"starved evidence\",\"tokenBudget\":4000,\"topK\":2}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.retrievalStatus").value("SUFFICIENT_CONTEXT"))
            .andExpect(jsonPath("$.answerPolicy").value("ANSWER_WITH_CITATIONS"));
    }

    @Test
    void unicodeContextHonorsUtf8Budget() throws Exception {
        write("admin", "graymatter-light", "context", "cafés résumé ".repeat(150), "unicode");
        String body = mvc.perform(post("/v1/graymatter/retrieval-context")
                .with(httpBasic("admin", "graymatter-light"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"cafés résumé\",\"tokenBudget\":128,\"topK\":1}"))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();
        assertThat(mapper.readTree(body).path("context").asText()
            .getBytes(java.nio.charset.StandardCharsets.UTF_8).length).isLessThanOrEqualTo(128);
    }

    private UUID write(String user, String password, String type, String text, String tag) throws Exception {
        String body = mvc.perform(post("/v1/MemoryEntry/write").with(httpBasic(user, password))
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(java.util.Map.of(
                    "type", type, "text", text, "tags", java.util.List.of(tag)))))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();
        return UUID.fromString(mapper.readTree(body).path("id").asText());
    }
}
