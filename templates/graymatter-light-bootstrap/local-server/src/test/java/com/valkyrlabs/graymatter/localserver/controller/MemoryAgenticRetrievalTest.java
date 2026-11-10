package com.valkyrlabs.graymatter.localserver.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
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
import com.valkyrlabs.graymatter.localserver.service.BifrostLiteCompressor;
import com.valkyrlabs.graymatter.localserver.service.LocalMemoryEmbeddingService;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
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
    @MockitoSpyBean MemoryEntryRepository memories;
    @Autowired MemorySearchIndexRepository indexes;
    @Autowired MemoryRetrievalReceiptRepository receipts;
    @Autowired PrincipalRecordRepository principals;
    @Autowired PasswordEncoder passwords;
    @Autowired JdbcTemplate jdbc;
    @MockitoSpyBean LocalMemoryEmbeddingService embeddings;

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
    void bifrostWithholdsTruncatedEvidenceAndRechecksLinkedReceipts() throws Exception {
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
            .andExpect(jsonPath("$.retrievalStatus").value("PARTIAL_COVERAGE"))
            .andExpect(jsonPath("$.answerPolicy").value("DO_NOT_ANSWER_CONFIDENTLY"))
            .andExpect(jsonPath("$.contextPageRef").doesNotExist())
            .andExpect(jsonPath("$.contextHash").doesNotExist())
            .andExpect(jsonPath("$.context").doesNotExist())
            .andExpect(jsonPath("$.tokenEstimate").value(0))
            .andExpect(jsonPath("$.items.length()").value(0))
            .andReturn().getResponse().getContentAsString();
        JsonNode context = mapper.readTree(body);
        String receiptId = context.path("receiptId").asText();
        assertThat(body).doesNotContain("abcdef1234567890", "durable evidence");

        mvc.perform(post("/v1/graymatter-retrieval-receipts")
                .with(httpBasic("admin", "graymatter-light"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"launch rule\",\"filters\":{\"tags\":[\"missing\"]}}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.retrievalStatus").value("NO_RESULTS"))
            .andExpect(jsonPath("$.answerPolicy").value("DO_NOT_ANSWER_CONFIDENTLY"))
            .andExpect(jsonPath("$.sourceCount").value(0));

        mvc.perform(get("/v1/graymatter/retrieval-context/{id}/hydrate/{memoryId}", receiptId, decision)
                .param("maxTokens", "100").with(httpBasic("admin", "graymatter-light")))
            .andExpect(status().isConflict());
        mvc.perform(get("/v1/graymatter/retrieval-context/{id}/hydrate/{memoryId}", receiptId, decision)
                .with(httpBasic("reader", "reader-password")))
            .andExpect(status().isNotFound());

        mvc.perform(post("/v1/graymatter/retrieval-context/{id}/recompress", receiptId)
                .with(httpBasic("admin", "graymatter-light"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"launch rule\",\"tokenBudget\":256,\"evictedRefs\":[\"" + other + "\"]}"))
            .andExpect(status().isBadRequest());

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
            .andExpect(jsonPath("$.recordedRetrievalStatus").value("PARTIAL_COVERAGE"))
            .andExpect(jsonPath("$.retrievalStatus").value("STALE_CONTEXT"))
            .andExpect(jsonPath("$.answerPolicy").value("DO_NOT_ANSWER_CONFIDENTLY"))
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
    void conflictSurvivesCompressionAndCannotBeEvictedFromAFork() throws Exception {
        UUID ordinary = write("admin", "graymatter-light", "decision", "Runway approval", "conflict-free");
        UUID conflict = write("admin", "graymatter-light", "context", "Runway decision pending", " UnReSoLvEd ");
        String body = mvc.perform(post("/v1/graymatter-retrieval-receipts")
                .with(httpBasic("admin", "graymatter-light")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"runway\",\"tokenBudget\":128,\"includeText\":false,"
                    + "\"protectedRefs\":[\"" + ordinary + "\"]}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.retrievalStatus").value("CONFLICTING_CONTEXT"))
            .andExpect(jsonPath("$.answerPolicy").value("DO_NOT_ANSWER_CONFIDENTLY"))
            .andExpect(jsonPath("$.recommendedAction").value("REQUIRE_CLARIFICATION"))
            .andExpect(jsonPath("$.conflictRefs[0]").value(conflict.toString()))
            .andExpect(jsonPath("$.omittedRefs[0]").value(conflict.toString()))
            .andReturn().getResponse().getContentAsString();
        String id = mapper.readTree(body).path("receiptId").asText();
        mvc.perform(get("/v1/graymatter-retrieval-receipts/{id}", id)
                .with(httpBasic("reader", "reader-password"))).andExpect(status().isNotFound());
        mvc.perform(get("/v1/graymatter-retrieval-receipts/{id}", id)
                .with(httpBasic("admin", "graymatter-light")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.recordedRetrievalStatus").value("CONFLICTING_CONTEXT"))
            .andExpect(jsonPath("$.retrievalStatus").value("CONFLICTING_CONTEXT"))
            .andExpect(jsonPath("$.conflictRefs[0]").value(conflict.toString()));
        mvc.perform(post("/v1/graymatter/retrieval-context/{id}/fork", id)
                .with(httpBasic("admin", "graymatter-light")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"runway\",\"evictedRefs\":[\"" + conflict + "\"]}"))
            .andExpect(status().isBadRequest());
        mvc.perform(post("/v1/graymatter/retrieval-context/{id}/fork", id)
                .with(httpBasic("admin", "graymatter-light")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"runway\",\"tokenBudget\":1500}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.retrievalStatus").value("CONFLICTING_CONTEXT"));
    }

    @Test
    void largerBudgetCanRestoreCoverageAndStaleEvidenceRemainsVisibleOnDescendants() throws Exception {
        UUID evidence = write("admin", "graymatter-light", "decision",
            "Runway conflict resolution protocol " + "approved. ".repeat(150), "conflict-free");
        String partial = mvc.perform(post("/v1/graymatter/retrieval-context")
                .with(httpBasic("admin", "graymatter-light")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"runway\",\"tokenBudget\":128}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.truncatedRefs[0]").value(evidence.toString()))
            .andExpect(jsonPath("$.retrievalStatus").value("PARTIAL_COVERAGE"))
            .andReturn().getResponse().getContentAsString();
        String id = mapper.readTree(partial).path("receiptId").asText();
        String full = mvc.perform(post("/v1/graymatter/retrieval-context/{id}/recompress", id)
                .with(httpBasic("admin", "graymatter-light")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"runway\",\"tokenBudget\":2000}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.retrievalStatus").value("OK"))
            .andExpect(jsonPath("$.answerPolicy").value("ALLOW_ANSWER"))
            .andExpect(jsonPath("$.recommendedAction").value("ANSWER"))
            .andReturn().getResponse().getContentAsString();
        String current = mapper.readTree(full).path("receiptId").asText();
        jdbc.update("update memory_entry set text = ? where id = ?", "Changed approval", evidence);
        mvc.perform(post("/v1/graymatter/retrieval-context/{id}/fork", current)
                .with(httpBasic("admin", "graymatter-light")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"runway\",\"evictedRefs\":[\"" + evidence + "\"]}"))
            .andExpect(status().isBadRequest());
        for (int generation = 0; generation < 2; generation++) {
            String child = mvc.perform(post("/v1/graymatter/retrieval-context/{id}/fork", current)
                    .with(httpBasic("admin", "graymatter-light")).contentType(MediaType.APPLICATION_JSON)
                    .content("{\"query\":\"runway\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.retrievalStatus").value("STALE_CONTEXT"))
                .andExpect(jsonPath("$.staleRefs[0]").value(evidence.toString()))
                .andExpect(jsonPath("$.items.length()").value(0))
                .andReturn().getResponse().getContentAsString();
            current = mapper.readTree(child).path("receiptId").asText();
        }
    }

    @Test
    void droppingAnExceptionNeverAuthorizesTheRemainingGeneralRuleOnDescendants() throws Exception {
        write("admin", "graymatter-light", "decision", "Deploy after tests pass", "launch");
        UUID exception = write("admin", "graymatter-light", "decision",
            "Deploy exception. " + "review criteria ".repeat(18) + "Hold if customer data changes.", "launch");
        String full = mvc.perform(post("/v1/graymatter/retrieval-context")
                .with(httpBasic("admin", "graymatter-light")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"deploy\"}")).andExpect(status().isOk())
            .andExpect(jsonPath("$.retrievalStatus").value("OK"))
            .andReturn().getResponse().getContentAsString();
        String fullId = mapper.readTree(full).path("receiptId").asText();
        String partial = mvc.perform(post("/v1/graymatter/retrieval-context/{id}/recompress", fullId)
                .with(httpBasic("admin", "graymatter-light")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"deploy\",\"tokenBudget\":128}")).andExpect(status().isOk())
            .andExpect(jsonPath("$.retrievalStatus").value("PARTIAL_COVERAGE"))
            .andReturn().getResponse().getContentAsString();
        String eviction = "{\"query\":\"deploy\",\"evictedRefs\":[\"" + exception + "\"]}";
        mvc.perform(post("/v1/graymatter/retrieval-context/{id}/fork", mapper.readTree(partial).path("receiptId").asText())
                .with(httpBasic("admin", "graymatter-light")).contentType(MediaType.APPLICATION_JSON).content(eviction))
            .andExpect(status().isBadRequest());
        String parent = fullId;
        for (String request : java.util.List.of(eviction, "{\"query\":\"deploy\",\"tokenBudget\":16000}")) {
            String child = mvc.perform(post("/v1/graymatter/retrieval-context/{id}/fork", parent)
                    .with(httpBasic("admin", "graymatter-light")).contentType(MediaType.APPLICATION_JSON).content(request))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sourceSetNarrowed").value(true))
                .andExpect(jsonPath("$.retrievalStatus").value("PARTIAL_COVERAGE"))
                .andExpect(jsonPath("$.context").doesNotExist())
                .andExpect(jsonPath("$.sourceCount").value(1))
                .andReturn().getResponse().getContentAsString();
            parent = mapper.readTree(child).path("receiptId").asText();
        }
        mvc.perform(get("/v1/graymatter-retrieval-receipts/{id}", parent)
                .with(httpBasic("admin", "graymatter-light"))).andExpect(status().isOk())
            .andExpect(jsonPath("$.recordedRetrievalStatus").value("PARTIAL_COVERAGE"))
            .andExpect(jsonPath("$.sourceSetNarrowed").value(true));
    }

    @Test
    void indentationRemainsDistinctThroughCompilationAndHydrationAndCountsTowardCoverage() throws Exception {
        String nested = "if ready:\r\n\tverify()\r\n\tship()\r\n";
        String outside = "if ready:\r\n\tverify()\r\nship()\r\n";
        UUID first = write("admin", "graymatter-light", "decision", nested, "release");
        UUID second = write("admin", "graymatter-light", "decision", outside, "release");
        String full = mvc.perform(post("/v1/graymatter/retrieval-context")
                .with(httpBasic("admin", "graymatter-light")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"release\"}")).andExpect(status().isOk())
            .andExpect(jsonPath("$.retrievalStatus").value("OK")).andReturn().getResponse().getContentAsString();
        JsonNode context = mapper.readTree(full);
        assertThat(context.path("context").asText()).contains("[" + first + "] " + nested, "[" + second + "] " + outside);
        mvc.perform(get("/v1/graymatter/retrieval-context/{id}/hydrate/{memoryId}", context.path("receiptId").asText(), first)
                .with(httpBasic("admin", "graymatter-light"))).andExpect(status().isOk())
            .andExpect(jsonPath("$.excerpt").value(nested));
        UUID spaced = write("admin", "graymatter-light", "decision",
            "def deploy():\n" + " ".repeat(100) + "hold()\n", "pythonrule");
        mvc.perform(post("/v1/graymatter/retrieval-context")
                .with(httpBasic("admin", "graymatter-light")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"pythonrule\",\"retrievalMode\":\"KEYWORD\",\"tokenBudget\":128}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.retrievalStatus").value("PARTIAL_COVERAGE"))
            .andExpect(jsonPath("$.truncatedRefs[0]").value(spaced.toString()))
            .andExpect(jsonPath("$.context").doesNotExist());
    }

    @Test
    void legacyReceiptInspectsFreshnessWithoutInventingItsOriginalPolicy() throws Exception {
        UUID evidence = write("admin", "graymatter-light", "decision", "Runway approval", "launch");
        String body = mvc.perform(post("/v1/graymatter-retrieval-receipts")
                .with(httpBasic("admin", "graymatter-light")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"runway\"}")).andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();
        UUID id = UUID.fromString(mapper.readTree(body).path("receiptId").asText());
        jdbc.update("update memory_retrieval_receipt set recorded_retrieval_status = null, policy_decision = null, policy_version = ? where id = ?",
            "bifrost-lite-context/v1", id);
        jdbc.update("update memory_retrieval_receipt_item set source_hash = ?, explicit_conflict = null where receipt_id = ?",
            BifrostLiteCompressor.sha256("decision\nRunway approval\nlaunch\ngraymatter-local-server"), id);
        mvc.perform(get("/v1/graymatter-retrieval-receipts/{id}", id).with(httpBasic("admin", "graymatter-light")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.recordedRetrievalStatus").doesNotExist())
            .andExpect(jsonPath("$.staleRefs.length()").value(0))
            .andExpect(jsonPath("$.retrievalStatus").value("RETRY_REQUIRED"))
            .andExpect(jsonPath("$.answerPolicy").value("DO_NOT_ANSWER_CONFIDENTLY"));
        mvc.perform(get("/v1/graymatter/retrieval-context/{id}/hydrate/{memoryId}", id, evidence)
                .with(httpBasic("admin", "graymatter-light")))
            .andExpect(status().isConflict());
        mvc.perform(post("/v1/graymatter/retrieval-context/{id}/fork", id)
                .with(httpBasic("admin", "graymatter-light")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"runway\"}"))
            .andExpect(status().isConflict());
    }

    @Test
    void movingANewlineAcrossFieldBoundariesInvalidatesTheReceiptAndRebuildsTheIndex() throws Exception {
        UUID evidence = write("admin", "graymatter-light", "decision", "Runway approval\nconditional", "launch");
        String body = mvc.perform(post("/v1/graymatter/retrieval-context")
                .with(httpBasic("admin", "graymatter-light")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"runway\"}")).andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();
        JsonNode context = mapper.readTree(body);
        String receiptId = context.path("receiptId").asText();
        String oldHash = context.path("items").get(0).path("sourceHash").asText();
        jdbc.update("update memory_entry set text = ?, tags = ? where id = ?",
            "Runway approval", "conditional\nlaunch", evidence);
        mvc.perform(get("/v1/graymatter-retrieval-receipts/{id}", receiptId)
                .with(httpBasic("admin", "graymatter-light")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.retrievalStatus").value("STALE_CONTEXT"));
        mvc.perform(get("/v1/graymatter/retrieval-context/{id}/hydrate/{memoryId}", receiptId, evidence)
                .with(httpBasic("admin", "graymatter-light")))
            .andExpect(status().isConflict());
        String fresh = mvc.perform(post("/v1/graymatter/retrieval-context")
                .with(httpBasic("admin", "graymatter-light")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"runway\"}")).andExpect(status().isOk())
            .andExpect(jsonPath("$.retrievalStatus").value("OK"))
            .andReturn().getResponse().getContentAsString();
        String newHash = mapper.readTree(fresh).path("items").get(0).path("sourceHash").asText();
        assertThat(newHash).isNotEqualTo(oldHash);
        assertThat(indexes.findById(evidence).orElseThrow().getSourceHash()).isEqualTo(newHash);
    }

    @Test
    void okReceiptHydratesRedactedTextOnlyWhileEverySourceIsFresh() throws Exception {
        UUID target = write("admin", "graymatter-light", "context",
            "Runway memo api_key=abcdef1234567890", "launch");
        UUID companion = write("admin", "graymatter-light", "decision", "Runway cleared", "launch");
        String body = mvc.perform(post("/v1/graymatter/retrieval-context")
                .with(httpBasic("admin", "graymatter-light")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"runway\"}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.retrievalStatus").value("OK"))
            .andExpect(jsonPath("$.contextPageRef").exists())
            .andExpect(jsonPath("$.items.length()").value(2))
            .andReturn().getResponse().getContentAsString();
        assertThat(body).contains("[REDACTED]").doesNotContain("abcdef1234567890");
        String id = mapper.readTree(body).path("receiptId").asText();
        mvc.perform(get("/v1/graymatter/retrieval-context/{id}/hydrate/{memoryId}", id, target)
                .with(httpBasic("admin", "graymatter-light")))
            .andExpect(status().isOk()).andExpect(jsonPath("$.excerpt").value("Runway memo api_key=[REDACTED]"));
        verify(memories).findByPrincipalUsernameIgnoreCaseAndIdIn(eq("admin"), anyList());
        verify(memories, never()).findByIdAndPrincipalUsernameIgnoreCase(any(), eq("admin"));
        jdbc.update("update memory_entry set principal_id = ? where id = ?",
            principals.findByUsernameIgnoreCase("reader").orElseThrow().getId(), companion);
        mvc.perform(get("/v1/graymatter/retrieval-context/{id}/hydrate/{memoryId}", id, target)
                .with(httpBasic("admin", "graymatter-light")))
            .andExpect(status().isConflict());
        mvc.perform(get("/v1/graymatter/retrieval-context/{id}/hydrate/{memoryId}", id, companion)
                .with(httpBasic("admin", "graymatter-light")))
            .andExpect(status().isNotFound());
    }

    @Test
    void missingSemanticSourceVectorBlocksHybridEvidenceButExplicitKeywordSearchCanAnswer() throws Exception {
        write("admin", "graymatter-light", "context", "Runway approval", "launch");
        doReturn(true).when(embeddings).semanticConfigured();
        doReturn(null).when(embeddings).semantic(anyString());
        float[] queryVector = new float[32];
        queryVector[0] = 1;
        doReturn(queryVector).when(embeddings).semantic("runway");

        String body = mvc.perform(post("/v1/graymatter/retrieval-context")
                .with(httpBasic("admin", "graymatter-light")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"runway\"}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.semanticDegraded").value(true))
            .andExpect(jsonPath("$.retrievalStatus").value("PARTIAL_COVERAGE"))
            .andExpect(jsonPath("$.sourceCount").value(1)).andExpect(jsonPath("$.items.length()").value(0))
            .andReturn().getResponse().getContentAsString();
        mvc.perform(post("/v1/graymatter/retrieval-context/{id}/fork", mapper.readTree(body).path("receiptId").asText())
                .with(httpBasic("admin", "graymatter-light")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"runway\"}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.semanticDegraded").value(true))
            .andExpect(jsonPath("$.retrievalStatus").value("PARTIAL_COVERAGE"));
        mvc.perform(post("/v1/graymatter/retrieval-context")
                .with(httpBasic("admin", "graymatter-light")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"runway\",\"retrievalMode\":\"KEYWORD\"}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.semanticDegraded").value(false))
            .andExpect(jsonPath("$.retrievalStatus").value("OK")).andExpect(jsonPath("$.items.length()").value(1));
    }

    @Test
    void unicodeContextHonorsUtf8Budget() throws Exception {
        write("admin", "graymatter-light", "context", "cafés résumé ".repeat(3), "unicode");
        String body = mvc.perform(post("/v1/graymatter/retrieval-context")
                .with(httpBasic("admin", "graymatter-light"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"cafés résumé\",\"tokenBudget\":128,\"topK\":1}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.retrievalStatus").value("OK"))
            .andExpect(jsonPath("$.context").isString())
            .andReturn().getResponse().getContentAsString();
        assertThat(mapper.readTree(body).path("context").asText()
            .getBytes(java.nio.charset.StandardCharsets.UTF_8).length).isLessThanOrEqualTo(128);
    }

    @Test
    void untaggedWeekdayAmbiguityRetainsBothWitnessesAndCannotBeClearedByFork() throws Exception {
        UUID first = write("admin", "graymatter-light", "decision", "Canary window is Wednesday.", "");
        UUID second = write("admin", "graymatter-light", "decision", "Canary window is Thursday.", "");
        for (int topK : new int[]{1, 2}) {
            String request = mapper.writeValueAsString(java.util.Map.of("query", "Canary window", "topK", topK));
            JsonNode compiled = mapper.readTree(mvc.perform(post("/v1/graymatter/retrieval-context")
                    .with(httpBasic("admin", "graymatter-light")).contentType(MediaType.APPLICATION_JSON).content(request))
                .andExpect(status().isOk()).andExpect(jsonPath("$.retrievalStatus").value("AMBIGUOUS_WEEKDAY"))
                .andExpect(jsonPath("$.answerPolicy").value("DO_NOT_ANSWER_CONFIDENTLY"))
                .andExpect(jsonPath("$.recommendedAction").value("REQUIRE_CLARIFICATION"))
                .andExpect(jsonPath("$.sourceCount").value(2)).andExpect(jsonPath("$.conflictRefs.length()").value(0))
                .andExpect(jsonPath("$.items.length()").value(0)).andExpect(jsonPath("$.context").doesNotExist())
                .andExpect(jsonPath("$.contextPageRef").doesNotExist()).andReturn().getResponse().getContentAsString());
            assertThat(mapper.convertValue(compiled.get("ambiguousRefs"), String[].class))
                .containsExactlyInAnyOrder(first.toString(), second.toString());
            String id = compiled.path("receiptId").asText();
            mvc.perform(get("/v1/graymatter-retrieval-receipts/{id}", id).with(httpBasic("admin", "graymatter-light")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.recordedRetrievalStatus").value("AMBIGUOUS_WEEKDAY"))
                .andExpect(jsonPath("$.ambiguousRefs.length()").value(2));
            mvc.perform(get("/v1/graymatter/retrieval-context/{id}/hydrate/{memoryId}", id, first)
                    .with(httpBasic("admin", "graymatter-light"))).andExpect(status().isConflict());
            mvc.perform(post("/v1/graymatter/retrieval-context/{id}/fork", id).with(httpBasic("admin", "graymatter-light"))
                    .contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(java.util.Map.of("query", "Canary window"))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.retrievalStatus").value("AMBIGUOUS_WEEKDAY"))
                .andExpect(jsonPath("$.ambiguousRefs.length()").value(2));
            mvc.perform(post("/v1/graymatter/retrieval-context/{id}/fork", id).with(httpBasic("admin", "graymatter-light"))
                    .contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(java.util.Map.of(
                        "query", "Canary window", "evictedRefs", java.util.List.of(second)))))
                .andExpect(status().isBadRequest());
        }
    }

    @Test
    void aFullyDeliveredWeeklyScheduleCanExplainBothDaysButItsEvictionCannotGrantPermission() throws Exception {
        write("admin", "graymatter-light", "decision", "Release cutoff is Monday.", "");
        write("admin", "graymatter-light", "decision", "Release cutoff is Friday.", "");
        UUID schedule = write("admin", "graymatter-light", "decision", "Release cutoff runs on Monday and Friday every week.", "");
        String query = "Release cutoff";
        String request = mapper.writeValueAsString(java.util.Map.of("query", query, "topK", 3));
        JsonNode full = mapper.readTree(mvc.perform(post("/v1/graymatter/retrieval-context")
                .with(httpBasic("admin", "graymatter-light")).contentType(MediaType.APPLICATION_JSON).content(request))
            .andExpect(status().isOk()).andExpect(jsonPath("$.retrievalStatus").value("OK"))
            .andExpect(jsonPath("$.items.length()").value(3)).andExpect(jsonPath("$.ambiguousRefs.length()").value(0))
            .andReturn().getResponse().getContentAsString());
        mvc.perform(post("/v1/graymatter/retrieval-context/{id}/fork", full.path("receiptId").asText())
                .with(httpBasic("admin", "graymatter-light")).contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(java.util.Map.of("query", query, "evictedRefs", java.util.List.of(schedule)))))
            .andExpect(status().isOk()).andExpect(jsonPath("$.retrievalStatus").value("PARTIAL_COVERAGE"))
            .andExpect(jsonPath("$.items.length()").value(0)).andExpect(jsonPath("$.contextPageRef").doesNotExist());
    }

    @Test
    void ownerAndSearchFiltersBoundTheWeekdayWitnessAndOldPermissionRequiresFreshRetrieval() throws Exception {
        UUID first = write("admin", "graymatter-light", "decision", "Canary window is Wednesday.", "");
        write("reader", "reader-password", "decision", "Canary window is Thursday.", "");
        write("admin", "graymatter-light", "context", "Canary window is Thursday.", "");
        String request = mapper.writeValueAsString(java.util.Map.of("query", "Canary window", "type", "decision", "topK", 1));
        JsonNode compiled = mapper.readTree(mvc.perform(post("/v1/graymatter/retrieval-context")
                .with(httpBasic("admin", "graymatter-light")).contentType(MediaType.APPLICATION_JSON).content(request))
            .andExpect(status().isOk()).andExpect(jsonPath("$.retrievalStatus").value("OK"))
            .andExpect(jsonPath("$.ambiguousRefs.length()").value(0)).andExpect(jsonPath("$.sourceCount").value(1))
            .andReturn().getResponse().getContentAsString());
        UUID id = UUID.fromString(compiled.path("receiptId").asText());
        assertThat(jdbc.queryForObject("select policy_decision from memory_retrieval_receipt where id = ?", String.class, id))
            .isEqualTo("OK");
        assertThat(jdbc.queryForObject("select recorded_retrieval_status from memory_retrieval_receipt where id = ?", String.class, id))
            .isNull();
        jdbc.update("update memory_retrieval_receipt set recorded_retrieval_status = 'OK', policy_decision = null, policy_version = ? "
            + "where id = ?", "bifrost-lite-context/v2", id);
        mvc.perform(get("/v1/graymatter-retrieval-receipts/{id}", id).with(httpBasic("admin", "graymatter-light")))
            .andExpect(status().isOk()).andExpect(jsonPath("$.recordedRetrievalStatus").value("OK"))
            .andExpect(jsonPath("$.retrievalStatus").value("RETRY_REQUIRED"));
        mvc.perform(get("/v1/graymatter/retrieval-context/{id}/hydrate/{memoryId}", id, first)
                .with(httpBasic("admin", "graymatter-light"))).andExpect(status().isConflict());
        mvc.perform(post("/v1/graymatter/retrieval-context/{id}/fork", id).with(httpBasic("admin", "graymatter-light"))
                .contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(java.util.Map.of("query", "Canary window"))))
            .andExpect(status().isConflict());
    }

    @Test
    void contextRetainsADirectConflictBeyondTheRawHitLimit() throws Exception {
        UUID direct = write("admin", "graymatter-light", "decision", "Canary window is Wednesday.", "active");
        UUID witness = write("admin", "graymatter-light", "context",
            "Canary window is Thursday. " + "Details under review. ".repeat(10), "unresolved");
        String raw = "{\"query\":\"Canary window\",\"retrievalMode\":\"KEYWORD\",\"limit\":1}";
        mvc.perform(post("/v1/memory/semantic-index/search").with(httpBasic("admin", "graymatter-light"))
                .contentType(MediaType.APPLICATION_JSON).content(raw))
            .andExpect(status().isOk()).andExpect(jsonPath("$.results.length()").value(1))
            .andExpect(jsonPath("$.results[0].memoryEntry.id").value(direct.toString()));
        String query = "{\"query\":\"Canary window\",\"retrievalMode\":\"KEYWORD\",\"topK\":1}";
        String body = mvc.perform(post("/v1/graymatter/retrieval-context").with(httpBasic("admin", "graymatter-light"))
                .contentType(MediaType.APPLICATION_JSON).content(query))
            .andExpect(status().isOk()).andExpect(jsonPath("$.retrievalStatus").value("CONFLICTING_CONTEXT"))
            .andExpect(jsonPath("$.conflictRefs[0]").value(witness.toString()))
            .andExpect(jsonPath("$.sourceCount").value(2)).andExpect(jsonPath("$.items.length()").value(0))
            .andExpect(jsonPath("$.contextPageRef").doesNotExist()).andExpect(jsonPath("$.context").doesNotExist())
            .andReturn().getResponse().getContentAsString();
        String receipt = mapper.readTree(body).path("receiptId").asText();
        mvc.perform(post("/v1/graymatter/retrieval-context/{id}/fork", receipt).with(httpBasic("admin", "graymatter-light"))
                .contentType(MediaType.APPLICATION_JSON).content("{\"query\":\"Canary window\"}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.retrievalStatus").value("CONFLICTING_CONTEXT"))
            .andExpect(jsonPath("$.conflictRefs[0]").value(witness.toString()));
        memories.deleteById(witness);
        mvc.perform(get("/v1/graymatter-retrieval-receipts/{id}", receipt).with(httpBasic("admin", "graymatter-light")))
            .andExpect(status().isOk()).andExpect(jsonPath("$.retrievalStatus").value("STALE_CONTEXT"))
            .andExpect(jsonPath("$.staleRefs[0]").value(witness.toString()));
    }

    @Test
    void conflictWitnessRespectsOwnershipFiltersAndDirectTextCoverage() throws Exception {
        UUID direct = write("admin", "graymatter-light", "decision", "Canary window Friday.", "active");
        write("reader", "reader-password", "decision", "Canary window Monday.", "unresolved");
        write("admin", "graymatter-light", "context", "Canary window Thursday.", "unresolved");
        // The missing term is present in the tag, not in the source text. One shared term is not a witness.
        write("admin", "graymatter-light", "decision",
            "Canary billing. " + "Details under review. ".repeat(20), "unresolved,window");
        mvc.perform(post("/v1/graymatter/retrieval-context").with(httpBasic("admin", "graymatter-light"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"Canary window\",\"retrievalMode\":\"KEYWORD\",\"type\":\"decision\",\"topK\":1}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.retrievalStatus").value("OK"))
            .andExpect(jsonPath("$.sourceCount").value(1)).andExpect(jsonPath("$.conflictRefs.length()").value(0))
            .andExpect(jsonPath("$.items[0].memoryId").value(direct.toString()));
    }

    @Test
    void hydrationReportsActualRedactedByteCoverageEvenWhenTheMarkerCannotFit() throws Exception {
        UUID evidence = write("admin", "graymatter-light", "decision", "🚦rule\n  api_key=abcdef1234567890\nhold", "traffic");
        String safe = "🚦rule\n  api_key=[REDACTED]\nhold";
        int exact = safe.getBytes(java.nio.charset.StandardCharsets.UTF_8).length;
        var compiled = mapper.readTree(mvc.perform(post("/v1/graymatter/retrieval-context")
                .with(httpBasic("admin", "graymatter-light")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"rule\"}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.retrievalStatus").value("OK"))
            .andReturn().getResponse().getContentAsString());
        String id = compiled.path("receiptId").asText();
        String hash = compiled.path("items").get(0).path("sourceHash").asText();
        String path = "/v1/graymatter/retrieval-context/{id}/hydrate/{memoryId}";
        for (int budget : new int[]{1, 4, exact - 1, exact}) {
            String body = mvc.perform(get(path, id, evidence).with(httpBasic("admin", "graymatter-light"))
                    .param("maxTokens", Integer.toString(budget)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.sourceHash").value(hash))
                .andExpect(jsonPath("$.truncated").value(budget < exact))
                .andReturn().getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
            JsonNode result = mapper.readTree(body);
            String excerpt = result.path("excerpt").asText();
            assertThat(body).doesNotContain("abcdef1234567890");
            int delivered = excerpt.getBytes(java.nio.charset.StandardCharsets.UTF_8).length;
            assertThat(delivered).isLessThanOrEqualTo(budget);
            assertThat(result.path("tokenEstimate").asInt()).isEqualTo(delivered);
            if (budget == 1) assertThat(excerpt).isEmpty();
            else if (budget == 4) assertThat(excerpt).isEqualTo("🚦");
            else if (budget < exact) assertThat(excerpt).endsWith("...[truncated]");
            else assertThat(excerpt).isEqualTo(safe);
        }
    }

    @Test
    void hashBucketCollisionDoesNotAuthorizeAnAnswer() throws Exception {
        write("admin", "graymatter-light", "context", "bread", "");
        // No real word or trigram overlaps. These two vectors still clear the
        // portable search threshold when projected into 384 signed buckets.
        assertThat(LocalMemoryEmbeddingService.cosine(embeddings.featureHash("bread context"),
            embeddings.featureHash("export"))).isGreaterThan(0.12);
        mvc.perform(post("/v1/graymatter/retrieval-context").with(httpBasic("admin", "graymatter-light"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"export\",\"retrievalMode\":\"HYBRID\"}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.retrievalStatus").value("NO_RESULTS"))
            .andExpect(jsonPath("$.items.length()").value(0));

        write("admin", "graymatter-light", "context", "orchid", "");
        mvc.perform(post("/v1/graymatter/retrieval-context").with(httpBasic("admin", "graymatter-light"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"orchids\",\"retrievalMode\":\"VECTOR\"}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.retrievalStatus").value("OK"))
            .andExpect(jsonPath("$.items.length()").value(1))
            .andExpect(jsonPath("$.items[0].excerpt").value("orchid"));
    }

    @Test
    void offlineHybridKeepsExactTermsFirstAndCanFillRemainingSlotsWithSubwordEvidence() throws Exception {
        UUID exact = write("admin", "graymatter-light", "context", "These orchids require monitoring. " + "marigold ".repeat(80), "");
        UUID neighbor = write("admin", "graymatter-light", "context", "orchid", "");
        mvc.perform(post("/v1/memory/semantic-index/search").with(httpBasic("admin", "graymatter-light"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"query\":\"orchids\",\"retrievalMode\":\"HYBRID\",\"limit\":2}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.results[0].memoryEntry.id").value(exact.toString()))
            .andExpect(jsonPath("$.results[0].matchTier").value("KEYWORD"))
            .andExpect(jsonPath("$.results[1].memoryEntry.id").value(neighbor.toString()))
            .andExpect(jsonPath("$.results[1].matchTier").value("VECTOR"));
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
