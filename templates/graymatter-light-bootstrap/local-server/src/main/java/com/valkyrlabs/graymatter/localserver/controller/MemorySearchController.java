package com.valkyrlabs.graymatter.localserver.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.valkyrlabs.graymatter.localserver.service.MemoryHybridSearchService;
import com.valkyrlabs.graymatter.localserver.service.LocalMemoryEmbeddingService;
import com.valkyrlabs.graymatter.localserver.service.MemorySearchFilterParser;
import com.valkyrlabs.graymatter.localserver.repository.MemorySearchIndexRepository;
import java.security.Principal;
import java.util.List;
import java.util.Iterator;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/v1/memory")
public class MemorySearchController {
    private final MemoryHybridSearchService search;
    private final LocalMemoryEmbeddingService embeddings;
    private final MemorySearchIndexRepository indexes;

    public MemorySearchController(MemoryHybridSearchService search, LocalMemoryEmbeddingService embeddings,
                                  MemorySearchIndexRepository indexes) {
        this.search = search;
        this.embeddings = embeddings;
        this.indexes = indexes;
    }

    @PostMapping("/semantic-index/search")
    public SearchResult search(Principal authenticated, @RequestBody SearchRequest request) {
        if (request == null || request.query() == null || request.query().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "query is required");
        }
        try {
            MemorySearchFilterParser.Filters filters = MemorySearchFilterParser.merge(
                request.type(), request.source(), request.tags(), request.filters());
            MemoryHybridSearchService.SearchResponse ranked = search.search(authenticated.getName(),
                new MemoryHybridSearchService.SearchRequest(request.query(),
                    request.limit() == null ? request.maxResults() == null ? 25 : request.maxResults() : request.limit(),
                    request.retrievalMode(), filters.type(), filters.source(), filters.tags()));
            return new SearchResult(ranked.hits().stream().map(hit -> new SearchHit(
                MemoryEntryController.MemoryEntryResponse.from(hit.entry()), hit.score(),
                hit.lexicalScore(), hit.vectorScore(), hit.matchTier(), hit.sourceHash())).toList(),
                ranked.retrievalMode(), ranked.vectorProfile(), ranked.semanticDegraded());
        } catch (IllegalArgumentException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, ex.getMessage());
        }
    }

    @PostMapping({"/reindex", "/semantic-index/reindex"})
    public MemoryHybridSearchService.ReindexResult reindex(Principal authenticated,
        @RequestBody(required = false) JsonNode request) {
        if (request != null && !request.isNull()) {
            if (!request.isObject()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid reindex request");
            Iterator<String> fields = request.fieldNames();
            while (fields.hasNext()) {
                if (!fields.next().equals("dryRun")) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Lite reindex supports MemoryEntry and dryRun only");
                }
            }
            if (request.has("dryRun") && !request.get("dryRun").isBoolean()) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "dryRun must be boolean");
            }
            if (request.path("dryRun").asBoolean(false)) return search.estimateReindex(authenticated.getName());
        }
        return search.reindex(authenticated.getName());
    }

    @GetMapping("/capabilities")
    public Capabilities capabilities() {
        return new Capabilities(true, true, true, embeddings.semanticConfigured(),
            "H2 portable Java cosine", LocalMemoryEmbeddingService.HASH_PROFILE,
            embeddings.semanticConfigured() ? embeddings.semanticProfile() : null);
    }

    @GetMapping("/semantic-health")
    public SemanticHealth semanticHealth(Principal authenticated) {
        List<com.valkyrlabs.graymatter.localserver.model.MemorySearchIndex> owned =
            indexes.findByPrincipalUsernameIgnoreCase(authenticated.getName());
        return new SemanticHealth("portable", LocalMemoryEmbeddingService.HASH_PROFILE,
            embeddings.semanticConfigured() ? embeddings.semanticProfile() : null,
            owned.size(), owned.stream().filter(row -> row.getSemanticVector() != null).count(),
            "Local model reachability is checked only during indexing or search");
    }

    public record SearchRequest(String query, Integer limit, Integer maxResults,
                                String retrievalMode, String type, String source, List<String> tags,
                                JsonNode filters) {}
    public record SearchHit(MemoryEntryController.MemoryEntryResponse memoryEntry, double score,
                            double lexicalScore, double semanticScore, String matchTier, String sourceHash) {}
    public record SearchResult(List<SearchHit> results, String retrievalMode, String vectorProfile,
                               boolean semanticDegraded) {}
    public record Capabilities(boolean vectorSearchEnabled, boolean hybridSearchEnabled,
                               boolean offlineAvailable, boolean semanticProviderConfigured,
                               String store, String fallbackProfile, String semanticProfile) {}
    public record SemanticHealth(String status, String fallbackProfile, String semanticProfile,
                                 long indexedCount, long semanticIndexedCount, String note) {}
}
